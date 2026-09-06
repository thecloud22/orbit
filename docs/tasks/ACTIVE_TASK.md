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
3. `docs/tasks/phase-1-backlog.md` — the approved task sequence; work one approved task at a time.
4. `docs/contracts/agent-ir.md` — the Agent IR contract.
5. `docs/contracts/events-and-evidence.md` — the event envelope and artifact/evidence contract.
6. `docs/contracts/api.md` — the Phase 1 HTTP API contract, including the run-scoped
   artifact route and the evidence-access rules.
7. `docs/architecture/decisions.md` — accepted ADRs; do not silently supersede one.
8. `docs/architecture/phase-1-system-design.md` — the Phase 1 system architecture.
9. `docs/testing/phase-1-test-strategy.md` — required test layers and coverage.
10. `docs/sop/find-service-request.md` — the one Phase 1 business procedure.
11. `fixtures/find-service-request.agent.yaml` — the seeded Agent IR fixture.
12. Relevant existing source under `packages/` and `apps/` for the area being changed.
13. The most recent report under `docs/tasks/reports/` for the last completed task, for current
    state and known limitations.

## Current state

**Phase 1 is complete.** All nine tasks are done, and the proof loop runs from a clean checkout in
one documented command:

```text
Watchtower manual trigger -> typed dynamic input -> version-pinned Agent IR
  -> deterministic Playwright execution -> events and artifacts -> Watchtower evidence
```

- `docs/demo/phase-1-demo.md` is the demonstration procedure: setup, the `SR-1001` success, the
  `SR-9999` business not-found result, the controlled technical failure, where every piece of
  evidence lives, how to stop everything, and the test-safety rules.
- `pnpm verify:phase1` is the acceptance gate: type checking, linting, formatting, unit, database,
  runtime-browser, Watchtower end-to-end, and demo portal suites, ending with `pnpm check:teardown`,
  which fails if any Orbit process or test port survived. 551 tests, about 80 seconds.
- `docs/tasks/reports/TASK-009-end-to-end-demo-report.md` is the final acceptance record: the
  scenario expectations, the gate results, the defects fixed, the acceptance checklist, and the
  limitations deferred beyond Phase 1.

Orbit Phase 1 is a **local proof loop, not production software**: no authentication, no queue, no
recovery, no retention, and one agent against one controlled local portal. The report's limitations
section is the authoritative list.

### Where the pieces live

| Concern | Owner |
|---|---|
| Persistence, migrations, repositories | `@orbit/db` (Task 4) |
| Artifact bytes and their containment | `@orbit/artifacts`, `@orbit/artifact-service` (Task 5, ADR-015) |
| Agent IR interpretation | `@orbit/runtime` over the `BrowserExecutor` and `RunStore` ports (Task 6) |
| Browser actions | `@orbit/executor-playwright` (Task 6) |
| HTTP surface and run dispatch | `apps/api` (Tasks 7–8) |
| Trigger and evidence console | `apps/web` (Tasks 7–8) |

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
