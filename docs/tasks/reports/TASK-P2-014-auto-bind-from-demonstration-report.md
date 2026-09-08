# Task P2-014 — Bind a whole workflow from one walkthrough

**Branch:** `feat/auto-bind-from-demonstration` (merged to `master`, pushed)
**ADR:** ADR-035
**Demo:** `docs/demo/walkthrough-binding-demo.md`

## What this delivers

A drafted workflow's steps can be bound by **performing the task once** instead of demonstrating
each step separately. One browser, one pass, then a review screen showing every drafted step with
what was proposed for it — and, for the steps that got nothing, why.

The line, enforced by test: **a walkthrough writes proposals and cannot write a binding.** Accepting
one runs `create` → `submitForReview` → `approve` through `acceptRecoveryProposal`, which is the one
function any binding in Orbit is created by. This task did not add a second.

## What was already done when I started

The deterministic core was complete and green in the working tree, uncommitted:
`packages/sop-recording/src/align.ts` and `normalize.ts` with their tests, plus the `translate.ts`
change that routes recording through the same focus-click rule. I preserved its properties exactly
and built the wiring around it. Two things about it I did change:

- **It had never been formatted.** `prettier --check` failed on all four files. Fixed before the
  first commit; had it gone in unformatted, `pnpm format:check` would have failed on the branch.
- Nothing else. `alignDemonstration`'s signature, semantics and comments are as I found them.

Everything below the pure layer — the session, the API, the persistence, the view models, the panel,
the docs — is this task.

## The design decisions worth reviewing

**Why demonstrate-once rather than match hints against the page.** This is the decision the whole
feature turns on. Matching a drafted step's `targetHint` against elements on the start URL sounds
cheaper and does not work: **most of the elements a workflow acts on do not exist until you have
interacted with the page.** The library workflow's Borrow button appears only after a search returns
an available title; the confirmation text only after the loan is placed. A static scan could bind
one step of nine and would have to guess the rest — and a guess about which element to click is
exactly the judgement ADR-018 and ADR-033 exist to withhold.

**Why greedy over optimal.** An optimal alignment (Levenshtein or Hungarian over kinds) matches more
steps in awkward cases, and nobody can predict what it will do — including whoever wrote it. The
output here is a set of claims a human accepts or rejects one at a time, and for that, predictable
beats occasionally-better: a reviewer can verify greedy-in-order **by counting**. The first fill you
performed is the first unbound fill in the draft.

**Why proposals rather than direct writes.** Alignment can be wrong, so nine unreviewed mappings
going live from it is the failure this design is shaped to prevent. This is ADR-033's posture, and I
reused ADR-033's *machinery* rather than paralleling it — which the task asked me to judge.

**The recovery proposal table nearly fitted, so I extended it.** Everything that makes a proposal a
proposal was already right: a drafted binding attached to its document and step, superseding nothing
while it waits, one open per step by partial unique index, accepted through the ordinary lifecycle.
Two things did not fit, and both are one migration: `proposed_for_binding_id` was `NOT NULL` (a
walkthrough proposal replaces nothing, because its step has never been bound) and there was no way
to tell the two kinds apart. `0010_proposals_from_demonstration` drops that NOT NULL, adds
`origin` (`drift` | `demonstration`, defaulting to `drift`), and adds a CHECK that a `drift`
proposal must still name its target. **It alters two columns and touches no row.**

**The accept path was generalised, not branched.** Both origins ask the same question — *is the
step's live binding still what this proposal was written against?* — so the superseded check is now
`(current?.id ?? null) !== (proposal.proposedForBindingId ?? null)`. For a walkthrough proposal,
"still unbound" is the condition, and a binding appearing while it waited is exactly as much of a
reason to refuse.

**I kept the table's name, and that is a deliberate trade.** `binding_recovery_proposals` is now
narrower than what it holds. Renaming to `binding_proposals` means a migration on an audit table
plus a rename through the repository, the mappers, the contract id type, the errors, the service,
the routes, the views and the Watchtower panel — a broad refactor to buy a noun, against
`CLAUDE.md`'s rule about broad refactors. The schema file's header now says plainly what the table
holds and why the name stayed.

**Why decisions are excluded.** One walkthrough follows one path; a decision needs one element per
branch or it compiles to an `expect_one_of` that cannot name a state the agent can reach (ADR-029).
It is stated in the panel **before** anyone starts and again beside the decision's own row — because
somebody who is not told reads a blank row as Orbit having failed rather than as Orbit declining.

**A third session registry, not a flag on an existing one.** What separates the three is what
*finishing* means: a recording finishes by creating a document; a binding sitting never finishes (it
saves a row and leaves the page where it is); a walkthrough finishes by proposing and closing the
browser. One method meaning three things behind a discriminated input is the overload ADR-020 warned
about. What they share — ids, idle reaping, `closeAll`, and a Chromium that must not outlive the API
— is the existing `recording/session-store.ts`.

**The session outlives its browser, for one specific reason.** A proposal is a row; a refusal is the
*absence* of one. "Nothing in the walkthrough matched this step" cannot be recovered from the
database at all, so the session entry stays after the window closes, holding the outcome. Each
proposal's `state` is re-read live on every poll, so one accepted in another tab stops offering an
accept button.

**Reading a value is an explicit mode.** A walkthrough runs in `action` mode because the person is
doing the real task. An `extract` step is demonstrated by *pointing*, which must not fire the page's
handlers, so the panel offers the switch and says which mode is active rather than inferring it — a
click that reads and a click that presses are the same event, and guessing wrong is not undoable.

**Bulk accept is N calls, not a bulk endpoint.** Each acceptance is independently refusable — a step
somebody bound in another tab must be refused while the rest go through — and a server-side loop
would have exactly those semantics with one more route to keep honest.

**What was typed never reaches a proposal.** A fill's `valueSource` comes from
`defaultValueSourceFor(step)` — the step's own declared `${inputs.bookIsbn}` — never from the
demonstration. A password field's contents therefore cannot reach a durable row even in principle.
`demonstration-service.db.test.ts` asserts the typed ISBN does not appear anywhere in the serialised
proposal.

## The sharp edge, found while building and left in deliberately

**A second walkthrough over a partly-bound branching workflow misaligns.** Walking the library
workflow's hold path after the borrow path has been bound: alignment is offered only the still-
unbound steps, but the walkthrough still *performs* the search prefix to reach the hold form. So the
first `fill` in the walkthrough is the ISBN box while the first unbound `fill` is
`enter_hold_member_id`, and Orbit offers the search box for the member-ID step.

I considered offering *all* bindable steps and proposing only for unbound ones, which fixes this
case and breaks the ordinary one (a walkthrough of a workflow bound from step 4 onward), and it
contradicts `alignDemonstration`'s documented contract. I kept the contract. The wrong proposal is
visibly wrong in review — "Filled 'Search the catalog'" against a member-ID step — which is what the
review screen is for, and the demo doc says to bind the second branch per step. Recorded in ADR-035
under Consequences and in the demo's Limitations, rather than left to be discovered.

## Self-caught defects

- **`align.ts` and friends were never formatted.** Caught by running `prettier --check` before the
  first commit rather than at the end; the branch would have failed the format gate.
- **`BindingFailure` needs `sessionSurvived` and `issues`.** My first mapping of a walkthrough
  failure into the shared notice omitted both. `sessionSurvived: false` is right here — no browser
  was ever opened — and saying otherwise would send somebody looking for a window that does not
  exist.
- **`toRecoveryProposalView` typed `proposedForBindingId` as non-nullable.** Making the column
  nullable surfaced it at the projection and the view; `replacesBindingId` is now `string | null`
  and `RecoveryProposalView` carries `origin`.

## Files

**New:**

- `packages/sop-service/src/demonstration-service.ts` + `.db.test.ts` — alignment → validated
  proposals. The composition root; imports no browser.
- `apps/api/src/recording/walkthrough-session-registry.ts` + `.db.test.ts`
- `apps/api/src/routes/walkthrough-sessions.ts` + `.test.ts`
- `apps/web/src/WalkthroughPanel.tsx`, `walkthrough-view-model.ts` + `.test.ts`
- `packages/db/drizzle/0010_proposals_from_demonstration.sql`
- `docs/demo/walkthrough-binding-demo.md`

**Changed:** the proposal schema, mapper and repository (`origin`, nullable target);
`recovery-service.ts` (generalised accept); `views.ts`, `projections.ts`, `context.ts`,
`bootstrap.ts`, `server.ts`, `stub-context.ts`, `api.db.test.ts`; `fake-recording-session.ts` (a
`pick` capture); `stack-ports.ts` and `stack-global-setup.ts` (an unbound branching document for the
e2e); `api-client.ts`, `navigation.ts` + test, `App.tsx`, `SopReviewPage.tsx`,
`sop-binding-view-model.test.ts`; `watchtower.e2e.test.ts`; `seed-library-demo.ts` (`--unbound`);
`package.json`; `docs/architecture/decisions.md`; `docs/demo/branching-library-demo.md`;
`docs/tasks/ACTIVE_TASK.md`.

**Separate commit:** `apps/web/src/HomePage.tsx` — the two options swapped so recording is first.

## Verification — actual output

```text
pnpm typecheck              clean
pnpm lint                   clean
pnpm format:check           All matched files use Prettier code style!
pnpm test                   Test Files 96 passed | Tests 1287 passed
pnpm test:db                Test Files 22 passed | Tests 253 passed
pnpm test:runtime           Test Files 8 passed | Tests 33 passed
pnpm test:e2e:watchtower    Test Files 1 passed | Tests 40 passed
pnpm test:e2e               Test Files 3 passed | Tests 24 passed
```

New coverage: 8 db tests for the demonstration service, 9 db tests for the walkthrough registry, 13
route tests, 18 view-model tests, 2 navigation tests, and 2 e2e tests (the walkthrough path; the
home-page card order).

The end-to-end test drives the real thing: a drafted, unbound **branching** workflow, one
walkthrough, nine rows back, the demonstrated step proposed, the decision refused with its reason on
screen, accept-all, and the review page's own binding panel reporting Approved. Only the browser is
substituted, the same way recording substitutes it.

## Limitations — honest

- **The alignment can be wrong.** It matches on kind and order. The review screen is not a
  formality.
- **A branching workflow needs more than one pass, and the second one misaligns** as described
  above.
- **A decision is never bindable this way.** Permanent.
- **A step reading several values** comes back as "nothing proposed", because which element holds
  which field is a judgement a walkthrough cannot make.
- **A walkthrough session is in memory.** An API restart drops it. Proposals survive as rows; the
  refusal reasons do not, because a refusal is the absence of a row.
- **One walkthrough per workflow at a time**, and it does not coordinate with an open binding
  session on the same document — the affordance is hidden while one is open, which is a UI
  convention rather than a server-enforced rule.
- **The browser is headed and local**, as for recording and per-step binding.
- **`binding_recovery_proposals` now holds two kinds of proposal under a name that describes one.**
  Documented in the schema; a rename was judged not worth the churn.
- **No model is involved anywhere in this feature**, so no spend is recorded and no budget scope
  applies. If ranking is ever added, `alignDemonstration`'s synchronous signature has to change
  first, which is a change a reviewer sees.
