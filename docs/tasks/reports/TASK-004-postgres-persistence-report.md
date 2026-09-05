# Task 4 Report — PostgreSQL Schema, Migrations, and Repositories

**Status:** Complete

**Branch:** `task-4-postgres-persistence`

**Commit:** `6718625673f8a9d5a913f72e2e30e37f915bb0eb` (`6718625`)

**Scope:** Phase 1, Task 4 only. No runtime, browser worker, artifact bytes, API routes, or UI.

## Goal

Persist Phase 1 Agent Versions, runs, steps, events, artifact metadata, and artifact links in
PostgreSQL using real Drizzle migrations, typed repositories, seed logic, and integration tests
against a real database.

## Schema and migration files

### Migration

| File | Contents |
|---|---|
| `packages/db/drizzle/0000_phase_1_evidence_schema.sql` | 7 tables, 12 foreign keys, 6 unique constraints, 21 check constraints, 15 explicit indexes |
| `packages/db/drizzle/meta/_journal.json` | Drizzle migration journal |
| `packages/db/drizzle/meta/0000_snapshot.json` | Drizzle schema snapshot for future diffs |
| `packages/db/drizzle.config.ts` | Generation config; `dialect: postgresql`, `out: ./drizzle` |

`drizzle-kit push` is deliberately unused. Migrations are committed SQL applied by
`pnpm db:migrate`, so a schema cannot drift without a versioned migration.

### Schema modules

| File | Table |
|---|---|
| `packages/db/src/schema/agents.ts` | `agents` |
| `packages/db/src/schema/agent-versions.ts` | `agent_versions` |
| `packages/db/src/schema/runs.ts` | `runs` |
| `packages/db/src/schema/run-steps.ts` | `run_steps` |
| `packages/db/src/schema/run-events.ts` | `run_events` |
| `packages/db/src/schema/artifacts.ts` | `artifacts` |
| `packages/db/src/schema/artifact-links.ts` | `artifact_links` |
| `packages/db/src/schema/columns.ts` | Shared column conventions and check helpers |
| `packages/db/src/schema/index.ts` | Barrel plus `ORBIT_TABLE_NAMES` (the truncation list) |

### Key structural decisions as built

- All timestamps are `timestamptz` in UTC. All primary keys are opaque prefixed strings.
- Enumerated columns are `text` + `CHECK`, with values generated from the contract enums, rather
  than PostgreSQL `ENUM` types.
- `agent_versions.agent_ir` is JSONB holding the whole validated Agent IR document, alongside
  `ir_sha256`, a checksum over its canonical JSON.
- `runs` carries `trigger`, `inputs`, `outputs`, and `error` as JSONB, plus the sequence
  allocators `next_step_sequence` and `next_event_sequence`.
- `run_steps` enforces `UNIQUE (run_id, sequence)` and `UNIQUE (run_id, agent_step_id, attempt)`,
  with `attempt` defaulting to 1 and `CHECK attempt >= 1`, `CHECK sequence >= 1`.
- `run_events` enforces `UNIQUE (run_id, sequence)`. `artifactRefs` is derived from artifact links,
  not stored on the event row, so a reference cannot dangle.
- `artifact_links` uses three nullable typed foreign keys with
  `CHECK (num_nonnulls(run_id, run_step_id, run_event_id) = 1)` and a
  `UNIQUE NULLS NOT DISTINCT` key over `(artifact_id, role, run_id, run_step_id, run_event_id)`.
- Deletion cascades downward within a run and is **restricted** upward across the immutability
  boundary: deleting an agent or agent version that has runs or events fails.
- No `bytea` or blob column exists anywhere; an integration test asserts this against
  `information_schema`.

## Versions

| Component | Version |
|---|---|
| `drizzle-orm` | `0.45.2` (declared `^0.45.2`) |
| `drizzle-kit` | `0.31.10` (declared `^0.31.10`, devDependency) |
| `pg` (node-postgres) | `8.23.0` (declared `^8.23.0`) |
| `@types/pg` | `8.23.1` (devDependency) |
| `zod` | `^4.5.4` |
| PostgreSQL server | 18.6 (Homebrew, aarch64-apple-darwin23.6.0) |
| Node.js | 26.8.1 |
| pnpm | 11.25.0 |

**Driver choice.** `pg` over `postgres` (postgres.js): it is the reference driver for Drizzle's
`node-postgres` adapter and its migrator, has the broadest operational tooling, and exposes an
explicit `Pool` that tests and CLI commands can close deterministically. No `dotenv` was added —
Node's built-in `process.loadEnvFile()` is used in CLI entrypoints and the test harness only.

## Databases

| Variable | Database | Used by |
|---|---|---|
| `DATABASE_URL` | `orbit_dev` | Development, `pnpm db:migrate`, `pnpm db:seed` |
| `TEST_DATABASE_URL` | `orbit_test` | `pnpm test:db` only |

```
postgresql://orbit_dev:orbit_local_dev@localhost:5432/orbit_dev
postgresql://orbit_dev:orbit_local_dev@localhost:5432/orbit_test
```

Both are owned by the role `orbit_dev` on the PostgreSQL server already installed on the machine.
Docker is not required by any command; `docker-compose.yml` remains an optional alternative.

`orbit_test` did not exist at the start of this task and was created with one approved statement:

```sql
CREATE DATABASE orbit_test OWNER orbit_dev;
```

No other server-side change was made. The server was not started, stopped, or reconfigured, no
Homebrew configuration was touched, and no database was dropped.

### Final database state

| Table | `orbit_dev` | `orbit_test` |
|---|---|---|
| `agents` | 1 | 0 |
| `agent_versions` | 1 (`agentv_find_service_request_0_1_0`, `0.1.0`, published) | 0 |
| `runs` | 0 | 0 |
| `run_steps` | 0 | 0 |
| `run_events` | 0 | 0 |
| `artifacts` | 0 | 0 |
| `artifact_links` | 0 | 0 |
| Tables in `public` | 7 | 7 |

## Test reset behavior and safety controls

Implemented in `packages/db/src/testing/test-database.ts`.

### Resolution guards (`resolveTestDatabaseUrl`)

1. `TEST_DATABASE_URL` must be set and non-blank. **It never falls back to `DATABASE_URL`** — an
   unset variable fails the run rather than silently pointing destructive tests at development data.
2. It must be a `postgres://` or `postgresql://` URL.
3. Its database name must end in `_test`.
4. It must name a different database from `DATABASE_URL`.

### Live guard (`assertTestDatabase`)

Immediately before every truncate, the connection is asked `SELECT current_database()` and the
operation aborts unless the answer ends in `_test` **and** equals the database named by
`TEST_DATABASE_URL` — in this repository, `orbit_test`. This catches a URL that lies because of
`PG*` environment variables, a service file, or a pooler.

### Reset operation (`truncateOrbitTables`)

```sql
TRUNCATE TABLE "artifact_links", "artifacts", "run_events", "run_steps", "runs",
               "agent_versions", "agents" RESTART IDENTITY CASCADE
```

The table list is the compile-time constant `ORBIT_TABLE_NAMES`, never a dynamic query over
`information_schema`. The reset never drops a schema, a table, or a database, and leaves Drizzle's
migration bookkeeping intact.

### Lifecycle

`vitest.db.config.ts` runs migrations once per suite via `globalSetup`, disables file parallelism
(one shared database), and truncates before each test through `useTestDatabase()`.

### Proof

`packages/db/src/testing/reset.db.test.ts` connects to `orbit_dev` deliberately and asserts that a
full reset cycle against `orbit_test` leaves its rows and its seeded Agent Version untouched, and
that both `assertTestDatabase` and `truncateOrbitTables` refuse to operate on it.

## Seed behavior

`pnpm db:seed` → `packages/db/src/seed/find-service-request.ts`.

1. Reads `fixtures/find-service-request.agent.yaml` from disk. (`@orbit/agent-ir` never touches the
   filesystem; callers own reading bytes.)
2. Validates it with `parseAgentIrYaml`. Any issue raises `SeedValidationError` and **nothing is
   written** — invalid Agent IR never reaches PostgreSQL.
3. In one transaction: upserts the agent, then inserts the Agent Version if `(agent_id, version)`
   is absent.
4. IDs are deterministic, so seeding is idempotent:
   - Agent `agent_find_service_request` (the Agent IR's own `id`).
   - Agent Version `agentv_find_service_request_0_1_0`.
5. Re-seeding an **unchanged** fixture is a no-op and reports "Already present".
6. Re-seeding a **changed** fixture under the same version number raises
   `ImmutableAgentVersionError` rather than overwriting. Published versions are immutable
   (ADR-005); publishing a change means bumping the version.

The stored `ir_sha256` is recomputed on every read, so an out-of-band edit to the JSONB raises
`DatabaseIntegrityError` instead of being handed to a runtime that would execute it.

## Commands run and results

| Command | Result |
|---|---|
| `psql -d postgres -c "CREATE DATABASE orbit_test OWNER orbit_dev;"` | `CREATE DATABASE` |
| `pnpm install` | Added drizzle-orm, drizzle-kit, pg, @types/pg, zod, tsx to `@orbit/db` |
| `pnpm db:generate` | 7 tables written to `drizzle/0000_phase_1_evidence_schema.sql` |
| `pnpm db:migrate` | Applied to `orbit_dev`; idempotent on re-run |
| `pnpm db:seed` | Seeded `Find Service Request 0.1.0`; idempotent on re-run |
| `pnpm typecheck` | Pass, 11 workspaces |
| `pnpm lint` | Pass, including architecture boundary rules |
| `pnpm format:check` | Pass |
| `pnpm test` | **129 passed**, 26 files (no database required) |
| `pnpm test:db` | **59 passed**, 5 files against `orbit_test` |
| `pnpm test:e2e` | **9 passed** (Task 2 demo portal, unchanged) |
| `pnpm verify` | Pass (typecheck + lint + format:check + test + test:db) |

### Integration coverage (`pnpm test:db`)

| File | Covers |
|---|---|
| `repositories/agent-versions.db.test.ts` | Migration application, agent CRUD, seeding, idempotency, immutability, duplicate `(agent_id, version)`, checksum tamper detection, Agent IR JSONB round trip, published listing |
| `repositories/runs.db.test.ts` | Version pinning, inputs/outputs/trigger round trip, found and not-found outcomes, typed failure, illegal transitions, step sequencing, both step unique constraints, retry-attempt allowance, transaction composition and rollback |
| `repositories/run-events.db.test.ts` | Strict sequence ordering, ordering under inverted clocks, 25 concurrent appends, per-run sequence scoping, duplicate sequence rejection, event-type check, envelope contract, persisted `attempt`, append-only surface, incremental polling read |
| `repositories/artifacts.db.test.ts` | Metadata persistence, absence of any binary column, storage-key uniqueness and validation, digest validation, listing by run and step, links by run/step/event/artifact, exactly-one-target check, FK integrity, duplicate-link rejection, cascade and restrict behavior |
| `testing/reset.db.test.ts` | Reset guards, `orbit_dev` untouched across a reset cycle, database identity, schema and migration history survive truncation |

### Defects found and fixed during the task

1. The first `inValues` helper emitted `CHECK (col IN ($1, $2, $3))` — bound parameters, which
   PostgreSQL rejects in DDL. Fixed to inline escaped SQL literals before any migration was applied.
2. Drizzle wraps driver errors, so PostgreSQL's `code` and `constraint` sit on `error.cause`. The
   error helpers now walk the cause chain rather than the test working around it.

## Known limitations

- **Immutability and append-only are enforced in the repository layer, not by the database.** There
  is no update/publish/delete method on `AgentVersionRepository` and no update/delete on
  `RunEventRepository`, and the IR checksum detects out-of-band edits on read — but a direct SQL
  `UPDATE` is not *prevented*. Deferred deliberately (ADR-014).
- **`attempt` is persisted but always 1.** No retry engine exists. The column and the
  `(run_id, agent_step_id, attempt)` unique key are in place so retries do not require a schema
  change.
- **`EventEnvelope` does not carry `attempt`.** The events contract is a strict object without that
  field, so the repository persists `attempt` on the row but does not return it in the envelope.
- **Sequence gaps are possible outside a repository transaction.** `runEvents.append` and
  `runSteps.start` allocate and insert in one transaction, so a rejected insert rolls its
  allocation back (tested). A caller that allocates and then fails elsewhere in its own transaction
  could still burn a number; the unique constraint keeps ordering correct either way.
- **Input values are not validated against the Agent Version's input declarations by the
  repository.** `runs.create` takes already-validated `RunInputs`. That validation belongs to the
  API (Task 7), which must not be skipped.
- **No tenant, owner, or actor authorization columns.** The trigger JSONB carries a development
  actor only.
- **`sensitivity`, `redaction_version`, and `retention_expires_at` exist as extension points with
  no policy behind them.** Nothing sets them beyond the `internal` default.
- **`.env` is gitignored**, so a fresh clone still needs `cp .env.example .env`.
- Integration tests require a running local PostgreSQL server; `pnpm test` does not.

## Open architectural questions

1. **When do database-level triggers land?** ADR-014 records the deferral with a TODO: add
   `agent_versions` and `run_events` triggers, or revoke `UPDATE`/`DELETE` from the application
   role, before more than one service writes to this database. Needs a decision point, not just a
   TODO.
2. **Should `EventEnvelope` gain `attempt`?** Once retries exist, evidence consumers will want to
   distinguish attempt 1 from attempt 2 in the event stream. That is a contract change to
   `@orbit/contracts`, not a persistence change.
3. **Failure semantics for `business_outcome`.** A failed run currently keeps `none`. If a run
   fails *after* reaching a business conclusion, should the outcome be preserved alongside
   `failed`? The repository allows it via `fail({ businessOutcome })` but nothing sets it.
4. **`artifacts.run_id` alongside an artifact link to the same run.** Deliberate — the column is
   the ownership and retention anchor and matches `ArtifactMetadata`, while links carry roles — but
   worth confirming before Task 5 writes both.
5. **Who assigns artifact sensitivity and retention?** The columns exist; the policy that populates
   them does not, and it interacts with the future artifact authorization design.
6. **Multi-tenancy seam.** No tenant column exists on any table. Adding one later touches every
   table and every repository query; the decision of when is still open.
7. **Run cancellation has no caller.** `runs.cancel` exists and is untested by a real workflow
   because Phase 1 has no way to cancel a run.

## Exact prerequisites for Task 5 (local artifact storage)

Task 5 builds the artifact storage interface and its local filesystem adapter. Everything below is
already in place on `6718625`.

### Available from `@orbit/db`

```ts
import { createDatabase, createRepositories, withTransaction } from '@orbit/db';

// Metadata is written only after bytes exist.
artifacts.create(input: CreateArtifactInput): Promise<ArtifactMetadata>
artifacts.createWithLinks(input, links: readonly ArtifactLinkSpec[]): Promise<{ artifact, links }>
artifacts.link(input: CreateArtifactLinkInput): Promise<ArtifactLink>
artifacts.findById / listByRun / listByStep
artifacts.listLinksForRun / listLinksForStep / listLinksForEvent / listLinksForArtifact
```

`CreateArtifactInput` requires `runId`, `kind`, `contentType`, `storageKey`, `sizeBytes`, `sha256`;
optional `runStepId`, `sensitivity`, `redactionVersion`, `retentionExpiresAt`, `id`.

### Contracts the storage adapter must satisfy

| Field | Constraint enforced by the database |
|---|---|
| `storageKey` | `NOT NULL`, non-empty, **globally unique** |
| `sizeBytes` | `>= 0` (`bigint`, JS number mode) |
| `sha256` | lowercase hex, exactly 64 characters (`^[a-f0-9]{64}$`) |
| `kind` | one of `browser_screenshot`, `dom_snapshot`, `browser_trace`, `extracted_json`, `error_context` |
| `sensitivity` | one of `internal` (default), `sensitive`, `restricted` |
| link `role` | one of `screenshot_after_action`, `dom_snapshot`, `browser_trace`, `error_context`, `extracted_json` |
| link target | exactly one of run, run step, run event — all FK-checked |

### Required write ordering

1. Derive the storage key.
2. Write the bytes through the storage adapter.
3. Compute size and sha-256 from what was actually written.
4. Insert metadata via `artifacts.create` / `createWithLinks`.

`storage_key` is `NOT NULL` specifically to make step 4 impossible before step 2. Do not create a
metadata row for bytes that do not yet exist.

### Environment and repository facts

- `ARTIFACT_STORAGE_DIR=./data/artifacts` already exists in `.env.example` and `.env`.
- `/data/` is gitignored at the repository root (`.gitignore:18`), and `/data` is
  prettier-ignored.
- `packages/artifacts` is still a Task 1 scaffold exporting only `PACKAGE_NAME`; it depends on
  `@orbit/contracts` and must **not** depend on `@orbit/db`. Composition of storage and metadata
  belongs to the caller (the runtime, Task 6), not to either package.
- An artifact requires an existing run (`run_id` is `NOT NULL` with an FK), so Task 5 integration
  tests need a seeded Agent Version and a run. Use
  `packages/db/src/testing/factories.ts` (`seedTestAgentVersion`, `createTestRun`) and
  `packages/db/src/testing/harness.ts` (`useTestDatabase`).
- Name database integration tests `*.db.test.ts` so `vitest.db.config.ts` collects them and
  `pnpm test` does not.

### Prerequisites Task 5 must supply itself

- The `ArtifactStorage` interface (`put`, `get`, `delete`, key derivation) in `packages/artifacts`,
  with the local filesystem adapter behind it, so an S3/MinIO adapter can replace it without
  changing runtime or evidence contracts (ADR-010).
- A storage-key scheme. The evidence contract suggests
  `runs/<runId>/steps/<agentStepId>/<name>` and the database only requires global uniqueness.
- Path-traversal defense: keys are opaque and derived, never caller-supplied paths.
- Its own handling of a storage write that fails — it must surface as
  `ARTIFACT_STORAGE_ERROR`, never be swallowed.
