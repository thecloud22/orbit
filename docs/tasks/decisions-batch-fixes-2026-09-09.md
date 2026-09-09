# Decisions — batch of ten fixes, 2026-09-09

Ten independent items, requested in one message with "take your decisions in
the best way." Each is committed separately, in the repo's usual one-concern-
per-commit style. This file records the judgment call each one needed and why,
so the reasoning survives past the diff.

Order below is completion order, not the order given.

---

## 1. Add the missing `NOT_FOUND` error code to the taxonomy

**The gap.** `apps/api/src/errors.ts`'s own header comment named this
directly: `notFound()` reported `VALIDATION_ERROR` on every 404 because
`@orbit/contracts`'s `errorCodeSchema` had no dedicated code, "out of scope"
for whichever task first hit it.

**Decision.** Add `NOT_FOUND` to `errorCodeSchema` (purely additive — checked
every non-test file that imports `ErrorCode` for an exhaustive switch that
would need a new arm; there is none) and point `notFound()` at it. Left
`conflict()` alone: this task named `NOT_FOUND` specifically, not a `CONFLICT`
code, and `conflict()`'s own comment already explains why it stays on
`VALIDATION_ERROR` + 409 (no caller needs to branch on 409 vs. 404 in the
body when the status line already says it).

**Also fixed, same bug, found while checking the blast radius.**
`setNotFoundHandler`'s "No such route" 404 used the identical
`VALIDATION_ERROR` workaround. Left inconsistent, a caller would see
`NOT_FOUND` from every named-resource lookup but `VALIDATION_ERROR` from a
typo'd URL — worse than not fixing either. Changed both.

**Blast radius.** Grepped every test asserting a 404 for a `VALIDATION_ERROR`
code specifically (not just a 404 status) — two hits, both in
`apps/api/src/server.test.ts`, both updated to expect `NOT_FOUND`. No other
test coupled to the old code.

---

## 2. Fix the two Agent IR validator blind spots

*(terminal.read / terminal.type / api.request.arguments)*

**The gap.** `packages/agent-ir/src/validate.ts`'s `checkReferences` switch —
the pass that rejects `${inputs.x}`/`${variables.x}` references that do not
name a real declaration — was written against `browser.fill` and
`browser.extract` and never extended for the terminal or API surfaces added
later:

- `terminal.type` had no case at all, so an undeclared input typed into a
  terminal field passed validation silently.
- `terminal.read` had no case at all, so an undeclared assign target on a
  screen read, and a `${result.x}` naming no field the step reads, both
  passed. `checkValue`'s field-existence check was additionally hard-coded to
  `step.type === 'browser.extract'`, so widening the switch alone would not
  have been enough.
- `api.request`'s case checked `step.assign` (the response side) but never
  `step.arguments` (the request side) — the half that actually carries
  dynamic values into a call.

Found a fourth, related gap while fixing the third: `checkDefiniteAssignment`
(`VARIABLE_NOT_ASSIGNED_ON_ALL_PATHS`) tracks which steps assign a variable
via a hard-coded `browser.extract` / `api.request` check with no
`terminal.read` arm, and its `readsOf` helper — which decides what a step
reads — had no case for `terminal.type` or `api.request` either. Left as
found, a correct terminal workflow that assigned a variable via
`terminal.read` and read it later would have failed to validate at all: the
variable would look permanently unassigned.

**Decision.** Extend all four sites consistently rather than only the two
named: `checkReferences`, `checkValue`'s field-existence check, `readsOf`, and
`checkDefiniteAssignment`'s assigned-tracking. Fixing the named blind spots
while leaving `readsOf` behind would have just moved the same defect into a
different function.

For `api.request.arguments`, added a new `argument` value-position
(`NAMESPACES_BY_POSITION`) rather than reusing `value`: `value` permits
`${credentials.x}` because a browser or terminal field is typed once and
never serialized elsewhere, but an API argument becomes part of a request
that is logged, retried and shown as evidence. Authentication already has its
own path (`step.auth.credentialRef`, ADR-038); letting a credential leak in
through a plain argument string would be a second, uncontrolled path to the
same secret. `argument` allows only `inputs`/`variables`, and a test pins
down that `${credentials.x}` in an argument is refused.

Reused the existing `UNKNOWN_EXTRACT_FIELD` / `UNDECLARED_ASSIGN_TARGET`
issue codes for `terminal.read` rather than minting terminal-flavoured ones.
This is unlike the *runtime* error codes (`BROWSER_TIMEOUT` etc.), which
ADR-037 keeps separate per surface because they are embedded in immutable
published Agent Versions forever. `AgentIrIssueCode`s are compile-time
validator output, not a runtime execution fact, so there is no immutability
argument for a second code meaning the same thing.

**No compiler path emits `terminal.*` steps yet** (Phase 3's terminal track
is schema-only so far), so there is no seeded fixture to mutate the way
`__tests__/fixture.test.ts` mutates the Find Service Request YAML. Nine new
tests in `packages/agent-ir/src/validate-surfaces.test.ts` hand-build minimal
valid documents against the raw schemas instead. Mutation-tested by
reverting all four sites and confirming exactly the five negative-case tests
failed (the four positive-case tests pass trivially either way); restored.


---

## 3. Wire the "reject a candidate" button into Studio

**The gap.** `SopCandidateService.reject()` existed at the service layer
(`packages/sop-service/src/candidate-service.ts`) and in the database
transition table (`compiled -> rejected`), but had no HTTP route, no client
function, and no button anywhere. `compileDocument` and `approveCandidate`
were likewise fully implemented client-side but called from no component —
one-click publish (ADR-025/027) compiles, approves and publishes in a single
server-side call, so a person reviewing a workflow never sees a raw candidate
to individually approve or reject.

The one place this actually matters: `cannot_validate` (ADR-021 — a recorded
sign-in Orbit cannot supply). A candidate stuck there can never be approved,
but nothing let a reviewer say so explicitly; it just sat in `compiled` state
forever, and the publish panel's own copy already read as a dead end
("...so it cannot be approved or published") with no action to close it out.

**Decision.** Add the missing route (`POST
/v1/agent-ir-candidates/:candidateId/reject`, mirroring `/approve` exactly)
and client function, and surface a "Reject this candidate" button in
`SopPublishPanel` specifically when `stage.kind === 'cannot_validate'` — the
one stage this whole feature exists for. Not offered elsewhere: an
`awaiting_approval` or `publishable` candidate has no reason to be rejected
by hand today, and adding a button with no real use invites confusion about
what it is for.

Rejection intentionally asks nothing of the sandbox (unlike approval's
`not_ready` check) — a reviewer can reject a candidate whether or not it
could ever be checked, because rejecting is a judgment call, not a technical
gate.

**A gap this exposed.** `publicationStage()` had no branch for
`candidateState === 'rejected'` at all — it would have fallen into
`awaiting_approval` ("...waiting for technical approval"), which is actively
wrong once rejected. Added a `rejected` stage with its own summary text.
Confirmed `isPublishableStage()` already treats every non-`published` kind as
offering the one-click Publish button, so hitting Publish again after a
rejection correctly recompiles a fresh candidate rather than requiring a
separate "try again" affordance.

**Verification.** Route: 5 new tests mirroring the approve route's exact
pattern (success, no-note, illegal-transition, not-found, malformed id).
View model: 2 new tests (`rejected` stage reads from `candidateState` even
when `sandboxState` says `ready`, proving `candidateState` is checked before
`sandboxState`), mutation-tested by removing the branch and confirming the
new test fails on the resulting `awaiting_approval` misclassification.
Live-checked the reject route end-to-end against the real running API and
database: hitting it against a real already-approved candidate correctly
returned the `illegal_transition` refusal with the exact message the route
constructs. Could not manufacture a real `compiled`-state candidate live in
the time available (every seeded document's current revision was either
already superseded past `approved` or blocked by an unrelated stale binding
on recompile); the success path is covered by the route-level and
view-model-level tests instead, both mutation-verified.

---

## 4. `declareOutput`, symmetric to `declareInput`

**The gap.** `declareInput` closed the "recorded literal → declared run
input" gap earlier this session. Its exact mirror was missing on the output
side: an outcome step's `returns[].name` is checked against what some step
*produces* (`UNDECLARED_OUTCOME_RETURN` in `@orbit/sop-graph`'s own
validator), but the compiler separately requires that same name to appear in
the graph's own top-level `outputs` declaration — it becomes
`agentIr.outputs`, and Agent IR's `checkReferences` checks `complete.outputs`
against exactly that (`UNDECLARED_OUTPUT`). Nothing let a person add to
`graph.outputs` after a document was created; it was populated only by
whatever the drafting flow happened to generate.

**Found while building this**: the seeded escalation-review test fixture
itself has the bug this closes. Its `completed` outcome step returns
`openedDate` and `lastUpdatedDate` — both genuinely produced, by an `extract`
step earlier in the graph — but neither name is in the fixture's `outputs`
array. `@orbit/sop-graph`'s own validator has no cross-check between
`returns` and `outputs` (confirmed by reading `validate.ts` — `graph.outputs`
is only checked for duplicate names), so this passes SOP Graph validation
today and would only surface as `UNDECLARED_OUTPUT` at Agent IR compile time.
Not fixed here — out of scope for a symmetric-API task, and fixing the
fixture wasn't asked for — but used as the realistic example in the new
tests, since it is a real instance of exactly the gap `declareOutput` closes.

**Decision.** Mirror `declareInput` at every layer: `declareOutput` on
`SopRevisionService` (not_found / not_editable / duplicate_output /
invalid_graph, keyed by `name` rather than `id` since `outputDeclarationSchema`
is `{name, label, description?}` with no `type`/`required` — an output
declaration carries neither), `POST /v1/sop-revisions/:revisionId/outputs`,
`declareSopOutput()` client function, and a new `SopOutputsPanel` component
next to `SopInputsPanel` in Studio's review page. Also added `outputs` to
`SopReviewView` (via a new `SopDraftOutputView`) and its projection — the
review view had no way to read declared outputs back at all, the same way it
already couldn't before `declareInput`'s own `inputs` field existed.

**Coverage parity check.** `declareInput` has no dedicated HTTP-route-level
test anywhere in the codebase — only service-layer db-integration tests.
Matched that exactly rather than introducing asymmetric extra coverage:
4 new db-integration tests (add, add-with-description, duplicate, not-
editable), mutation-verified by disabling the duplicate check and confirming
the expected test fails (falling through to the schema's own
`DUPLICATE_OUTPUT_ID` as `invalid_graph` instead of the friendlier
`duplicate_output`). Live-verified the route end-to-end against the real API
and database: declared `memberStatus` on a real draft document, confirmed it
appeared in the review response, and confirmed a second attempt at the same
name was correctly refused with the exact conflict message the route
constructs.

---

## 5. Disambiguate identically-titled documents in Studio's document list

**The gap, confirmed by my own testing this session.** While repeatedly
testing the SOP review/binding flows earlier in this session, I hit the exact
problem this closes: Studio's document list (`DocumentsPage.tsx`) has
several documents titled "Lib-004" and several titled "Lib-003" (created
while iterating on the same test scenario), each row showing only a title, a
step/revision count, and a day-granular creation date. With two rows reading
identically, I had to fall back to `curl`-ing the API directly and reading
raw document ids to tell them apart — exactly the failure mode a real user
hits the moment they iterate on a workflow more than once under the same
name, which nothing stops them doing.

**Decision.** Add a `disambiguator: string | null` to `DocumentRow`, set only
by `documentRows` (never by `toDocumentRow`) — telling two rows apart is a
property of the list they sit in together, not of either document alone, the
same reasoning that already put newest-first sorting in `documentRows`
rather than in the per-row mapper. When a title collides with another row's
in the same list, both get tagged with the last 6 characters of their
document id, uppercased (`#R7FPR1`) — opaque, but guaranteed different for
two different documents, which neither the title nor the day-level date is.
Unique titles get no tag at all, so the common case stays exactly as
uncluttered as it already was.

Considered showing the full creation timestamp instead of a document-id
fragment. Rejected: two documents created seconds apart during the same
testing session (exactly what produced the real duplicates I hit) would
still look identical at any reasonable display granularity, whereas the
document id is guaranteed unique by construction.

**Verification.** 3 new tests in `documents-view-model.test.ts` (no
disambiguator when titles are unique, distinct tags on colliding rows, an
unrelated unique title untouched in the same list), mutation-verified by
short-circuiting the tagging pass and confirming the collision test fails.
Live-verified against the real running app via Playwright: of the app's 15
real documents, exactly the two "Lib-004" rows and two "Lib-003" rows shown
each carried a distinct `#XXXXXX` tag, and none of the eleven uniquely-titled
rows did.

---

## 6. Name the specific refusal for a recorded sign-in's secret input

**The gap.** `assessSandboxReadiness` (`packages/agent-ir-compiler/src/sandbox.ts`)
already computes exactly the right thing: which secret input(s) block
validation, named individually, in a real sentence
(`This workflow needs "password", which Orbit cannot supply yet...`). It is
stored verbatim as `sandboxNote` on the candidate record
(`candidate-service.ts` already writes it). None of that ever reached a
person: `SopPublicationView` — what `SopReviewPage`/`SopPublishPanel`
actually read — had no `sandboxNote` field at all, so `cannot_validate`
always rendered the same generic, deliberately-vague sentence Studio's own
copy already used, regardless of which input, or how many, actually blocked
it.

**Decision.** Thread the existing field through rather than inventing a new
mechanism: added `sandboxNote` to `PublicationStatus`
(`revision-service.ts`, read from `candidate.sandboxNote` already available
in `publicationStatusFor`), to `SopPublicationView` (`apps/api/src/views.ts`,
passed straight through since the two shapes are structurally identical),
and to `PublicationStage`'s `cannot_validate` variant
(`publication-view-model.ts`) as a `note: string | null`. `publicationSummary`
now prefers `stage.note` and falls back to the old generic sentence only for
a candidate that genuinely has nothing recorded (defensive, not expected in
practice now that `compileDocument` always sets it on refusal).

No new refusal *reason* was needed — `assessSandboxReadiness` already names
one (`secret_unresolvable`) with the specific message; this was purely a
plumbing gap between where that message was computed and where a person
reads it, the same class of gap `declareOutput`'s `SopReviewView.outputs`
closed a few items above.

**Verification.** New unit test in `publication-view-model.test.ts` (the
`cannot_validate` stage surfaces a recorded note verbatim, naming the
specific input), and a new db-integration test in
`candidate-service.db.test.ts` using the existing `SIGN_IN` recording
fixture, asserting `SopRevisionService.reviewDocument()`'s
`publication.sandboxNote` matches `candidate.sandboxNote` exactly — this is
the real cross-service wiring a person's UI actually depends on, not just
the view-model's handling of an already-correct input. Both mutation-
verified: reverting the view-model's `stage.note ??` fallback, and
separately reverting `publicationStatusFor`'s new field, each broke exactly
the test written for it.
