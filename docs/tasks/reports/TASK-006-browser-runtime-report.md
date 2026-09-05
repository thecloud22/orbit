# Task 6 Report — Browser Runtime

**Status:** Complete, pending commit approval

**Branch:** `task-6-browser-runtime`

**Scope:** Phase 1, Task 6 only. No API routes, no Watchtower UI, no queue, scheduler, daemon,
retry engine, or cancellation surface.

## Goal

Execute the seeded, published `Find Service Request` Agent Version against the local demo portal
through Playwright, and persist a durable run, ordered steps and events, extracted outputs,
screenshot/DOM/trace evidence, and a terminal `succeeded` or `failed` state.

## Architecture as built

```text
apps/browser-worker  (composition root, `pnpm agent:run`)
  ├── @orbit/runtime                     interpreter + two ports; no Playwright, no Drizzle
  │     ├── BrowserExecutor  ←── @orbit/executor-playwright   (the only Playwright dependency)
  │     └── RunStore         ←── @orbit/runtime/persistence   (@orbit/db + @orbit/artifact-service)
  └── @orbit/artifacts (local filesystem bytes)
```

The interpreter owns workflow order, run and step state, and the event timeline. It reaches a
browser only through `BrowserExecutor` and PostgreSQL only through `RunStore`, which is what makes
the whole loop testable without either — and what keeps Playwright from deciding anything (ADR-008).

`@orbit/runtime`'s root entry point does not import `@orbit/db`; the database-backed port lives
behind the `@orbit/runtime/persistence` subpath, mirroring how `@orbit/db/testing` keeps Vitest out
of `@orbit/db`.

### `BrowserExecutor` is a closed capability interface

`navigate`, `fill`, `click`, `waitForVisible`, `isVisible`, `waitForText`, `readText`,
`captureScreenshot`, `captureDom`, `finishTrace`, `close`. Every page-touching method takes the
Agent IR `Locator` type, whose `strategy` is a single-member enum, so **a raw selector string
cannot be expressed**. There is no `evaluate`, no script injection, no exposed `Page`/`Browser`
handle, and no generic "perform this action" escape hatch. `resolveLocator` is the only place a
locator becomes actionable and accepts nothing but `test_id`.

## Supported Agent IR profile

An explicit allowlist (`packages/runtime/src/profile.ts`), checked before a run row exists and
before a browser is launched. `findUnsupportedConstructs` reports *every* violation, not the first.

| Construct | Supported |
|---|---|
| `schemaVersion` | `0.1` |
| `lifecycle.status` | `published` |
| `trigger.type` | `watchtower_manual` |
| Step types | `browser.navigate`, `browser.fill`, `browser.click`, `browser.expect_one_of`, `browser.assert`, `browser.extract`, `complete`, `fail` |
| Locator strategy | `test_id` |
| Assertion types | `locator_visible`, `locator_has_text` |
| Extract method | `text` |
| Value types | `string` |
| URL | `http:`/`https:`, host in `allowedDomains` **and** in the runtime localhost allowlist |

Interpolation reuses `classifyInterpolation` from `@orbit/agent-ir` — the runtime adds no parser and
evaluates no code. Positions and their legal namespaces mirror the semantic validator exactly:
`fill.value` and `assert.expected` take `inputs`/`variables`, `extract.assign` takes only `result`,
`complete.outputs` takes `inputs`/`variables`.

Timeouts: the step's declared `timeoutMs`, else 30 000 ms for `browser.navigate` and 15 000 ms
otherwise. No global run budget.

### Unsupported-IR behaviour

A missing, unpublished, checksum-corrupted, or out-of-profile Agent Version, and invalid run inputs,
are all refused **before a run row is created** — typed `OrbitError`, exit code 1, nothing written.
A missing or corrupted version has no run to fail on anyway, so all four rejections behave alike.
This matches the Phase 1 failure model ("Agent Version missing → no run dispatch").

## Run and step lifecycle

```text
load version → profile preflight → validate inputs        (refusals stop here; no run row)
[txn] runs.create(queued) + run.queued
launch browser + context + tracing                        (failure → runs.fail(WORKER_FAILURE))
runs.markRunning + run.started
interpret steps                                           (one run_step row each, including complete/fail)
finishTrace → record browser_trace artifact               (BEFORE the terminal write)
runs.complete(...) + run.completed   |   runs.fail(...) + run.failed
finally: close context, close browser
```

Only run creation shares a transaction with its `run.queued` event. Everything after is incremental
and append-only, so a run that dies halfway leaves the evidence it already produced rather than
rolling it away.

Every executed IR step gets one `run_steps` row (`agentStepId`, `stepType`, `attempt` 1, sequence
allocated by the repository in execution order). A step never reached has **no row** — absence is
the record that it did not run. `run_steps.output` carries safe detail only: extracted values, the
selected `expect_one_of` alternative, assertion results.

## Event timeline (found path, verified against the database)

```
1  run.queued                      17 step.completed
2  run.started                     18 step.started               detect_request_result
3  step.started                    19 step.completed
4  browser.navigation.completed    20 step.started               verify_request_number
5  assertion.passed                21 assertion.passed
6  artifact.created                22 step.completed
7  artifact.created                23 step.started               extract_request_data
8  step.completed                  24 browser.extract.completed
9  step.started                    25 step.completed
10 browser.fill.completed          26 step.started               complete_found
11 artifact.created                27 artifact.created           (final screenshot)
12 step.completed                  28 artifact.created           (final DOM)
13 step.started                    29 step.completed
14 browser.click.completed         30 artifact.created           (trace, run-scoped)
15 artifact.created                31 run.completed
16 artifact.created
```

Only the 15 event types in `@orbit/contracts` are used; **no new event type or payload shape was
introduced**. The one gap found — `browser.expect_one_of` has no event type in the taxonomy — is
handled inside the contract by recording the selected alternative in the `step.completed` payload
and in `run_steps.output`, rather than by widening the taxonomy.

A terminal event is appended only after its run row is written, so a terminal event can never claim
an outcome the run does not hold.

**`browser.fill.completed` never carries the resolved value** — only the reference expression
(`${inputs.requestNumber}`) and its length. The value is persisted once, in `runs.inputs`, which
keeps the redaction seam the evidence contract requires. A unit test asserts the payload does not
contain `SR-1001`.

## Evidence policy

All kinds, roles, and content types are existing values from `@orbit/contracts` and
`ARTIFACT_KIND_CONTENT_TYPES`. Nothing was invented or changed.

| Evidence | Kind | Role | Content type | Links |
|---|---|---|---|---|
| Screenshot after a declared action | `browser_screenshot` | `screenshot_after_action` | `image/png` | run_step + run_event |
| DOM after a declared action | `dom_snapshot` | `dom_snapshot` | `text/html; charset=utf-8` | run_step + run_event |
| Final-state screenshot / DOM (terminal `complete`) | as above | as above | as above | run_step + run_event |
| Failure screenshot / DOM | `browser_screenshot` / `dom_snapshot` | `error_context` | as above | run_step + run_event |
| Playwright trace (once per run) | `browser_trace` | `browser_trace` | `application/zip` | run + run_event |

`extracted_json` is deliberately unused: extracted values are persisted as `run_steps.output`, which
the evidence contract makes the explicit alternative.

The final-state capture is not declared in the IR (a `complete` step has no `evidence` field) but is
required by CLAUDE.md's "final result state" rule. It is gated on the agent's own `screenshot` /
`dom_snapshot` permission grants, so it can never exceed what the version was granted.

**Per-artifact ordering**, in one place so no call site can differ:

```
capture bytes → artifactService.record(bytes → metadata → run/step link)
              → artifact.created event → link(artifact → that event)
```

The last step is what populates `artifactRefs`: the contract requires a link to run, run step, *and*
the relevant event, and the event id cannot exist before the event.

**Per-step ordering:** action → action event → assertions → assertion event → evidence capture (in a
`finally`, so it happens on both paths) → step terminal state.

### Required-evidence failure policy

1. **A run succeeds only after all required evidence is stored and linked.** The trace is persisted
   before `runs.complete`.
2. **Browser success plus evidence failure fails the run** with `ARTIFACT_STORAGE_ERROR`. `succeeded`
   is never written for a run missing its required evidence.
3. **A primary browser failure is never masked by a secondary evidence failure.** After a step has
   failed, capture is best effort: errors are logged and discarded, and the persisted `OrbitError`
   stays the original one. If the trace cannot be persisted after a failure, the run still fails
   with the original error and `traceMissing` is reported.

Three unit tests cover exactly these three rules.

## Error classification

| Situation | Code |
|---|---|
| Version missing / unpublished / corrupted / out of profile | `VALIDATION_ERROR` |
| Inputs fail the declarations | `INPUT_ERROR` |
| `page.goto` timeout | `BROWSER_TIMEOUT` |
| `page.goto` other failure, or a disallowed host/protocol | `NAVIGATION_FAILED` |
| Locator not actionable for fill/click/read | `LOCATOR_NOT_FOUND` |
| Locator matched several elements (strict-mode violation) | `UNEXPECTED_UI_STATE` |
| `locator_visible` / `locator_has_text` unsatisfied | `ASSERTION_FAILED` |
| `expect_one_of` matched none, or more than one | `UNEXPECTED_UI_STATE` |
| `fail` step executed | its own declared `errorCode` |
| Evidence failure on the success path | `ARTIFACT_STORAGE_ERROR` |
| Browser launch/context failure | `WORKER_FAILURE` |
| Anything unclassified | `INTERNAL_ERROR` |

**The persisted message is composed by Orbit and never Playwright's.** A Playwright timeout message
embeds a "call log" containing page state; persisting it would leak page content into the database
through the error field. The original travels as `cause` for Pino at debug level and stops there. A
real-browser test asserts the persisted message contains neither `call log` nor `waiting for`.

`asRuntimeError` returns an already-classified error unchanged (identity-tested), which is what
stops a classified failure being re-wrapped and losing its code.

### `fail`-step behaviour

Error source is the step's own declared `errorCode` and `message`, unmodified. The step row is
created and failed; the run is failed with `business_outcome` `none`; events are
`step.started` → best-effort `error_context` artifacts → `step.failed` → `artifact.created` (trace)
→ `run.failed`; no later step executes; the CLI exits 1.

### If the terminal write itself fails

Exactly one fallback attempt at `runs.fail(INTERNAL_ERROR)`. If that also fails, the CLI exits
non-zero, prints the run id, and states the run is left non-terminal. It never prints or persists
`succeeded`. No retry loop, and never a second browser attempt.

## Local demonstration

```bash
cp .env.example .env && pnpm install
pnpm db:migrate && pnpm db:seed
pnpm --filter @orbit/demo-portal exec playwright install chromium   # once per machine
pnpm --filter @orbit/demo-portal dev                                # terminal 1

pnpm agent:run -- --request-number SR-1001    # terminal 2
pnpm agent:run -- --request-number SR-9999
pnpm agent:run -- --request-number SR-1001 --headed
```

Verified on this machine:

| Input | Run id | Result |
|---|---|---|
| `SR-1001` | `run_01M1SVZ5SAYKYVQM8PGS51J8YF` | `succeeded` / `request_found`, exit 0 |
| `SR-9999` | `run_01M1SVZ85AETDBKQ9TSVHE0H07` | `succeeded` / `request_not_found`, exit 0 |

`SR-1001` outputs: `requestNumber SR-1001`, `requestStatus In Progress`,
`assignedTeam Infrastructure Operations`. Seven run steps in fixture order, 31 events, 8 artifacts
(4 screenshots, 3 DOM snapshots, 1 trace of 122 209 bytes).

`SR-9999` took the not-found branch — five steps ending at `complete_not_found`, with
`verify_request_number` and `extract_request_data` absent — and recorded no technical error.

## Controlled failure

A **test-only** Agent Version, built by cloning the parsed fixture and pointing one extraction
locator at `request-status-does-not-exist`, published under its own agent id
(`agent_find_service_request_broken_locator`) and version `9.9.9` so it can never collide with the
seeded version. It is re-validated through `@orbit/agent-ir`, so the failure under test is a runtime
failure and not an invalid fixture. **The demo portal, its test ids, its fixtures, and its E2E suite
are untouched** — the agent is the only broken thing.

Result: run `failed` with `LOCATOR_NOT_FOUND`; `extract_request_data` the last step and `failed`;
`complete_found` never executed; `run.failed` last with no `run.completed`; two `error_context`
artifacts on the failed step plus the run trace; the browser proven closed (a post-run
`captureScreenshot()` rejects); and no `succeeded` written anywhere.

## Changed files

**Created**

| File | Purpose |
|---|---|
| `packages/runtime/src/ports.ts` | `BrowserExecutor`, `BrowserExecutorFactory`, `RunStore`, `RunRecorder` |
| `packages/runtime/src/interpreter.ts` | The Agent IR interpreter and run lifecycle |
| `packages/runtime/src/profile.ts` | Supported-construct allowlist, preflight, navigation policy, timeouts |
| `packages/runtime/src/interpolate.ts` | Restricted interpolation at run time |
| `packages/runtime/src/inputs.ts` | Run input validation against IR declarations |
| `packages/runtime/src/evidence.ts` | Evidence policy and capture, with required vs best-effort modes |
| `packages/runtime/src/errors.ts` | `RuntimeError`, classification, `toOrbitError` |
| `packages/runtime/src/logger.ts` | The logging seam |
| `packages/runtime/src/prepare.ts` | `prepareExecution` — the gate Task 7's API must reuse |
| `packages/runtime/src/persistence/{database-run-recorder,index}.ts` | `@orbit/runtime/persistence` |
| `packages/runtime/src/testing/{fakes,fixture,index}.ts` | Port doubles and fixture variants |
| `packages/runtime/src/testing/browser-global-setup.ts` | Migrations + demo portal for the browser project |
| `packages/executor-playwright/src/playwright-executor.ts` | Playwright implementation of the executor port |
| `packages/executor-playwright/src/locator.ts` | The only locator resolution point |
| `packages/executor-playwright/src/errors.ts` | Playwright failure classification |
| `apps/browser-worker/src/cli/run-agent.ts` | `pnpm agent:run` |
| `apps/browser-worker/src/cli/env.ts` | `.env` and repository-anchored artifact root |
| `vitest.runtime.config.ts` | The real-browser project |
| Tests | `interpreter.test.ts`, `profile.test.ts`, `inputs.test.ts`, `interpolate.test.ts`, `errors.test.ts`, `interpreter-persistence.db.test.ts`, `persistence/database-run-recorder.db.test.ts`, `find-service-request.runtime.test.ts` |

**Modified**

`packages/runtime/package.json` (deps + `./persistence`, `./testing` exports),
`packages/executor-playwright/package.json` (deps), `apps/browser-worker/package.json` (dep +
script), root `package.json` (`agent:run`, `test:runtime`), `vitest.config.ts` (exclude
`*.runtime.test.ts`), `packages/runtime/src/index.ts`, `packages/executor-playwright/src/index.ts`,
`apps/browser-worker/src/{index,worker-info,worker-info.test}.ts`, `README.md`,
`docs/tasks/ACTIVE_TASK.md`.

**Not touched:** any schema file, any migration, `@orbit/contracts`, `@orbit/agent-ir`,
`@orbit/artifacts`, `@orbit/artifact-service`, the demo portal, `fixtures/`, and
`apps/demo-portal/tests/`.

## Dependencies

`playwright@1.62.1`, a **direct** dependency of `@orbit/executor-playwright` only, pinned to the
version already resolved in the workspace. `pnpm install` resolved it from the store with no
download. Nothing relies on the demo portal's transitive `@playwright/test`. No other dependency
was added, removed, or upgraded.

## Commands run and results

| Command | Result |
|---|---|
| `pnpm install` | Added `playwright@1.62.1` to `@orbit/executor-playwright`; resolved offline |
| `pnpm typecheck` | Pass, 12 workspaces |
| `pnpm lint` | Pass, including the architecture boundary rules |
| `pnpm format:check` | Pass |
| `pnpm test` | **369 passed**, 38 files (no database, no browser) |
| `pnpm test:db` | **79 passed**, 8 files against `orbit_test` |
| `pnpm test:runtime` | **6 passed**, real Chromium + demo portal + `orbit_test` |
| `pnpm test:e2e` | **9 passed** — the Task 2 suite, unchanged |
| `pnpm agent:run -- --request-number SR-1001` | `succeeded` / `request_found`, exit 0 |
| `pnpm agent:run -- --request-number SR-9999` | `succeeded` / `request_not_found`, exit 0 |

`pnpm verify` is unchanged (typecheck, lint, format:check, test, test:db). `test:runtime` stays out
of it for the same reason `test:e2e` does: it needs Chromium and a live portal.

## Test isolation

- Database tests use `useTestDatabase()`, which never falls back to `DATABASE_URL` and truncates only
  `orbit_test`.
- Every test artifact root is created and removed by `@orbit/artifacts/testing`, which refuses any
  directory it did not create.
- The real-browser suite asserts, in `afterAll`, that the development artifact root is byte-for-byte
  unchanged across the whole file.
- `pnpm test` still needs nothing but a checkout.

## Defect found and fixed during the task

`ARTIFACT_STORAGE_DIR=./data/artifacts` is relative, and `resolveArtifactRoot()` resolves against
`process.cwd()`. pnpm runs a workspace script with the **package** as the working directory, so the
first real runs wrote evidence into `apps/browser-worker/data/artifacts` — inside the repository and
outside `.gitignore`'s root-anchored `/data/`. Fixed in the entry point
(`resolveRepositoryArtifactRoot`), which anchors a relative value to the repository root derived from
the module's own location rather than from where the command was invoked, and still applies every
`@orbit/artifacts` root check. `@orbit/artifacts` was not modified. The stray directory was removed;
`git status` confirms no artifact bytes anywhere in the tree.

## Known limitations

- **The CLI stands in for the Watchtower trigger.** `RunTrigger.type` is `watchtower_manual`, the
  only value the contract has, even though the caller is a command line. Task 7/8 supply the real
  trigger path; the actor is the development stub (`ORBIT_ACTOR_ID`, default `dev-user`).
- **The demo portal must already be running** for `pnpm agent:run`. The command fails fast rather
  than starting it. Only `pnpm test:runtime` manages a portal, and only one it started itself.
- **No global run timeout.** Individual steps are bounded; a whole run is not.
- **`browser.expect_one_of` has no event type**, so its selection lives in `step.completed`'s payload
  and `run_steps.output`. Worth raising as a contract question rather than silently widening the
  taxonomy.
- **`locator_has_text` polls at 100 ms** because `playwright` ships no retrying `expect` and a
  test-runner assertion library does not belong in production code. Bounded by the step deadline.
- **No cancellation, no retries, `attempt` always 1**, per Phase 1 scope. `runs.cancel` still has no
  caller.
- **A losing `expect_one_of` alternative keeps waiting** in the background until the context closes.
  Harmless (the rejection is swallowed) but it does mean one pending Playwright call outlives the
  step.
- **Orphaned bytes remain on a metadata failure**, as ADR-015 specifies; nothing collects them.
- **Failure evidence is best effort by design**, so a failed run may legitimately have no screenshot
  or DOM snapshot when the page is gone.

## Open questions for the next task

1. Should `EventEnvelope`/the taxonomy gain a `browser.expect_one_of` completion event? Watchtower
   will want to render the branch decision as a first-class step event.
2. Task 7 must call `prepareExecution` rather than reimplementing validation, and must decide whether
   the API returns a run id before execution finishes (ADR-011 says it should) — which means the
   in-process dispatch seam gets its first real caller there, not here.
3. A failed run keeps `business_outcome` `none` even if it failed after reaching a business
   conclusion. Still open from Task 4.
