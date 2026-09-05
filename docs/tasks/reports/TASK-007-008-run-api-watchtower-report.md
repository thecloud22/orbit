# Task 7–8 Report — Run API and Watchtower

**Status:** Complete, pending commit approval

**Branch:** `task-7-8-run-api-watchtower`

**Scope:** Phase 1, Tasks 7 and 8 as one vertical slice. No schema or migration change, no new
external package, no change to `@orbit/contracts`, `@orbit/agent-ir`, the Task 6 runtime, artifact
storage behaviour, or the demo portal.

## Goal

A person opens Watchtower, enters `SR-1001`, starts a run, watches it reach a terminal state, and
inspects the outcome, output, steps, ordered events, and evidence — with screenshots, HTML
snapshots, and the Playwright trace reachable through controlled API routes.

## What was built

```text
apps/web (Watchtower :3000)
  └─ /v1 proxied by Vite ──> apps/api (:3002)
                               ├─ routes: agent-versions, runs, artifacts
                               ├─ RunDispatcher (in-process, ADR-011)
                               │     └─ @orbit/runtime  ← reused exactly as Task 6 built it
                               ├─ @orbit/db repositories
                               └─ @orbit/artifact-service (bytes + integrity)
```

Note on naming: the task brief refers to `apps/watchtower`; the Watchtower application in this
repository is `apps/web`, as `README.md` and the Task 1 scaffold already describe.

## API routes and behaviour

| Route | Behaviour |
|---|---|
| `GET /v1/agent-versions` | Published versions with their input schemas. No IR, no checksum, no internal columns. |
| `POST /v1/agent-versions/:agentVersionId/runs` | `202` with the run id. Validates, then dispatches. |
| `GET /v1/runs/:runId` | Run detail from persisted state: status, outcome, inputs, outputs, error, steps, events, artifacts. |
| `GET /v1/runs/:runId/events` | Ordered events; `?afterSequence=` returns only newer ones. |
| `GET /v1/runs/:runId/summary` | Status poll without the timelines. |
| `GET /v1/runs/:runId/artifacts/:artifactId` | Controlled evidence bytes. |

**Validation before dispatch** is `prepareExecution` from `@orbit/runtime` — the same gate the
browser-worker CLI uses, so the API and the CLI cannot disagree about what a valid request is. A
malformed id, an unknown version, a version that is not published, a version outside the runtime
profile, a missing or blank or undeclared input, and an unsupported trigger are all rejected
**before any run row exists**.

`202` rather than `201`: the run row and its `run.queued` event are durable when the response is
sent, and execution continues afterwards (ADR-011). Watchtower never treats that response as
evidence the run succeeded — it polls the run.

### Error envelope

Every non-success response is `{ error: { code, message, requestId, details? } }` with a code from
the Phase 1 taxonomy. An unclassified failure is logged server-side and returned as a generic 500;
a database message, a stack trace, a path, or a storage key never reaches a response body.

**A real gap, recorded rather than papered over:** `@orbit/contracts` has no `NOT_FOUND` code, so
404s carry `VALIDATION_ERROR` with a message naming what was not found. Widening the taxonomy is a
contract change and was excluded from this task.

### Non-leakage

`views.ts` builds every response field by field and imports neither Fastify nor `@orbit/db`, so a
new column cannot be published by accident and the UI's type graph never reaches the database
layer. `storageKey` is stripped from event payloads on the way out — the runtime records it because
the event log is internal evidence, but publishing it would hand a caller the artifact store's
internal addressing. Tests assert that run detail contains no `storageKey`, no artifact root, and
no step-scoped path fragment.

## Evidence access model

- `data/artifacts` is **never** statically served.
- An artifact is addressed by two opaque ids. The route proves it is evidence *of that run* —
  owned by it, or linked to the run, one of its steps, or one of its events (the three link targets
  the evidence contract defines).
- A nonexistent artifact and one belonging to another run return the **identical** 404, so the
  route cannot be used to discover which ids are real.
- Bytes are read through `@orbit/artifact-service` using the **persisted** storage key. No caller
  supplies a key, a filename, or a path.
- The digest is recomputed and verified before anything is sent; a mismatch is `500` /
  `ARTIFACT_STORAGE_ERROR` with no bytes. The byte length is checked against the recorded size too.
- Responses carry the stored content type, `X-Orbit-Sha256`, `X-Content-Type-Options: nosniff`, and
  `Cache-Control: private, no-store`.
- **Only `image/png` is served inline.** A DOM snapshot is a captured copy of a third-party page;
  serving it inline would execute that page on the API's origin, so every non-image artifact is an
  `attachment` with `Content-Security-Policy: default-src 'none'; sandbox`. Watchtower applies the
  same rule independently: it previews screenshots and offers HTML snapshots and traces as
  downloads.

## Local process model

`RunDispatcher` is the ADR-011 seam. The in-process implementation wraps the runtime's own
`RunStore` port and observes the moment the run row is created, so the route can return a run id
without awaiting execution — **the Task 6 runtime is used exactly as it was built, with no change
to its semantics and no second run row**. Replacing this with a queue later means implementing one
interface, not reshaping a route.

Known limitations, deliberately:

- Runs execute inside the API process. No queue, worker fleet, scheduler, retry engine, or
  cancellation.
- **No server-side duplicate suppression.** Watchtower disables its button while a request is in
  flight; that is a UI guard. Two tabs will start two runs, and a database test asserts exactly
  that behaviour rather than pretending otherwise.
- No authentication. Any caller who can reach the API can read any run and its evidence.
- A run left non-terminal by a crashed process stays non-terminal; there is no recovery sweep.

## Watchtower

- A start form generated from the Agent Version's own declared input schema, disabled while a
  request is in flight.
- A status panel driven by `describeRunStatus`, which keeps technical status and business outcome
  distinct (ADR-006): `request_not_found` renders as an *attention* state with an explicit note
  that it is a business outcome, never as a failure.
- Ordered step and event timelines, rendered in persisted `sequence` order.
- Output and typed-error panels.
- An evidence list: screenshot preview fetched through the API client so the typed error code
  survives, plus HTML-snapshot and trace downloads.
- Polling every second, stopping at the terminal state the **server** reports, with a manual
  Refresh and a hard stop after 300 polls.
- A run can be reopened by id (`?runId=run_...`). That is the whole of run navigation: no run list,
  no history, no filtering.

Every state decision lives in `run-view-model.ts` as pure functions, so components decide nothing
on their own and the rules are testable without a DOM.

## Tests

| Suite | Result |
|---|---|
| `pnpm test` | **420 passed**, 39 files (no database, no browser) |
| `pnpm test:db` | **93 passed**, 9 files against `orbit_test` |
| `pnpm test:runtime` | **6 passed** — Task 6, unchanged |
| `pnpm test:e2e:watchtower` | **6 passed** — the whole stack |
| `pnpm test:e2e` | **9 passed** — Task 2 demo portal, unchanged |

New coverage:

- `apps/api/src/server.test.ts` (17) — validation, error envelopes, 404s, unpublished versions on
  both the record and the IR, and non-leakage of paths and storage keys. No database.
- `apps/api/src/api.db.test.ts` (14) — run start and detail over real persistence, ordered steps
  and events, artifact URLs and roles, content types and disposition headers, cross-run artifact
  refusal, identical 404s, **checksum failure** (bytes tampered on disk → `500` /
  `ARTIFACT_STORAGE_ERROR`), events paging, summary, the not-found outcome, and the documented
  duplicate-dispatch limitation.
- `apps/web/src/run-view-model.test.ts` (35) — every status, tone, output, error, evidence and
  failure-classification rule, including that `request_not_found` is never a failure tone.
- `apps/web/src/watchtower.e2e.test.ts` (6) — real Chromium driving Watchtower: start `SR-1001` to
  a succeeded run with its outputs; ordered step and event timelines; screenshot preview rendered
  plus HTML and trace downloads served with the right headers; `SR-9999` shown as a business
  outcome; an empty request number rejected with a field-level message and no run started; and a
  controlled `LOCATOR_NOT_FOUND` failure shown with its typed error and its evidence.

### Isolation

The end-to-end stack runs its API on port `3102` and Watchtower on `3010`, pointed at `orbit_test`
and a **disposable artifact root** under the OS temp directory — never `DATABASE_URL`, never
`data/artifacts`. `process.loadEnvFile` does not override already-set variables, so the explicit
environment handed to the child wins over the repository `.env`; this was verified rather than
assumed.

`pnpm test:e2e:watchtower` is a **separate Vitest project from `pnpm test:runtime` for a concrete
reason**: the end-to-end API is a long-lived process serving `orbit_test`, and the Task 6 runtime
tests truncate that database between their own tests. Running both in one project pulled the seeded
Agent Version out from under a live server — which is exactly how the problem was found. They must
not be run concurrently.

## Defects found and fixed during the task

1. **The run-start route trusted only the Agent IR's lifecycle**, never the `agent_versions`
   record's own `lifecycle_status` column — the field `GET /v1/agent-versions` actually publishes.
   A test written against the record surfaced it. Both are now enforced, with tests for each.
2. **The end-to-end suite shared a database with a suite that truncates it**, described above. Fixed
   by splitting the project, not by weakening either suite.
3. **The end-to-end teardown did not wait for its child processes to exit**, so a following
   `pnpm test:db` could begin truncating while a dispatched run was still writing. Teardown now
   signals the process group, waits, and escalates to `SIGKILL` after 15 seconds; `test:db`
   immediately after `test:e2e:watchtower` is clean.

## Changed files

**Created** — `apps/api/src/{errors,views,projections,context,dispatch,artifact-access,env}.ts`,
`apps/api/src/routes/{agent-versions,runs,artifacts}.ts`,
`apps/api/src/testing/{stub-context,fixtures,stack-ports,stack-global-setup}.ts`,
`apps/api/src/api.db.test.ts`, `apps/web/src/{api-client,run-view-model,useRun}.ts`,
`apps/web/src/{StartRunForm,RunStatusPanel,RunTimeline,EvidenceList}.tsx`,
`apps/web/src/run-view-model.test.ts`, `apps/web/src/watchtower.e2e.test.ts`,
`vitest.e2e.config.ts`, and this report.

**Modified** — `apps/api/{package.json,src/server.ts,src/index.ts,src/server.test.ts}`,
`apps/web/{package.json,vite.config.ts,src/App.tsx,src/app-info.ts}`, root `package.json`,
`vitest.config.ts`, `vitest.db.config.ts`, `pnpm-lock.yaml`, `README.md`,
`docs/contracts/api.md`, `docs/tasks/ACTIVE_TASK.md`.

**Untouched** — every schema file and migration, `@orbit/contracts`, `@orbit/agent-ir`,
`@orbit/artifacts`, `@orbit/artifact-service`, `@orbit/runtime`, `@orbit/executor-playwright`,
`apps/demo-portal`, and `fixtures/`.

## Dependencies

**No new external package entered the lockfile.** Three manifest additions name packages already
resolved in the workspace at the same version, and `pnpm install` downloaded nothing:

| Package | Added to | Why |
|---|---|---|
| `zod@^4.5.4` | `@orbit/api` | CLAUDE.md requires Zod validation at the API boundary |
| `playwright@1.62.1` | `@orbit/web` (dev) | the Watchtower end-to-end test |
| `@types/node@^26.0.0` | `@orbit/web` (dev) | Node types those Playwright typings need |

Plus workspace links: `@orbit/{agent-ir,artifacts,artifact-service,runtime,executor-playwright}` to
`@orbit/api`, and `@orbit/api` to `@orbit/web` — the last for **types only**, through the
`@orbit/api/views` subpath, which imports no Fastify and no `@orbit/db`.

## Open questions for Task 9

1. **`NOT_FOUND` in the error taxonomy.** 404s currently carry `VALIDATION_ERROR`. A contract change
   would make the envelope honest.
2. **Duplicate dispatch.** Should the API refuse a second run for an agent version while one is
   still active, or is the UI guard enough for Phase 1?
3. **Run recovery.** A run left `running` by a killed API process stays that way. Task 9's hardening
   pass should decide whether a sweep marks such runs failed.
4. **Artifact caching.** Artifacts are immutable and content-addressed but are served `no-store`,
   which is the conservative choice while there is no authorization.
