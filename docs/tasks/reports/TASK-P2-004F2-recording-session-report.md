# Task P2-004F2 — Recording a workflow from Watchtower

**Sub-phase:** 2.4f-2
**Branch:** `phase-2-task-4f2-recording-session` (off `cf48126`)
**Status:** Complete, awaiting review

## What this delivers

Sub-phase 2.4f-1 made a recording into a SOP Graph document, reachable only through
`pnpm record:workflow`. This puts the same capability in Watchtower, which is where the person the
feature exists for actually is — and where the resulting document is already reviewed, edited and
approved.

Home now has a **Record a workflow** form: a title, a starting URL, and a plainly-stated notice
about where the browser opens. Starting one navigates to a live session page that lists what has
been recorded so far as it happens. **Finish** compiles the sequence and lands on the review page
for the new document.

## The ADR-019 question, answered rather than waved past

ADR-019 explicitly rejected "record from Watchtower, with the API hosting a headed browser," and
explicitly forbade `apps/api` from importing the recorder. This task does the first and needs the
second relaxed, so **ADR-020** was written to reverse it on its merits:

- Its two objections were a session lifecycle over HTTP, and a third window. The first is real but
  smaller than expected and mirrors run dispatch (ADR-011). The second is simply wrong for this
  case — recording a whole workflow *starts* in Watchtower, so the browser is the second window.
- ADR-019's judgement still holds for its own case. **`pnpm record:binding` and
  `pnpm record:workflow` both remain**; neither path is the other's fallback.

**The ban is narrowed, not lifted.** `apps/api/src/recording/` may import `@orbit/execution-recorder`;
nothing else in the API may. What ADR-019 actually protected — that code executing an agent cannot
load script injection — is preserved and now *proved*:

- Lint restricts the import to that one directory ([eslint.config.js:432-445](../../../eslint.config.js#L432-L445)).
- [apps/api/src/recording-boundary.test.ts](../../../apps/api/src/recording-boundary.test.ts) walks
  the module graph from the run-dispatch entry point and asserts it reaches the recorder at no
  depth, confines the recorder to `src/recording/`, and — the part that matters — asserts the scan
  *can* fail by checking it objects to the one file that legitimately imports the recorder.
- `apps/browser-worker`'s own ban is untouched and unrelaxed.

## Session API

| Route | Behaviour |
|---|---|
| `POST /v1/recording-sessions` | 201 with a session id; refuses a non-sandbox target before a browser opens |
| `GET /v1/recording-sessions/:id` | What has been recorded so far; polling counts as activity |
| `POST /v1/recording-sessions/:id/finish` | 201 with the new document; 422 leaves the session open |
| `DELETE /v1/recording-sessions/:id` | 204; closes the browser and forgets it |

The shape is run dispatch's, for the same reason: a recording lasts as long as a person takes, which
is far longer than an HTTP request should live.

**A recording that cannot be compiled keeps its session open.** The browser still holds work a
person cannot repeat from memory, so the 422 says so explicitly and the UI repeats it — that is the
`sessionSurvived` field in `describeRecordingFailure`, and the reason it exists at all.

## Defects found and fixed during the work

1. **The idle timeout only fired when someone else started recording.** Reaping ran on `start`, so
   the person the timeout exists for — the one who walks away and never comes back — never triggered
   it, and their headed Chromium survived until the process exited. ADR-020 claims thirty idle
   minutes closes a session, so the code now matches the claim: an `unref`'d sweeper runs
   independently and `closeAll` clears it. Both properties are pinned by tests, and both were
   verified to fail when their fix is removed.
2. **The first sweeper test defeated itself.** It polled `registry.get()` waiting for the session to
   disappear — but polling counts as activity, so the probe reset the very timer under test and it
   never reaped. The test now observes the browser's own closed state instead, and says why in a
   comment.
3. **The E2E entry point opened a second database pool.** The first version passed a fully-built
   registry into `startApi`, which meant constructing a `createDatabase` handle beside the one
   bootstrap already owns, and never closing it. The seam is now the session *factory* — so what an
   end-to-end run substitutes is the browser and nothing else; the registry, lifecycle, translation,
   validation and persistence are all real.
4. **The containment guard could not see local test doubles.** `sop-provider-boundary.test.ts`
   checked published `/testing` subpaths only, so a production file importing
   `./testing/fake-recording-session` would have passed every assertion in it. The directory is now
   the boundary, with a case asserting the new check is not vacuous.
5. **The E2E document assertions named fields that do not exist** (`data.title`,
   `data.revision.steps`). Corrected against `SopReviewView`, and extended to assert
   `provenance.kind === 'recorded'` and `executable === false` — that the real translation ran and
   the result is still a non-executable SOP Graph (ADR-016).

## Tests

| Suite | Result |
|---|---|
| `pnpm typecheck` / `lint` / `format:check` | clean |
| `pnpm test` | 774 passed (74 files) |
| `pnpm db:generate` | "No schema changes, nothing to migrate" |
| `pnpm test:db` | 190 passed (16 files) — +2 sweeper cases |
| `pnpm test:runtime` | 21 passed |
| `pnpm test:e2e:watchtower` | 30 passed — +2 recording cases |
| `pnpm verify:phase1` | full regression green, teardown clean |

New coverage: 12 registry cases against a real database and a fake browser; 13 route cases; 12 view-model
cases; 5 module-graph boundary cases; 2 end-to-end cases (Home → live session → Finish → review page,
and a non-sandbox target refused).

**The end-to-end test fakes the browser and nothing else.** A test runner has no display and no
person to click, so the session factory is scripted behind `src/testing/` — the same containment the
fake model provider has. What comes out is a genuine document in the database.

## No schema change, no migration

This task adds no table and no column. A recording session is memory, not a row; only the document it
produces is persisted, through 4f-1's existing service.

## Limitations, stated rather than solved

- **Secrets are not auto-detected — only password fields are.** A sensitive value typed into a
  non-password field is captured verbatim into the recorded step, and a reviewer has to catch it.
  Carried forward from 4f-1 as an accepted risk, and now recorded in ADR-020.
- **Recording requires a display on the machine running the API.** Orbit cannot record from a
  laptop pointed at a remote API. The form says so before a recording starts rather than leaving
  someone waiting for a window that never appears.
- **A session is process-local state.** A restart loses any session open at the time, and more than
  one API instance would not share them. Acceptable while the API is a single modular monolith
  (ADR-001); the first thing that breaks if that stops being true.
- **Local sandbox only**, unchanged: recording performs real clicks, so the target is checked
  against the runtime's own allowlist before a browser opens.
- **Two recording entry points now exist** with different jobs — a whole workflow from Watchtower, a
  single step's binding from the CLI. Someone could reasonably expect either to do the other's job.
- **No styling pass.** The new components follow the existing components' conventions; the
  repository-wide styling consistency pass deferred out of Task 4d is still deferred.

## Files

**Created** — `apps/api/src/recording/session-registry.ts` and its DB test;
`apps/api/src/routes/recording.ts` and its test; `apps/api/src/recording-boundary.test.ts`;
`apps/api/src/testing/fake-recording-session.ts`; `apps/web/src/recording-view-model.ts` and its
test; `apps/web/src/RecordWorkflowForm.tsx`; `apps/web/src/RecordingSessionPage.tsx`; this report.

**Modified** — `apps/api/src/{bootstrap,context,server,views}.ts`,
`apps/api/src/testing/{e2e-server,stub-context}.ts`, `apps/api/src/sop-provider-boundary.test.ts`,
`apps/api/src/api.db.test.ts`, `apps/api/package.json`; `apps/web/src/{App.tsx,api-client.ts,navigation.ts}`
and the navigation and Watchtower E2E tests; `eslint.config.js`; `docs/architecture/decisions.md`
(ADR-020); `README.md`; `docs/tasks/ACTIVE_TASK.md`.

**Untouched** — `@orbit/execution-mapping`; `packages/runtime/src/{interpreter,drift,ports}.ts`;
`describeElement`; `@orbit/sop-graph`; `@orbit/sop-recording`; `@orbit/sop-service`; `apps/recorder`;
`apps/browser-worker`; every Phase 1 table and migration.
