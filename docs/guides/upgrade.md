# Upgrading

Moving an existing Orbit checkout to a newer one. For a machine that has never
run Orbit, use [installation.md](./installation.md) instead.

Read [The drift-enforcement change](#the-drift-enforcement-change-read-this-first)
before upgrading a deployment that has published agents. It is the one change in
this repository's history that turns previously-passing runs into failures, and
it does so on purpose.

---

## The short version

```bash
# 1. Stop the stack, and back up the two things git does not hold.
pg_dump "$DATABASE_URL" > orbit-backup.sql
tar czf orbit-artifacts.tgz data/artifacts

# 2. Take the new code.
git pull

# 3. See what changed before changing anything.
pnpm db:check

# 4. Apply it.
pnpm bootstrap        # install, migrate, seed, re-check; never touches .env

# 5. Start the stack, then prove it works.
pnpm dev              # in its own terminal
pnpm smoke --preflight
pnpm smoke
```

Every step is expanded below, along with what each one will not do for you.

---

## The drift-enforcement change (read this first)

**Bindings whose fingerprints do not match the current page may now fail rather
than silently proceed. This is intentional.**

The drift check has existed since sub-phase 2.4, but no production entry point
supplied the runtime with a binding until sub-phase 2.12 wired the resolver into
`apps/api/src/dispatch.ts`. Before that, the check was implemented and never
reached. After it, every run of an affected agent is checked. An upgrade across
that point can therefore turn an agent that ran green last week into one that
fails today, with no change to the target site required — the site may well have
changed months ago and gone unnoticed, because nothing was looking.

### What the check actually does

Before a `browser.fill` and before a `browser.click` — and at no other step
type; `browser.expect_one_of` does not drift-check — the runtime compares the
element on the page against the fingerprint a person approved when they
demonstrated the step. A locator resolving is not the same as a locator
resolving to the right thing: a redesigned page can still have an element
matching the recorded selector while that element now means something else, and
clicking it would be a real action nobody reviewed.

A mismatch, or an element that no longer resolves at all, stops the run with a
typed `UNEXPECTED_UI_STATE` error naming the binding, the kind of failure, and
each fingerprint field that differs — approved value beside observed value. The
screenshot, DOM snapshot and trace are captured as for any other failure.

The check polls until the step's own deadline before declaring drift, so a slow
page is not mistaken for a changed one.

### Which agents are affected

Only agents published from a bound candidate — the Studio path, where a person
demonstrated each step. The resolver returns nothing for an Agent Version with
no `publishedFromCandidateId`, so **the seeded `Find Service Request 0.1.0` is
not drift-checked**: it is published from the committed YAML fixture and has no
bindings. That is also why `pnpm smoke` still passes on an upgraded
installation while a hand-authored agent may not — smoke runs the seeded agent.

### What to do about a failure

1. **Inspect the evidence.** Open the run in Watchtower. The failed step's error
   details name the binding and list each mismatched fingerprint field, and the
   screenshot and DOM snapshot show the page as it actually was. Decide from
   that whether the page changed cosmetically or the workflow itself is now
   wrong.
2. **Re-demonstrate the binding.** Open the workflow in Studio, start a binding
   session for the affected step, and demonstrate it against the current page.
   This is the path that always works.
3. **Or use a reviewed proposal, where one is eligible.** If the document has
   been granted recovery, a drifted run may leave a proposal for a person to
   answer.

### The recovery model, stated exactly

This must not be paraphrased into something weaker. Each clause is a bound on
what recovery may do.

- **A drifted run fails.** Recovery never resumes or rescues it.
- Recovery suggests a repair **only from the approved binding's existing fallback
  locator chain**.
- It **never scans the page for unapproved lookalikes**.
- Proposals are **separate records** from bindings.
- A human accepts through the normal **create → review → approve** process.
- **Acceptance does not publish.** A person must publish before later runs use
  the change.
- Recovery is **deterministic and uses no LLM or model**.
- Recovery is **per-document/SOP permission-gated** via `permissions.recovery`.

**Accepting a proposal is not the end of the task.** Acceptance creates a
binding through the ordinary lifecycle; it cannot touch an Agent Version. Until
somebody publishes a new version, every run still uses the version that was
published before — which still carries the binding that drifted, and will still
fail. Plan the upgrade with that step included.

There is no way to switch this enforcement off, and none is planned. Full detail
is in [ui-drift-recovery.md](./ui-drift-recovery.md).

---

## Back up first

Two things live outside git and are not recreated by any command here.

| What | Where | How |
|---|---|---|
| Agents, versions, runs, events, artifact metadata, SOP documents, bindings, proposals | PostgreSQL, `DATABASE_URL` | `pg_dump "$DATABASE_URL" > orbit-backup.sql` |
| Artifact bytes: screenshots, DOM snapshots, traces | `ARTIFACT_STORAGE_DIR`, default `./data/artifacts` | `tar czf orbit-artifacts.tgz data/artifacts` |

`/data/` is gitignored, so `git pull` and `git checkout` never touch artifact
bytes — but they are also never restored by them.

Back up **both, at the same time, with the stack stopped.** Artifact metadata is
in PostgreSQL and the bytes are on disk; a database restored to a point where
the filesystem was different leaves evidence rows pointing at files that are not
there.

Your `.env` is gitignored and holds real API keys. No command in this repository
overwrites it — `pnpm bootstrap` explicitly refuses to, and reports the existing
file instead — but copy it anyway before a large upgrade.

---

## Dependencies

```bash
pnpm install --frozen-lockfile
```

`pnpm bootstrap` runs exactly this. `--frozen-lockfile` is the point: it installs
what the lockfile says and fails if `package.json` and the lockfile disagree,
rather than quietly resolving something new.

Check the engine floor first if the upgrade spans a while — Node `>=24`, pnpm
`>=11`, pinned to `pnpm@11.25.0` by `packageManager`:

```bash
node --version
pnpm --version
corepack enable && corepack prepare pnpm@11.25.0 --activate   # if pnpm is wrong
```

`pnpm bootstrap --check-only` reports both without installing anything.

---

## Environment and configuration

**New variables do not appear in your `.env` by upgrading.** `.env.example` is
the documented set; your `.env` is yours and is never rewritten. After a pull,
diff them:

```bash
git diff HEAD@{1} -- .env.example      # what the upgrade added
diff <(grep -o '^[A-Z_]*' .env.example | sort -u) \
     <(grep -o '^[A-Z_]*' .env | sort -u)
```

The API requires `DATABASE_URL` and `ARTIFACT_STORAGE_DIR`, and `pnpm test:db`
requires `TEST_DATABASE_URL` (which must resolve to `orbit_test`; the harness
refuses to fall back to `DATABASE_URL`). Everything else has a documented
default, so a `.env` missing a newly added variable keeps working. See
[configuration.md](./configuration.md) for what each one does.

`pnpm bootstrap --check-only` validates the configuration it can validate and
never prints a value.

### Deprecated names

`ORBIT_LLM_PROVIDER` and `ORBIT_LLM_MODEL` were superseded by `LLM_PROVIDER`,
`LLM_INVOCATION` and the per-family model variables. **The old names still
work.** Resolution notices them and writes one message to stderr on the way
past; nothing fails. Migrate when convenient:

| Old | New |
|---|---|
| `ORBIT_LLM_PROVIDER=anthropic` | `LLM_PROVIDER=anthropic` with `LLM_INVOCATION=direct` |
| `ORBIT_LLM_PROVIDER=bedrock` | `LLM_PROVIDER=anthropic` with `LLM_INVOCATION=bedrock` |
| `ORBIT_LLM_MODEL=…` | `ANTHROPIC_MODEL=…` or `GEMINI_MODEL=…` |

`ORBIT_LLM_PROVIDER` accepts only `anthropic` or `bedrock`; anything else is a
configuration error. `ORBIT_LLM_MODEL` is **ignored, and says so**, when the
family resolves to `gemini` and the value holds a Claude model id — that
variable predates a second family, so honouring it there would point Gemini at a
model it does not have.

A mistyped `LLM_PROVIDER`, or `gemini` combined with `LLM_INVOCATION=bedrock`
(which nothing can serve), stops the API at boot rather than quietly calling a
model the deployment did not choose. A *missing* API key does not: the process
starts, every route that needs no model works, and drafting fails with the name
of the missing variable.

After restarting, Watchtower's **Admin** tab reports the family, invocation and
model id actually in force, so you can confirm the change took effect without
reading the environment back.

---

## Migrations

```bash
pnpm db:check      # read-only: what is applied, what is pending
pnpm db:migrate    # apply everything pending
```

`pnpm db:check` issues `select` statements only and applies nothing. It prints
the database name, the PostgreSQL version, and the migration level — never a
connection URL, because a URL carries a password. Add `--require-current` to
make it exit non-zero when anything is pending, which is what a deployment
script wants. Add `--test` to check `TEST_DATABASE_URL` instead.

Eleven migrations are committed, `0000_phase_1_evidence_schema` through
`0010_proposals_from_demonstration`. They apply in order and are idempotent in
the sense that already-applied ones are skipped; running `pnpm db:migrate` on a
current database does nothing.

Two things to know:

- **Migrations are forward-only.** There are no down migrations in this
  repository, and `drizzle-kit push` is deliberately unused. The way back from a
  migration is the database backup you took above.
- **`pnpm db:check` can report migrations it does not recognise.** That means
  applied rows matching no committed migration: the database was migrated by a
  *newer* checkout than the one you are running. Nothing will be pending, so a
  count-only glance calls it healthy. `pnpm db:migrate` does not fix it — update
  the checkout to the version that migrated the database. The Admin page shows
  this state too, and says the same thing.

**Nothing checks the migration level at boot.** The API connects and serves; a
stale schema surfaces later as a failing query on whichever route touches the
new column. Migrate before starting, not after.

---

## Seed and demo data

`pnpm db:seed`, `pnpm db:seed:library` and `pnpm db:seed:library:unbound` create
demonstration content. They are for demo and development databases.

- **`pnpm db:seed` is idempotent and refuses to lie.** It publishes
  `Find Service Request 0.1.0` from `fixtures/find-service-request.agent.yaml`,
  and if that fixture has changed while the version number has not, it refuses
  rather than mutating a published Agent Version. Agent Versions are immutable
  (ADR-005); an upgrade does not get to edit one. If a fixture changed
  legitimately, it needs a new version number.
- **The seeds are not an upgrade step.** A production-shaped database with real
  workflows does not need them, and `pnpm bootstrap` runs `pnpm db:seed` by
  default — pass `--skip-seed` if that is not what you want.
- **Seeded demo agents are not drift-checked**, for the reason given above: they
  are published from a fixture and carry no bindings. Do not read a passing
  `pnpm smoke` as evidence that your own agents survived the upgrade.
- The library-portal seeds target `http://localhost:3020`, which only exists
  when that portal is running.

---

## Browser and runtime

Playwright's browser binaries are installed per machine and are **not** updated
by `pnpm install`. When the Playwright dependency moves, the browser build it
expects moves with it:

```bash
pnpm --filter @orbit/demo-portal exec playwright install chromium
```

`pnpm bootstrap` does this unless given `--skip-browser`. Symptoms of skipping
it are runs and recordings that fail to launch a browser at all, rather than
failing a step.

Recording and binding open a **headed** browser, because a person has to see the
page they are demonstrating against. That makes recording a local-machine
capability; it is unaffected by an upgrade except through the browser build.

---

## Restart order

`pnpm dev` is `pnpm -r --parallel dev` and starts five processes: `api`,
`browser-worker`, `demo-portal`, `library-portal`, `web`. It is not a supervisor
and has no ordering of its own, so the ordering that matters is around it:

1. **Stop the stack.** Runs execute inside the API process — there is no queue
   and no worker fleet (ADR-011) — so stopping the API ends any run in flight.
   Let running runs finish first: Watchtower's **Runs** tab shows none in
   `running` when it is safe.
2. **PostgreSQL up**, before anything that connects.
3. **`pnpm db:migrate`**, before the API starts.
4. **`pnpm dev`** — or the API before Watchtower, if starting them separately.
   Watchtower proxies `/v1` to `ORBIT_API_URL` (default `http://127.0.0.1:3002`)
   and shows an error until the API answers; nothing breaks permanently.

Two restart caveats that are not upgrade-specific but bite during one:

- **Recording, binding and walkthrough sessions are held in memory.** Restarting
  the API drops every open session (ADR-027). Anyone mid-demonstration loses it
  and must start the session again. Saved bindings are in PostgreSQL and are
  safe; the *open browser sitting* is not.
- **Ports are strict.** Watchtower 3000, demo portal 3001, API 3002, library
  portal 3020 — each refuses to relocate rather than quietly moving. 3010 and
  3102 are reserved for the end-to-end stack and no app may bind them. If a
  start fails on a port, something from before the upgrade is still running;
  `pnpm check:teardown` reports what is holding 3000, 3001, 3002, 3010 and 3102.

---

## Post-upgrade checks

Run these in order. Each is narrower than the next is broad.

```bash
pnpm db:check                 # schema level; read-only, no stack needed
pnpm bootstrap --check-only   # prerequisites, deps, .env, connectivity; changes nothing
pnpm smoke --preflight        # readiness to execute; executes nothing, writes nothing
pnpm smoke                    # executes the seeded agent for real
```

**`pnpm smoke --preflight`** checks four things in order: that `DATABASE_URL` is
set and the artifact root is usable (never printing a value), that the database
is reachable and its schema current, that the seeded Agent Version is published,
and that the target portal is answering. It starts nothing — a portal that is not
running produces the command to start it — and it exits before executing
anything.

**`pnpm smoke`** then drives the seeded agent through real Chromium against the
demo portal for both scenarios, and reads the evidence back **out of the
database** rather than trusting what the runtime returned. It adds runs to
whatever `DATABASE_URL` names, exactly as pressing Start run in Watchtower does;
it truncates nothing and resets nothing. On a database you care about, that is a
few extra run rows.

Then check by hand, because no command covers it:

- **Open Watchtower's Admin tab** (`?view=admin`). It reports the model family,
  invocation and model id in force, spend against the three ceilings, the
  migration level, the artifact root and the API address — a quick confirmation
  that the process came up with the configuration you meant.
- **Run one of your own agents**, not just the seeded one. This is the only
  check that exercises the drift enforcement described above.

For a full pass, `pnpm verify` runs typecheck, lint, format, unit tests and
database tests. `pnpm verify:phase1` adds the runtime, Watchtower and portal
end-to-end suites; the runtime suite alone takes roughly 18 minutes and needs
Chromium and the portals.

---

## Rolling back

**There is no rollback command, and the limitation is structural rather than
missing tooling.**

- **Migrations are forward-only.** No down migrations exist. Restoring an older
  schema means restoring the database backup.
- **Agent Versions are immutable.** Nothing an upgrade does rewrites one, which
  is the good half: a rolled-back checkout still finds the versions it published.
  But a version published *after* the upgrade, by a newer compiler, may reference
  a schema the older checkout does not have.
- **Artifact bytes and their metadata must move together.** Restoring the
  database without the matching `data/artifacts` leaves evidence rows pointing at
  files that no longer exist, and Watchtower will report the artifact as missing.

To roll back:

```bash
# stop the stack first
git checkout <previous-ref>
pnpm install --frozen-lockfile
dropdb orbit_dev && createdb orbit_dev -O orbit_dev   # or restore into a fresh database
psql "$DATABASE_URL" < orbit-backup.sql
rm -rf data/artifacts && tar xzf orbit-artifacts.tgz
pnpm db:check                               # expect: current, nothing pending
```

If `pnpm db:check` reports migrations it does not recognise after this, the
database is still newer than the checkout — the restore did not take, or it
restored a dump made after the upgrade.

**Rolling back does not un-fail a drifted run**, and it is not a fix for one.
The run failed because the page no longer matches what a person approved; that
is true of the older checkout too, which simply was not looking. Re-demonstrate
the binding instead.

---

## Troubleshooting an upgrade

| Symptom | Likely cause | What to do |
|---|---|---|
| A previously-passing agent now fails with `UNEXPECTED_UI_STATE` | Drift enforcement, now live | Expected. Inspect the evidence, re-demonstrate the binding, or answer a proposal and **publish** |
| `pnpm db:check` lists pending migrations | New schema in the pull | `pnpm db:migrate` |
| `pnpm db:check` reports unrecognised migrations | The database is newer than the checkout | Update the checkout; do not migrate |
| The API exits at boot naming `LLM_PROVIDER` | Mistyped, or `gemini` with `LLM_INVOCATION=bedrock` | Fix the value; the combination does not exist |
| Drafting fails but everything else works | No API key configured | Expected and deliberate. Set the key named in the error; Admin shows the same reason |
| A run or recording fails to launch a browser | Chromium build behind the Playwright dependency | `pnpm --filter @orbit/demo-portal exec playwright install chromium` |
| A service will not start on its port | Something from before the upgrade is still running | `pnpm check:teardown`, then stop it |
| An open recording or binding session vanished | The API restarted; sessions are in memory (ADR-027) | Start the session again. Saved bindings are unaffected |
| Evidence exists in the run but the artifact will not open | Database and `data/artifacts` restored from different points | Restore both from the same backup |
| `pnpm install` fails on the lockfile | `package.json` and the lockfile disagree | Take the pull cleanly; do not hand-edit either |

More at [troubleshooting.md](./troubleshooting.md).

## Related

- [installation.md](./installation.md) — a machine that has never run Orbit
- [configuration.md](./configuration.md) — every variable, and the Admin page
- [ui-drift-recovery.md](./ui-drift-recovery.md) — the drift check and the
  recovery model in full
- [troubleshooting.md](./troubleshooting.md) — failures by symptom
