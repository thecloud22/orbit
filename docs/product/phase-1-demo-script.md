# Orbit Phase 1 Demo Script

**Purpose:** Demonstrate the initial Orbit value proposition in under five minutes.

## Demo setup

Ensure the following are running:

- Orbit Watchtower web application
- Orbit API
- Orbit browser worker
- PostgreSQL
- Controlled demo service-request portal

## Core message

> Orbit turns a documented business procedure into a deterministic, observable agent. It does not simply run a browser script; it records the exact workflow version, actions, assertions, screenshots, DOM evidence, trace, outputs, and outcome.

## Scenario 1 — Request found

### Business SOP

```text
1. Open the service request portal.
2. Search for the service request using its request number and confirm that the matching request and current status are displayed.
```

### Steps

1. Open Orbit Watchtower.
2. Show the `Find Service Request` agent.
3. Point out that the agent is version `0.1.0`.
4. Click `Run Agent`.
5. Enter `SR-1001` as the service request number.
6. Click `Start Run`.
7. Show the run transitioning from queued to running.
8. Open the run detail.
9. Show the logical steps:
   - Open service request portal
   - Enter service request number
   - Submit search
   - Detect request result
   - Verify request number
   - Extract status and assigned team
10. Show assertion success.
11. Show the extracted outputs:

```text
Request status: In Progress
Assigned team: Infrastructure Operations
Business outcome: request_found
```

12. Show screenshots, DOM snapshots, and the Playwright trace artifact.
13. Explain that every action maps to the documented SOP and immutable Agent Version.

## Scenario 2 — Valid business outcome: not found

1. Start the same agent again.
2. Enter `SR-9999`.
3. Start the run.
4. Show that the run completes successfully at the runtime level.
5. Show business outcome:

```text
request_not_found
```

6. Explain that Orbit distinguishes a correctly completed process with no matching record from a technical failure.
7. Inspect the evidence showing the not-found UI state.

## Scenario 3 — Controlled technical failure

Use a test-only Agent Version with an intentionally incorrect locator or controlled target variation.

1. Start the test run.
2. Show that Orbit records a classified failure.
3. Show error code such as:

```text
LOCATOR_NOT_FOUND
```

4. Show the screenshot, DOM snapshot, trace, failed step, and event timeline.
5. Explain that this evidence model is the foundation for future safe recovery—not hidden retries or silent script changes.

## Closing message

> This is the smallest Orbit loop: SOP intent becomes a versioned executable workflow, the workflow runs deterministically, and Watchtower provides proof of what happened. The next phases add natural-language SOP understanding, Studio editing/testing/publishing, bounded AI decisions, governance, and controlled recovery.
