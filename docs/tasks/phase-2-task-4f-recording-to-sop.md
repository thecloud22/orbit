# Phase 2 — Task 4f Prompt: Record a workflow from any URL

Branch `phase-2-task-4f-recording-to-sop`, off master once 4d and 4e (styling, if built) land,
sequenced same as always. Supersedes the earlier, narrower "recorder session integration" draft —
build this version.

---

## Goal

From Watchtower, give a starting URL, perform a real task in a real (headed, local) browser, and
have that recording become a new SOP Graph document — steps and their bindings together, since both
come from the same real interaction. No terminal.

## Design decisions already made, don't re-litigate

**Output is a linear draft only.** No decisions/branches — a single recording walks one path and
can't produce a branch it never took. Decisions get added by hand afterward on the existing review
page (2.3), same as any first draft.

**Typed values are captured literally, as typed.** No live prompting during recording to mark them
as inputs — that happens afterward in review, same place values already get edited today.

**Secrets are not auto-detected.** Password-type fields are captured like any other field; marking
one as secret stays a manual step in review, same checkbox that exists today. Flag this plainly in
the report as an accepted risk, not a gap you introduced.

**The session's "finish" action is the approval.** Captured bindings write as approved directly when
recording finishes — not into a draft/needs-review holding state — because a human just
interactively performed and confirmed the whole sequence. This is new write capability, but it
belongs entirely to this new session flow, not to 4c's panel, which stays exactly as built:
read-only.

## Reused, must not be reimplemented

- `packages/execution-recorder` (capture engine, injected script)
- `packages/execution-assist` (selector ranking, coverage, drift-recovery)
- 4a's fingerprint/selector-chain derivation
- the existing bindings table and lifecycle
- `@orbit/sop-graph` / `@orbit/sop-service` persistence and validation
- the 2.3 review page — a recorded document should need zero changes there; it is stored the same
  way a free-text-generated one is

## New

**A session-based web API** (same start/poll shape as the existing run pattern) to start a recording
session against an arbitrary starting URL — not tied to any pre-existing document or step, unlike
the earlier draft.

**A capture-to-step translator:** turning the captured action sequence (navigations, fills, clicks)
into SOP Graph step definitions with a bound execution binding per step. This is new logic — read
the actual step schema and 2.2's existing free-text-to-graph path first, and report back the real
shape before building rather than assuming a mapping.

**A live but non-blocking session view in Watchtower:** a running list of what's been captured so
far, a "Finish recording" action that compiles the sequence, creates the new SOP document + initial
draft revision + approved bindings, and lands on its review page.

**An entry point on Home,** alongside the existing "Draft a workflow from a description" box —
"Record a workflow," asking for a starting URL.

## Hard constraint

Same as before: the headed browser needs a local display — must run on the same machine as whoever
is recording. State this in the UI.

## Process

Read the real code first — the step schema, 2.2's generation path, and whether 4b's flow state
machine can reasonably extend to "capture many actions, confirm once at the end" rather than
per-step. If this is too large for one task once you're in it, say so and propose a split rather
than forcing it. Plan first, wait for review before writing code.

## Tests

- Capture-to-step translation: a fixed sequence produces the expected step kinds and bindings.
- Session start/poll/finish flow.
- An end-to-end Watchtower test that recording against a real local test page produces a document
  that shows up in the 4d Documents list and opens correctly in review.
- Boundary scan confirming this new write path is reachable only through the recording session, not
  from browser-worker.
- Regression for everything through 4d.
