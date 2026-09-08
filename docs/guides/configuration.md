# Configuration

Everything Orbit reads from its environment, what it defaults to, and what is
deliberately not configurable.

[`.env.example`](../../.env.example) is the reference copy, with the reasoning
inline. This page is the same ground organised for lookup, plus the port map.

`cp .env.example .env` gives a working local deployment with nothing
uncommented — and `pnpm bootstrap` does the copy for you, **only** when no `.env`
exists. It never overwrites one, because a `.env` can hold a real API key.
`.env` is gitignored.

Nothing in Orbit's tooling prints an environment value. `pnpm bootstrap` and
`pnpm db:check` report variable names, database names and verdicts, and never
the values behind them: a connection URL carries a password, and a setup script
that echoed one would put it in a terminal and, from CI, in a log.

---

## Ports

| Port | Bound by | Configurable |
|---|---|---|
| 3000 | Watchtower | `WEB_PORT` |
| 3001 | Demo service-request portal | `DEMO_PORTAL_PORT` |
| 3002 | API | `API_PORT`, `API_HOST` |
| 3020 | Demo library portal | **No.** Hard-coded in `apps/library-portal/vite.config.ts` |
| 3010 | Watchtower, end-to-end stack | **Reserved.** No application may bind it |
| 3102 | API, end-to-end stack | **Reserved.** Same rule |
| 5432 | PostgreSQL | Through `DATABASE_URL` (55432 for the optional Docker container) |

Watchtower, the demo portal and the library portal all bind with `strictPort`, so
a taken port is a loud failure rather than a silent move to another one.

The two reserved ports are how the end-to-end suite avoids colliding with a
development session: it runs its own API and its own Watchtower against
`orbit_test` and a disposable artifact root, never against `data/artifacts`.

`pnpm check:teardown` probes 3000, 3001, 3002, 3010 and 3102. It does **not**
probe 3020.

## Process

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | Standard Node environment |
| `LOG_LEVEL` | `info` | Pino log level |

## Database

The connection URLs are the only database settings. Drizzle config, migrations,
repositories, integration tests and seed scripts read these and nothing else —
there are deliberately no separate host/port/user/password parts that could drift
out of sync.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgresql://orbit_dev:orbit_local_dev@localhost:5432/orbit_dev` | Development and migrations |
| `TEST_DATABASE_URL` | the same, against `orbit_test` | `pnpm test:db` only |

`pnpm db:check` reports what these actually reach, read-only: the connected
database name, the PostgreSQL version, and which committed migrations have been
applied. `pnpm db:check --test` does the same for `TEST_DATABASE_URL`. Neither
writes anything; `pnpm db:migrate` remains the only command that changes schema.

`TEST_DATABASE_URL` is truncated between tests. The harness requires it, refuses
to fall back to `DATABASE_URL`, and aborts unless the live connection answers
`orbit_test` to `select current_database()` — checked immediately before every
truncate.

## Artifacts

| Variable | Default | Meaning |
|---|---|---|
| `ARTIFACT_STORAGE_DIR` | `./data/artifacts` | Where artifact bytes are written, resolved against the repository root |

Gitignored. Metadata and links live in PostgreSQL; bytes never do. The directory
is never statically served — evidence leaves Orbit only through the run-scoped
artifact route.

## Web

| Variable | Default | Meaning |
|---|---|---|
| `ORBIT_API_URL` | `http://127.0.0.1:3002` | Where the Watchtower dev server proxies `/v1` |

Watchtower calls the API on its own origin and the dev server proxies, so the API
needs no CORS configuration and no API host is baked into the bundle. Set this
when the API is elsewhere.

## Model provider

One choice, for every model call Orbit makes: drafting an SOP from free text,
judging a decision at run time, and advising while somebody records. All three
resolve through `@orbit/model-provider`, so these variables move all of them or
none (ADR-034).

Two separate questions, deliberately not one variable:

| Variable | Values | Default | Meaning |
|---|---|---|---|
| `LLM_PROVIDER` | `anthropic`, `gemini` | `anthropic` | Which model family |
| `LLM_INVOCATION` | `direct`, `bedrock` | `direct` | How it is reached |

That split is what lets the same build run against an API key on a laptop and
through Bedrock once deployed, with no code change.

| Variable | For | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | family `anthropic`, invocation `direct` | **A real credential** |
| `ANTHROPIC_MODEL` | family `anthropic` | Model id |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | family `gemini` | **A real credential** |
| `GEMINI_MODEL` | family `gemini` | Model id |
| `ORBIT_BEDROCK_REGION` / `AWS_REGION` | invocation `bedrock` | AWS region |

**A provider is entirely optional.** With none configured the API still starts and
every other route works: `POST /v1/sop-drafts` reports that generation is
unavailable and names the missing variable, no judge is wired (a judged agent
halts with `DECISION_JUDGE_UNAVAILABLE`), and the recorder offers no suggestions.

Two things do stop the process on purpose: an unrecognised `LLM_PROVIDER` or
`LLM_INVOCATION`, and the combination `LLM_PROVIDER=gemini` with
`LLM_INVOCATION=bedrock`. Bedrock does not serve Gemini, so that configuration
cannot be satisfied by anything, and startup is where an impossible environment
should be reported rather than the first request of the day.

**Superseded names.** `ORBIT_LLM_PROVIDER` and `ORBIT_LLM_MODEL` still work and
mean what they always meant — `ORBIT_LLM_PROVIDER=bedrock` sets
`LLM_PROVIDER=anthropic` with `LLM_INVOCATION=bedrock`, because the old variable
held both axes at once. Both log a deprecation notice once at startup and lose to
the new names when both are set. `ORBIT_LLM_MODEL` is ignored, with a notice, if
it holds a model id from a different family than the one selected.

> The Gemini and Bedrock paths are structurally complete and unit-tested, but
> have not been exercised against a real service (ADR-034).

## Token ceilings

Total tokens — input plus output — allowed in each scope. Every scope is checked
**before** a call is made, and the most restrictive one that would be exceeded is
the one reported. Spend is summed from the `model_usage` ledger, one row per
provider call (ADR-029).

All ceilings default to *set* rather than to unlimited. Removing one is spelled
`unlimited`, deliberately — a blank or a zero is something you type by accident.
Anything else unparseable stops the API from starting rather than falling back.

### Drafting

| Variable | Default | Scope |
|---|---|---|
| `ORBIT_LLM_TOKEN_BUDGET_GLOBAL` | `5000000` | Every call in this deployment |
| `ORBIT_LLM_TOKEN_BUDGET_PER_AGENT` | `500000` | Every call for one SOP document |
| `ORBIT_LLM_TOKEN_BUDGET_PER_RUN` | `100000` | One Generate request: the initial call plus its one repair |

At drafting time neither an agent nor a run exists yet, so the scopes map onto
what is real then: a document is 1:1 with the agent it will become, so before
publication the two are the same thing.

### Judged decisions at run time

| Variable | Default | Scope |
|---|---|---|
| `ORBIT_LLM_TOKEN_BUDGET_PER_AGENT_RUNTIME` | `1000000` | Every judged decision for one agent, across its versions |
| `ORBIT_LLM_TOKEN_BUDGET_PER_RUN_EXECUTION` | `50000` | Every judged decision within one run |

These draw on the same `ORBIT_LLM_TOKEN_BUDGET_GLOBAL` pot as drafting. They are
separate variables because a decision runs on every execution and drafting runs
once, so the two want different cost profiles.

Only the three scopes an execution is in a position to measure are declared. A
ceiling nobody can measure is refused rather than waved through.

### Cost estimates

| Variable | Meaning |
|---|---|
| `ORBIT_LLM_RATES_USD_PER_MTOK` | Per-model rates as `model=input:output` pairs |

Nothing fetches a price list. The figure is an estimate computed from these
numbers and is labelled as one everywhere it is shown. Models not listed here or
in the built-in defaults are costed at a conservative fallback rather than at
zero.

## Judged decisions

| Variable | Default | Meaning |
|---|---|---|
| `ORBIT_LLM_DECISION_MODEL` | the family's model variable, then the family default | The model a judged decision uses |
| `ORBIT_LLM_DECISION_CONFIDENCE_MIN` | `0.8` | The bar an answer must clear when a step declares none |

`ORBIT_LLM_DECISION_CONFIDENCE_MIN` takes a number from 0 to 1. A **missing**
confidence fails closed. Anything unparseable, or outside 0–1, stops the process
rather than falling back — booting with a threshold somebody meant to set and
mistyped is the one case that must not be allowed, because it would silently
lower the bar on every judged decision in the deployment.

A judged decision returns an index into a closed list of branches the workflow
already declares. It cannot invent a branch, and an agent only reaches one if its
published version declares `permissions.model` (ADR-032).

## Browser windows

Two different browsers, two variables, **opposite defaults**, because they are
used for opposite things.

| Variable | Default | Browser |
|---|---|---|
| `ORBIT_BROWSER_HEADED` | unset — headless | The automation browser, executing an agent |
| `ORBIT_RECORDER_HEADLESS` | unset — headed | The recording browser, driven by a person |

Set either to the string `true` to flip it.

The automation browser is headless because nobody is watching a run; set
`ORBIT_BROWSER_HEADED=true` to watch one, which is useful for diagnosing a step
that behaves differently than it did when recorded. `pnpm agent:run --headed`
does the same for a single CLI run.

The recording browser is headed because a recording is somebody doing a task, and
there is nothing to record if they cannot see the page. Set
`ORBIT_RECORDER_HEADLESS=true` only for automated tests that drive it
programmatically.

**The recording browser opens on the machine running the API**, not the machine
running your web browser. Pointed at a remote API from a laptop, no window
appears on the laptop.

## Actor identity

| Variable | Default | Meaning |
|---|---|---|
| `ORBIT_ACTOR_ID` | `dev-user` | The actor recorded on a run started from the browser-worker CLI |

There is no authentication, no user table and no session anywhere in this build.
This is the whole of Orbit's notion of who did something.

## What is not configurable, and why

**Nothing on this page is editable from Watchtower.** Provider selection and every
ceiling are resolved once at process start. That is a decision rather than a gap:
a cap a client could raise for itself is not a cap. Watchtower *displays* spend
against the ceilings in force; it cannot change them.

Two settings are per document rather than per deployment, and belong to the
document instead of the environment:

| Setting | Where |
|---|---|
| The recovery grant | `POST /v1/sop-documents/{documentId}/recovery` with `{"enabled": true}`. **No UI control exists for it in this build** |
| Per-agent spend before publication | `GET /v1/model-usage?documentId=…` (ADR-029) |

And three are compiled into a published Agent Version and immutable thereafter
(ADR-005): `permissions.browser.allowedDomains`, `permissions.model`, and
`permissions.recovery`. Withdrawing a document's recovery grant affects *future*
versions only. It cannot retract the capability from a version already published,
because a published version that no longer said what it does would be worse than
the grant.

**There are no user preferences**, because there are no users.
