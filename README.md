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
  artifacts/           # Artifact storage interfaces and adapters
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
| Docker + Compose | v2 | Only required for PostgreSQL. |
| Git | any recent | |

## Local setup

```bash
cp .env.example .env
pnpm install
docker compose up -d     # starts PostgreSQL on host port 55432
pnpm db:migrate          # placeholder until Task 4
pnpm dev                 # runs all apps in parallel
```

Local services:

| Service | Local address | Purpose |
|---|---|---|
| Watchtower web app | `http://localhost:3000` | Trigger and inspect runs |
| API | `http://localhost:3002` | Agent/run/evidence API |
| Demo portal | `http://localhost:3001/requests` | Controlled service-request target |
| PostgreSQL | `localhost:55432` | Metadata, run state, events |

> **Why port 55432?** PostgreSQL's default 5432 is frequently already taken by a
> host-installed PostgreSQL (for example a Homebrew service). Orbit's containerised
> database publishes on `55432` so it can run alongside one without conflict.
> Change `POSTGRES_PORT` in `.env` if you prefer a different port.

## Validation commands

```bash
pnpm typecheck      # tsc --noEmit across every workspace
pnpm lint           # ESLint, including architecture boundary rules
pnpm format:check   # Prettier
pnpm test           # Vitest
pnpm verify         # all of the above in one command
```

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

**`docker compose up -d` fails to connect to the daemon**

```bash
open -a Docker                    # start Docker Desktop, then wait for it to report Running
docker context use desktop-linux  # Docker Desktop's socket, if the active context is 'default'
docker compose up -d
docker compose ps                 # postgres should report (healthy)
```

Validate the Compose file without a running daemon:

```bash
docker compose config
```

**Port 55432 already in use** — change `POSTGRES_PORT` in `.env`; Compose reads it.

**`ERR_PNPM_IGNORED_BUILDS: esbuild`** — esbuild's postinstall is allow-listed in
`pnpm-workspace.yaml`. If pnpm still blocks it, run `pnpm approve-builds --all`.

**Reset the database volume** (destroys all local data):

```bash
docker compose down -v && docker compose up -d
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
