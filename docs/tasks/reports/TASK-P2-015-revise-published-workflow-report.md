# Task P2-015 — Revise a published workflow, and one shape per review phase

**Branch:** `feat/revise-published-workflow`
**ADR:** ADR-036
**Status:** Complete, not committed

## What this delivers

A published workflow can be made editable again, and the review page stops presenting three
competing next steps to somebody who has just finished.

- **"Revise this workflow"** forks the current revision into revision N+1 as a `draft`, superseding
  it. Every existing binding survives. The published Agent Version is untouched, and publishing
  again mints the next one under the same agent.
- **One derived phase** — `drafting`, `ready`, `published` — drives the page layout, replacing six
  sections each deciding independently whether to render.
- **The walkthrough offer moved inside the binding panel**, where it belongs: a walkthrough is a
  binding action, not a fourth kind of work.

## What was already true when I started

The report's premise, verified against the code before changing any of it:

- `SOP_REVISION_TRANSITIONS` has `approved: ['superseded']`, and `request_clarification` is legal
  only from `in_review`. There has never been a path from `approved` back to editable. This is a
  missing feature, not a regression — but ADR-028's one-click publish drives
  `draft → in_review → approved → published` in one action, so a person now reaches the terminal
  state without ever passing through one they could have turned back from.
- The mechanism already existed at the repository layer: `sopGraphRevisions.create({ documentId,
  graph, provenance, parentRevisionId })` creates a `draft` and marks the parent `superseded` in the
  same transaction. Every service method calling it (`editStep`, `insertStep`, `reorderStep`) is
  gated behind `isEditableState` first, which is why it was unreachable from an approved revision.
- Binding staleness is `binding.stepSha256 !== stepChecksum(step)` — a per-step content checksum,
  never revision identity — and `execution_bindings` is keyed by `(document_id, step_id)`. Nothing
  about a binding knows what a revision is.
- `SOP_PROVENANCE_KINDS` already includes `edited`.
- `agentIdForDocument` (ADR-024) and `nextVersionAfter` (ADR-023) mean republishing lands under the
  same agent at the next version.

## The design decisions worth reviewing

### Forking rather than reopening

`reviseDocument` copies the current revision's graph unchanged into the next revision. It does not
add a transition out of `approved`, and it writes no second superseding mechanism — it calls the
same `create({ ..., parentRevisionId })` every other edit takes.

Reopening was the obvious alternative and is wrong on the merits: an approved revision is what a
published, immutable Agent Version was compiled from (ADR-005, ADR-014), so mutating it would leave
a live agent whose stated source no longer says what it said when somebody approved it.

### The graph is copied byte for byte, and that is the feature

This is the property the whole thing rests on, so it is asserted three ways rather than assumed:

- `graphSha256` and every step's `stepChecksum` are equal across the fork
  (`revision-service.db.test.ts`).
- A real persisted, approved binding still passes `isBindingUsable` against the forked revision —
  the same validator the publish gate and the review page run.
- End to end: publish, revise, the same approved step ids come back from
  `/v1/sop-documents/:id/bindings`, publish again.

### `already_editable` is a typed refusal

Following the convention every other write in `SopRevisionService` uses. Nothing has gone wrong when
a draft is asked to be revised — there is simply nothing to fork — so it is a result, not a throw,
and the route reports 409.

### `PublicationStatus.compiledFromRevisionId` — the one addition beyond the brief

Publishing was gated on `stage.kind !== 'published'`, which was a complete answer only while
published meant finished. A revised document is published *and* has an unpublished revision, so
without a way to tell those apart, Revise would have been a dead end: fork the revision, and find no
way to publish it.

The distinguishing fact was already on the candidate row (`agent_ir_candidates.revision_id`).
`PublicationStatus` and `SopPublicationView` now expose it, derived on read; **no migration, no new
persisted state**. `publicationStage(publication, currentRevisionId?)` returns
`hasNewerRevision` on the published stage, and both publish gates consult it through one
`isPublishableStage` helper. Omitting the revision id yields `false`, which is the conservative
reading — it withholds a publish action rather than offering one on an unknown.

### The confirmation

Three things are reasonable to fear before clicking Revise, and all three are false: that the
published version will change, that the mappings will have to be redone, and that the approved
revision will be rewritten. None is visible from a button, so `reviseConfirmation` states each one
first. It is a pure function with its own tests, so the copy is checkable rather than buried in JSX.

### Binding is not gated behind Revise

On a published document the binding surfaces are quieter and collapsed by default, under a
disclosure labelled for what it is. They are **not** hidden: binding is legal on an approved
revision, and it is how a drifted mapping is repaired and republished *without changing any step*
(ADR-033). Requiring a new revision for a pure re-bind would demand an edit nobody wants to make in
order to fix something that is not an edit.

The two live workspaces — an open binding sitting and an open walkthrough — stay outside anything
that collapses. Each holds a real Chromium open on the machine running the API, and a window a
person cannot see is a window they cannot close.

### One derived phase

`reviewPhase(review, bindings)` is a pure function with its own tests. The order of its checks is
the meaning: published wins over everything, because a revised document is published *and* editable
*and* fully bound at the same time, and what a reader needs told first is that something is still
running.

## Self-caught defects

- **Revise would have been a dead end.** Writing the e2e loop is what surfaced it: the fork
  succeeded, the document was editable, and the publish button was gone, because
  `offersBoundPublish` and `offersOneClickPublish` both refused a `published` stage outright. That
  is what `compiledFromRevisionId` exists for.
- **Two controls with one name.** The published lead needs the link to the agent, and
  `SopPublishPanel` already rendered `open-published-agent`. Rendered in both, `getByTestId(...)`
  would have matched two elements and Playwright's strict mode would have failed every click on it —
  and a person would have seen the same button twice. It moved to the lead and left the panel.
- **The walkthrough offer would have vanished when the bindings failed to load.**
  `SopBindingPanel` returns `null` when it has no rows, which happens exactly when
  `/bindings` could not be fetched — the moment somebody is most likely to want to demonstrate the
  workflow. The panel now renders the slot even with no rows.
- **A `<details>` hides its contents from clicks, not from `count()`.** The existing e2e test clicks
  `open-published-agent` after publishing. Had the link stayed inside the collapsed authoring block,
  the count assertion would have passed and the click would have timed out.

## Deviations from the brief

- **`PublicationStatus.compiledFromRevisionId`** was not in the brief. It is the minimum needed to
  make "publish again" reachable, and is derived from a column that already existed. Recorded in
  ADR-036 with the alternative (comparing graph checksums) and why it was rejected.
- **`open-published-agent` moved** from the publish panel to the published lead, because the brief
  asks the Published phase to lead with "Running as v0.1.0 + link to the agent" and the id must
  render exactly once.
- **The authoring block auto-opens after a successful Revise.** "Collapsed by default" is honoured —
  the default state is closed and stays closed on load. Opening it in response to somebody clicking
  Revise is not a default; it is the thing they just asked for.
- **One existing e2e assertion was rewritten, not deleted.** `sop-already-published-note` is gone as
  an element; its two claims — a version is published, and working here does not change what is
  running — are now the published lead's title and body, and the test asserts them there.

## Files

**Service**

- `packages/sop-service/src/revision-service.ts` — `reviseDocument`, `ReviseDocumentResult`,
  `PublicationStatus.compiledFromRevisionId`
- `packages/sop-service/src/revision-service.db.test.ts` — 7 new tests

**API**

- `apps/api/src/routes/sop-revisions.ts` — `POST /v1/sop-documents/:documentId/revisions`
- `apps/api/src/routes/sop-revisions.test.ts` — 5 new tests
- `apps/api/src/views.ts` — `SopPublicationView.compiledFromRevisionId`

**Watchtower**

- `apps/web/src/api-client.ts` — `reviseSopDocument`
- `apps/web/src/sop-review-view-model.ts` — `reviewPhase`, `reviewLead`, `reviseConfirmation`
- `apps/web/src/publication-view-model.ts` — `hasNewerRevision`, `isPublishableStage`
- `apps/web/src/SopReviewPage.tsx` — phase-driven layout, `ReviewLeadCard`, the collapsible
  authoring block, the walkthrough offer moved into the binding panel's slot
- `apps/web/src/SopBindingPanel.tsx` — `walkthrough` slot
- `apps/web/src/SopPublishPanel.tsx` — takes `revisionId`, no longer renders the agent link
- `apps/web/src/sop-review-view-model.test.ts`, `publication-view-model.test.ts` — 21 new tests
- `apps/web/src/watchtower.e2e.test.ts` — the full publish → revise → publish loop

**Docs**

- `docs/architecture/decisions.md` — ADR-036
- `docs/contracts/api.md`, `docs/tasks/ACTIVE_TASK.md`

No migration. No schema change. No runtime change.

## Verification — actual output

```text
pnpm typecheck        clean
pnpm lint             clean
pnpm format:check     All matched files use Prettier code style!

pnpm test             Test Files 127 passed (127)   Tests 1388 passed (1388)
pnpm test:db          Test Files  27 passed  (27)   Tests  329 passed  (329)
pnpm test:e2e:watchtower
                      Test Files   1 passed   (1)   Tests   45 passed   (45)
```

`pnpm test:runtime` was not run: nothing under `packages/runtime`,
`packages/executor-playwright` or `apps/browser-worker` was touched — `git status` lists 14 changed
source files, none of them runtime. The heavy suites were run one at a time.

The first e2e run failed one existing test (`sop-already-published-note` no longer exists as an
element). That was the intended change, not a surprise; the assertion was rewritten against the
published lead and the suite passes at 45/45.

## Limitations — honest

- **Republishing an unchanged fork mints a version.** Revise and immediately publish, and you get
  `0.1.1` behaving identically to `0.1.0`. Harmless — versions are cheap and immutable — but nothing
  detects or prevents it, and nothing warns.
- **Nothing shows what changed between revisions.** A person looking at revision 3 of a published
  workflow cannot see, in Watchtower, how it differs from the revision version `0.1.0` was compiled
  from. The data is there (both graphs are stored); the diff is not built.
- **A revised recorded workflow silently changes publish paths.** Its provenance becomes `edited`,
  so it publishes through `publish-bound-document-service` rather than
  `publish-recording-service`. This is correct — the recorded fast path exists because a person
  demonstrated every action personally, which stops being true once the graph is edited — but
  nothing on screen explains the switch, and a workflow that was one click to publish becomes one
  click *plus* the requirement that every step still carries a fresh approved binding.
- **Revising is not offered per-revision or with any history.** There is one current revision and
  one Revise button. You cannot fork from an older superseded revision.
- **The "quieter" treatment of the `ready` phase is positional only.** The authoring surfaces sit
  below the publish panel; they are not visually de-emphasised beyond that.
- **The drift-recovery model is untouched by design.** A drifted run still fails and stays failed;
  recovery still proposes only from the approved binding's own fallback chain, never scans for
  lookalikes, writes separate proposal records, and acceptance still does not publish. No copy
  added here suggests otherwise.
