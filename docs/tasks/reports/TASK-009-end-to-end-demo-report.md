# Task 9 Report — End-to-End Automation, Documentation, and Phase 1 Acceptance

**Status:** Complete, pending commit approval

**Branch:** `task-9-end-to-end-demo`

**Scope:** Phase 1 closure. No product features, no production-hardening systems. Automation,
documentation, reliability defects that blocked a repeatable demonstration, and the final
acceptance record.

## 1. Exact commands

### Setup, from a clean checkout

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm --filter @orbit/demo-portal exec playwright install chromium   # once per machine
```

The database role and the two databases are a one-time step; see README > Local database.

### Demo

```bash
pnpm dev                       # Watchtower :3000, API :3002, demo portal :3001
# open http://localhost:3000, enter SR-1001, press Start run
```

Full walkthrough: `docs/demo/phase-1-demo.md`.

### Automated end-to-end

```bash
pnpm verify:phase1             # the whole Phase 1 acceptance gate
```

which is, in order:

```bash
pnpm verify                    # typecheck, lint, format:check, test, test:db
pnpm test:runtime              # Agent IR executed by real Chromium
pnpm test:e2e:watchtower       # browser -> Watchtower -> API -> runtime -> portal
pnpm test:e2e                  # the Task 2 demo portal suite
pnpm check:teardown            # nothing survived
```

### Teardown

`Ctrl+C` in the `pnpm dev` terminal, then:

```bash
pnpm check:teardown
```

## 2. Expected observable results per scenario

| Scenario | Where asserted | Expected result |
|---|---|---|
| **Happy path** `SR-1001` | `watchtower.e2e.test.ts` | Status **Succeeded — request found**; outcome `request_found`; outputs `SR-1001` / `In Progress` / `Infrastructure Operations`; 7 steps `open_request_portal`→`complete_found` all `succeeded`; 31 events `run.queued`…`run.completed` in sequence order; 4 screenshots, 3 HTML snapshots, 1 trace; screenshot rendered from the controlled route, HTML and trace served as attachments with the right content types |
| **Business not-found** `SR-9999` | `watchtower.e2e.test.ts` | Status **Succeeded — request not found**; outcome `request_not_found`; 5 steps ending at `complete_not_found`; **no** technical error panel; detail text states it is a business outcome |
| **Controlled technical failure** | `watchtower.e2e.test.ts` | Run and step `failed`; error `LOCATOR_NOT_FOUND`; progress shows `failed at extract_request_data`; `complete_found` never ran; `error_context` evidence plus the trace present; persisted message contains no Playwright call log |
| **Cross-run artifact** | `watchtower.e2e.test.ts`, `api.db.test.ts` | `404`, body contains no path |
| **Missing artifact** | `watchtower.e2e.test.ts`, `api.db.test.ts` | Identical `404`, message `No such artifact for this run.` |
| **No storage key or path** | `watchtower.e2e.test.ts`, `api.db.test.ts`, `server.test.ts` | Absent from `/v1/runs/:id`, `/v1/runs/:id/events`, `/v1/agent-versions`, error bodies, and everything Watchtower renders |
| **Artifact integrity** | `watchtower.e2e.test.ts` (served bytes match the recorded digest and the `x-orbit-sha256` header) and `api.db.test.ts` (bytes tampered on disk → `500` `ARTIFACT_STORAGE_ERROR`, nothing served) | Checksum verified before bytes are served |

The controlled failure uses a **test-only Agent Version** whose extraction locator names a test id
the portal does not render, published under its own agent id and version `9.9.9`. **The demo
portal, its selectors, test ids, fixtures, and its E2E suite are unchanged.**

## 3. Quality-gate results

`pnpm verify:phase1`, 81 seconds, all green:

| Gate | Result |
|---|---|
| `pnpm typecheck` | Pass, 11 workspaces |
| `pnpm lint` | Pass, including architecture boundary rules |
| `pnpm format:check` | Pass |
| `pnpm test` | **432 passed**, 40 files |
| `pnpm test:db` | **93 passed**, 9 files against `orbit_test` |
| `pnpm test:runtime` | **6 passed** |
| `pnpm test:e2e:watchtower` | **11 passed** |
| `pnpm test:e2e` | **9 passed** (Task 2, unchanged) |
| `pnpm check:teardown` | Pass |

**551 automated tests.** No skipped or `.only` tests.

## 4. Process teardown result

```text
Teardown check passed: ports 3000, 3001, 3002, 3010, 3102 are free and
no Orbit service process survives.
```

`scripts/check-teardown.mjs` probes every development and test port on **both loopback stacks**
and scans process command lines for the API, the browser-worker CLI, the two Vite dev servers, and
Playwright browsers. It was verified to actually fail: with a demo portal deliberately left
running it reports both the held port and the process, and exits 1.

No API, Vite, browser-worker, Chromium, or child process survives any suite.

## 5. Defects found and fixed

Each was a genuine barrier to a repeatable demonstration, and each has regression coverage in
`packages/runtime/src/testing/managed-process.test.ts` (12 tests).

### 5.1 Teardown signalled child processes without waiting

`browser-global-setup.ts` sent `SIGTERM` to the demo portal and returned immediately. A following
suite that truncates `orbit_test` could begin while a live process was still writing to it.

**Fix:** one shared `startManagedProcess` helper. `stop()` signals the process group, waits for
exit, and escalates to `SIGKILL` after a grace period. Both global setups now use it.

### 5.2 The port probe missed servers bound to IPv6

`waitForPortReleased` and the teardown checker probed `127.0.0.1` only. Vite resolves `localhost`
to `::1` first on macOS, so a still-listening dev server was reported as gone — making the
teardown wait silently useless for exactly the servers it guards.

**Fix:** both probes check `127.0.0.1` and `::1` and treat the port as released only when neither
answers. A regression test binds a server to `::1` alone and asserts the old single-stack probe
would have missed it.

### 5.3 A leaked shutdown timer kept the test runner alive

Every run ended with `close timed out after 10000ms` and `something prevents 2 Vite servers from
exiting`. Rather than document this as an unavoidable framework warning, it was diagnosed with
Vitest's `hanging-process` reporter, which pointed at Orbit's own code: `stop()` raced the process
exit against a 15-second grace timer and never cleared the timer when the process won, leaving it
pending long after teardown had "finished".

**Fix:** the grace timer is cancelled in a `finally`. Both messages are gone. The regression test
samples `process.getActiveResourcesInfo()` and asserts `stop()` leaves no additional pending timer.

**No framework warning remains.**

### 5.4 An over-broad documentation assertion (found while writing the demo guide)

A draft end-to-end assertion required the string `/Users` to be absent from the whole rendered
document. Vite's dev server injects absolute source paths of its own into `<head>`, which says
nothing about what Orbit publishes. The assertion now checks Orbit's own rendered subtree (`#root`)
for paths, and checks the Orbit-specific strings `storageKey` and `data/artifacts` against the
entire document.

### 5.5 A false claim in the demo guide (found by testing the documentation)

The guide first stated that stopping the demo portal and re-running `pnpm agent:run` produces a
classified `NAVIGATION_FAILED` run. Running it showed otherwise: the CLI's reachability preflight
fires first and **no run is created at all**. The guide now documents the real behaviour, and both
refusal paths were verified to leave the `runs` table unchanged.

## 6. Documentation changes

- **`docs/demo/phase-1-demo.md`** (new) — clean-checkout setup, the local start command and
  Watchtower URL, the three scenarios with exactly what to look for, where to find each piece of
  evidence, how to run the agent by hand, how to stop everything, the test-database and
  artifact-root safety rules, the automated equivalent, and the Phase 1 limitations.
- **`README.md`** — a clean-checkout setup path ending at the Watchtower URL, a link to the demo
  guide, an authoritative table of every test command with what it proves and what it needs, and
  the `verify:phase1` gate.
- **`docs/tasks/ACTIVE_TASK.md`** — Phase 1 closure state.
- This report.

Every command and claim in both documents was executed before it was written down. Two claims were
wrong on first drafting and were corrected (5.4, 5.5) rather than left as plausible-sounding prose.

## 7. Final Phase 1 acceptance checklist

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | A clean checkout can demonstrate Phase 1 from documented commands | ✅ | README setup path; `docs/demo/phase-1-demo.md` |
| 2 | Watchtower starts a run from a typed dynamic input | ✅ | `watchtower.e2e.test.ts` |
| 3 | The run is pinned to an immutable Agent Version | ✅ | run detail shows `agentv_find_service_request_0_1_0` `0.1.0` |
| 4 | `SR-1001` → `succeeded` / `request_found` with correct outputs | ✅ | end-to-end scenario 1 |
| 5 | `SR-9999` → `succeeded` / `request_not_found`, not a failure | ✅ | end-to-end scenario 4 |
| 6 | A broken locator produces a typed technical failure with evidence | ✅ | end-to-end scenario 5; `LOCATOR_NOT_FOUND` |
| 7 | Steps and events persisted in order | ✅ | 7 steps, 31 events, strictly increasing sequence |
| 8 | Screenshot, DOM snapshot, and trace exist for every run | ✅ | 8 artifacts on the happy path; trace on failed runs too |
| 9 | Evidence retrievable through controlled routes only | ✅ | run-scoped route; `data/artifacts` never served |
| 10 | Artifact linkage enforced; cross-run and missing both 404 | ✅ | scenarios in `watchtower.e2e.test.ts` and `api.db.test.ts` |
| 11 | Checksum verified before bytes are served | ✅ | tamper test (`api.db.test.ts`) + digest match (end-to-end) |
| 12 | No storage key or filesystem path in any API or UI response | ✅ | asserted across API bodies, error bodies, and the rendered UI |
| 13 | Structured events use only the contracted types | ✅ | Task 6 report; event taxonomy unchanged since |
| 14 | Business outcome separate from technical status | ✅ | ADR-006; `request_not_found` renders as an outcome |
| 15 | Test data confined to `orbit_test` and temp artifact roots | ✅ | guards unchanged and unweakened; `data/artifacts` never written by tests |
| 16 | No process or port survives a test run | ✅ | `pnpm check:teardown`, proven able to fail |
| 17 | Full gate reproducible in one command | ✅ | `pnpm verify:phase1`, 81s, 551 tests |

## 8. Known limitations, explicitly deferred beyond Phase 1

**Orbit Phase 1 is a local proof loop. It is not production software and this report does not claim
production readiness.**

- **No authentication, authorization, tenancy, policy, approvals, or audit export.** Every request
  is a fixed development actor; anyone who can reach the API can read any run and its evidence.
- **Runs execute inside the API process.** No queue, worker fleet, scheduler, retry engine, or
  cancellation. Two clients can start two runs concurrently — Watchtower's disabled button is a UI
  guard, not a server guarantee.
- **No recovery.** A run left `running` by a killed API process stays that way; there is no sweep.
- **No retention or cleanup.** Evidence is kept forever, and ADR-015's orphaned bytes and stale
  `.part` files are never reconciled.
- **Immutability and append-only are enforced in the repository layer, not by the database**
  (ADR-014). A direct `UPDATE` is detected on read, not prevented.
- **`NOT_FOUND` is missing from the Phase 1 error taxonomy**, so 404s carry `VALIDATION_ERROR` with
  the HTTP status as the authoritative signal.
- **`attempt` is always 1**; there is no retry engine.
- **One agent against one controlled local portal.** No external sites, credentials, MFA, CAPTCHA,
  LLM, or selector healing.
- **`browser.expect_one_of` has no event type**, so its branch decision lives in the
  `step.completed` payload.
- **Verified on macOS with Node 26 and PostgreSQL 18.** CI and other platforms are untested; the
  teardown checker's process scan is `ps`-based and POSIX-only.
- **A trailing `.part` file or orphaned bytes** can remain after an interrupted write, by design.

## 9. Phase 1 status

All nine Phase 1 tasks are complete. The proof loop the phase set out to demonstrate —

```text
Watchtower manual trigger -> typed dynamic input -> version-pinned Agent IR
  -> deterministic Playwright execution -> events and artifacts -> Watchtower evidence
```

— runs from a clean checkout in one documented command, and is asserted by 551 automated tests
ending in a mechanical proof that nothing was left running.
