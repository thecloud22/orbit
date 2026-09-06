# Phase 2 Task 3 Report — Graph Review, Editing, and Lifecycle (sub-phase 2.3)

**Status:** Complete, pending commit approval

**Branch:** `phase-2-task-3-graph-review-editing`, branched off Task 2's tip `2d5acb6` per the
brief's sequencing note. Neither branch is merged to master.

**Scope:** Sub-phase 2.3 only. No execution mapping, no Agent IR, no publishing, no run wiring.

## Goal

Let a human act on a generated draft: read it in plain language, correct steps through structured
forms, reorder them, answer what the model asked, and move the revision through its review
lifecycle.

Everything this needed already existed and none of it had ever been used. `describeStep`,
`validateReorder`, `explainReorderFailure`, the clarification-answer table, and
`SOP_REVISION_TRANSITIONS` were all built in sub-phases 2.1 and 2.2 for exactly this. **This task
is a consumer.** It wrote no validator, no renderer, and no second transition table, and
`@orbit/sop-graph` was not modified.

## Scope call

The brief pre-authorised splitting into 3a and 3b. Having read the actual surface I recommended
the split; the user chose one branch for all of §1–§5, and that is what shipped.

## Discrepancies against the brief — found, and resolved consumer-side

Both are real. **Neither required touching `@orbit/sop-graph` or the schema.**

1. **`validateReorder` is not total.** It calls `applyReorder` without catching, and `applyReorder`
   throws `ReorderError` for an unknown step or a move past either end of the list. §3 assumes a
   rejected reorder yields an explanation, and this one raises instead. Resolved in two places: the
   review view computes `canMoveUp` / `canMoveDown` so the control is never offered at a boundary,
   and the service catches `ReorderError` and returns a typed refusal — the message is already
   written for a reviewer (*"That step cannot move any further in that direction."*). A test drives
   the raising path directly, so the guard is not merely assumed.

2. **`recordAnswer` has no conflict handling.** The table declares
   `unique(revision_id, question_id)` but the insert has no `onConflict`, so a duplicate answer
   would surface as a 500. Resolved with **two independent layers** — see below.

## The two workflow rules (ADR-017)

Both are product decisions, both are binding, and both live in `@orbit/sop-service` so that
`SOP_REVISION_TRANSITIONS` is untouched. The state machine stays a statement of what is
structurally possible; the service holds what the product permits.

**Every clarification question must be answered before `in_review`.** The requirements document
exists to stop Orbit silently inventing missing detail; a reviewer who can approve past an open
question reintroduces exactly that, with a human signature on it. The escape hatch is answering —
"not applicable" is a recorded, attributable judgement — never a bypass flag, because an advisory
version of this rule is indistinguishable from not having it.

**Only `draft` and `needs_clarification` revisions may be changed.** This one is not in the brief
and was unavoidable: `SOP_REVISION_TRANSITIONS` permits *any* state to be superseded, so nothing
structural stopped an edit quietly un-approving an approved document and leaving the approval
referring to nothing. A reviewer who spots a problem in an `in_review` revision sends it back with
`request_clarification` first — which is precisely what that existing edge is for, so the rule uses
the state machine rather than working around it.

**The gate is enforced at the transition, not only in the offered actions.** `availableActionsFor`
withholds `submit_for_review` while questions remain, and `transition` refuses it independently. A
hidden button is a courtesy; it is never what makes a rule hold.

## Defense in depth on duplicate answers, and proof that it is real

The pre-check is a read, so it cannot be what enforces one-answer-per-question — a concurrent
answer can land between the check and the insert. So the insert is also wrapped, matching on the
constraint **name** rather than a message substring, so an unrelated violation still propagates as
a real error instead of being mislabelled a duplicate.

Two layers are only worth having if each works alone. Verified rather than asserted: with the
pre-check **entirely disabled**, all 32 tests still passed — including both duplicate tests — which
proves the constraint catch alone enforces the rule. The pre-check was then restored. A dedicated
test fires two answers concurrently rather than sequentially, so the race is exercised and not just
described.

## Architecture

No new package, no new dependency, **no schema change and no migration**.

```text
packages/sop-service/src/
  draft-service.ts        (Task 2, unchanged)
  revision-service.ts     NEW — review, edit, reorder, answer, lifecycle
```

Every operation delegates: validation to `parseSopGraphDocument`, reorder legality to
`validateReorder`, the rejection sentence to `explainReorderFailure`, transition legality to the
repository's own `WHERE`-clause guard, and superseding to `sopGraphRevisions.create`. Results are
discriminated unions carrying `SopGraphIssue[]` or a plain-language explanation, in the same
discipline as Task 2 — no operation returns a bare boolean.

**The server renders the plain language.** `describeStep`, `describeStepById` and `describeVariable`
all run in `projections.ts`, which is what makes "no second renderer" a testable property rather
than a convention: there is exactly one call site, and a route test asserts every summary equals
`describeStep` for the fixture graph.

**One transitions route, not four.** `POST /v1/sop-revisions/:id/transitions` takes an action whose
vocabulary comes from the service, which derives it from `SOP_REVISION_TRANSITIONS`. Four
near-identical routes would have been four places to drift.

## Editing

One `SopStepEditor` driven by a declarative field spec per kind, so the component renders rather
than branching seven ways and "which fields does a decision have?" is a unit-testable question.
All seven kinds are covered, including the array-shaped fields — branches, extract fields, outcome
returns. **There is no raw JSON textarea anywhere**, and a test asserts no field spec of any kind
is a JSON field.

An emptied optional field is pruned to an absent key rather than sent as an empty string: the graph
schema is strict and those fields are `.min(1).optional()`, so clearing one would otherwise be
rejected as a schema error instead of doing what the reviewer plainly meant.

Step ids are not editable. Branches name their targets by id, so renaming one from the editor would
silently rewire the graph; a mismatch is refused rather than overridden, so a caller learns its
edit was not what it thought it was.

## Defects found and fixed

1. **My end-to-end reorder test asserted a non-deterministic outcome.** It clicked move-up in a
   loop until something failed, so *which* explanation it got depended on how far it got — it
   asserted the dependency wording and received the unreachability wording. Rather than loosen the
   assertion, I enumerated every single-step move against the fixture and found two that fail
   deterministically: `check_closed` up gives the dependency sentence naming Status, and
   `open_advanced_search` up gives the lost-decision-guard sentence. The test now drives one click
   each and asserts both explanation classes exactly.

2. **A pre-existing Phase 1 flake, surfaced and fixed at the cause.** `api.db.test.ts`'s event
   ordering test failed intermittently with an off-by-one: `waitForTerminal` waited for terminal
   *status*, but the runtime appends trailing events after that write, so two reads of the event
   log could straddle one append. Waiting for status is not the same as waiting for the run to stop
   writing. Added `waitForQuiescence`, which waits for the event count to stabilise — the property
   these tests actually depend on. This is the same class of hazard as the Task 2 deadlock fix and
   compounds with it; three consecutive runs are now clean.

3. **A stray duplicate route registration.** An accidental second
   `app.get('/v1/sop-documents/:documentId')` that would have been rejected by Fastify's route
   table at boot. Caught and removed before it ran.

## Commands and exact results

| Command | Result |
|---|---|
| `pnpm install` | No change — no dependency added |
| `pnpm typecheck` | Pass, all 15 workspaces |
| `pnpm lint` | Pass |
| `pnpm format:check` | Pass |
| `pnpm test` | **552 passed**, 53 files |
| `pnpm db:generate` | `No schema changes, nothing to migrate` |
| `pnpm test:db` | **146 passed**, 12 files against `orbit_test` |
| `pnpm test:runtime` | 6 passed |
| `pnpm test:e2e:watchtower` | **21 passed** |
| `pnpm test:e2e` | 9 passed (demo portal) |
| `pnpm check:teardown` | **Reported ports 3000/3001/3002 held — see below** |

Counts before this task were 513 unit, 122 db, 15 Watchtower E2E.

| Added | Tests |
|---|---|
| `packages/sop-service` — review, edit, reorder, answers, lifecycle, boundary (db) | 24 |
| `packages/sop-service/src/network-boundary.test.ts` — static scan | 3 |
| `apps/api/src/routes/sop-revisions.test.ts` | 16 |
| `apps/web/src/sop-review-view-model.test.ts` | 20 |
| `apps/web/src/watchtower.e2e.test.ts` — the full review flow | 6 |

### The teardown check

`check:teardown` failed, and it is **not** a leak from this task. It reported ports 3000, 3001 and
3002 — the *development* ports. Those processes started at 08:11:50, roughly an hour before this
task began, and the end-to-end ports this suite actually uses (3010 and 3102) were free, so the
test stack tore down cleanly. A `pnpm dev` session was already running; the check cannot distinguish
a deliberate dev stack from a leak, which is the correct conservative behaviour. Everything else in
`pnpm verify:phase1` passed. Re-running the gate with the dev stack stopped is the way to see it
fully green, and I did not stop it because it is not mine to kill.

## Changed files

**Created** — `packages/sop-service/src/revision-service.ts`, `revision-service.db.test.ts`,
`network-boundary.test.ts`; `apps/api/src/routes/sop-revisions.ts` + test;
`apps/web/src/{SopReviewPage.tsx,SopStepEditor.tsx,sop-review-view-model.ts}` + test; ADR-017; this
report.

**Modified** — `apps/api/src/{views,projections,context,server,bootstrap}.ts`,
`apps/api/src/testing/stub-context.ts`, `apps/api/src/api.db.test.ts`,
`apps/web/src/{App.tsx,api-client.ts,watchtower.e2e.test.ts}`,
`packages/sop-service/src/index.ts`, `docs/architecture/decisions.md`,
`docs/tasks/ACTIVE_TASK.md`, `README.md`.

**Untouched** — `@orbit/sop-graph` entirely, `SOP_REVISION_TRANSITIONS` and the revision state
machine, `@orbit/sop-generation`, every database table and migration, and all Phase 1 code.

**Dependencies:** none added.

## Known limitations

- **The rules are not database constraints.** ADR-017's two rules are enforced in one service and
  tested against real persistence, but a direct SQL writer, or a future service that forgets to
  call this one, can still violate them. Same posture as ADR-014 for Agent Version immutability,
  acceptable for the same reason: one service owns these writes today.
- **No concurrency control on a revision.** Two reviewers editing the same revision simultaneously
  both succeed; the second supersedes the first, and the first reviewer's page is stale. The UI
  reloads after every write and a 409 says the revision moved on, but nothing prevents the race.
- **`explainReorderFailure` sometimes names the moved step as the one left unreachable**, which
  reads oddly (*"Cannot move X there because it would leave X unreachable"*). It is true, and
  fixing it means changing `@orbit/sop-graph`, which this task is forbidden to do. Named here
  rather than worked around.
- **No diff between revisions.** The review view shows the current revision only; comparing it with
  its parent is not built, and the brief excluded it.
- **Step ids cannot be edited**, so a badly named step keeps its name. Renaming safely means
  rewriting every branch that targets it, which is a larger change than this sub-phase justified.
- **Answers cannot be corrected on the same revision** — one answer per question, by constraint. A
  changed mind means a new revision, which is the intended semantic but is not yet a workflow the
  UI offers.
- **No pagination on `GET /v1/sop-documents`**, which lists every document and summarises each one
  individually.

## For sub-phase 2.4

An approved revision is now reachable, and it is still inert. Execution mapping inherits a graph
whose clarification questions are all answered — which was the point of the §4 gate — and whose
`urlHint` values have never been contacted. ADR-016 defers URL scheme policy, reviewed domain
allowlists, redirect handling, and read-only versus side-effecting classification to that
sub-phase; none of it exists yet, and nothing in this task assumed any of it.
