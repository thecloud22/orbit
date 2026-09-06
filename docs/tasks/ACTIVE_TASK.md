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

**Phase 2 is underway.** Task 1 (sub-phase 2.1, SOP Graph foundation) and Task 2 (sub-phase
2.2, free-text understanding) are complete. `@orbit/sop-graph` provides the non-executable graph
contract, its semantic validation, and step reorder/dependency validation; `@orbit/db` persists
documents, immutable checksummed revisions, provenance, and clarification answers;
`@orbit/sop-generation` turns free text into a proposed graph behind an `LLMProvider` interface,
and `@orbit/sop-service` persists a valid one. There is still no review UI and no path from a
graph to anything executable. See `docs/tasks/reports/TASK-P2-001-sop-graph-foundation-report.md`
and `docs/tasks/reports/TASK-P2-002-free-text-understanding-report.md`.

**Task 3 (sub-phase 2.3, review and editing) is next**: the plain-language review UI, the
step-specific form editor, accessible reordering controls that call the reorder validation Task 1
already built, an optional advanced JSON editor, and the clarification-answer workflow.

Phase 2 direction and the remaining sub-phases are in
`docs/tasks/phase-2-sop-graph-requirements.md`. Model output is untrusted input: anything a model
produces goes through `parseSopGraphDocument` before it is persisted, and Task 3 inherits the same
rule for every user edit.

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
