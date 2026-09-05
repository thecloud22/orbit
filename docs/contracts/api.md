# Orbit API Contract — Phase 1

**Status:** Active Phase 1 API contract

**Purpose:** Define the minimal HTTP API required for Watchtower to list agents, create manual runs, and retrieve run evidence.

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

### Validation behavior

- Unknown agent version: `404`.
- Invalid input payload: `400` with field-level validation errors.
- Unsupported trigger: `400`.
- Run creation/internal persistence failure: `500` with safe error ID.

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

## Optional run events endpoint

```text
GET /v1/runs/:runId/events
```

Phase 1 may initially poll `GET /v1/runs/:runId`. If an events endpoint exists, it returns ordered persisted events. Server-Sent Events may be added after the basic polling run detail works.

## Artifact retrieval

```text
GET /v1/artifacts/:artifactId
```

Phase 1 behavior may stream local artifact bytes or return an authorized local URL. The abstraction must permit a future signed object-storage URL.

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

## Non-goals

Phase 1 API does not include:

- Authentication/SSO endpoints
- User/role management
- SOP authoring endpoints
- Publishing endpoints
- Webhook registration
- Schedule management
- Policy/approval endpoints
- LLM endpoints
- Multi-tenant administration
