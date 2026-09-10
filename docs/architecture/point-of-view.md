# Orbit: why this is not an RPA bot

**v1.1 · five minutes.** For architects and CIOs. The long form, with every claim traced to a file
and a test, is [`point-of-view-v1.0.md`](./point-of-view-v1.0.md).

---

## The question we keep getting

> *"You click buttons on a web page using selectors. That is what RPA does. So you have built an
> RPA bot with extra steps."*

The execution model is the same. That part is true and we should stop arguing about it.

What differs is what the system is **allowed to do**, and what it **leaves behind**.

---

## The answer, in one artifact

Here is what a run produces. A mortgage file, declined:

```
Loan ML-26-04547 · Declined

  Is the credit score below the program floor?
      "Credit Score is less than 620"   →   596 vs 620   →   yes
      → Decline the file

  Debt-to-income and loan-to-value were never checked.
    A file below the credit floor is declined before those questions are asked.

  Decided by version 0.1.0, published 9 September, unchanged since.
  The same file, run tomorrow, is decided the same way.
```

That is the product. Not the clicking — the receipt.

An RPA tool can tell you the bot ran and which step failed. It cannot tell you *why this decision*,
because it has no representation of the decision. The rule and the selector are the same object in
a recording. Here they are different artifacts: the rule is business language a person approved, the
selector is a separately reviewed mapping to a page, and either can change without touching the
other.

---

## Three ways to automate the same work

| | **RPA** | **AI browser agent** | **Orbit** |
|---|---|---|---|
| What you author | A recording | A sentence: *"underwrite this loan"* | A procedure, reviewed once |
| Who decides the action | The recording | The model, on every run | The published version |
| Same file twice | Same steps | May differ | Same, by construction |
| A task never seen before | No | **Yes** | No |
| Page changes | Breaks | **Adapts** | Stops, and says what changed |
| "Why was this declined?" | Step log | Model's account of itself | The comparison, both numbers, the version |
| "Will it decide the same tomorrow?" | Probably | No guarantee | Yes — versions are immutable |
| Cost per run | Licence | Tokens + browser time | Compute |

Bold marks where the alternative is genuinely better than us. There are two, and they matter.

---

## What the system deliberately cannot do

This is the part that is hard to see from outside, and it is the actual architecture. Each of these
is a capability we removed on purpose:

- **A business rule cannot contain a selector.** Enforced by a test that scans the source, not by
  a convention people remember.
- **A rule cannot do arithmetic.** "Loan-to-value over 80%" compares a number the lender's own
  system published. Orbit will not compute the ratio itself — if the figure is not on screen, the
  rule is refused rather than derived. We do not become a second calculator that disagrees with the
  system of record.
- **A rule cannot say "and".** Two conditions is two decisions, in sequence, each reviewable.
- **A model cannot invent a branch.** Where a model is used — reading an analyst's note, for
  instance — it may only choose among outcomes a person already declared. It can never name a
  destination.
- **The system refuses rather than guesses.** A comparison against something that is not a number
  stops the run. It does not pick a side.

Withheld capabilities are why the receipt above can exist. A system that can do anything cannot
promise anything.

---

## Where a model *does* earn its cost

We are not against models. We are against models deciding things a number settles.

The same mortgage workflow has five decisions. Four are comparisons — credit floor, debt-to-income,
mortgage insurance, flood zone — and they run free, instantly, identically every time.

One is not. *"Does this borrower's income need two years of returns to stand up?"* The answer is in
a paragraph an analyst wrote about a landscaping business with seasonal cash flow. No threshold
settles it. That one calls a model — permissioned, budgeted, and confined to the outcomes the
author declared.

One paid answer, four free ones, and the paid one is the only question that needed judgment.

---

## Where we are worse

- **We break when pages change materially.** We tell you precisely what changed and propose a
  repair for a person to accept. We do not adapt around it. An AI agent often just carries on.
- **We cannot do a task nobody has taught us.** Every workflow is demonstrated, reviewed and
  published first. An AI agent needs a sentence.
- **Setting a workflow up is real work** — record, review, map to the page, publish. That cost only
  pays back on work that runs often. For a quarterly one-off, do not buy this.
- **Today it is read-only.** It reads systems and records decisions; it does not yet change them.
  So in raw capability it currently does *less* than RPA, not more.
- **There is no authentication or tenancy yet**, and version immutability is enforced by
  application code rather than by the database. For a product whose claim is trustworthy evidence,
  that gap has to close before the claim is fully earned.

---

## When to choose what

**Choose an AI browser agent** when the work is varied, occasional, or exploratory, and nobody will
be asked to justify the outcome. It will beat us on coverage and setup cost, and it is not close.

**Choose RPA** when the work is high-volume, stable, low-stakes, and you already own the licences
and the skills.

**Choose Orbit** when someone with authority will eventually ask *"why did it decide that, and can
you prove it would decide the same way again?"* — underwriting, claims, KYC, eligibility, anything
audited. That question is the whole reason the architecture looks the way it does.

They also combine. Letting an agent explore a system once, then compiling what it did into a pinned,
evidence-producing version, is the strongest version of this — it removes our worst weakness
without giving up the receipt.

---

## Three questions that settle it

Ask these of any vendor, including us:

1. **Show me the business rule without showing me a selector.** If they cannot separate the two,
   the rule dies whenever the page moves.
2. **Show me why this specific run made this specific decision — from the record, not the logs.**
   Then ask whether the thing that decided it can still be changed.
3. **What does it do when it does not know?** Systems that guess look better in a demo and worse
   in an audit.

We are comfortable being judged on all three. We would not be comfortable being judged on how many
tasks we can attempt.
