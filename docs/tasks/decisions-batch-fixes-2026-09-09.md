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
