# Task P2-006C — One-click publish for recorded workflows, a cross-agent Runs list, and Watchtower's information architecture

**Sub-phase:** 2.6 (surface follow-up)
**Branch:** `phase-2-task-2-free-text-understanding` (continuation)
**Status:** Complete

## Why this task exists

Live use of the ADR-024 UI surfaced two complaints, given verbatim:

> "Also when I record a agent, I dont want Review/Approval etc. Just record and make it for use."
>
> "Move the recorded Agents into its own tab. Have a seperate runs tab. When I trigger a run it
> should be in its own page. Make the whole site colorful - Professional colors. Why so dull (only
> greys)."

The first is a governance question, not a cosmetic one: does removing screens mean removing the
checks behind them? Analysis was given before building anything, and the answer chosen — **one-click
publish, question kept** — is that a recorded workflow's screens can collapse because a person
demonstrated every action personally, but the fail-closed secret check and the outcome-mapping
judgment call are not screens to remove; they are the actual review. A drafted workflow gets no such
shortcut, because nothing has confirmed its steps against a real page.

## What was built

### One-click publish (ADR-025)

`packages/sop-service/src/publish-recording-service.ts` composes the same four calls the manual path
made — revision transition as needed, compile, candidate approval, publish — behind one function and
one route, `POST /v1/sop-documents/:id/publish-recording`. It refuses `not_recorded` for any document
whose current revision is not `provenance.kind === 'recorded'`.

An equivalence test compiles the same recording through the fast path and through the five manual
calls and asserts the resulting Agent IR (`steps`, `permissions`) is byte-identical — the fast path
is fewer screens, not a different result. Fail-closed secret handling and the "not recorded"
refusal each have their own test.

`SopPublishPanel` was rewritten from three actions (Compile/Approve/Publish) to one
(`onPublish(outcomeMapping)`), gated by `offersOneClickPublish(provenanceKind, stage)`. A recorded,
unpublished document gets the outcome-mapping form and one "Publish this workflow" button
regardless of how far its revision or candidate had already progressed. A non-recorded document gets
an explanatory note instead of a button that could only ever be refused. `SopReviewPage` was updated
to match; the now-dead manual view-model exports (`canApprove`, `canCompile`, `compileBlockedReason`,
`describeCompileFailure`, `describeApproveFailure`, `describePublishFailure`, and their types) were
deleted along with their tests, since nothing calls them from the UI any more. The manual API routes
(`compileDocument`, `approveCandidate`, `publishCandidate`) are untouched and stay independently
tested at the route layer — a drafted document still uses them, just with no Watchtower surface yet,
unchanged from ADR-024.

### Cross-agent Runs list

`RunRepository.listRecent(options?: { limit?: number })` and `GET /v1/runs` (bounded, default 50,
max 200) give Watchtower a list of runs across every agent, joined with each run's agent name and
version (`toRunListItemView`). Phase 1 scale makes the per-row join acceptable; it is commented as
such rather than left unexplained.

### Information architecture

`navigation.ts`'s `View` union grew `agents`, `runs`, and `run` (was implicitly folded into `home`).
Home is now only "Create a workflow." Triggering a run leaves the page that started it —
`useRun.start()` now returns the created run's id, and `App` navigates to `{kind: 'run', runId}` —
so a run is inspected on its own page rather than appended beneath the button that created it. A run
reached by URL, bookmark, or a click from the Runs list is adopted by id via a `view.runId !==
loadedRunId` effect, not only once at mount.

`AgentsPage`, `RunsPage`, and `RunPage` are new files, splitting what was previously all rendered
inline on Home. `ApiErrorNotice` was extracted from a private function in `App.tsx` since three pages
now need it. A validation failure that never creates a run has nowhere to navigate to, so its error
renders on `AgentsPage` (the triggering page) via a new `startError` prop, not on `RunPage` (a page
that in that case is never reached).

### Color

An indigo-600 accent (gradient header bar, indigo primary buttons and active nav state, indigo
wordmark) replaced the all-grey `slate-900` palette across `SopPublishPanel`, `SopDraftForm`,
`RecordWorkflowForm`, `SopReviewPage`, `SopStepEditor`, `StartRunForm`, `RecordingSessionPage`, and
`Nav`. No new dependency; existing Tailwind color tokens.

## Governance behind the collapse, stated explicitly

- The fail-closed sandbox-secret check (ADR-021) still runs and still blocks publish for a candidate
  that cannot be validated — proven by a dedicated test, not merely asserted in a comment.
- Revision transition rules (ADR-017) still apply; a `rejected` or `superseded` revision still
  refuses.
- The outcome-mapping judgment call is preserved on the one-click path deliberately — it is a
  business decision the compiler cannot make (ADR-023), not a rubber-stamp step.
- A drafted or AI-assisted workflow gets none of this shortcut. `offersOneClickPublish` checks
  `provenanceKind === 'recorded'` specifically; nothing widens it to any other provenance kind.

## Tests

| Suite | Result |
|---|---|
| `pnpm typecheck` | clean (20 workspace projects) |
| `pnpm lint` | clean |
| `pnpm format:check` | clean |
| `pnpm test` | 844 passed (82 files) |
| `pnpm test:db` | 233 passed (20 files) |
| `pnpm test:runtime` | 21 passed |
| `pnpm test:e2e:watchtower` | 35 passed |
| `pnpm verify:phase1` | exit 0, teardown clean (ports 3000/3001/3002/3010/3102 free, no surviving process) |

New coverage: `publish-recording-service.db.test.ts` (8 tests — fast-path/manual-path equivalence,
fail-closed secret, `not_recorded` refusal, idempotency from any revision state); route tests for
`POST /v1/sop-documents/:id/publish-recording` (8 tests, every `PublishRecordingResult` reason mapped
to its HTTP status); `publication-view-model.test.ts` rewritten for `offersOneClickPublish` and
`describePublishRecordingFailure`, with tests for the deleted manual-flow functions removed; two new
navigation tests ("opens Agents and Runs from the nav", "opens a run from the Runs list on its own
page"); the existing recording-to-publish end-to-end test rewritten to drive the one-click flow
(record → finish → map the outcome → publish, no manual revision-approval clicks) and to assert on
`run-page` rather than an inline run panel.

## No schema change

This task adds no table and no column. `listRecent` is a new repository method over the existing
`runs` table; publishing a recording writes the same rows the manual path already wrote.

## Limitations, stated rather than solved

- **Rejecting a candidate still has no button.** Unchanged from ADR-024 — recompiling a document
  already supersedes whatever candidate existed, which remains the practical unblock.
- **Sub-phase 2.5's own limitations are unchanged**: the escalation-review reference workflow still
  does not compile (branching unsupported); a workflow needing credentials still compiles but can
  never be approved, and now surfaces that as `cannot_validate` on the one-click path exactly as it
  does on the manual one.
- **The Runs list has no pagination UI** — `GET /v1/runs` is bounded server-side (default 50, max
  200), but Watchtower always requests the default; a workspace with more runs than that has no way
  to see older ones yet.
- **The color pass is a single accent, not a full design system** — no dark mode, no themed
  status colors beyond what `run-view-model.ts` already defined for run states.

## Files

**Created** — `packages/sop-service/src/publish-recording-service.ts` and its database test;
`apps/api/src/routes/publish-recording.ts` and its test; `apps/web/src/{AgentsPage,RunsPage,RunPage,
ApiErrorNotice}.tsx`; this report.

**Modified** — `packages/db/src/repositories/runs.ts` (`listRecent`); `apps/api/src/routes/runs.ts`
(`GET /v1/runs`); `apps/api/src/{views,projections,context,bootstrap,server}.ts`;
`apps/api/src/testing/stub-context.ts`; `apps/api/src/api.db.test.ts`; `packages/sop-service/src/index.ts`;
`apps/web/src/{navigation,useRun,App,run-view-model,api-client,publication-view-model,SopPublishPanel,
SopReviewPage}.ts(x)` and their tests; `apps/web/src/{Nav,RecordWorkflowForm,RecordingSessionPage,
SopDraftForm,SopStepEditor,StartRunForm}.tsx` (color only); `apps/web/src/watchtower.e2e.test.ts`;
`docs/architecture/decisions.md` (ADR-025); `docs/tasks/ACTIVE_TASK.md`.

**Untouched** — `@orbit/agent-ir-compiler`, `@orbit/agent-ir`, `@orbit/execution-mapping`,
`@orbit/sop-graph`, `@orbit/runtime`; every Phase 1 table; the seeded fixture; the manual
compile/approve/publish API routes and their tests (still independently exercised, just with no
Watchtower UI caller for a recorded document any more).
