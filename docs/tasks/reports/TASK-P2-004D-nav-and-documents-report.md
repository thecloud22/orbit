# Phase 2 Task 4d Report — Watchtower navigation and document list

**Status:** Complete, pending commit approval

**Branch:** `phase-2-task-4d-nav-and-documents`, off master at `e6e5984` — the tip after 4a, 4b and
4c merged.

**Scope:** Navigation, the Documents page, and `stepCount`. The styling consistency pass across 202
`className` sites stays a separate task, as agreed.

## Goal

Watchtower was one flat page. The review page and the bindings panel existed and were served, but
nothing linked to them — a workflow was unreachable unless you already knew its id, which is why the
app looked like it had lost the features built on top of it.

## What was built

**A persistent shell.** Title and navigation moved into one `Shell` component wrapping every view,
rather than being repeated per view. Before, opening a document replaced the entire page including
any way back.

**Navigation as anchors, not buttons.** Every nav item and document row is a real `<a>` with a real
`href`, intercepted only for unmodified left clicks. Middle-click, copy-link and open-in-new-tab all
keep working — a button silently breaks every one of them.

**A Documents page** listing every workflow with status, step count and revision count, each row
opening its review page. Its empty state names the only way to create a document, because until one
exists there is no route into the review page at all.

**View state derived from the URL**, in `navigation.ts`. `?view=documents` joins the existing
`?documentId=` and `?runId=`, with no router and no dependency. An existing review link still wins
over a `view` parameter, so links shared before this navigation existed keep resolving.

## The back button, which never worked

`App.tsx` called `pushState` and nothing listened for `popstate`. The back button therefore changed
the URL and left the previous view on screen — a URL and a page quietly disagreeing about where you
were. It was in scope because this task rewrote that state anyway.

Fixed by deriving the view from the URL on every history event rather than keeping state alongside
it. An end-to-end test walks back *and* forward across the documents/review boundary.

## `stepCount`, and a query removed

`summarize()` did not load the graph, so step count was unavailable. It also ran **two
near-identical queries** over the same revision rows — one ordered ascending for the count, one
descending for the status.

Collapsing those into a single descending pass makes the count, the status and the step count all
fall out of one query. The result is `summarize()` doing *less* work than before while returning
more: three round trips become two. The graph rides along rather than costing a separate fetch,
which is what the plan asked for instead of a per-document `findCurrent` in the route.

The count is read straight off the stored document rather than through the validating mapper, so a
list does not fail to render because one revision somewhere no longer parses.

## Commands and exact results

| Command | Result |
|---|---|
| `pnpm typecheck` | Pass, all 19 workspaces |
| `pnpm lint` | Pass |
| `pnpm format:check` | Pass |
| `pnpm test` | **720 passed**, 68 files |
| `pnpm db:generate` | `No schema changes, nothing to migrate` |
| `pnpm test:db` | **170 passed**, 14 files |
| `pnpm test:runtime` | 19 passed |
| `pnpm test:e2e:watchtower` | **28 passed** |
| `pnpm test:e2e` | 9 passed |
| `pnpm verify:phase1` | **Pass, including `check:teardown`** |

Counts before this task: 691 unit, 168 db, 24 Watchtower E2E.

| Added | Tests |
|---|---|
| `apps/web` — URL-derived views and nav links | 13 |
| `apps/web` — document rows, ordering, empty state | 13 |
| `apps/api` — list shape, empty case, no source text published | 3 |
| `packages/db` — `stepCount` follows the live revision | 2 |
| `apps/web` — nav, list navigation, and back/forward through the real stack | 4 |

## Changed files

**Created** — `apps/web/src/{navigation.ts,Nav.tsx,DocumentsPage.tsx,documents-view-model.ts}`,
two view-model tests, this report.

**Modified** — `packages/db/src/repositories/sop-documents.ts` (`stepCount`, one query fewer),
`apps/api/src/{views,projections}.ts`, `apps/api/src/routes/sop-revisions.test.ts`,
`packages/db/src/repositories/sop-graph.db.test.ts`, `apps/web/src/App.tsx`,
`apps/web/src/watchtower.e2e.test.ts`, `README.md`, `docs/tasks/ACTIVE_TASK.md`.

**Untouched** — `SopReviewPage.tsx` and `SopBindingPanel.tsx` entirely, as required;
`packages/execution-{mapping,recorder,assist}`; the runtime, interpreter and drift check; every
table and migration. **No schema change and no new dependency.**

## Known limitations

- **The styling inconsistency remains.** 202 hand-written `className` strings across 10 components,
  with the card, section heading and muted caption patterns repeated 13, 12 and 13 times. Kept out
  deliberately: mixed into this diff, a reviewer could not tell which of ~250 changed lines were
  behavioural.
- **The document list is unpaginated and unsorted server-side.** Every document is fetched and
  ordered in the browser. Fine at present scale; a `limit`/`cursor` belongs on the endpoint before
  it is not.
- **`GET /v1/sop-documents` still summarises one document per query.** The route's existing N+1 is
  untouched — each `summarize()` is now cheaper, but there is still one per document.
- **Navigation has three views and no more.** A run is still reached only by `?runId=` on Home, with
  no run list, exactly as Phase 1 left it.
- **`stepCount` counts the current revision's steps, including unreachable ones.** It is a size
  indicator, not a coverage measure; the bindings panel is where coverage is reported.
