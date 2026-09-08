# Task P2-009 — Bounded LLM decisions

**Sub-phase:** 2.9
**Branch:** `phase-2-task-9-bounded-llm-decisions`, off `master` at `c655ff1`
**Status:** Complete — **not committed, not merged, not pushed**
**ADR:** ADR-032

## Why this task exists

ADR-029 gave Orbit deterministic branching: a `decision` resolves by the visibility of an element a
person demonstrated. That is exact and free, and it is useless the moment the same meaning arrives in
different words. All three demonstration domains fail identically — retail tracking, helpdesk triage,
municipal permits — and they fail on the *surface* while the declared outcome set stays exactly the
same.

This task adds the other kind of decision, and spends most of its effort on making sure it cannot
become anything more than a branch.

## What was built

### The bound, first, because it is the whole design

**The widest thing a model can do at run time is pick a number between 0 and n−1.** `JudgeResult`
carries `alternativeIndex` — an index into a list the runtime already holds. Nothing it returns
becomes a locator, a URL, a selector, an expression or a step id; `next` comes from the step
definition; and the judge is never *shown* where an alternative leads, so it cannot be steered by
consequence and has no vocabulary for naming a destination.

The runtime **re-validates independently**. `@orbit/decision-judge` deliberately passes an
out-of-range index straight through, with a test saying so: if it filtered, the runtime's own check
would be untestable and would eventually be deleted as dead code — and that is the check that must
not be deleted.

### A port in the runtime, a provider outside it

| Package | What it holds |
|---|---|
| `@orbit/runtime` | `DecisionJudge`, `JudgeRequest`, `JudgeResult` — interface only. **No new dependency at all.** |
| `@orbit/decision-judge` | **New.** The prompt, the Anthropic model layer, the budget check, the ledger write. |
| `apps/browser-worker` | Wires them, exactly as it wires `@orbit/executor-playwright` behind `BrowserExecutor`. |

`packages/runtime/src/decision-judge-boundary.test.ts` proves the runtime reaches no provider — and
it walks the **whole workspace closure**, not just the direct dependency list, because a provider
added two packages away would otherwise arrive unannounced. Verified by planting
`@langchain/core` on `@orbit/execution-mapping`: the test failed with
`@orbit/execution-mapping depends on "@langchain/core"`, then passed again when reverted.

### Files changed, by package

**`@orbit/contracts`** — five error codes (`DECISION_JUDGE_UNAVAILABLE`, `DECISION_JUDGE_FAILED`,
`DECISION_OUT_OF_SET`, `DECISION_LOW_CONFIDENCE`, `DECISION_BUDGET_EXHAUSTED`), three event types
(`decision.requested` / `.resolved` / `.refused`), and the `decision_input` artifact kind and link
role.

**`@orbit/agent-ir`** — `modelDecideStepSchema` (`question`, `readFrom`, `alternatives`,
`confidenceThreshold?`, `timeoutMs?`, `evidence?`); `permissions.model` as its own optional section;
`successorsOf` widened; `validate.ts` gains `MODEL_NOT_PERMITTED` and checks judged branch targets.
Three schema-level refinements: distinct outcome names, distinct source labels, and **exactly one**
`insufficientEvidence` alternative.

**`@orbit/runtime`** — `ports.ts` (the port), `decision.ts` (**new**: read regions, redact, record
evidence, call, validate, jump or halt), `redact.ts` (**new**), `profile.ts` (`model.decide` added to
the allowlist; schema versions `0.1` **and** `0.2`), `interpreter.ts` (the new case and the per-run
call counter), `testing/fake-judge.ts` (**new**), `decision-judge-boundary.test.ts` (**new**).
`drift.ts`, `inputs.ts`, `interpolate.ts`, `prepare.ts`, `persistence/` and `logger.ts` are untouched,
as the plan said.

**`@orbit/model-budget`** — **new**, extracted from `@orbit/sop-generation`. Scopes `run` and `agent`
added beside `global`/`document`/`request`; the rate table and the two pure parsers moved here so the
API and the browser worker share one definition rather than two.

**`@orbit/db`** — `model_usage` gains nullable `run_id` and `agent_version_id`; `totalsForRun` and
`totalsForAgent` added; migration `0008_judged_decisions` widens three CHECK constraints and adds the
columns, indexes and `set null` foreign keys.

**`@orbit/sop-graph`** — `resolution: 'demonstrated' | 'judged'`, `judgement`, and
`insufficientEvidence` on a branch. Still business intent: "we could not tell" is a real business
case.

**`@orbit/agent-ir-compiler`** — compiles a judged decision to `model.decide`, deriving `readFrom`
from the *same demonstrated elements* the deterministic path uses, deduplicated. Two new refusals:
`missing_insufficient_evidence_branch` and `ambiguous_branch_outcome`.

**`apps/web`** — a judged decision renders as one: the conclusion, confidence beside its threshold,
and the model's own account labelled as such.

**`packages/executor-playwright` is byte-identical.** A judged decision needs no browser capability
that did not already exist.

### Fail-closed, five ways

No default branch, no retry into a different answer, no falling back to the first alternative. The
provider is configured with **zero retries** on purpose: a retry is a second chance at a *different*
answer, which is the property a bounded decision exists not to have.

A **missing** confidence fails closed. "The provider did not say" is not evidence that it was sure,
and accepting it would make the threshold optional in practice for any provider that stopped
reporting one.

### One ledger, checked before the call

`checkModelBudget` is called before the model layer is touched, proven by a test in which the stub is
never invoked. `ModelSpend` became partial, and **a limit declared for a scope whose spend cannot be
measured is refused** rather than treated as zero — a ceiling nobody can measure is not a ceiling.

### Audit trail

Question, alternatives offered, the page text as a `decision_input` artifact, chosen outcome and
index, rationale, confidence and threshold, model, provider, tokens, cost, latency. The artifact and
`decision.requested` are written **before** the provider is called, so a call that never returns still
leaves behind what it was asked — asserted by event ordering in a test.

## Verification

Every command run to completion on this branch. `pnpm dev` was already running on 3000/3001/3020;
**no user process was touched**.

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm format:check` | pass |
| `pnpm test` | **1155 passed**, 0 failed (107 files) |
| `pnpm test:db` | **293 passed**, 0 failed (23 files) |
| `pnpm test:runtime` | **33 passed**, 0 failed (6 files) |
| `pnpm test:e2e:watchtower` | **38 passed**, 0 failed |
| `pnpm test:e2e` | **9 passed**, 0 failed |
| `pnpm verify:phase1` | every stage passed; see the note below |

`verify:phase1` chains its stages with `&&`, and the run reached `test:e2e` (9 passed) and then
`check:teardown` — which proves typecheck, lint, format:check, test, test:db, test:runtime and
test:e2e:watchtower all passed on the way. `check:teardown` then reported **ports 3000, 3001 and 3002
still held**. Those are the user's own `pnpm dev` (Watchtower, demo portal, API), not a leak from this
work, and **nothing of theirs was killed**. On a machine with no dev server running, that stage
passes.

**No test calls a real model.** Every test uses `createFakeJudge` or a local stub, and the boundary
test scans test files too — a test that reached a real provider would make the package depend on one
in practice while leaving the production graph looking clean, and it would spend money.

## Deviations from the plan, and why

**1. The judge reads declared regions, not the page.** The plan said "the page text/snapshot the judge
was given" without settling the mechanism. `readFrom` names regions the Agent Version declares,
resolved through the executor's existing `readText`. Three wins: `executor-playwright` stays
untouched (the plan wanted this), the prompt is a reviewed slice rather than whatever the page
contains, and the injection surface shrinks to something a person chose. A container locator is
stable while its text varies — which is precisely the case the feature exists for.

**2. An alternative's `outcome` is not validated against the agent's declared business outcomes.**
The plan's §2.4 said it should be. That rule would have broken the natural example: a judged branch
leads to *more work*, and `available` is a perfectly good conclusion on the way to an outcome the
workflow declares later. Outcome names are validated for shape and for uniqueness within the step
instead, and the reasoning is in the schema comment.

**3. There was no existing redaction path to route page text through.** The plan assumed one. The
only thing named "redact" in the repository is `redactPayload` in `apps/api`, which strips storage
keys from event payloads — unrelated. So `redactForModel` is new, and it lives in **`@orbit/runtime`**
rather than beside the provider: the runtime is what reads the page *and* what stores the artifact,
so redacting in the provider would have sent clean text to the model and written raw text to the
artifact store — the worse half of the problem.

**4. `packages/runtime/src/ports.ts` already existed**, so the port was added to it rather than
created. Likewise `boundary.test.ts` is named `decision-judge-boundary.test.ts`, since the package
had no boundary test to extend.

**5. `@orbit/model-budget` depends on nothing**, not "nothing but zod" — the extracted module had no
Zod in it. The rate table and the two pure parsers moved with it, which the plan did not mention but
which follows from the same one-definition rule: there are now two entry points that need rates.

**6. The `agent` budget scope sums across an agent's *versions*.** The plan said "add `run` and
`agent` scopes" and proposed an `agent_version_id` column. Both exist, but `totalsForAgent` joins
through to the agent, because a cap that reset on republish would be a cap anyone could clear by
publishing.

**7. Schema version is `0.2` only where the widened contract is used.** The plan said the version
"moves to 0.2". Emitting `0.2` unconditionally would make republishing an unchanged document produce
a changed document, so the compiler emits `0.1` for a workflow that uses nothing new.

**8. The plan's §0 correction was right, and the stack had moved.** `master` was at `c655ff1`, not
the `0552e7a` the plan recorded. Nothing in the plan depended on the difference.

## Defects self-caught during the build

**The API-key redaction rule matched nothing real.** `\b(?:sk|pk|api|key|token|secret)[-_][A-Za-z0-9]{16,}\b`
cannot match `sk_live_abcdefghijklmnop`, because the tail contains an underscore. It looks correct in
review and redacts nothing in production. Caught by a test written before the rule was trusted; fixed
to allow `_` and `-` in the tail, with a comment saying why.

**The first per-run-budget test asserted the wrong thing.** It used a judge that rejects on every
call, so the run failed for the wrong reason and the test passed anyway. Replaced with a genuine
two-decision workflow at `maxCallsPerRun: 1`, which now asserts the judge saw exactly one request and
that the second decision halted before the provider was reached.

**The judged demo exposed a real authoring failure, which is kept rather than hidden.** On a title the
catalog shows as "On hold", the judge classifies correctly — no copy can be borrowed — and the run
then *fails*, because the branch behind that classification enters a member ID into a hold form the
catalog does not render for an already-held title. The judgement is right and the workflow is wrong.
The obvious move was to pick a friendlier ISBN; instead the test pins the real behaviour and names
the failing step, and ADR-032 records it as the sibling of the overlapping-categories problem: the
alternatives partition the *question* correctly and partition what the workflow can *do*
incorrectly, and no schema check can catch either.

## Limitations, honestly

**Not verified because it needs a real model:**

- **No real provider call was ever made.** There is no `ANTHROPIC_API_KEY` in this environment. The
  Anthropic model layer's correctness is *structural* — the schema binding, the timeout, the usage
  reader, the zero-retry configuration and the error wrapping are covered against a stub — and it has
  **not** been demonstrated against the real API. Treat the first real call as the test. This is the
  same standing caveat the Bedrock provider carries.
- **Whether the confidence numbers Claude reports are meaningful is unknown.** The threshold
  machinery is exercised end to end, but a model's self-reported confidence is only as useful as the
  model's calibration, and nothing here measures that. `0.8` is a defensible default, not a
  measured one.
- **Prompt quality is untested.** Whether the system prompt actually causes a model to choose the
  insufficient-evidence alternative rather than guessing is a claim about a model, and it is
  unmeasured. The *structural* guarantee holds regardless: a wrong choice is still a declared branch.
- **Prompt-injection resistance is argued, not demonstrated.** No adversarial page was tested against
  a real model. The structural bound means the worst outcome is a wrong declared branch, but the
  prompt's own instruction to treat page content as data is untested against a determined page.
- **Bedrock is not wired for judged decisions.** Only the Anthropic model layer exists. Adding one is
  a new `DecisionModel` implementation and nothing else, but it is not written.

**Known and by design:**

- **Two runs of the same agent against the same page can now differ.** Temperature 0, no retries,
  fail-closed — but the property is real.
- **The compiler cannot check that alternatives partition the cases.** Guidance only. This is the
  limitation most likely to bite an author.
- **Redaction is a reduction, not a guarantee.** It will not recognise a secret that reads like prose,
  and it may redact a harmless string that looks like a key. Both are pinned as tests.
- **Task 8's open limitation is unchanged**: `expect_one_of` still does not re-verify fingerprints at
  run time.
- **The judged workflow is not seeded into `orbit_dev`**, exactly as the branching one is not.
- **`maxCallsPerRun` is set by the compiler from the judged step count**, so a workflow that revisits
  a judged step through a loop would exhaust it — loops are a Phase 1 non-goal and the graph must be
  acyclic, so this cannot currently arise.

## Not done

Not committed, not merged, not pushed, as instructed.

The follow-up ADR-032 records but does not build: pushing the partition questions into the drafting
flow's clarification questions — where the evidence comes from, what the unclear case should do,
whether two categories can be true at once, and any number the prose implies but never states. That
is a change to draft generation, not to the runtime.
