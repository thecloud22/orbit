# Orbit Product Vision and Requirements

**Document status:** Initial build brief

**Audience:** Product owner, technical architect, and Claude Code

**Purpose:** Define Orbit's product vision, architectural principles, phased roadmap, and the narrowly scoped first implementation. This document is an input to Claude Code. It is deliberately specific about Phase 1 and deliberately non-prescriptive about later implementation details.

---

## 1. Product vision

Orbit turns business SOPs into governed, executable, and observable agents.

Businesses already document how work gets done in SOPs, runbooks, playbooks, screenshots, decision trees, and operating procedures. Those documents describe valuable operational knowledge, but people must still interpret the instructions, move between systems, enter data, validate results, and record outcomes.

Orbit makes that operational knowledge executable without treating an SOP as merely an LLM prompt.

```text
Documented SOP
  -> Understand
  -> Structure
  -> Compile
  -> Execute deterministically
  -> Observe evidence
  -> Introduce bounded AI decisions
  -> Govern
  -> Recover and improve
```

Orbit's product promise is:

> Turn documented business procedures into governed agents, with proof of every run.

Orbit is not positioned as generic AI browser automation. Its differentiation is the combination of:

- Natural-language SOPs as the business source of truth
- A structured SOP Graph representing business intent
- A typed Agent IR representing executable behavior
- Deterministic execution before autonomous reasoning
- Strong evidence and run observability in Watchtower
- Versioning, testability, policies, and human approval paths
- A gradual path to bounded LLM judgment and controlled recovery

---

## 2. Core conceptual model

Orbit has four distinct layers. They must remain separate.

```text
Natural-language SOP
  -> SOP Graph
  -> Agent IR
  -> Execution evidence
```

### 2.1 Natural-language SOP

The SOP is written or supplied by a business user. It represents business intent in human-readable language.

Examples of SOP content include:

- Written instructions
- Numbered steps
- Expected outcomes
- Screenshots
- Flow diagrams
- Decision trees
- Business rules
- Examples
- Supporting documentation

The initial implementation will use pasted natural-language text. Document upload, OCR, screenshot extraction, and video parsing are later capabilities.

### 2.2 SOP Graph

The SOP Graph is a structured, versioned representation of the business process. It is independent of Playwright, selectors, browser APIs, or any specific execution technology.

The SOP Graph should eventually represent:

- Steps and instructions
- Inputs and outputs
- Dynamic attributes
- Preconditions
- Expected states
- Business rules
- Decisions and branches
- Loops
- Exceptions
- Completion criteria
- Source references
- Screenshot/reference-state associations

The SOP Graph answers:

> What does the business process mean?

### 2.3 Agent IR

The Agent Intermediate Representation is a typed, versioned, serializable executable workflow derived from the SOP Graph.

It represents implementation details such as:

- Browser navigation, fill, click, extraction, and assertions
- API actions in later phases
- Variables and typed inputs
- Conditions and branches
- Retries and error handlers
- Tool permissions and policy references
- Approval pauses
- LLM decision nodes in later phases
- Evidence capture requirements

The Agent IR answers:

> How will the approved agent execute this process?

### 2.4 Execution evidence

Orbit captures the facts of an execution run. Evidence is not debug-only output; it is a core product capability.

For each important step, Orbit should be able to show:

- Expected SOP instruction
- Source SOP step
- Expected state and assertions
- Browser actions performed
- Actual screenshot
- DOM snapshot
- URL
- Extracted structured values
- Policy and approval outcome where applicable
- Errors, retries, and timing
- Final business outcome

Execution evidence answers:

> What exactly happened, and did it satisfy the documented procedure?

---

## 3. Product components

| Component | Responsibility | Primary users | Initial phase |
|---|---|---|---|
| Orbit Watchtower | Trigger runs, inspect execution evidence, troubleshoot failures, and monitor outcomes | Operations users, supervisors, auditors | Phase 1 |
| Orbit Studio | Write/import SOPs, review SOP Graphs, configure agents, test, version, and publish | Business analysts, process owners, automation builders | Phase 2-3 |
| Orbit Graph | Structured semantic representation of business SOP intent | Internal platform capability, surfaced in Studio | Phase 2 |
| Orbit Compiler | Converts a validated SOP Graph into a draft Agent IR | Internal platform capability | Phase 2-3 |
| Orbit Agent IR | Typed executable workflow contract shared by Studio, Runtime, tests, and Watchtower | Internal platform capability | Phase 1 |
| Orbit Runtime | Creates and manages runs, state transitions, variables, events, and outcomes | Internal platform capability | Phase 1 |
| Orbit Browser | Controlled Playwright browser execution adapter | Internal platform capability | Phase 1 |
| Orbit Evidence | Collects, stores, links, redacts, and retrieves artifacts and execution evidence | Watchtower, operators, auditors | Phase 1 |
| Orbit Intelligence | LLM gateway for SOP understanding, bounded decisions, and later recovery proposals | Studio and Runtime under strict controls | Phase 2 / 4 / 6 |
| Orbit Guard | Policies, permissions, domain allowlists, thresholds, approvals, and escalation rules | Security, compliance, operations admins | Minimal Phase 1; expanded later |
| Orbit Connect | Manual triggers, APIs, webhooks, schedules, queues, and external integrations | Integration developers, enterprise architects | Manual Phase 1; expanded later |
| Orbit Vault | Agent-scoped credential and secret resolution | Security/platform admins | Stub Phase 1; production Phase 5 |
| Orbit Registry | Stores SOPs, graphs, Agent versions, tests, policies, runs, and publishing metadata | Internal platform capability | Phase 1 |
| Orbit Test Lab | Executes tests against controlled/staging targets before publishing agents | Automation builders, QA, process owners | Phase 3 |
| Orbit Recovery | Proposes bounded, governed recovery for deterministic failures and suggests reviewed updates | Operators, automation owners | Phase 6 |

---

## 4. Product principles

### 4.1 SOPs are first-class source material

Do not reduce uploaded or pasted SOPs to a prompt. Preserve source material and maintain traceability from source instruction to SOP Graph, Agent IR, and runtime evidence.

### 4.2 Structure before autonomy

Orbit must first turn business language into a structured, inspectable representation. The runtime executes approved Agent IR, not raw natural language.

### 4.3 Deterministic execution first

Phase 1 is deterministic. Playwright executes explicitly defined actions. LLMs do not choose arbitrary browser actions, navigate arbitrary websites, or directly call tools.

### 4.4 Evidence is a product feature

Every material action should be explainable through events and artifacts. Watchtower should reconstruct a run from persisted data alone.

### 4.5 Policies are independent of prompts

Policies determine what is allowed. An LLM recommendation is never itself authorization.

### 4.6 Natural language is allowed; ambiguity is surfaced

Business users should write SOPs in normal language. Orbit must ask clarification questions where execution-relevant details are missing rather than silently inventing meaning.

### 4.7 Version everything that changes behavior

SOP Graphs, Agent IR, policies, tests, and published agents need versioning. Every run references an immutable Agent Version.

### 4.8 Agents have trust tiers

Start with read-only workflows. Increase authority only after introducing the appropriate controls.

| Trust tier | Authority | Example |
|---|---|---|
| Tier 0: Observe | Read-only lookup and evidence | Find a service request |
| Tier 1: Recommend | Propose an action for human review | Recommend ticket routing |
| Tier 2: Prepare | Fill/prep work but pause before commit | Prepare an update form |
| Tier 3: Execute bounded action | Low-risk approved writes | Update a case classification |
| Tier 4: High-impact action | Money, deletion, external commitments | Issue a refund |
| Tier 5: Recover autonomously | Limited repair within explicit policy | Use approved replacement locator |

Phase 1 is Tier 0 only.

---

## 5. Process contract

A business SOP alone is often incomplete for automation. Orbit should progressively convert SOPs into a process contract.

| Contract element | Meaning |
|---|---|
| Trigger | What starts the process? |
| Inputs | What values are required, optional, typed, or sensitive? |
| Preconditions | What must be true before execution begins? |
| Authority | Which identity/account is permitted to perform work? |
| Actions | What operations may the agent perform? |
| Business rules | How are decisions and branches determined? |
| Expected state | What proves each material step worked? |
| Completion criteria | What proves the business process completed? |
| Exceptions | What alternate outcomes or errors are expected? |
| Idempotency | How are duplicate effects prevented? |
| Escalation | When must a human decide or intervene? |
| Evidence | What data must be retained to prove execution? |

Phase 1 supports only a minimal subset: manual trigger, one typed input, deterministic actions, expected states, business outcomes, and evidence.

---

## 6. Phase roadmap

| Phase | Name | Goal | User-visible outcome |
|---|---|---|---|
| 0 | Foundation | Establish reproducible local development and shared contracts | Developers can run a controlled Orbit environment locally |
| 1 | Deterministic proof loop | Prove trigger -> execution -> evidence | A user starts a read-only agent in Watchtower and inspects evidence |
| 2 | Natural-language SOP authoring | Let business users write SOPs and review structured interpretation | A user writes a short SOP and sees a draft SOP Graph plus clarification questions |
| 3 | Studio and controlled publishing | Safely edit, test, diff, version, and publish agents | Teams can manage agent versions without altering historical runs |
| 4 | Bounded LLM decisions | Add AI judgment only through typed, policy-constrained decision nodes | LLM decisions are structured, auditable, and cannot directly invoke tools |
| 5 | Enterprise triggers and governance | Connect real systems and add strong controls | APIs/webhooks/schedules, RBAC, secrets, approvals, and policy enforcement |
| 6 | Intelligent recovery | Recover from controlled UI drift and suggest reviewed improvements | Orbit proposes bounded recovery and never silently changes published agents |

### Phase ordering note

Orbit intentionally introduces bounded LLM decision nodes before broad external triggers and enterprise governance. This is acceptable only because Phase 4 requires a minimum governance baseline: schema-constrained outputs, fixed allowed outcomes, no direct model tool authority, policy checks, evidence, and human review for sensitive actions.

---

## 7. Phase 1 scope

### 7.1 Objective

Build the smallest complete vertical slice that proves Orbit can execute a documented procedure and show proof of what happened.

```text
Watchtower manual trigger
  -> typed dynamic input
  -> immutable Agent Version
  -> deterministic Playwright workflow
  -> structured events and artifacts
  -> Watchtower run detail
```

### 7.2 Initial business SOP

**Title:** Find Service Request

**Purpose:** Locate a service request and verify that its current status is displayed.

**Natural-language procedure:**

1. Open the service request portal.
2. Search for the service request using its request number and confirm that the matching service request and current status are displayed.

**Required input:**

| Key | Label | Type | Required | Example |
|---|---|---|---|---|
| `requestNumber` | Service request number | string | Yes | `SR-1001` |

**Expected output when found:**

| Output | Example |
|---|---|
| `requestNumber` | `SR-1001` |
| `requestStatus` | `In Progress` |
| `assignedTeam` | `Infrastructure Operations` |

**Business outcomes:**

- `request_found`
- `request_not_found`

`request_not_found` is a valid completed business outcome, not an unclassified technical failure.

### 7.3 Controlled demo portal

Orbit must use a local controlled target application in Phase 1. It must not automate an external website, real business system, or real customer account.

**Route:**

```text
http://localhost:3001/requests
```

**Seeded record:**

```text
Request number: SR-1001
Status: In Progress
Assigned team: Infrastructure Operations
```

**Unknown test input:**

```text
SR-9999
```

**Required stable UI locators:**

```text
data-testid="request-number-input"
data-testid="search-request-button"
data-testid="request-result"
data-testid="request-number-result"
data-testid="request-status"
data-testid="assigned-team"
data-testid="request-not-found"
```

### 7.4 Phase 1 Watchtower user flow

1. User opens Orbit Watchtower.
2. User sees the `Find Service Request` agent at version `0.1.0`.
3. User clicks `Run Agent`.
4. Watchtower renders the dynamic `requestNumber` input from the Agent IR input schema.
5. User enters `SR-1001` and starts the run.
6. Orbit validates the input and creates a version-pinned run with `status = queued`.
7. The browser worker loads the Agent IR and executes it against the local demo portal.
8. Watchtower displays queued, running, completed, business-not-found, or failed state.
9. Watchtower shows step status, browser evidence, assertions, extracted outputs, and the Playwright trace.

### 7.5 Phase 1 supported Agent IR step types

- `browser.navigate`
- `browser.fill`
- `browser.click`
- `browser.assert`
- `browser.expect_one_of`
- `browser.extract`
- `complete`
- `fail`

### 7.6 Phase 1 supported evidence

| Evidence | Requirement |
|---|---|
| Run record | Persist every trigger and outcome |
| Agent version | Persist the immutable version used for every run |
| Inputs | Persist validated inputs; create masking hooks for future sensitivity rules |
| Run events | Persist structured lifecycle events |
| Step records | Persist status and outputs for each Agent IR step |
| Screenshots | Capture after navigation, fill, click, and final state |
| DOM snapshots | Capture after navigation and state-changing click |
| Playwright trace | Capture for every run |
| Assertion results | Persist pass/fail and safe context |
| Extracted values | Persist successful output values |
| Error classification | Persist typed technical failure data |
| Business outcome | Persist independently from technical run status |

### 7.7 Phase 1 run states and outcomes

**Run status:**

```text
queued
running
succeeded
failed
cancelled
```

**Business outcome:**

```text
request_found
request_not_found
none
```

A run can have `status = succeeded` and `businessOutcome = request_not_found` because the agent completed the documented procedure correctly.

### 7.8 Phase 1 event types

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

### 7.9 Phase 1 acceptance criteria

Phase 1 is complete only when all of the following are true:

1. The documented local startup process works from a clean environment.
2. The demo portal displays the seeded `SR-1001` request.
3. Watchtower lists the `Find Service Request` agent.
4. Watchtower renders the input form from Agent IR input schema rather than a hard-coded form.
5. An invalid or empty request number cannot start a run.
6. Starting a run creates a version-pinned run record.
7. The browser worker executes a persisted Agent IR definition, not a hard-coded one-off script.
8. Input `SR-1001` completes successfully with business outcome `request_found`.
9. The successful run exposes `In Progress` and `Infrastructure Operations` as extracted outputs.
10. Input `SR-9999` completes with business outcome `request_not_found`.
11. Screenshots, DOM snapshots, and a Playwright trace exist for each run.
12. Watchtower can display run status, steps, assertion results, outputs, errors, and artifacts from persisted backend data.
13. A deliberately broken locator produces a typed technical failure with diagnostic evidence.
14. Automated tests cover the found and not-found paths.
15. No external target system, real credential, LLM runtime decision, queue, webhook, cloud service, or microservice is required.

---

## 8. Phase 1 architecture and technology decisions

### 8.1 Architecture style

Use a modular TypeScript monolith with clear package boundaries.

Initial deployable processes:

```text
Orbit Web
  - React Watchtower UI

Orbit API
  - Fastify API
  - Run creation and Watchtower query APIs
  - Agent Registry access

Orbit Browser Worker
  - Runtime interpreter
  - Playwright executor
  - Event and artifact emission

Orbit Demo Portal
  - Controlled target application
```

### 8.2 Technology stack

| Concern | Phase 1 choice |
|---|---|
| Language | TypeScript with strict mode |
| Monorepo | pnpm workspaces |
| Frontend | React, Vite, Tailwind CSS |
| Backend | Node.js, Fastify |
| Browser execution | Playwright |
| Database | PostgreSQL via Docker Compose |
| Database access | Drizzle ORM and migrations |
| Validation | Zod |
| Artifact bytes | Local filesystem behind an artifact storage interface |
| Artifact metadata | PostgreSQL |
| Runtime dispatch | In-process dispatch abstraction; not tied to HTTP lifecycle |
| Queue | No Redis/BullMQ in first implementation |
| Logging | Pino structured logs |
| Unit/integration testing | Vitest |
| Browser/E2E testing | Playwright Test |
| Local infrastructure | Docker Compose |
| Authentication | Development-only identity stub |
| LLM | None in Phase 1 |
| Cloud deployment | None in Phase 1 |

### 8.3 Data storage split

```text
PostgreSQL
  - SOP metadata
  - Agent and immutable Agent Version metadata
  - Agent IR JSON
  - Runs
  - Run steps
  - Run events
  - Artifact metadata and links
  - Safe structured outputs/errors

Artifact storage
  - Screenshots
  - DOM snapshots
  - Playwright trace ZIP files
  - Future SOP documents and source screenshots
```

### 8.4 Domain boundaries

```text
sop-graph
  - Business process semantics only

agent-ir
  - Typed executable workflow contract

compiler
  - Future SOP Graph to Agent IR conversion

runtime
  - Run and step state machine; executor-neutral orchestration

executor-playwright
  - Playwright-specific implementation of approved browser steps

artifacts
  - Artifact storage interface and metadata handling

db
  - Drizzle schema, migrations, repositories

watchtower
  - Read models, API endpoints, and React UI
```

Hard boundaries:

- SOP Graph must not import Playwright.
- Agent IR must not import Fastify, React, Drizzle, or Playwright.
- Runtime must depend on executor interfaces rather than direct UI/framework dependencies.
- The web frontend must not directly access the database.
- Playwright must not decide workflow order or business outcomes; it only executes Agent IR steps.

---

## 9. Security and safety requirements

### 9.1 Phase 1 safeguards

- The demo workflow is read-only.
- Browser navigation permits localhost only.
- No real credentials are used.
- No external websites are used.
- No arbitrary JavaScript or shell evaluation is allowed in workflow definitions.
- Dynamic values use restricted interpolation only, such as `${inputs.requestNumber}` and `${variables.requestStatus}`.
- Secrets must not be stored in SOPs, SOP Graphs, Agent IR, logs, events, screenshots, traces, or source control.
- Browser coordinates must not be used for UI actions.
- Stable semantic/test-ID locators must be used in the controlled demo portal.
- Errors must be typed and persisted; errors must not be silently swallowed.

### 9.2 Security design hooks for later phases

Even though these are not fully implemented in Phase 1, preserve extension points for:

- Tenant ownership (`tenant_id`) on principal records
- RBAC and resource authorization
- Agent-scoped credential references
- Artifact access authorization
- PII classification and redaction
- Data retention policies
- Policy evaluation and human approvals
- Audit logs for authoring, publishing, triggering, approvals, and artifact access
- Idempotency keys for write-capable triggers
- Browser worker isolation and network egress control

### 9.3 LLM safety requirements for later phases

When LLMs are introduced, they must be treated as untrusted recommendation engines.

```text
Untrusted SOP/web/email/document content
  -> LLM proposal
  -> schema validation
  -> allowed-outcome validation
  -> policy evaluation
  -> required human approval
  -> fixed Agent IR branch/action
  -> persisted evidence
```

LLMs must not directly:

- Execute arbitrary Playwright actions
- Generate/evaluate arbitrary JavaScript
- Access secrets
- Override policies
- Change a published SOP or Agent Version silently
- Navigate arbitrary domains
- Perform financial, destructive, privilege, or external-communication actions without policy and approval controls

---

## 10. Dynamic attributes and variables

Orbit must support dynamic business attributes without exposing implementation complexity to business users.

### 10.1 Attribute categories

| Category | Origin | Example |
|---|---|---|
| Input attribute | User, API, webhook, schedule, integration | `requestNumber` |
| Derived variable | Browser/API extraction or deterministic transform | `requestStatus` |
| System context | Orbit runtime | `runId`, `triggeredAt` |
| Secret | Secret manager only | API token, browser credential |

### 10.2 Initial Phase 1 behavior

- One required input: `requestNumber`
- Type: string
- UI form generated from Agent IR input schema
- Strict input validation
- Simple interpolation only: `${inputs.requestNumber}`
- Browser extraction assigned to declared variables only
- No arbitrary expressions or user-authored JavaScript

### 10.3 Future behavior

Future supported types may include:

```text
string
number
boolean
date
enum
money
object
array
attachment/reference
```

Future attribute sources may include manual forms, API requests, signed webhooks, schedules, spreadsheets, event queues, browser extraction, API extraction, and prior workflow outputs.

---

## 11. Required Phase 1 Agent IR fixture

This fixture is intentionally manually authored. It lets Orbit prove execution and evidence before building natural-language parsing and SOP-to-Agent compilation.

```yaml
schemaVersion: "0.1"
id: agent_find_service_request
version: "0.1.0"
name: Find Service Request
description: Locate a service request and verify its current status.

source:
  sopId: sop_find_service_request
  sopVersion: "0.1"

inputs:
  requestNumber:
    type: string
    required: true
    label: Service request number
    examples:
      - SR-1001

permissions:
  browser:
    allowedDomains:
      - localhost

steps:
  - id: open_request_portal
    type: browser.navigate
    sourceSopStepIds:
      - sop_step_open_portal
    url: http://localhost:3001/requests
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
    evidence:
      captureScreenshot: true

  - id: submit_request_search
    type: browser.click
    sourceSopStepIds:
      - sop_step_search_and_verify
    locator:
      strategy: test_id
      value: search-request-button
    evidence:
      captureScreenshot: true
      captureDomSnapshot: true

  - id: detect_request_result
    type: browser.expect_one_of
    sourceSopStepIds:
      - sop_step_search_and_verify
    alternatives:
      - whenVisible:
          strategy: test_id
          value: request-result
        next: verify_request
      - whenVisible:
          strategy: test_id
          value: request-not-found
        next: request_not_found

  - id: verify_request
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
    outcome: request_found
    outputs:
      requestNumber: ${inputs.requestNumber}
      requestStatus: ${variables.requestStatus}
      assignedTeam: ${variables.assignedTeam}

  - id: request_not_found
    type: complete
    outcome: request_not_found
    outputs:
      requestNumber: ${inputs.requestNumber}
```

---

## 12. Required API surface for Phase 1

### List available agent versions

```text
GET /v1/agent-versions
```

Purpose: Watchtower lists the seeded `Find Service Request` agent and its input schema.

### Create a run

```text
POST /v1/agent-versions/:agentVersionId/runs
```

Example request:

```json
{
  "trigger": {
    "type": "watchtower_manual",
    "actor": {
      "type": "development_user",
      "id": "dev-user"
    }
  },
  "inputs": {
    "requestNumber": "SR-1001"
  }
}
```

Example response:

```json
{
  "runId": "run_01J...",
  "status": "queued",
  "agentVersionId": "agentv_find_service_request_001"
}
```

### Retrieve a run

```text
GET /v1/runs/:runId
```

The response must include:

- Run status and business outcome
- Agent version identity
- Safe input/output values
- Step records
- Event timeline
- Artifact metadata/links
- Typed error details if applicable

### Optional live status endpoint

```text
GET /v1/runs/:runId/events
```

Phase 1 may use polling first. Server-Sent Events can be added after the core run detail works.

---

## 13. Repository structure

```text
orbit/
├── apps/
│   ├── web/                     # React Watchtower UI
│   ├── api/                     # Fastify API
│   ├── browser-worker/          # Runtime + Playwright worker process
│   └── demo-portal/             # Controlled service-request target app
│
├── packages/
│   ├── contracts/               # Zod schemas, IDs, events, errors
│   ├── sop-graph/               # SOP Graph types; no Playwright dependencies
│   ├── agent-ir/                # Agent IR types and validation
│   ├── runtime/                 # Executor-neutral workflow runtime
│   ├── executor-playwright/     # Playwright action implementations
│   ├── artifacts/               # Filesystem adapter and artifact interfaces
│   ├── db/                      # Drizzle schema, migrations, repositories
│   ├── policy/                  # Phase 1 domain/action allowlist checks
│   └── shared/                  # Shared utilities where necessary
│
├── docs/
│   ├── product/
│   ├── architecture/
│   ├── contracts/
│   ├── sop/
│   └── tasks/
│
├── fixtures/
│   └── find-service-request.agent.yaml
│
├── data/
│   └── artifacts/               # Local development artifacts; gitignored
│
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
├── README.md
└── CLAUDE.md
```

The actual package layout may be simplified initially, but dependencies must respect the domain boundaries described in this document.

---

## 14. Implementation sequence

Claude must not attempt to build the full roadmap at once. Implement Phase 1 in small, validated increments.

| Order | Task | Completion condition |
|---|---|---|
| 1 | Scaffold repository and local infrastructure | pnpm workspace, apps, PostgreSQL, and health checks start locally |
| 2 | Build controlled demo portal | Found and not-found paths work with stable test IDs and E2E tests |
| 3 | Implement domain contracts | Agent IR fixture parses via Zod; event/error/artifact contracts have unit tests |
| 4 | Implement persistence | Migrations, repositories, seed Agent Version, and integration tests work |
| 5 | Implement local artifact storage | Artifact bytes and metadata can be created and retrieved safely |
| 6 | Implement runtime and browser worker | Persisted Agent IR runs against demo portal with events and artifacts |
| 7 | Implement run query APIs | Watchtower can retrieve persisted run state and evidence |
| 8 | Implement Watchtower UI | User can list agent, supply input, start run, and inspect outcome/evidence |
| 9 | Implement full E2E proof and docs | One documented command demonstrates found and not-found flows |

For each task, Claude must:

1. Inspect relevant code and documentation.
2. State intended approach, files to change, assumptions, and tests.
3. Wait for approval if the task changes data contracts, architecture, or security boundaries.
4. Implement only the bounded task.
5. Run formatting, type checks, tests, and relevant E2E tests.
6. Report changed files, commands run, test results, and known limitations.

---

## 15. Explicit out-of-scope items for Phase 1

Do not implement any of the following in the initial vertical slice:

- PDF, DOCX, PowerPoint, video, or screenshot ingestion
- OCR or document understanding
- LLM SOP parsing
- Runtime LLM decision-making
- Natural-language workflow modification
- Full SOP Graph editor or visual graph canvas
- Studio UI beyond what is required to seed the agent
- General workflow marketplace
- API, webhook, schedule, email, file, or event-bus triggers
- Redis, BullMQ, Temporal, or durable distributed queue
- S3, MinIO, AWS infrastructure, Terraform, Kubernetes, or microservices
- Authentication provider, SSO, full RBAC, or multi-tenancy enforcement
- Real credentials, real target systems, MFA, CAPTCHA, or external website automation
- Browser self-healing, visual screenshot comparison, or LLM recovery
- Generic custom code steps
- Payments, refunds, account changes, messages, emails, deletions, or other state-changing business actions
- Complex policies, approval UI, or policy-as-code integration

---

## 16. Claude Code operating instructions

### 16.1 Working style

Claude should act as a senior product engineer and architect, but it must optimize for the narrow Phase 1 goal.

Before non-trivial code changes, Claude must:

1. Read `CLAUDE.md` and relevant project documentation.
2. Inspect the existing repository.
3. Propose a concise plan.
4. Identify assumptions and unresolved decisions.
5. Avoid broad refactors not requested by the task.
6. Implement only after plan approval for material changes.

### 16.2 Quality expectations

- Use TypeScript strict mode; do not introduce `any`.
- Validate contracts at API, storage, and runtime boundaries using Zod.
- Prefer discriminated unions for Agent IR steps and typed error/event payloads.
- Add tests for new behavior.
- Add migrations for database schema changes.
- Keep binary artifact bytes out of PostgreSQL.
- Do not silently swallow errors.
- Preserve causal context: Agent Version, run, step, attempt, event.
- Maintain source-SOP-to-Agent-step mapping.
- Keep comments concise and explain only non-obvious decisions.
- Update documentation when contracts or architecture change.

### 16.3 Initial prompt for Claude Code

Use the following prompt after this document and `CLAUDE.md` are present in the repository:

```text
Read CLAUDE.md and docs/product/orbit-product-vision-and-requirements.md.

We are implementing Orbit Phase 1 only.

Before writing code:
1. Inspect the repository.
2. Summarize your understanding of the Phase 1 goal, scope, and non-goals.
3. Identify missing or conflicting requirements.
4. Propose a repository structure and implementation plan with no more than nine tasks.
5. For each task, list likely files to change, tests to add, and acceptance criteria.
6. Do not create or modify implementation files until I approve the plan.

Optimize for the smallest complete vertical slice. Do not add out-of-scope capabilities.
```

---

## 17. Definition of success

Orbit Phase 1 succeeds when a non-developer can perform this demonstration locally:

```text
1. Open Orbit Watchtower.
2. Select Find Service Request.
3. Enter SR-1001.
4. Start the run.
5. Observe the run progress.
6. See that SR-1001 was found.
7. Inspect the extracted status and assigned team.
8. Inspect screenshots, DOM snapshots, assertions, events, and Playwright trace.
9. Enter SR-9999.
10. See a completed request_not_found outcome with evidence.
```

Only after this loop works should the implementation move on to natural-language SOP parsing, SOP Graph generation, Studio, LLM decision nodes, enterprise triggers, policies, approvals, or recovery.
