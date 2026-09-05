# Orbit Events and Evidence Contract — Phase 1

**Status:** Active Phase 1 contract

**Purpose:** Define the minimum event and evidence model required for Watchtower to reconstruct an Orbit run from persisted backend data.

## Principle

Events and artifacts are product evidence, not diagnostic leftovers.

For every material browser action, Orbit should be able to answer:

- What did the SOP expect?
- What Agent IR step was executed?
- What did the browser do?
- What did the browser observe?
- Which assertion passed or failed?
- Which artifact proves the result?
- What business outcome or technical error resulted?

## Event envelope

```json
{
  "id": "evt_01J...",
  "schemaVersion": "0.1",
  "runId": "run_01J...",
  "runStepId": "rstep_01J...",
  "agentVersionId": "agentv_01J...",
  "agentStepId": "submit_request_search",
  "eventType": "browser.click.completed",
  "occurredAt": "2026-09-05T16:00:00.000Z",
  "sequence": 12,
  "payload": {},
  "artifactRefs": []
}
```

## Required envelope fields

| Field | Meaning |
|---|---|
| `id` | Opaque event identifier |
| `schemaVersion` | Event schema version |
| `runId` | Parent run |
| `runStepId` | Logical run step when applicable |
| `agentVersionId` | Exact immutable Agent Version executed |
| `agentStepId` | Agent IR step ID when applicable |
| `eventType` | Typed event name |
| `occurredAt` | UTC timestamp |
| `sequence` | Strict per-run ordering number |
| `payload` | Safe structured details; no secrets |
| `artifactRefs` | Related artifact IDs |

## Required Phase 1 event types

```text
run.queued
run.started
run.completed
run.failed

step.started
step.completed
step.failed

browser.navigation.completed
browser.fill.completed
browser.click.completed
browser.extract.completed

assertion.passed
assertion.failed

artifact.created
```

## Event ordering requirements

- Every run has monotonically increasing `sequence` values.
- Do not rely on timestamps alone for ordering.
- Material operations emit a start and terminal event through `step.*` events.
- Browser-specific completion events supplement, not replace, logical step events.
- Events are append-only after persistence.

## Artifact model

Artifact bytes must be stored outside PostgreSQL. PostgreSQL stores metadata and links.

### Required Phase 1 artifact kinds

| Kind | When created |
|---|---|
| `browser_screenshot` | After navigation, fill, click, and final state |
| `dom_snapshot` | After navigation and state-changing click |
| `browser_trace` | At end of every run |
| `extracted_json` | Optional when structured extracted data is persisted as artifact rather than step output |
| `error_context` | Optional for classified failure context |

### Artifact metadata

```json
{
  "id": "art_01J...",
  "runId": "run_01J...",
  "runStepId": "rstep_01J...",
  "kind": "browser_screenshot",
  "contentType": "image/png",
  "storageKey": "runs/run_01J/steps/submit_request_search/after.png",
  "sizeBytes": 12345,
  "sha256": "...",
  "createdAt": "2026-09-05T16:00:00.000Z"
}
```

### Artifact links

An artifact may be linked to:

```text
run
run step
step attempt
run event
SOP source
SOP Graph node
Agent Version
approval request
```

Phase 1 requires links to run, run step, and relevant event.

## Expected-versus-observed model

Watchtower should render each material step using this conceptual model:

| Expected | Observed |
|---|---|
| SOP instruction | Agent IR action |
| Source SOP step ID | Browser URL/action details |
| Required assertion | Assertion result |
| Expected result state | Screenshot and DOM snapshot |
| Business completion criterion | Extracted output or business outcome |

## Error taxonomy

Phase 1 minimum error codes:

```text
VALIDATION_ERROR
INPUT_ERROR
BROWSER_TIMEOUT
LOCATOR_NOT_FOUND
ASSERTION_FAILED
NAVIGATION_FAILED
UNEXPECTED_UI_STATE
WORKER_FAILURE
ARTIFACT_STORAGE_ERROR
INTERNAL_ERROR
```

Business outcomes such as `request_not_found` must not be represented as technical errors.

## Redaction requirements

Phase 1 uses non-sensitive demo data, but all event and artifact APIs must preserve extension points for:

- Input/output field masking
- Screenshot/DOM redaction
- Artifact sensitivity labels
- Access-controlled artifact retrieval
- Redaction version metadata

Never include secret values in event payloads, artifact metadata, logs, or screenshots.
