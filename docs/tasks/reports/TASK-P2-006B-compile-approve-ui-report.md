# Task P2-006B — Reach compile and approve from Watchtower

**Sub-phase:** 2.5 / 2.6 (surface gap)
**Branch:** `phase-2-task-6b-compile-approve-ui` (off `master` at `4fd38d1`)
**Status:** Complete, awaiting review

## Why this task exists

After Task 6, publishing had a Publish button — but nothing before it. Compiling
a document into a candidate and approving that candidate existed only as
`SopCandidateService` calls a test could make. A person using Watchtower always
saw "This workflow has not been turned into an agent yet" with no way to change
it. This task adds the missing surface: **Compile** and **Approve** actions on
the review page, so the whole loop — record → review → compile → approve →
publish → run — is reachable using nothing but the browser.

## The gap building the routes surfaced

Reading `compileDocument` closely enough to wire it up front revealed it had no
precondition on the revision's own review state at all:

```ts
const revision = await repositories.sopGraphRevisions.findCurrent(input.documentId);
if (revision === null) { return { ok: false, reason: 'no_approved_revision' }; }
// ... compiled straight from `revision`, whatever its state
```

`findCurrent` returns the newest revision in *any* state short of `superseded` —
draft, in review, rejected, all included. Nothing had ever compiled a document
whose revision was still being written, so nothing had ever needed this refused.
**This is exactly the situation this whole session has repeatedly asked me to
catch: don't build a button on top of a known defect.** Fixed:

```ts
if (revision.state !== 'approved') {
  return { ok: false, reason: 'revision_not_approved', state: revision.state };
}
```

A second gap followed the same shape. `approve`/`reject` were direct
pass-throughs to the repository, which **throws** (`RecordNotFoundError`,
`InvalidRunTransitionError`, `CandidateNotValidatedError`) rather than returning
a typed result — the one place in `@orbit/sop-service` that didn't match
`compileDocument`, `revision-service`, and `publish-service`, all of which
return discriminated unions. Nothing had called `approve` over HTTP before, so
nothing had needed the route to catch a bare `DatabaseError`. Converted both to
typed results, with the same defense-in-depth `recordAnswer` was required to
have in sub-phase 2.3: a pre-check for the ordinary case, plus a catch of the
repository's own transition guard for the race the pre-check cannot close.

## What compiling actually needs, and what it no longer asks for

`compileDocument` previously took `agentId` and `version` as caller input —
opaque identifiers a person using Watchtower has no business supplying. Both are
now derived:

- **`agentId`** is `agent_<the document's own suffix>` — a pure function of the
  document id, with no state of its own. This matters beyond convenience:
  recompiling the same document after fixing a binding must land under the
  *same* agent, or `publish-service`'s per-agent version allocation and its
  "already published" check would both silently fragment across what a reviewer
  experiences as one workflow. A test compiles the same document twice and
  asserts the agent id is identical both times.
- **`version`** is a throwaway placeholder (`'0.0.0'`) — publishing allocates the
  real number per agent (ADR-023) and never reads the candidate's.

What compiling *does* still need from a person is the outcome mapping — a
business judgement the compiler cannot make on its own (ADR-023). `SopReviewView`
gained `declaredOutcomes`, computed server-side from the graph's own `outcome`
steps and deduplicated by name, so the review page can render a mapping form
without parsing raw step JSON.

## What was built

| Layer | What |
|---|---|
| `packages/sop-service` | `compileDocument`'s new precondition; `approve`/`reject` converted to typed results; deterministic `agentIdForDocument` |
| `apps/api` | `sopCandidateService` wired into `ApiContext`/bootstrap/stub; `declaredOutcomes` on `SopReviewView`; two new routes (`POST /v1/sop-documents/:id/candidates`, `POST /v1/agent-ir-candidates/:id/approve`) |
| `apps/web` | Outcome-mapping form + Compile/Approve actions in `SopPublishPanel`; `publication-view-model` gained `canCompile`, `canApprove`, `compileBlockedReason`, and failure describers |

**Nothing here changes the SOP document.** Compiling produces a candidate row;
approving moves that row through its own lifecycle. `executable` and the
"draft only" notice are untouched, asserted at the route, the full HTTP
integration test, and the browser test.

## Tests

| Suite | Result |
|---|---|
| `pnpm typecheck` / `lint` / `format:check` | clean |
| `pnpm test` | 840 passed (81 files) |
| `pnpm test:db` | 225 passed (19 files) |
| `pnpm test:runtime` | 21 passed |
| `pnpm test:e2e:watchtower` | 33 passed |
| `pnpm verify:phase1` | exit 0, teardown clean |

New coverage: the revision-approval precondition and its two rejected states
(draft, in-review); the approve/reject typed-result paths including the
"approve twice" and "unknown candidate" cases; deterministic agent-id
derivation across a recompile; 11 route-level cases against fakes; a full HTTP
integration test that drives record → submit → approve revision → compile
(refused too early, then succeeds) → approve twice (second refused) → publish →
appears in the agent list → document still non-executable, entirely through
`app.inject`; and a full **browser** end-to-end test that does the same thing
through the real UI — filling the outcome-mapping `<select>`, clicking Compile,
Approve, and Publish in sequence, and confirming the resulting agent is listed.

## No schema change

This task adds no table and no column. Everything is service logic, routes, and
UI over rows 2.5 and 2.6 already defined.

## Limitations, stated rather than solved

- **Rejecting a candidate has no button.** The service and the route both
  support it (`reject` was converted alongside `approve`), but recompiling a
  document already supersedes whatever candidate existed for it, which is
  today's actual way past a `cannot_validate` dead end. Adding a Reject button
  is deferred until there's a case recompiling doesn't already resolve.
- **Sub-phase 2.5's own limitations are unchanged**: the escalation-review
  reference workflow still does not compile (branching unsupported), and a
  workflow needing credentials still compiles but can never be approved.
- **The outcome-mapping form offers exactly two choices per outcome**
  (`request_found` / `request_not_found`), because that is the whole of
  `terminalBusinessOutcomeSchema`. A workflow reaching a business conclusion
  outside those two has nothing to map to yet — unchanged from 2.5.

## Files

**Created** — `apps/api/src/routes/candidates.ts` and its test; this report.

**Modified** — `packages/sop-service/src/candidate-service.ts` and its database
test; `packages/sop-service/src/publish-service.db.test.ts` (revision approval
added to its fixtures); `apps/api/src/{context,bootstrap,server,views,projections}.ts`,
`apps/api/src/testing/{fixtures,stub-context}.ts`, `apps/api/src/api.db.test.ts`,
`apps/api/src/publish-execute.db.test.ts`; `apps/web/src/{SopPublishPanel,SopReviewPage,
api-client,publication-view-model}.ts(x)` and their tests; `apps/web/src/watchtower.e2e.test.ts`;
`docs/architecture/decisions.md` (ADR-024); `README.md`; `docs/tasks/ACTIVE_TASK.md`
(including a correction to a stale "what follows" paragraph left over from before 2.5 shipped).

**Untouched** — `@orbit/agent-ir-compiler`, `@orbit/agent-ir`, `@orbit/execution-mapping`,
`@orbit/sop-graph`; `packages/runtime`; every Phase 1 table; the seeded fixture;
the `agent_ir_candidates` and `agent_versions` schemas (no migration).
