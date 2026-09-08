# Branching Demo — Borrow a Title, or Place a Hold

**Status:** Active demonstration procedure for sub-phase 2.8 branching

**Purpose:** See a workflow that *chooses* — one that reads the page, decides which of two states it
is in, and runs a different sequence of steps depending on the answer.

Every workflow Orbit could execute before this was a straight line. This one is not: it searches the
library catalog for a title, and then either borrows it or joins the queue for it, depending on
whether it is on the shelf.

This is a **local development demonstration**. See *Limitations* at the end.

## The workflow

```text
Open the catalog
  → search for the ISBN
  → is the title available, or on loan?
        available → enter a member ID → Borrow  → read the confirmation → outcome "borrowed"
        on loan   → enter a member ID → Hold    → read the confirmation → outcome "held"
```

The decision is the point. The library portal renders a **Borrow** form only for an available title
and a **Hold** form only for one that is out — two states that are mutually exclusive and that can be
told apart by what is on screen. That is exactly what Agent IR's `browser.expect_one_of` resolves: it
waits for whichever of several known elements appears and jumps to that branch.

## How it runs, end to end

1. The SOP Graph says *what* the decision is: "is the title available to borrow, or on loan?", with
   two branches and where each goes. No selectors — a graph never contains one.
2. An **Execution Binding** says what each branch *looks like*: one demonstrated element per branch.
   Here, the Borrow button for one and the Hold button for the other.
3. The compiler turns the two together into one `browser.expect_one_of` step with two alternatives.
4. The runtime races the two locators, takes the branch whose element appeared, and records which one
   it was as evidence.

Steps 3 and 4 needed no change to Agent IR or to the runtime. Branching was already expressible and
already executable; what was missing was a binding that could describe a branch (**ADR-029**).

## Run it

### The automated proof

```bash
pnpm test:runtime
```

`apps/browser-worker/src/library-borrow-or-hold.runtime.test.ts` compiles the workflow, publishes it,
and runs it **twice in a real Chromium against the real library portal** — once on a title that is
available and once on one that is out — asserting each run selected the right alternative and that
the branch it did not take never ran.

The test starts the library portal itself if one is not already listening on **port 3020**, and stops
only a portal it started. Running it alongside `pnpm dev` is fine.

### By hand

```bash
pnpm --filter @orbit/library-portal dev     # http://localhost:3020/catalog
```

Then, at <http://localhost:3020/catalog>:

| Search for | ISBN | What the page shows | What the agent would do |
|---|---|---|---|
| *Clean Code* | `978-0-13-235088-4` | Available, with a Borrow form | Borrow it |
| *Design Patterns* | `978-0-201-63361-0` | On loan, with a Hold form | Place a hold |

Use member ID **`LIB-1001`** (Dana Whitfield — no fines, under the loan cap, not suspended). Other
members are deliberately not in good standing; `LIB-1004` is suspended and `LIB-1002` owes fines, so
either one produces a refusal from the portal rather than a loan.

Doing this yourself is what binding the decision looks like from Watchtower: put the page into each
state in turn, and point at the element that proves you are in it.

### Binding a decision in Watchtower

On a workflow's review page, a `decision` step now offers **Bind this step** like any other bindable
step. The panel walks the branches one at a time — "Branch 1 of 2: the title is available to
borrow" — and each capture is held until every branch has one. Only then is a single binding written.
Abandoning a half-demonstrated decision leaves nothing behind.

### Draft it with AI instead

The fixture above is hand-written, which is the right way to *prove* branching but not how a person
would arrive at this workflow. The drafting flow reaches the same shape from a description: paste the
prompt below into **Describe it in your own words** on Home.

It is written the way somebody who actually does this job would write it — no step numbers, no
mention of selectors, decisions stated as the conditions a person would check — because that is the
input the drafting flow is built for, and a prompt written in Orbit's vocabulary would prove nothing.

```text
When someone asks for a book, I look it up in our catalog by its ISBN and check whether we
have a copy on the shelf.

If a copy is available, I borrow it out to them: I put in their member ID, press Borrow, and
then read back the confirmation so I know which copy went out and when it is due. That one
ends as borrowed.

If every copy is already on loan, I can't lend it, so instead I put them in the queue: same
thing, their member ID, but I press Hold, and then read back their place in the queue and
roughly when it should come free. That one ends as held.

Either way I need their member ID up front, and it's the same ID whichever way it goes.
```

Two things to expect, and neither is a fault:

- **The draft is not runnable yet.** It has the decision and both branches, but no step has been
  shown to Orbit against a real page — a graph never contains a selector. Every bindable step,
  including the decision (branch by branch), needs demonstrating on the review page before the
  workflow can be published. That is the system working, not a gap: nothing reaches a running agent
  until a person has confirmed it against the page it will act on.
- **The outcome names are the workflow's own.** Since **ADR-030** a business outcome is a declared
  identifier rather than one of two names inherited from the Phase 1 demo, so a draft that says
  "ends as borrowed" and "ends as held" gets `borrowed` and `held`. There is nothing to map them onto
  and no question asked at publish time. If the draft names them differently, that is what the runs
  will record — rename them on the review page if you want the fixture's exact words.

Review the result against *The workflow* at the top of this page. A drafted graph will not be
identical to the fixture — step ids and wording differ — and it does not need to be; what matters is
that it has one decision with two branches, a member ID input shared by both, and a distinct outcome
on each.

## Limitations

- ~~**The business outcome vocabulary is still Phase 1's.**~~ **Fixed in sub-phase 2.10 (ADR-030).**
  A business outcome is now a declared identifier rather than one of two names inherited from the
  Phase 1 demo, so this workflow records `borrowed` and `held` — its own words, and exactly what
  happened. There is no mapping left to get wrong. `docs/demo/branching-library-demo.md` previously
  described the mapping as a placeholder; it is gone.
- **This decision breaks the moment the page changes its wording.** It resolves by watching for the
  Borrow button, so a catalog that expressed the same meaning in different words would branch wrongly
  or not at all. Sub-phase 2.9 added the alternative — a judged decision that reads the status *text*
  — and `docs/demo/judged-decision-demo.md` runs the same workflow that way (**ADR-032**). Which kind
  a decision uses is a review-time choice; deterministic stays the default, because it is exact and
  free.
- **The decision's fingerprints are not re-verified at run time.** The runtime's drift check runs
  before an action or a read; `browser.expect_one_of` resolves by visibility and does not call it. A
  branch locator that has drifted onto a different element would be selected rather than refused. The
  selectors and fingerprints are still recorded as evidence.
- **This workflow is not seeded into `orbit_dev`.** It exists as a fixture and a test. Nothing
  appears in Watchtower's agent list unless you publish it yourself.
- **The library portal keeps its state in memory.** A borrow or a hold lasts until the page reloads.
  That is what makes the demo repeatable, and it is not a real circulation system.
