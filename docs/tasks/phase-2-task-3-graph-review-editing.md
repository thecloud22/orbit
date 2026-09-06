# Phase 2 — Task 3 Prompt: Graph Review, Editing, and Lifecycle (Sub-phase 2.3)

Paste after Task 2 is complete. Per tonight's autonomous-loop instructions,
this branches off Task 2's branch tip, not master — no merges to master
happen until both are reviewed together.

---

We are continuing Orbit Phase 2, Task 3.

Read these files in this order:

1. CLAUDE.md
2. docs/tasks/ACTIVE_TASK.md
3. docs/tasks/phase-2-sop-graph-requirements.md
4. docs/tasks/reports/TASK-P2-001-sop-graph-foundation-report.md
5. docs/tasks/reports/TASK-P2-002-free-text-understanding-report.md (Task 2's report)
6. docs/architecture/decisions.md (ADR-002, ADR-016, and any ADR Task 2 added)
7. packages/sop-graph source in full, with particular attention to `describe.ts`, `reorder.ts`, and `graph.ts` — this task consumes all three directly and should not reimplement any of their logic
8. packages/db — `schema/sop-graph-revisions.ts`, `schema/sop-clarification-answers.ts`, `repositories/sop-graph-revisions.ts` in full, including `SOP_REVISION_TRANSITIONS` and `statesAllowedToReach`
9. packages/sop-generation and packages/sop-service (Task 2's new packages) — read what they actually exported, not what was planned
10. apps/api and apps/web — everything Task 2 added under the SOP draft feature
11. README.md

Confirm before planning that:

- Task 2 is complete on its branch (not necessarily merged to master — confirm current branch state per tonight's sequencing).
- Task 3 is the next active task per `ACTIVE_TASK.md`.
- No sub-phase 2.3 code exists yet.
- Working tree is clean.

## Task 3 goal

Let a human review a SOP Graph revision in plain language, edit individual
steps and reorder them through structured forms — never raw JSON — answer
the model's clarification questions, and move a revision through its
review lifecycle (`draft → needs_clarification → in_review →
approved/rejected`), using the validation, reorder, and state-machine
logic Task 1 already built and the persistence Task 2 already wired. No
execution mapping, no Agent IR, no publishing — this sub-phase is still
draft-and-review only, exactly like 2.1 and 2.2 before it.

## Model-routing requirement

Same Opus/Sonnet split and delegation boundaries as Tasks 1 and 2. Opus
additionally owns:

- The one workflow rule this task must decide and state explicitly before
  implementing (§4 below) — this is a product decision, not a schema one,
  but it is binding once chosen.
- The split-risk call in the next section.

Sonnet may not decide the workflow rule, may not change which lifecycle
transitions are exposed, and may not touch `@orbit/sop-graph` or the
`SOP_REVISION_TRANSITIONS` table itself.

## Split-risk allowance — read this before scoping

This sub-phase was flagged from the start as the one most likely to need
dividing further. If, after reading the actual current API surface, the
full scope below (§1 through §5) looks too large for one bounded
branch/review, propose a split — for example 3a (review view, step editor,
reorder) and 3b (clarification answering, lifecycle actions) — and stop
for approval on the split before writing any code for either half. Do not
silently narrow scope without saying so; do not silently attempt the
whole thing if it's genuinely too large.

## §1 — Plain-language review view

Render a revision using `describeStep` / `describeStepById` /
`describeVariable` from `@orbit/sop-graph`, already built in Task 1 for
exactly this purpose — do not write a second human-readable renderer.
Show, per step: the plain-language description, its structured fields,
and its position in the graph. Show graph-level: assumptions, risks,
clarification questions, and current lifecycle state.

## §2 — Step-specific form editor

One structured form per step kind (`navigate`, `fill`, `click`, `extract`,
`decision`, `outcome`, `manual_review`) — structured fields only, never a
raw JSON textarea. Saving an edit never mutates the existing revision: it
calls `sopGraphRevisions.create` with `parentRevisionId` set to the
edited revision (Task 1's `create` already supersedes the parent in the
same transaction) and `provenance: { kind: 'edited', note }`. The edited
graph is re-validated through `parseSopGraphDocument` / `validateSopGraph`
before persistence — an edit producing an invalid graph is rejected, with
the real `SopGraphIssue[]` surfaced back to the editor, never silently
saved as a new revision.

## §3 — Reorder UI

Expose `validateReorder` / `applyReorder` / `explainReorderFailure` —
built in Task 1, unused since. A move-up/move-down control per step is
sufficient; no drag-and-drop is required. A rejected reorder shows
`explainReorderFailure`'s one-sentence explanation, not a raw issue dump.
A successful reorder is itself an edit and takes the same
supersede-with-new-revision path as §2 — do not special-case it.

## §4 — Clarification answering: decide this explicitly

Display `clarificationQuestions` from the current revision; collect
free-text answers via `recordAnswer` / `listAnswers` (both already built).
Decide, state, and justify in the returned plan: must every clarification
question be answered before a revision can move to `in_review`? Recommend
yes — block `submitForReview` while any question is unanswered — but this
is the one open call in this brief; make the decision explicitly rather
than inferring it silently from the schema, and report it back before
implementing.

## §5 — Review lifecycle

Expose `requestClarification` / `submitForReview` / `approve` / `reject`
via API routes and UI actions. Only offer actions legal from the current
state — import and use `SOP_REVISION_TRANSITIONS` /
`statesAllowedToReach` directly from `@orbit/db`. Do not hand-roll a
second copy of that transition table anywhere in the API or UI layer; if
the UI needs "what actions are legal right now," compute it from the
existing table, not a duplicated list.

## §6 — The non-network boundary still applies

Edited step content can still carry `urlHint` / `systemHint` values. The
same static-scan-plus-fetch-spy technique from Tasks 1 and 2 applies to
every new file this task adds — no exceptions because the content is
"just an edit."

## Explicit exclusions

- No execution mapping, element discovery, or domain allowlisting.
- No Agent IR generation, compilation, or publishing.
- No wiring into Watchtower's run flow — that's sub-phase 2.6.
- No secret vault, encryption, rotation, or audit-policy design.
- No multi-revision diff/merge UI beyond showing the current revision
  versus what's being edited.
- No notification or audit-log system for review actions beyond what
  `reviewedAt` / `reviewNote` already capture on `approve` / `reject`.
- Do not modify `@orbit/sop-graph`'s reorder, validation, or describe
  logic — this task is a consumer. If a genuine gap is found there, stop,
  name it precisely, and wait for approval before touching that package.
- Do not modify `SOP_REVISION_TRANSITIONS` or the revision state machine
  itself — this task exposes it, it does not redesign it.

## Test requirements

- Review view output matches `describeStep` for a fixture graph — no
  second renderer drifting from the one Task 1 built.
- A step edit produces a new revision superseding the old one, with
  correct `provenance.kind: 'edited'`.
- A step edit producing an invalid graph is rejected — not persisted,
  real issues surfaced.
- A successful reorder supersedes with a new revision; a rejected reorder
  produces no new revision and surfaces `explainReorderFailure`'s text.
- A clarification answer is recorded and returned by `listAnswers`.
- The §4 workflow rule is enforced and tested explicitly (e.g.
  `submitForReview` rejected while questions remain unanswered, if that's
  the chosen rule).
- Lifecycle transitions: every legal transition succeeds; every illegal
  one is rejected by the existing repository logic, not a reimplementation
  of it.
- Boundary tests (static scan + fetch spy) extended to every file this
  task adds.
- Full regression — Task 1, Task 2, and Phase 1 gates all stay green.

## Before modifying files, installing dependencies, or making any commit

1. Confirm the actual current API surface of `@orbit/sop-graph`,
   `packages/db`, and Task 2's new packages matches what this brief
   assumes; report any discrepancy before proceeding.
2. Make and justify the §4 decision explicitly.
3. Make the split-risk call from the section above, with reasoning.
4. Summarize Task 3's goal, scope, and exclusions back in your own words.
5. Propose module boundaries (and the split, if any) and wait for
   approval before writing code.
