# Find Service Request

**SOP status:** Seeded Phase 1 business procedure

**Purpose:** Locate a service request and verify that its current status and assigned team are displayed.

## Business owner

To be assigned when Orbit is used beyond the controlled demo environment.

## Trigger

Phase 1 trigger: a user manually starts the workflow from Orbit Watchtower.

## Required input

| Key | Label | Type | Required | Example |
|---|---|---|---|---|
| `requestNumber` | Service request number | string | Yes | `SR-1001` |

## Procedure

1. Open the service request portal.
2. Search for the service request using its request number.
3. Confirm that the matching service request is displayed.
4. Record the current request status and assigned team.

## Completion criteria

The procedure is complete when all of the following are true:

- The displayed request number exactly matches the requested request number.
- The current request status is visible.
- The assigned team is visible.

## Business outcomes

| Outcome | Meaning |
|---|---|
| `request_found` | A matching service request was found and its status/team were verified |
| `request_not_found` | No matching service request exists; the procedure completed correctly |

## Expected outputs

| Key | Type | Required when found | Example |
|---|---|---|---|
| `requestNumber` | string | Yes | `SR-1001` |
| `requestStatus` | string | Yes | `In Progress` |
| `assignedTeam` | string | Yes | `Infrastructure Operations` |

## Expected exceptions

| Condition | Expected behavior | Classification |
|---|---|---|
| Request number is missing | Do not start the run | Input validation error |
| Request is not found | Complete with `request_not_found` | Valid business outcome |
| Portal cannot load | Mark run failed with evidence | Navigation/runtime failure |
| Search field cannot be found | Mark run failed with evidence | Locator failure |
| Returned request does not match input | Mark run failed with evidence | Assertion failure |

## Phase 1 implementation notes

- The portal is a controlled local demo application.
- The workflow is read-only.
- No credentials are required.
- The browser must only navigate to localhost.
- The implementation must capture screenshots, DOM snapshots, and a Playwright trace.
- The browser implementation is defined in Agent IR, not in this SOP.
