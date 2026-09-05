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
6. `docs/contracts/api.md` — the Phase 1 HTTP API contract.
7. `docs/architecture/decisions.md` — accepted ADRs; do not silently supersede one.
8. `docs/architecture/phase-1-system-design.md` — the Phase 1 system architecture.
9. `docs/testing/phase-1-test-strategy.md` — required test layers and coverage.
10. `docs/sop/find-service-request.md` — the one Phase 1 business procedure.
11. `fixtures/find-service-request.agent.yaml` — the seeded Agent IR fixture.
12. Relevant existing source under `packages/` and `apps/` for the area being changed.
13. The most recent report under `docs/tasks/reports/` for the last completed task, for current
    state and known limitations.

## Current state

Task 6 (runtime and Playwright browser worker) is complete: `@orbit/runtime` interprets Agent IR
over two ports — `BrowserExecutor` and `RunStore` — `@orbit/executor-playwright` implements the
first with Playwright, and `@orbit/runtime/persistence` implements the second over the Task 4
repositories and the Task 5 artifact service. `pnpm agent:run -- --request-number SR-1001` executes
the seeded Agent Version against the running demo portal and records the full evidence trail. See
`docs/tasks/reports/TASK-006-browser-runtime-report.md` for the supported Agent IR profile, the
event timeline, the evidence and failure policies, and known limitations.

Task 7 (Fastify run and query APIs) is next. It must reuse `prepareExecution` from `@orbit/runtime`
rather than reimplementing Agent Version and input validation.

Task 5 (local artifact storage) provides the storage interface and its local filesystem adapter;
`@orbit/artifact-service` composes byte storage with the Task 4 repositories in the required order.
See ADR-015 for the storage-key grammar, containment model, and orphaned-bytes policy.

Task 4 (PostgreSQL schema, migrations, and repositories) remains the authority on persistence; see
`docs/tasks/reports/TASK-004-postgres-persistence-report.md` for its limitations.

## Historical task reading

`docs/architecture/task-5-artifact-storage-preflight.md` records the decisions the Task 5 plan had
to make explicit (artifact root, opaque storage keys, path traversal, symlink containment, atomic
writes, temporary-file cleanup, overwrite behavior, checksum behavior, database ordering, test
cleanup containment). It remains the reference for artifact storage behavior.

## Maintaining this file

Update the "Current state" section as tasks complete. Do not add or remove required-reading
entries without also updating `CLAUDE.md` if the change reflects a new standing document.
