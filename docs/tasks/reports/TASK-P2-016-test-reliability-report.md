# Task P2-016 — Test suite reliability

**Branch:** `chore/test-reliability` (off `master` at `3f918ea`)
**ADR:** none — see "Why no ADR" below
**Status:** Complete, not committed

## What this delivers

Tooling only. No product behaviour changed, no route changed, and the drift-recovery test asserts
exactly what it asserted before.

Three classes of false failure are closed:

- **A blocked database reset is now a failure, not a hang.** It gives up after 10s and names the
  other connections to `orbit_test` by pid. Every test connection also carries a 30s statement
  ceiling.
- **One heavy suite at a time is enforced rather than documented.** `test:db`, `test:runtime` and
  `test:e2e:watchtower` each claim an exclusive lock in global setup; a second is refused in about a
  second, naming the suite that holds it.
- **`check:teardown` stops failing on a developer's own `pnpm dev`,** while still failing on a real
  leak.

Plus the polish items: a documented `pnpm test:fast` tier, a full report written to `logs/` on every
heavy run, and one bounded await in the runtime test that hung.

## The brief's premise was partly wrong, and it matters

The brief's "Verified before writing this" section states:

> `apps/browser-worker/src/drift-recovery.runtime.test.ts` has **no `beforeEach`/`afterEach`
> truncation at all** — confirmed by reading the file.

**This is incorrect.** Line 74 of that file is `const getDatabase = useTestDatabase();`, and
`useTestDatabase()` has installed `beforeEach(() => database.truncate())` since it was written.
`git log` shows the file has been touched exactly once, in `ec4d9c4`, so it has never been
otherwise. Four of the seven `*.runtime.test.ts` files already call `useTestDatabase()`; of the
other three, two touch no database at all.

So item 1 as literally specified — "extend `beforeEach` truncation to the runtime project" — was
already done, and doing it again would have fixed nothing. That mattered, because it forced the
question the brief's own item 2 gestures at without connecting: *if the truncate already ran, why
did leftover rows hang the suite for twelve minutes?*

**The answer is the actual defect.** `TRUNCATE` needs `ACCESS EXCLUSIVE` on every table it names,
and PostgreSQL waits for that lock **indefinitely** by default. A connection left holding row locks
— a run an earlier test dispatched and nothing waited for, a server another suite left behind —
therefore did not make the reset *fail*. It made it *block*, invisibly, in the driver. This also
explains the detail the brief flagged as strange: 724s burned against a 180s `testTimeout`, "most of
that time not counted against the limit at all". A process blocked in a socket read is exactly that.

The fix is therefore not another `beforeEach`. It is bounding the wait, which is what this task did.

## What was built

### 1. The reset fails instead of blocking (`packages/db/src/testing/test-database.ts`)

`truncateOrbitTables` now runs inside a transaction that sets `lock_timeout` first:

```
SET LOCAL lock_timeout = 10000;
TRUNCATE TABLE ... RESTART IDENTITY CASCADE;
```

`SET LOCAL` in a transaction, not a session-level `SET`, because the pool hands out whichever
connection is free — a session `SET` may land on a connection that never runs the truncate.

On `55P03` it raises `TestDatabaseBlockedError` carrying a message that names the other connections
to the database: pid, application name, state, and how long each has been there. Deliberately **not**
the `query` column from `pg_stat_activity` — a statement's text carries row data and this message
goes straight to test output.

Ten seconds is ~200× an uncontended reset (~46ms) and far below any suite timeout. Overridable per
call, which only the test proving the behaviour uses.

### 2. A ceiling on every other statement

`createTestDatabase()` connects with `?options=-c statement_timeout=30000`, so any test query that
blocks on a lock fails in 30s instead of never. Migrations connect on the plain URL: a schema change
is legitimately the one slow statement here.

### 3. Mutual exclusion (`packages/runtime/src/testing/suite-lock.ts`)

An exclusive-create lockfile at `node_modules/.cache/orbit/test-suite.lock`, claimed as the **first**
`globalSetup` entry of all three heavy configs and released last (Vitest runs teardowns in reverse),
so a refusal happens before any server starts or any table is touched.

Design choices, with the alternatives I rejected:

| Choice | Why | Rejected alternative |
|---|---|---|
| Fail fast | A developer who launched the wrong pair wants to know now. Blocking silently for the two minutes the other suite needs looks identical to the hang this task removes | Queue and wait |
| Exclusive `open(path, 'wx')` | The claim and the check are one filesystem operation, so two suites starting in the same instant cannot both believe they hold it | Read-then-write |
| Repo-local, not `os.tmpdir()` | The guarded resources are the ones *this checkout's* `.env` names; a second checkout with its own test database is not in conflict and must not be blocked. The one machine-global resource — ports 3010/3102 — is already guarded by `requireFreePorts()` | Machine-global lock |
| Reclaim a lock whose holder is dead | A suite stopped with Ctrl-C never reaches its teardown. Requiring a developer to delete a file by hand would be a worse failure than the one being prevented | Manual cleanup |
| Release only on a matching token | Without it, a slow teardown deletes the lock a *different* suite has since taken, reintroducing the exact concurrency this prevents | Unconditional `rm` |

`test:db` is included, which the brief did not ask for. It mutates `orbit_test` the same way, so
excluding it would have left the guard's rule incoherent. `pnpm test` shares nothing with them and is
never blocked.

Suites name themselves through `ORBIT_TEST_SUITE`, set in the `package.json` script, so a refusal can
say which two commands collided. A missing variable is not an error, just a vaguer message.

### 4. A bounded await in the runtime test

`withDeadline(promise, ms, description)` (`packages/runtime/src/testing/deadline.ts`) wraps the run
against the drifted page at 90s, well under that file's 180s `testTimeout`. It clears the losing
timer (an uncleared one keeps the event loop alive past teardown) and catches the losing promise (an
uncaught one is an unhandled rejection).

The value is the message, not the duration: *"the run against the drifted page did not finish within
90000ms. Nothing asserted anything — this is a blocked operation, not a failed expectation."*

### 5. `check:teardown` (`scripts/teardown-checks.mjs`, `scripts/check-teardown.mjs`)

Split into pure decision logic plus a thin observer, following the `bootstrap-checks.mjs` pattern
already in `scripts/`, so `pnpm test` can prove the property.

- **3010 and 3102** — reserved for the end-to-end stack, bound by no app in this repository — fail
  the check when occupied.
- **3000/3001/3002/3020** are reported as notes and never fail it. They belong to `pnpm dev`, and the
  suites deliberately *adopt* those servers; reusing an already-running portal is why
  `pnpm test:runtime` takes ~105s instead of starting a second one.

The process patterns were also narrowed to `--filter @orbit/<app>`, which is the exact wrapper
`startManagedProcess` spawns. This is the `adoptedProcess`/`startManagedProcess` distinction the brief
pointed at, applied to evidence available after the fact: `pnpm dev` runs `pnpm -r --parallel dev`
and its children appear as bare `vite`/`tsx` command lines, so a dev stack cannot trip them. A
leaked Playwright browser still does.

The old `apps/api/src/index.ts` pattern was dropped: it matched neither the dev API (`tsx watch
src/index.ts`) nor the e2e API (`pnpm --filter @orbit/api start:e2e`), so it was dead. The new
`--filter @orbit/api` pattern catches the one that matters.

### 6. Tiers and logs

`pnpm test:fast` = `test` then `test:db`: everything that needs no browser. The heavy configs write a
JSON report to `logs/` (gitignored) on every run. README documents both, plus the redirect-to-a-file
convention for backgrounded runs.

## Proof obligations

### 1. Three back-to-back drift-recovery runs, no `psql` intervention

```
=== drift run 1: exit=0 elapsed=51s ===  Test Files 1 passed (1)   Tests 3 passed (3)
-- rows left in orbit_test after run 1 --  sop_documents=1
=== drift run 2: exit=0 elapsed=52s ===  Test Files 1 passed (1)   Tests 3 passed (3)
-- rows left in orbit_test after run 2 --  sop_documents=1
=== drift run 3: exit=0 elapsed=51s ===  Test Files 1 passed (1)   Tests 3 passed (3)
-- rows left in orbit_test after run 3 --  sop_documents=1
```

The `sop_documents=1` line is a **read-only count**, printed between runs to prove no cleanup
happened — each run started with the previous run's rows still present. Nothing was deleted between
runs.

### 2. Both heavy suites launched concurrently, for real

`pnpm test:runtime` was started, and 12 seconds later `pnpm test:e2e:watchtower` was launched while
it was still running. The e2e suite exited **1 second later**, exit code 1:

```
ConcurrentSuiteError: Refusing to start test:e2e:watchtower: another Orbit test suite is already running.

  holding:  test:runtime (pid 40719), started 2026-09-08T16:11:03.593Z (12s ago)
  wanted:   test:e2e:watchtower (pid 40800)
  lock:     /Users/karthik/labs/orbit/node_modules/.cache/orbit/test-suite.lock

These suites share one mutable resource: the `orbit_test` database, which two
of them truncate between tests. Running them at once does not fail loudly — it
deletes rows out from under the other suite and surfaces as ordinary-looking
assertion failures. Run them one at a time.
```

The runtime suite then completed unaffected: **36 passed (36), 103.93s** — against a 103.58s
baseline. No assertion in either suite failed for a phantom reason.

One wart: Vitest prints `No test files found, exiting with code 1` *above* the error, because a
`globalSetup` throw aborts the run before file collection is reported. The real cause is printed
immediately after and the exit code is correct, but the first line is misleading. Noted as a
limitation rather than worked around.

### 3. `check:teardown` in both directions, against the user's real `pnpm dev`

With `pnpm dev` running (pid 1870, all four development ports held):

```
Note: port 3000 is in use (Watchtower (development)) — a development stack, not a leak.
Note: port 3001 is in use (demo portal) — a development stack, not a leak.
Note: port 3002 is in use (API (development)) — a development stack, not a leak.
Note: port 3020 is in use (library portal) — a development stack, not a leak.
Teardown check passed: the reserved test ports 3010, 3102 are free and no Orbit service started by a suite survives.
EXIT=0
```

Before the change, the same command on the same machine reported all four as failures and exited 1.

Then with 3010 artificially occupied by a throwaway listener, dev stack still up:

```
Note: port 3000 is in use ... (all four notes as above)
Teardown check FAILED. Something survived the test run:
  - port 3010 is still held (Watchtower (end-to-end)). This port is reserved for the end-to-end stack, so an occupant is a leaked test run.
EXIT=1
```

Listener closed; the check returned to exit 0 immediately. No process belonging to the developer was
signalled at any point.

### 4. Full failure output recovered from a file

A deliberately failing test was added, run through the runtime config with output piped to `tail -3`
(the bad habit), then deleted. `tail` kept only:

```
   Duration  628ms (tests 35%, import 31%, transform 18%, worker 16%, environment 1%)
JSON report written to /Users/karthik/labs/orbit/logs/test-runtime.json
```

The failure itself was then recovered from `logs/test-runtime.json` **without re-running**:

```
FAILED: a deliberately failing test, deleted immediately after fails with detail worth keeping
AssertionError: expected { status: 'succeeded', …(1) } to deeply equal { status: 'failed', …(1) }
    at /Users/karthik/labs/orbit/apps/browser-worker/src/proof-of-logging.runtime.test.ts:5:63
```

## Verification and timings

`pnpm typecheck`, `pnpm lint`, `pnpm format:check` all clean.

| Suite | Before | After | Tests before → after |
|---|---|---|---|
| `pnpm test` | 8s | 9s | 1388 → 1408 |
| `pnpm test:db` | 28s | 30s | 329 → 331 |
| `pnpm test:runtime` | 104s | 104s | 36 → 36 |
| `pnpm test:e2e:watchtower` | 40s | 41s | 45 → 45 |
| `pnpm test:fast` | n/a | 36s | 1739 |

The +1s/+2s are the 22 new tests and their connections. No suite regressed.

New tests: 20 unit (`suite-lock.test.ts` 5, `deadline.test.ts` 5, `teardown-checks.test.mjs` 10) and
2 database (`reset.db.test.ts`: the blocked-reset failure, and the statement ceiling).

## Self-caught defects

**A deprecation warning I introduced, in 27 places.** The first version set the statement ceiling
with `pool.on('connect', client => client.query('SET statement_timeout = ...'))`. It worked — I read
`pg-pool`'s source and confirmed `emit('connect')` fires synchronously *before* the client is handed
to the consumer, so the `SET` is genuinely queued first — but it produced
`DeprecationWarning: Calling client.query() when the client is already executing a query` once per
test file, because the consumer's first query is then issued while the `SET` is in flight. Zero such
warnings at baseline, 27 after. Two reasons to change it: pg 9.0 will refuse the pattern outright,
and a per-file deprecation warning is noise in exactly the failure logs item 4 is trying to make
readable. Replaced with the `options` connection parameter, applied by the server at startup — no
queueing, no warning, and it covers the first statement too, which the queued form did not. Then
asserted directly (`show statement_timeout` returns `30s`), because a typo in a URL would otherwise
leave every connection unbounded and nothing would notice until the next hang.

**`record-workflow.runtime.test.ts` cannot take per-test truncation.** Its second test asserts that
the document its *first* test recorded appears in the ordinary documents list. Truncating between
them would delete the thing under test, and recording a second real browser session to recreate it
would double the slowest part of the file for no extra claim. I moved it onto `createTestDatabase()`
so it carries the same guards and the same statement ceiling as every other test connection, kept the
reset at `beforeAll`, and documented why in the file. Blindly applying "every runtime file gets a
`beforeEach` truncate" would have broken a passing test.

**Not 0 for the dead-pid test fixture.** The stale-lock test first used `pid: 0`; on POSIX,
`process.kill(0, 0)` signals the caller's own process group and succeeds, so `isProcessAlive(0)` is
`true` and the test would have passed for the wrong reason. Changed to `2_147_483_647`, above every
platform's pid ceiling.

## Deviations from the brief

- **Item 1 was already done**, as described above. The work went into the root cause instead.
- **`test:db` is under the lock** though the brief named only runtime and e2e. It mutates the same
  database; excluding it would leave the rule incoherent.
- **`suite-lock.ts` and `deadline.ts` live under `packages/runtime/src/testing/`**, which the
  constraints told me to be careful about. My reading: the constraint is about *product* behaviour in
  that package, and `src/testing/` is test-only scaffolding by construction — `managed-process.ts`
  beside them says "nothing in production imports it", and `browser-global-setup.ts` is already the
  shared global setup for both heavy suites. Nothing under `packages/runtime/src/` outside `testing/`
  was touched. Flagging it rather than assuming agreement.
- **`packages/db/src/errors.ts` gained one predicate** (`isLockNotAvailable`), following the existing
  `isUniqueViolation`/`isCheckViolation` pattern rather than duplicating the error-chain walk in the
  testing module.

## Why no ADR

I did not write one. The ADR register in `docs/architecture/decisions.md` is reserved for decisions
that bind product behaviour — what a binding is, when a run may proceed, what publishing means, what
Orbit refuses to decide on a person's behalf. Every entry has consequences a user could observe.

The suite lock has none. It constrains nothing about how Orbit behaves in production, changes no
contract, no data shape and no security boundary, and reversing it costs deleting one file and three
config lines. Its design rationale — fail-fast over queueing, repo-local over machine-global,
token-checked release — is captured in the module's own docstrings and in the README's testing
section, which is where someone would actually look for it. Adding it to a register of product
decisions would dilute what that register is for.

## Honest limitations

- **The lock is per checkout.** Two checkouts of Orbit on one machine pointing at the *same*
  `orbit_test` would not be serialised by it. The port guard (`requireFreePorts`) still catches the
  end-to-end collision; the database collision would not be caught. Deliberate — see the table above
  — but it is a real hole, not an oversight.
- **A recycled pid could make a stale lock look live.** The reclaim check is `process.kill(pid, 0)`.
  If the operating system has since assigned that pid to something else, the lock is treated as held
  and the next suite is refused with a message naming a process that is not a test suite. The
  refusal names the file, so the recovery is deleting it. Rare enough not to justify a heartbeat.
- **`No test files found` prints above the refusal.** Vitest's behaviour when `globalSetup` throws.
  Cosmetic, and the actual error is immediately below it.
- **The statement ceiling covers `createTestDatabase()` connections only.** `stack-global-setup.ts`
  builds its own handle via `createDatabase` for one-shot seeding and does not carry it. Its truncate
  *is* bounded, because that goes through `truncateOrbitTables`. Left alone as a one-shot setup path.
- **Only the drift-recovery test's run is wrapped in `withDeadline`.** The other runtime files call
  `executeAgentVersion` too and would benefit identically. I stopped at the file the brief named
  rather than widening the diff; the helper is exported and applying it is a one-line wrap each.
- **The 30s statement ceiling is a guess with margin**, not a measured bound. No test statement comes
  near it today. A legitimately slow future statement would fail with a Postgres cancellation rather
  than a helpful message.
- **`ORBIT_TEST_SUITE=... vitest` in `package.json` is POSIX shell syntax.** Consistent with the rest
  of the repository's macOS/Linux assumptions (`check-teardown` shells out to `ps`), but it would not
  work on Windows `cmd`.
- **Item 2's "wait on a proposal row"** from the brief has no counterpart in the code: the drift test
  reads proposals after the run completes rather than polling for them. Nothing to bound.
