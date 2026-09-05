# Orbit Phase 1 Test Strategy

**Status:** Active Phase 1 test strategy

## Objective

Prove that Orbit executes a typed Agent IR deterministically, records evidence, and exposes results through Watchtower.

Testing must validate the full product chain, not merely UI rendering or isolated Playwright commands.

```text
Agent IR fixture
  -> validation
  -> persistence
  -> runtime
  -> Playwright execution
  -> events/artifacts
  -> API
  -> Watchtower UI
```

## Test layers

| Layer | Tool | Purpose |
|---|---|---|
| Unit | Vitest | Zod schemas, interpolation, locator resolution, error classification, storage helpers |
| Database integration | Vitest + local/test PostgreSQL | Migrations, repositories, event ordering, artifact links |
| Runtime integration | Vitest + Playwright/demo portal | Execute Agent IR and validate persisted outcome/evidence |
| API integration | Fastify inject or HTTP test harness | Validate inputs, run creation, query responses, error envelope |
| UI component | React test tooling as selected | Input validation, status rendering, artifact links |
| End-to-end | Playwright Test | User starts a run in Watchtower and sees final persisted evidence |

## Required fixtures

### Found request

```json
{
  "requestNumber": "SR-1001"
}
```

Expected:

```text
runtime status: succeeded
business outcome: request_found
requestStatus: In Progress
assignedTeam: Infrastructure Operations
```

### Not-found request

```json
{
  "requestNumber": "SR-9999"
}
```

Expected:

```text
runtime status: succeeded
business outcome: request_not_found
```

### Invalid input

```json
{
  "requestNumber": ""
}
```

Expected:

```text
API validation error
no run dispatched
```

### Locator failure

Use a test-only invalid Agent Version or controlled portal variation.

Expected:

```text
runtime status: failed
error code: LOCATOR_NOT_FOUND
screenshot/DOM/trace evidence exists where possible
```

## Required contract tests

- Agent IR YAML fixture validates.
- Invalid Agent IR action type fails validation.
- Unsupported locator strategy fails validation.
- Unresolved interpolation reference fails validation or preflight.
- Agent step without source SOP IDs fails validation.
- Unsupported domain in Agent IR fails permission validation.
- Invalid event payload fails validation.

## Required runtime assertions

For the found path:

- Run is linked to exact immutable Agent Version.
- Step transitions are persisted in expected order.
- Event sequences are strictly increasing.
- Browser screenshots exist after configured actions.
- DOM snapshots exist after configured actions.
- Trace exists at run end.
- Request number assertion passes.
- Extracted outputs are persisted.

For the not-found path:

- The run does not classify not-found as technical failure.
- The request-not-found UI state is recorded.
- Trace and configured evidence exist.

For technical failure:

- Error is typed.
- Run/step status is failed.
- Relevant event and evidence exist.
- Failure is visible through API and Watchtower.

## Required API tests

- List agent versions returns seeded Find Service Request version.
- Create run validates `requestNumber`.
- Create run returns queued run ID.
- Get run returns persisted state, events, outputs, and artifacts.
- Unknown Agent Version returns 404.
- Unknown run returns 404.
- Invalid request returns structured error envelope.

## Required UI tests

- Watchtower shows Find Service Request agent.
- Input form is generated from returned Agent Version input schema.
- Empty input produces visible validation feedback.
- User can start a known request run.
- UI shows terminal found state and extracted outputs.
- UI shows not-found as valid business outcome.
- UI shows technical failure information when provided by API.

## Test data safety

- Use only synthetic demo data.
- Do not use real credentials, PII, internal endpoints, or production artifacts.
- Keep local artifact test data under gitignored directories.

## Definition of Phase 1 test complete

Phase 1 is test-complete when CI can automatically validate:

1. Contract validity.
2. Database persistence.
3. Found workflow path.
4. Not-found workflow path.
5. Controlled technical failure path.
6. Artifact existence and links.
7. API contracts.
8. Watchtower manual trigger and run display.
