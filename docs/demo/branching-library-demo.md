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

## Limitations

- **The business outcome vocabulary is still Phase 1's.** Agent IR declares only `request_found` and
  `request_not_found`, so this demo maps `borrowed → request_found` and `held → request_not_found`.
  The run status and the branch it took are exact; the *name* of the business outcome is a
  placeholder. Widening that vocabulary is a change to a frozen contract and was out of scope here.
- **The decision's fingerprints are not re-verified at run time.** The runtime's drift check runs
  before an action or a read; `browser.expect_one_of` resolves by visibility and does not call it. A
  branch locator that has drifted onto a different element would be selected rather than refused. The
  selectors and fingerprints are still recorded as evidence.
- **This workflow is not seeded into `orbit_dev`.** It exists as a fixture and a test. Nothing
  appears in Watchtower's agent list unless you publish it yourself.
- **The library portal keeps its state in memory.** A borrow or a hold lasts until the page reloads.
  That is what makes the demo repeatable, and it is not a real circulation system.
