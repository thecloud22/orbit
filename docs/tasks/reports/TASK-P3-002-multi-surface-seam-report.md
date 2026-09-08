# TASK-P3-002 — Multi-surface runtime seam (sub-phase 3.2)

**Status:** Complete. Checkpoint C — read async; nothing is blocked on it.

**Branch:** `phase-3-task-2-multi-surface-seam`, stacked on `phase-3-task-1-surface-contract-freeze`.

## Goal

3.1 made the Agent IR able to *express* a non-browser step. This makes the runtime able to *run* one:
a run can now drive more than one executor, and the interpreter no longer knows that the thing it
executes is a browser. Browser remains the only implemented surface and nothing user-visible changes.

## What changed

### The seam — `packages/runtime/src/ports.ts`

`BrowserExecutor` mixed generic lifecycle with DOM concerns. It is now split:

- **`SurfaceExecutor`** — deliberately two methods, `finishEvidence()` and `close()`. Everything else
  an executor can do is specific to its surface, because a capability shared by widening this
  interface would be a capability nobody reviewed.
- **`SurfaceEvidence`** — `{ kind, role, bytes }`. `finishTrace(): Promise<Uint8Array>` is gone. A
  surface now *names* its run-scoped evidence from the `@orbit/contracts` vocabularies, so the
  interpreter records what it is handed instead of knowing that a run ends by collecting a
  Playwright trace.
- **`SurfaceExecutors` / `ExecutorFor<S>` / `SurfaceExecutorFactory<S>`** — the executor type per
  surface, so `ExecutorFactories` is typed rather than a bag of unknowns: asking the set for the
  browser gives back something that can click, with no cast.
- `BrowserExecutor extends SurfaceExecutor`, and `BrowserExecutorFactory` survives as an alias so
  the composition roots did not churn.

**`Locator` was not widened**, and `BrowserExecutor` did not gain a generic `perform(action)`. Both
were available and both are the thing ADR-018 and ADR-037 exist to prevent.

### The lifecycle — `packages/runtime/src/interpreter.ts`

`ExecuteAgentVersionInput.browser` → **`executors: ExecutorFactories`**.

- `OpenedExecutors` is a **record, not a `Map<ExecutionSurface, SurfaceExecutor>`**, so each field
  keeps its own type and nothing casts. A surface joins by adding a field, and the exhaustive switch
  in `openExecutorsFor` then fails to compile until it is opened.
- One executor is opened **per surface the workflow's steps actually use**, via
  `surfacesUsedBy(...)` (new in `@orbit/agent-ir`). Driven by the steps rather than by `permissions`:
  an agent that declares a surface but contains no step for it opens no session on it.
- The trace block became a loop over opened executors. The ordering guarantee is preserved exactly —
  run-scoped evidence is persisted **before** the terminal run row, a success-path failure becomes
  `ARTIFACT_STORAGE_ERROR`, and a failure-path one is logged and discarded so it cannot mask the
  original failure.
- `ExecutionResult.traceMissing` → `runEvidenceMissing`, since it is no longer only about a trace.

### Two judgement calls worth flagging

**Executors open eagerly, before `run.started`, not lazily at first use.** The plan said "lazily on
first use". I did not do that, because it would move *when* a launch failure is recorded: today a
browser that cannot start fails a run that is still starting, and `interpreter.test.ts` asserts the
event sequence is exactly `['run.queued', 'run.failed']`. Lazy opening would put that failure inside
the step loop, where it would read as a step failure. Opening per *used surface* gets the actual goal
— no session on a surface the workflow never touches — with no behaviour change. True per-step
laziness (a terminal session on an unreached branch) is a 3.6 decision, when there is an LU pool to
care about.

**The executor resolves per step case, not once per step.** A workflow whose only step is `complete`
is valid IR and touches no surface, so resolving eagerly in `performStep` would have broken it.
`browserFor(context)` throws `WORKER_FAILURE` naming the step — a wiring failure, not a step failure.

### Also

- `evidence.ts` — `captureEvidence` accepts `executor: BrowserExecutor | undefined` and returns
  nothing when absent. A run that opened no browser has no evidence to take rather than a failure to
  report.
- `packages/sop-graph/src/safety-boundary.test.ts` — ADR-016 warned its denylist "will need extending
  if a new execution surface appears". Added `node:tls`, `undici`, `3270`, `@orbit/executor-x3270`,
  `@orbit/executor-http`. Entries for packages that do not exist yet are inert, which is the point:
  they fail the moment someone adds one, rather than being remembered then.
- `docs/architecture/system-design.md` §13 — the seam list said "Another executor | `BrowserExecutor`".
  That was wrong in a way worth correcting: `BrowserExecutor` takes the browser-only `Locator` on
  every page-touching method, so a second implementation of it is another way to drive a *browser*,
  not another surface. Split into two rows, with the two things still browser-shaped named explicitly.

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` per package (17) | clean |
| `eslint .` | clean |
| `prettier --check .` | clean |
| `vitest run` | **1414 passed** (130 files), up from 1412 |
| `test:db` | **331 passed** (27 files) |

No existing test's expectations were edited. Ten call sites moved from `browser: x` to
`executors: { browser: x }` and one field was renamed — setup and naming, not assertions. The
browser-launch-failure test still asserts `['run.queued', 'run.failed']` unchanged, which is the
specific evidence that the eager-open decision preserved behaviour.

### New tests

- **A workflow whose steps touch no surface opens no executor** — a `complete`-only IR with a
  counting factory, asserting zero opens. This is the test that proves opening is driven by steps
  rather than by what the deployment wired.
- **A workflow needing an unwired surface fails naming it** — `executors: {}` against the seeded
  fixture yields `WORKER_FAILURE` with events `['run.queued', 'run.failed']`, i.e. recorded against a
  run that never started, exactly as a launch failure is.

## Known limitations

- **Evidence is still browser-shaped.** `EvidenceCapture` is `screenshot | dom_snapshot` and
  `EVIDENCE_TO_BROWSER_ACTION` still reads browser grants. Generalising per-surface evidence needs a
  second surface with an evidence set to generalise *to*; that is 3.6 and 3.8. The consequence is
  stated in code rather than left implicit.
- **No per-surface error codes, event types or artifact kinds were added.** The plan listed them, but
  adding vocabulary for surfaces that do not exist would be dead contract in an immutable field. They
  arrive with 3.6 and 3.10.
- `EXECUTION_SURFACES` still has one member, so the exhaustive switch has one case and the
  multi-executor loops always run over one element. The seam is exercised in shape, not in anger.
- The `finishEvidence` contract says "callable once per executor" and the Playwright implementation
  enforces it, but nothing in the interpreter prevents a second call. It is called exactly once.

## Checkpoint C

The foundation is done: 3.1 froze the contract, 3.2 built the seam. From here the terminal track
(3.5–3.8) and the API track (3.9–3.11) touch disjoint packages and can proceed independently. This is
the natural point to redirect if the order should change.
