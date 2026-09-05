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

Task 4 (PostgreSQL schema, migrations, and repositories) is complete; see
`docs/tasks/reports/TASK-004-postgres-persistence-report.md` for its outcome, limitations, and the
exact prerequisites the next task inherits. Task 5 (local artifact storage) has not started.

## Maintaining this file

Update the "Current state" section as tasks complete. Do not add or remove required-reading
entries without also updating `CLAUDE.md` if the change reflects a new standing document.
