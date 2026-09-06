# Phase 1 Summary Report — Deterministic Proof Loop

**Status:** Complete (all 9 tasks)

**Purpose:** A single consolidated overview of everything built in Phase 1, for anyone
picking up the repository without reading nine individual task reports first. It is a
summary, not a new source of truth — where it disagrees with a per-task report or an ADR,
those are authoritative.

## What Phase 1 proves

```text
Watchtower manual trigger
  -> typed dynamic input
  -> version-pinned Agent IR
  -> deterministic Playwright execution
  -> events and artifacts
  -> Watchtower evidence view
```

One agent (`Find Service Request`), one controlled local demo portal, no LLM, no queue, no
auth. The whole loop runs from a clean checkout in one command:

```bash
pnpm install && cp .env.example .env && pnpm db:migrate && pnpm db:seed && pnpm dev
```

then opening `http://localhost:3000` and starting a run with `SR-1001`.

See `docs/demo/phase-1-demo.md` for the full walkthrough and
`docs/tasks/reports/TASK-009-end-to-end-demo-report.md` for the final acceptance checklist.

## Task-by-task

| Task | Delivered | Report |
|---|---|---|
| **1** — Scaffold | pnpm workspace, shared TypeScript config, Docker Compose Postgres, root scripts | — |
| **2** — Demo portal | `/requests` route, `SR-1001` seeded record, not-found state, required `data-testid`s, Playwright Test suite | — |
| **3** — Domain contracts | `@orbit/contracts` (IDs, events, errors, run status/outcome) and `@orbit/agent-ir` (typed IR schema, locator/assertion/step contracts, semantic validator, restricted interpolation) | — |
| **4** — Postgres persistence | Drizzle schema/migrations for 7 tables, typed repositories, idempotent seed for the Find Service Request Agent Version, guarded `orbit_test` reset harness | `TASK-004-postgres-persistence-report.md` |
| **5** — Artifact storage | `@orbit/artifacts` local filesystem adapter (ADR-015: generated keys, 3-layer path-traversal/symlink containment, atomic exclusive publish) and `@orbit/artifact-service` composing bytes + metadata in one required order | *(no standalone report; folded into Task 6/9)* |
| **6** — Browser runtime | `@orbit/runtime` interpreter over `BrowserExecutor`/`RunStore` ports; `@orbit/executor-playwright`; `pnpm agent:run` CLI; full event timeline, evidence policy, and error classification | `TASK-006-browser-runtime-report.md` |
| **7–8** — Run API + Watchtower | `apps/api` (agent-versions, run start/detail/events/summary, run-scoped controlled artifact retrieval) and `apps/web` (start form, polling, status/output/timeline/evidence UI) | `TASK-007-008-run-api-watchtower-report.md` |
| **9** — End-to-end closure | `pnpm verify:phase1` acceptance gate, deterministic multi-process test teardown, Phase 1 demo guide, final acceptance record | `TASK-009-end-to-end-demo-report.md` |

## Architecture as built

```text
apps/web (Watchtower :3000)
  └─ /v1 proxied ──> apps/api (:3002)
                       ├─ routes: agent-versions, runs, artifacts
                       ├─ RunDispatcher (in-process; ADR-011, no queue)
                       │     └─ @orbit/runtime
                       │           ├─ BrowserExecutor ◄── @orbit/executor-playwright
                       │           └─ RunStore        ◄── @orbit/runtime/persistence
                       ├─ @orbit/db (repositories, migrations)
                       └─ @orbit/artifact-service (bytes + integrity)
                             └─ @orbit/artifacts (local filesystem, ADR-015)

apps/demo-portal (:3001)        <- the controlled automation target
apps/browser-worker             <- pnpm agent:run, same runtime, no HTTP
```

Package boundaries enforced by ESLint (not just convention): `@orbit/contracts` and
`@orbit/agent-ir` depend on nothing but Zod; `@orbit/runtime` never imports Playwright or
Drizzle; `@orbit/artifacts` never imports `@orbit/db`; the UI never imports `@orbit/db`.

## Persisted evidence model

```text
Agent -> Agent Version (immutable) -> Run -> Run Step -> Run Event
                                          -> Artifact -> Artifact Link
```

For every run: exact Agent Version pinned, validated inputs, ordered run/step status
transitions, an append-only strictly-sequenced event log, a screenshot and DOM snapshot
after each declared action plus the final state, one Playwright trace per run (including
failed runs), and typed structured errors. Business outcome (`request_found` /
`request_not_found` / `none`) is always separate from technical run status (ADR-006) — a
correctly-determined "not found" is `succeeded`, never a failure.

## Evidence access

`data/artifacts` is never statically served. Bytes leave the system only through
`GET /v1/runs/:runId/artifacts/:artifactId`, which proves the artifact is linked to that
run (directly, or via its step/event), reads by the *persisted* storage key only, and
verifies the sha-256 checksum before sending a byte. A missing artifact and one belonging
to another run return the identical 404. No response — API or UI — ever contains a storage
key or filesystem path.

## Quality gate

```bash
pnpm verify:phase1
```

runs typecheck → lint → format:check → unit tests → database integration tests → real
browser + demo portal tests → full Watchtower end-to-end tests → demo portal E2E → a
mechanical check that no Orbit process or test port survived. **551 automated tests**,
~80 seconds, all green as of the Task 9 report.

## What Phase 1 deliberately does not include

No queue/scheduler/worker fleet/retry engine/cancellation (ADR-011), no auth/RBAC/tenancy,
no external websites or credentials, no LLM or selector healing, no cloud/object storage,
no WebSockets/SSE. Full list and rationale in `CLAUDE.md` and `docs/architecture/decisions.md`.

## Known limitations carried into Phase 2 planning

- No `NOT_FOUND` code in the error taxonomy (404s use `VALIDATION_ERROR`).
- No server-side duplicate-run-dispatch suppression (UI-only guard).
- No recovery for a run orphaned by a killed API process.
- No retention/orphan-reconciliation job for artifact bytes.
- Agent Version immutability and event append-only are enforced in the repository layer,
  not by database triggers (ADR-014).

Full detail in `docs/tasks/reports/TASK-009-end-to-end-demo-report.md` §8.

## Branch state at time of writing

Work landed as one linear sequence of task commits (not diverged branches):

```text
task-9-end-to-end-demo  (tip — includes everything below)
  ⊃ task-7-8-run-api-watchtower
    ⊃ task-6-browser-runtime
      ⊃ Task 5 commit (29d1f15)
        ⊃ master (currently at 5049f80, Task 4 + docs)
```

`master` has not yet been fast-forwarded past Task 4. Merging `task-9-end-to-end-demo` into
`master` (a fast-forward, no conflicts) brings all of Phase 1 onto the trunk.
