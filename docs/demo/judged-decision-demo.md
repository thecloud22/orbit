# Judged Decision Demo — Reading the Words, Not the Button

**Status:** Active demonstration procedure for sub-phase 2.9 judged decisions

**Purpose:** See a workflow decide from what a page *says* rather than from which element is on it —
and see what stops that decision from becoming anything more than a branch.

Read `docs/demo/branching-library-demo.md` first. This is the same workflow, against the same
portal, with one field changed on one step.

This is a **local development demonstration**. See *Limitations* at the end.

## What changed, and why it matters

The branching demo decides by watching for the **Borrow button**. That is exact, free, and completely
dependent on the page rendering a button. Change the surface and the decision breaks:

| The catalog renders | Deterministic branch sees | A judged decision reads |
|---|---|---|
| `Available` | Borrow button present → branch 0 | "a copy can be borrowed right now" |
| `On loan · due 2024-06-20` | Hold button present → branch 1 | "no copy can be borrowed right now" |
| `On hold` | *neither form renders* | "no copy can be borrowed right now" |

All three are the same two business meanings in three different sets of words. The declared outcomes
never changed — only the surface did. That is the entire case for a judged decision, and it is the
case ADR-032 was written about.

The judged workflow points every branch at one region — `catalog-result-status`, the line that says
what is going on — and asks a model to classify the words into the branches the workflow already
declares.

```text
Open the catalog
  → search for the ISBN
  → model.decide: "Read the availability status and decide whether a copy can be borrowed right now."
        a copy can be borrowed right now          → enter a member ID → Borrow → outcome "borrowed"
        no copy can be borrowed right now         → enter a member ID → Hold   → outcome "held"
        the page does not say                     → outcome "availability_unclear"
```

The third branch is not optional. The compiler refuses a judged decision that cannot say *I could not
tell* — see *What the compiler refuses* below.

## Running it

The judged workflow lives as a fixture and a test, exactly as the branching one does.

```bash
pnpm test:runtime
```

`apps/browser-worker/src/judged-availability.runtime.test.ts` starts the library portal (or reuses
one already listening on `3020`), compiles the judged graph from
`judgedAvailabilityGraph()` and its bindings, publishes it, and runs it against a real browser three
times — on an available title, one on loan, and one on hold.

**No model is called.** The judge is `createFakeJudge`, deciding deterministically from the text it is
handed. That is deliberate: what the test proves is the *path* — real portal, real Playwright, real
`readText`, real branch, real evidence — and a real model would make the test slow,
non-deterministic and expensive while proving nothing extra about Orbit. Whether Claude reads
"On loan · due 2024-06-20" correctly is a question about a model.

To run it against a real model, set `ANTHROPIC_API_KEY` and use the agent CLI, which wires the real
judge through `apps/browser-worker/src/cli/judge.ts`:

```bash
ANTHROPIC_API_KEY=sk-... pnpm agent:run -- --agent-version-id <a published judged version>
```

Without a key, no judge is wired at all: every existing agent runs exactly as before, and a workflow
containing a judged decision halts with `DECISION_JUDGE_UNAVAILABLE` rather than skipping the
decision it was built around.

## What you should see in the evidence

A judged decision reads differently from a deterministic one in Watchtower, because there is no
element that matched:

> A model judged this **a_copy_can_be_borrowed_right_now**, and the run continued at
> `enter_borrow_member_id`.
> Confidence 0.95 against a threshold of 0.80 · claude-haiku-4-5
> *The model's own account: "the status region says Available"*

Confidence is shown next to its threshold on purpose: `0.86` means nothing alone and everything
beside the `0.80` it had to beat.

Three events carry the decision — `decision.requested`, `decision.resolved`, and, when it halts,
`decision.refused` — and a `decision_input` artifact holds the exact text the judge was shown. The
request event and the artifact are written **before** the provider is called, so a call that never
returns still leaves behind what it was asked.

## The bound that makes this safe

The model returns **an index into a list the runtime already holds**. Nothing it returns becomes a
locator, a URL, a selector, an expression, or a step id; `next` comes from the step definition, and
the judge is never even shown where an alternative leads. The rationale is displayed for a person and
read by no code path.

Every failure halts the run, with a reason you can act on:

| Reason | What it means |
|---|---|
| `DECISION_JUDGE_UNAVAILABLE` | No judge is wired into this runtime |
| `DECISION_JUDGE_FAILED` | The provider errored or timed out |
| `DECISION_OUT_OF_SET` | An answer that is not one of the declared alternatives |
| `DECISION_LOW_CONFIDENCE` | The model answered, and was not sure enough |
| `DECISION_BUDGET_EXHAUSTED` | A spend cap was reached, so no call was made |

There is no default branch and no retry into a different answer.

## What the compiler refuses

**A judged decision with no "insufficient evidence" branch.** Mark one branch
`insufficientEvidence: true`, or it will not compile:

> Step "check_availability" asks a model to decide but declares no branch for "the evidence does not
> settle this". Without one it must return a confident answer for a case it cannot actually tell, and
> that answer is indistinguishable from a correct one.

**Two branches whose conditions collapse to the same name.** "the title is available" and "the title
IS available!" both become `the_title_is_available`, and a judged decision returns exactly one branch,
so its conditions have to be distinguishable.

## Authoring guidance: the alternatives must partition the cases

A judged decision returns **exactly one** alternative. Its alternatives therefore have to be mutually
exclusive and jointly exhaustive over the cases the workflow will meet — and **nothing checks this**,
because overlap is a fact about your business meanings rather than about the graph.

A 70-year-old doctor is both "senior" and "professional". Asking a judge to pick one is asking it to
break a tie your SOP never explained, and whichever it picks will look like an answer. The three ways
out are all business decisions:

| Way out | What it looks like | When it fits |
|---|---|---|
| Separate decisions per attribute | One judged step per axis: age band, then occupation | The attributes are genuinely independent and both matter |
| Enumerated combinations | `senior_professional`, `senior_other`, … as distinct alternatives | Few attributes, and the combinations really do behave differently |
| A policy ranking | One decision whose alternatives are ordered, with the SOP stating which wins | There is a real precedence rule the business already applies |

Picking none of these — leaving overlapping categories on a pick-one node — is the failure mode. It
produces a workflow that runs, never errors, and is quietly wrong on every overlapping case.

**Partition the question *and* what each branch then does.** This demo gets the first right and the
second wrong, deliberately, and the test says so. `no copy can be borrowed right now` is a correct
classification of "On hold" — and the branch behind it enters a member ID into a *hold form*, which
the catalog renders for a title on loan and not for one already on hold. So the judgement is right,
the run fails at `enter_hold_member_id`, and the evidence names the step. Nothing in the schema can
catch that either. It is left in rather than hidden behind a friendlier ISBN, because it is the
mistake an author will actually make.

## Limitations

- **Two runs of the same agent against the same page can now differ.** This is the first
  non-deterministic thing in an execution path. Temperature is 0, there are no retries, and every
  failure halts — but the property is real (ADR-032).
- **Prompt injection is reduced, not eliminated.** Page content becomes model input. The structural
  defence is the closed enum: the worst a hostile page achieves is the wrong declared branch, never an
  executed instruction.
- **Redaction is a reduction, not a guarantee.** Page text is redacted in the runtime before it is
  sent *or* stored, but it matches shapes it knows: it will not recognise a secret that reads like
  prose. The real containment is that the judge reads only the regions the Agent Version declares.
- **The compiler cannot check that your alternatives partition your cases.** See above. This is the
  limitation most likely to bite.
- **Cost and latency rise wherever a judged decision is used.** A judged step is a network round trip
  inside an execution that previously had none. Spend is capped per run, per agent and globally.
- **This workflow is not seeded into `orbit_dev`.** It exists as a fixture and a test.
- **The library portal keeps its state in memory.** A borrow or a hold lasts until the page reloads.
