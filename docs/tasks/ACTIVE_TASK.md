# Active Task — Required Reading

**Status:** Authoritative required-reading list

**Purpose:** The documents below must be read, in order, before planning or implementing material
work in this repository — a new session, a delegated task, or a subagent picking up work. This
list does not replace `CLAUDE.md`; it is the enforceable checklist derived from it. If a document
here conflicts with `CLAUDE.md`, stop and clearly identify the conflict rather than choosing
silently.

## Required reading order

1. `CLAUDE.md` — engineering instructions, scope, architecture rules, coding standards.
2. `docs/engineering/model-routing.md` — which model owns which class of work, and the delegation
   and escalation rules between them.
3. `docs/tasks/phase-1-backlog.md` — the completed Phase 1 task sequence.
4. `docs/tasks/phase-2-sop-graph-requirements.md` — the Phase 2 direction and sub-phase
   sequence; work one approved task at a time.
5. `docs/contracts/agent-ir.md` — the Agent IR contract.
6. `docs/contracts/events-and-evidence.md` — the event envelope and artifact/evidence contract.
7. `docs/contracts/api.md` — the Phase 1 HTTP API contract, including the run-scoped
   artifact route and the evidence-access rules.
8. `docs/architecture/decisions.md` — accepted ADRs; do not silently supersede one.
9. `docs/architecture/phase-1-system-design.md` — the Phase 1 system architecture.
10. `docs/testing/phase-1-test-strategy.md` — required test layers and coverage.
11. `docs/sop/find-service-request.md` — the one Phase 1 business procedure.
12. `fixtures/find-service-request.agent.yaml` — the seeded Agent IR fixture.
13. Relevant existing source under `packages/` and `apps/` for the area being changed.
14. The most recent report under `docs/tasks/reports/` for the last completed task, for current
    state and known limitations.

## Current state

**Phase 1 is complete.** All nine tasks are merged; the deterministic proof loop runs from a clean
checkout via `pnpm dev` and is asserted by `pnpm verify:phase1`. See
`docs/tasks/reports/PHASE-1-SUMMARY-report.md`.

**Phase 2 is underway.** Sub-phases 2.1, 2.2, 2.3, **2.4a, 2.4b, 2.4f, 2.5, 2.6, 2.7 and 2.8** are
complete.
`@orbit/sop-graph` provides the non-executable graph contract and its validation;
`@orbit/sop-generation` turns free text into a proposed graph; `@orbit/sop-service` persists drafts
and drives review; `@orbit/execution-mapping` defines the Execution Binding and the runtime verifies
its fingerprint before every real action; and `@orbit/execution-recorder` plus `apps/recorder`
produce bindings from a human's one-time demonstration against a sandbox. Watchtower's review page
shows, read-only, which steps have bindings and how far each got — the gap 4b's own report flagged.
Watchtower also has navigation and a Documents list, so a workflow is reachable without knowing its
id.

Four rules are binding and recorded in ADRs: only `draft` and `needs_clarification` revisions may be
changed, and every clarification question must be answered before `in_review` (**ADR-017**); a
mismatch between an approved binding and the live page stops the run rather than substituting an
element (**ADR-018**); and script injection is confined to one file, unreachable from anything that
executes an agent, with recorder/runtime fingerprint parity proven by a contract test (**ADR-019**), narrowed for one
API directory by **ADR-020**.

Binding status and staleness are reported separately: an approved binding whose step has since been
edited is still approved and still not safe to run, and `superseded` is never a current status
because supersession only happens alongside a replacement.

A whole workflow can also be recorded in one sitting: `@orbit/sop-recording` turns a captured
sequence into a linear SOP Graph with a binding per step, and `@orbit/sop-service` persists it with
`provenance.kind: 'recorded'` and bindings driven through the lifecycle to `approved`. Passwords are
never read from the page; the translator declares a `secret` input instead.

A workflow can now be recorded **from Watchtower** as well as from a terminal: `/v1/recording-sessions`
starts, polls and finishes a session in the shape run dispatch already uses, and finishing lands on
the review page for the new document. The headed browser opens on the machine running the API, which
the UI states plainly. **ADR-020** narrows ADR-019's ban on script injection in execution paths to a
single API directory rather than lifting it, and a module-graph test from the run-dispatch entry
point proves the two stay apart.

**Sub-phase 2.5 is complete.** `@orbit/agent-ir-compiler` turns a reviewed graph plus its approved
bindings into candidate Agent IR, refusing anything it cannot compile completely and naming the step
and reason for each refusal. Candidates are persisted in `agent_ir_candidates`, superseded on
recompilation, and gated behind a separate technical approval that refuses any candidate whose
sandbox readiness is `cannot_validate` — the fail-closed secret check, applied before a browser
could be launched (**ADR-021**). The reference escalation-review workflow still does not compile — but as of
sub-phase 2.8 that is because three of its steps route to a person and its decisions have no
bindings, not because branching is unsupported.

**Sub-phase 2.6 is complete.** An approved candidate publishes into a runnable Agent Version, minted
already-published rather than promoted, with `published_from_candidate_id` recording where it came
from and a check proving only the lifecycle status and the allocated version differ from what was
approved (**ADR-023**). A published agent runs through the existing route, gate and interpreter.
The review page gained a Publish action and a link out; the SOP Graph's `executable: false` is
unchanged.

**Compiling and approving a candidate now have a Watchtower surface too.** Building it surfaced a
real gap in 2.5: `compileDocument` accepted a revision in any state short of superseded, so a draft
or in-review graph could be compiled. Compiling now requires an `approved` revision, named as its
own refusal; `approve`/`reject` were converted to typed results to match every other write in the
service; and an agent's identity is derived from its document rather than supplied, so recompiling
the same workflow always lands under the same agent (**ADR-024**). A recorded workflow can now go
from Home to a running, published agent using nothing but the browser.

**Publishing a recorded workflow is now one action, not four.** `publish-recording-service.ts`
composes revision approval, compile, candidate approval, and publish behind a single
`POST /v1/sop-documents/:id/publish-recording`, refusing outright if the document was not recorded —
a drafted or AI-assisted workflow keeps the full manual review, because nothing has yet confirmed
its steps against a real page. The one judgement still asked of a person is mapping what each
declared outcome means; every governance gate the manual path enforced, including the fail-closed
sandbox-secret check, still runs in the same order and is proven byte-identical to the manual path
by an equivalence test (**ADR-025**). Watchtower's navigation also split into dedicated Agents,
Runs, and per-run pages — triggering a run leaves the page that started it for the run's own page —
and the review page's old three-button publish panel was removed along with its now-dead view-model
code.

**Agents can now be archived.** `agents.archivedAt` retires an agent's identity — hiding every
version published under it from the active catalog and blocking new runs against it — without
writing to a single `agent_versions` row; every past run and its evidence stays exactly as it was
(**ADR-026**). This is deliberately not deletion: Agent Versions stay immutable (ADR-005, ADR-014),
and the mutable field lives on the `agents` identity row that was already mutable before this task.
Archiving is symmetric (`restore` reverses it) and Watchtower offers an inline undo. Watchtower also
moved to Tailwind CSS 4.3 with a professional-SaaS visual pass — card elevation, rounded-md
interactive elements, a sticky translucent header, and a consistent focus-visible ring — with no
change to any `data-testid` or component behavior.

**A drafted workflow's steps can now be bound from Watchtower, closing the guided path's dead end.**
A generated or hand-authored graph arrived at the compiler with no Execution Bindings and was refused
`missing_binding`, and the only way to create one was the recorder CLI — a terminal, in front of
exactly the person the guided path exists for. `/v1/binding-sessions` opens a headed browser aimed at
one step, polls what was captured, re-aims the same browser at the next step, and saves a binding
created-submitted-approved in one transaction, because demonstrating the step against the page *is*
the review. **ADR-027** reverses ADR-019 for this case on the same merits ADR-020 used for
whole-workflow recording; the recorder CLI remains, and neither path is the other's fallback.

A binding session is a **sitting**, not one session per step: saving writes one row and leaves the
browser exactly where it is, because each step starts where the last left the page. That is why it is
a separate registry from recording, where finishing closes the browser — what the two share is their
hazard, a real Chromium that must not outlive the API, and that is shared as
`recording/session-store.ts`. Binding assembly moved out of the recorder CLI into
`@orbit/sop-service`, so what a real browser click means has one definition; that package still does
not import `@orbit/execution-recorder`, because a capture crosses the boundary as a plain shape.
Once every bindable step carries an approved, non-stale binding, a drafted workflow gets ADR-025's
same one-click publish through `publish-bound-document-service.ts` — the four-call sequence is now
shared as `publish-pipeline.ts`, so the recorded and bound paths differ only in their precondition.
An unbound or partly bound draft still gets no button. `routes/sop-bindings.ts` stays read-only.

**What follows**: sub-phase 2.5's own limitations remain — the escalation-review reference workflow
does not compile because branching is unsupported, and a workflow needing credentials compiles but
can never be approved. Rejecting a candidate has a service and a route but no button; recompiling
already supersedes whatever existed, which is today's actual unblock mechanism. Approving or
rejecting somebody else's binding still has no Watchtower surface, and a binding session is
in-memory: an API restart drops every open session, and only one sitting per document is allowed.
See the Task P2-001 through P2-007 reports under `docs/tasks/reports/`.

Phase 2 direction and the remaining sub-phases are in
`docs/tasks/phase-2-sop-graph-requirements.md`. Model output is untrusted input: anything a model
produces goes through `parseSopGraphDocument` before it is persisted, and Task 3 inherits the same
rule for every user edit.

**Sub-phase 2.8 is complete: a workflow can branch, and model spend is capped.**

A `decision` step now compiles, publishes and runs. Nothing in `@orbit/agent-ir`, `@orbit/runtime` or
`@orbit/executor-playwright` changed to make that true — `browser.expect_one_of` had been executable
since Phase 1. What was missing was an Execution Binding that could describe a branch, so the
`decision` body changed (additively, no migration) from `{target, readMethod, condition}` — read a
value, evaluate a predicate nothing can evaluate — to `branches: [{when, selectors, fingerprint}]`,
one demonstrated element per branch, with `EXECUTION_BINDING_SCHEMA_VERSION` at `0.2`. The branches
live in one body because a binding is keyed by step, and a row per branch would make each supersede
the last. Branches are matched to the graph by the reviewer's own condition text, never by array
position, and a binding covering anything but the exact declared set is refused (**ADR-029**).
Watchtower binds a decision by walking its branches one at a time, writing nothing until all are
covered. `BINDABLE_KINDS` now has one definition, owned by the compiler.

**Every model call is metered, and refused before it is made once a budget is spent.** Three scopes —
global, per agent (per *document* at drafting time, since a document is 1:1 with the agent it will
become), and per run (one Generate: the attempt plus its one repair) — all checked before **each**
call, with the most restrictive one reported. `model_usage` is an append-only ledger of one row per
provider *call*; every scope is a sum over it, with no running total kept anywhere else. Cost is an
estimate from configured rates and says so on every surface. Ceilings default to *set*, not
unlimited, and are configurable per scope. The server is the gate; the Generate button reflects it.
A repair refused mid-request returns the draft's own validation issues alongside the budget reason —
never a silent half-result.

**The branching demo** is `docs/demo/branching-library-demo.md`: search the library catalog, then
borrow the title or place a hold on it depending on what the page shows. Both branches are driven in
a real browser against the real library portal (port 3020) by
`apps/browser-worker/src/library-borrow-or-hold.runtime.test.ts`. It is deliberately not seeded into
`orbit_dev`.

Known, and recorded rather than left to be discovered: a decision's fingerprints are **not**
re-verified at run time, because `expect_one_of` resolves by visibility and does not call the drift
check; and Agent IR still declares only Phase 1's two business outcomes, so the demo maps
`borrowed`/`held` onto them.

### Where the pieces live

| Concern | Owner |
|---|---|
| Persistence, migrations, repositories | `@orbit/db` (Task 4) |
| Artifact bytes and their containment | `@orbit/artifacts`, `@orbit/artifact-service` (Task 5, ADR-015) |
| Agent IR interpretation | `@orbit/runtime` over the `BrowserExecutor` and `RunStore` ports (Task 6) |
| Browser actions | `@orbit/executor-playwright` (Task 6) |
| HTTP surface and run dispatch | `apps/api` (Tasks 7–8) |
| Trigger and evidence console | `apps/web` (Tasks 7–8) |
| SOP Graph contract, validation, reorder rules | `@orbit/sop-graph` (Phase 2 Task 1) |
| SOP document, revision, and provenance persistence | `@orbit/db` (Phase 2 Task 1) |

`prepareExecution` in `@orbit/runtime` is the single validation gate the API and the browser-worker
CLI both use.

### Before starting Phase 2

Read the Task 9 report's limitations section first. The open items carried out of Phase 1 are:
`NOT_FOUND` missing from the error taxonomy; no server-side duplicate-dispatch suppression; no
recovery for runs orphaned by a killed API process; no retention or orphan reconciliation; and
database-level enforcement of immutability and append-only still deferred (ADR-014).

## Historical task reading

`docs/architecture/task-5-artifact-storage-preflight.md` records the decisions the Task 5 plan had
to make explicit (artifact root, opaque storage keys, path traversal, symlink containment, atomic
writes, temporary-file cleanup, overwrite behavior, checksum behavior, database ordering, test
cleanup containment). It remains the reference for artifact storage behavior.

## Maintaining this file

Update the "Current state" section as tasks complete. Do not add or remove required-reading
entries without also updating `CLAUDE.md` if the change reflects a new standing document.
