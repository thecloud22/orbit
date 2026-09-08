# Orbit Phase 1 System Design

**Status:** Historical record. Accurate for Phase 1 as designed and built; **not
a description of the current system.**

**Current architecture: [`system-design.md`](./system-design.md).**

Phase 1's core still runs exactly as described here — the request flow, the
persistence model and the failure model are all still true of a Phase 1 agent.
What has changed is everything Phase 2 added around it. Five statements below are
now wrong, and are flagged inline where they appear:

| Below | Superseded by |
|---|---|
| "Browser navigation checks localhost allowlist" | Per-agent `allowedDomains` (**ADR-022**) |
| Business outcome is `none` / `request_found` / `request_not_found` | A workflow declares its own outcome names (**ADR-030**) |
| The browser worker executes runs | The API executes runs; the worker is a CLI composition root (**ADR-011**) |
| "No LLM" | Bounded drafting, judged decisions (**ADR-032**), and advisory suggestions |
| "No Studio" | Studio is the authoring surface, in the same application (**ADR-031**) |

This document is kept because the Phase 1 material in it is correct and because
deleting the record of what was built first would lose the reasoning that the
rest was built on.

## Purpose

Describe the smallest production-shaped architecture required to support the Phase 1 deterministic proof loop.

## System context

```text
User
  -> Orbit Watchtower Web
  -> Orbit API
  -> Orbit Runtime / Browser Worker
  -> Controlled Demo Portal

Orbit API and Worker
  -> PostgreSQL
  -> Local Artifact Storage
```

## Components

| Component | Responsibility |
|---|---|
| Watchtower Web | Lists seeded agent, renders dynamic input form, starts run, displays run/evidence |
| API | Validates requests, persists run intent, dispatches work, queries run/evidence data |
| Agent Registry | Loads seeded immutable Agent Version from PostgreSQL |
| Runtime | Interprets Agent IR and manages run/step state transitions |
| Browser Worker | Executes Playwright actions in a separate process. **Superseded:** the API executes runs (ADR-011); the worker is a CLI composition root |
| Demo Portal | Controlled target UI with stable test IDs |
| PostgreSQL | Agent Versions, runs, steps, events, artifact metadata/links |
| Artifact Storage | Local filesystem bytes for screenshots, DOM snapshots, and trace ZIPs |

## Request flow

```text
1. User opens Watchtower.
2. Watchtower requests GET /v1/agent-versions.
3. User selects Find Service Request.
4. Watchtower renders requestNumber input from returned schema.
5. User submits POST /v1/agent-versions/:id/runs.
6. API validates input and creates run with status queued.
7. API dispatches run to browser worker through in-process dispatch interface.
8. Worker loads exact Agent Version and transitions run to running.
9. Worker interprets Agent IR and uses Playwright against demo portal.
10. Worker writes events, step state, outputs, and artifact metadata continuously.
11. Worker finalizes trace and run terminal status/outcome.
12. Watchtower polls GET /v1/runs/:runId and renders persisted data.
```

**Superseded in steps 7–11:** "Worker" here means the runtime, which runs inside
the API process. `RunDispatcher` is in-process and abstracted, off the HTTP
request lifecycle, but nothing hands work to a separate process (ADR-011). The
`browser-worker` app is the composition root for `pnpm agent:run`, not a queue
consumer. Every other step is still exactly what happens.

## Data flow

```text
Agent IR YAML fixture
  -> parsed/validated through Zod
  -> stored as Agent Version JSON in PostgreSQL
  -> loaded by Runtime for specific run
  -> browser actions generate events and artifacts
  -> events/artifact metadata persisted to PostgreSQL
  -> artifact bytes written to local filesystem
  -> Watchtower queries API read model
```

## Phase 1 process isolation

- API and browser worker are separate Node.js processes.
- Browser worker creates an isolated Playwright browser context for each run.
- Browser navigation checks localhost allowlist. **Superseded by ADR-022:** navigation is constrained per agent, by the `allowedDomains` its version declares.
- Demo portal requires no credentials.
- Artifact storage root is outside public web assets and gitignored.

## Persistence model

```text
Agent
  -> Agent Version
    -> Run
      -> Run Step
        -> Run Event
        -> Artifact Link
          -> Artifact Metadata
            -> Local Artifact Bytes
```

## State model

### Run status

```text
queued -> running -> succeeded
                  -> failed
                  -> cancelled
```

### Business outcome

```text
none
request_found
request_not_found
```

A run may be `succeeded/request_not_found`.

**Superseded by ADR-030:** a workflow declares its own outcome names, matching
`^[a-z][a-z0-9_]{0,63}$`, with `none` reserved for a run that reached no business
conclusion. The two names above are what the seeded Phase 1 agent happens to
declare, not a closed vocabulary.

## Phase 1 failure model

| Failure | Expected handling |
|---|---|
| Invalid request input | API returns validation error; no run dispatch |
| Agent Version missing | API returns 404; no run dispatch |
| Navigation failure | Run fails; event/error/artifacts persisted where possible |
| Locator failure | Run fails with typed error; screenshot/DOM/trace retained |
| Assertion failure | Run fails with typed error and evidence |
| Artifact write failure | Run fails or is marked degraded according to design; must not be silently ignored |
| Worker crash | Run records a typed worker failure; recovery is deferred |

## Intentional simplifications

- No durable queue: dispatch is in-process but abstracted.
- No auth: fixed development actor only.
- No multi-tenancy: no customer data or credentials.
- No real target system: controlled local portal only.
- No LLM: fixture Agent IR is manually seeded. **No longer true:** drafting from
  free text, judged decisions at run time (ADR-032) and advisory recording
  suggestions all exist, each bounded.
- No Studio: Watchtower is the initial trigger/inspection UI. **No longer true:**
  Studio is the authoring surface, in the same application (ADR-031).

## Extension points to preserve

| Future capability | Required Phase 1 seam |
|---|---|
| Queue | `RunDispatcher` interface independent of HTTP lifecycle |
| S3/MinIO | `ArtifactStorage` interface |
| Real identity | Trigger actor contract and authorization middleware boundary |
| Multi-tenancy | Tenant field strategy/ownership interfaces, even if not populated yet |
| SOP Graph | Agent IR source provenance fields |
| LLM | No direct dependency in runtime; future gateway module boundary |
| Policies | Browser permission/domain allowlist enforcement interface |
| API actions | Executor interface distinct from Playwright implementation |
| Live updates | Event query endpoint with ordered sequence values |
