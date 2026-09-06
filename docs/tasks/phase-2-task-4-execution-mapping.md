# Phase 2 — Task 4 Prompt: Execution Mapping (Sub-phase 2.4)

Branches off current master (2.1-2.3 are already merged), not a stacked
task branch. This is the largest and riskiest sub-phase so far — the
first to touch a real browser and the first to touch Phase 1's existing
runtime rather than pure data. Sent as one task, with an explicit
split-risk allowance if the real scope turns out too large once the
actual runtime code has been read.

---

We are continuing Orbit Phase 2, Task 4 (sub-phase 2.4): Execution Mapping.

Read these files in this order:

1. CLAUDE.md
2. docs/tasks/ACTIVE_TASK.md
3. docs/tasks/phase-2-sop-graph-requirements.md
4. docs/tasks/reports/TASK-P2-001-sop-graph-foundation-report.md
5. docs/tasks/reports/TASK-P2-002-free-text-understanding-report.md
6. docs/tasks/reports/TASK-P2-003-graph-review-editing-report.md
7. docs/architecture/decisions.md (ADR-002, ADR-014, ADR-016, ADR-017)
8. packages/sop-graph source in full — the step kinds (navigate, fill, click, extract, decision, outcome, manual_review) this task must bind against
9. packages/db — sop-graph-revisions schema/repository, SOP_REVISION_TRANSITIONS, and the review-lifecycle pattern from Task 3 you'll be reusing
10. Phase 1's runtime executor in full — whatever module actually performs a browser action today (click/fill/navigate). This is the file Task 4 touches most carefully; read it completely before proposing anything.
11. Phase 1's existing Playwright setup/config — how a browser session gets launched, whether a sandbox/staging target is already configurable per environment, and how login/session/authentication is currently handled
12. README.md

Confirm before planning that:

- Sub-phases 2.1, 2.2, and 2.3 are merged to master; note master's current commit.
- Task 4 is the next active task per ACTIVE_TASK.md.
- No execution-mapping code exists yet.
- Working tree is clean.
- Branch off current master (not a stacked task branch — 2.1-2.3 are already merged).

## Task 4 goal

Let a human demonstrate, once, what a SOP step actually does on a real
page — by recording a real interaction against a sandbox/staging copy of
the target system, never production — and turn that recording into a
durable, approved "Execution Binding" that sub-phase 2.5 can compile into
runnable Agent IR, and that Phase 1's existing runtime can verify against,
deterministically, before every real click. No live AI judgment ever runs
during a real production run — AI only assists during this one-time,
human-supervised mapping session.

## Forward compatibility with 2.5 and 2.6 — read before designing §1

This task's output is not just for itself. 2.5 (Agent IR compilation)
consumes every binding this task produces directly, and 2.6 (publish and
execute) runs every approved Agent Version through the exact fingerprint
check this task wires into the executor (§5). Two consequences:

- The scoping/disambiguation decision in §1 must be resolved concretely,
  not deferred. If it's left ambiguous here, 2.5's Agent IR format for
  scoped elements won't be decided either, and the gap would only surface
  during 2.6's real execution against a repeating list — forcing a schema
  rework after two more sub-phases have already built on top of it. Decide
  it now, explicitly, even if the answer is "single-record navigation
  always holds, no scoping needed yet."
- The fail-safe stop and evidence capture built in §5 is what 2.6 will
  rely on when a live run hits drift — it is not a temporary mechanism to
  simplify later. Build it as the real safety boundary 2.6 will depend on.

## Model routing

Same Opus/Sonnet split and delegation boundaries as Tasks 1-3. Opus
additionally owns:

- The runtime integration point (§5) — propose exactly where and how the
  fingerprint check is inserted into the existing executor, and stop for
  explicit approval before writing a single line in that file. This is
  shared production runtime code, not a new package — it gets the same
  pre-implementation approval any shared/contract-package change requires.
- Whether every navigate step in practice lands on a single,
  already-uniquely-identified record before any click/fill/extract happens
  (§1) — state this explicitly, since it determines whether a bare
  selector is safe or the schema needs explicit scoping, and determines
  what 2.5 will need to compile against.
- The split-risk call in the next section.

Sonnet may not decide the runtime integration point, may not modify the
existing executor file without that approval having already been given in
writing, and may not touch @orbit/sop-graph, SOP_REVISION_TRANSITIONS, or
the SOP Graph revision lifecycle itself.

## Split-risk allowance

If, after reading the actual current runtime code, the full scope below
looks too large or too risky for one bounded branch/review, say so
explicitly and propose a split before writing any code — do not silently
narrow scope, and do not silently push through if it's genuinely too
large. This call is Opus's alone.

## §1 — Execution Binding schema and lifecycle

New package @orbit/execution-mapping, pure — no browser, no AI, no
LangChain. Defines the binding artifact: which SOP step it binds to, one
or more selector strategies ranked by robustness (prefer stable attributes
like data-testid/aria-label/role+name over fragile CSS paths), a
fingerprint snapshot captured at recording time (visible text, role, tag,
rough position), and review state. Reuse the exact draft → needs_review →
approved/rejected lifecycle pattern already built for SOP Graph revisions
— do not invent a second state machine; if the existing transitions table
can be reused directly, reuse it, and if it genuinely can't, say why
before building a new one.

A fill target's value source is a discriminated union, decided explicitly
at binding time by the human, never inferred: either a reference to an
existing SOP variable already defined by the graph, or a literal default
value entered directly. The raw value typed during recording is never
persisted as the binding's value — see §2 and §3.

extract, decision, and outcome step kinds bind differently from
navigate/fill/click: there is no action to perform, only an element to
read from. Capture the selector/fingerprint plus how to read it (text
content, an attribute, a checked/unchecked state), mapped to the specific
SOP variable it populates or the condition it feeds.

manual_review steps require no binding at all — there is nothing to
automate. Skip them entirely; do not attempt to map them.

State explicitly whether a bare selector is safe given the
single-record-navigation assumption above, or whether the schema needs an
explicit scope (e.g., "within this row/section") alongside the selector
for workflows involving repeating lists or tables. This decision directly
shapes what 2.5 will need to compile — see the forward-compatibility note
above.

## §2 — Recording tool

Reuses Phase 1's existing Playwright engine, pointed only at a
sandbox/staging target — assume one always exists; do not build a
production discovery path. The human can start a session either by
resuming wherever a prior step's recording left the browser, or by
entering/editing a starting URL directly — pre-filled from the step's
urlHint when the step has one.

For navigate/fill/click steps: the human picks one SOP step, clicks
Record, performs exactly that step's action once, and the tool captures
the action type, the auto-generated selector, and the fingerprint. For a
fill step, the literal value typed during recording is shown on the
confirm screen only, to verify the right field was hit — it is discarded,
and the human separately chooses the field's actual value source (§1): a
specific SOP variable, or a literal default entered at binding time. If
the action results in navigation or a page/URL change, capture the
resulting state too — useful evidence for outcome steps and the
drift-recovery hint in §4.

For extract/decision/outcome steps: instead of recording an action, let
the human select/highlight the element to read from, and specify how to
read it and which variable/condition it feeds.

This performs a real action in the sandbox (except the read-only
extract/decision/outcome mode) — it is not read-only, and that must be
true only of the sandbox, never of production. If a session captures more
than one action, let the human select which recorded action is the one
that matters rather than assuming the last one is correct.

## §3 — Confirm screen

Plain-language recap of what got captured, next to the SOP step's stated
purpose, reusing describeStep the same way Task 3 did for its review view
— do not write a second renderer. For fill targets, surface the chosen
value source (variable name, or the literal default) alongside the recap.
Human confirms or discards and re-records. Nothing is locked in without
this explicit confirmation.

## §4 — AI-assist features (one section, not a separate task)

All four of these are advisory only — none of them decide anything, none
of them touch a real system, and none of them run during a real
production execution. Each takes the already-captured recording/page
snapshot as input — no new fetches beyond what §2 already captured:

- Semantic mismatch check: on the confirm screen, compare the recorded
  action's target (label, role) against the SOP step's stated purpose,
  and flag likely mismatches as well as likely false alarms. This is the
  one call site that may import an LLM library — confine it to a single
  file, same discipline as anthropic-provider.ts in Task 2.
- Selector robustness suggestion: given the already-captured page
  snapshot, propose a ranked fallback chain (primary selector plus one or
  two backups) for the runtime to try in order if the primary stops
  matching.
- Drift-recovery hint: when a real run's fingerprint check fails (§5),
  compare the stored fingerprint against the current sandbox page and
  suggest a likely replacement element. Never auto-applies a new binding.
  This is what closes the loop with 2.6 — a live run's failure lands back
  here, not in a dead end.
- Coverage suggestion: for steps with conditional branches, review what's
  been recorded so far and suggest likely-missing scenarios.

Do not reach for AI anywhere a deterministic check already answers the
question — e.g., whether a selector currently resolves to more than one
element on the page is a plain locator count, not a model call.

## §5 — Runtime fingerprint check (requires explicit pre-approval)

Before every real click/fill/navigate action Phase 1's existing executor
performs using an approved binding, it does a deterministic comparison
against the stored fingerprint — no model call, with a reasonable
wait/retry window before declaring a mismatch, so ordinary page-load
timing is never mistaken for real drift. On a match, proceed exactly as
today. On a mismatch, fail safe: stop, capture evidence (screenshot plus
what didn't match), and route back to offline re-mapping — never let the
executor improvise a substitute element on its own. This is the exact
mechanism 2.6 will run every published Agent Version through — build it
as the permanent safety boundary, not a placeholder. Propose the exact
integration point in the existing executor file, and the exact shape of
the fail-safe stop, and wait for explicit sign-off on this section
specifically before writing any code here, independent of sign-off on the
rest of the plan.

## Explicit exclusions

- No live AI judgment during a real production run — every AI-assist
  feature in §4 runs only during the supervised mapping session.
- No binding required or created for manual_review steps.
- No Agent IR generation or compilation — that is sub-phase 2.5, which
  consumes this task's approved bindings but is not built here.
- No wiring into Watchtower's run flow beyond the executor check in §5 —
  publishing and full execution wiring is sub-phase 2.6.
- No production discovery or production recording — sandbox/staging only.
- No changes to @orbit/sop-graph, SOP_REVISION_TRANSITIONS, or the SOP
  Graph revision lifecycle itself.
- No secret vault/encryption/rotation design.
- No new login/credential/session handling — recording sessions reuse
  whatever Phase 1 already does to authenticate into a target.

## Known limitation, documented not solved here

Bindings are captured against sandbox and trusted against production. If
the two environments structurally diverge, the fingerprint check fails
safe — correct behavior — but expect more false "drift" than actual drift
in that case. Note this in the report; it is not this task's job to fix,
but 2.6 will need to inherit this awareness when it surfaces execution
failures to an operator.

## Test requirements

- A recording against a fixture sandbox page produces the correct
  selector and fingerprint for each action-based step kind.
- The extract/decision/outcome read-mode capture is tested against a
  fixture, correctly mapped to its variable/condition.
- The value-source choice (variable reference vs. literal default) is
  tested and the raw recorded value is confirmed never persisted.
- manual_review steps are confirmed to require and produce no binding.
- The semantic mismatch check flags a deliberately mismatched pair and
  passes a matching one.
- The selector fallback chain resolves correctly on the fixture when the
  primary selector is removed.
- The drift-recovery hint produces a sensible suggestion against a
  modified fixture page.
- The coverage suggestion fires for a decision-step fixture with an
  unmapped branch.
- The runtime fingerprint check: a matching fingerprint proceeds exactly
  as today; an artificial load-delay fixture does not falsely trigger
  drift; a genuine mismatch fails safe, captures evidence, and never
  attempts a substitute element.
- Full regression — Tasks 1 through 3 and all existing Phase 1 gates stay
  green.

## Before modifying files, installing dependencies, or making any commit

1. Confirm the actual current shape of Phase 1's executor, Playwright
   setup, and authentication handling matches what this brief assumes;
   report any discrepancy.
2. State explicitly whether the single-record-navigation assumption in §1
   holds, and if not, propose the scoping mechanism — this decision must
   be concrete enough for 2.5 to compile against, not deferred.
3. Make the split-risk call explicitly, with reasoning.
4. Propose the exact §5 integration point and fail-safe behavior, and stop
   for sign-off on that specifically before touching the executor file.
5. Summarize Task 4's goal, scope, and exclusions back in your own words.
6. Propose module boundaries and wait for approval before writing any
   code.
