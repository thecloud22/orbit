# Task P2-005 — Candidate Agent IR

**Sub-phase:** 2.5
**Branch:** `phase-2-task-5-candidate-agent-ir` (off `3b9d55d`)
**Status:** Complete, awaiting review

## What this delivers

A reviewed SOP Graph plus its approved Execution Bindings now compiles into **candidate Agent IR** —
the typed, validated document 2.6 will publish as a runnable Agent Version. Candidates are
persisted, superseded on recompilation, and gated behind a separate technical approval that refuses
anything nobody could check.

Compilation is deterministic. No model is involved anywhere in this task: translating a reviewed
document into a typed workflow is an exact operation, and a model would make an exact answer
approximate.

## The five settled decisions, as implemented

| Decision | Implementation |
|---|---|
| Outcome mapping on the candidate | `outcome_mapping` column; refusal `unmapped_outcome` names the unmapped name. `@orbit/sop-graph` untouched, Phase 1 enum unwidened. |
| Linear graphs only | Refusal `branching_unsupported`; frozen binding schema untouched. |
| Multi-field extract | Refusal `extract_coverage_gap`, naming the fields with nowhere to come from. |
| `manual_review` | Refusal `manual_review_unsupported`, naming the step. |
| Secrets compile, sandbox fails closed | `assessSandboxReadiness` runs as a precondition; `cannot_validate` blocks approval. |

**The escalation-review workflow does not compile**, as agreed. `escalationReviewGraph()` — the
requirements document's own worked example — is refused for both `branching_unsupported` and
`manual_review_unsupported`, and a test pins that refusal rather than leaving it to prose.

## The fail-closed mechanism, concretely

`assessSandboxReadiness` walks the candidate and collects every `${inputs.<id>}` whose declared input
was `secret`. If that set is non-empty it returns `cannot_validate` / `secret_unresolvable`, naming
the inputs — **and nothing launches a browser**, because the check runs before anything could.

It reads the secret ids the compiler returns separately rather than the compiled document, and that
detail is load-bearing: **Agent IR has no secret type.** A `secret` input compiles to an ordinary
string declaration, so secret-ness is not recoverable from the IR. This was found while implementing,
not planned for; had the check read the compiled document it would have silently passed every
recorded sign-in.

Approval refuses a candidate that is not `ready`, and the refusal lives in the repository rather than
a service — it is the only thing between a compiled proposal and something 2.6 publishes, and a guard
reachable around by calling a different function is not a guard. Rejection has no such precondition.

## Defects found and fixed during the work

1. **A recorded workflow could never have compiled.** I required an approved binding for every
   `navigate` step. 4f-1's translator emits **no binding for navigate** — a navigation names a
   destination, not an element — so every recorded workflow would have been refused. Navigate now
   compiles from the graph's own `urlHint`, preferring a binding's URL when one exists. Caught by the
   test that compiles a real recording; a hand-written fixture would not have found it.
2. **The truncation order omitted the new table.** `ORBIT_TABLE_NAMES` is a hand-maintained list, and
   `agent_ir_candidates` references `sop_graph_revisions` with `restrict` — so test isolation would
   have broken *and* truncating revisions would have failed outright. Added first, children before
   parents.
3. **A refusal counted instead of naming.** The multi-field extract message said "2 values but only
   one was mapped" without saying which was missing — the only thing the reader needs. It now names
   them. The test asserted the useful behaviour and the code was wrong.
4. **My first lint rule banned the thing it was meant to permit.** The glob `@orbit/db` matched
   `@orbit/db/checksum`. Fixed by banning the root with `paths` (exact) rather than `patterns`
   (glob), then **probed**: `@orbit/db`, `@orbit/runtime` and `playwright` each produce a violation;
   `@orbit/db/checksum` produces none.

## Deviations from the brief, both deliberate

1. **`@orbit/contracts` was modified.** The brief listed it as untouched. Persisting a new entity
   needs an opaque id, so `aircand_` and `newAgentIrCandidateId()` were added — purely additive, the
   same pattern 2.4a used for `execbind_`, and nothing existing was changed. Flagged rather than
   quietly done.
2. **The step checksum is imported, not injected.** The brief said import it; a pure compiler cannot
   import `@orbit/db`. Rather than inject it — which would leave one definition guaranteed only by
   convention, exactly what ADR-019 set out to avoid — `@orbit/db` gained a `./checksum` subpath
   carrying `node:crypto` and a type import. The compiler imports the one definition structurally.
   A boundary test asserts that file imports nothing else.

   The host allowlist could not be handled the same way: its one definition is in `@orbit/runtime`,
   which a pure compiler must not import. It is passed in, and supplied from exactly one place
   (`allowed-hosts.ts`) that re-exports rather than redeclares — the same rule as the fix committed
   in `3ee081d`.

## Tests

| Suite | Result |
|---|---|
| `pnpm typecheck` / `lint` / `format:check` | clean |
| `pnpm test` | 804 passed (78 files) |
| `pnpm db:generate` | "No schema changes, nothing to migrate" |
| `pnpm test:db` | 200 passed (17 files) |
| `pnpm test:runtime` | see verification log |
| `pnpm test:e2e:watchtower` | see verification log |
| `pnpm verify:phase1` | see verification log |

New coverage: 29 compiler cases (Phase 1 shape, every refusal path, the recorded workflow, the
escalation refusal, the boundary scan, the sandbox precondition) and 10 service cases against a real
database (compilation, supersession, the approval gate, the secret refusal).

**The boundary is enforced three ways**, matching the posture ADR-016 established: the dependency
surface, a lint rule probed to confirm it fires, and a static scan of the package's own source for
`fetch(`, `chromium`, `page.`, `node:net`, `child_process` and the rest — with a case asserting the
scan can fail rather than passing vacuously.

## Schema

One new table, `agent_ir_candidates`, and one migration, `0003_agent_ir_candidates.sql` (renamed from
Drizzle's generated name to match the existing convention, journal updated). `pnpm db:generate`
reports no drift.

## Limitations, stated rather than solved

- **Branching is not compiled.** The escalation-review reference workflow waits on a later task.
- **A workflow needing credentials is a dead end.** It compiles and persists, and can never be
  approved. That is the intended shape, but it goes no further until credential handling exists.
- **Four SOP input types cannot be carried** — `number`, `boolean`, `enum`, `date` — because Agent IR
  declares one value type. Refused with a named reason.
- **Sandbox validation assesses readiness; it does not execute the candidate.** Running one against a
  sandbox is a run, which this task excludes. The gate is here; the execution is 2.6's.
- **A multi-field extract cannot be bound**, since there is one current binding per step. Refused
  rather than partially compiled.
- **No UI.** Compiling and approving a candidate are service-level operations with no Watchtower
  surface yet.

## Files

**Created** — `packages/agent-ir-compiler/` (compiler, refusal taxonomy, sandbox precondition, four
test files); `packages/db/src/schema/agent-ir-candidates.ts`,
`packages/db/src/mappers/agent-ir-candidate.ts`, `packages/db/src/repositories/agent-ir-candidates.ts`;
`packages/db/drizzle/0003_agent_ir_candidates.sql`; `packages/sop-service/src/candidate-service.ts`,
`allowed-hosts.ts` and their database tests; this report.

**Modified** — `packages/contracts/src/{ids,generate-id}.ts`; `packages/db/{package.json}` and its
schema, mapper and repository indexes; `packages/sop-service/{package.json,src/index.ts}`;
`apps/api/src/testing/stub-context.ts`; `eslint.config.js`; `docs/architecture/decisions.md`
(ADR-021); `README.md`; `docs/tasks/ACTIVE_TASK.md`.

**Untouched** — `@orbit/agent-ir`, `@orbit/execution-mapping`, `@orbit/sop-graph`;
`packages/runtime/src/{interpreter,drift,ports}.ts`; `describeElement`; the Phase 1 seeded fixture;
every Phase 1 table.

## Committed separately, first

`3ee081d` — the duplicated host allowlist flagged in the brief. `apps/api/src/routes/recording.ts`
declared its own `ALLOWED_RECORDING_HOSTS` while its comment claimed it was not a copy. It now
imports `ALLOWED_HOSTS` from `@orbit/runtime`, and a test drives every addressable host in the real
constant through the real route.
