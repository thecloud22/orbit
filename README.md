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

Phase 1 — the deterministic proof loop — is complete, and Phase 2 sub-phases
2.1 through 2.14 have landed on top of it. The working loop today is:

```text
free text, or a recorded demonstration
  -> SOP Graph revision      (immutable, checksummed, non-executable)
  -> Execution Bindings      (which element each step acts on)
  -> candidate Agent IR      (compiled; refused when not fully understood)
  -> published Agent Version (immutable)
  -> a run in real Chromium
  -> events, artifacts, evidence
  -> Watchtower
```

Phase 1's original slice — a manual trigger, one typed input, a version-pinned
Agent Version, deterministic Playwright execution, and an evidence view — is
still the core, and still runs exactly as it did. What Phase 2 added around it
is four bounded capabilities, each with a stated limit:

| Capability | Bound |
|---|---|
| Drafting an SOP from free text | The model's output is re-parsed through the ordinary graph validator before anything is stored |
| A judged decision at run time | Returns an index into a closed list of branches the workflow already declares; five typed halt reasons (ADR-032) |
| Authoring advice while recording | Suggestion only; a person demonstrates every step |
| Recovery from UI drift | Deterministic, no model; writes a proposal a person must accept and publish (ADR-033) |

**In-app help lives at Watchtower's `Wiki` tab** (`http://localhost:3000/?view=wiki`):
task-oriented guidance on recording, binding, publishing, running, reading
evidence and answering a recovery proposal. This README covers setup and the
repository; the wiki covers using the product.

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
apps/                  # 6
  web/                 # Orbit Watchtower: Home, Studio, Agents, Runs, Wiki, Admin
  api/                 # Orbit Fastify API; also executes runs (ADR-011)
  browser-worker/      # Composition root; `pnpm agent:run` executes one run
  recorder/            # Composition root; `pnpm record:binding`, `record:workflow`
  demo-portal/         # Controlled service-request target portal
  library-portal/      # Controlled branching-workflow target portal

packages/              # 19
  contracts/           # Shared Zod schemas, events, errors, IDs
  agent-ir/            # Typed executable workflow contract
  agent-ir-compiler/   # SOP Graph -> candidate Agent IR; refuses what it cannot resolve
  runtime/             # Executor-neutral workflow runtime and its ports
  executor-playwright/ # Playwright action implementations (the only Playwright dependency)
  artifacts/           # Artifact storage interface and local filesystem adapter
  artifact-service/    # Composes artifact bytes with artifact metadata
  db/                  # Drizzle schema, migrations, repositories
  sop-graph/           # SOP Graph: non-executable business-process representation
  sop-generation/      # Free-text -> proposed SOP Graph
  sop-service/         # Composes SOP generation, review and recording with persistence
  sop-recording/       # Turns a recorded interaction into a SOP Graph + bindings
  execution-mapping/   # Execution Bindings: what a SOP step does on a real page
  execution-recorder/  # Capture engine: the only code Orbit injects into a page
  execution-assist/    # Advisory suggestions while mapping (two need no model)
  drift-recovery/      # Deterministic drift diagnosis and proposal (ADR-033)
  decision-judge/      # A judged decision, bounded to an index (ADR-032)
  model-provider/      # One selection layer: family and invocation (ADR-034)
  model-budget/        # Token ceilings, checked before every call (ADR-029)

docs/                  # Start at docs/README.md
  product/             # Product requirements, roadmap, production vision
  architecture/        # Architecture decisions and system design
  contracts/           # Contract documentation
  guides/              # Practical how-to documentation
  sop/                 # SOP fixtures and examples
  demo/                # Scripted demo walkthroughs
  tasks/               # Approved task plans and delivery notes

fixtures/              # Agent IR, input, and test fixtures
```

There is no `packages/policy`. Domain containment is enforced by the semantic
validator at publish and by the runtime before every navigation, from the
`permissions.browser.allowedDomains` each Agent Version carries (ADR-022).

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

From a clean checkout, after creating the role and the two databases
([Local database](#local-database)):

```bash
pnpm bootstrap           # prerequisites, install, .env, migrate, seed, Chromium, readiness
pnpm dev                 # starts five processes; see the table below
pnpm smoke               # in another shell: executes the seeded agent end to end
```

`pnpm bootstrap` is the sequence below, executed and checked. It is idempotent,
it **never overwrites an existing `.env`**, it never creates or drops a database,
and it never starts `pnpm dev` — five long-lived foreground processes belong to
the person running them. `pnpm bootstrap --check-only` reports readiness without
changing anything, including while the stack is running. `pnpm bootstrap --help`
lists every flag.

By hand, it is this:

```bash
pnpm install
cp .env.example .env
pnpm db:check            # read-only: reachable? schema current?
pnpm db:migrate          # creates the Orbit schema in orbit_dev
pnpm db:seed             # seeds Find Service Request 0.1.0 (idempotent)
pnpm dev                 # starts five processes; see the table below
```

Then open **Watchtower at http://localhost:3000**, go to **Agents**, enter
`SR-1001`, and press **Start run**. The **Wiki** tab explains what to do next.

`pnpm dev` is `pnpm -r --parallel dev` and starts five processes: the API, the
browser worker, the demo portal, the library portal and Watchtower. The browser
worker's `dev` process only logs its identity — there is no queue and no worker
loop (ADR-011); the API executes runs, and one-off execution is `pnpm agent:run`.

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
| Watchtower web app | `http://localhost:3000` | Author, trigger and inspect; in-app Wiki |
| Demo portal | `http://localhost:3001/requests` | Controlled service-request target |
| API | `http://localhost:3002` | Agent/run/evidence API; `GET /health` |
| Library portal | `http://localhost:3020` | Controlled branching-workflow target |
| PostgreSQL | `localhost:5432` | Metadata, run state, events |

Ports **3010** and **3102** are **reserved** for the end-to-end test stack and
are refused to every application, so a test run never collides with `pnpm dev`.
`API_PORT` and `API_HOST` move the API. The three Vite applications pin their
ports with `strictPort: true` and no environment variable moves them — `WEB_PORT`
and `DEMO_PORTAL_PORT` are in `.env.example` for reference but nothing reads
them, so changing 3000, 3001 or 3020 means editing that application's
`vite.config.ts`.

A quick liveness check, once the API is up:

```bash
curl -s http://localhost:3002/health    # {"status":"ok"}
```

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
pnpm db:check      # read-only: connected database, server version, migration level
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

This task legitimately calls the network — to the configured model provider,
from one file and no others, `packages/sop-generation/src/chat-provider.ts`,
which constructs its client through `@orbit/model-provider` (see **Choosing a
model provider** below). It never contacts a
URL that appears *inside* a graph: `urlHint` and `systemHint` stay untrusted draft
references, and a test replaces global `fetch` with a spy to prove it.

### Choosing a model provider (Phase 2.13)

**One choice, for every model call Orbit makes.** Three features call a model —
drafting a graph from free text, judging a decision at run time, and advising
while a person records a workflow — and all three resolve through
`@orbit/model-provider`. These variables move all of them or none of them; there
is no call site left that reads a provider variable of its own. See **ADR-034**.

Two separate questions, deliberately not one variable:

| Variable | Default | What it does |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | Which model **family**: `anthropic` or `gemini`. Anything else **stops the process**. |
| `LLM_INVOCATION` | `direct` | How it is **reached**: `direct` or `bedrock`. Anything else **stops the process**. |
| `ANTHROPIC_API_KEY` | — | Required by `anthropic` + `direct`. A real credential: keep it in `.env`, which is gitignored. |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5`, or `anthropic.claude-haiku-4-5` through Bedrock | The Claude model to use. |
| `GEMINI_API_KEY`, else `GOOGLE_API_KEY` | — | Required by `gemini`. `GOOGLE_API_KEY` is read because the Google client reads it from the environment itself. |
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` | The Gemini model to use. |
| `ORBIT_BEDROCK_REGION`, else `AWS_REGION`, else `AWS_DEFAULT_REGION` | — | Required by `bedrock`. Bedrock is region-scoped. |

Splitting family from invocation is what makes the deployment story work with no
code change: **direct against an API key locally, through Bedrock once
deployed**, same build, same application logic, one environment variable. Nothing
downstream of the selection — not the drafting pipeline, not the judge, not the
assist provider — knows which it got.

**`LLM_PROVIDER=gemini` with `LLM_INVOCATION=bedrock` is refused at startup.**
Bedrock does not serve Google's models, so the combination cannot be satisfied by
anything. The error names the problem and both ways out, rather than surfacing as
an opaque "model not found" on the first request of the day.

**Nothing here is required to boot.** With no credential configured the API still
starts and every other route works: `POST /v1/sop-drafts` reports that generation
is unavailable and names the missing variable, no judge is wired (a judged agent
halts with `DECISION_JUDGE_UNAVAILABLE`), and the recorder simply offers no
suggestions. What *is* refused is a **mistyped** value — a deployment that wrote
`gemni` meant Gemini, and silently serving it Anthropic bills an account it never
chose. Absence is a value; a typo is an error.

**The defaults are the cheapest current model of each family.** Every Orbit call
site is bounded structured extraction behind a strict schema — a proposal
`parseSopGraphDocument` validates, an index the runtime re-validates, an
advisory verdict nothing applies — so what makes the output trustworthy is the
validator, not model size. `gemini-2.5-flash-lite` is Google's cheapest generally
available model that still supports the function calling structured output is
built on; model availability changes faster than this file does, so it is one
variable to override. Both defaults are priced in the rate table, and a test
fails if a default is ever added without a rate.

#### Superseded names

`ORBIT_LLM_PROVIDER` and `ORBIT_LLM_MODEL` still work and still mean what they
meant: `ORBIT_LLM_PROVIDER=bedrock` sets `LLM_PROVIDER=anthropic` with
`LLM_INVOCATION=bedrock`, which is the same behaviour under a name that can now
express it. They log a deprecation notice once at startup, and the new names win
when both are set. Prefer the new names.

#### Amazon Bedrock

`LLM_INVOCATION=bedrock` reaches the same Claude models through
`ChatBedrockConverse`, satisfying every contract identically — including the
token-usage reporting the spend ledger depends on, so all three budget scopes and
the cost estimate behave the same whichever provider is active.

**Orbit holds no AWS credentials and offers no variable for one.** Credentials
resolve through the AWS SDK's default credential provider chain — environment
variables, a shared profile, SSO, an instance role, IRSA — which is the mechanism
everything else in an AWS account already uses. Inventing a scheme beside it
would be a second place a secret could be typed.

Bedrock model ids carry an `anthropic.` prefix, and a cross-region inference
profile carries a geography prefix on top of it (`us.anthropic.claude-haiku-4-5`).
Rates are keyed by that id, so a profile id needs its own
`ORBIT_LLM_RATES_USD_PER_MTOK` entry or it falls to the conservative fallback
rate.

> **What is verified, and what is not.** Gemini and Bedrock are **structurally**
> verified here and **not exercised against a real service**: there are no Google
> or AWS credentials in this repository's environment. Covered by test: the
> selection resolves, the client constructs, a schema binds, the descriptor is
> right, token usage is read from the normalised shape, the rate table prices
> every default, and no package boundary is crossed. **Not** demonstrated: that a
> real Gemini or Bedrock endpoint replies the way this code expects. Treat the
> first real call on either as the test. No test in this repository calls a model
> on any provider, including Anthropic.

### Model spend limits (Phase 2.8)

Every model call is metered and refused **before it is made** once a budget is
spent. Three scopes, all checked before each call, with the most restrictive one
that would be exceeded reported:

| Scope | At drafting time it means | Default | Variable |
|---|---|---|---|
| Global | every call in this deployment | 5,000,000 tokens | `ORBIT_LLM_TOKEN_BUDGET_GLOBAL` |
| Per agent | every call for one SOP **document** | 500,000 tokens | `ORBIT_LLM_TOKEN_BUDGET_PER_AGENT` |
| Per run | one Generate: the attempt plus its one repair | 100,000 tokens | `ORBIT_LLM_TOKEN_BUDGET_PER_RUN` |

"Per agent" is per document because a document is 1:1 with the agent it will
become, so before publication the two are the same thing. Ceilings default to
**set**, not unlimited; removing one is spelled `unlimited`, and anything else
unparseable stops the API from starting rather than falling back.

Spend is summed from `model_usage`, an append-only ledger of one row per
provider *call* — a draft costs one call or two, and the call is the unit that
is billed. `GET /v1/model-usage` reports spend and headroom, and Watchtower's
Generate button reflects it, but the **server** is the gate: an over-budget
Generate is refused with 429 whether or not any UI rendered.

Cost is an **estimate**, computed from rates in `ORBIT_LLM_RATES_USD_PER_MTOK`
(with built-in defaults, including the Bedrock ids for the same models at the
first-party rates — an approximation, since Bedrock is partner-operated and
prices separately). Nothing fetches a price list, and every surface that
shows the figure says it is approximate. See **ADR-029**.

### Judged decisions (Phase 2.9)

A `decision` step is resolved one of two ways, chosen per step at review time.
**Deterministic** is the default and stays it: the branch is bound to an element
a person demonstrated, and picking it costs nothing. **Judged** asks a model to
classify what the page *says* into the branches the workflow already declares —
for the case where the same meaning arrives in different words. See
`docs/demo/judged-decision-demo.md` and **ADR-032**.

**The widest thing a model does at run time is pick a number between 0 and n−1.**
It returns an index into a closed list the runtime already holds. That bound is
kept by the **runtime**, which re-validates the index independently before it
reaches control flow — not by the provider's schema, so it holds identically
whichever family is configured (**ADR-034**). Nothing it
returns becomes a locator, URL, selector, expression or step id, and it is never
shown where an alternative leads. Every failure halts the run with a reason you
can act on: `DECISION_JUDGE_UNAVAILABLE`, `DECISION_JUDGE_FAILED`,
`DECISION_OUT_OF_SET`, `DECISION_LOW_CONFIDENCE`, `DECISION_BUDGET_EXHAUSTED`.
There is no default branch and no retry into a different answer.

| Variable | Default | What it does |
|---|---|---|
| `LLM_PROVIDER`, `LLM_INVOCATION`, and the credential for whichever family is selected | see **Choosing a model provider** | Without a credential **no judge is wired**. Every existing agent runs unchanged; one containing a judged decision halts with `DECISION_JUDGE_UNAVAILABLE`. |
| `ORBIT_LLM_DECISION_MODEL` | the selected family's default | The model that judges, when a deployment wants a different cost profile for decisions than for drafting. |
| `ORBIT_LLM_DECISION_CONFIDENCE_MIN` | `0.8` | The bar an answer must clear when a step declares no `confidenceThreshold` of its own. A missing confidence **fails closed**. |
| `ORBIT_LLM_TOKEN_BUDGET_PER_AGENT_RUNTIME` | 1,000,000 tokens | Judged-decision spend for one agent, summed across all its versions. |
| `ORBIT_LLM_TOKEN_BUDGET_PER_RUN_EXECUTION` | 50,000 tokens | Judged-decision spend within one run. |

`ORBIT_LLM_TOKEN_BUDGET_GLOBAL` is the same deployment-wide pot drafting spends
from, and the ledger is the same `model_usage` table: `run` and `agent` are two
more `SUM` scopes over the same append-only rows, not a second mechanism. A cap
is checked **before** each call, and the per-agent scope joins through to the
agent rather than the version, so republishing does not clear it.

An Agent Version must also declare `permissions.model` — its own section, not a
browser action, because a model call leaves the machine and costs money — with a
`maxCallsPerRun` ceiling the compiler sets from the workflow's judged step count.

**Two runs of the same agent against the same page can now differ.** That is the
real cost, and it is why a judged decision is opt-in per step rather than a
fallback the system reaches for. Page text sent to a model is redacted first, in
the runtime, before it is sent *or* stored — a reduction rather than a
guarantee, stated plainly in ADR-032.

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

## Execution Bindings and the drift check (Phase 2.4a)

An approved SOP Graph says "the field labelled Password". An **Execution
Binding** says which element that turned out to be: an ordered chain of
locators, and a fingerprint of the element as it looked when a human confirmed
it.

Before every real `fill` or `click` that uses a binding, the runtime compares
the live page against that fingerprint. It is deterministic — no model is
consulted — and it **fails safe**: on a mismatch the run stops, captures a
screenshot and a DOM snapshot, and reports what changed. The executor is never
asked to find a substitute element, because choosing a different element than
the one a human approved is the decision no automated part of Orbit may make.

The check is invisible to an agent without bindings, so every Phase 1 run
behaves exactly as it did before.

```text
approved binding ──> describeElement ──> compare ──┬── matches ──> act
                                                    └── differs ──> stop + evidence
```

Locators are a closed vocabulary — `test_id`, `role_and_name`, `label`. CSS and
XPath are not expressible, so a binding cannot carry an arbitrary DOM-walking
expression any more than an Agent IR step can. A chain gives the runtime a
fallback when a page drops one attribute.

The role comes from the accessibility tree, not from a `role` attribute:
measured against the demo portal, every element returned `null` for an explicit
attribute while the computed role was correctly `button`, `textbox` or
`definition`. Text is compared for action targets and deliberately **not** for
read targets, whose text is the value being extracted and changes every run.

See **ADR-018** for the full reasoning, including why `tagName` is absent (it
would require `evaluate`) and why bindings are keyed by step rather than by
revision.

## Recording a binding (Phase 2.4b)

```bash
pnpm record:binding -- --document sopdoc_...
```

A person demonstrates each step once against the sandbox and Orbit records what
they did. The browser opens, they perform the step for real, and the terminal
shows what was captured — the selector chain, the fingerprint, the value source
— before anything is saved.

Recording performs **real actions**, which is why it opens nothing but a local
sandbox: the same `ALLOWED_HOSTS` the runtime enforces, not a second copy of it.

A `manual_review` step is listed but cannot be recorded — it routes to a person,
so there is nothing to automate. Selector candidates are verified at capture
time to resolve to exactly one element and to the right one; a capture with no
uniquely-resolving candidate is refused rather than saved.

**The one script Orbit injects into a page marks an element and reports an
event, and does nothing else.** Roles, names, selectors and verification are all
derived in Node through first-class Playwright APIs. A test asserts that file is
the whole of the injection surface, and the recorder is structurally unreachable
from anything that executes an agent — enforced by lint on `@orbit/runtime`,
`@orbit/executor-playwright`, `apps/api` and `apps/browser-worker`.

**Fingerprint parity is proven, not assumed.** The recorder writes a fingerprint
and 4a's frozen `describeElement` later checks it, so a contract test records a
binding and asserts `compareFingerprint` matches what the runtime observes for
the same element. Without it, a divergence would surface as every binding
drifting on its first real run.

Suggestions are advisory and never applied. Two of them — selector robustness
and coverage — use no model at all, because ranking three known strategies and
computing a set difference are exact questions. See **ADR-019**.

### Seeing which steps are mapped

The SOP Graph review page shows, per step, whether an Execution Binding exists
and how far it got — not recorded, recorded, awaiting review, approved, or
rejected — with the selector chain and fingerprint for approved ones.

**Read-only, and permanently so.** Recording a binding means a person
demonstrating a step in a real browser, which a web page cannot witness, so
creating one and moving it through its lifecycle happen in the recorder CLI and
nowhere else. The endpoint behind the panel names no write method, and a test
runs it against a context where every write throws.

Two things the panel reports separately, because they are different facts:

- **Status and staleness.** An *approved* binding whose step has since been
  edited is still approved and still not safe to run. Staleness is derived at
  read time by comparing the binding's `stepSha256` against the step as it
  reads now — the same check the recorder runs before persisting.
- **Status and history.** `superseded` is never a current status: a binding is
  superseded only when its replacement is written alongside it. Re-recordings
  show as a count instead.

## Recording a whole workflow (Phase 2.4f)

Start one from Watchtower's **Home** page — a title and a starting URL — or from
a terminal:

```bash
pnpm record:workflow -- --title "Find a service request" --start-url http://localhost:3001/requests
```

Perform a task once in a real browser and it becomes a workflow: steps and
their bindings together, because both describe the same interaction. Where
`record:binding` maps one already-known step at a time, this captures a whole
sequence and confirms once at the end — the difference between transcribing a
workflow you wrote down and discovering one by doing it.

What it produces is a **linear draft**. A single recording walks one path, so it
cannot honestly produce a branch nobody took; decisions are added afterwards on
the review page, the same as for any first draft. An `outcome` step is appended
because a recording ends when the person stops, and every path must reach a
terminal.

The result is stored exactly like a free-text-generated document — same tables,
same validation — so it appears in the Studio list and opens in the review
page with nothing there knowing recording exists. Its provenance says
`recorded`, distinctly from `authored` or `generated`.

**Passwords are never read.** A value typed into an `input[type=password]` does
not leave the page: the recorder reports the field without it. The translator
then declares a `secret` input and points the step at it with
`${inputs.password}` — which is what the graph validator requires anyway, since
a sensitive fill holding a literal is rejected. A recorded sign-in therefore
arrives with its secret properly declared rather than with a credential in a
durable artifact.

### Recording from Watchtower (Phase 2.4f-2)

**The browser opens on the machine running Orbit's API.** Someone has to see and
click the page being recorded, so a headed browser needs a display where the API
runs. Pointed at a remote API from a laptop, no window appears on the laptop —
which is why the form says so before a recording starts rather than leaving it to
be discovered.

A session is started, polled and finished over `/v1/recording-sessions`, the same
shape run dispatch uses (ADR-011) and for the same reason: a recording lasts as
long as a person takes. The live page lists what has been recorded so far and
**Finish** compiles it, landing on the review page for the new document.

If the sequence cannot become a valid workflow, **the session stays open** and
says so. The browser still holds the work, which is the one thing in this flow a
person cannot repeat from memory. An idle session is closed after thirty minutes,
and any still open when the API stops go with it.

**Recording may target any `http` or `https` URL**, including a real website. A
recording is a person doing their job in a browser they are driving, so there is
no host list here; other protocols (`file:`, `data:`, `javascript:`) are still
refused before a browser opens. What the resulting *agent* may open on its own is
constrained per agent — see **ADR-022** and the section below.

ADR-019 kept script injection out of every process that executes an agent;
ADR-020 narrows that to one API directory rather than lifting it, and a test
walks the module graph from the run-dispatch path to prove the two stay apart.

## Publishing and running an agent (Phase 2.6)

An approved candidate becomes a runnable **Agent Version**. The review page has a
**Publish** action, and afterwards it links out to the agent — it does not change
what it says about the workflow. The SOP Graph stays non-executable
(**ADR-016**); what became runnable is a separate artifact.

**Publishing mints a version rather than promoting the candidate.** The runtime
executes only `published` documents and the compiler emits `draft`, so the two
cannot be byte-identical — and that difference *is* the approval gate, since a
candidate identical to a runnable version would be runnable before anyone
approved it. Exactly two fields differ, `lifecycle.status` and the allocated
`version`, and a check verifies that against the document actually stored, so a
widened permission or an added step cannot ride along. Both checksums keep
covering what they claim.

Versions are allocated per agent (`0.1.0`, `0.1.1`, …) rather than supplied, and
`agent_versions.published_from_candidate_id` records where a version came from —
nullable, because the seeded Phase 1 agent came from a fixture.

**Running it uses the existing path.** A published agent appears on Home
alongside the seeded one and starts through the same route, the same
`prepareExecution` gate, and the same interpreter. Per-agent containment holds:
the agent may open the hosts its recording visited, matched exactly, and nothing
else (**ADR-022**).

See **ADR-023**.

## Compiling a candidate agent (Phase 2.5)

A reviewed workflow plus its approved mappings compiles into **candidate Agent
IR** — the typed document 2.6 later publishes as a runnable agent. Compilation
is deterministic: no model is involved, because translating a reviewed document
into a typed workflow is an exact operation.

**Compiling and approving now happen from the review page**, alongside Publish.
A workflow's current revision must be **approved** before it can be compiled at
all — a precondition sub-phase 2.5 left out and this task added, since
`findCurrent` returns the newest revision in any state short of superseded, and
compiling a draft or in-review graph would bypass the review lifecycle
(ADR-017) through the one caller positioned to bypass it silently. Compiling
asks a person to map each declared outcome the workflow can reach to a
business result; the agent's own identity is derived from its document rather
than supplied, so recompiling the same workflow after fixing a binding always
lands under the same agent. See **ADR-024**.

**The compiler refuses far more than it accepts, and every refusal names a step
and a reason.** "Why can my workflow not run?" is the whole point of this stage,
so refusals are collected rather than raised one at a time — somebody fixing a
workflow wants the full list, not to rediscover the next problem after each edit.
A workflow is refused when it branches, routes to a person, has an unmapped step,
has a mapping recorded against a step that has since been edited, declares an
outcome nobody mapped to a business result, reads more values than were mapped,
or takes an input type an agent cannot carry.

**Outcomes are mapped explicitly.** A SOP outcome name is business vocabulary;
`request_found` is Agent IR's. The mapping is chosen by a person and stored with
the candidate, so approving a candidate approves that translation too.

**Approval is separate, and fails closed.** Before anything could be checked
against a real page, the candidate is walked for steps needing a `secret` input
Orbit cannot supply. If it needs one, the candidate is recorded as
`cannot_validate` and **no browser is launched at all** — because the alternative
is discovering the problem with a browser already open on a real password field.
A candidate nobody could check cannot be approved; it can still be rejected, though
rejecting has no button yet — recompiling a document already supersedes whatever
candidate existed for it, which is today's actual way past a dead end.

Candidates are derived, never authored: recompiling supersedes its predecessor in
the same transaction, exactly as re-recording supersedes a binding.

**Where an agent may go is decided per agent.** The compiler collects every host
the workflow actually opens into `permissions.browser.allowedDomains`, the
semantic validator checks that when a version is published, and the runtime
re-checks it before every navigation. The match is exact, not a domain suffix, so
an agent recorded on `www.example.gov` cannot wander to `internal.example.gov`
even if a later edit puts that URL in a step.

**The reference escalation-review workflow does not compile yet**, because it
branches. That is the requirements document's own worked example, and a test
pins the refusal rather than leaving it to prose. See **ADR-021**.

## Watchtower

Watchtower has a persistent header with six tabs — **Home**, **Studio**,
**Agents**, **Runs**, **Wiki** and **Admin**. Navigation is query parameters, not
a router (ADR-031) — a run is reopened with `?runId=`, a workflow with
`?documentId=`, Studio is `?view=documents`, and a wiki topic is
`?view=wiki&topic=…`. The view
is derived from the URL on every history event, so a link, a bookmark, a reload
and the back button all agree, and every nav item is a real anchor that opens in
a new tab like any other link.

| Tab | What it holds |
|---|---|
| Home | What Orbit is, the two ways in, and current activity |
| Studio | Every SOP document with its status, step count and revision count; each row opens its review page |
| Agents | Published Agent Versions and their declared inputs |
| Runs | Every run, newest first |
| Wiki | In-app, task-oriented help; static content compiled into the bundle, reaching no endpoint |
| Admin | Read-only platform facts: the model in force, spend against the ceilings, migration level, artifact root, API address. No controls, and no authentication protecting it — see `docs/guides/configuration.md` > Administration |

Studio's URL value stays `documents` (ADR-031): review links were shared before
the navigation existed, and renaming a query parameter to agree with a label
would break them and buy nothing.

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
| `GET /v1/sop-documents` | SOP documents with derived status, step count and revision count |
| `GET /v1/sop-documents/:documentId` | The current revision, rendered for review |
| `GET /v1/sop-revisions/:revisionId` | One revision, for history |
| `PATCH /v1/sop-revisions/:id/steps/:stepId` | Edit a step; creates the superseding revision |
| `POST /v1/sop-revisions/:id/reorder` | Move a step; creates the superseding revision |
| `POST /v1/sop-revisions/:id/answers` | Answer a clarification question |
| `POST /v1/sop-revisions/:id/transitions` | Lifecycle action, legal set derived from the transition table |
| `GET /v1/sop-documents/:documentId/bindings` | Execution Binding status per step; read-only |

That table is the Phase 1 core, not the whole surface. The API currently serves
**44 `/v1` routes plus `/health`** — candidates, publishing, recording, binding
and walkthrough sessions, recovery proposals, model usage and platform facts are
all served and not all listed above. `docs/contracts/api.md` documents the six Phase 1
endpoints and has not yet caught up; treat the route files under
`apps/api/src/routes/` as authoritative until it does.

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

## Configuration

**[`.env.example`](./.env.example) is the configuration reference.** Every
variable Orbit reads is listed there with its default and the reasoning behind
it; `cp .env.example .env` gives you a working local deployment with nothing
uncommented. `.env` is gitignored and must never hold anything you would not
paste into a ticket, apart from the one real credential noted below.

What the sections cover:

| Section | Variables |
|---|---|
| Process | `NODE_ENV`, `LOG_LEVEL` |
| PostgreSQL | `DATABASE_URL`, `TEST_DATABASE_URL` |
| Ports | `API_PORT`, `API_HOST`, `ORBIT_API_URL` (read); `WEB_PORT`, `DEMO_PORTAL_PORT` (reference only, unread) |
| Artifacts | `ARTIFACT_STORAGE_DIR` |
| Model provider | `LLM_PROVIDER`, `LLM_INVOCATION`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GOOGLE_API_KEY`, `ORBIT_BEDROCK_REGION`, `AWS_REGION` |
| Drafting budgets | `ORBIT_LLM_TOKEN_BUDGET_GLOBAL`, `..._PER_AGENT`, `..._PER_RUN`, `ORBIT_LLM_RATES_USD_PER_MTOK` |
| Judged decisions | `ORBIT_LLM_DECISION_MODEL`, `ORBIT_LLM_DECISION_CONFIDENCE_MIN`, `ORBIT_LLM_TOKEN_BUDGET_PER_AGENT_RUNTIME`, `ORBIT_LLM_TOKEN_BUDGET_PER_RUN_EXECUTION` |
| Browser windows | `ORBIT_BROWSER_HEADED`, `ORBIT_RECORDER_HEADLESS` |
| Actor identity | `ORBIT_ACTOR_ID` |

Three things worth knowing before you change anything:

- **`ANTHROPIC_API_KEY` (or `GEMINI_API_KEY`) is a real credential.** It belongs
  in `.env` and nowhere else — never in an SOP, an issue, a commit, a log line,
  or an artifact.
- **A model provider is entirely optional.** With none configured the API still
  starts and every other route works: drafting reports that generation is
  unavailable and names the missing variable, no judge is wired, and the
  recorder offers no suggestions.
- **Nothing here is editable from the UI**, deliberately. Provider selection and
  every token ceiling are resolved once at process start. A ceiling a client
  could raise for itself would not be a ceiling.

`ORBIT_LLM_PROVIDER` and `ORBIT_LLM_MODEL` are the superseded names. They still
work and mean what they always meant — `ORBIT_LLM_PROVIDER=bedrock` sets
`LLM_PROVIDER=anthropic` with `LLM_INVOCATION=bedrock`, since the old variable
held both axes at once — and `ORBIT_LLM_MODEL` sets the family's model variable.
Both log a deprecation notice once at startup and lose to the new names when
both are set. `ORBIT_LLM_MODEL` is ignored, with a notice, when it holds a model
id belonging to a different family than the one selected.

## Validation commands

| Command | What it proves | Needs |
|---|---|---|
| `pnpm typecheck` | Types across every workspace | nothing |
| `pnpm lint` | Correctness plus the architecture boundary rules | nothing |
| `pnpm format:check` | Formatting | nothing |
| `pnpm test` | Unit and contract behaviour | nothing but a checkout |
| `pnpm test:fast` | `test` then `test:db` — everything that needs no browser | PostgreSQL |
| `pnpm test:db` | Migrations, repositories, ordering, artifact links, API over real persistence | PostgreSQL |
| `pnpm test:runtime` | Agent IR executed by real Chromium against the demo portal | + Chromium |
| `pnpm test:e2e:watchtower` | The whole stack: browser → Watchtower → API → runtime → portal | + the stack |
| `pnpm test:e2e` | The demo portal's own behaviour (Task 2) | + Chromium |
| `pnpm test:e2e:library` | The library portal's own behaviour | + Chromium |
| `pnpm smoke` | An *installation* can execute the seeded agent, not merely that it is set up | a migrated, seeded database + Chromium + the demo portal running |
| `pnpm check:teardown` | No leaked suite process, and the reserved test ports 3010/3102 are free | nothing |
| `pnpm verify` | typecheck, lint, format:check, test, test:db | PostgreSQL |
| **`pnpm verify:phase1`** | **`verify`, then test:runtime, test:e2e:watchtower, test:e2e, check:teardown — the Phase 1 acceptance gate** | all of it |

`pnpm test` deliberately requires nothing but a checkout. The other suites are
separate Vitest projects because each needs more: `vitest.db.config.ts` needs a
running PostgreSQL server and truncates tables between tests;
`vitest.runtime.config.ts` additionally needs an installed Chromium and the demo
portal; and `vitest.e2e.config.ts` brings up the whole Watchtower stack.

### Which suite to run, and what it costs

Three tiers, with measured timings on a developer machine. Reach for the
cheapest one that can answer the question you have:

| Tier | Command | Time | Tests | When |
|---|---|---|---|---|
| 1 — iteration | `pnpm test` | ~8s | 1408 | Every change. Needs nothing but a checkout. |
| 2 — browserless | `pnpm test:fast` | ~40s | 1739 | Before a commit. Adds real persistence; still no browser. |
| 3 — full | `pnpm test:runtime`, then `pnpm test:e2e:watchtower` | ~105s + ~40s | 36 + 45 | Before a push, and in `verify:phase1`. Real Chromium and the whole stack. |

Tier 3 is where the time goes, so it is deliberately not part of `pnpm verify`.

### One heavy suite at a time

`pnpm test:db`, `pnpm test:runtime` and `pnpm test:e2e:watchtower` all point at
`orbit_test`, and two of them truncate it between tests. The end-to-end stack
additionally runs a long-lived API against that database, so a suite truncating
it mid-run pulls the seeded Agent Version out from under a live server.

Running two of them at once does **not** fail loudly. It deletes rows out from
under the other suite and surfaces as ordinary-looking assertion failures — 16
of 43 end-to-end failures in one observed session, none of them a real defect.

That is why the rule is now enforced rather than documented: each of the three
claims an exclusive lock at startup, and a second one is refused in about a
second with a message naming the suite that holds it, its pid and how long it
has been running. A lock whose holder is no longer alive (a suite stopped with
Ctrl-C) is reclaimed automatically. `pnpm test` shares nothing with them and is
never blocked. See `packages/runtime/src/testing/suite-lock.ts`.

### Keep the whole failure

`pnpm test:runtime` and `pnpm test:e2e:watchtower` write a full machine-readable
report to `logs/` (gitignored) on every run, so the detail of a failure survives
whatever the terminal did with it:

```bash
node -e "for (const s of require('./logs/test-runtime.json').testResults)
  for (const t of s.assertionResults)
    if (t.status === 'failed') console.log(t.fullName, '\n', t.failureMessages.join('\n'))"
```

When running a long suite in the background, redirect the whole thing to a file
— `pnpm test:runtime > /tmp/runtime.log 2>&1` — and read the file. Piping
through `tail -N` as the *only* capture discards exactly the lines that say
which tests failed and why, and the only way to get them back is to run the
suite again.

Each suite starts the servers it needs when nothing is listening and reuses what
is already running, stopping only what it started — and teardown waits until the
port is actually free, not merely until the signal was sent. The end-to-end stack
uses its own ports — API `3102`, Watchtower `3010` — so it never collides with
`pnpm dev`, and points its API at `orbit_test` and a disposable artifact root,
never at `data/artifacts`.

`pnpm verify` stops at `test:db` so it stays runnable without a browser.
`pnpm verify:phase1` is the full gate and ends with `pnpm check:teardown`.

`pnpm check:teardown` fails on a leak, and is deliberately narrow about what
counts as one. Ports **3010** and **3102** are reserved for the end-to-end stack
and bound by no app in this repository, so an occupant there is a leaked test
run and fails the check by name. The development ports (3000, 3001, 3002, 3020)
are reported and never failed on: they belong to your own `pnpm dev`, which the
suites deliberately *adopt* rather than replace — reusing an already-running
demo portal is why `pnpm test:runtime` takes ~105s instead of starting a second
one. A process the suites started (`pnpm --filter @orbit/<app> …`) or a
Playwright browser still running does fail the check; a dev server does not.

Neither `pnpm smoke` nor `pnpm test:e2e:library` is part of `verify:phase1`; run
them separately. Smoke asks a different question than the suites do — whether
*this installation* can execute a workflow — and it starts nothing itself,
expecting a migrated, seeded database and an already-running demo portal, so it
belongs after an install or an upgrade rather than in the acceptance gate.

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

**A port is already in use** — `pnpm dev` binds 3000, 3001, 3002 and 3020 with
`strictPort`, so it fails loudly rather than drifting to another port. Find what
holds it:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Ports 3010 and 3102 are reserved for the end-to-end stack and no application may
bind them. `pnpm check:teardown` reports any Orbit process or test port that
survived a run; note that it probes 3000, 3001, 3002, 3010 and 3102, and not
3020.

**`pnpm dev` starts five things and I expected three** — the API, the browser
worker, the demo portal, the library portal and Watchtower. The browser worker
only logs its identity; there is no queue and the API executes runs (ADR-011).

**No browser window opened when I started a recording** — it opens on the machine
running the API, not the one running your browser. `ORBIT_RECORDER_HEADLESS=true`
also suppresses it; it defaults to headed for exactly this reason.

**A run stopped and the error mentions drift** — the element a step was bound to
no longer matches the fingerprint a person approved. That is the check working,
not a bug. See [`docs/guides/ui-drift-recovery.md`](./docs/guides/ui-drift-recovery.md),
and [`docs/guides/upgrade.md`](./docs/guides/upgrade.md) for what it means when
upgrading a deployment whose agents were passing before.

**Bound agents that used to pass now fail** — the drift check went live in
sub-phase 2.12. A binding recorded against a page that has since changed now
stops the run instead of acting on whatever it finds. Re-record the step, or
grant the document recovery and answer the proposal.

**Compiling a candidate is refused** — the compiler refuses everything it cannot
fully resolve rather than guessing. The refusal names the cause: commonly an
unbound step, a binding whose step was edited after it was recorded, or a path
that reaches no outcome.

**Generating a draft is refused** — either no model provider is configured (the
response names the missing variable) or a token ceiling was reached. Both are
deployment configuration; see [Configuration](#configuration).

**`DECISION_JUDGE_UNAVAILABLE`** — the agent contains a judged decision but no
model provider is configured, so no judge was wired. It halts with that reason
rather than running the decision unjudged.

**An agent refuses to navigate somewhere** — each Agent Version declares the
domains it may open, and the runtime re-checks before every navigation
(ADR-022). A host that was not in the recording is not in the list. Publish a
new version from a recording that visits it.

## Scope

### Implemented

- Watchtower: Home, Studio, Agents, Runs, an in-app Wiki, and a read-only Admin
  page reporting what the deployment is running with.
- Two ways to author a workflow: recording a demonstration, or drafting from
  free text and correcting the result.
- Immutable, checksummed SOP Graph revisions; review, edit, insert, reorder,
  answer clarifications, approve.
- Execution Bindings per step, demonstrated by a person, with a fingerprint the
  runtime checks before every action.
- Compile to a candidate Agent IR that refuses everything not fully understood;
  approve; publish an immutable Agent Version.
- Deterministic Playwright browser actions, and a run in real Chromium.
- Business outcomes a workflow declares for itself (**ADR-030**) — see below.
- Judged decisions at run time, bounded to an index into a closed branch list
  (**ADR-032**).
- Deterministic recovery from UI drift, by proposal only (**ADR-033**).
- Per-agent domain containment, checked at publish and before every navigation
  (**ADR-022**).
- Token ceilings in three scopes, checked before every model call (**ADR-029**),
  and one selection layer across model families and invocation paths
  (**ADR-034**).
- PostgreSQL-backed Agent Versions, runs, steps, events and artifact metadata;
  local filesystem artifact bytes behind a storage interface.
- Two controlled demo portals: service requests, and a branching library
  workflow.

Three things this section previously listed as *not included* have in fact
shipped, and the correction matters because each one changes what Orbit may do:

| Previously listed as excluded | Actual state |
|---|---|
| Runtime LLM decisions or recovery | Both exist and are bounded. A judged decision returns an index into a closed list (**ADR-032**); drift recovery is deterministic, consults no model, and only ever writes a proposal (**ADR-033**). |
| External websites | The blanket `localhost` allowlist was lifted in sub-phase 2.5 (**ADR-022**). Containment is now per agent, from the domains its Agent Version declares. |
| The fixed outcome pair `request_found` / `request_not_found` | A workflow declares its own outcome names, matching `^[a-z][a-z0-9_]{0,63}$`, with `none` reserved for a run that reached no business conclusion (**ADR-030**). The Phase 1 pair are ordinary names under that rule, not a closed vocabulary. |

### Still not included

- Document upload, OCR, PDF/DOCX parsing, screenshot extraction, video ingestion.
- A workflow graph canvas, or natural-language edits to a published workflow.
- Real credentials, authentication workflows, MFA, CAPTCHA. Nothing behind a
  login is reachable, because Orbit cannot supply a secret.
- State-changing business actions: refunds, payments, messages, account updates,
  deletions, permissions changes.
- API/webhook/schedule/email/file/event-bus triggers.
- Redis, BullMQ, Temporal, S3, MinIO, cloud deployment, Terraform, Kubernetes,
  microservices.
- Authentication, RBAC, multi-tenancy, a policy UI, or an approvals workflow.
- Generic custom code steps, arbitrary JavaScript expressions, `eval`,
  `Function`, or arbitrary shell commands.

**External sites are real systems.** Do not record or automate a workflow that
performs a state-changing action on one, and do not automate a site whose terms
forbid it.

## Documentation

**[`docs/README.md`](./docs/README.md) is the documentation home.** It indexes
everything under `docs/`, says what each document is for, and marks which ones
have fallen behind the code — start there rather than browsing the tree.

The short version:

| If you want to | Read |
|---|---|
| Use the product | Watchtower's **Wiki** tab, or [`docs/guides/`](./docs/guides/) |
| Install it | [Local setup](#local-setup) above, then [`docs/guides/installation.md`](./docs/guides/installation.md) |
| Upgrade an existing checkout | [`docs/guides/upgrade.md`](./docs/guides/upgrade.md) — back up, migrate, restart, and what drift enforcement means for agents that used to pass |
| Configure it | [`.env.example`](./.env.example), then [`docs/guides/configuration.md`](./docs/guides/configuration.md) |
| Understand a drifted run | [`docs/guides/ui-drift-recovery.md`](./docs/guides/ui-drift-recovery.md) |
| Fix something | [Troubleshooting](#troubleshooting) below, then [`docs/guides/troubleshooting.md`](./docs/guides/troubleshooting.md) |
| Understand how it fits together | [`docs/architecture/system-design.md`](./docs/architecture/system-design.md) |
| Change the code | [`CLAUDE.md`](./CLAUDE.md), then [`docs/architecture/system-design.md`](./docs/architecture/system-design.md) |
| Know why something is the way it is | [`docs/architecture/decisions.md`](./docs/architecture/decisions.md) — 37 ADRs, indexed and status-marked |

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
