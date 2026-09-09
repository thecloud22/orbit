# TASK-P3-012 — Executable business rules via computed decisions (ADR-040)

**Status:** Complete.

**Branch:** `feat/computed-decisions-and-rules`, off `master`.

## Goal

Make a written business rule — "if loan-to-value exceeds 80%, require private mortgage insurance" —
something Orbit acts on during a run, rather than something documented beside a workflow that does
not know about it.

## The problem this closes

A workflow could branch two ways, and neither fits a rule a business actually writes down:

- **`browser.expect_one_of`** picks by what is visible. Nobody can point at "over 80%" on a screen —
  the screen shows `92.09%`, and the threshold lives in an underwriting manual.
- **`model.decide`** asks a model (ADR-032). It costs money, takes time, and is the only
  non-deterministic thing in an execution. Using it for a number comparison is a bad trade in every
  direction — and it would make judged decisions routine, which erodes the scrutiny they depend on.

## What changed

### A third resolution — `packages/sop-graph`

`resolution: 'computed'` on a decision step, carrying `comparison: {left, operator, right}`. Six
operators (`gt`, `gte`, `lt`, `lte`, `eq`, `neq`), no arithmetic, no combination. Both operands are
values in the graph's existing restricted grammar (ADR-007), so they are checked by the machinery
that already checks a filled field's value — including the availability analysis, which refuses a
rule that reads a figure the workflow has not read *yet* at that point in the flow.

Branches gained `otherwise`, marking the one taken when the condition does not hold. A computed
decision needs exactly two branches and exactly one marked. Three new issue codes cover the shapes
that would otherwise resolve by position.

`ruleText` carries the sentence the rule was written in, for a reviewer to check the comparison
against. Never read by the compiler or the runtime.

### A new step type — `packages/agent-ir`

`value.compare`, with `whenTrue` / `whenFalse` rather than an alternatives array, so a yes-or-no
question cannot be given a third destination. It consumes no surface and no permission: both
operands come from the run's own scope. A new `comparison` value position permits `inputs` and
`variables` and **not** `credentials`, because the step records its operands as evidence.

### Compilation — `packages/agent-ir-compiler`

`uncompilable_comparison` refuses a rule against a value no step in the workflow reads, naming the
value. The alternative would be Orbit deriving the figure itself, which is ADR-002's line: the
system of record computes its own numbers and stands behind them.

Bindability moved from a property of a step's *kind* to a property of the *step* (`needsBinding`),
since a computed decision has nothing on a screen to demonstrate. The publish gate, the recorder's
outstanding list, the API projection and Watchtower's progress count all follow.

### Execution — `packages/runtime`

`packages/runtime/src/steps/compare.ts` reads the shapes business screens render — `$806,500`,
`92.09%`, accounting parentheses — and refuses everything else rather than guessing. `1,2,3` is
rejected, not read as `123`. An ordering comparison against a non-number halts with
`COMPARISON_NOT_COMPARABLE`. Equality falls back to trimmed, case-insensitive text, which is what
makes "flood zone is not X" expressible without a categorical operator.

The step's output records both raw operands, both as-compared, the operator, and the branch — so a
run's branch can be recomputed by hand from the timeline.

### Authoring — `apps/web`

The step editor gained `resolution` (which had no field at all before, so judged decisions were not
authorable either), the comparison as three controls reading as a sentence, `ruleText`, and the
`otherwise` marker.

A **Business rules** panel presents the decisions as rules: the sentence, the comparison claiming to
implement it, and where each branch leads. It is a view over the steps rather than a second store —
a rule *is* a decision, and a separate list would be free to drift.

### A portal to underwrite against — `apps/mortgage-portal`

Port 3030. Eight loan files forming a branch matrix, with every ratio computed and displayed the way
a real loan origination system does, and one free-text income analyst note per file so a judged
decision has real prose to read. 19 Playwright tests, including one asserting the matrix covers both
sides of every threshold.

## Verification

| Suite | Result |
|---|---|
| `pnpm verify` (typecheck, lint, format, unit, db) | pass — 1582 unit, 350 db |
| `pnpm test:runtime` | 44 pass (was 36) |
| `pnpm test:e2e:watchtower` | 45 pass |
| `pnpm test:e2e:mortgage` | 19 pass |
| `pnpm test:e2e` / `test:e2e:library` | 9 / 48 pass |

**The load-bearing test** is `apps/browser-worker/src/mortgage-underwriting.runtime.test.ts`: one
published workflow, seven loan files, seven different paths, against a real browser and the real
portal. It asserts the numbers in each comparison's evidence rather than only the destination.

Two scenarios matter most. A file at 47% DTI is referred and never reaches the mortgage-insurance
question, though its 95% LTV would have required it — ordering the rules is what makes that true. A
file at 596 is declined before its DTI or LTV is compared even once.

**Mutation-tested:**

| Mutation | Caught by |
|---|---|
| Strip thousands separators without checking grouping | `parseComparableNumber` refuses `1,2,3` |
| `gt` → `gte` | the boundary test (80.00 is not "over 80") |
| Hard-code `next` to `whenTrue` | the interpreter test running one agent to two outcomes |
| PMI threshold 80 → 95 | exactly three of the seven real-browser scenarios |

## Documentation

- **ADR-040** records the reasoning and the six alternatives rejected.
- **CLAUDE.md** — the determinism rule now names its two exceptions instead of claiming there are
  none, and the expression rule states what a comparison may and may not do. Changed in the same
  commit as the code, per the ADR-022 precedent: a standing rule the code silently violates is worse
  than either version of it.
- README/docs ADR counts updated to 40.

## Known limitations

**Rules are authored as decisions, not dictated as sentences.** The design calls for typing a rule
in English and having the existing `sop-generation` pipeline propose the decision step for review.
That path is not built; `ruleText` and the Rules panel are the half of it that exists. Everything
downstream of the proposal — the schema, the refusals, the execution, the evidence — is complete, so
the missing piece is a front door onto machinery that works.

**No combination.** "Over 80% *and* a second home" is two decisions in sequence. This is deliberate
(ADR-040), but it means a workflow with many compound rules grows more steps than a rules engine
would.

**Judged decisions are unchanged.** The mortgage workflow exercises one, but through the
deterministic fake judge, as `judged-availability` does — model behaviour is ADR-032's subject.
