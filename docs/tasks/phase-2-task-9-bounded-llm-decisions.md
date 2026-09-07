# Phase 2 — Task 9: Bounded LLM decisions

**Status:** Plan, awaiting go-ahead. No code written.
**Stack state:** `master` at `0552e7a` (Task 8: branching, three-scope spend cap, library demo). Tree clean.
**Proposed branch:** `phase-2-task-9-bounded-llm-decisions` off master.

---

> **Amended after the original plan was written, before go-ahead.** Two requirements came out of a
> later design conversation and are folded into §3: a judged decision **must** declare an
> "insufficient evidence" alternative (compiler-enforced), and a judged decision classifies into a
> **partition**, whose overlapping-category failure the compiler cannot detect and which therefore
> belongs in authoring guidance and the ADR. Both are in §3; §6 carries the limitation. No code for
> this task has been written — it is still awaiting go-ahead.

## 0. One correction before anything else

The brief says this task crosses a boundary "deterministic branching already crossed once."

**It did not.** Task 8 left `packages/runtime`, `packages/agent-ir` and `packages/executor-playwright`
byte-identical — `git diff` against all three is empty, which is why the commit says so explicitly.
Branching worked because `browser.expect_one_of` and its interpreter case had existed since Phase 1
and nobody had noticed; the entire change was one field of one Execution Binding schema.

So this task is **the first time either boundary is crossed at all**, not the second. That makes the
brief's instruction more load-bearing rather than less, and it is why §2 exists.

---

## 1. The problem, in the brief's own three domains

| Domain | Demonstrated | A later run actually shows | Declared outcomes |
|---|---|---|---|
| Retail order tracking | "Preparing for shipment" | "Out for delivery", "Delayed at carrier", "Return initiated" | `shipped` / `escalate` |
| Helpdesk triage | one closed-ticket layout | "Pending customer response", "Reopened", escalation language in a reply nowhere near the bound status field | `resolved` / `needs_human` |
| Municipal permits | one city's coloured badge | another city's paragraph; a third city's table row | `approved` / `follow_up` |

The deterministic branch built in Task 8 resolves by **visibility of a demonstrated element**. That is
exactly right when the page states its condition the same way every time, and useless the moment the
same meaning arrives in different words or a different layout. The declared outcome set never changed
in any of the three cases — only the surface did.

That is the whole and only job of this node: **map a messier page onto the graph's own pre-declared
outcomes.** Not "decide what to do." Not "find the element." Not "recover from failure."

---

## 2. What this touches in `packages/runtime` and the Agent IR contract

Flagged file by file, as asked.

### 2.1 The central decision: the runtime gets a *port*, never a provider

**`packages/runtime` will not gain a model-provider dependency.** Its `package.json` gains no
dependency at all. It gains an *interface* — exactly the way it already treats the browser:

```ts
// packages/runtime/src/ports.ts — alongside BrowserExecutor
export interface DecisionJudge {
  judge(request: JudgeRequest): Promise<JudgeResult>;
}
```

`@orbit/runtime` already declares `BrowserExecutor` and never imports Playwright; the composition root
(`apps/browser-worker`) injects `@orbit/executor-playwright`. The same seam carries the judge: the
implementation — Anthropic client, budget check, ledger write — lives outside the runtime and is wired
in by the same composition root.

This matters beyond tidiness. ADR-008 denies the runtime broad capability on purpose. Handing it an
LLM client would mean the process that executes approved steps could also call a model for any reason
it liked. Handing it a one-method interface that returns *an index into a closed list* cannot be
repurposed, and a boundary test can prove the package imports no provider — the same proof
`recording-boundary.test.ts` already makes for script injection.

### 2.2 `packages/runtime` — every file the plan touches

| File | Change |
|---|---|
| `ports.ts` | **New.** `DecisionJudge`, `JudgeRequest`, `JudgeResult`. Interface only. |
| `interpreter.ts` | **New case** for the model-judged step. Calls the judge, validates the answer against the step's own declared alternatives, jumps or halts. Mirrors the existing `browser.expect_one_of` case, which already returns `next`. |
| `profile.ts` | Add the new step type to `SUPPORTED_STEP_TYPES`. It is an `as const` exhaustive allowlist by design, so this is a deliberate one-line widening. Also refuse the step when no judge is wired — an agent that needs judgement must not run on a runtime that cannot judge. |
| `errors.ts` | New typed error codes: judge unavailable, judge failed/timed out, answer outside the declared set, budget exhausted. Fail-closed needs a *reason*, not a generic failure. |
| `evidence.ts` | Record the decision's inputs and chosen outcome as evidence. |
| `index.ts` | Export the new port and error types. |
| `testing/` | A deterministic fake judge, mirroring `createFakeBrowser`. Every test uses it; no test calls a model. |
| **new** `boundary.test.ts` | Proves `@orbit/runtime` imports no model provider, transitively. |

`drift.ts`, `inputs.ts`, `interpolate.ts`, `prepare.ts`, `persistence/`, `logger.ts` are untouched.

### 2.3 The Agent IR contract — every file the plan touches

| File | Change |
|---|---|
| `steps.ts` | **New step type**, proposed `model.decide`: `{ question, alternatives: [{ outcome, description, next }] (min 2), timeoutMs?, evidence? }`. The `outcome` names come from the graph's own declared outcomes; `next` is a step id, exactly as `expect_one_of` already does. |
| `graph.ts` | `successorsOf` returns the alternatives' `next` targets — the same branch shape already implemented for `expect_one_of`. Acyclicity and definite-assignment analysis then work unchanged. |
| `permissions.ts` | **New `permissions.model` section** — `{ allowed: true, maxCallsPerRun }`. Browser permissions are browser-only, and a model call is a different capability; it gets its own declaration rather than being smuggled in under a browser grant. An agent without it cannot contain this step, enforced by the validator. |
| `validate.ts` | Every alternative's `outcome` must be one the agent actually declares; every `next` must resolve; at least two alternatives; the step requires the model permission. |
| `parse.ts` / `agent-ir.ts` | Wire the new step into the union. |

`assertions.ts`, `locator.ts`, `interpolation.ts`, `declarations.ts` are untouched.

**Schema version.** This widens the executable contract, so `SUPPORTED_SCHEMA_VERSIONS` moves to
`0.2` and existing `0.1` agents keep running unchanged — no republish, no migration of any published
version. Stated as an explicit compatibility commitment, not left implied.

### 2.4 Everything else

`packages/agent-ir-compiler` (compile a SOP `decision` marked as judged), `@orbit/sop-graph` (a flag on
the decision step saying which kind it is), `apps/browser-worker` (wire the judge), `apps/api`
(evidence views), `packages/db` (ledger columns + migration), Watchtower (show the decision and its
evidence). `packages/executor-playwright` stays untouched.

---

## 3. Keeping it bounded

The brief's four requirements, mapped to mechanisms rather than intentions.

### Typed, closed output only

The judge is asked to choose **one of the step's own declared alternatives**, and the provider is
called with a structured-output schema whose answer field is an *enum of exactly those outcome names*
— the same `withStructuredOutput` mechanism `@orbit/sop-generation` already uses. The model cannot
return a name that is not in the list without failing its own schema.

The runtime then **re-validates independently**, because a provider honouring a schema is a
convenience, not a guarantee.

### A hard parse boundary between judgment and action

The judge's return type is deliberately not a string:

```ts
type JudgeResult =
  | { ok: true; alternativeIndex: number; confidence?: number; rationale?: string }
  | { ok: false; reason: 'no_match' | 'provider_failed' | 'timed_out' | 'budget_exhausted' };
```

`alternativeIndex` is an **index into a list the runtime already holds**. Nothing the model returns
becomes a locator, a URL, a selector, an expression, or a step id. `rationale` is recorded as evidence
and **never read by any code path** — it is for a human reading the run afterwards, and a test asserts
it never reaches control flow. The step's `next` comes from the *step definition*, not the response.

This is the property worth stating loudly: the widest thing the model can do at run time is pick a
number between 0 and n-1.

### Fail-closed

Any of: provider error, timeout, answer outside the set, low-confidence below a declared threshold,
or budget exhausted → **the run halts** with a typed error naming which. It never falls through to a
default branch, never retries into a different answer, never picks the first alternative. A test
exists for each refusal path, and the fake judge can produce each one.

### A judged decision must declare an "insufficient evidence" alternative

**Compiler-enforced, not advisory.** A judged step whose alternatives are `senior | professional |
standard` forces a confident answer for a record carrying no evidence either way — and `standard`,
returned because nothing else fit, is indistinguishable in the run's evidence from `standard` returned
because it was right. The whole fail-closed argument above is about the plumbing around the
classification; this applies it to the classification itself.

So the compiler refuses a judged decision that does not declare an alternative meaning *the evidence
does not settle this*, and the judge is instructed to choose it rather than guess. Where that
alternative leads is the author's business decision — a `manual_review` step is the obvious
destination, and nothing forces it.

This is a refusal, not a warning. A judged step with no escape hatch is the shape that produces
confident wrong answers at scale, and it must not compile.

### A judged decision classifies into a partition, and the compiler cannot check that it is one

A pick-one node returns exactly one alternative, so its alternatives must be **mutually exclusive and
jointly exhaustive** over the cases the workflow will meet. A 70-year-old doctor is both "senior" and
"professional"; asking a judge to pick one is asking it to break a tie the SOP never explained, and
whichever it picks will look like an answer.

**The compiler cannot detect this.** Overlap is a fact about the author's business meanings, not about
the graph, and nothing in the schema distinguishes `senior | professional` from `available | on_loan`.
So it belongs in authoring guidance and in the ADR, stated as a limitation rather than pretended away.
The three ways out are all business decisions the author has to make:

| Way out | What it looks like | When it fits |
|---|---|---|
| Separate decisions per attribute | One judged step per axis: age band, then occupation | The attributes are genuinely independent and both matter |
| Enumerated combinations | `senior_professional`, `senior_other`, … as distinct alternatives | Few attributes, and the combinations really do behave differently |
| A policy ranking | One decision whose alternatives are ordered, with the SOP stating which wins | There is a real precedence rule the business already applies |

Guidance must say plainly that picking none of these — and leaving overlapping categories on a
pick-one node — is the failure mode, because it produces a workflow that runs, never errors, and is
quietly wrong on every overlapping case.

**Proposed follow-up, not built here.** The drafting flow's clarification questions are the natural
place to force these questions into the open for a plain-English SOP: where the evidence for this
judgement comes from, what the unclear case should do, whether any two categories can be true at once,
and any number the prose implies but never states ("recent", "large", "senior"). That is a change to
draft generation rather than to the runtime, so it is recorded here as a follow-up and is explicitly
outside this task.

### Full audit trail

Nothing calls a model during execution today, so this is new evidence, not an extension:

- New event types (`decision.requested`, `decision.resolved`, `decision.refused`) alongside the
  existing `step.*` family.
- Persisted per decision: the question, the alternatives offered, the page text/snapshot the judge was
  given, the chosen outcome and index, the rationale, the model and provider, token usage and cost,
  and the latency.
- The page content sent to the judge is captured as an artifact, so "what did it actually look at"
  is answerable months later — the same standard the rest of the evidence model already meets.

**Secrets:** the judge receives page text. A password field's value is never captured (the recorder
already guarantees this), but page text is broader than an element. The prompt input goes through the
existing redaction path before it is sent *or* stored, and this is called out as a residual risk in
the ADR rather than assumed away.

### Cost cap extended to runs

Reuse, not a parallel mechanism. `packages/sop-generation/src/budget.ts` is already scope-generic —
its scopes are `global | document | request` and `checkModelBudget` is a pure function with no
provider dependency. The plan:

1. **Move `budget.ts` and the rate table into a small shared package** (`@orbit/model-budget`) that
   depends on nothing but `zod`. `@orbit/sop-generation` keeps working through it unchanged; the
   judge implementation uses the same function. One definition, as with `stepChecksum`.
2. **Add `run` and `agent` scopes** beside the existing three. The ledger already has `requestId` and
   a nullable `documentId`; it gains nullable `run_id` and `agent_version_id` — **one migration**.
3. Every scope stays a `SUM` over the append-only ledger, so no running total exists to drift.
4. Checked **before** each judge call. A run that exhausts its budget mid-flight halts fail-closed
   with `budget_exhausted`, which is already one of the refusal reasons above — a looping agent
   cannot spend without limit.

---

## 4. How the three domains land

Same graph shape, three different surfaces — which is the point:

```
model.decide  "Has this order shipped?"
  alternatives:
    - outcome: shipped   → next: extract_tracking_number
    - outcome: escalate  → next: open_support_ticket
```

"Out for delivery" and "Delayed at carrier" both map to a declared outcome that a bound selector would
have missed entirely. The helpdesk case is the same node with `resolved` / `needs_human`; the permit
case with `approved` / `follow_up`. No new vocabulary per domain, and the declared outcome set is
still the one a person approved.

**Choosing the kind of decision is a review-time decision, not a run-time one.** A SOP decision step
is marked either deterministic (Task 8: bound elements, no model, free) or judged (this task: a model
call, costs money, needs the permission). Watchtower shows which, and the default stays deterministic
— a model call is opt-in per step, not a fallback the system reaches for on its own.

---

## 5. Tests

- **Bounded-output tests are the centre of gravity.** A fake judge returning an out-of-range index, an
  unknown outcome name, a string where an index belongs, and something shaped like a tool call — all
  four must halt the run, not steer it.
- `rationale` never influences control flow (asserted directly).
- Each fail-closed path produces its own typed error and a `run.failed` with a distinguishable reason.
- Budget: refused **before** the provider is called, proven by the fake never being invoked; run-scope
  exhaustion halts a multi-decision run partway with evidence for the decisions already made.
- Evidence: a judged run reconstructs fully from persisted data — question, input, choice, cost.
- Boundary: `@orbit/runtime` imports no provider, transitively.
- A real-browser runtime test over the library portal, where a judged decision reads a status the
  deterministic branch was never bound to.
- Regression: every `0.1` agent still runs; `verify:phase1` unchanged.

---

## 6. Risks and limits, stated up front

- **This is the first non-deterministic thing in an execution path whose entire value proposition has
  been determinism.** Two runs of the same agent against the same page can now differ. The mitigations
  are that it is opt-in per step, bounded to an index, fail-closed, fully audited, and capped — but
  the property is real and belongs in the ADR, not in a footnote.
- **Latency and cost per run** rise wherever a judged decision is used.
- **Prompt-injection is a live surface**: page content becomes model input, and a hostile page can try
  to talk to the judge. The closed-enum output is the structural defence — the worst achievable
  outcome is picking the wrong declared branch, never executing an instruction. Worth saying plainly:
  that is a real risk, reduced to a bounded one, not eliminated.
- **Trust tier.** Phase 1 is Tier 0, read-only. A judged decision is still read-only, but it is
  judgement, so ADR-013's tiers should say where this sits rather than leaving it unstated.
- **Overlapping categories cannot be expressed by a pick-one node, and nothing detects the mistake.**
  If two of a judged step's alternatives can be true of the same record, the judge will still return
  exactly one and the run will look correct. This is a property of the author's business meanings, so
  no schema check can catch it — only guidance and review (§3).
- **Task 8's open limitation is unchanged**: `expect_one_of` still does not re-verify fingerprints at
  run time. Adjacent, not fixed here.

---

## 7. Open question for the go-ahead

**Confidence threshold — declared per step, or global?** A judge that is 51% sure is different from
one that is 99% sure, and "halt below a threshold" is the safer default. I would put an optional
threshold on the step (author-declared, defaulting to a conservative global) — but it adds a field to
a contract I would rather widen once, so I want it settled before writing code rather than added
after.
