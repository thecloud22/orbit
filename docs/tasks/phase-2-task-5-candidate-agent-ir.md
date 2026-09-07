# Phase 2 — Task 5: Candidate Agent IR (sub-phase 2.5)

## Stack state at the time of writing

| Ref | What | Where |
|---|---|---|
| `6026582` | Task 4d — Watchtower navigation and Documents list | **`master`, pushed to `origin/master`** |
| `cf48126` | Task 4f-1 — a recording becomes a SOP Graph document | branch `phase-2-task-4f-recording-to-sop`, **committed, not merged** |
| `3b9d55d` | Task 4f-2 — record a workflow from Watchtower | branch `phase-2-task-4f2-recording-session`, **committed, not merged** |

4f-2 is stacked directly on 4f-1, which is stacked on master. Neither is merged, matching the
stacking pattern used for 4a/4b/4c. The working tree is clean apart from this brief.

**Branch `phase-2-task-5-candidate-agent-ir` off `phase-2-task-4f2-recording-session` at `3b9d55d`**
— 2.5 needs 4f-1's `provenance.kind: 'recorded'` documents and the bindings 4f-2 produces as real
compile inputs. If 4f-1 and 4f-2 are merged to master first, branch off master instead.

**Known defect to fix first, in its own commit:** `apps/api/src/routes/recording.ts` declares its own
`ALLOWED_RECORDING_HOSTS` array while its comment claims it is "the runtime's own allowlist, not a
second copy of it." It is a second copy. `apps/api` already depends on `@orbit/runtime`, and
`apps/recorder/src/flow.ts` imports `ALLOWED_HOSTS` from it correctly. This is the same
one-definition rule `stepChecksum` exists to satisfy, and a duplicated security constant is exactly
the kind that drifts.

## Goal

Compile a reviewed SOP Graph plus its approved Execution Bindings into **candidate Agent IR**:
validated, persisted, and gated behind a separate technical approval. This task does not publish and
does not run a business workflow — an approved candidate becoming a runnable Agent Version is 2.6.

Per `docs/tasks/phase-2-sop-graph-requirements.md`: compile only supported reviewed mappings,
validate the candidate, design the sandbox/simulation step, and require a separate technical
approval before publishing.

## Preconditions

- 2.4a froze the Execution Binding contract; 2.4b and 2.4f produce bindings that reach `approved`.
- `stepChecksum` lives in `@orbit/db` and **must be imported, never reimplemented** — one definition
  so a binding's staleness check and the compiler's cannot drift (ADR-019).
- The SOP Graph stays non-executable (ADR-016). Compilation reads a graph; it never gives one the
  ability to act.

## Settled decisions

These five are decided, not open. They are recorded here so implementation does not reopen them.

### 1. Outcomes — a mapping carried on the candidate

Agent IR's `complete.outcome` is `terminalBusinessOutcomeSchema`: **`request_found` |
`request_not_found`**, a closed Phase 1 enum in `@orbit/contracts`. A SOP outcome name is any
`[a-z][a-z0-9_]*`, and 4f-1's translator appends `completed` by default (`DEFAULT_OUTCOME_NAME`) —
so a recorded document does not compile without an explicit mapping.

**A declared outcome-name → business-outcome mapping is captured and persisted as part of the
candidate record.** It does not live on the SOP document, `@orbit/sop-graph` is not touched, and the
Phase 1 enum is not widened. Compilation refuses when an outcome name reached by the graph has no
entry in the candidate's mapping, naming the unmapped name.

### 2. Decisions — linear graphs only

Agent IR branches with `browser.expect_one_of`, which needs **one `whenVisible` locator per
alternative**, minimum two. A SOP `decision` step has at least two branches, but its binding carries
one `target`, one `readMethod` and one `condition` — one element, not one per branch.

**2.5 compiles linear graphs only and refuses any document containing a `decision` step.** The
frozen binding schema is not touched. A recorded workflow is linear by construction (ADR-019), so
this still compiles everything recording can produce.

**Stated plainly, and to be repeated in the report:** the reference escalation-review document —
`escalationReviewGraph()` in `packages/sop-graph/src/testing/fixtures.ts`, the worked example from
the requirements doc, with nested decisions and three manual-review paths — **will not compile until
a later task extends branch support.** That is the realistic target Phase 2 is aiming at, and 2.5
does not reach it.

### 3. Multi-field extract — refuse and report as a coverage gap

A SOP `extract` step declares one or more `fields`. `execution_bindings` is unique on
`(document, step, binding_number)` where the number is the supersession chain, so there is exactly
**one current binding per step**, carrying one `variable` and one target. A step declaring more
fields than its binding covers is refused and reported as a coverage gap — never compiled into a
partial extract that silently drops a declared field.

### 4. `manual_review` — refuse with a clear reason

There is no binding kind for it and no Agent IR step for routing to a human. A document containing
one is refused, naming the step. It is never skipped, and never compiled as though the path did not
exist.

### 5. Secrets — compile, but sandbox validation fails closed

A recorded sign-in compiles to a `browser.fill` whose value is `${inputs.password}` against an input
declared `secret`. Phase 1 has no runtime secret resolution.

**Such candidates compile and persist. Publication is blocked in 2.6.** But the sandbox-validation
step in 2.5 must **fail closed**, and the mechanism is explicit rather than implied:

> Before sandbox validation launches a browser, it walks the candidate's steps and collects every
> `${inputs.<id>}` reference whose declared input has type `secret`. If that set is non-empty,
> validation **returns `cannot_validate` with reason `secret_unresolvable`, naming the inputs, and
> never launches a browser at all.** The candidate is persisted as compiled-but-unvalidated.

The check is a precondition on the whole validation run, not a per-step guard reached during
execution — so there is no path on which a browser is open, a password field is present, and the
resolver has nothing to give it. An empty value is never sent to a real field, because no field is
ever reached.

A candidate that has not been validated cannot receive technical approval.

## Additional constraints

- **Allowlist.** A compiled `browser.navigate` URL is still localhost-only, enforced by
  `ALLOWED_HOSTS` in `@orbit/runtime` — imported, not copied.
- **Staleness.** Compilation refuses a binding whose `stepSha256` no longer matches the step it
  binds, using `stepChecksum` from `@orbit/db`.
- **Provenance.** A candidate records exactly which revision and which binding ids it compiled, plus
  its outcome mapping, so a later publication names an immutable input set.
- **Traceability.** Every emitted IR step carries `sourceSopStepIds`, populated truthfully rather
  than with a placeholder.

## Explicit exclusions

- No publication, no Agent Version creation, no business run. That is 2.6.
- Do not modify `@orbit/agent-ir`, `@orbit/execution-mapping`, `@orbit/sop-graph`, or
  `@orbit/contracts`. Every gap that would have required it has been decided around above; if a new
  one appears, stop and ask.
- Do not touch `packages/runtime`, `describeElement`, or the Phase 1 seeded fixture.
- No LLM anywhere in this task. Compilation is deterministic; a model would make an exact
  translation approximate.
- No new dependency.

## Tests

- Compile the Phase 1 `Find Service Request` shape end to end and check the result against the
  seeded fixture's meaning where they overlap — the strongest available evidence that the compiler
  produces real IR rather than IR-shaped output.
- Compile a document produced by 4f-1's recorder, since that is the actual input this exists for.
- Every refusal path, each with its own typed reason and its own test: `decision` present,
  `manual_review` present, unbound step, stale `stepSha256`, unmapped outcome name, extract field
  without a binding.
- `escalationReviewGraph()` is refused, with the reason naming `decision` — pinning the documented
  limitation rather than leaving it to prose.
- Sandbox validation on a candidate with a secret input returns `cannot_validate` /
  `secret_unresolvable` **and no browser is launched**, asserted with a spy on the executor factory,
  not merely by checking the return value.
- Compiler is pure and unit-tested with no database and no browser.
- Candidate persistence, immutability, and the technical-approval transition, against a real
  database.
- Full regression: Phase 1's gate and every Phase 2 gate stay green.

## Model split

Opus owns the compiler, the refusal taxonomy, the sandbox-validation precondition, the persistence
and approval wiring, the final diff review, and the commit. Sonnet may take narrowly-briefed tests
and mechanical repair only.

Return a plan first. Wait for go-ahead before writing code.
