# Walkthrough Demo — Bind Nine Steps in One Sitting

**Status:** Active demonstration procedure for sub-phase 2.14 (**ADR-035**)

**Purpose:** See a drafted workflow with no bindings become a bound one by **performing the task
once**, rather than by demonstrating nine steps separately.

This is a **local development demonstration**. See *Limitations* at the end.

## The problem it removes

A drafted workflow — written by hand, or drafted from a description — reaches the compiler with no
Execution Bindings and is refused. Before this, the only way out was the per-step flow: open a
browser aimed at one step, perform one action, save, re-aim at the next step, perform one action,
save. The library workflow below has **nine** steps that need a binding, so that is nine sittings,
each one re-establishing the page state the last one left behind.

The obvious shortcut does not work. Orbit cannot look at the catalog page and match the drafted
steps against what it finds, because **most of the elements this workflow acts on do not exist
until you have interacted with the page**: the Borrow button appears only after a search returns an
available title, and the confirmation text only after the loan is placed. That information exists
only while somebody is doing the task — so the task is what Orbit watches.

## Seed the workflow, unbound

```bash
docker compose up -d
pnpm db:migrate
pnpm db:seed:library:unbound          # note: :unbound
pnpm --filter @orbit/library-portal dev   # http://localhost:3020/catalog
pnpm dev
```

`pnpm db:seed:library:unbound` seeds *"Borrow a title, or place a hold (unbound)"* — the same
workflow the branching demo uses, with **no Execution Bindings at all**. The ordinary
`pnpm db:seed:library` seeds the bindings too, which is right for the branching and drift demos and
exactly wrong here: with every step already bound there is nothing to propose, and a walkthrough is
refused before a browser opens. Both can exist side by side.

The seed prints the document id. Open it in Studio, or follow the printed link.

## What the workflow needs bound

Nine steps, across two branches:

```text
Open the catalog                       ← no binding needed (the graph names the URL)
  enter_isbn              fill
  search_catalog          click
  check_availability      decision     ← the one a walkthrough cannot do
        available → enter_borrow_member_id  fill
                    borrow_title            click
                    read_borrow_confirmation extract
        on loan   → enter_hold_member_id    fill
                    place_hold              click
                    read_hold_confirmation  extract
```

## Do it

On the review page, above the per-step panel, is **Bind every step in one walkthrough**. It states
up front the one thing a walkthrough cannot do — a decision — because that is better learned before
you start than discovered in the results.

Press **Start a walkthrough**. A headed Chromium opens on the machine running the API, at the URL in
the box. Then simply do the job:

1. Type `978-0-13-235088-4` into the catalog search box and press **Search**.
   *Clean Code* comes back available, with a Borrow form.
2. Type member ID `LIB-1001` and press **Borrow**.
3. The confirmation appears. This step *reads* a value rather than acting on one, so switch the
   panel to **Pointing at a value to read** and click the confirmation text. In that mode the page
   does not react — pointing at something must not fire its handlers.
4. Back in Watchtower, press **Finish and review what Orbit matched**.

The browser closes. A walkthrough ends when the task does.

## What you should see

Nine rows — every step that needed a binding, in the workflow's own order.

**Five proposed**, each naming the element rather than a selector:

| Step | What Orbit proposes |
|---|---|
| `enter_isbn` | Filled "Search the catalog" |
| `search_catalog` | Clicked "Search" |
| `enter_borrow_member_id` | Filled "Member ID" |
| `borrow_title` | Clicked "Borrow" |
| `read_borrow_confirmation` | Pointed at the confirmation |

**Four with nothing proposed, each saying why** — and this half is the point:

- `check_availability` — *"A decision has more than one outcome and a walkthrough follows one path,
  so it cannot show both."* Permanent, not a gap.
- `enter_hold_member_id`, `place_hold`, `read_hold_confirmation` — nothing in the walkthrough was a
  hold. You borrowed a book; you did not place a hold, so Orbit proposes nothing for the branch you
  did not perform. **A confidently wrong element would look finished. A blank does not.**

Check the five, then press **Accept all 5**. Each acceptance runs the ordinary
create → submit → approve lifecycle — the same three calls a step demonstrated on its own goes
through — so the panel below immediately reports those five as **Approved**. Nothing was live before
you accepted.

If a proposal is wrong, press **Wrong — dismiss** and then **Demonstrate this step on its own**,
which is the per-step flow, unchanged.

## Finishing the other four

Two ways, and the choice is yours:

- **Per step.** Every row with nothing proposed carries a button into the existing flow. The
  decision *must* go this way: put the page into each state in turn and point at the element that
  proves it — see *Binding a decision in Watchtower* in `branching-library-demo.md`.
- **A second walkthrough, for the hold branch.** Search `978-0-201-63361-0` (*Design Patterns*,
  already on loan), enter `LIB-1001`, press **Hold**, point at the queue position, finish.

  **Read this one carefully.** A second walkthrough is offered only the steps that are still
  unbound, but you still had to search the catalog again to reach the hold form — and that search is
  now the first `fill` in the walkthrough while `enter_hold_member_id` is the first unbound `fill` in
  the workflow. Orbit will offer the *search box* for the member-ID step. It is visibly wrong in the
  review — "Filled 'Search the catalog'" against a member-ID step — which is exactly what the review
  screen is for. Dismiss it and demonstrate those three per step, or accept only the rows whose
  element is right.

  This is the honest cost of a greedy, in-order alignment, and it is preferred to an optimal one
  that would be right more often and predictable never (**ADR-035**).

## Then publish and run it

Once all nine carry an approved, non-stale binding, the review page offers **Publish**. Run the
published agent from the Agents tab with ISBN `978-0-13-235088-4` and member ID `LIB-1001`; it
should reach outcome `borrowed`. `978-0-201-63361-0` should reach `held`.

## What is guaranteed, and what is not

**Guaranteed:**

- Nothing a walkthrough produces is live until a person accepts it. It writes *proposals*, one row
  each, and cannot write a binding at all.
- Accepting goes through the one path any binding is created by. There is no second route.
- The alignment calls no model. `alignDemonstration` is synchronous, so it cannot.
- What you typed is never stored. A fill's value comes from the step's own declared
  `${inputs.bookIsbn}`, never from the demonstration — so a password field's contents cannot reach a
  proposal even in principle.
- Accepting refuses if the world moved: if the step was bound another way while the proposal waited,
  or edited so its checksum no longer matches.

**Not guaranteed:**

- That the alignment is right. It matches on kind and order, and a review screen exists because it
  can be wrong.
- That one walkthrough finishes a branching workflow. It cannot, by construction.

## Limitations

- **A walkthrough is worth doing on a workflow that is mostly unbound.** The narrowing that makes
  the first pass clean is what makes a later pass over a partly-bound workflow prone to the
  misalignment described above.
- **A decision is never bindable this way.** Branch by branch, always.
- **A step reading several values** needs a person to say which element holds which, so it comes
  back as "nothing proposed" with that as the reason.
- **The browser is headed and local.** It opens on the machine running the API, because a person has
  to see and click it.
- **A walkthrough session is in memory.** Restarting the API drops it. Anything already proposed is
  a database row and survives; the *reasons* attached to steps that got nothing do not, because a
  refusal is the absence of a row.
- **One walkthrough per workflow at a time.** Two browsers on one workflow would race each other's
  captures.
