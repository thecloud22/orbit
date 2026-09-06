# Phase 2 Task 4c Report — Read-only Execution Binding visibility in Watchtower

**Status:** Complete, pending commit approval

**Branch:** `phase-2-task-4c-binding-visibility`, stacked on `phase-2-task-4b-execution-recorder`
at `4cd2913` (itself on 4a). None of the three is merged to master.

## Goal

4b's own report flagged this gap: bindings are confirmed in a terminal, so nobody reviewing a SOP
Graph in Watchtower could see whether its steps had been mapped. This closes it, read-only.

## Four discrepancies against the brief, all raised before implementing

**1. `superseded` can never be a current binding's status.** A binding is superseded only when
`create` writes its replacement in the same transaction, and `listCurrent` filters superseded rows
out — so of the five states the brief listed, a step's current binding can only be `draft`,
`needs_review`, `approved` or `rejected`. Rather than render an unreachable state, the view reports
the current status **plus a count of superseded predecessors**, which makes supersession visible as
the history it actually is.

**2. `describeStep` was already reused, so the panel joins rather than re-renders.** The brief asked
the panel to reuse the renderer the recorder's confirm screen calls. On the web side that label
already arrives as `SopReviewStepView.summary`, computed by the single `describeStep` call site in
`projections.ts` — so having the bindings endpoint compute it again would have created exactly the
second renderer the instruction exists to prevent. The panel joins on `stepId`.

**3. Staleness was missing from the deliverable, and matters more than it looks.** Sub-phase 2.3
made graph edits routine, and a binding records `stepSha256` precisely so an edited step invalidates
it. **An approved binding can be stale.** Status and staleness are orthogonal facts, and showing
only status would let "approved" read as "usable" when the step has moved underneath it. Both are
now reported, computed by reusing `validateBindingAgainstStep` rather than hand-comparing hashes —
so "stale" here means exactly what it means in the recorder, and other mismatches come along free.

**4. No new context member or service was needed.** `GET /v1/sop-documents` already reads
`context.repositories` directly, and this endpoint needs only reads. Smaller diff, and it is what
makes the no-write proof trivial.

**Dependency:** `apps/api` gained a workspace link to `@orbit/execution-mapping` for its exported
types. No external dependency was added.

## What was built

**One endpoint**, `GET /v1/sop-documents/:documentId/bindings`, in its own file so the boundary scan
has an exactly-scoped target and 2.3's review payload is untouched. Per step: `stepId`, `kind`,
`bindable`, `status`, `bindingId`, `supersededCount`, `stale`, `issues`. For **approved** bindings
only, the selector chain and fingerprint — a draft is still in flux and confirmed in the terminal.

**One panel** on the existing review page, with decision logic in `sop-binding-view-model.ts` as
pure functions, matching how the other view models here separate decisions from rendering. Loading
it is deliberately non-fatal: binding visibility is additional information about a workflow, so
failing to fetch it must not stop the workflow itself being reviewed.

## No write path, proven two ways

The route is read-only by construction, and that is asserted rather than promised:

- **At runtime.** The route runs against `createStubContext` with only three read methods stubbed.
  That helper throws on any unstubbed call, naming it — so an attempt at `create`, `approve`,
  `reject`, `submitForReview` or `returnToDraft` fails loudly. That the test passes is the proof.
- **In the source.** A scan asserts the route file names none of those methods, covering the paths
  no test exercises.

The panel is checked too: the E2E asserts it contains no button and no input, and that it tells the
reader where bindings actually come from.

## Commands and exact results

| Command | Result |
|---|---|
| `pnpm install` | One workspace link; no external dependency |
| `pnpm typecheck` | Pass, all 19 workspaces |
| `pnpm lint` | Pass |
| `pnpm format:check` | Pass |
| `pnpm test` | **691 passed**, 66 files |
| `pnpm db:generate` | `No schema changes, nothing to migrate` |
| `pnpm test:db` | 168 passed, 14 files |
| `pnpm test:runtime` | 19 passed |
| `pnpm test:e2e:watchtower` | **24 passed** (was 21) |
| `pnpm test:e2e` | 9 passed |
| `pnpm check:teardown` | **Flagged a running development stack — see below** |

Counts before this task: 658 unit, 21 Watchtower E2E. Database and runtime counts are unchanged,
which is expected: this task adds no persistence and no browser behaviour.

| Added | Tests |
|---|---|
| `apps/api` — endpoint, every reachable state, and the no-write proof | 15 |
| `apps/web` — binding view model | 18 |
| `apps/web` — the panel through the real stack | 3 |

### The teardown check

Failed, and **nothing this task ran leaked.** The check reports anything holding the development
ports and cannot distinguish a deliberate `pnpm dev` session from a survivor of a test run — which
is the right conservative behaviour, and means it will fail for anyone running the stack while they
work.

At the time of the run the survivor was a demo portal this session had started in the background so
the recorder could be tried by hand; that has since been stopped, and the ports are now held by a
developer's own `pnpm dev`. Either way the end-to-end ports this suite actually uses, 3010 and 3102,
were free before and after, so the test stack tore itself down cleanly. Everything else in
`pnpm verify:phase1` passed.

## Notes rather than an ADR

The brief allowed an ADR if a real design decision came up. One did, and it is small enough to
record here: **staleness is derived at read time, never stored, and is orthogonal to lifecycle
status.**

Deriving it means there is no second copy of a fact the binding already carries — `stepSha256` is
the record, and whether it still matches is a question, not a column. Keeping it orthogonal to
status is the part that matters: collapsing them into one field would force a choice between
reporting that a binding was approved and reporting that it is no longer safe, and a reviewer needs
both. This is an application of ADR-018's existing reasoning about `stepSha256` rather than a new
architectural choice, which is why it is a note. Say the word if you would rather it were ADR-020.

## Changed files

**Created** — `apps/api/src/routes/sop-bindings.ts` + test; `apps/web/src/SopBindingPanel.tsx`;
`apps/web/src/sop-binding-view-model.ts` + test; this report.

**Modified** — `apps/api/src/{views,projections,server}.ts`, `apps/api/package.json`,
`apps/api/src/testing/{stack-ports,stack-global-setup}.ts` (the seeded document),
`apps/web/src/{SopReviewPage.tsx,api-client.ts,watchtower.e2e.test.ts}`, `README.md`,
`docs/tasks/ACTIVE_TASK.md`.

**Untouched** — `packages/execution-recorder`, `packages/execution-assist`,
`packages/execution-mapping` internals (types imported only),
`packages/runtime/src/{interpreter,drift,ports}.ts`, `describeElement`, `@orbit/sop-graph`,
`SOP_REVISION_TRANSITIONS`, `@orbit/sop-generation`, `@orbit/sop-service`, every table and
migration. **No schema change and no migration.**

## Known limitations

- **The panel shows the current binding only.** Superseded predecessors are counted, not listed, so
  the full mapping history is not browsable here — the chain exists in the database if it is ever
  wanted.
- **A draft binding's selector chain is not published**, per the brief. Someone wanting to see what
  a draft captured reads it in the terminal where it was recorded.
- **Binding status is fetched separately from the review**, so a slow bindings query shows the
  workflow before the panel. That is the deliberate trade: the review must not wait on it.
- **The seeded E2E binding is created through the repositories, not recorded.** Recording one needs
  a person demonstrating a step in a real browser; that path is covered against a real browser in
  `apps/recorder/src/capture.runtime.test.ts`, and this test needs a document in that state rather
  than the act of getting there.
- **Nothing here surfaces a drift failure from a live run.** 2.6 will report those, and the
  drift-recovery assist 4b built is where they land.
