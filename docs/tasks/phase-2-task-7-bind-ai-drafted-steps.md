# Phase 2 — Task 7: Bind AI-drafted steps from Watchtower

## Stack state at the time of writing

`master` at `e96c8b8` (one-click publish for recorded workflows, Runs/Agents split, color pass;
agent archiving; Tailwind 4.3 styling). Working tree clean. Branch off master:
`phase-2-task-7-bind-ai-drafted-steps`.

## Goal, as given

Close the structural gap: a guided/AI-drafted SOP Graph has no execution bindings, so it's refused at
compile time (`missing_binding`). Give Watchtower a way to create a binding for any step that lacks
one, regardless of how the document was authored, so a guided/AI-drafted workflow can reach
compile → approve → publish → run the same as a recorded one.

## Read first, before proposing anything

- `apps/recorder`'s `record:binding` CLI entry point and what `packages/execution-mapping` does with
  its output.
- The existing (currently read-only) `sop-bindings.ts` route and `SopBindingPanel`.
- The 4f-2 recording-session infrastructure (`session-registry.ts`, `routes/recording.ts`) to see
  how much of that session-lifecycle machinery is reusable for capturing a single action instead of
  building a parallel mechanism from scratch.

## Likely shape — to confirm or correct via the reading pass, not to assume

A "Bind this step" action on the review page for any step lacking an approved binding, opening a
real browser, waiting for one action, and producing an Execution Binding through the same
create → submitForReview → approve lifecycle 4c already established. This task fills in how a
binding gets created, not how it gets approved.

## Scope boundaries

- Do not touch the compiler (2.5), publish/execute (2.6), or the runtime.
- Follow ADR-022 exactly as it stands for the browser side — any http/https target, contained
  per-agent, protocol restrictions unchanged. This is the same kind of real-browser capture as
  before, not a reason to revisit that decision.

## Process

Return a plan first. Wait for go-ahead before writing code.
