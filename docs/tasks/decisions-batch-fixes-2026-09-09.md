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

