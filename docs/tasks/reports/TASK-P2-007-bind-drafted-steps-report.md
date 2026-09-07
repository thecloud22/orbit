# Task P2-007 — Binding a drafted workflow's steps from Watchtower

**Sub-phase:** 2.7
**Branch:** `phase-2-task-7-bind-ai-drafted-steps`
**Status:** Complete

## Why this task exists

A drafted SOP Graph — generated from free text, or authored by hand — reaches the compiler with no
Execution Bindings and is refused with `missing_binding`. ADR-019 had put binding creation in the
recorder CLI, on the sound grounds that demonstrating a step needs a real browser and a person's
hands. The consequence was a structural dead end: the guided path produces a workflow in Watchtower,
and the only way out of the state it lands in was a terminal — which puts a shell in front of exactly
the person the guided path exists for.

ADR-020 had already answered the same objection for whole-workflow recording, and nothing in that
reasoning was specific to recording an entire workflow rather than one step of one.

## What was built

### Binding sessions (ADR-027)

`apps/api/src/recording/binding-session-registry.ts` holds a headed browser open against one
document and one step at a time. Five routes in `apps/api/src/routes/binding-sessions.ts`:
`POST /v1/binding-sessions` (open), `GET /:sessionId` (poll), `POST /:sessionId/target` (re-aim the
same browser at another step), `POST /:sessionId/binding` (save one), `DELETE /:sessionId` (close).

A session is a **sitting**, not one session per step. Mapping a workflow means binding several steps
in sequence and each starts where the last left the page — signed in, filtered, three clicks deep —
so saving a binding writes one row and leaves the browser exactly where it is. That is the concrete
difference from recording, where finishing *creates a document and closes the browser*, and it is why
this is a separate registry rather than a mode of `RecordingSessionRegistry`.

Only `fill`, `click` and `extract` are offered — exactly the compiler's `BINDABLE_KINDS`. Starting or
targeting any other kind is refused with `not_bindable`.

### The shared hazard, shared in code

`apps/api/src/recording/session-store.ts` is new: ids, idle reaping, an unreferenced sweeper and
`closeAll`. Both registries build on it, and `session-registry.ts` was refactored onto it rather than
left as a second copy. What the two registries share is not their behaviour but their hazard — each
holds a real Chromium process that must not outlive the API — and two copies of that handling would
drift in exactly the way that strands a browser. Session ids are prefixed (`rec_`, `bind_`) so one
can never be used against the other. The 30-minute idle timeout is unchanged.

Both registries are closed on the same shutdown path in `bootstrap.ts`.

### Binding assembly moved into `@orbit/sop-service`

`packages/sop-service/src/binding-service.ts` (moved from `apps/recorder/src/binding-service.ts`)
now holds `bindingBodyFor`, `assembleBinding`, `createBinding`, `declaredNames`,
`captureModeForStepKind` and `defaultValueSourceFor`. Two things now turn a demonstration into a
binding, and what a real browser click *means* must have exactly one definition — the same reasoning
that put `stepChecksum` in `@orbit/db`. The recorder CLI imports it; its behaviour is unchanged.

`@orbit/sop-service` does **not** import `@orbit/execution-recorder`. A capture crosses that boundary
as a plain `{selectors, fingerprint, url, typedValue?}` shape, so the composition root never depends
on the package that injects script into a page.

### Publishing a fully bound draft

`packages/sop-service/src/publish-bound-document-service.ts` mirrors `publish-recording-service.ts`
with a different precondition: every step the compiler requires a binding for has an approved,
non-stale, issue-free one. The four-call sequence both paths share was extracted to
`publish-pipeline.ts`, so the two differ *only* in what they check first — two copies of a state
transition sequence would be two places for it to drift, in the part of the system where "what states
did this actually go through" is the product.

`POST /v1/sop-documents/:documentId/publish-bound` is the route. `SopPublishPanel` gains
`offersBoundPublish(provenanceKind, stage, fullyBound)` beside the existing
`offersOneClickPublish`; `SopReviewPage` picks the endpoint by provenance. A partly bound or unbound
draft still gets no button and an honest note instead — ADR-025's line is unchanged.

### Watchtower

`SopBindingPanel` gains a per-row "Bind this step" / "Bind this step again" button, gated by
`canBindStep` (bindable kind, and either unbound or stale). `BindingSessionPanel.tsx` is the live
capture/confirm UI, polling on the same interval the recording panel uses, with pure view logic in
`binding-session-view-model.ts`. The open session id lives in the review page's URL
(`?documentId=…&bindingSessionId=bind_…`) so a reload reattaches to the browser rather than orphaning
the window it opened.

The confirm form asks only what a capture cannot answer: which capture was the step, and — for a step
declaring more than one field — which value this binding reads. A drafted fill step already declares
where its value comes from, so that is stated rather than asked.

## Governance and safety, stated explicitly

- **A binding created through Watchtower is approved on creation**, in one transaction
  (created → submitForReview → approved), matching `recording-service.ts`'s precedent. The
  demonstration is the review.
- **`routes/sop-bindings.ts` stays read-only.** The write path is its own route file; the existing
  guard tests asserting binding data cannot be mutated through the read surface are unchanged and
  still pass.
- **The revision and checksum a binding records are read at save time, not at session start.** A
  sitting outlives edits to the workflow it is binding; a step edited out from under the session is
  refused rather than bound to something that no longer exists.
- **Typed values are never echoed back.** A capture summary says which element was hit and whether it
  was sensitive; it does not carry what was typed. A password field's value is never captured at all.
- **`recording-boundary.test.ts` was extended** to confirm the new registry stays inside
  `apps/api/src/recording/`, the one directory ADR-020 permits for script-injection-adjacent code.
- **One protocol guard, called by both.** `routes/browser-target.ts`'s `assertOpenableTarget`
  refuses anything but `http`/`https` (ADR-022, unchanged) and is called by the recording routes and
  the binding-session routes alike, so the two cannot come to disagree about what may be opened.
- **No model-backed selector advice** was added. Out of scope, and not built.
- The compiler, publish/execute, and the runtime were not touched, per the brief's scope boundary.

## Tests

| Suite | Result |
|---|---|
| `pnpm typecheck` | clean (20 workspace projects) |
| `pnpm lint` | clean |
| `pnpm format:check` | clean |
| `pnpm test` | 916 passed (86 files) |
| `pnpm test:db` | 265 passed (22 files) |
| `pnpm test:runtime` | 21 passed (4 files) |
| `pnpm test:e2e:watchtower` | 36 passed (1 file), 36.5s |
| `pnpm test:e2e` (demo portal) | 9 passed |
| `pnpm check:teardown` | exit 0 — ports 3000/3001/3002/3010/3102 free, no surviving process |

New coverage: `binding-service.test.ts` (15 — `bindingBodyFor`, `defaultValueSourceFor`,
`declaredNames`, `captureModeForStepKind`); `binding-service.db.test.ts` (15, moved from
`apps/recorder` and extended); `binding-session-registry.db.test.ts` (15 — start/target/bind,
every refusal, idle reap, `closeAll`, one-session-per-document); `binding-sessions.test.ts` (17 —
validation, 404s, 409 on a second session for one document, 422 with issue details);
`publish-bound-document-service.db.test.ts` (6); `publish-bound.test.ts` (6);
`binding-session-view-model.test.ts` (19). `sop-binding-view-model.test.ts` and
`publication-view-model.test.ts` were extended for `canBindStep`, `bindActionLabel`,
`isFullyBoundForPublish` and `offersBoundPublish`.

End-to-end: a new case binds a step on a seeded drafted document entirely through the UI — open the
session, watch captures arrive, select one, save, see the row turn Approved, click Done — against the
fake recording-session factory, the same substitution whole-workflow recording already uses. The
existing case asserting the binding panel "offers no way to create, approve or change a binding" was
re-aimed at what remains true: no way to approve or reject someone else's binding, and no button on a
`manual_review` step.

## No schema change

This task adds no table and no column. A binding session is in-memory process state; saving one
writes the same `execution_bindings` rows the recorder CLI already wrote.

## Limitations, stated rather than solved

- **Approving or rejecting somebody else's binding still has no Watchtower surface.** The panel now
  says so explicitly rather than leaving it to be discovered.
- **A binding session is in-memory.** An API restart drops every open session and closes its browser;
  there is no reattachment across process restarts, only across page reloads.
- **One sitting per document.** A second concurrent session on the same workflow is refused with
  `session_exists` rather than queued or multiplexed.
- **The start URL is suggested from the graph's own `navigate` step and then left alone.** A workflow
  with no navigate step starts with an empty field the person must fill in.
- **A step declaring several fields needs the value chosen by hand** — a binding reads one element,
  and which one is a judgement the capture cannot supply.
- **Sub-phase 2.5's limitations are unchanged**: the escalation-review reference workflow still does
  not compile (branching unsupported), and a workflow needing credentials still compiles but can
  never be approved.

## Files

**Created** — `apps/api/src/recording/{session-store,binding-session-registry}.ts` and
`binding-session-registry.db.test.ts`; `apps/api/src/routes/{binding-sessions,publish-bound}.ts` and their tests;
`apps/api/src/routes/browser-target.ts` (no test of its own — exercised through both route suites);
`packages/sop-service/src/{binding-service,
publish-bound-document-service,publish-pipeline}.ts` and their tests;
`apps/web/src/BindingSessionPanel.tsx`; `apps/web/src/binding-session-view-model.ts` and its test;
this report.

**Modified** — `apps/api/src/recording/session-registry.ts` (refactored onto the shared store);
`apps/api/src/{bootstrap,context,projections,server,views}.ts`;
`apps/api/src/routes/recording.ts`; `apps/api/src/testing/{stub-context,stack-ports,
stack-global-setup}.ts`; `apps/api/src/{api.db,recording-boundary}.test.ts`;
`apps/recorder/src/{flow.ts,cli/record-binding.ts}`; `packages/sop-service/src/{index,
publish-recording-service}.ts`; `apps/web/src/{App,SopBindingPanel,SopPublishPanel,
SopReviewPage}.tsx`; `apps/web/src/{api-client,navigation,publication-view-model,
sop-binding-view-model}.ts` and their tests; `apps/web/src/watchtower.e2e.test.ts`;
`docs/architecture/decisions.md` (ADR-027); `docs/tasks/ACTIVE_TASK.md`.

**Untouched** — `@orbit/agent-ir-compiler`, `@orbit/agent-ir`, `@orbit/execution-mapping`,
`@orbit/sop-graph`, `@orbit/runtime`, `@orbit/executor-playwright`; every Phase 1 table; the seeded
fixture; `routes/sop-bindings.ts` and its read-only guard tests.
