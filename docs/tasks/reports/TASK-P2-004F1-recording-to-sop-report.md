# Phase 2 Task 4f-1 Report — A recording becomes a SOP Graph document

**Status:** Complete, pending commit approval

**Branch:** `phase-2-task-4f-recording-to-sop`, off master at `6026582`.

**Scope:** 4f-1 of the approved split — navigation capture, the capture-to-step translator,
provided-graph persistence, approved bindings, and the `recorded` provenance kind. The Watchtower
session (4f-2) is a separate branch.

## Goal

Perform a task once in a real browser and have it become a workflow — steps and their bindings
together, because both describe the same interaction.

## Five discrepancies, all raised before implementing

1. **The recorder did not capture navigation.** `RawCapture` was `click | fill | pick`; page changes
   emitted nothing. Added, so a recording is a sequence rather than a list of clicks with no record
   of where each happened.
2. **`@orbit/execution-recorder` is banned from `apps/api`** — that relaxation belongs to 4f-2 and is
   untouched here.
3. **Every step requires a non-empty `purpose`**, and a recording carries no prose. Synthesised from
   what the element is called, saying plainly what was done rather than inventing intent.
4. **A linear recording is not a valid graph.** An `outcome` step is appended, because a recording
   ends when the person stops.
5. **There was no provenance kind for a recording.** Added `recorded` — a union widening on a JSONB
   column, so no migration — with `recordedFromUrl` and `recordedActionCount`.

## The password decision turned out better than planned

The plan was to redact password values at capture and leave an empty step value for review. The
first half holds: a value typed into `input[type=password]` never leaves the page — the recorder
reports the field without it, so there is nothing downstream to leak.

The second half was wrong, and the graph validator said so. A `fill` marked `sensitive` **may not
hold a literal** — sub-phase 2.1's rule — so an empty placeholder was rejected outright. The only
valid translation is the one 2.1 already requires: declare a `secret` input and point the step at it
with `${inputs.password}`.

So a recorded sign-in now arrives with its secret **properly declared**, rather than deferring that
to review. Two password fields with the same label share one input; different labels get their own.
This is a better outcome than the approved plan, produced by the validator refusing the weaker one.

## Bindings land approved, without bypassing anything

They are driven through the real lifecycle — created as drafts, submitted, approved — because the
repository refuses `draft → approved`, and writing a state the application cannot otherwise produce
would make the state machine advisory. A binding reaching `approved` is therefore proof the
intermediate transition happened. The approval is real: a person performed and confirmed the whole
sequence with their hands rather than with a button.

## What was built

**`packages/sop-recording`** — pure translation. Takes a captured sequence, returns a linear
`SopGraph` plus one `ExecutionBinding` per action step, and runs the result through
`parseSopGraphDocument` rather than trusting that a linear sequence must be valid. No browser, no
database, no model, so a fixed recording is checked against an exact expected graph with nothing
running.

**Navigation capture and password redaction** in the injected script — the one file that runs inside
a page, given the same care 4b gave it.

**`createSopRecordingService`** in `@orbit/sop-service` — document, revision and every binding in one
transaction. A document whose steps existed without their bindings would look mapped and not be.

**`pnpm record:workflow`** — so 4f-1 is usable on landing rather than only tested.

## Commands and exact results

| Command | Result |
|---|---|
| `pnpm typecheck` | Pass, all 21 workspaces |
| `pnpm lint` | Pass |
| `pnpm format:check` | Pass |
| `pnpm test` | **740 passed**, 71 files |
| `pnpm db:generate` | `No schema changes, nothing to migrate` |
| `pnpm test:db` | **178 passed**, 15 files |
| `pnpm test:runtime` | **21 passed**, 4 files |
| `pnpm verify:phase1` | Everything passed; `check:teardown` flagged a running `pnpm dev` |

Counts before this task: 720 unit, 170 db, 19 runtime.

| Added | Tests |
|---|---|
| `packages/sop-recording` — translation, ids, purposes, secrets, boundary | 17 |
| `packages/sop-service` — persistence, provenance, approved bindings (db) | 8 |
| `apps/browser-worker` — the write path is unreachable from the run executor | 3 (of 4 in that file) |
| `apps/recorder` — a real recording against the real portal becomes a document | 2 |

### The teardown check

`verify:phase1` reached `check:teardown`, which means every step before it passed. It flagged ports
3000 and 3001, held by a `pnpm dev` session started at 13:51 — not a leak. The end-to-end ports this
suite uses were free.

## Defects found and fixed

1. **My empty-recording guard was dead code.** It checked the step list *after* appending the
   outcome, so an empty recording produced a valid one-step workflow that meant nothing. Now checked
   before anything is appended.
2. **The scan-matches-prose defect, in a fourth place.** `packages/sop-service`'s boundary scan is
   from Task 3 and still matched raw substrings, so a comment of mine containing "does not leave the
   page." tripped it. Upgraded to parsed imports and call shapes, matching the scans in
   `execution-mapping`, `execution-recorder` and `apps/api`. Fixing the scan rather than rewording
   the comment: a check that punishes documenting a boundary discourages documenting it.
3. **`Extract<RecordedEntry, { kind: 'fill' }>` silently yielded `never`**, because that union member
   is `kind: 'click' | 'fill'` rather than two members. Narrowed the parameter to what it needs.

## Changed files

**Created** — `packages/sop-recording/` (translator, barrel, two test files);
`packages/sop-service/src/recording-service.ts` + db test;
`apps/recorder/src/cli/record-workflow.ts`; `apps/recorder/src/record-workflow.runtime.test.ts`;
`apps/browser-worker/src/recording-boundary.test.ts`; the brief; this report.

**Modified** — `packages/execution-recorder/src/{injected,session}.ts` (navigation, password
redaction, ordered sequence), `packages/db/src/schema/sop-graph-revisions.ts` (the `recorded` kind),
`packages/sop-service/src/{index.ts,network-boundary.test.ts}`, `apps/recorder/src/confirm.test.ts`,
`eslint.config.js`, `package.json`, `README.md`, `docs/tasks/ACTIVE_TASK.md`.

**Untouched** — `@orbit/execution-mapping`, `@orbit/execution-assist`, the runtime's interpreter,
drift check and ports, `describeElement`, the 2.3 review page and 4c's bindings panel, every table
and migration. **No schema change and no new dependency.**

## Known limitations

- **A recorded workflow is linear.** No decisions, no branches — a single recording cannot produce a
  path nobody walked. Decisions are added by hand in review.
- **The appended outcome is a guess about shape, not meaning.** It says the task finished; what
  finishing *meant* is for a reviewer to write.
- **Typed values become literals.** A recorded request number is stored as typed, and turning it into
  an input is a manual step in review — as agreed, and unchanged by the secret handling, which is
  separate.
- **Only `input[type=password]` is treated as sensitive.** A credential typed into a plain text
  field is captured literally. This is the accepted risk the brief named, and it is narrower than it
  was — but it is real: an API key pasted into a search box would be stored.
- **`pick` captures are dropped** by the workflow CLI. Extract and decision steps are not produced by
  recording; they are added in review.
- **No session, still a terminal.** 4f-2 moves this into Watchtower and is where the ADR-019
  relaxation gets decided.
