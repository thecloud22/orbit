# Task P2-012 — Intelligent recovery from controlled UI drift

**Branch:** `phase-2-task-12-intelligent-recovery` (not committed, not merged, not pushed)
**ADR:** ADR-033
**Demo:** `docs/demo/drift-recovery-demo.md`

## What this delivers

Orbit can now recover from the ordinary kind of UI drift — a `data-testid` renamed while the
element itself is untouched — by **proposing** a repair that a person accepts. It never applies one.

Four stages: **detect** (existed, ADR-018), **diagnose** (new, deterministic), **propose** (new, a
row against the document), **gate** (a person, through the existing approve path).

**The line, enforced by test:** recovery does not rescue the run that met the drift. That run fails,
with its evidence, whether or not a proposal was made. Recovery makes the *next* run possible.

## The design decisions worth reviewing

**A proposal is its own row, not a `draft` binding.** This is a deliberate deviation from the shape
the task described, and it is the one place I departed from the brief. `listCurrent` returns the
newest non-superseded binding per step, and compile and publish then require it to be `approved`, so
a draft binding written by a failing run would shadow the approved binding it hopes to replace —
silently blocking publication of a document with nothing wrong with it. `executionBindings.create`
also supersedes its parent in the same transaction, which is right for a re-recording and wrong for
something that must supersede nothing while it waits. `binding_recovery_proposals` keeps the brief's
substance ("a drafted binding attached to its document, referencing the run that motivated it")
without breaking either invariant. Accepting still goes through `create` → `submitForReview` →
`approve` — the one and only way a binding is ever made.

**"No model" is a type, not a promise.** `diagnoseDrift` is synchronous. A synchronous function
cannot await a network call. Switching ranking on means changing that signature, which shows up in
review. `packages/drift-recovery/src/diagnose.test.ts` asserts it.

**The seam is honest about being inert.** `narrowDriftCandidates` is called in the position a ranker
would attach to, and the comment there says plainly that with the exact-match filter below it
currently removes nothing the comparison would not also remove. `DriftCandidateRanker` is declared
and unreachable. No model call exists, so **no spend is wired** — as instructed.

**Candidates come only from the binding's own chain.** Never from scanning the page. A locator in
the chain has a person's signature on it and the recorder's proof it resolved uniquely; a scanned
lookalike would be a candidate nobody ever approved. This also means the fallbacks — which Agent IR
does not carry and the runtime had never read — finally do something, for diagnosis only, never to
act with.

**Port, not dependency.** `packages/runtime` gained `RecoveryProposer` and no new dependency,
exactly as ADR-032 did for the judge. The runtime observes because it is the only place the live
page and the approved fingerprint exist together; deciding what the difference means needs neither,
so it happens in `@orbit/drift-recovery`. `decision-judge-boundary.test.ts` now proves the runtime
cannot reach `@orbit/drift-recovery` or `@orbit/execution-assist` through the whole workspace
closure.

**Trust tier.** `permissions.recovery = { allowed }`, its own section beside `permissions.model`,
granted per document and compiled into each published version. Tier 0 `observe` → Tier 1
`recommend`; not Tier 5, because Tier 5 describes recovery that acts. An agent without the grant
gets no proposals and its page is not probed.

## Things this task turned on, which are behaviour changes

**1. The drift check now runs in production.** `executeAgentVersion` has taken an optional binding
resolver since 2.4, and **no production entry point had ever supplied one** — the check was live in
tests and inert in every real run. `createDatabaseExecutionBindingResolver` is now wired into
`apps/api/src/dispatch.ts` and the browser-worker CLI, loading bindings from the candidate the
version was published from (never the document's current bindings, which would let a published agent
silently change what it verifies). Any bound agent whose recorded fingerprints do not match its page
will now stop where it previously proceeded. That is ADR-018 working; it was latent.

**2. An unresolvable approved locator is drift.** Previously a renamed test id produced a raw
executor timeout from inside `describeElement`, escaping the drift path with none of the evidence
ADR-018 promises. It is now typed `UNEXPECTED_UI_STATE` with `drift.failure: unresolved` — and it is
the case recovery explains best.

## Two real defects found and fixed

**The library fixture's fingerprints were guesses, and several were wrong.** Nothing had ever
compared them to `apps/library-portal`, because nothing had ever compared them to anything. A text
field's visible text is `""`, not its label; the search field's accessible name is "Title or ISBN",
not "Search the catalog"; the confirmation paragraphs have no accessible name at all. Turning the
drift check on made the demo fail on its *first* step. They are now measured through the executor's
own `describeElement` against the running portal, and `target()` is split into `control` / `field` /
`readout` so the three shapes are stated rather than flattened.

**`@orbit/db` keeps its own copy of the event-type vocabulary, and it had silently diverged.** A
CHECK constraint must be a literal list at migration time, so the duplication is necessary — but
adding a type to `@orbit/contracts` alone produces code that typechecks, passes every unit test, and
**drops the event at run time**. That is exactly what happened here, hidden by the deliberate
decision that a failed evidence write must not replace the failure being recorded. Caught only
because the end-to-end test asserted the event. `packages/db/src/index.test.ts` now pins the two
lists equal.

## Files

**New**

- `packages/drift-recovery/` — `diagnose.ts` (deterministic, synchronous), `proposer.ts`,
  `store.ts`, plus `diagnose.test.ts`, `proposer.test.ts`, `boundary.test.ts`
- `packages/runtime/src/recovery.ts`, `packages/runtime/src/recovery.test.ts`
- `packages/runtime/src/persistence/binding-resolver.ts`
- `packages/db/src/schema/binding-recovery-proposals.ts`,
  `packages/db/src/repositories/binding-recovery-proposals.ts` (+ `.db.test.ts`),
  `packages/db/src/mappers/binding-recovery-proposal.ts`
- `packages/db/drizzle/0009_drift_recovery.sql`
- `packages/sop-service/src/recovery-service.ts` (+ `.db.test.ts`)
- `apps/api/src/routes/recovery.ts` (+ `.test.ts`)
- `apps/browser-worker/src/drift-recovery.runtime.test.ts`
- `apps/library-portal/src/demo-drift.ts`
- `docs/demo/drift-recovery-demo.md`

**Changed (materially)**

- `packages/runtime/src/drift.ts` — unresolvable locator is drift; recovery attempted before the
  error is thrown and cannot prevent it
- `packages/runtime/src/ports.ts` — `RecoveryProposer`, `DriftObservation`
- `packages/runtime/src/interpreter.ts` — the two-gate `recoveryContextFor`
- `packages/agent-ir/src/permissions.ts` — `permissions.recovery`
- `packages/agent-ir-compiler/src/compile.ts` — emits it when the document grants it
- `packages/agent-ir-compiler/src/testing/library-demo.ts` — measured fingerprints, fallback chains
- `packages/contracts/src/events.ts`, `packages/db/src/schema/run-events.ts` — two new event types
- `apps/api/src/dispatch.ts`, `apps/browser-worker/src/cli/run-agent.ts` — resolver + proposer
- `apps/web/src/SopBindingPanel.tsx`, `SopReviewPage.tsx`, `sop-binding-view-model.ts`,
  `api-client.ts` — the proposal card and its one accept action

## Verification — actual output

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm format:check` | pass |
| `pnpm test` | 112 files, 1191 tests, pass |
| `pnpm test:db` | 25 files, 303 tests, pass |
| `pnpm test:runtime` | 7 files, 36 tests, pass |
| `pnpm test:e2e:watchtower` | 1 file, 38 tests, pass |
| `pnpm test:e2e` | 9 tests, pass |
| `pnpm test:e2e:library` | 48 tests, pass |
| `pnpm verify:phase1` | pass through `test:e2e`; see the teardown note below |

`pnpm check:teardown` reports ports 3000 (Watchtower), 3001 (demo portal) and 3002 (API) still
held and exits non-zero, so `verify:phase1` reports failure at that final step. Those are the
user's own `pnpm dev` processes, which the task explicitly said not to kill — every gate before it
passed, and no user process was stopped. Running `verify:phase1` on a machine with no `pnpm dev`
running is the only way to see that last step green.

The strongest evidence is `apps/browser-worker/src/drift-recovery.runtime.test.ts`: a real browser
against a really-renamed test id, real approved bindings in PostgreSQL, and a real proposal row. It
asserts the run fails, a `recovery.proposed` event lands on the right step, the proposal names
`role_and_name=button "Search"`, the approved binding is untouched, accepting supersedes it through
the ordinary lifecycle, and an agent without the grant gets nothing at all.

## Limitations — honest

- **A single-locator binding cannot be recovered.** No fallback, no candidate, no proposal — just a
  request to re-demonstrate. `adviseOnSelectors` already warns about single-locator chains; this is
  the cost of ignoring it, and it is the case where recovery would be most valuable.
- **Only `fill` and `click` steps are drift-checked at all**, because those are the only call sites
  of `verifyBinding`. Navigate and extract steps can drift undetected. Unchanged from 2.4, but worth
  restating now that the check is actually live.
- **A decision binding is not recoverable.** One element per branch, never drift-checked, refused
  explicitly.
- **Diagnosis probes candidates serially**, up to three fallbacks at 1s each, inside a run that has
  already failed. Bounded and small, but it is added latency on a failure path.
- **Turning the drift check on may stop agents that previously ran.** If anyone has bindings whose
  fingerprints do not match their page, those runs now fail. That is correct and it is new.
- **Studio has no surface for the grant.** `permissions.recovery` is settable over the API
  (`POST /v1/sop-documents/:id/recovery`) and is on for the seeded library demo, but there is no
  toggle in the UI. A person cannot grant recovery without curl.
- **A proposal has no expiry and nothing prunes dismissed ones.** Fine at demo scale; a busy fleet
  would want retention, which is the same gap the run tables have.
- **`recovery.declined` fires once per drifted run** after the first proposal exists, so a scheduled
  drifted agent will accumulate declined events (not proposals). Deliberate — it is evidence — but
  it is volume.
- **Accepting does not re-publish.** The new binding is approved; a person still has to publish for
  a run to use it. Deliberate, and it means "accept" alone does not fix anything visible.
