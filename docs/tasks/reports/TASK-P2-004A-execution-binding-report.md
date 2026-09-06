# Phase 2 Task 4a Report — Execution Binding Contract and Runtime Drift Check (sub-phase 2.4, part 1)

**Status:** Complete, pending commit approval

**Branch:** `phase-2-task-4a-execution-binding`, off master `dbc75e1`.

**Scope:** §1 (binding schema, lifecycle, persistence) and §5 (runtime drift check). §2 recorder,
§3 confirm screen and §4 AI assists are sub-phase 2.4b, under separate approval.

## Goal

An approved SOP Graph says "the field labelled Password". Nothing in it says which element that
is. This task defines the artifact that answers that — the **Execution Binding** — and builds the
check that stands between an approved binding and a page that has since changed.

## The accessibility-tree question, checked before committing to attribute-only

The plan proposed reading the role from the explicit `role` attribute, since the computed role
appeared to need `evaluate`. Asked to check for a non-`evaluate` accessibility API first, I found
one and **measured it rather than trusting the docs**.

`locator.ariaSnapshot()` exists in the pinned Playwright 1.62.1 and is a first-class API — no
script injection. Probed against the running demo portal:

| Element | `getAttribute('role')` | `ariaSnapshot({ depth: 0 })` |
|---|---|---|
| `request-number-input` | `null` | `- textbox "Service request number"` |
| `search-request-button` | `null` | `- button "Search"` |
| `request-status` | `null` | `- definition: In Progress` |
| `assigned-team` | `null` | `- definition: Infrastructure Operations` |

**The concern was exactly right.** Every element returned `null` for an explicit attribute —
attribute-only would have left the role empty for 100% of them and gutted the drift signal.
`ariaSnapshot` is used instead, and it also yields the accessible name, which is a better
fingerprint field than raw text for controls.

Two things the probe caught that the docs did not:

- **`depth: 0` does not collapse a container** — it still returns the subtree. Only the *first
  line* describes the target, so only the first line is parsed.
- **The subtree embeds run-varying values.** `request-result`'s snapshot contains `SR-1001` and
  `In Progress`. Storing the whole snapshot as a fingerprint would have drifted on every different
  record. Parsing role and name from line one, and keeping text as a separate kind-dependent field,
  is what avoids that.

`tagName` is still dropped, as planned and agreed: reading it needs `evaluate`, and no `evaluate`
appears anywhere in this task.

## Discrepancies against the brief — four, all material

1. **There is no authentication in Phase 1 to reuse.** The brief's exclusions say recording
   sessions "reuse whatever Phase 1 already does to authenticate". Phase 1 does nothing — the demo
   portal has no login and CLAUDE.md excludes authentication outright. 2.4b can only target an
   unauthenticated sandbox until someone builds session handling.
2. **"Assume a sandbox always exists" is constrained to localhost.** `ALLOWED_HOSTS` is
   localhost-only and CLAUDE.md makes that a security rule, so the sandbox is the demo portal or
   another localhost app. Unchanged by this task.
3. **The fingerprint could not be read at all** through the existing `BrowserExecutor`. §5 needed a
   capability addition, not merely a check inserted into the executor.
4. **The locator contract was a closed single-member enum**, narrowed independently in three
   places. §1's ranked strategies were impossible without widening it.

All four were raised before implementation and 2–4 were resolved by explicit decision.

## Decisions taken, as approved

**Split.** 4a is the contract and the safety boundary; 4b is the recorder, confirm screen and AI
assists. The seam is real: recording a human's click needs script injection and element picking,
which is a second Playwright surface with powers ADR-008 denies the runtime. That deserves its own
review.

**Selectors widened to a closed set** — `test_id`, `role_and_name`, `label`. CSS and XPath remain
unexpressible. The property worth protecting was never "one strategy" but "no raw selector string",
and all three name an element by something a person can read.

**The check lives in the runtime.** One read-only method, `describeElement`, was added to
`BrowserExecutor`. The comparison, the decision, the fail-safe and the evidence live in the
interpreter. **The executor's `navigate`, `fill` and `click` were not modified at all** — the
safest possible shape for touching Phase 1's runtime.

**`scope` exists and is unused.** Single-record navigation holds for everything Orbit can execute
(no loop in Agent IR, no iteration in the runtime), so no binding needs a scope today. The field
exists because the SOP vocabulary already expresses cardinality decisions, and adding it after 2.5
and 2.6 had compiled against the schema would mean reworking it.

**Bindings are keyed by `(document, step)`** with `stepSha256`, not by revision. Task 3 made graph
edits routine; revision-keying would orphan every binding on any unrelated edit. The checksum
detects deterministically when *this* step changed.

**A separate lifecycle table.** The pattern is reused exactly — transition table,
`statesAllowedToReach`, the `WHERE`-clause guard. The table is not: `SOP_REVISION_TRANSITIONS` is
typed `Record<SopRevisionState, …>`, so sharing it would make a binding's state *be* a revision's
state, and `needs_clarification` is meaningless for a binding.

## Two design refinements the tests forced

**Text is compared for action targets and not for read targets.** A button's text is its label. An
extract target's text is the value being extracted — `In Progress` one run, `Closed` the next.
Comparing it would have manufactured drift on every extract step in every workflow. Caught while
writing the comparison, and now the first thing `compareFingerprint`'s contract states.

**The wait is two phases, and only the second is bounded to two seconds.** The first drift tests
timed out, which exposed a real flaw rather than a test problem: a permanently drifted element
polled for the full 15-second step budget before failing. Bounding it fixed that — but the first
attempt bounded the *whole* check, including the visibility wait, which was a second and worse bug
(see defect 7). As built: waiting for the element to appear gets the step's entire timeout, so a
slow page is tolerated exactly as before; the two-second window applies only once the element is
already on screen. A test asserts the first call receives the full budget.

## The §5 fail-safe, as built

```text
case 'browser.fill' / 'browser.click':
  verifyBinding(...)          ← poll ≤2s: describeElement, compare
      matches  → executor.fill/click(...)   unchanged
      differs  → RuntimeError UNEXPECTED_UI_STATE
                 → existing failureEvidence path: screenshot + DOM
                 → run stops. No substitute element is ever attempted.
```

No new error code and no new event type: `UNEXPECTED_UI_STATE` and the existing evidence
vocabulary already cover this, so `@orbit/contracts` was not widened.

**`navigate` is deliberately not checked, and this is a reasoned deviation from the brief's "before
every click/fill/navigate".** A navigate step has no element to fingerprint — the page is not
loaded yet — so there is nothing to compare *before* the action. The binding records the URL, which
is 2.5's compile-time concern. Stated here rather than silently skipped.

## Commands and exact results

| Command | Result |
|---|---|
| `pnpm install` | 1 workspace link added; no external dependency |
| `pnpm typecheck` | Pass, all 16 workspaces |
| `pnpm lint` | Pass |
| `pnpm format:check` | Pass |
| `pnpm test` | **597 passed**, 58 files |
| `pnpm db:generate` | `0002_execution_bindings.sql` (renamed from Drizzle's generated name to match the repo convention) |
| `pnpm db:migrate` | Applied to `orbit_dev`; 11 tables |
| `pnpm test:db` | **157 passed**, 13 files — run twice, stable |
| `pnpm test:runtime` | **12 passed** (was 6) |
| `pnpm test:e2e:watchtower` | 21 passed |
| `pnpm test:e2e` | 9 passed |
| `pnpm check:teardown` | **Reported the pre-existing dev stack — see below** |

Counts before this task: 552 unit, 146 db, 6 runtime.

| Added | Tests |
|---|---|
| `@orbit/execution-mapping` — fingerprint, parser, validation, lifecycle, boundary | 37 |
| `@orbit/runtime` — the drift check through a whole run | 8 |
| `@orbit/db` — binding persistence, chain, state machine | 11 |
| `@orbit/executor-playwright` — `describeElement` against a real browser | 6 |

**The most important result is the one that did not change.** All 552 pre-existing tests and the
whole Phase 1 gate pass untouched: bindings are optional, so an agent without them takes a path
identical to before.

### The teardown check

Failed, and **not a leak from this task**. It named ports 3000/3001/3002 — the *development* ports,
held by a `pnpm dev` session started well before this work. The end-to-end ports this suite uses,
3010 and 3102, were free, and the runtime setup correctly reported "Reusing the demo portal already
listening on port 3001" and left it alone. Everything else in `pnpm verify:phase1` passed. I did
not stop the dev stack because it is not mine to kill.

## Defects found and fixed

1. **My boundary scan matched prose, again.** It flagged `binding.ts contains "page."` — from the
   comment "on a real page." — and `@orbit/sop-graph` from a comment explaining the package does
   *not* import it. A scan that punishes documenting a boundary encourages leaving it
   undocumented. Rewritten to check parsed imports and code-shaped call patterns
   (`\bpage\s*\.\s*\w+\s*\(`) rather than substrings. Third time this class of defect has appeared;
   the fix is now the standard one.
2. **A test of mine violated the boundary it was testing.** `lifecycle.test.ts` imported
   `@orbit/db` to compare the two transition tables — from the package whose entire point is not
   depending on it. Moved to the `@orbit/db` test, where both vocabularies legitimately exist.
3. **The fake browser's settle semantics were backwards.** `describeSettlesAfterCalls` applied the
   drift override *after* N calls, which models "settles into drift" — the opposite of the
   load-timing case it was written for. Corrected so the override applies *until* the settle point.
4. **A dead assignment ESLint was right about.** The drift loop's `mismatches` initializer was never
   read on any path. Restructured to throw at the decision point and drop the variable entirely,
   which is also clearer.
5. **A fragile tamper test.** It swallowed the error from its own `UPDATE` with `.catch(() =>
   undefined)` and used a raw SQL string cast `as never` — so a failed tamper would surface as a
   confusing assertion failure rather than a clear one. This is the likeliest cause of two
   transient db failures seen in one run. Rewritten with a typed Drizzle update that asserts one
   row was actually affected; the full db suite then ran clean twice.
6. **The foreign key caught a bad fixture of mine**, correctly: `capturedAgainstRevisionId:
   'soprev_fixture'` is not a real revision, and `execution_bindings_captured_against_revision_id_fk`
   refused it. The fixtures now thread a real revision id in database tests. Good constraint, bad
   fixture — the constraint stays.
7. **The settle window bounded the visibility wait too, and my report said otherwise.** Fixing the
   timeout stall, I capped the whole check at two seconds — including the wait for the element to
   *appear*. A page taking five seconds to render would have failed with a locator error rather
   than waiting as every other step does, making the drift check less patient than the action it
   guards. An earlier draft of this report asserted the opposite of what the code did. Found by
   tracing the timeout actually passed to `describeElement` rather than re-reading the prose.
   Restructured into two explicit phases, pinned by a test asserting the first call receives the
   step's full budget, and the scoping is now stated in ADR-018.

## Changed files

**Created** — `packages/execution-mapping/` (package.json, tsconfig, 5 source modules, 4 test
files, `testing/`); `packages/db/src/schema/execution-bindings.ts`, its mapper, repository and
`execution-bindings.db.test.ts`; `packages/db/drizzle/0002_execution_bindings.sql` + snapshot;
`packages/runtime/src/drift.ts` + test;
`packages/executor-playwright/src/describe-element.runtime.test.ts`; ADR-018; this report.

**Modified** — `packages/contracts/src/{ids,generate-id}.ts` (one additive id);
`packages/agent-ir/src/locator.ts` (three strategies); `packages/runtime/src/{ports,profile,
interpreter,index}.ts` and `testing/fakes.ts`;
`packages/executor-playwright/src/{locator,playwright-executor}.ts`; `packages/db/src/{schema,
mappers,repositories}/index.ts`; `apps/api/src/testing/stub-context.ts`; `eslint.config.js`;
`README.md`; `docs/tasks/ACTIVE_TASK.md`.

**Untouched** — `@orbit/sop-graph`, `SOP_REVISION_TRANSITIONS`, the SOP Graph revision lifecycle,
`@orbit/sop-generation`, `@orbit/sop-service`, every Phase 1 table and migration, and the
executor's three action methods.

**Dependencies:** none added.

## Known limitations

- **Bindings are captured against a sandbox and trusted against production.** Where the two
  structurally diverge the check fails safe — correct — but produces more false drift than real
  drift. 2.6 inherits this when it surfaces failures to an operator. Documented, not solved, per
  the brief.
- **A fingerprint is not a guarantee.** A page can change in ways it does not capture — the same
  role, name and text on a genuinely different control. It raises the cost of an undetected
  substitution; it does not eliminate it.
- **Nothing produces a binding yet.** They are hand-authored fixtures until 2.4b's recorder exists,
  the same way Phase 1's Agent IR was hand-authored before Task 2 generated one.
- **Nothing records who approved a binding.** The lifecycle has no actor, matching the rest of
  Phase 1–2's development-user posture.
- **The review states are enforced in the repository, not by database triggers**, matching ADR-014.
- **`navigate` steps are not drift-checked**, for the reason above.
- **No selector-chain fallback at runtime yet.** The chain is stored and its strategies all resolve
  (proven against a real browser), but the interpreter still acts on the Agent IR step's single
  locator; consuming the chain is 2.5's compile step.

## For sub-phase 2.4b and 2.5

The schema 2.5 compiles against is frozen and reviewed. `scope === undefined` compiles to a bare
locator and has a defined place to compile a scoped one. `stepSha256` tells 2.5 whether a binding
is still trustworthy without guessing. The drift check 2.6 depends on is built as the permanent
safety boundary, not a placeholder — it is wired, tested against a real browser, and already
invisible to agents that have no bindings.
