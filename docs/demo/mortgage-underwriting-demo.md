# Demo: executable business rules against a mortgage file

What this shows: a lender's underwriting manual — *"if loan-to-value exceeds 80%, require private
mortgage insurance"* — becomes branches an agent actually takes. One published workflow, run
against different loan files, ends somewhere different each time, and the run's timeline shows the
arithmetic behind every turn.

Built on **ADR-040**, which added a third way for a decision to resolve: by comparing two values
the run already holds.

## Start the stack

```bash
docker compose up -d
pnpm db:migrate
pnpm dev              # web :3000, api :3002, mortgage portal :3030
```

The portal is `apps/mortgage-portal` — Meridian Home Lending, a loan origination system with eight
files in its underwriting pipeline.

## What is published

Two workflows, both in Studio.

| Workflow | Runs today? |
|---|---|
| **Underwrite a mortgage file (rules only)** | **Yes.** Four computed rules, no model involved |
| Underwrite a mortgage file | Only with a model configured — it also has one *judged* decision |

The second needs `ANTHROPIC_API_KEY` (or `GEMINI_API_KEY`) set. Without one the judge is correctly
absent and the run halts at that step with `DECISION_JUDGE_UNAVAILABLE`, which is the accurate
thing to be told rather than a failure.

## Loans worth running

Open **Agents → Underwrite a mortgage file (rules only) → Start a run** and give it a loan number.

| Loan | LTV | DTI | FICO | Zone | What should happen |
|---|---|---|---|---|---|
| `ML-26-04471` | 72.73 | 28.00 | 762 | X | Approved, no conditions — nothing is tripped |
| `ML-26-04488` | 92.09 | 33.00 | 728 | X | PMI condition, then **conditionally approved** |
| `ML-26-04513` | 75.00 | 28.00 | 781 | AE | Flood insurance condition |
| `ML-26-04561` | 85.00 | 26.00 | 806 | VE | **Both** conditions — two rules, one file |
| `ML-26-04529` | 95.00 | 47.00 | 691 | X | **Referred.** Note its LTV would have needed PMI, and that question is never asked |
| `ML-26-04547` | 96.25 | 38.00 | 596 | X | **Declined** at the credit floor, before DTI or LTV is compared once |

The last two are the interesting ones. Ordering the rules is what makes them true, and it is how an
underwriter actually works: a file below the credit floor is declined without anyone costing out
its mortgage insurance.

`ML-26-04502` is the case for the *full* workflow: every ratio is inside its limit, and the file
still needs a condition, because the income analyst's note describes seasonal self-employment. No
threshold settles that.

## What to look for in the run

Open the run and read the step timeline. Each computed decision records both operands and the
branch it took:

```text
check_credit_floor    Credit Score is less than 620   →  596 vs 620   holds=true   → decline_file
check_pmi_threshold   Loan To Value is more than 80   →  92.09% vs 80 holds=true   → add_pmi_condition
check_flood_zone      Flood Zone is not X             →  AE vs X      holds=true   → add_flood_condition
```

That is the point of the design as much as the branching is: the decision can be recomputed by hand
from the evidence. `92.09%` is what the screen said; `80` is what the rule said; the branch follows.

## The design in one paragraph

A decision could already branch on **what is visible** (`browser.expect_one_of`) or on **what a
model concludes** (`model.decide`, ADR-032). Neither fits a written rule: nobody can point at "over
80%" on a screen, and routing a published threshold through a model pays money to make arithmetic
probabilistic. So `resolution: 'computed'` compares two values already in the run's scope. It opens
no executor, consumes no permission, costs nothing, and answers identically every time.

Four constraints keep it honest:

- **It cannot express a value that does not exist.** No ratios, no arithmetic. A rule about
  loan-to-value needs a step that *reads* loan-to-value, and the compiler refuses it by name until
  one does. The portal displays every ratio because a real LOS does — Orbit reads figures the system
  of record computed and stands behind, rather than becoming a second calculator that disagrees with
  it.
- **Six operators, no `and`.** Two conditions is two decisions in sequence, which also reads better
  in review.
- **The "no" branch is marked, never positional** — otherwise reordering two rows in the editor
  would silently invert a lending decision.
- **It needs no binding.** There is nothing on a screen to demonstrate, so bindability became a
  property of the *step* rather than of its kind.

## Writing a rule in words

In Studio, the **Business rules** panel on a draft workflow has a box: type
*"If debt-to-income is over 43%, refer the file to a senior underwriter"* and Orbit proposes the
decision step — the comparison, both destinations, and where the step would sit. It is added only
when you accept it.

The model chooses from **closed lists**: the values this workflow actually reads and the steps it
contains. Every name it returns is looked up against those lists before anything is assembled, so it
cannot invent a variable. A rule about a figure nobody records is refused by name, and the message
says to record the figure rather than to reword the rule — because that is the real fix.

This needs a model configured. The rest of the panel does not.

## Discarding a draft

At the foot of a draft's review page. It never deletes: the document keeps its id and revisions and
leaves Studio's list, and a link somebody kept still opens it. A **published** workflow cannot be
discarded — its versions are running and a run's evidence traces back through the document it was
compiled from — and the refusal names the version and points at archiving the agent instead.

## Running it as a test

```bash
pnpm test:e2e:mortgage    # the portal itself, including the branch matrix
pnpm test:runtime         # the eight real-browser underwriting scenarios
```

The runtime suite is the load-bearing one: one published workflow, seven loan files, seven different
paths, asserting the numbers in each comparison's evidence rather than only the destination.
