# Orbit API Contract — Phase 1

**Status:** Active, and **narrower than the API**. This document specifies the six
Phase 1 evidence endpoints and the conventions every route follows. It is not a
catalogue of the surface.

**Purpose:** Define the minimal HTTP API required for Watchtower to list agents, create manual runs, and retrieve run evidence.

> **Scope.** The API serves **44 `/v1` routes plus `/health`**. Six are specified
> here. The rest — SOP drafting and revision editing, candidate compilation and
> approval, publishing, recording, binding and walkthrough sessions, recovery
> proposals, agent archiving, model usage and platform facts — arrived in Phase 2
> and are not documented here yet. The conventions and error envelope below apply
> to all of them. **Treat `apps/api/src/routes/` as authoritative** for anything
> this file does not specify, and do not read a route's absence here as evidence
> that it does not exist.

## API conventions

- Base path: `/v1`
- JSON request and response bodies
- Opaque string IDs
- UTC timestamps in ISO 8601 format
- Zod validation at request boundary
- Errors returned using a consistent structured error envelope
- No authentication provider in Phase 1; use development identity metadata only
- No secrets in API payloads

## Development identity

Phase 1 may use a fixed development actor:

```json
{
  "type": "development_user",
  "id": "dev-user"
}
```

The API contract must preserve an explicit actor field so real authentication can replace the stub later.

## List agent versions

```text
GET /v1/agent-versions
```

### Response

```json
{
  "data": [
    {
      "id": "agentv_find_service_request_001",
      "agentId": "agent_find_service_request",
      "name": "Find Service Request",
      "version": "0.1.0",
      "description": "Locate a service request and verify its current status and assigned team.",
      "lifecycleStatus": "published",
      "inputSchema": {
        "requestNumber": {
          "type": "string",
          "required": true,
          "label": "Service request number",
          "validation": {
            "minLength": 1,
            "maxLength": 100
          }
        }
      }
    }
  ]
}
```

## Create run

```text
POST /v1/agent-versions/:agentVersionId/runs
```

### Request

```json
{
  "trigger": {
    "type": "watchtower_manual",
    "actor": {
      "type": "development_user",
      "id": "dev-user"
    },
    "source": {
      "application": "orbit-watchtower"
    }
  },
  "inputs": {
    "requestNumber": "SR-1001"
  }
}
```

### Response

`202 Accepted`. The run row and its `run.queued` event are durable before this
response is sent; browser execution continues afterwards and is never coupled to
the HTTP request lifecycle (ADR-011). Watchtower polls for the real state.

```json
{
  "data": {
    "runId": "run_01J...",
    "status": "queued",
    "businessOutcome": "none",
    "agentVersionId": "agentv_find_service_request_001",
    "createdAt": "2026-09-05T16:00:00.000Z"
  }
}
```

`trigger` is optional; when omitted the API records the fixed development actor.

### Validation behavior

- Unknown agent version: `404`.
- Invalid input payload: `400` with field-level validation errors.
- Unsupported trigger: `400`.
- Agent Version that is not published, or that declares a construct the runtime
  does not support: `400`. No run row is created.
- Run creation/internal persistence failure: `500` with safe error ID.

Input validation is `prepareExecution` from `@orbit/runtime` — the same gate the
browser-worker CLI applies, so the API and the CLI cannot disagree about what a
valid request is.

## Get run

```text
GET /v1/runs/:runId
```

### Response

```json
{
  "data": {
    "id": "run_01J...",
    "status": "succeeded",
    "businessOutcome": "request_found",
    "agentVersion": {
      "id": "agentv_find_service_request_001",
      "name": "Find Service Request",
      "version": "0.1.0"
    },
    "trigger": {
      "type": "watchtower_manual",
      "actor": {
        "type": "development_user",
        "id": "dev-user"
      }
    },
    "inputs": {
      "requestNumber": "SR-1001"
    },
    "outputs": {
      "requestNumber": "SR-1001",
      "requestStatus": "In Progress",
      "assignedTeam": "Infrastructure Operations"
    },
    "startedAt": "2026-09-05T16:00:00.000Z",
    "finishedAt": "2026-09-05T16:00:03.000Z",
    "steps": [],
    "events": [],
    "artifacts": [],
    "error": null
  }
}
```

## Run events

```text
GET /v1/runs/:runId/events
GET /v1/runs/:runId/events?afterSequence=12
```

Returns ordered persisted events. `afterSequence` returns only events newer than a
sequence the caller already has. Server-Sent Events are out of Phase 1 scope;
Watchtower polls.

## Run summary

```text
GET /v1/runs/:runId/summary
```

The status poll without the timeline payloads: status, business outcome, and
timestamps only.

## Artifact retrieval

```text
GET /v1/runs/:runId/artifacts/:artifactId
```

**Run-scoped by design.** An artifact is addressed by two opaque ids, and the
route serves it only after proving it is evidence *of that run* — owned by it, or
linked to the run, one of its steps, or one of its events. An artifact that does
not exist and one that belongs to another run return the identical `404`, so the
route cannot be used to discover which artifact ids are real.

- Bytes are read through `@orbit/artifact-service` using the **persisted** storage
  key. A caller never supplies a key, a filename, or a path.
- The sha-256 is recomputed and verified before anything is sent. A mismatch is
  `500` with code `ARTIFACT_STORAGE_ERROR` and no bytes.
- The response carries the stored content type, `X-Orbit-Sha256`, and
  `X-Content-Type-Options: nosniff`.
- Only `image/png` is served `inline`. Every other artifact — a DOM snapshot in
  particular — is `attachment` with `Content-Security-Policy: default-src 'none';
  sandbox`, so a captured third-party page can never execute on the API's origin.
- `data/artifacts` is never statically served.

The route returns bytes directly in Phase 1. Returning a signed object-storage URL
later changes this handler only; the addressing scheme already carries no
location.

## Error envelope

```json
{
  "error": {
    "code": "INPUT_ERROR",
    "message": "requestNumber is required.",
    "requestId": "req_01J...",
    "details": [
      {
        "field": "inputs.requestNumber",
        "message": "Required"
      }
    ]
  }
}
```

## Known gap: no `NOT_FOUND` error code

The Phase 1 error taxonomy in `@orbit/contracts` has no `NOT_FOUND` code, so a
`404` is returned with code `VALIDATION_ERROR` and a message naming what was not
found. The HTTP status is the authoritative signal. Widening the taxonomy is a
contract change and has not been made.

## Non-goals

These were the Phase 1 non-goals. Phase 2 delivered several of them, so the list
is split rather than left to read as if it still described the whole API.

**Still absent from the API entirely:**

- Authentication/SSO endpoints
- User/role management
- Webhook registration, schedule management, or any non-manual trigger
- A policy engine, or policy/approval configuration endpoints
- Multi-tenant administration
- Any endpoint that takes a prompt, or returns raw model output

**Delivered in Phase 2, and served today** — specified in
`apps/api/src/routes/`, not in this document:

- SOP authoring: `POST /v1/sop-drafts`, and the revision step, reorder, answer
  and transition routes
- Revising a finished workflow: `POST /v1/sop-documents/:documentId/revisions`
  forks the current revision into a new editable one and supersedes it. It does
  not reopen an approved revision, and it changes nothing about any published
  Agent Version (ADR-036)
- Publishing: `POST /v1/agent-ir-candidates/:candidateId/publish`,
  `POST /v1/sop-documents/:documentId/publish-bound`,
  `POST /v1/sop-documents/:documentId/publish-recording`
- Review lifecycle: candidate approval and revision transitions. This is a
  review workflow, not the policy engine ADR-013 still describes as unbuilt
- Model reporting: `GET /v1/model-usage`. It reports spend and the ceilings in
  force; it cannot raise one, and there is no companion writer (see
  `routes/model-usage.ts`)
- Read-only platform facts: `GET /v1/platform`
