# Orbit

Orbit turns business SOPs into governed, executable, observable agents.

Orbit preserves business process intent, executes approved workflows deterministically, and records evidence for every material action.

```text
Natural-language SOP
  -> SOP Graph
  -> Agent IR
  -> Controlled execution
  -> Events and artifacts
  -> Watchtower evidence
```

## Current status

Orbit is currently implementing **Phase 1: Deterministic Proof Loop**.

The initial vertical slice is intentionally narrow:

```text
Watchtower manual trigger
  -> Service request number input
  -> Immutable Agent Version
  -> Deterministic Playwright execution
  -> Screenshots, DOM snapshots, and trace
  -> Watchtower evidence view
```

## Initial demo workflow

### Find Service Request

1. Open the service request portal.
2. Search for the service request using its request number and confirm that the matching request and current status are displayed.

Example input:

```text
SR-1001
```

Expected output:

```text
Request status: In Progress
Assigned team: Infrastructure Operations
Business outcome: request_found
```

An unknown request such as `SR-9999` should complete with the valid business outcome `request_not_found`, not a technical failure.

## Repository layout

```text
apps/
  web/                 # Orbit Watchtower React application
  api/                 # Orbit Fastify API
  browser-worker/      # Runtime interpreter and Playwright worker
  demo-portal/         # Controlled target portal for Phase 1

packages/
  contracts/           # Shared Zod schemas, events, errors, IDs
  agent-ir/            # Typed executable workflow contract
  runtime/             # Executor-neutral workflow runtime
  executor-playwright/ # Playwright action implementations
  artifacts/           # Artifact storage interface and local filesystem adapter
  artifact-service/    # Composes artifact bytes with artifact metadata
  db/                  # Drizzle schema, migrations, repositories
  sop-graph/           # (not created yet) Business-process representation
  policy/              # (not created yet) Domain/action allowlist checks

docs/
  product/             # Product requirements, roadmap, production vision
  architecture/        # Architecture decisions and diagrams
  contracts/           # Contract documentation
  sop/                 # SOP fixtures and examples
  tasks/               # Approved task plans and delivery notes

fixtures/              # Agent IR, input, and test fixtures
```

## Prerequisites

| Tool | Required | Notes |
|---|---|---|
| Node.js | `>=24` | 24.x is Active LTS. Verified on 26.8.1. |
| pnpm | `>=11` | Pinned to `pnpm@11.25.0` via `packageManager`; `corepack enable` reproduces it. |
| PostgreSQL | 16+ | A local server. Verified on Homebrew PostgreSQL 18.6. |
| Git | any recent | |

Docker is **not** required. `docker-compose.yml` is kept as an optional
alternative to a local server, but no check depends on it.

## Local setup

```bash
cp .env.example .env
pnpm install
pnpm db:migrate          # creates the Orbit schema in orbit_dev
pnpm db:seed             # seeds Find Service Request 0.1.0 (idempotent)
pnpm dev                 # runs all apps in parallel
```

Local services:

| Service | Local address | Purpose |
|---|---|---|
| Watchtower web app | `http://localhost:3000` | Trigger and inspect runs |
| API | `http://localhost:3002` | Agent/run/evidence API |
| Demo portal | `http://localhost:3001/requests` | Controlled service-request target |
| PostgreSQL | `localhost:5432` | Metadata, run state, events |

## Local database

Orbit uses a dedicated role and two databases on the PostgreSQL server already
running on your machine. **The connection URLs are the only database settings** —
Drizzle config, migrations, repositories, integration tests, and seed scripts
all read them and nothing else.

| Variable | Database | Used by |
|---|---|---|
| `DATABASE_URL` | `orbit_dev` | Development, `pnpm db:migrate`, `pnpm db:seed` |
| `TEST_DATABASE_URL` | `orbit_test` | `pnpm test:db` only — **its tables are truncated between tests** |

```
postgresql://orbit_dev:orbit_local_dev@localhost:5432/orbit_dev
postgresql://orbit_dev:orbit_local_dev@localhost:5432/orbit_test
```

### One-time setup

Run against your server as a superuser (on Homebrew installs your own account
usually is one):

```bash
psql -d postgres -c "CREATE ROLE orbit_dev LOGIN PASSWORD 'orbit_local_dev';"
psql -d postgres -c "CREATE DATABASE orbit_dev OWNER orbit_dev;"
psql -d postgres -c "CREATE DATABASE orbit_test OWNER orbit_dev;"
```

Verify the connection and that the role can create tables:

```bash
psql "$DATABASE_URL" -c "select current_user, current_database();"
```

Orbit only ever creates objects inside `orbit_dev` and `orbit_test`. It does not
read, modify, or depend on any other database or on server configuration.

### Schema and seed

```bash
pnpm db:generate   # regenerate migration SQL after changing packages/db/src/schema
pnpm db:migrate    # apply committed migrations to DATABASE_URL
pnpm db:seed       # seed Find Service Request 0.1.0 from the fixture
```

Migrations are committed SQL files under `packages/db/drizzle`, generated by
Drizzle Kit and applied by `pnpm db:migrate`. `drizzle-kit push` is deliberately
not used: a schema that can drift without a versioned migration cannot be
reproduced elsewhere.

`pnpm db:seed` validates `fixtures/find-service-request.agent.yaml` through
`@orbit/agent-ir` before writing, and is idempotent. Re-seeding an unchanged
fixture does nothing; re-seeding a *changed* fixture under the same version
number fails, because published Agent Versions are immutable (ADR-005). To
publish a change, bump the version.

### Test database safety

`pnpm test:db` truncates every Orbit table in `TEST_DATABASE_URL` between tests,
so it refuses to run unless all of the following hold:

- `TEST_DATABASE_URL` is set. It never falls back to `DATABASE_URL`.
- Its database name ends in `_test`.
- It names a different database from `DATABASE_URL`.
- The live connection answers `orbit_test` to `select current_database()`,
  checked immediately before every truncate.

The reset truncates an explicit list of Orbit-owned tables. It never drops a
schema, a table, or a database, and never touches `orbit_dev`.

### Reset

Drop and recreate an Orbit database, leaving the role and the rest of the server
untouched:

```bash
psql -d postgres -c "DROP DATABASE IF EXISTS orbit_dev;"
psql -d postgres -c "CREATE DATABASE orbit_dev OWNER orbit_dev;"
pnpm db:migrate && pnpm db:seed
```

### Optional: Docker instead of a local server

`docker-compose.yml` runs PostgreSQL in a container on host port `55432`. It is
entirely optional and no check depends on it. To use it, start the container and
point `DATABASE_URL` at it:

```bash
docker compose up -d
# DATABASE_URL=postgresql://orbit:orbit_local_dev@localhost:55432/orbit
```

## Artifact storage

Evidence bytes — screenshots, DOM snapshots, and Playwright traces — are stored on
the local filesystem; PostgreSQL holds only metadata and links (ADR-004, ADR-010).

`ARTIFACT_STORAGE_DIR` is the only setting, with no default: an unset value is an
error rather than a silent fallback. Local development writes under the gitignored
`data/artifacts/`.

```
data/artifacts/
  runs/<runId>/<artifactId>.zip                              # run-scoped
  runs/<runId>/steps/<runStepId>/<artifactId>.png            # step-scoped
```

Storage keys are generated by Orbit, never supplied by a caller, and never built
from an original filename. They follow one restrictive grammar and are rejected
rather than normalized when they do not fit; see ADR-015 for the grammar, the
containment model, and what the atomic-write guarantee does and does not cover.

Writes publish atomically and never overwrite: a completed artifact's bytes cannot
be replaced. If the byte write succeeds but persisting metadata then fails, the
database transaction rolls back and the bytes stay on disk as an inert orphan —
deliberately, since nothing references them and cleanup workers are out of Phase 1
scope.

Artifact storage tests never touch `ARTIFACT_STORAGE_DIR`. They create disposable
roots under the operating system temp directory, and the cleanup helper refuses to
remove any directory it did not create itself.

## Validation commands

```bash
pnpm typecheck      # tsc --noEmit across every workspace
pnpm lint           # ESLint, including architecture boundary rules
pnpm format:check   # Prettier
pnpm test           # Vitest unit tests; needs no database
pnpm test:db        # Vitest database integration tests against TEST_DATABASE_URL
pnpm verify         # all of the above in one command
```

`pnpm test` deliberately requires nothing but a checkout. The database
integration suite is a separate project (`vitest.db.config.ts`) because it needs
a running PostgreSQL server and truncates tables between tests.

### Browser tests

The demo portal has Playwright browser tests. Chromium must be installed once
per machine (the binary lives in `~/Library/Caches/ms-playwright`, outside the repo):

```bash
pnpm --filter @orbit/demo-portal exec playwright install chromium
pnpm test:e2e
```

`pnpm test:e2e` starts the demo portal on port 3001 itself, and reuses an
already-running server if you have one — so it works against `pnpm dev` and
against `pnpm --filter @orbit/demo-portal preview` alike.

## Troubleshooting

**`psql: could not connect to server`** — the local PostgreSQL server is not
running. On a Homebrew install:

```bash
brew services start postgresql@18
```

**`password authentication failed for user "orbit_dev"`** — the role is missing
or has a different password. Re-run the one-time setup above, or reset just the
password:

```bash
psql -d postgres -c "ALTER ROLE orbit_dev PASSWORD 'orbit_local_dev';"
```

**`permission denied for schema public`** — the role does not own the database.
Confirm ownership and fix it:

```bash
psql -d postgres -c "ALTER DATABASE orbit_dev OWNER TO orbit_dev;"
```

**`TEST_DATABASE_URL is not set`** — copy it from `.env.example` into `.env`, and
create the database if you have not: `psql -d postgres -c "CREATE DATABASE
orbit_test OWNER orbit_dev;"`.

**`Refusing to modify database "..."`** — a safety guard fired because
`TEST_DATABASE_URL` does not point at `orbit_test`. Fix the URL rather than the
guard.

**`ERR_PNPM_IGNORED_BUILDS: esbuild`** — esbuild's postinstall is allow-listed in
`pnpm-workspace.yaml`. If pnpm still blocks it, run `pnpm approve-builds --all`.

**Optional Docker path: daemon not reachable** — only relevant if you chose the
container alternative:

```bash
open -a Docker                    # start Docker Desktop, wait for Running
docker context use desktop-linux  # if the active context is 'default'
docker compose config             # validates the file with no daemon running
```

## Phase 1 scope

Included:

- Watchtower manual trigger.
- One agent: Find Service Request.
- One typed dynamic input: `requestNumber`.
- Deterministic Playwright browser actions.
- PostgreSQL-backed Agent Versions, runs, steps, events, and artifact metadata.
- Local artifact storage for screenshots, DOM snapshots, and traces.
- Controlled business outcomes: `request_found`, `request_not_found`.
- Read-only controlled demo portal.

Not included:

- Document upload, OCR, PDF/DOCX parsing, screenshot extraction.
- Runtime LLM decisions or recovery.
- Studio authoring UI and workflow graph canvas.
- External websites, real credentials, MFA, or CAPTCHA.
- API/webhook/schedule triggers.
- Redis/BullMQ/Temporal, cloud deployment, S3, Kubernetes, or microservices.
- Multi-tenancy, SSO, full RBAC, policy UI, or approval workflow.
- State-changing business actions.

## Documentation

Read these files in order:

1. [`CLAUDE.md`](./CLAUDE.md) — active engineering rules and Phase 1 constraints.
2. `docs/product/orbit-product-vision-and-requirements.md` — active requirements and acceptance criteria.
3. `docs/product/orbit-end-to-end-delivery-phases.md` — product phases and phase gates.
4. `docs/product/orbit-end-to-end-production-vision.md` — long-term product and production architecture.
5. `docs/architecture/decisions.md` — active architecture decisions.
6. `docs/sop/find-service-request.md` — initial natural-language SOP.
7. `fixtures/find-service-request.agent.yaml` — initial Agent IR fixture.

## Contribution workflow

1. Read `CLAUDE.md` and the active phase requirements.
2. Create or select one bounded task.
3. Propose the approach, affected files, tests, and acceptance criteria.
4. Obtain approval for architecture, contract, data model, or security changes.
5. Implement the smallest complete change.
6. Run relevant checks and tests.
7. Update docs if a contract or setup command changed.
8. Commit a working increment.

## Security notice

Phase 1 uses only a local, read-only demo portal. Do not add real credentials, customer data, production targets, secrets, or unrestricted browser access without explicit scope change and security review.
