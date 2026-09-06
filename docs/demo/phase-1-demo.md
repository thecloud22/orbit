# Orbit Phase 1 Demo Guide

**Status:** Active Phase 1 demonstration procedure

**Purpose:** Run the complete Phase 1 loop on a clean checkout and see the evidence it produces.

This is a **local development demonstration**. Orbit Phase 1 is not production software: it has no
authentication, no queue, no multi-tenancy, and it automates one controlled local portal. See
*Limitations* at the end.

## 1. Set up a clean checkout

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm --filter @orbit/demo-portal exec playwright install chromium   # once per machine
```

`pnpm db:seed` is idempotent. It refuses to overwrite a published Agent Version whose fixture has
changed — publishing a change means bumping the version.

## 2. Start the local stack

```bash
pnpm dev
```

| Service | Address |
|---|---|
| **Watchtower** | **http://localhost:3000** |
| API | http://localhost:3002 |
| Demo portal | http://localhost:3001/requests |

Watchtower is where the demo happens. The other two are shown so you can see what it talks to.

## 3. Successful run — `SR-1001`

1. Open **http://localhost:3000**.
2. The page shows **Find Service Request 0.1.0**, with the input field generated from that Agent
   Version's own declared input schema.
3. Enter `SR-1001` and press **Start run**.

The page polls until the run reaches a terminal state, then shows:

| Where | What you should see |
|---|---|
| Status | **Succeeded — request found** (green) |
| Business outcome | `request_found` |
| Steps completed | `7 of 7` |
| Output | Request number `SR-1001`, Request status `In Progress`, Assigned team `Infrastructure Operations` |
| Steps | 7 rows, `open_request_portal` → `complete_found`, each `succeeded` |
| Events | 31 rows, `run.queued` first and `run.completed` last, numbered in order |
| Evidence | 4 screenshots, 3 HTML snapshots, 1 Playwright trace |

### Seeing the evidence

- **Screenshot** — press **Show screenshot** on any screenshot row. Watchtower fetches it through
  the controlled API route and renders it in place.
- **HTML snapshot** — press **Download html snapshot**. It downloads rather than opening inline,
  deliberately: it is a captured copy of another page and is never rendered inside Watchtower or on
  the API's origin.
- **Playwright trace** — press **Download playwright trace**, then open it at
  [trace.playwright.dev](https://trace.playwright.dev/) or with
  `pnpm --filter @orbit/demo-portal exec playwright show-trace <file>`.

Evidence is addressed only by run id and artifact id. No storage key or filesystem path appears in
any API response or anywhere in the Watchtower UI.

## 4. Business not-found — `SR-9999`

Enter `SR-9999` and press **Start run**.

| Where | What you should see |
|---|---|
| Status | **Succeeded — request not found** (amber) |
| Detail | States explicitly that this is a business outcome, not a failure |
| Business outcome | `request_not_found` |
| Steps | 5 rows, ending at `complete_not_found` — no verify or extract step ran |
| Error | None. There is no technical error panel |

This is the distinction Orbit exists to make: the agent ran correctly and established that the
record does not exist. Technical status and business outcome are separate (ADR-006).

## 5. Controlled technical failure

The failure is caused by a **test-only Agent Version** whose extraction locator names a test id the
portal does not render. The demo portal is never modified — the agent is the broken half of the
pair, which is what makes the failure reproducible.

That version is published automatically into `orbit_test` by the end-to-end suite. To see the
failure path with its evidence:

```bash
pnpm test:e2e:watchtower
```

The scenario named *shows a controlled technical failure with its typed error and evidence* asserts
the whole thing: run and step `failed`, error code `LOCATOR_NOT_FOUND`, execution stopping at
`extract_request_data` with `complete_found` never reached, and `error_context` evidence plus the
trace still recorded.

### Running the agent by hand

The browser-worker CLI executes the same Agent Version without Watchtower, which is the quickest
way to see a run and its classified result in one place:

```bash
pnpm agent:run -- --request-number SR-1001     # succeeded / request_found, exit 0
pnpm agent:run -- --request-number SR-9999     # succeeded / request_not_found, exit 0
```

It prints one JSON object — run id, terminal status, business outcome, outputs, error, the ordered
steps, and every artifact with its kind, role, size, digest and storage key — and exits non-zero
unless the run succeeded.

Two refusals are worth seeing, and neither creates a run:

```bash
# The demo portal is not running: the CLI checks reachability before creating a
# run, and says so rather than failing three steps deep.
pnpm agent:run -- --request-number SR-1001

# A blank input fails the Agent Version's own input declarations.
pnpm agent:run -- --request-number ''
```

Both exit non-zero and leave no run row behind — a request that was never attempted does not belong
in the evidence tables.

## 6. Stopping everything

Press `Ctrl+C` in the terminal running `pnpm dev`. Then confirm nothing survived:

```bash
pnpm check:teardown
```

It fails loudly if any Orbit service process or test port is still held.

## 7. Test database and artifact safety

**Nothing here can touch your development data.**

- `pnpm test:db`, `pnpm test:runtime`, and `pnpm test:e2e:watchtower` use `TEST_DATABASE_URL` only.
  It never falls back to `DATABASE_URL`, must name a database ending in `_test`, must differ from
  the development database, and the live connection is asked `select current_database()`
  immediately before every truncate.
- Test evidence is **never** written to `data/artifacts`. Every suite creates a disposable artifact
  root under the operating system temp directory, and the cleanup helper refuses to remove a
  directory it did not create.
- The end-to-end stack runs its own API on port `3102` and Watchtower on `3010`, pointed at
  `orbit_test`, so it cannot collide with or write into a running `pnpm dev` stack.

## 8. Automated equivalent

Everything above is asserted automatically:

```bash
pnpm verify:phase1
```

This runs type checking, linting, formatting, unit tests, database integration tests, the runtime
browser tests, the Watchtower end-to-end suite, the demo portal suite, and finally the teardown
check. See `docs/tasks/reports/TASK-009-end-to-end-demo-report.md` for the full acceptance record.

## Limitations

Phase 1 is a local proof loop, not a product deployment.

- **No authentication or authorization.** Every request is a fixed development actor, and anyone
  who can reach the API can read any run and its evidence.
- **Runs execute inside the API process.** No queue, worker fleet, scheduler, retry engine, or
  cancellation. Two clients can start two runs at once; the button guard in Watchtower is a UI
  guard, not a server guarantee.
- **No recovery.** A run left `running` by a killed API process stays that way.
- **One agent, one controlled local portal.** No external sites, no credentials, no LLM, no
  selector healing.
- **Evidence is retained forever.** There is no retention, cleanup, or orphan-reconciliation job.
- **Immutability and append-only are enforced in the repository layer**, not by database triggers
  (ADR-014).
