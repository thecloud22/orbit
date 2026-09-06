# Phase 2 Task 4b Report — Execution Recorder, Confirm Screen, and AI-Assist (sub-phase 2.4, part 2)

**Status:** Complete, pending commit approval

**Branch:** `phase-2-task-4b-execution-recorder`, stacked on `phase-2-task-4a-execution-binding` at
`d8b43f8`. Neither is merged to master.

**Scope:** §2 recorder, §3 confirm screen, §4 assists.

## Goal

4a froze the Execution Binding contract and wired the runtime drift check, but nothing produced a
binding. 4b is the human half: a person demonstrates each step once against a sandbox, and that
demonstration becomes a durable binding conforming to 4a's schema.

This is the trust boundary the 2.4 split existed to isolate. Capturing a human's click needs a
listener inside the page — a capability ADR-008 denies the runtime — so it lives in its own package,
is unreachable from anything that executes an agent, and is reviewed on its own.

## Decisions taken, as approved

**A CLI, not a UI.** `pnpm record:binding`, in the shape `pnpm agent:run` established. §3's "reuse
`describeStep`" is satisfied more directly than a UI would have: `describeStep` is a pure export of
`@orbit/sop-graph`, so the terminal confirm screen calls the same renderer the review view uses,
with no second renderer and no projection layer between. The cost — bindings confirmed in a terminal
while graphs are reviewed in Watchtower — is real and recorded in ADR-019 rather than glossed.

**Two assists use no model.** Ranking three known selector strategies is a fixed order; asking which
steps lack a binding is a set difference. Both are exact questions, and a model would make an exact
answer approximate. Semantic-mismatch and drift-recovery keep a model, in one file.

**`stepChecksum` went into `@orbit/db`, not the recorder app.** Putting it in `apps/recorder` would
have moved the gap rather than closed it: 2.5 lives in another package and cannot import from a CLI
app, so it would have reimplemented the rule from an ADR. `@orbit/db` already depends on
`@orbit/sop-graph` and owns `node:crypto`, so it sits beside `sha256Of` with no new edge in the
dependency graph. There is one function and both callers import it.

**ADR-019, same commit**, for this task's own decisions rather than a footnote on 4a's.

## Architecture

```text
packages/execution-recorder   capture engine. Playwright + the one injected script.
                              No database, no model, no SOP Graph.
packages/execution-assist     the four assists. One file touches a model.
apps/recorder                 the CLI composition root. Where a capture becomes a binding.
```

Mirrors the existing `runtime` / `executor-playwright` / `browser-worker` arrangement. Keeping the
recorder out of `apps/browser-worker` is a security decision, not tidiness: the process that
executes agents must not be able to load script-injection code.

## The injected script

It marks an element and reports an event. It computes no selectors, reads no accessibility data, and
makes no decisions — all of that happens in Node through the same first-class Playwright APIs 4a's
`describeElement` uses. A page that lied about a role would change nothing, because the token is
looked up and the element re-derived on this side.

Selector candidates come from 4a's closed vocabulary only, and each is **verified** to resolve to
exactly one element *and* to the element the human picked — a locator count and an identity check,
both deterministic. A capture with no uniquely-resolving candidate is refused rather than saved.

## Fingerprint parity — the contract with 4a

A binding is written here and checked at run time by `describeElement`, which 4a froze and this task
may not touch. Two independent implementations must derive the same fingerprint, or **every binding
drifts on its first real run** — which would look like the drift check working and would actually be
this task being wrong.

Sharing the code was not available. Proving agreement was: a real-browser test records a binding for
an element, calls `describeElement` on that same element, and asserts `compareFingerprint` matches —
for an action target and a read target. Both pass.

## Commands and exact results

| Command | Result |
|---|---|
| `pnpm install` | LangChain (already pinned by `@orbit/sop-generation`) and Playwright 1.62.1 into the two new packages; nothing else |
| `pnpm typecheck` | Pass, all 19 workspaces |
| `pnpm lint` | Pass |
| `pnpm format:check` | Pass |
| `pnpm test` | **658 passed**, 64 files |
| `pnpm db:generate` | `No schema changes, nothing to migrate` — no migration in this task |
| `pnpm test:db` | **168 passed**, 14 files |
| `pnpm test:runtime` | **19 passed**, 3 files |
| `pnpm test:e2e:watchtower` | 21 passed |
| `pnpm test:e2e` | 9 passed |
| `pnpm check:teardown` | **Reported the pre-existing dev stack — see below** |

Counts before this task: 597 unit, 157 db, 12 runtime.

| Added | Tests |
|---|---|
| `@orbit/execution-assist` — deterministic assists, model-backed assists, boundary | 26 |
| `apps/recorder` — flow state machine | 21 |
| `apps/recorder` — binding assembly and persistence (db) | 11 |
| `apps/recorder` — confirm screen | 9 |
| `apps/recorder` — capture and fingerprint parity (real browser) | 7 |
| `@orbit/execution-recorder` — boundary | 5 |

### Manual verification

`pnpm record:binding -- --document sopdoc_…` against a seeded escalation-review document lists all
32 steps with `describeStep` labels, marks the five `manual_review` steps `[n/a]` with the reason,
refuses to select one, and reports coverage. The smoke-test document was removed from `orbit_dev`
afterwards.

### The teardown check

Failed, and **not a leak from this task**. It named ports 3000/3001/3002 — the *development* ports,
held by a `pnpm dev` session started before this work. The end-to-end ports this suite uses, 3010 and
3102, were free, and the runtime setup correctly reported "Reusing the demo portal already listening
on port 3001" and left it alone. Everything else in `pnpm verify:phase1` passed.

## Defects found and fixed

1. **The lint rule I wrote to keep the recorder out of execution paths did not fire.** I added a
   block covering `packages/runtime`, `apps/api` and `apps/browser-worker` — but placed it *before*
   the existing runtime and API blocks, and a later ESLint config object replaces the rule rather
   than adding to it. So the boundary I had just documented was unenforced. Found by importing
   `@orbit/execution-recorder` into `drift.ts` and running lint, which reported nothing. Fixed by
   putting the pattern inside each block that already owns the rule, and re-verified by probing all
   three paths — each now reports the violation. **A boundary asserted in a config is not a boundary
   until something has tried to cross it.**
2. **Stale captures leaked between steps.** `clearCaptures()` empties the list synchronously, but
   deriving a target is asynchronous, so a capture reported just before a clear finished deriving
   just after it and landed in the *next* step's list. It surfaced as a previous step's click being
   offered as the current step's capture. Fixed with a generation counter: anything derived under a
   superseded generation is dropped.
3. **Switching capture mode threw the page away.** The first implementation re-injected the script
   and reloaded, because an init script only applies to new documents — which silently discarded
   whatever the human had navigated to, putting anything past a sign-in out of reach. The mode is now
   a variable inside the page, set in place, and a test asserts the page survives the switch.
4. **The CLI crashed on closed stdin.** `readline` throws `ERR_USE_AFTER_CLOSE` on the next question
   after stdin ends — Ctrl-D, or a script piping answers — producing a stack trace for what is a
   normal way to end a session. Every prompt now goes through a helper that treats end-of-input as a
   blank answer, which every caller already understands.
5. **`parseArgs` choked on the `--` pnpm forwards.** Caught by smoke-testing `--help` rather than
   assuming it worked. `apps/browser-worker/src/cli/run-agent.ts` had already solved this with a
   comment explaining why; reused the same handling instead of inventing a second one.
6. **The coverage assist printed a wall of text** — all 28 unrecorded step titles in one sentence.
   Now names three and counts the rest.

## Changed files

**Created** — `packages/execution-recorder/` (injected script, derivation, session, boundary test);
`packages/execution-assist/` (deterministic advice, provider, model file, fake, three test files);
`apps/recorder/` (CLI, flow, confirm, binding service, four test files); ADR-019; this report.

**Modified** — `packages/db/src/checksum.ts` (the canonical `stepChecksum`), `eslint.config.js`,
`package.json` (the `record:binding` script), `README.md`, `docs/tasks/ACTIVE_TASK.md`.

**Untouched** — `@orbit/execution-mapping` entirely; `packages/runtime/src/{interpreter,drift,ports}.ts`;
`describeElement` in `playwright-executor.ts`; every contract package; `@orbit/sop-graph`,
`SOP_REVISION_TRANSITIONS`, `@orbit/sop-generation`, `@orbit/sop-service`; every table and migration.

**Dependencies** — LangChain in `@orbit/execution-assist` only, at the versions
`@orbit/sop-generation` already pins; Playwright 1.62.1 in `@orbit/execution-recorder`, matching the
pin. Nothing else.

## Known limitations

- **No authentication**, confirming 4a's discrepancy #1. The recorder targets unauthenticated
  sandbox flows only; anything behind a login is unreachable until session handling exists.
- **Sandbox versus production**, inherited from 4a: where the two diverge structurally the check
  fails safe but reports more false drift than real drift.
- **`navigate` bindings record a URL and stay undrift-checked**, unchanged from 4a.
- **Frames and iframes are out of scope**, per the brief. An element inside one cannot be recorded.
- **Bindings are confirmed in a terminal, graphs reviewed in Watchtower.** Someone reviewing a graph
  cannot see its bindings. The artifacts are persisted, so a read-only view is an additive change.
- **An interactive CLI is only partly testable.** The capture engine and the decision logic are
  covered; the terminal shell over them is thin precisely because it is not, and its prompts are
  exercised only by the manual smoke test above.
- **Parity is proven at one moment, not enforced forever.** The contract test fails loudly if the two
  derivations diverge — the strongest guarantee available without shared code — but it is a test, and
  a test can be deleted.
- **The selector chain is stored but not yet used as a fallback at run time.** Every entry is
  verified to resolve, but the interpreter still acts on the Agent IR step's single locator;
  consuming the chain is 2.5's compile step.

## For sub-phase 2.5

Bindings now exist as real artifacts rather than fixtures. 2.5 compiles them into candidate Agent IR
and **must import `stepChecksum` from `@orbit/db`** rather than recomputing it — there is one
definition precisely so the two cannot drift, and a binding whose checksum no longer matches its step
is stale by construction. The selector chain is ready for the fallback logic 2.5 will compile.
