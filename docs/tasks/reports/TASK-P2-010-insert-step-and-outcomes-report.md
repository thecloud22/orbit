# Task P2-010 — Insert a step, and business outcomes in the workflow's own words

**Sub-phase:** 2.10
**Branch:** `phase-2-task-10-insert-step-and-outcomes`
**Status:** Complete — not committed, not merged, not pushed

## Why this task exists

Two changes to the same review-and-publish path, plus one documentation amendment.

**A recorded workflow could never become a branching one.** `packages/sop-recording`'s translator
deliberately refuses to invent a branch nobody demonstrated — correct, because a recording is evidence
of what a person actually did. But the review editor had `editStep` and `reorderStep` and no way to
*add* a step, so the only routes to a `decision` step were the AI drafting flow and a hand-written
fixture. A person who recorded a workflow and then realised it needed to branch had nowhere to say so.

**Every agent had to record the wrong name for what it concluded.** `terminalBusinessOutcomeSchema`
was `z.enum(['request_found', 'request_not_found'])` — two names inherited from the Phase 1 "Find
Service Request" demo. Every workflow mapped its real outcomes onto those two, so the seeded library
demo published `borrowed → request_found` and `held → request_not_found`. The branch taken was exact
and the evidence complete; the *name* stored against the run was a lie. That is worse than untidy:
Watchtower's whole claim is that a run's evidence reconstructs what happened, and a run that concluded
"this book is on loan, so I placed a hold" recorded `request_not_found`.

## What was built

### Task A — Insert a step

`insertStep` on `SopRevisionService`, following exactly the shape `editStep` already uses: it creates
a **new revision** rather than mutating the one on screen, works only from an editable state
(`draft` / `needs_clarification`, ADR-017), re-validates the whole resulting graph through
`parseSopGraphDocument`, and returns a typed result union — refusing rather than throwing for every
expected case (`not_found`, `not_editable`, `out_of_range`, `invalid_graph`).

`POST /v1/sop-revisions/:revisionId/steps`, matching the conventions already in
`apps/api/src/routes/sop-revisions.ts`.

**Step ids are generated, never supplied.** `generateStepId` in `@orbit/sop-graph` names the id after
the kind and numbers it (`click_1`, `click_2`), guaranteeing uniqueness with a loop rather than a
count — a graph can already contain `click_2` without `click_1`. The body schema is
`sopStepDraftSchema`, built by `.omit({ id: true })` from the real step schemas rather than restated,
so a field added to a step kind cannot go silently missing; being strict objects, an id a caller tries
to supply is refused rather than used. This is the same reasoning that made `agentIdForDocument`
derived in ADR-024, and sharper here: branches name their targets by step id and the step editor
refuses to change one, so a badly chosen name could not be undone.

**The `entryStepId` trap, handled and tested directly.** The graph names its entry step explicitly
rather than meaning "whatever is first". Inserting in front of it without moving it would leave the new
step silently unreachable while the workflow still started exactly where it did before. The condition
is *the index of the entry step*, not index 0 — that, not the head of the list, is the only position
where fall-through puts a new step before the workflow's beginning. Two tests cover it: one asserting
the entry moves, one asserting it does not when inserting anywhere else.

**UI:** an "Add a step here" affordance before the first step and after each one, and
`SopStepInserter.tsx`. It reuses `fieldsForStepKind`, `EDITABLE_STEP_KINDS` and `pruneEmptyFields`, and
renders through the *same* `StepField` component the editor uses (exported for the purpose) rather
than a second form — the only real differences are a kind picker and the absence of existing values.
Changing kind clears the typed values, since fields are per kind and stale ones would be refused as a
schema error.

**A newly inserted step has no binding, so it correctly shows as "Not recorded" and blocks
publishing.** That is the system working, not a gap: an unbound step is a claim about a page that
nothing has confirmed (ADR-025, ADR-027), and a step typed into a form is precisely the case that must
not bypass it. Said in a comment in `SopStepInserter.tsx`, in the ADR, and in the UI itself, so nobody
later "fixes" it.

**Deleting a step is not implemented**, as the brief required.

### Task B — Business outcomes become the workflow's own words

A business outcome is now a declared identifier matching `^[a-z][a-z0-9_]{0,63}$`, stated once as
`BUSINESS_OUTCOME_PATTERN` in `@orbit/contracts` and used by both the Zod schema and the database
CHECK constraint so the two cannot disagree. `borrowed` is the outcome. There is no mapping.

**The mapping concept is gone entirely**, as the brief required: `OutcomeMapping` in the compiler, the
`outcomeMapping` body field on all three publish/compile routes, and the whole form in
`SopPublishPanel` (`BUSINESS_OUTCOMES`, `DEFAULT_OUTCOME`, `asksAboutOutcomes`, `outcomeMapping`
state, `mappingComplete`). Publishing is now a button with no question attached, for every workflow.
The panel instead *shows* the declared outcomes, so a person can check the list says what they meant
before publishing.

**`none` stays reserved**, and the compiler refuses it by name at the step (`unusable_outcome_name`,
replacing `unmapped_outcome`) rather than letting it reach a CHECK-constraint violation at run time.
The compiler also re-checks the length bound, because the graph's own `outcomeNameSchema` imposes none.

**Technical run status stays separate from business outcome.** Nothing about a free-form outcome
touches `succeeded` / `failed`.

**Watchtower reports an outcome without judging it.** `describeRunStatus` used to single out
`request_not_found` as an "attention" state with a sentence about service requests. An outcome is now
whatever a stranger's workflow declares, so Watchtower names it and stops. This is a deliberate loss of
a UI affordance whose premise was a closed vocabulary — recorded in the ADR as such.

## Verification

Every command below was run on this branch. Output is real.

| Command | Result |
|---|---|
| `pnpm typecheck` | pass, clean |
| `pnpm lint` | pass, clean |
| `pnpm format:check` | pass — "All matched files use Prettier code style!" |
| `pnpm test` | **97 files, 1016 tests, all passed** |
| `pnpm test:db` | **23 files, 289 tests, all passed** |
| `pnpm test:runtime` | **5 files, 28 tests, all passed** |
| `pnpm test:e2e:watchtower` | **1 file, 38 tests, all passed** |
| `pnpm test:e2e` | **9 tests, all passed** |
| `pnpm check:teardown` | **FAILED — see below. Not caused by this task.** |

`pnpm verify:phase1` is exactly `verify && test:runtime && test:e2e:watchtower && test:e2e &&
check:teardown`; every component was run individually and passed, and the seeded Phase 1 agent still
runs unchanged with `request_found` / `request_not_found`. The composite command was not run as one
invocation because its final step would fail on the teardown conflict below.

### The teardown failure is the user's `pnpm dev`, not a leak

`check:teardown` reported ports 3000, 3001 and 3002 still held. Process ancestry confirms all three
belong to the user's own dev server, started at 17:27 — before any test run here:

```
6094 ← 85389 (tsx watch src/i…) ← 85374 (pnpm -r --parallel dev) ← 85362 (pnpm dev) ← zsh
```

The API child (pid 6094, 18:08) is a `tsx watch` restart triggered by this task editing API source,
not a stray process. **Nothing of the user's was killed**, per the brief. The ports the e2e stack
actually owns — 3010 and 3102 — were released cleanly and were not flagged.

### Evidence the change reached a real run

`apps/browser-worker/src/library-borrow-or-hold.runtime.test.ts` drives both branches of the library
demo in a real browser and now asserts `businessOutcome === 'borrowed'` and `=== 'held'`. It passes.
That is the proof the outcome name reaches a run's persisted evidence, rather than only the compiler.

### The no-migration claim is tested, not assumed

`packages/db/src/repositories/runs.db.test.ts` gained three tests: that arbitrary declared names are
accepted; that `request_found`, `request_not_found` and `none` still round-trip through the real CHECK
constraint (the reason no row needed migrating); and that malformed names — `Request Found`,
`request-found`, `1st`, empty, 65 characters — are rejected by the database, since a CHECK that accepts
anything is indistinguishable from no CHECK.

## Migration

`packages/db/drizzle/0007_free_form_business_outcomes.sql` — generated with `pnpm db:generate`, then
renamed with the journal `tag` fixed to match, exactly as `0005_agent_archiving.sql` was done. It drops
one CHECK and adds another: a value list becomes a format check. **It touches no row.**

**The user's `orbit_dev` needs `pnpm db:migrate`.** The test databases pick it up automatically.

## Task C — Task 9 plan amendment (no code)

`docs/tasks/phase-2-task-9-bounded-llm-decisions.md` amended, with a note at the top flagging that the
approved plan changed before go-ahead. Two requirements folded into §3:

1. **A judged decision must declare an "insufficient evidence" alternative, compiler-enforced.** If
   the alternatives are `senior | professional | standard`, a record with no evidence still forces a
   confident `standard`, indistinguishable in the evidence from a correct one. Fail-closed has to apply
   to the classification, not only to the plumbing around it. Written as a refusal, not a warning.
2. **A judged decision classifies into a partition, and overlapping categories cannot be expressed by
   a pick-one node.** A 70-year-old doctor is both "senior" and "professional". The three ways out —
   separate decisions per attribute, enumerated combinations, or a policy ranking — are business
   decisions the author must make, and **the compiler cannot detect the mistake**, so this belongs in
   authoring guidance and the ADR. Also added to §6 as a stated limitation.

Recorded as a **proposed follow-up, not built**: the drafting flow's clarification questions are the
natural place to force these into the open for plain-English SOPs — evidence source, the unclear case,
overlapping categories, and any number the prose implies but never states.

**No code was written for Task 9.** It remains awaiting go-ahead.

## Deviations from the brief, and why

**One, and it is a deliberate non-deletion.** The brief's blast-radius list did not mention
`agent_ir_candidates.outcome_mapping`, a `NOT NULL` jsonb column that stored the mapping a person
chose at compile time. With the concept gone it would have been written as `{}` forever.

I kept the column and stopped writing to it (new candidates record `{}`), rather than dropping it.
Reasons: the rows written before this change hold a **real answer a person gave**, and Orbit treats
provenance as first-class; dropping a column is destructive and irreversible on the user's `orbit_dev`;
and the brief's list was explicitly "every consumer, verified", which reads as deliberate rather than
an oversight. `outcomeMapping` was removed from `CreateAgentIrCandidateInput` so no caller can supply
one, and the column, the mapper field and the fixture all carry a comment saying it is historical.

**Suggested follow-up:** a separate, explicitly-approved migration to drop it. That is a destructive
change and deserves its own decision rather than being smuggled into this one.

## Defects self-caught during the work

- **`Exclude<BusinessOutcome, 'none'>` in `packages/runtime/src/ports.ts` had silently become a
  no-op.** Once `BusinessOutcome` widened from an enum to `string`, that `Exclude` resolved to `string`
  while still *reading* as an enforced rule. Left alone it would have been a comment disguised as a
  type. Replaced with `TerminalBusinessOutcome`, with the reservation enforced by the schema at the
  boundary where it can actually be checked.
- **The three publish/compile routes would have silently ignored a stale client.** Dropping the body
  schema entirely would mean a caller still sending `outcomeMapping` got a success with its request
  quietly discarded. The bodies are `z.strictObject({})` instead, so such a caller is told.
- **Changing step kind in the inserter would have sent stale fields.** Fields are per kind, so values
  typed against the previous kind would be submitted as fields the new kind does not have and refused
  as an opaque schema error. Values are cleared on kind change.
- **A closure lost TypeScript's null narrowing** in `SopReviewPage`: `insertSlot` referenced `review`
  inside a function body, where the null check above does not carry. Caught by `typecheck`; fixed by
  destructuring the narrowed value.

## Runtime and executor: verified, not changed

The brief asked which. **Neither `packages/runtime` nor `packages/executor-playwright` needed a
change.** The runtime carries the outcome value straight through — `interpreter.ts` sets
`businessOutcome: step.outcome` and hands it to the recorder — and switches on the specific names
nowhere. `executor-playwright` mentions business outcomes only in comments saying they are not its
job. The single edit made was tightening the now-vacuous type annotation described above; no behaviour
changed.

## Limitations and known gaps

- **Deleting a step is still not possible.** Deliberate: removing a step can strand a branch that
  targets it, and handling that honestly is its own decision. A workflow can now grow but not shrink.
- **A step can be inserted but its branches must be wired by hand.** Adding a `decision` means typing
  its branch target step ids into the editor; nothing offers a picker of existing steps, and a typo is
  caught only by the server's `UNKNOWN_BRANCH_TARGET` refusal. Correct but not comfortable.
- **The inserter does no client-side validation**, by design — the server holds the only copy of
  `validateSopGraph`. The cost is that some mistakes are learned only after clicking Add.
- **Business outcomes are not checked for consistency across an agent's versions.** Renaming an outcome
  between versions produces runs recorded under both names with nothing relating them. Acceptable while
  a run pins its exact Agent Version, but a Watchtower that aggregates outcomes over time will need to
  face it.
- **No UI lists an agent's possible outcomes outside the publish panel**, so a person reading the Runs
  list sees outcome names with no glossary.
- **`agent_ir_candidates.outcome_mapping` is inert but present**, as described above.
- Task 8's open limitation is unchanged: `expect_one_of` still does not re-verify fingerprints at run
  time.
