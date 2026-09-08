# Phase 2 — Task 16: Test suite reliability

**Status:** Proposed, not started
**Stack state:** `master` at `26ddeb5` (Task 15: revise a published workflow). Tree clean.
**Proposed branch:** `chore/test-reliability` off master.

**Motivation:** Real time lost in a working session to false failures and cascading hangs.

## Why

Three separate incidents in one session, none of which were product defects:

- The drift-recovery runtime test **hung 12+ minutes** with leftover rows in `orbit_test`,
  then passed in 18s against a clean database. One failure poisons the next run, which fails,
  which poisons the next.
- Running `test:runtime` and `test:e2e:watchtower` **concurrently** produced 16 of 43 e2e
  failures plus a wrong-error-code failure in runtime. Both passed cleanly in isolation at
  baseline. Contention surfaces as plausible-looking assertion failures, not obvious resource
  errors — so it sends you debugging a phantom.
- A backgrounded suite piped through `tail -6` discarded the failure detail, forcing a full
  6-minute re-run just to see *which* tests failed.

## Verified before writing this

- `apps/browser-worker/src/drift-recovery.runtime.test.ts` has **no `beforeEach`/`afterEach`
  truncation at all** — confirmed by reading the file. Its own `it()` blocks override the
  timeout to `180_000` explicitly; the project default in `vitest.runtime.config.ts` is
  `120_000`. The observed failure was `Test timed out in 180000ms`, consistent with that
  override, not a global setting.
- `.db.test.ts` files already solve exactly this problem, and the fix already exists in the
  repository: `packages/db/src/testing/harness.ts`'s `useTestDatabase()` runs `beforeEach(() =>
  database.truncate())`. `vitest.db.config.ts`'s own header comment states the convention:
  "these... truncate every Orbit table between tests." `.runtime.test.ts` files never adopted
  it. This task's job is largely to extend an established pattern, not invent one.
- `vitest.e2e.config.ts`'s own header comment already states the runtime/e2e concurrency
  hazard in prose: "Running both in one project would pull the seeded Agent Version out from
  under a live server mid-suite... Two projects, two commands, no shared mutable state." The
  hazard is documented but **not enforced** — nothing stops both commands running at once.
- `scripts/check-teardown.mjs` checks all six ports (`3000, 3001, 3002, 3010, 3020, 3102`)
  with **one uniform rule** — none may be occupied — with no distinction between developer
  ports (3000/3001/3002/3020, legitimately held by `pnpm dev`) and test-owned ports
  (3010/3102, reserved exclusively for the e2e stack, per `apps/api/src/testing/stack-ports.ts`).
- `packages/runtime/src/testing/managed-process.ts` already exports `adoptedProcess(name)` and
  `startManagedProcess(options)` — the distinction `check-teardown.mjs` needs already exists
  as a concept in the codebase; it's just not threaded through to the teardown check.
- Current script names and real measured timings, for reference: `pnpm test` (~8s, 1388
  tests), `pnpm test:db` (~28s, 329 tests), `pnpm test:e2e:watchtower` (~39–44s, 45 tests),
  `pnpm test:runtime` (103s in isolation; 12+ minutes observed once with leftover state).

## Scope

### 1. Per-test database isolation (highest value)

Extend `beforeEach` truncation to the runtime project, the same way `.db.test.ts` files
already do it. `useTestDatabase()` already does this against `orbit_test`'s full schema; the
runtime tests connect to the same guarded test database (`resolveTestDatabaseUrl()`,
`TEST_DATABASE_SUFFIX`), so reuse the existing truncate path rather than writing a second one.
A truncate measures at ~46ms — negligible against a 100s+ suite. Every runtime test file must
tolerate no state it did not create itself.

Two things to get right, not just one call to add:
- Truncating while a long-lived process (the demo portal, an API instance) is attached to the
  same database must not race a query that process is mid-flight on. Check how `.db.test.ts`
  already handles this — `api.db.test.ts` has a comment about a truncate deadlocking against
  a live connection holding a lock; read it before writing the runtime-test version.
- `browser-global-setup.ts` runs once per suite (`globalSetup`), not per test. Per-test
  truncation is a `beforeEach` inside each `*.runtime.test.ts` file, layered underneath that,
  not a replacement for it.

### 2. Bounded timeouts on blocking operations

Browser launch, a DB write contending for a lock, and a wait on a proposal row each need their
own timeout well under the file's `testTimeout`. The observed failure burned 724s against a
180s `testTimeout` override — meaning most of that time was **not** counted against the limit
at all; it was blocked somewhere the timeout couldn't see (almost certainly the pre-truncation
state making a query hang, which item 1 removes at the root — but add explicit bounds on the
individual awaits too, so a *different* stuck operation fails in seconds with a specific
message instead of running out the whole test file's clock).

### 3. Mutual exclusion between heavy suites

`test:runtime` and `test:e2e:watchtower` cannot safely run at once — already true in prose,
per `vitest.e2e.config.ts`'s own comment. Make it structural: a lockfile-based guard (e.g. a
`.orbit-test-lock` in a scratch directory, acquired in global setup, released in global
teardown, with a clear "already running" error rather than silent corruption) or a shared
global-setup module the two configs both import that owns the demo portal and database
connection and refuses a second claim. Document the rule in `package.json`'s script comments
(if supported) and in the README, next to the existing test-command documentation.

### 4. Never discard failure output

Establish and document the convention: a long-running suite's full output goes to a log file
(`> /tmp/....log 2>&1` or equivalent), never piped through `tail -N` as the only capture. If
there's a place to encode this as a habit rather than a rule someone has to remember (a
wrapper script, a note in the README's testing section, a comment in the vitest configs), do
that.

### 5. Fix `check:teardown`'s false positive

It must distinguish a process it can prove is test-owned (3010/3102 — reserved exclusively for
the e2e stack; occupied means a leaked prior run) from developer ports (3000/3001/3002/3020,
legitimately held by `pnpm dev`). Use the existing `adoptedProcess`/`startManagedProcess`
distinction from `managed-process.ts` as the model: a process the check itself did not start
and cannot attribute to a leaked test run should not fail the check. Exit 0 with a developer's
`pnpm dev` running; still fail — clearly, naming the port — when 3010 or 3102 is occupied
after the e2e suite's own teardown should have released them.

### 6. Tier the suites explicitly

Add a documented `pnpm test:fast` running the sub-8-second unit suite (and `test:db` if it
stays fast and doesn't need a browser) for iteration. Reserve `test:runtime` and
`test:e2e:watchtower` for pre-commit / CI. Document the tiers and their real timings in the
README's testing section so the next person doesn't have to relearn which suite costs what by
running all of them.

## Explicitly out of scope

**Do not kill processes before running tests.** Dev ports 3000/3001/3002/3020 belong to the
developer's own `pnpm dev`, and the suites already adopt rather than fight them —
`browser-global-setup.ts`'s `isHttpReady` / `adoptedProcess` path is exactly this, and it's
why the runtime suite completes in ~103s reusing an already-running portal instead of starting
a second one. Only fail fast on *test-owned* ports (3010/3102), where an occupant genuinely
indicates a leaked prior run. If a clean-slate command is wanted, it must be separate,
explicit, opt-in (e.g. `pnpm test:reset`), and must name exactly what it is about to stop —
never automatic on `pnpm test` or any suite command.

## Priority order

1. Per-test truncation — makes red mean red.
2. Bounded timeouts — turns 12-minute hangs into 5-second failures.
3. Mutual exclusion — eliminates the phantom-failure class.

Items 1–3 would have removed essentially all of the debugging cost actually observed this
session. Items 4–6 are real but lower-value polish; do not let them expand the diff before
1–3 are solid and verified.

## Acceptance

- The drift-recovery runtime test passes repeatedly with **no manual database cleanup**
  between runs — proven by running it back-to-back at least three times without any `psql`
  intervention, not just asserted.
- `test:runtime` and `test:e2e:watchtower` launched together either serialize (one waits for
  the other) or fail immediately with a clear, named-cause message — never with a misleading
  assertion failure inside either suite. Prove this by actually launching both concurrently
  and observing the result, not by inspecting the lock code.
- `check:teardown` exits 0 with a developer's `pnpm dev` running (all of 3000/3001/3002/3020
  held), and still correctly fails when 3010 or 3102 is genuinely leaked — prove both
  directions, not just the one that was broken.
- Full failure output is recoverable from a log file without re-running the suite.

## Verification

`pnpm typecheck`, `pnpm lint`, `pnpm format:check` for any script/config changes. Run every
suite this task touches at least once after the change, in isolation, to confirm real timings
didn't regress: `pnpm test`, `pnpm test:db`, `pnpm test:runtime`, `pnpm test:e2e:watchtower`.
Run the new `test:fast` tier. Exercise the concurrency guard directly (item 3's acceptance
criterion) rather than trusting it by inspection.

## Deliverables

- Code/config changes per the scope above.
- `docs/tasks/ACTIVE_TASK.md` updated.
- A task report in `docs/tasks/reports/TASK-P2-016-test-reliability-report.md`, following the
  established format: what was built, decisions, real verification output (including the
  concurrency and repeated-run proofs above), deviations, self-caught defects, honest
  limitations.
- An ADR only if a decision here is genuinely architectural (the mutual-exclusion mechanism
  might qualify — a lockfile scheme is a real design choice with alternatives). Use judgement;
  most of this task is process/tooling, not product architecture.
