# Orbit Phase 1 Delivery Backlog

**Status:** Initial proposed delivery sequence

**Purpose:** Break Phase 1 into small, testable increments. Claude Code should implement one approved task at a time.

## Delivery rule

Before implementation of a task, provide:

1. Goal and approach
2. Files expected to change
3. Data/API contract impact
4. Test plan
5. Assumptions and risks
6. Explicit statement of what remains out of scope

After implementation, provide:

1. Changed files
2. Commands run
3. Test results
4. Known limitations
5. Documentation updates

---

## Task 1 — Scaffold monorepo and local developer environment

### Goal

Create the project structure, shared TypeScript configuration, basic scripts, and Docker Compose PostgreSQL service.

### Deliverables

- pnpm workspace configuration
- Application/package directories
- Root TypeScript/lint/test config
- Docker Compose PostgreSQL service and health check
- Environment variable examples
- Root scripts for development, typecheck, lint, test, and database operations
- Updated README setup instructions

### Acceptance criteria

- `pnpm install` succeeds.
- Docker Compose starts PostgreSQL successfully.
- Workspace type checking succeeds with placeholder packages.
- No production logic is implemented yet.

### Out of scope

- Database schema
- UI
- API routes
- Playwright runtime

---

## Task 2 — Build controlled demo portal

### Goal

Implement the local service-request portal used as the deterministic automation target.

### Deliverables

- `/requests` route
- Search input and button using required test IDs
- Known request data for `SR-1001`
- Not-found state for `SR-9999` and other unknown values
- Stable request result view
- Browser tests for found and not-found scenarios

### Acceptance criteria

- Searching `SR-1001` shows request number, `In Progress`, and `Infrastructure Operations`.
- Searching `SR-9999` shows only request-not-found state.
- Required test IDs exist.
- Playwright Test covers both paths.

### Out of scope

- Authentication
- Real data persistence
- External systems

---

## Task 3 — Implement domain contracts and fixture validation

### Goal

Define typed Zod/TypeScript contracts for the Phase 1 domain.

### Deliverables

- Agent IR schema and inferred types
- Locator schema
- Assertion schema
- Input/variable/output schema
- Run status and business outcome schema
- Event schema
- Error taxonomy schema
- Artifact metadata schema
- YAML fixture loader/validator
- Unit tests for valid and invalid fixtures

### Acceptance criteria

- `fixtures/find-service-request.agent.yaml` parses successfully.
- Invalid step types, unresolved variable references, invalid locators, and malformed outcomes are rejected.
- Domain packages have no Fastify, React, Drizzle, or Playwright dependencies.

### Out of scope

- Runtime execution
- Database schema
- UI

---

## Task 4 — Implement PostgreSQL schema, migrations, and repositories

### Goal

Persist Agent Versions, runs, steps, events, artifacts, and artifact links.

### Required tables

```text
agents
agent_versions
runs
run_steps
run_events
artifacts
artifact_links
```

### Deliverables

- Drizzle schema and migrations
- Repository interfaces/implementations
- Seed function for Find Service Request Agent Version
- Database integration tests

### Acceptance criteria

- Seeded Agent Version can be stored and retrieved.
- A run can be created with input values and exact Agent Version reference.
- Steps/events/artifact metadata can be persisted and queried by run.
- Binary artifact bytes are not stored in PostgreSQL.

### Out of scope

- Full SOP Graph persistence
- Users/roles/tenants
- Approval and policy tables

---

## Task 5 — Implement local artifact storage

### Goal

Create an artifact storage interface and local filesystem implementation.

### Deliverables

- Artifact storage interface
- Local filesystem adapter under gitignored `data/artifacts/`
- Content type, size, checksum, and storage key handling
- Repository integration for artifact metadata and links
- Unit/integration tests

### Acceptance criteria

- A screenshot-like test artifact can be stored and read.
- Artifact metadata is persisted and linked to run/step.
- Storage implementation can be replaced later without changing runtime contracts.

### Out of scope

- S3/MinIO
- Signed URLs
- Artifact retention jobs

---

## Task 6 — Implement runtime and Playwright browser worker

### Goal

Execute the persisted Agent IR against the demo portal and persist run evidence.

### Deliverables

- Runtime interpreter with explicit run/step state transitions
- Separate browser-worker process
- Playwright executor for supported action types
- Localhost domain enforcement
- Restricted interpolation resolver
- Structured event emission
- Screenshot, DOM snapshot, trace capture
- Extracted output persistence
- Typed error classification
- Found/not-found behavior
- Integration tests against demo portal

### Acceptance criteria

- `SR-1001` executes the persisted fixture and reaches `succeeded/request_found`.
- `SR-9999` reaches `succeeded/request_not_found`.
- Trace and configured artifacts exist for both runs.
- Broken locator creates `LOCATOR_NOT_FOUND` or equivalent typed failure.
- Runtime is not a hard-coded one-off Playwright script.

### Out of scope

- Durable queue
- Retry engine beyond a single initial attempt
- External browser targets
- LLMs

---

## Task 7 — Implement Fastify run and query APIs

### Goal

Expose the API required by Watchtower.

### Deliverables

- `GET /v1/agent-versions`
- `POST /v1/agent-versions/:agentVersionId/runs`
- `GET /v1/runs/:runId`
- Artifact retrieval route
- Request/response validation
- Development actor metadata
- API integration tests

### Acceptance criteria

- API validates request number input.
- API creates a version-pinned run and returns `runId`.
- Run retrieval exposes persisted status, outcome, steps, events, outputs, and artifact metadata.
- Errors use structured error envelope.

### Out of scope

- Auth provider
- API key/OAuth
- Webhooks
- SSE unless simple and beneficial

---

## Task 8 — Implement Watchtower Phase 1 UI

### Goal

Enable a user to start and inspect the agent from a browser.

### Deliverables

- Agent list page/card
- Run agent dialog/form generated from input schema
- Validation messaging
- Run detail route
- Polling or basic live update
- Timeline/steps view
- Output/result display
- Screenshot/DOM artifact views
- Trace artifact link
- Failure display

### Acceptance criteria

- User can run `SR-1001` without API tooling.
- User can observe queued/running/terminal state.
- User can distinguish found, not-found, and technical failure.
- UI uses backend persisted data rather than fake client-side state.

### Out of scope

- Studio
- Multi-agent catalog UX
- Alerts, filters, saved views
- Approval inbox

---

## Task 9 — End-to-end proof, documentation, and hardening

### Goal

Prove the complete Phase 1 flow and make it reproducible for a new developer.

### Deliverables

- Automated end-to-end test for found path
- Automated end-to-end test for not-found path
- Controlled technical failure test
- README setup/run/troubleshooting instructions
- Seed/reset scripts
- Final acceptance checklist
- Basic structured logging review

### Acceptance criteria

- A clean developer environment can demonstrate Phase 1 using documented commands.
- Automated tests validate run outcome, outputs, events, and artifact existence.
- Documentation identifies known Phase 1 limitations and intentionally deferred capabilities.

### Out of scope

- Phase 2 natural-language parsing
- Production cloud deployment
- Security certifications or advanced governance
