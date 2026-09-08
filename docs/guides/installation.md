# Installation

Getting Orbit running on a machine that has never run it. If you have a working
checkout and just want to see it work, go to
[quick-start.md](./quick-start.md) instead.

`pnpm bootstrap` does everything on this page except create the database role,
and checks each step as it goes. The manual sequence is documented alongside it
because the script only ever runs commands you could run yourself.

---

## 1. Prerequisites

| Tool | Required | Notes |
|---|---|---|
| Node.js | `>=24` | 24.x is Active LTS. Verified on 26.8.1. |
| pnpm | `>=11` | Pinned to `pnpm@11.25.0` via `packageManager`. `corepack enable` reproduces it. |
| PostgreSQL | 16+ | A local server. Verified on Homebrew PostgreSQL 18.6. |
| Git | any recent | |

**Docker is not required.** `docker-compose.yml` is kept as an optional
alternative to a local PostgreSQL server, and no check depends on it.

```bash
node --version      # v24 or newer
pnpm --version      # 11 or newer
psql --version      # 16 or newer
```

If pnpm is missing or the wrong major version:

```bash
corepack enable
corepack prepare pnpm@11.25.0 --activate
```

## 2. Run the bootstrap, or follow the sequence by hand

```bash
pnpm bootstrap
```

It validates prerequisites, installs dependencies from the committed lockfile,
creates `.env` **only if one does not already exist**, validates the
configuration, checks the database is reachable, applies migrations, seeds the
Phase 1 agent, installs Chromium, and reports readiness. It is idempotent, so
running it on a working checkout is a health check.

Three things it deliberately does **not** do:

| | Why |
|---|---|
| Overwrite an existing `.env` | It can hold a real API key, and the script cannot put back what it overwrote |
| Create, drop or reset a database | That needs superuser credentials it will not guess. It prints the exact `psql` statements — step 3 below — and stops |
| Start `pnpm dev` | Five long-lived foreground processes belong to the person running them, not to a setup script. It prints the exact commands instead |

```bash
pnpm bootstrap --help          # every flag
pnpm bootstrap --check-only    # report only: installs nothing, writes nothing, migrates nothing
```

`--check-only` is safe at any time, including while the stack is running. A
running stack is reported as running and never touched.

Useful flags: `--skip-install`, `--skip-migrate`, `--skip-seed`, `--skip-browser`,
and `--seed-library` to add the branching library demo.

**No environment value is ever printed** — not by the bootstrap, not by
`pnpm db:check`, not by `pnpm db:migrate`. Findings name variables and database
names only, because a connection URL carries a password.

The remaining sections are the same sequence by hand.

## 3. Install dependencies

```bash
pnpm install
```

If pnpm blocks esbuild's postinstall with `ERR_PNPM_IGNORED_BUILDS`, run
`pnpm approve-builds --all`. esbuild is allow-listed in `pnpm-workspace.yaml`,
so this should not normally be needed.

## 4. Create the database role and databases

Orbit uses one dedicated role and two databases on the PostgreSQL server already
running on your machine. It creates objects only inside those two databases, and
never reads, modifies or depends on anything else on the server.

Run as a superuser — on a Homebrew install your own account usually is one:

```bash
psql -d postgres -c "CREATE ROLE orbit_dev LOGIN PASSWORD 'orbit_local_dev';"
psql -d postgres -c "CREATE DATABASE orbit_dev OWNER orbit_dev;"
psql -d postgres -c "CREATE DATABASE orbit_test OWNER orbit_dev;"
```

`orbit_local_dev` is a throwaway local development credential, not a secret.

| Database | Used by |
|---|---|
| `orbit_dev` | Development, `pnpm db:migrate`, `pnpm db:seed` |
| `orbit_test` | `pnpm test:db` only — **its tables are truncated between tests** |

## 5. Configure the environment

```bash
cp .env.example .env
```

The defaults in `.env.example` match the role and databases created above, so
a local install needs no edits. `.env` is gitignored.

You do **not** need a model provider to install or run Orbit. Without one the
API still starts and every route works; only drafting from free text, judged
decisions and recorder suggestions are unavailable, and each says so. See
[configuration.md](./configuration.md) when you want them.

## 6. Apply migrations and seed

```bash
pnpm db:check       # read-only: is the database reachable, and is its schema current?
pnpm db:migrate     # applies the committed migrations to DATABASE_URL
pnpm db:seed        # seeds Find Service Request 0.1.0 from the fixture
```

`pnpm db:check` writes nothing. It reports the database name, the PostgreSQL
version, and how many of the committed migrations have been applied — naming any
that are pending. `--test` checks `TEST_DATABASE_URL` instead;
`--require-current` makes pending migrations an error rather than a note. It also
reports the one case no migration command can fix: applied migrations this
checkout does not contain, meaning the database was migrated by a newer checkout
than the one you are running.

Migrations are committed SQL files under `packages/db/drizzle`, generated by
Drizzle Kit. `drizzle-kit push` is deliberately not used: a schema that can drift
without a versioned migration cannot be reproduced elsewhere.

`pnpm db:seed` validates the fixture through `@orbit/agent-ir` before writing and
is idempotent. Re-seeding an unchanged fixture does nothing; re-seeding a
*changed* fixture under the same version number fails, because published Agent
Versions are immutable (ADR-005). To publish a change, bump the version.

Two further seeds exist for the branching demos:

```bash
pnpm db:seed:library            # the branching library workflow, bound
pnpm db:seed:library:unbound    # the same workflow with no bindings
```

## 7. Install Chromium

Once per machine. The binary lives outside the repository, in
`~/Library/Caches/ms-playwright` on macOS.

```bash
pnpm --filter @orbit/demo-portal exec playwright install chromium
```

Required for running an agent at all, for recording, and for the browser and
runtime test suites.

## 8. Verify the install

```bash
pnpm typecheck
pnpm test           # needs nothing but a checkout
pnpm test:db        # needs PostgreSQL and TEST_DATABASE_URL
```

Then start everything and check it answers:

```bash
pnpm dev
```

```bash
curl -s http://localhost:3002/health     # {"status":"ok"}
```

Open `http://localhost:3000`. You should see Watchtower with five tabs — Home,
Studio, Agents, Runs, Wiki — and the seeded **Find Service Request** agent under
Agents.

`pnpm verify` runs typecheck, lint, format:check, test and test:db together.
`pnpm verify:phase1` additionally runs the runtime, end-to-end and browser
suites, and a teardown check; it needs Chromium and takes roughly twenty
minutes, most of it in `pnpm test:runtime`.

## Upgrading an existing checkout

```bash
git pull
pnpm bootstrap        # install, migrate, seed, and re-check, without touching .env
```

or by hand:

```bash
git pull
pnpm install
pnpm db:check         # what changed, before changing anything
pnpm db:migrate
```

One behaviour change is worth knowing about, because it makes previously-passing
agents stop: **the drift check went live in sub-phase 2.12**. A binding recorded
against a page that has since changed now fails the run rather than acting on
whatever it finds. Re-record the affected step, or grant the document recovery
and answer the proposal — see [ui-drift-recovery.md](./ui-drift-recovery.md).

## Optional: PostgreSQL in Docker

`docker-compose.yml` runs PostgreSQL in a container on host port `55432`. Nothing
depends on it.

```bash
docker compose up -d
# then point DATABASE_URL at it:
# DATABASE_URL=postgresql://orbit:orbit_local_dev@localhost:55432/orbit
```

## If something fails

See [troubleshooting.md](./troubleshooting.md). The most common install-time
failures are a PostgreSQL server that is not running, a role that was not
created, and a `TEST_DATABASE_URL` that does not point at `orbit_test`.
