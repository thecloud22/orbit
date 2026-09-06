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
  browser-worker/      # Composition root; `pnpm agent:run` executes one run
  demo-portal/         # Controlled target portal for Phase 1

packages/
  contracts/           # Shared Zod schemas, events, errors, IDs
  agent-ir/            # Typed executable workflow contract
  runtime/             # Executor-neutral workflow runtime and its ports
  executor-playwright/ # Playwright action implementations (the only Playwright dependency)
  artifacts/           # Artifact storage interface and local filesystem adapter
  artifact-service/    # Composes artifact bytes with artifact metadata
  db/                  # Drizzle schema, migrations, repositories
  sop-graph/           # SOP Graph: non-executable business-process representation
  sop-generation/      # Free-text -> proposed SOP Graph (the only LangChain dependency)
  sop-service/         # Composes SOP generation and review with SOP persistence
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

From a clean checkout:

```bash
pnpm install
cp .env.example .env
pnpm db:migrate          # creates the Orbit schema in orbit_dev
pnpm db:seed             # seeds Find Service Request 0.1.0 (idempotent)
pnpm dev                 # starts Watchtower, the API, and the demo portal
```

Then open **Watchtower at http://localhost:3000**, enter `SR-1001`, and press **Start run**.

One-time, for the browser tests and the runtime:

```bash
pnpm --filter @orbit/demo-portal exec playwright install chromium
```

The database itself needs a one-time role and two databases; see
[Local database](#local-database) below.

**[docs/demo/phase-1-demo.md](./docs/demo/phase-1-demo.md) is the full Phase 1 demo guide** —
the successful run, the business not-found result, the controlled technical failure, where to find
every piece of evidence, how to stop everything, and the test-safety rules.

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

## Running an agent

Task 6 executes the seeded Agent Version against the demo portal and records the
evidence. There is one command, and it runs exactly one agent once — no queue,
no scheduler, no background worker (ADR-011).

The demo portal must already be running, the way `pnpm db:migrate` expects a
running PostgreSQL server. The command fails fast with a clear message if it is
not; it never starts or stops the target itself.

```bash
# once per machine
pnpm --filter @orbit/demo-portal exec playwright install chromium

# terminal 1
pnpm --filter @orbit/demo-portal dev

# terminal 2
pnpm agent:run -- --request-number SR-1001   # succeeded / request_found
pnpm agent:run -- --request-number SR-9999   # succeeded / request_not_found
pnpm agent:run -- --request-number SR-1001 --headed
```

| Flag | Meaning |
|---|---|
| `--request-number <value>` | Required. The typed dynamic input. |
| `--agent-version-id <id>` | Defaults to the seeded `agentv_find_service_request_0_1_0`. |
| `--headed` | Runs the browser headed for debugging. Headless is the default; `ORBIT_BROWSER_HEADED=true` does the same. |

The command prints one JSON object — run id, terminal status, business outcome,
outputs, error, the ordered steps, and every artifact with its kind, role, size,
digest, and storage key — and exits non-zero unless the run succeeded.

### Inspecting what a run recorded

```bash
psql "$DATABASE_URL" -c "select id, status, business_outcome, outputs from runs order by queued_at desc limit 5;"
psql "$DATABASE_URL" -c "select sequence, agent_step_id, status from run_steps where run_id = '<runId>' order by sequence;"
psql "$DATABASE_URL" -c "select sequence, event_type, agent_step_id from run_events where run_id = '<runId>' order by sequence;"
psql "$DATABASE_URL" -c "select kind, content_type, size_bytes, storage_key from artifacts where run_id = '<runId>';"
ls -R data/artifacts/runs/<runId>
```

A run's evidence is a screenshot and DOM snapshot after each step that declares
them, a screenshot and DOM snapshot of the final result state, and one Playwright
trace for the whole run. The trace is persisted **before** the run is marked
succeeded: a run is never reported as succeeded without the evidence that proves
it. When a step fails, Orbit captures a best-effort screenshot and DOM snapshot
with the `error_context` role, and a failure to capture them never replaces the
failure that caused them.

## SOP Graph (Phase 2)

`@orbit/sop-graph` is the typed, versioned, **non-executable** description of a
business procedure: ordered steps in a small vocabulary (`navigate`, `fill`,
`click`, `extract`, `decision`, `outcome`, `manual_review`), typed run inputs,
variables produced by extraction, declared outcomes, plus the assumptions,
clarification questions and risks that surround a draft.

It is the artifact a human reviews and edits. **Approving one does nothing but
record that it describes the intended process** — it creates no Agent Version,
starts no run, and touches no browser.

That boundary is enforced four ways rather than asserted once:

1. The package depends only on `@orbit/contracts` and Zod, so it has no route to
   Playwright, the runtime, a database, the filesystem, or the network.
2. ESLint blocks those imports, and `@orbit/agent-ir` too — ADR-002 keeps
   business intent and the executable plan independent.
3. A test statically scans every source file for network and browser symbols.
4. A test replaces global `fetch` with a spy and parses, validates and reorders a
   graph full of URLs. It is never called.

A URL in a graph is an **untrusted draft reference**. It is parsed for shape and
never fetched, probed, or resolved.

See ADR-016 for why the boundary is enforced four times rather than once, and
for the revision and lifecycle model below.

Drafts, revisions and provenance are persisted by `@orbit/db`: a document holds
the original authored text and cannot be rewritten, each revision is an immutable
checksummed graph, and every edit is a new revision — so the revision chain is
the edit history and an approved revision stays exactly as it was approved.
Lifecycle (`draft` → `needs_clarification` → `in_review` → `approved`/`rejected`
→ `superseded`) belongs to the revision; a document's status is derived from its
newest non-superseded revision.

## SOP drafting from free text (Phase 2.2)

`@orbit/sop-generation` turns a plain-language description into a proposed graph,
and `@orbit/sop-service` persists it. Watchtower has a textarea; submitting it
calls `POST /v1/sop-drafts`.

```text
source text
  -> model, bound to sopGraphSchema minus schemaVersion
  -> code adds SOP_GRAPH_SCHEMA_VERSION
  -> parseSopGraphDocument (schema + all 22 graph rules)
  -> invalid? one repair, carrying the real validation issues back to the model
  -> valid?   persist document + first revision in one transaction
```

Model output is untrusted input. It reaches the database only through the
validator built in Phase 2.1, and **nothing is persisted unless it is valid** —
a draft that fails after one repair returns its issues and writes no row.

Three outcomes are kept apart: a draft, a graph that failed validation, and a
provider that could not be reached. The API reports them as `201`, `422` with the
issues in `details`, and `500`.

This task legitimately calls the network — to the configured model provider, from
one file, `packages/sop-generation/src/anthropic-provider.ts`. It never contacts a
URL that appears *inside* a graph: `urlHint` and `systemHint` stay untrusted draft
references, and a test replaces global `fetch` with a spy to prove it.

### Configuration

Set `ANTHROPIC_API_KEY` in `.env` (see `.env.example`). Without it the API still
starts and every other route works; the draft route reports that generation is
unavailable. `ORBIT_LLM_MODEL` overrides the default, `claude-sonnet-5`.

### The deterministic fake provider

Every automated test uses a scripted fake provider and makes no network call. The
end-to-end stack needs an API that generates content without a model, and it gets
one from a **separate test-only entry point**, `apps/api/src/testing/e2e-server.ts`,
which passes the fake to the same `startApi` the shipped entry point calls.

There is deliberately no environment switch in `apps/api/src/index.ts` selecting a
provider — that would be a live path to a test double in a real deployment. Three
guards hold the line: the fake is behind `@orbit/sop-generation/testing` so
production code has no import path to it; a test walks the module graph from
`index.ts` and asserts no module at any depth reaches that subpath; and the
test-only entry point refuses to start against any database but `orbit_test`.

## Reviewing and approving a draft (Phase 2.3)

A generated draft is reviewed at `?documentId=…` in Watchtower: the workflow in
plain language, a structured form editor per step kind, move-up/move-down
reordering, the model's clarification questions, and the review lifecycle.

Nothing here re-implements Phase 2.1. The plain-language summaries come from
`describeStep`, reorder legality from `validateReorder`, the rejection sentence
from `explainReorderFailure`, and the legal lifecycle actions are derived from
`SOP_REVISION_TRANSITIONS` — computed on the server so the UI has no second copy
to drift from.

**An edit never changes the revision being edited.** It creates the next one,
with `provenance.kind: 'edited'`, superseding its parent in the same transaction,
so the revision chain stays the edit history. A reorder is an edit and takes the
same path. An edit that would make the workflow invalid is rejected with the real
validation issues and nothing is written.

Two workflow rules, both recorded in **ADR-017**:

- **Only `draft` and `needs_clarification` revisions can be changed.** A reviewer
  who spots a problem in an `in_review` revision sends it back for clarification
  first, so an approved revision always stays exactly what was approved.
- **Every clarification question must be answered before a revision can be
  reviewed.** The escape hatch is answering — "not applicable" is a recorded,
  attributable judgement — not a bypass flag.

Approval still means only that the graph describes the intended process. It
creates no Agent Version, starts no run, and touches no browser.

Still not built: execution mapping, Agent IR generation, and publishing. Those
are Phase 2.4 and later.

## Watchtower

Watchtower is the Phase 1 trigger and evidence console: start the seeded agent,
watch the run reach a terminal state, and open the evidence it recorded.

```bash
# once per machine
pnpm --filter @orbit/demo-portal exec playwright install chromium

pnpm db:migrate && pnpm db:seed
pnpm dev            # demo portal :3001, API :3002, Watchtower :3000
```

Open `http://localhost:3000`, enter `SR-1001`, and press **Start run**. The page
polls until the run is terminal and then shows the outcome, the extracted output,
the ordered steps and events, and the evidence.

- `SR-1001` → **Succeeded — request found**, with status and assigned team.
- `SR-9999` → **Succeeded — request not found**. That is a business outcome, not
  a failure, and the UI says so.
- A run can be reopened by id: `http://localhost:3000/?runId=run_...`.

Watchtower calls the API on its own origin; the Vite dev server proxies `/v1` to
`http://127.0.0.1:3002`, so the API needs no CORS configuration and no API host is
baked into the bundle. Set `ORBIT_API_URL` to point the proxy elsewhere.

### API routes

| Route | Purpose |
|---|---|
| `GET /v1/agent-versions` | Published versions and their input schemas |
| `POST /v1/agent-versions/:id/runs` | Start a run; `202` with the run id |
| `GET /v1/runs/:runId` | Run detail: status, outcome, inputs, outputs, error, steps, events, artifacts |
| `GET /v1/runs/:runId/events` | Ordered events; `?afterSequence=` for just the new ones |
| `GET /v1/runs/:runId/summary` | Status poll without the timelines |
| `GET /v1/runs/:runId/artifacts/:artifactId` | Controlled evidence bytes |
| `POST /v1/sop-drafts` | Generate a draft SOP Graph from `{ sourceText }`, or a new revision from `{ documentId }`; `201` |
| `GET /v1/sop-documents` | SOP documents with their derived status |
| `GET /v1/sop-documents/:documentId` | The current revision, rendered for review |
| `GET /v1/sop-revisions/:revisionId` | One revision, for history |
| `PATCH /v1/sop-revisions/:id/steps/:stepId` | Edit a step; creates the superseding revision |
| `POST /v1/sop-revisions/:id/reorder` | Move a step; creates the superseding revision |
| `POST /v1/sop-revisions/:id/answers` | Answer a clarification question |
| `POST /v1/sop-revisions/:id/transitions` | Lifecycle action, legal set derived from the transition table |

Every failure is the structured error envelope from `docs/contracts/api.md`.

### Evidence access

`data/artifacts` is never statically served. Evidence leaves Orbit only through
the run-scoped artifact route, which addresses it by two opaque ids, proves the
artifact belongs to that run, reads through the artifact service using the
*persisted* storage key, and verifies the digest before sending a byte. A caller
never supplies a key or a path, and no response ever contains one.

Screenshots are served `inline`; everything else, a DOM snapshot especially, is an
`attachment` with a locked-down `Content-Security-Policy`, so a captured page
cannot execute on the API's origin. Watchtower follows the same rule: it previews
screenshots and offers HTML snapshots and traces as downloads.

### Phase 1 limitations

- **Runs execute inside the API process.** There is no queue, worker fleet, or
  scheduler (ADR-011). A dispatched run launches a browser in that process and
  continues after the response is sent.
- **No server-side duplicate suppression.** Watchtower disables its button while a
  request is in flight, but two clients — or two tabs — can start two runs at
  once, and the API will create two. This is a UI guard, not a server guarantee.
- **No cancellation.** A started run runs to completion.
- **No authentication.** Every request is the fixed development actor, and any
  caller who can reach the API can read any run and its evidence.

## Validation commands

| Command | What it proves | Needs |
|---|---|---|
| `pnpm typecheck` | Types across every workspace | nothing |
| `pnpm lint` | Correctness plus the architecture boundary rules | nothing |
| `pnpm format:check` | Formatting | nothing |
| `pnpm test` | Unit and contract behaviour | nothing but a checkout |
| `pnpm test:db` | Migrations, repositories, ordering, artifact links, API over real persistence | PostgreSQL |
| `pnpm test:runtime` | Agent IR executed by real Chromium against the demo portal | + Chromium |
| `pnpm test:e2e:watchtower` | The whole stack: browser → Watchtower → API → runtime → portal | + the stack |
| `pnpm test:e2e` | The demo portal's own behaviour (Task 2) | + Chromium |
| `pnpm check:teardown` | No Orbit process or test port survived a run | nothing |
| `pnpm verify` | typecheck, lint, format:check, test, test:db | PostgreSQL |
| **`pnpm verify:phase1`** | **Everything above, in order — the Phase 1 acceptance gate** | all of it |

`pnpm test` deliberately requires nothing but a checkout. The other suites are
separate Vitest projects because each needs more: `vitest.db.config.ts` needs a
running PostgreSQL server and truncates tables between tests;
`vitest.runtime.config.ts` additionally needs an installed Chromium and the demo
portal; and `vitest.e2e.config.ts` brings up the whole Watchtower stack.

`pnpm test:runtime` and `pnpm test:e2e:watchtower` are **separate projects on
purpose**: the end-to-end stack runs a long-lived API against `orbit_test`, and
the Task 6 runtime tests truncate that database between their own tests. Sharing
one project would pull the seeded Agent Version out from under a live server. Run
them as separate commands, not concurrently.

Each suite starts the servers it needs when nothing is listening and reuses what
is already running, stopping only what it started — and teardown waits until the
port is actually free, not merely until the signal was sent. The end-to-end stack
uses its own ports — API `3102`, Watchtower `3010` — so it never collides with
`pnpm dev`, and points its API at `orbit_test` and a disposable artifact root,
never at `data/artifacts`.

`pnpm verify` stops at `test:db` so it stays runnable without a browser.
`pnpm verify:phase1` is the full gate and ends with `pnpm check:teardown`, which
fails if any Orbit service process or test port survived the run.

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
