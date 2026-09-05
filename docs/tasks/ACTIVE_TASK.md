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

Tasks 7 and 8 (run API and Watchtower) are complete: `apps/api` exposes the Phase 1
HTTP surface — agent versions, run start, run detail, ordered events, run summary,
and run-scoped artifact retrieval — and `apps/web` is the Watchtower console that
starts a run, polls persisted state, and opens the evidence. Runs execute in the
API process through the `RunDispatcher` seam (ADR-011); there is no queue.
See `docs/tasks/reports/TASK-007-008-run-api-watchtower-report.md` for the routes,
the evidence access model, the local process model, and known limitations.

Task 9 (end-to-end proof, documentation, and hardening) is next. Note two open
items it should pick up: the Phase 1 error taxonomy has no `NOT_FOUND` code, so
404s are reported as `VALIDATION_ERROR`; and nothing server-side prevents a
duplicate run dispatch.

Task 6 (browser runtime) remains the authority on Agent IR execution: `@orbit/runtime`
interprets Agent IR over the `BrowserExecutor` and `RunStore` ports,
`@orbit/executor-playwright` implements the first, and `@orbit/runtime/persistence`
the second. `prepareExecution` is the single validation gate the API and the
browser-worker CLI both use.

Task 5 (local artifact storage) provides the storage interface and its local filesystem
adapter; `@orbit/artifact-service` composes byte storage with the Task 4 repositories in
the required order. See ADR-015 for the storage-key grammar, containment model, and
orphaned-bytes policy.

Task 4 (PostgreSQL schema, migrations, and repositories) remains the authority on
persistence; see `docs/tasks/reports/TASK-004-postgres-persistence-report.md` for its
limitations.

## Historical task reading

`docs/architecture/task-5-artifact-storage-preflight.md` records the decisions the Task 5 plan had
to make explicit (artifact root, opaque storage keys, path traversal, symlink containment, atomic
writes, temporary-file cleanup, overwrite behavior, checksum behavior, database ordering, test
cleanup containment). It remains the reference for artifact storage behavior.

## Maintaining this file

Update the "Current state" section as tasks complete. Do not add or remove required-reading
entries without also updating `CLAUDE.md` if the change reflects a new standing document.
