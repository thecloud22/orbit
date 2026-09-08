# Quick start

From a clean checkout to a completed run with evidence. Assumes the prerequisites
in [installation.md](./installation.md) — Node 24+, pnpm 11+, a local PostgreSQL
server — are already present.

---

## Set up

The role and the two databases are created once, by hand, as a superuser. No
Orbit command creates or drops a database.

```bash
psql -d postgres -c "CREATE ROLE orbit_dev LOGIN PASSWORD 'orbit_local_dev';"
psql -d postgres -c "CREATE DATABASE orbit_dev OWNER orbit_dev;"
psql -d postgres -c "CREATE DATABASE orbit_test OWNER orbit_dev;"
```

Everything else is one command:

```bash
pnpm bootstrap
```

It installs dependencies, creates `.env` **only if you do not already have one**,
checks the configuration and the database, applies migrations, seeds the Phase 1
agent, installs Chromium, and reports readiness. It is idempotent and it never
starts anything. `pnpm bootstrap --check-only` reports without changing a thing.

By hand, it is this:

```bash
pnpm install
cp .env.example .env
pnpm --filter @orbit/demo-portal exec playwright install chromium
pnpm db:migrate
pnpm db:seed
```

## Start everything

```bash
pnpm dev
```

Five processes start. Four of them serve something:

| Address | What |
|---|---|
| `http://localhost:3000` | Watchtower |
| `http://localhost:3001/requests` | The demo service-request portal |
| `http://localhost:3002` | The API |
| `http://localhost:3020` | The demo library portal |

The fifth, the browser worker, only logs its identity — there is no queue, and
the API executes runs (ADR-011).

## Run the seeded agent

1. Open `http://localhost:3000`.
2. Go to **Agents**. **Find Service Request 0.1.0** is there, seeded from
   `fixtures/find-service-request.agent.yaml`.
3. Enter `SR-1001` and press **Start run**.

The page follows the run to a terminal state and then shows the outcome, the
extracted values, the ordered steps and events, and the evidence.

```text
SR-1001  ->  Succeeded — request found
             Request status: In Progress
             Assigned team:  Infrastructure Operations
```

## Then try the interesting one

Run it again with `SR-9999`.

```text
SR-9999  ->  Succeeded — request not found
```

**That is not a failure.** The run did its job correctly and established that the
record does not exist. A technical run status and a business outcome are separate
facts (ADR-006), and Watchtower shows them separately. This distinction is most
of why Orbit is shaped the way it is.

## Look at what it recorded

Open the run and read down the timeline. Every run persists enough to reconstruct
the execution from stored data alone:

- Screenshots after navigation, fill, click, and the final state
- DOM snapshots after navigation and after a state-changing click
- A Playwright trace, for every run
- Every structured event, in order
- The extracted values, and the assertion results

Artifact bytes live under `./data/artifacts` (gitignored); their metadata and
links live in PostgreSQL. Evidence leaves Orbit only through the run-scoped
artifact route, which addresses it by two opaque ids and verifies the digest
before sending a byte.

## Make one of your own

The seeded agent came from a fixture. Yours will not. The two ways in are on
Watchtower's **Home**:

- **Record yourself doing it.** Give it a title and a start URL, do the task once
  in the browser Orbit opens, and press Finish.
- **Describe it in your own words.** Write the procedure out and press Generate.
  This one needs a model provider configured — see
  [configuration.md](./configuration.md).

Either way you land in **Studio** with a document to review, and from there:
review → bind → compile → approve → publish → run. The
[usage guide](./usage.md) walks the whole path, and Watchtower's **Wiki** tab
covers the same ground in-app.

## Stop everything

Ctrl-C the `pnpm dev` process. To confirm nothing survived:

```bash
pnpm check:teardown
```

It probes ports 3000, 3001, 3002, 3010 and 3102 — not 3020 — and reports any
Orbit service process still running.

`pnpm bootstrap --check-only` answers the opposite question — what is *already*
running, and whether the checkout is ready — without starting or stopping
anything. It probes 3020 as well.

## Where to go next

| | |
|---|---|
| Build a real workflow | [usage.md](./usage.md) |
| The full Phase 1 demo, including a controlled failure | [`../demo/phase-1-demo.md`](../demo/phase-1-demo.md) |
| Configure a model provider | [configuration.md](./configuration.md) |
| Something did not work | [troubleshooting.md](./troubleshooting.md) |
