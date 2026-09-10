# Orbit: an architecture point of view (v1.0 — long form)

> **Read [`point-of-view.md`](./point-of-view.md) first.** That is v1.1: the same argument in five
> minutes, for an architect or a CIO. This document is the evidence base behind it — every claim
> traced to a file, a test, or an ADR. Come here to check something v1.1 asserts.

**Status:** Position paper. Written for architects who have already made the objection below.
Everything factual here is cited to a file, a test, or an ADR, and was measured against the
repository rather than recalled. Where Orbit is worse than the alternatives it is said plainly
and early, because a point-of-view document that only argues one side is worthless in a review.

**Audience:** People who have said, or are about to say, *"you manipulate the DOM with selectors,
so you've built an RPA bot, nothing more."*

---

## 1. Thesis

The hard part of business automation is not driving the browser. It is holding a reviewable,
version-pinned, re-derivable account of **why** a run did what it did, and refusing to run at all
when that account cannot be produced.

Measured against this repository: the entire browser-driving layer is **446 non-test lines**
(`packages/executor-playwright/src`). All three execution adapters together — browser, terminal,
HTTP — are **993**. The layer that decides what may be executed, what an agent is permitted to
touch, when to refuse, and what to record is **13,356**. That is the ratio the objection has to
account for.

Three claims, each checkable in the tree:

1. **Business intent and element addressing are separate artifacts, and the separation is enforced
   by test rather than by convention.** `packages/sop-graph/src/safety-boundary.test.ts` statically
   forbids `playwright`, `page.`, `chromium`, `fetch(`, `node:net`, `node:http`, `child_process`,
   `node:tls`, `undici`, `3270`, and the four Orbit packages that could reach an executor, from
   every non-test file in the business-intent package. Sixteen such boundary tests exist across the
   workspace.
2. **No page read and no model answer can introduce a branch nobody approved.** The widest thing a
   model does at run time is return an integer in `[0, n)` indexing a list the runtime already
   holds (ADR-032). The judge is never even shown where an alternative leads.
3. **The DOM is not the architecture.** Three surfaces already run behind one interpreter, each
   with its own permission section, its own closed addressing vocabulary, and its own evidence set
   (ADR-037). The browser was swapped out, twice, without changing runtime semantics.

Two claims deliberately **not** made:

- Orbit is **not** more robust to page change than a runtime browser agent. It is more
  *diagnosable* when the page changes. Those are different properties and the second one costs
  availability.
- Orbit today does **less** than a mature RPA suite, not more. It has never changed a record in a
  system it did not author.

**How to falsify this thesis:** show that buyers of automation do not read evidence, do not need a
pre-approved artifact, and prefer a 2% silent wrong-answer rate to a 15% halt rate. If that is the
market, Orbit's 13,356 lines are overhead and browser-use wins on cost per task.

---

## 2. The objection, at its strongest

Stated properly, because the weak version is easy and useless.

> **You have a locator. You call `page.click`. You have built an RPA bot with better prose.**
>
> 1. `role_and_name` is a selector. Renaming it "a closed addressing vocabulary" does not make it
>    less of a selector, and it breaks on exactly the same page changes `#submit-btn` breaks on.
> 2. The fingerprint is a fancier selector with more fields to mismatch. It does not survive a
>    redesign; it just fails more verbosely.
> 3. "Separate business intent from implementation" is the oldest promise in the RPA category.
>    UiPath has an Object Repository, workflow XAML, and a business-rules layer. Blue Prism has
>    Objects and Processes, separated since 2003. You have reinvented a layering the category
>    already claims.
> 4. Determinism is not an achievement. Everything is deterministic until you add a model.
>    Claiming architecture credit for *not* doing something is claiming credit for the default.
> 5. Three adapters behind an interface is the ports-and-adapters pattern. 993 lines of adapter
>    behind 13,356 lines of ceremony is a bad ratio, not a good one.
> 6. Your one interesting property — refusing to proceed — is available in any tool by writing a
>    guard clause.

### What lands

**(1) lands.** `role_and_name` is an addressing scheme and it does break. The narrower claim Orbit
actually makes is that no *program* is representable: a CSS or XPath string is a small program for
walking the DOM, and once one can be expressed, "no arbitrary selectors" is a convention rather
than a property of the type (`packages/agent-ir/src/locator.ts`). That is a real difference in
**reviewability** — every locator names the element by something a person can read on the page —
and only a difference of degree in **brittleness**. Anyone selling it as a robustness win is
overselling.

**(2) mostly lands.** ADR-018 concedes it in the ADR itself: *"A fingerprint is not a guarantee. A
page can change in ways it does not capture — the same role, name and text on a genuinely different
control. It raises the cost of an undetected substitution; it does not eliminate it."* Fingerprints
buy diagnosis, not survival.

**(3) partly lands.** RPA tools do separate the two. The difference is not that Orbit separates,
it is what happens when the separation is *violated*: a binding carries `stepSha256`, so editing
the business step makes the binding provably stale and the compiler refuses with `stale_binding`
rather than warning. RPA tools generally warn. That is a smaller difference than Orbit's marketing
would like and a larger one than "same thing with better prose."

**(4) lands, and is worth conceding loudly.** Determinism by default is the null hypothesis.
The claim worth making is the inverse: the two places non-determinism was admitted are *named,
typed, opt-in per step, permissioned, budgeted, capped, and audited*, rather than ambient. A judged
decision requires `permissions.model` on the published version; a recovery proposal requires
`permissions.recovery`; both are absent-means-denied. That is a claim about containment, not about
purity.

**(5) misreads the ratio, but the correction is modest.** The 13,356 lines are not ceremony around
the adapters; they are the compiler, the permission model, the interpreter, the evidence
persistence and the refusal logic — the product. The adapters being small is the *consequence* of
having put the decisions elsewhere. But line count proves nothing about whether those 13,356 lines
are any good.

**(6) is the strongest form of the objection and does not fully land.** A guard clause you can
write is a guard clause you can also not write. Orbit's refusals are in the compiler and the
type system: `permissionsSchema` makes an ungranted surface unrepresentable at publish;
`STEP_SURFACE_PERMISSION` is a `satisfies` table so a step type with no permission mapping fails to
compile; the interpreter's step `switch` has no `default`, so an unhandled step type is a compile
error. The difference between "you can write a guard" and "you cannot write the thing the guard
would have caught" is the whole argument, and it is a real one.

---

## 3. What is actually enforced

Not aspirations. Tests that fail.

| Boundary | Where | What it forbids |
|---|---|---|
| Business intent cannot execute | `packages/sop-graph/src/safety-boundary.test.ts` | Browser, network and execution vocabulary in source; a runtime proof that parse/validate/reorder never call `fetch`; no exported callable named `run*`/`execute*`/`navigate*`/`publish*`/`open*`/`send*` |
| Runtime cannot reach a model | `packages/runtime/src/steps/decision-judge-boundary.test.ts` | `@anthropic-ai/`, `@aws-sdk/`, `openai`, `langchain`, and Orbit's own `@orbit/decision-judge`, `@orbit/sop-generation`, `@orbit/model-provider` — through the whole workspace closure, not just direct dependencies |
| Runtime cannot reach the recorder or the drift diagnoser | same file, plus `packages/drift-recovery/src/boundary.test.ts` | Script-injection code and diagnosis logic reachable from the process that executes agents |
| Script injection is one file | `packages/execution-recorder/src/boundary.test.ts`, `apps/browser-worker/src/recording-boundary.test.ts`, `apps/api/src/recording-boundary.test.ts` | Any execution path importing the capture engine |
| Compiler is pure | `packages/agent-ir-compiler/src/boundary.test.ts` | `@orbit/db` by exact path, so only the checksum subpath is reachable |
| No network in generation/service layers | `packages/sop-generation/src/network-boundary.test.ts`, `packages/sop-service/src/network-boundary.test.ts`, `packages/decision-judge/src/network-boundary.test.ts` | Ambient network reach where a provider port is expected |

Sixteen boundary tests total (`find packages apps -name "*boundary*.test.ts"`). Against 56,304
non-test source lines there are 36,523 test lines.

### The layers, with what each may hold

```text
SOP Graph          business intent. No selectors, no URLs it may navigate, no executable form.
  ↓
Execution Binding  (document, step) → ranked locator chain + fingerprint + stepSha256.
  ↓
Agent IR           typed, closed step union; one locator per step; per-surface permissions.
  ↓
Runtime            interpreter over ports. Holds the page and the fingerprint; decides.
  ↓
Executors          browser 446 / terminal 409 / http 138 lines. Perform, classify failures, nothing else.
```

The browser capability interface is **thirteen methods** — `navigate`, `fill`, `click`,
`waitForVisible`, `isVisible`, `waitForText`, `readText`, `describeElement`, `captureScreenshot`,
`captureDom`, `finishEvidence`, `close`, plus the factory's `open`. There is no `evaluate`, no
page handle, and no generic `perform(action, payload)`. ADR-037 refused the generic method on the
grounds that *"the set of things Orbit can do is a list, and widening it must show up in review."*
That is the concrete meaning of "no arbitrary DOM program," and it is checkable in one file.

### The three ways a decision resolves

| Resolution | Mechanism | Determinism | Cost | Permission |
|---|---|---|---|---|
| `demonstrated` | `browser.expect_one_of`; a branch carries `whenVisible: Locator` | Exact | Free | `permissions.browser` |
| `computed` | `value.compare` over two values already in scope (ADR-040) | Exact | Free, no executor opened | None — touches no surface |
| `judged` | `model.decide`; model returns an index (ADR-032) | **Not deterministic** | Model call | `permissions.model`, with `maxCallsPerRun` and a token budget |

The property that matters across all three: **the branch set is fixed at publish time.** A judged
decision's judge receives the alternatives and not their destinations; `next` comes from the step
definition. A computed decision has exactly two branches and one must be marked `otherwise` — never
read off array position, because reordering two rows in an editor would otherwise silently invert
a lending decision.

And the refusals. `packages/agent-ir-compiler/src/refusals.ts` carries **fifteen** named codes,
collected rather than thrown one at a time, each naming a step:

```text
missing_branch_binding          unresolved_branch_target       missing_insufficient_evidence_branch
ambiguous_branch_outcome        manual_review_unsupported      call_binding_unsupported
missing_binding                 stale_binding                  extract_coverage_gap
unusable_outcome_name           unsupported_input_type         unusable_value_source
missing_destination             uncompilable_comparison        invalid_candidate
```

A tool with no refusals has no compile-time safety. This list is a menu of things Orbit will not do,
and it is a better description of the product than any feature list.

---

## 4. What the line counts prove, and what they do not

Measured with test files, `testing/` fixtures and `__tests__/` excluded:

| Layer | Non-test lines |
|---|---|
| `packages/executor-playwright` | **446** |
| `packages/executor-x3270` | 409 |
| `packages/executor-http` | 138 |
| **All execution adapters** | **993** |
| sop-graph, execution-mapping, agent-ir, agent-ir-compiler, runtime, execution-recorder, sop-recording, apps/recorder, drift-recovery | **13,356** |
| apps/web, apps/api, contracts, artifacts | 23,119 |
| Whole workspace (non-test) | 56,304 |
| Tests | 36,523 |

**What this supports:** "you've built a DOM bot" is a claim about 0.8% of the non-test code. The
browser is demonstrably not where the design effort went.

**What this does not support:** that the other 99% is any good. 13,356 lines of determinism
machinery could be 13,356 lines of ceremony. Line count is a rebuttal to a specific claim about
*emphasis*, not evidence of quality. Do not let anyone — including this document — use it as more
than that.

---

## 5. The same task, three ways

**Task:** for a mortgage file, read loan-to-value, debt-to-income, credit score and FEMA flood
zone; apply four underwriting rules in order; attach any conditions they require; then read the
income analyst's note and decide whether the income needs two years of tax returns; approve, refer
or decline; record the decision.

Real workflow: `packages/sop-graph/src/testing/mortgage.ts`, executed in
`apps/browser-worker/src/mortgage-underwriting.runtime.test.ts` against `apps/mortgage-portal`.

### (a) RPA recording

The artifact is a recorded workflow: a sequence of activities, selectors captured inline or in an
object repository, and the four rules expressed as `If` activities over expressions —
`Convert.ToDouble(ltvText.Replace("%","")) > 80`. Ordering is the flowchart's edge structure.

**What it gets right, and it is a lot.** It runs today. It performs state-changing work against
real systems. It has an orchestrator, queues, schedules, retry policy, an attended mode, a
credential vault, and twenty years of connectors. If your requirement is "automate this by Friday
and it writes to SAP," this wins and nothing here disputes that.

**What it gets wrong for this task.** The rule and the click are the same artifact, so a
credit-risk reviewer signing off on the process is signing off on an implementation. The threshold
`80` is a literal inside an expression that also performs a string parse — one edit changes the
lending policy and the parsing behaviour at once, with no distinct artifact for either. And unless
the team was unusually disciplined about pinning workflow versions per run, a run from six months
ago cannot be interpreted against the workflow as it existed then.

### (b) browser-use prompt

```text
Go to the Meridian LOS at https://los.example.com, open loan ML-26-04488, and read
the loan-to-value, debt-to-income, credit score and FEMA flood zone. Decline the file
if the credit score is under 620. Otherwise refer it to a senior underwriter if DTI is
over 43%. Otherwise attach a PMI condition if LTV is over 80%, and attach a flood
condition if the zone is not X. Then read the income analyst's note: if the income is
self-employed or seasonal, attach the two-years-of-returns condition. Approve the file
and tell me the recorded decision.
```

**What it gets right, and it is genuinely more than Orbit.** This exists in thirty seconds. Nobody
records anything, nobody binds anything, nothing is published. If the LOS ships a redesign
overnight, the model looks at the new page and usually carries on — which is the failure mode that
stops Orbit dead. When the site demands a login, browser-use hands the session to a human and
resumes. Orbit cannot do that at all. And on their published figures — 82% on their own hard
internal set, 98% on Online-Mind2Web — it is a serious tool, not a toy.

**What it gets wrong for *this* task.** Rule ordering is a suggestion. The model will compare
92.09 against 80 correctly almost always; the problem is not arithmetic, it is that the run which
got it wrong is indistinguishable from the ones that got it right without a human reading the
trajectory. There is no artifact a credit committee can approve *in advance*, because the artifact
is a paragraph anyone can edit and nothing pins a version to a run. And 98% is not a reliability
figure for a lending decision — it is a sampling figure. It tells you nothing about *which* 2%, and
offers no mechanism by which the failing 2% halts rather than proceeds.

### (c) Orbit: graph, then binding

The business artifact, verbatim from the fixture:

```ts
{
  id: 'check_pmi_threshold',
  kind: 'decision',
  question: 'Is loan-to-value above the mortgage insurance threshold?',
  ruleText:
    'A file whose loan-to-value exceeds 80% requires private mortgage insurance before closing.',
  resolution: 'computed',
  comparison: { left: '${variables.loanToValue}', operator: 'gt', right: '80' },
  branches: [
    { when: 'above 80%',       nextStepId: 'add_pmi_condition' },
    { when: 'at or below 80%', nextStepId: 'check_flood_zone', otherwise: true },
  ],
}
```

Note what is absent: no locator, no URL, no page. The element addressing lives in a separate
Execution Binding keyed by `(document, step)` and carrying `stepSha256`, so editing this rule's
`ruleText` invalidates nothing, while editing the *step* makes its binding provably stale. The
comparison touches no surface at all — it opens no executor, consumes no permission, and costs
nothing.

The compiler refuses this step outright with `uncompilable_comparison` if no step in the workflow
reads `loanToValue`. There is no ratio operator and no arithmetic: Orbit reads figures the system of
record computed and stands behind, rather than becoming a second, unaudited calculator that
disagrees with it in rounding first and in substance eventually.

**What it costs.** Somebody recorded the workflow. Somebody bound every step against a live page.
The compiler refused to produce anything until every step that needs a binding had an approved one.
And none of it can log in.

---

## 6. Trade-offs

| Dimension | Typical RPA | browser-use | Orbit |
|---|---|---|---|
| Time to first working automation | Hours to days | **Minutes** | Days |
| Authoring cost per workflow | Moderate, skilled | **~Zero** | High |
| Marginal cost per run | Licence + compute | ~$0.24/1M input tokens + ~$0.02/browser-hour | Compute only, unless a judged step is used |
| Page changed, element renamed | Fails, or silently hits the wrong element | **Usually adapts** | **Halts before the action**, typed `drift.failure`, evidence captured |
| Page changed, meaning changed | Silently wrong | Silently wrong | Halts (fingerprint compares role, accessible name, text) |
| Ambiguous business case | Whatever the expression evaluates to | Model picks; no "I don't know" unless prompted | Judged decisions **cannot compile** without an `insufficientEvidence` branch |
| Value it cannot parse (`—`, `N/A`) | Coerces, usually to 0 | Model interprets | **Halts** with `COMPARISON_NOT_COMPARABLE` naming the raw text |
| Pre-execution review artifact | The workflow (= the implementation) | The prompt | The SOP Graph — reviewed separately from the bindings |
| Version pinning per run | Varies by product; often weak | None | Immutable Agent Version; run pins its id and `irSha256` |
| Reconstruct a run a year later | Logs and screenshots, if retained | Trajectory, if retained | Events, screenshots, DOM snapshots, Playwright trace, both resolved operands of every comparison |
| State-changing actions | **Yes, day one** | **Yes** | **No.** Tier 0 read-only |
| Credentials | **Vault, mature** | **Human takeover** | References resolvable at run time (ADR-038), but nothing maps a recording to one — so a sign-in workflow can never be approved |
| Non-browser systems | Mainframe, SAP, Citrix, files, email | Browser only | Browser + 3270 terminal + HTTP API behind one interpreter |
| Accountability when wrong | The team that recorded it | Diffuse | The person who approved the version, named in an immutable artifact |

---

## 7. Worked examples

All from `apps/browser-worker/src/mortgage-underwriting.runtime.test.ts`, running a real browser
against a published version.

### `ML-26-04547` — rule ordering is semantics, not optimisation

FICO 596, LTV 96.25, DTI 38.00. The credit floor is the first rule, so the file is declined and
**its DTI and LTV are never compared**. The test asserts the absence:

```ts
expect(comparison('check_credit_floor')).toMatchObject({
  describedAs: 'Credit Score is less than 620',
  leftValue: '596', rightValue: '620', conditionHolds: true, next: 'decline_file',
});
expect(ranStepIds).not.toContain('check_dti_limit');
expect(ranStepIds).not.toContain('check_pmi_threshold');
```

An expression language would give the same *outcome* from `fico < 620 || dti > 43 || ...` and a
different *meaning*: the DTI would have been an input to the decision. ADR-040 refuses `and`/`or`
for exactly this reason — a rule needing two conditions is two decisions in sequence, which is also
how it reads to whoever reviews it. The evidence records the absence as much as the presence.

### `ML-26-04529` — the question that is never asked

DTI 47.00 refers the file. Its LTV is 95.00 and would have required mortgage insurance. That
question is never reached, which is how an underwriter actually works. Nothing structurally
prevents a runtime agent from mentioning the PMI requirement in its summary of a referred file —
and a summary that discusses a condition the process never evaluated is a plausible, confident,
wrong artifact.

### `ML-26-04502` — four free deterministic answers, one paid one

Every ratio is inside its limit: all four computed rules resolve `conditionHolds: false`, free and
exactly. The file still collects a condition, because a model reads the income analyst's prose and
finds seasonal self-employment. One model call, on the only question in the workflow that a number
could not settle.

This is the argument for having three resolutions rather than two. ADR-040 states the second-order
effect plainly: *"Judged decisions stay rare, which is what keeps them trustworthy. Scrutiny scales
when there is less to scrutinise."* Before computed decisions existed, every rule that was not a
visible page state had to be a model call — which would have made judged steps routine, and routine
is the enemy of the review discipline ADR-032 depends on.

### The evidence line

```text
check_credit_floor    Credit Score is less than 620   →  596 vs 620    holds=true   → decline_file
check_pmi_threshold   Loan To Value is more than 80   →  92.09% vs 80  holds=true   → add_pmi_condition
check_flood_zone      Flood Zone is not X             →  AE vs X       holds=true   → add_flood_condition
```

`92.09%` is what the screen said. `80` is what the rule said. The branch follows. A reviewer can
recompute it by hand against an immutable version, without access to the page it ran against.

Two deliberate consequences worth noticing. `${credentials.x}` is **refused** as a comparison
operand, because the transparency that makes the step trustworthy would put a secret in an artifact
by design. And no screenshot is captured for a compare step, because it reads no page and a
screenshot would show whatever happened to be open and imply the comparison came from it.

### The cost of that strictness

`compareValues` in `packages/runtime/src/steps/compare.ts` understands `$806,500`, `92.09%` and
accounting parentheses — and refuses everything else. `1,2,3` is rejected rather than read as `123`.
`about 80` is rejected rather than read as `80`. An ordering comparison against a non-number halts
with `COMPARISON_NOT_COMPARABLE`.

Say the cost out loud: a loan origination system that renders `—` for a missing DTI stops the run.
Every time. That is a chosen trade — *"a silent wrong branch on a loan file"* versus a halt that
names the raw text — and it is the right trade for lending and the wrong one for a high-volume,
low-stakes queue.

---

## 8. Where each approach genuinely wins

**RPA wins when:** the target is not a browser (mainframe, Citrix, thick client, file shares); the
work is state-changing and must be today; credentials and an orchestrator are required; the
customer already has the licence and the trained team; the volume justifies attended/unattended
robot pools. Orbit competes on none of these right now.

**browser-use wins when:** the task is novel or one-off; authoring cost must be zero; the site
changes often and adaptation matters more than diagnosis; authentication must be handled by a human
mid-task; the domain tolerates a small silent error rate; the work is exploratory rather than
governed. For a long tail of once-a-quarter processes, this is browser-use's territory permanently,
and Orbit's authoring cost will never amortise there.

**Orbit wins when:** the same workflow runs many times; a person other than the author must approve
the process *before* it runs; someone will later ask why a specific run branched the way it did and
expects an answer that does not depend on trusting a model's summary; halting is cheaper than being
wrong; the rules are written down and comparative rather than judgemental; and the workflow spans a
browser and something that is not a browser.

---

## 9. Where Orbit is worse

Ordered by how much they should worry a reviewer. Each is marked **[trade]** where it was a
deliberate choice, or **[unbuilt]** where it is simply not done.

1. **Selector brittleness is real, and the fallback chain is not a runtime fallback.** [trade]
   `packages/agent-ir/src/steps.ts` carries a single `locator` per step. The ranked chain the
   recorder captured lives in the binding and is read only by drift *diagnosis* (ADR-033). So a
   renamed `data-testid` halts the run even when a perfectly serviceable `role_and_name` fallback
   sits in the database. Deliberate — substituting an element nobody approved is the exact thing
   the drift check exists to prevent — and strictly worse availability than an RPA tool with
   fallback selectors, and far worse than browser-use.

2. **Recovery cannot help the case it would be most valuable for.** [trade] A binding with a single
   locator has nothing to fall back on, so a page that renames its only test id produces
   `no_candidate` and a request to re-demonstrate. ADR-033 states this in its own consequences.

3. **Database-level immutability is not enforced.** [unbuilt] ADR-014 is *Partially implemented*:
   immutability and append-only live in the repository layer. Verified against the tree: no
   migration `0000`–`0015` contains a trigger or rule enforcing either (the only match for
   "trigger" in the whole migration set is a `jsonb` column of that name). A direct `UPDATE`
   against `agent_versions` or `run_events` in `psql` succeeds. The claim "evidence you can trust a year later" currently
   rests on an application convention. **This is the one I would fix first**, because it is the
   load-bearing property of the entire pitch and the cheapest of these to close.

4. **No authentication, anywhere.** [unbuilt] Four source comments say so directly
   (`apps/api/src/routes/platform.ts:21`, `apps/api/src/views/views.ts:748`,
   `apps/api/src/views/artifact-access.ts:9`, `apps/api/src/routes/api-systems.ts:19`). Anyone who
   can reach the API can publish an Agent Version, start a run, and read every artifact including
   DOM snapshots and traces. No tenancy, no RBAC, no authorization on evidence.

5. **`trust_tier` is inert.** [unbuilt] ADR-013's six-tier authority model reads like a governance
   framework. In the code, the compiler writes `observe` unconditionally and **nothing branches on
   the value**. Containment comes from `allowedDomains`, `permissions.model` and
   `permissions.recovery`, each checked directly. Anyone reading ADR-013 as a description of
   shipped controls is reading it wrong, and the ADR's own status note says so.

6. **Orbit has never changed a record in a system it did not author.** [trade, for now] Tier 0,
   read-only, by scope. And the mortgage demo overstates even that: `Approve file` is React
   `useState` in a portal we wrote (`apps/mortgage-portal/src/pages/LoanPage.tsx:347`). Nothing is
   persisted anywhere. The click looks like a write and is not one. RPA does real writes on day one.

7. **The terminal surface executes but cannot be authored at all.** [unbuilt] No SOP Graph step
   kinds, no Execution Binding bodies, no recording flow. Every terminal workflow today must be
   hand-written Agent IR YAML. It is the largest single gap between "built" and "usable."

8. **The terminal surface has never met a mainframe.** [trade, disclosed] Validated only against
   an independent test host. The repo's own risk register is blunt about the failure mode: *"If
   that peer turns out to be Orbit's own code, the test proves nothing and the failure is silent —
   green suite either way."* Unbuilt beside it: unsolicited screens, session/LU-pool lifecycle,
   screen-model pinning (a binding recorded at 24×80 is silently wrong at 43×80), full TN3270E,
   TLS to the LPAR.

9. **The authoring loop is heavy.** [trade] ADR-025 did collapse review, compile and candidate
   approval into one publish action for a recorded workflow, so it is lighter than it was. It is
   still record → review → bind → publish. Worse, binding, recording and walkthrough sessions are
   **in-memory only**, capped at one per document, and vanish on an API restart — a person's live
   work in an open browser can be lost with no error surfaced at the moment it happens.

10. **The demo portals behave.** [trade, disclosed] Meridian renders every ratio cleanly, always,
    in one place, because a real LOS computes them. It does not render `—`, does not paginate, does
    not use iframes (which the recorder cannot enter at all), and does not time out mid-session.
    Every reliability number in this repository was measured against pages we wrote.

11. **A property can be tested, documented, ADR'd, and not actually running.** [was a bug] Until
    ADR-033, the drift check *had never run in production*: `executeAgentVersion` took an optional
    binding resolver and every real entry point omitted it. It was live in tests and inert in every
    actual run. Wiring it immediately found several library-demo fixture fingerprints that were
    guesses nothing had ever compared to a page. This is the most useful single fact about this
    codebase's failure mode, and it argues for reading the wiring, not the ADRs.

12. **Operationally immature.** [unbuilt] No `SIGTERM`/`SIGINT` handling in `apps/api` or
    `apps/browser-worker`; a deploy kills in-flight runs with nothing marked interrupted. No
    reconciliation for a run orphaned by a killed process — it sits `running` forever. No
    server-side duplicate-dispatch suppression, so a double-submit starts two runs. No retention or
    orphan cleanup for artifacts or drafts.

13. **The determinism story is about run time only.** [trade] Models are used liberally at
    *authoring* time: SOP generation from free text, business-rule drafting, walkthrough alignment
    proposals, selector and drift advice. All of it is advisory — nothing auto-applies, and a person
    accepts each proposal — which is a defensible line. But anyone auditing "how much model is in
    this system" who counts only `model.decide` is undercounting.

14. **Secret detection during recording is heuristic.** [disclosed gap] Password *fields* only. A
    secret typed into a non-password field is captured verbatim into a binding's literal value.

15. **Two validator blind spots on the new surfaces.** [bug] `checkDefiniteAssignment` never marks a
    `terminal.read` variable assigned, producing false-positive refusals of valid workflows;
    `checkReferences` never validates `terminal.type.value`, `terminal.read.assign`, or
    `api.request.arguments`, so malformed references compile silently and fail mid-session at run
    time.

---

## 10. What would have to be true for Orbit's bet to be wrong

- **Evidence is never actually read.** If, in practice, nobody reconstructs a run — if a run either
  works or gets re-run by hand — then the events, artifacts, traces and resolved-operand records
  are pure cost, and so is most of the 13,356 lines.
- **Halting is worse than proceeding.** In high-volume, low-stakes work, a 2% silent error rate
  beats a 15% halt rate, because halts consume a human and errors sometimes do not. Orbit's whole
  design assumes the opposite cost function.
- **Models become reliably self-constraining.** If a runtime agent can be handed a rulebook and
  reliably refuse to deviate — *and prove which rules it applied* — then compile-time refusal is a
  slower route to a property the model provides directly. Orbit's structure is a bet that proving
  it requires the rule to exist outside the model.
- **Authoring cost never amortises.** The bet needs workflows that run thousands of times. A
  business whose automation need is a long tail of quarterly processes should not buy Orbit.
- **Regulated buyers accept model trajectories as evidence.** If a trajectory log satisfies an
  auditor, "re-derivable by hand against an immutable version" is a property nobody is paying for.
- **Page churn outruns diagnosis.** If real enterprise systems change often enough that halt-and-
  re-demonstrate is a weekly tax, Orbit's availability is unacceptable regardless of how good its
  explanations are — and the fallback chain being diagnosis-only (§9.1) makes this worse.

---

## 11. What would change our mind

Concrete and observable, in rough order of how much each would move us:

1. **A single-locator binding surviving a real redesign** because a model found the right element,
   with a post-hoc audit showing it picked correctly on 100/100 drifted pages. That would make
   §9.1's trade look like dogma rather than discipline.
2. **A pilot where operators ignore the timeline.** If Watchtower's evidence view goes unopened for
   a quarter of real runs, the product is a runner with an expensive filing cabinet attached.
3. **A regulated customer accepting a trajectory log** as sufficient audit evidence for an
   automated decision. That is the one external fact that would invalidate the central claim.
4. **A halt rate above ~10% in production** on a stable enterprise system. That would mean the
   fingerprint is tuned wrong, not that governance is expensive.
5. **Judged decisions creeping past a third of all decisions** in real workflows. ADR-032's
   containment argument depends on judged steps being rare enough to scrutinise; if authors reach
   for them by default, the containment is theatre.
6. **The compiler's refusal list becoming the main support burden.** Fifteen refusal codes are a
   safety property if people fix the workflow, and a UX failure if they route around Orbit
   entirely.
7. **Someone building the same evidence properties on top of a runtime agent** — a model that acts
   freely but emits a version-pinned, replayable decision record. That would get browser-use's
   flexibility and most of Orbit's accountability, and Orbit would need a new argument.

---

## 12. How to evaluate this — questions that discriminate

Most demo questions do not separate these three approaches. "Can it fill a form and click a
button?" — all three can. "Does it take screenshots?" — all three do. "Does it have a dashboard?" —
all three do. Ask these instead. Each has a *different* answer from RPA, browser-use, and Orbit.

1. **Fire the author, then change the page.** What tells you the automation is now wrong, and at
   what moment? *(RPA: a failed run, or a successful wrong one, after the click. browser-use:
   nothing — it adapts, including into the wrong element. Orbit: a fingerprint mismatch, before the
   action, with a typed error and a diagnosis. Then push: what if the new element has the same
   role, name and text? Orbit's honest answer is that it proceeds.)*

2. **Change a threshold from 80% to 78%.** Which artifact changes, who signs it, and can you later
   tell which runs used which value? *(Ask specifically whether the version is pinned **per run**,
   not merely stored. Ask what pins a prompt.)*

3. **Pick a run from six months ago and explain why it branched the way it did — without the page
   it ran against, and without asking a model to summarise.** *(Orbit's answer is both resolved
   operands and a version hash. Anything that answers "here is the trajectory, read it" is offering
   you a narrative, not a derivation.)*

4. **Point at the artifact a compliance reviewer signs. Is it the same artifact that executes?**
   *(RPA: yes, same artifact — which is the problem. browser-use: the prompt, which is not
   enforceable. Orbit: no — the SOP Graph is reviewed, the Agent IR executes, and every IR step maps
   back to source SOP step ids.)*

5. **Ask for a workflow the tool refuses to build.** *(A tool that can express anything has no
   compile-time safety. Ask for the list of refusal codes. If there is no list, the guards are
   guard clauses somebody remembered to write.)*

6. **What happens on a case the rules do not cover?** *(Orbit refuses to compile a judged decision
   without an `insufficientEvidence` branch — a refusal, not a warning, because a warning on the
   shape that produces confident wrong answers at scale is a warning nobody reads twice. Ask any
   other tool where its "I don't know" goes.)*

7. **Feed it a field that renders `—`.** *(Coerce to zero, interpret, or halt? Then ask which of
   those three you want on a loan file, and which you want on a shipping queue. The right answer
   differs, and a tool that only offers one is only right for one.)*

8. **Can it log in?** *(This one discriminates **against** Orbit. It cannot. browser-use hands the
   session to a human; RPA has a mature vault. Orbit compiles such a workflow, marks it
   `cannot_validate`, and can never approve it.)*

9. **How many places in the system can execute arbitrary code against the target page?** *(Orbit:
   one file, asserted by test, structurally unreachable from any process that executes an agent.
   Ask the same question of any RPA tool with an "Invoke Code" or "Run JavaScript" activity — they
   all have one, and it is usually reachable from anywhere in a workflow.)*

10. **Cost per 10,000 runs, including the human time spent re-checking the ones you cannot trust.**
    *(Model tokens are the cheap part. The expensive number is the fraction of runs a person has to
    verify by hand, and none of the three vendors publishes it.)*

---

## 13. What the argument actually is

Not "we are not RPA." Orbit uses locators, drives a browser with Playwright, and would look
familiar to anyone who has built an RPA workflow.

The argument is narrower and, we think, harder to dismiss: **the interesting design decisions in
this system are all about what may not be expressed.** No selector that walks the DOM. No arithmetic
in a comparison. No `and` in a rule. No branch a model can invent. No page read that becomes a
locator. No published version that can be edited. No surface without its own permission section.
No compilation that guesses.

Every one of those is a capability deliberately withheld, and each is checkable in a file rather
than promised in a document. That is the whole of the claim. It is worth something only if
withheld capability is what your workflow needs — and for a great many workflows, it is not, and
browser-use will do the job today for a fraction of the effort.

The parts of Orbit that are unfinished (§9) are unfinished in ways that undercut the pitch more
than any architectural objection does. A system whose central claim is trustworthy evidence, and
whose evidence table can be updated with a direct SQL statement by anyone who can reach an
unauthenticated API, has an argument it has not yet earned the right to make.
