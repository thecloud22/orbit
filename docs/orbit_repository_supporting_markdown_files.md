# Orbit Supporting Repository Markdown Files

This document contains the remaining recommended Markdown files for the initial Orbit repository. Create each section as the indicated file path.

These files complement:

- `CLAUDE.md`
- `docs/product/orbit-product-vision-and-requirements.md`
- `docs/product/orbit-end-to-end-production-vision.md`
- `docs/product/orbit-end-to-end-delivery-phases.md`

The active implementation target remains **Phase 1 only**.

---

## File: `README.md`

```md
# Orbit

Orbit turns business SOPs into governed, executable, observable agents.

Orbit preserves business process intent, executes approved workflows deterministically, and records evidence for every material action.

```text
Natural-language SOP
  -> SOP Graph
  -> Agent IR
  -> Controlled execution
  -> Events and artifacts
  -> Watchtower evidence
```

## Current status

Orbit is currently implementing **Phase 1: Deterministic Proof Loop**.

The initial vertical slice is intentionally narrow:

```text
Watchtower manual trigger
  -> Service request number input
  -> Immutable Agent Version
  -> Deterministic Playwright execution
  -> Screenshots, DOM snapshots, and trace
  -> Watchtower evidence view
```

## Initial demo workflow

### Find Service Request

1. Open the service request portal.
2. Search for the service request using its request number and confirm that the matching request and current status are displayed.

Example input:

```text
SR-1001
```

Expected output:

```text
Request status: In Progress
Assigned team: Infrastructure Operations
Business outcome: request_found
```

An unknown request such as `SR-9999` should complete with the valid business outcome `request_not_found`, not a technical failure.

## Repository layout

```text
apps/
  web/                 # Orbit Watchtower React application
  api/                 # Orbit Fastify API
  browser-worker/      # Runtime interpreter and Playwright worker
  demo-portal/         # Controlled target portal for Phase 1

packages/
  contracts/           # Shared Zod schemas, events, errors, IDs
  sop-graph/           # Business-process representation; no Playwright dependency
  agent-ir/            # Typed executable workflow contract
  runtime/             # Executor-neutral workflow runtime
  executor-playwright/ # Playwright action implementations
  artifacts/           # Artifact storage interfaces and adapters
  db/                  # Drizzle schema, migrations, repositories
  policy/              # Phase 1 domain/action allowlist checks

docs/
  product/             # Product requirements, roadmap, production vision
  architecture/        # Architecture decisions and diagrams
  contracts/           # Contract documentation
  sop/                 # SOP fixtures and examples
  tasks/               # Approved task plans and delivery notes

fixtures/              # Agent IR, input, and test fixtures
```

## Prerequisites

Expected local prerequisites:

- Node.js LTS
- pnpm
- Docker and Docker Compose
- Git

Exact supported versions should be added when the project scaffold is created.

## Local setup

> The commands below are target commands. Verify package scripts after implementation and update this section if the final commands differ.

```bash
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

Expected local services:

| Service | Expected local address | Purpose |
|---|---|---|
| Watchtower web app | `http://localhost:3000` | Trigger and inspect runs |
| API | `http://localhost:3002` | Agent/run/evidence API |
| Demo portal | `http://localhost:3001/requests` | Controlled service-request target |
| PostgreSQL | `localhost:5432` | Metadata, run state, events |

## Validation commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
```

## Phase 1 scope

Included:

- Watchtower manual trigger.
- One agent: Find Service Request.
- One typed dynamic input: `requestNumber`.
- Deterministic Playwright browser actions.
- PostgreSQL-backed Agent Versions, runs, steps, events, and artifact metadata.
- Local artifact storage for screenshots, DOM snapshots, and traces.
- Controlled business outcomes: `request_found`, `request_not_found`.
- Read-only controlled demo portal.

Not included:

- Document upload, OCR, PDF/DOCX parsing, screenshot extraction.
- Runtime LLM decisions or recovery.
- Studio authoring UI and workflow graph canvas.
- External websites, real credentials, MFA, or CAPTCHA.
- API/webhook/schedule triggers.
- Redis/BullMQ/Temporal, cloud deployment, S3, Kubernetes, or microservices.
- Multi-tenancy, SSO, full RBAC, policy UI, or approval workflow.
- State-changing business actions.

## Documentation

Read these files in order:

1. [`CLAUDE.md`](./CLAUDE.md) — active engineering rules and Phase 1 constraints.
2. `docs/product/orbit-product-vision-and-requirements.md` — active requirements and acceptance criteria.
3. `docs/product/orbit-end-to-end-delivery-phases.md` — product phases and phase gates.
4. `docs/product/orbit-end-to-end-production-vision.md` — long-term product and production architecture.
5. `docs/architecture/decisions.md` — active architecture decisions.
6. `docs/sop/find-service-request.md` — initial natural-language SOP.
7. `fixtures/find-service-request.agent.yaml` — initial Agent IR fixture.

## Contribution workflow

1. Read `CLAUDE.md` and the active phase requirements.
2. Create or select one bounded task.
3. Propose the approach, affected files, tests, and acceptance criteria.
4. Obtain approval for architecture, contract, data model, or security changes.
5. Implement the smallest complete change.
6. Run relevant checks and tests.
7. Update docs if a contract or setup command changed.
8. Commit a working increment.

## Security notice

Phase 1 uses only a local, read-only demo portal. Do not add real credentials, customer data, production targets, secrets, or unrestricted browser access without explicit scope change and security review.
```

---

## File: `docs/architecture/decisions.md`

```md
# Orbit Architecture Decisions

**Status:** Active decisions

**Purpose:** Record the architecture decisions that guide the current implementation. Add a new decision record when a material technical or product architecture decision changes.

## How to use this file

- Do not rewrite prior decisions silently.
- Mark superseded decisions rather than deleting their history.
- Each decision should include context, decision, consequences, alternatives, and phase relevance.
- The active Phase 1 requirements override future-state architecture aspirations.

---

## ADR-001: Use a modular TypeScript monolith first

**Status:** Accepted

**Phase:** 0–3

### Context

Orbit needs Studio, Watchtower, Agent IR, SOP Graph, runtime, browser execution, artifacts, policies, and future LLM capabilities. A microservice architecture would introduce deployment, observability, contract, and operational complexity before the product loop is proven.

### Decision

Build Orbit as a modular TypeScript monolith with clear package/module boundaries. Run the browser worker as a separate process because browser execution has distinct resource and isolation needs.

### Consequences

- Faster iteration and simpler local development.
- Shared TypeScript contracts across UI, API, runtime, and tests.
- Fewer network boundaries and deployment units initially.
- Modules must remain independently testable and avoid inappropriate dependencies.
- Future extraction is possible when scaling, security, ownership, or release cadence requires it.

### Alternatives considered

| Alternative | Why not now |
|---|---|
| Microservices from day one | Too much operational and coordination overhead |
| Serverless-only architecture | Browser automation lifecycle and artifacts are less natural for the first runtime |
| Single API process containing Playwright | Weak browser isolation and poor production evolution |

---

## ADR-002: Preserve SOP Graph separately from Agent IR

**Status:** Accepted

**Phase:** Foundation onward

### Context

Business SOPs express business intent. Browser/API actions express one possible implementation. Coupling the process model directly to Playwright would make the product brittle and limit future execution adapters.

### Decision

Maintain two distinct representations:

```text
SOP Graph = business process semantics
Agent IR = typed execution plan
```

### Consequences

- SOP Graph has no Playwright selectors, browser calls, or secret values.
- Agent IR maps each execution step to source SOP Graph node IDs.
- A future API implementation can replace browser implementation without changing core business intent.
- Studio can show source-to-execution traceability.

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| SOP text passed directly to LLM/runtime | Not deterministic, diffable, testable, or governable enough |
| Direct SOP-to-Playwright script generation | Loses semantic layer and makes future implementation changes difficult |
| Playwright page object model as process model | Too implementation-specific |

---

## ADR-003: Start with deterministic browser execution

**Status:** Accepted

**Phase:** 1

### Context

Orbit will eventually support LLM understanding, decisions, and recovery. Introducing autonomous LLM browser control early would weaken reliability, evidence, policy enforcement, and debugging.

### Decision

Phase 1 browser actions are deterministic and defined in Agent IR. LLMs do not select browser actions, navigate domains, access credentials, or execute arbitrary tools.

### Consequences

- The first demo is less magical but more trustworthy.
- Failures are attributable to deterministic steps, locators, assertions, or target behavior.
- Evidence and policy foundations can mature before AI authority increases.

---

## ADR-004: Treat evidence as first-class product data

**Status:** Accepted

**Phase:** 1 onward

### Context

Orbit's differentiation is governed, inspectable execution. Logs alone cannot prove what the browser observed or why the workflow reached an outcome.

### Decision

Persist structured events and first-class artifacts for material actions. Use PostgreSQL for metadata/indexing and external artifact storage for binary data.

### Required Phase 1 evidence

- Run and step records
- Structured events
- Screenshots
- DOM snapshots
- Playwright trace
- Assertion outcomes
- Extracted values
- Typed error data

### Consequences

- Storage and redaction must be designed early.
- Watchtower can reconstruct execution from persisted data.
- Artifacts must be authorized and treated as potentially sensitive.

---

## ADR-005: Use version-pinned immutable Agent Versions

**Status:** Accepted

**Phase:** 1 onward

### Context

Operational evidence is meaningless if an old run can be reinterpreted through a changed workflow definition.

### Decision

Every run references one immutable Agent Version. Drafts may be edited, but publication creates a new immutable version.

### Consequences

- Historical evidence remains reproducible.
- Rollback is explicit.
- Diffs and test results can be associated with exact versions.
- Database schema must support agent identity separately from agent version identity.

---

## ADR-006: Separate runtime status from business outcome

**Status:** Accepted

**Phase:** 1 onward

### Context

A workflow can execute correctly and determine that a target record does not exist. That is not equivalent to a browser failure.

### Decision

Model both runtime status and business outcome.

Example:

```text
runtime status: succeeded
business outcome: request_not_found
```

### Consequences

- Watchtower can distinguish work completed correctly from technical failure.
- Retry and escalation behavior can be outcome-aware.
- Reporting is meaningful for operations teams.

---

## ADR-007: Use a restricted expression/interpolation model

**Status:** Accepted

**Phase:** 1 onward

### Context

Agent definitions need dynamic values such as `${inputs.requestNumber}`. Arbitrary JavaScript or shell evaluation would introduce a severe execution and tenant-security risk.

### Decision

Use a restricted interpolation and expression model. Phase 1 supports only declared input/variable references. Add limited typed comparisons and transforms later through approved operations.

### Consequences

- No `eval`, `Function`, arbitrary dynamic module loading, or arbitrary shell commands.
- Agent IR remains safer, portable, and easier to validate.
- Complex transformations require explicit typed steps or future adapters.

---

## ADR-008: Use Playwright behind an executor boundary

**Status:** Accepted

**Phase:** 1 onward

### Context

Playwright is the first browser implementation, but Orbit must later support API actions and potentially other execution adapters.

### Decision

Runtime depends on executor interfaces. `executor-playwright` implements approved browser action types but does not control workflow order or business outcomes.

### Consequences

- Browser execution can evolve independently.
- API executor can be added later without replacing runtime semantics.
- Playwright code must not leak into SOP Graph or generic Agent IR packages.

---

## ADR-009: Start with Watchtower as the trigger UI

**Status:** Accepted

**Phase:** 1

### Context

The earliest product value is triggering a simple agent and inspecting proof of execution. Full Studio authoring is unnecessary before runtime/evidence works.

### Decision

Watchtower is the Phase 1 manual trigger interface. Studio is introduced later for SOP authoring, review, testing, and publishing.

### Consequences

- Phase 1 can seed one SOP and Agent Version manually.
- Trigger metadata still uses a normalized Run Request to support API/webhook/schedule triggers later.
- Watchtower becomes both an operational console and initial product entry point.

---

## ADR-010: Local filesystem artifacts first, S3-compatible storage later

**Status:** Accepted

**Phase:** 1

### Context

Screenshots, traces, and DOM snapshots must be captured in the first vertical slice. Adding MinIO/S3 immediately increases local setup complexity.

### Decision

Implement an artifact storage interface. Use a local filesystem adapter in Phase 1. Add MinIO/S3-compatible implementations before shared/cloud deployment.

### Consequences

- Artifact bytes stay out of PostgreSQL.
- Migration to object storage does not change runtime/evidence contracts.
- Local artifact directory must be gitignored and access-controlled.

---

## ADR-011: No durable queue in the first vertical slice

**Status:** Accepted

**Phase:** 1

### Context

A queue is useful for independent browser workers, retries, schedules, and scaling. It is not required to prove one local manual trigger flow.

### Decision

Use an in-process run-dispatch abstraction in Phase 1. Do not couple runtime execution to HTTP request handling. Add a durable queue when asynchronous reliability, concurrency, or production triggers require it.

### Consequences

- Phase 1 remains operationally simple.
- Runtime/job interfaces must allow a future queue adapter.
- API should return a run ID promptly even if local execution begins immediately.

---

## ADR-012: Introduce LLMs as bounded structured services

**Status:** Accepted

**Phase:** 2 onward

### Context

LLMs are useful for SOP understanding, classification, extraction, and recovery proposals. They are unsafe as unrestricted tool controllers.

### Decision

All LLM outputs must be schema-constrained, versioned, validated, and routed through explicit Agent IR/policy boundaries. The LLM Gateway is a provider abstraction.

### Consequences

- No raw model output becomes executable browser/API code.
- Prompt/model metadata and output validation become evidence.
- Prompt injection and data classification must be considered before runtime LLM decisions.

---

## ADR-013: Adopt trust tiers for agent authority

**Status:** Accepted

**Phase:** 1 onward

### Context

A read-only lookup agent and a refund agent should not have equivalent controls.

### Decision

Classify agent use cases by authority tier and require stronger controls as authority increases.

```text
Tier 0: observe
Tier 1: recommend
Tier 2: prepare
Tier 3: bounded execute
Tier 4: high-impact execute
Tier 5: bounded autonomous recovery
```

### Consequences

- Phase 1 is Tier 0 only.
- Product readiness is assessed per use case/tier rather than universally.
- Policies, approval, idempotency, audits, and evaluations grow with authority.

---
```

---

## File: `docs/sop/find-service-request.md`

```md
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
```

---

## File: `fixtures/find-service-request.agent.yaml`

```yaml
schemaVersion: "0.1"
id: agent_find_service_request
version: "0.1.0"
name: Find Service Request
description: Locate a service request and verify its current status and assigned team.

source:
  sopId: sop_find_service_request
  sopVersion: "0.1"
  sourceSopStepIds:
    - sop_step_open_portal
    - sop_step_search_and_verify

lifecycle:
  status: published
  trustTier: observe

trigger:
  type: watchtower_manual

inputs:
  requestNumber:
    type: string
    required: true
    label: Service request number
    description: Service request number to locate in the portal.
    validation:
      minLength: 1
      maxLength: 100
    examples:
      - SR-1001

variables:
  requestStatus:
    type: string
  assignedTeam:
    type: string

outputs:
  requestNumber:
    type: string
  requestStatus:
    type: string
  assignedTeam:
    type: string

permissions:
  browser:
    allowedDomains:
      - localhost
    allowedActions:
      - navigate
      - fill
      - click
      - extract
      - assert
      - screenshot
      - dom_snapshot

steps:
  - id: open_request_portal
    type: browser.navigate
    sourceSopStepIds:
      - sop_step_open_portal
    url: http://localhost:3001/requests
    timeoutMs: 30000
    evidence:
      captureScreenshot: true
      captureDomSnapshot: true
    assertions:
      - type: locator_visible
        locator:
          strategy: test_id
          value: request-number-input

  - id: enter_request_number
    type: browser.fill
    sourceSopStepIds:
      - sop_step_search_and_verify
    locator:
      strategy: test_id
      value: request-number-input
    value: ${inputs.requestNumber}
    timeoutMs: 15000
    evidence:
      captureScreenshot: true

  - id: submit_request_search
    type: browser.click
    sourceSopStepIds:
      - sop_step_search_and_verify
    locator:
      strategy: test_id
      value: search-request-button
    timeoutMs: 15000
    evidence:
      captureScreenshot: true
      captureDomSnapshot: true

  - id: detect_request_result
    type: browser.expect_one_of
    sourceSopStepIds:
      - sop_step_search_and_verify
    timeoutMs: 15000
    alternatives:
      - whenVisible:
          strategy: test_id
          value: request-result
        next: verify_request_number
      - whenVisible:
          strategy: test_id
          value: request-not-found
        next: complete_not_found

  - id: verify_request_number
    type: browser.assert
    sourceSopStepIds:
      - sop_step_search_and_verify
    assertion:
      type: locator_has_text
      locator:
        strategy: test_id
        value: request-number-result
      expected: ${inputs.requestNumber}

  - id: extract_request_data
    type: browser.extract
    sourceSopStepIds:
      - sop_step_search_and_verify
    fields:
      requestStatus:
        locator:
          strategy: test_id
          value: request-status
        method: text
      assignedTeam:
        locator:
          strategy: test_id
          value: assigned-team
        method: text
    assign:
      requestStatus: ${result.requestStatus}
      assignedTeam: ${result.assignedTeam}

  - id: complete_found
    type: complete
    sourceSopStepIds:
      - sop_step_search_and_verify
    outcome: request_found
    outputs:
      requestNumber: ${inputs.requestNumber}
      requestStatus: ${variables.requestStatus}
      assignedTeam: ${variables.assignedTeam}

  - id: complete_not_found
    type: complete
    sourceSopStepIds:
      - sop_step_search_and_verify
    outcome: request_not_found
    outputs:
      requestNumber: ${inputs.requestNumber}
```

---

## File: `docs/contracts/agent-ir.md`

```md
# Orbit Agent IR Contract — Phase 1

**Status:** Active Phase 1 contract

**Purpose:** Define the minimal typed Agent Intermediate Representation used by Orbit's Phase 1 runtime.

## Design goals

Agent IR must be:

- Typed
- Versioned
- JSON/YAML serializable
- Validatable before execution
- Executable by a deterministic runtime
- Mapped to source SOP steps
- Diffable and persistable
- Independent of React, Fastify, Drizzle, and direct Playwright implementation

Agent IR answers:

> How will this approved agent execute the documented business procedure?

## Non-goals

Phase 1 Agent IR does not support:

- LLM decision nodes
- API actions
- Loops
- Parallel execution
- Retries beyond runtime defaults
- Approvals
- Policy DSL
- User-defined code
- Arbitrary expressions
- Credential values

## Top-level shape

```yaml
schemaVersion: "0.1"
id: agent_find_service_request
version: "0.1.0"
name: Find Service Request
source: {}
lifecycle: {}
trigger: {}
inputs: {}
variables: {}
outputs: {}
permissions: {}
steps: []
```

## Required top-level fields

| Field | Meaning |
|---|---|
| `schemaVersion` | Version of Agent IR schema |
| `id` | Stable logical agent identifier |
| `version` | Immutable agent version string |
| `name` | Human-readable agent name |
| `source` | SOP/Graph provenance reference |
| `lifecycle` | Publication state and trust tier |
| `trigger` | Supported trigger type(s) |
| `inputs` | Typed runtime inputs |
| `variables` | Typed values assigned during execution |
| `outputs` | Typed declared final output shape |
| `permissions` | Tool/domain action permissions |
| `steps` | Ordered/connected execution definitions |

## Inputs

Phase 1 supports one input type: `string`.

```yaml
inputs:
  requestNumber:
    type: string
    required: true
    label: Service request number
    validation:
      minLength: 1
      maxLength: 100
```

Inputs must be validated before a run is created or dispatched.

## Variables

Variables must be declared before use.

```yaml
variables:
  requestStatus:
    type: string
  assignedTeam:
    type: string
```

## Interpolation

Phase 1 supports only declared input and variable references:

```text
${inputs.requestNumber}
${variables.requestStatus}
${variables.assignedTeam}
```

The runtime must not execute arbitrary JavaScript, shell expressions, or dynamically evaluated code.

## Locator contract

Phase 1 supports `test_id` locators.

```yaml
locator:
  strategy: test_id
  value: request-number-input
```

Future locator strategies may include role/name, label, text, semantic attributes, CSS, and limited XPath. Phase 1 should not use coordinates.

## Supported step types

### `browser.navigate`

```yaml
- id: open_request_portal
  type: browser.navigate
  sourceSopStepIds: [sop_step_open_portal]
  url: http://localhost:3001/requests
  timeoutMs: 30000
  evidence:
    captureScreenshot: true
    captureDomSnapshot: true
  assertions:
    - type: locator_visible
      locator:
        strategy: test_id
        value: request-number-input
```

Rules:

- URL host must match permitted browser domains.
- Runtime emits navigation and assertion events.
- Runtime captures configured evidence.

### `browser.fill`

```yaml
- id: enter_request_number
  type: browser.fill
  sourceSopStepIds: [sop_step_search_and_verify]
  locator:
    strategy: test_id
    value: request-number-input
  value: ${inputs.requestNumber}
  timeoutMs: 15000
  evidence:
    captureScreenshot: true
```

Rules:

- Locator must resolve uniquely.
- Value must resolve from a declared input/variable.
- Runtime emits fill events and captures configured evidence.

### `browser.click`

```yaml
- id: submit_request_search
  type: browser.click
  sourceSopStepIds: [sop_step_search_and_verify]
  locator:
    strategy: test_id
    value: search-request-button
  timeoutMs: 15000
  evidence:
    captureScreenshot: true
    captureDomSnapshot: true
```

### `browser.assert`

Phase 1 assertion types:

```text
locator_visible
locator_has_text
```

Example:

```yaml
- id: verify_request_number
  type: browser.assert
  sourceSopStepIds: [sop_step_search_and_verify]
  assertion:
    type: locator_has_text
    locator:
      strategy: test_id
      value: request-number-result
    expected: ${inputs.requestNumber}
```

### `browser.expect_one_of`

Use this step to determine which known UI state occurred.

```yaml
- id: detect_request_result
  type: browser.expect_one_of
  sourceSopStepIds: [sop_step_search_and_verify]
  alternatives:
    - whenVisible:
        strategy: test_id
        value: request-result
      next: verify_request_number
    - whenVisible:
        strategy: test_id
        value: request-not-found
      next: complete_not_found
```

Rules:

- Alternatives must be explicit and bounded.
- Ambiguous matches must produce a classified technical failure.
- The runtime must record which alternative was selected.

### `browser.extract`

```yaml
- id: extract_request_data
  type: browser.extract
  sourceSopStepIds: [sop_step_search_and_verify]
  fields:
    requestStatus:
      locator:
        strategy: test_id
        value: request-status
      method: text
    assignedTeam:
      locator:
        strategy: test_id
        value: assigned-team
      method: text
  assign:
    requestStatus: ${result.requestStatus}
    assignedTeam: ${result.assignedTeam}
```

Rules:

- Extracted field names must be declared in the extraction result contract.
- Assigned variables must be declared and type-compatible.
- Runtime persists extracted values in safe step/run outputs.

### `complete`

```yaml
- id: complete_found
  type: complete
  outcome: request_found
  outputs:
    requestNumber: ${inputs.requestNumber}
    requestStatus: ${variables.requestStatus}
    assignedTeam: ${variables.assignedTeam}
```

Rules:

- Completion outcome is a business outcome.
- Completion produces terminal run status `succeeded` unless runtime terminal semantics say otherwise.
- Output values must match declared output contract.

### `fail`

```yaml
- id: fail_unexpected_state
  type: fail
  errorCode: UNEXPECTED_UI_STATE
  message: Expected result or not-found state was not detected.
```

Rules:

- Failure produces terminal run status `failed`.
- Error code must come from Orbit error taxonomy.

## Source mapping requirement

Every executable step must reference at least one SOP source step:

```yaml
sourceSopStepIds:
  - sop_step_search_and_verify
```

This mapping supports Watchtower's expected-versus-observed evidence view.

## Permissions

```yaml
permissions:
  browser:
    allowedDomains:
      - localhost
    allowedActions:
      - navigate
      - fill
      - click
      - extract
      - assert
      - screenshot
      - dom_snapshot
```

Runtime must enforce permissions. Agent IR permission declarations are not merely documentation.

## Validation requirements

Before an Agent Version is accepted:

- All step IDs are unique.
- All source SOP step references exist in the source model/fixture.
- All variable references resolve to declared values.
- All output references resolve and are type-compatible.
- All supported step types are recognized by the runtime profile.
- All URLs satisfy domain permissions.
- All locator objects match supported locator schema.
- All branches reference an existing step.
- At least one terminal completion/failure path exists.
```

---

## File: `docs/contracts/events-and-evidence.md`

```md
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
```

---

## File: `docs/contracts/api.md`

```md
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
```

---

## File: `docs/tasks/phase-1-backlog.md`

```md
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
```

---

## File: `docs/architecture/phase-1-system-design.md`

```md
# Orbit Phase 1 System Design

**Status:** Active Phase 1 architecture

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
| Browser Worker | Executes Playwright actions in a separate process |
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
- Browser navigation checks localhost allowlist.
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
- No LLM: fixture Agent IR is manually seeded.
- No Studio: Watchtower is the initial trigger/inspection UI.

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
```

---

## File: `docs/testing/phase-1-test-strategy.md`

```md
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
```

---

## File: `docs/security/phase-1-security-baseline.md`

```md
# Orbit Phase 1 Security Baseline

**Status:** Active Phase 1 baseline

**Purpose:** Define security constraints for the local deterministic proof loop and ensure the first implementation does not establish unsafe patterns.

## Scope

Phase 1 is a local, read-only, synthetic-data demo. It is not a production security certification or authorization to connect to customer systems.

## Mandatory controls

### Target isolation

- Browser automation may navigate to `localhost` only.
- The only target is Orbit's controlled demo portal.
- Do not add arbitrary URL execution.
- Do not add external browser targets, production systems, or third-party SaaS systems.

### Data safety

- Use only synthetic request data such as `SR-1001`.
- Do not use customer, employee, financial, health, or regulated data.
- Do not upload production documents.
- Do not store secrets in database fixtures, Agent IR, SOPs, logs, events, screenshots, DOM snapshots, traces, or source control.

### Credentials

- Phase 1 uses no credentials.
- Do not simulate secret handling by hard-coding fake credentials into production-style interfaces.
- Preserve future secret-reference boundaries, but do not implement a real secret manager yet.

### Execution safety

- Workflow is read-only.
- Demo portal must not change data.
- Do not implement generic arbitrary code steps.
- Do not use `eval`, `Function`, arbitrary shell commands, or dynamically generated executable code.
- Use restricted variable interpolation only.
- Do not use browser coordinate actions.

### Artifact handling

- Artifact bytes are stored outside PostgreSQL.
- Local artifact directories are gitignored.
- Artifacts are not served directly from a public static directory.
- Do not log raw trace paths or artifact contents indiscriminately.
- Create metadata fields that can later support sensitivity labels and access checks.

### Browser worker

- Browser worker is a separate process from API.
- Use an isolated Playwright context for each run.
- Enforce browser domain allowlist before navigation.
- Apply timeouts and close browser contexts after runs.
- Capture only the artifacts required by Phase 1.

### Logging and errors

- Use structured logs.
- Never log secrets or arbitrary raw page content by default.
- Return safe errors through the API.
- Preserve typed error classification and safe diagnostic context.

## Threats intentionally deferred

These need design hooks but are not fully implemented in Phase 1:

- Multi-tenant isolation
- SSO and RBAC
- Secret manager/Vault integration
- PII redaction and artifact access authorization
- MFA/CAPTCHA support
- Network egress policies beyond localhost restriction
- Audit log for user/security operations
- Data retention/legal hold
- Prompt injection defenses for runtime LLMs
- High-impact action policy and approval controls

## Security readiness gate for Phase 2+

Before connecting any real external system or accepting real SOP documents, reassess:

- Authentication and authorization
- Secret management
- Artifact access controls and redaction
- Tenant/data isolation
- Target system authorization and terms
- Browser worker network isolation
- Audit logging
- Threat model and privacy review
```

---

## File: `docs/product/phase-1-demo-script.md`

```md
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
```

---

## File: `docs/product/initial-wedge-and-personas.md`

```md
# Orbit Initial Wedge and Personas

**Status:** Product positioning guidance

## Initial wedge

Orbit should begin with **read-only or low-risk operational verification workflows**.

Recommended initial market framing:

> Turn documented operational procedures into governed, observable agents—starting with browser-based lookup and verification workflows.

## Why read-only verification first

- Proves SOP-to-agent conversion without irreversible business risk.
- Demonstrates dynamic inputs, browser execution, assertions, outputs, and evidence.
- Avoids early requirements for financial approvals, idempotency, compensation, and high-impact controls.
- Produces clear operational value: faster lookup, consistent validation, auditability, and fewer manual steps.
- Establishes trust before moving into state-changing workflows.

## Candidate initial domains

| Domain | Example SOP | Dynamic input | Why it fits |
|---|---|---|---|
| IT service operations | Find service request and confirm status | Request number | SOP-heavy, ticket-driven, measurable, low risk |
| Enterprise application operations | Find batch/job and confirm completion | Batch ID | Relevant to legacy/enterprise systems |
| Support operations | Find support ticket and verify ownership/status | Ticket number | Frequent repetitive lookups |
| Order operations | Find order and verify fulfillment state | Order number | Familiar workflow pattern |
| Asset operations | Find asset and verify assigned owner | Asset tag | Clear input/output validation |
| Vendor operations | Find vendor and verify payment status | Vendor ID | Back-office relevance, but manage financial sensitivity |

## Initial persona

### Operations analyst / service desk operator

**Goals:**

- Complete repetitive lookup and validation work quickly.
- Trust that the automation followed the approved procedure.
- Understand failures without reading raw logs.
- Produce evidence for supervisors or auditors.

**Phase 1 experience:**

```text
Select agent
-> enter request number
-> start run
-> inspect result and evidence
```

## Secondary personas

| Persona | Near-term need |
|---|---|
| Process owner | Verify that business SOP intent is represented correctly |
| Automation builder | Configure browser mappings/assertions after Phase 2 |
| Supervisor | Review outcomes, exceptions, and throughput |
| Auditor | Confirm documented procedure and execution evidence align |
| Security admin | Later: manage credentials, policies, artifact access |

## Product differentiation

Orbit should not lead with:

```text
AI browser bot
RPA copilot
prompt-driven automation
```

Orbit should lead with:

```text
Documented SOP
-> governed executable agent
-> proof of every run
```

## Initial value hypotheses to validate

1. Operators save time on repetitive lookup/verification procedures.
2. Evidence reduces debugging and supervisor review time.
3. Business users value natural-language SOP capture more than traditional script authoring.
4. Technical reviewers value Agent IR, tests, and versioned publishing over opaque agent prompts.
5. Customers will pay for governance and evidence rather than browser automation alone.
```

---

## File: `docs/product/open-questions.md`

```md
# Orbit Open Questions and Decision Log

**Status:** Active product/architecture questions

**Purpose:** Track unresolved decisions explicitly so they are not silently assumed in implementation.

## Rules

- Add owner, decision deadline, and impact when possible.
- When resolved, move the answer to an ADR, product requirement, or active contract.
- Do not let unresolved questions block the narrow Phase 1 build unless they directly affect scope or safety.

## Product questions

| ID | Question | Why it matters | Suggested timing |
|---|---|---|---|
| P-001 | Who is the first paying customer/persona: IT operations, service desk, enterprise app ops, support ops, or another wedge? | Determines language, demo workflow, buyer, integration priorities | Before pilot outreach |
| P-002 | What proof of value matters most: time saved, SLA compliance, error reduction, evidence/auditability, or faster onboarding? | Determines metrics and product packaging | Before pilot |
| P-003 | Will Phase 2 accept pasted SOP text only, or include document upload? | Changes ingestion scope and artifact model priority | Before Phase 2 |
| P-004 | Who owns failed runs and agent changes in a customer organization? | Determines Watchtower queues and escalation design | Before Phase 3-5 |
| P-005 | What actions are categorically prohibited from automatic execution? | Defines trust tiers and policy baseline | Before Phase 5 |

## Architecture questions

| ID | Question | Why it matters | Suggested timing |
|---|---|---|---|
| A-001 | Which Node.js and PostgreSQL versions will be supported? | Reproducible local/dev deployment | Phase 0 scaffold |
| A-002 | Drizzle or another database layer? | Migration/query conventions | Phase 0 scaffold |
| A-003 | One web app with routes or separate Studio/Watchtower apps long term? | UI deployment and shared state boundaries | Phase 1; revisit Phase 3 |
| A-004 | What job/queue technology is appropriate when durable dispatch is needed? | Worker scaling, schedules, retries | Before Phase 5 |
| A-005 | What artifact storage provider/region strategy is required for pilots? | Security, cost, retention, data residency | Before shared cloud environment |
| A-006 | When should PostgreSQL row-level security be enabled? | Tenant isolation strategy | Before multi-tenant customer data |
| A-007 | What policy engine approach: typed internal DSL, OPA/Rego, or hybrid? | Policy ownership and complexity | Before Phase 5 |

## Security questions

| ID | Question | Why it matters | Suggested timing |
|---|---|---|---|
| S-001 | What PII/data classifications may be captured in artifacts? | Redaction, retention, artifact access | Before real data |
| S-002 | Which secret manager will be used in cloud deployment? | Credential isolation and rotation | Before real credentials |
| S-003 | What browser authentication patterns are supported: service accounts, SSO, managed sessions, human handoff? | Real-world browser feasibility | Before customer target systems |
| S-004 | What tenant isolation guarantees are required for first pilot? | Database/storage/worker design | Before pilot |
| S-005 | What audit/compliance requirements apply to target customers? | Controls, retention, reporting | Before pilot |

## LLM questions

| ID | Question | Why it matters | Suggested timing |
|---|---|---|---|
| L-001 | Which LLM provider(s) are acceptable for SOP parsing? | Gateway design, data residency, pricing | Before Phase 2 |
| L-002 | What data may be included in model context? | Privacy and prompt-injection controls | Before Phase 2 |
| L-003 | What quality threshold is required before parser/decision output can be used? | Evaluation and human review design | Before Phase 2/4 |
| L-004 | Which decisions require human approval regardless of model confidence? | Trust-tier/policy design | Before Phase 4 |

## Go-to-market questions

| ID | Question | Why it matters | Suggested timing |
|---|---|---|---|
| G-001 | Is Orbit sold as software, managed automation service, or hybrid? | Onboarding, pricing, operational staffing | Before pilot |
| G-002 | What is the pricing unit: agent, run, worker time, evidence retention, or enterprise license? | Metering and packaging | Before production launch |
| G-003 | What existing alternatives are customers using: RPA, scripting, ITSM workflow, integration platform, outsourced operations? | Positioning and integration requirements | Before pilot |
```
