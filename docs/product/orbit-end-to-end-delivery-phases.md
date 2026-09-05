# Orbit End-to-End Delivery Phases

**Status:** Product delivery roadmap

**Audience:** Product owner, engineering leadership, architects, Claude Code, and future delivery teams

**Purpose:** Define the end-to-end phased plan for building Orbit from a local prototype into a production-grade platform for converting business SOPs into governed, executable, observable agents.

**Operating rule:** Each phase must deliver a usable outcome and meet its exit criteria before the next phase begins. Later phases are intentionally not authorization to build all capabilities now.

---

# 1. Product destination

Orbit turns existing business SOPs into governed, executable, observable agents.

```text
Documented SOP
  -> Understand
  -> Structure
  -> Validate
  -> Compile
  -> Test
  -> Publish
  -> Execute deterministically
  -> Observe evidence
  -> Introduce bounded AI decisions
  -> Govern
  -> Recover safely
  -> Continuously improve
```

Orbit is not merely AI browser automation. Its durable product architecture is:

```text
Natural-language / documented SOP
  -> SOP Graph: business process meaning
  -> Agent IR: typed executable workflow
  -> Runtime: controlled execution
  -> Evidence: events, artifacts, decisions, outcomes
  -> Watchtower: operational visibility and governance
```

## 1.1 Persistent principles

Every phase must preserve these principles:

1. The SOP is business source material, not a prompt that directly controls tools.
2. SOP Graph captures business intent independently of implementation technology.
3. Agent IR is typed, validated, versioned, executable, and diffable.
4. The runtime executes immutable, approved Agent Versions.
5. Deterministic execution comes before autonomous LLM action.
6. Evidence is first-class: every material action must be inspectable.
7. Technical status and business outcome are separate concepts.
8. Policies decide what is permitted; model output never authorizes itself.
9. Published behavior must not silently mutate because of a failure or model suggestion.
10. Agent authority must increase only when governance, approval, testing, and operational ownership are ready.

---

# 2. Phase overview

| Phase | Name | Primary goal | User-visible milestone |
|---|---|---|---|
| 0 | Foundation | Make development reproducible and establish durable contracts | Developers can run Orbit locally with a controlled target app |
| 1 | Deterministic Proof Loop | Prove SOP execution and evidence end to end | User triggers a read-only agent in Watchtower and sees proof of every action |
| 2 | Natural-Language SOP Understanding | Convert business-user SOP text into a reviewable structure | User writes a short SOP and reviews a proposed SOP Graph with clarification questions |
| 3 | Studio, Testing, and Publishing | Make workflows editable, testable, versioned, and publishable | Teams change and safely release agents without code edits or historical mutation |
| 4 | Bounded LLM Decisions | Add AI for explicitly modeled judgment steps | LLM outputs typed decisions that choose only approved workflow branches |
| 5 | Enterprise Triggers and Governance | Connect production systems and enforce enterprise controls | Real systems trigger governed agents using scoped credentials, policies, and approvals |
| 6 | Intelligent Recovery and Improvement | Recover from drift safely and improve governed workflows | Orbit proposes bounded recovery and suggested updates with full evidence |
| 7 | Scale, Ecosystem, and Optimization | Operate Orbit at enterprise scale and expand platform reach | Multi-team, multi-tenant deployment with insights, connectors, SLOs, and cost controls |

---

# 3. Phase 0 — Foundation

## 3.1 Objective

Create a reproducible local development environment and establish the core contracts that prevent the first implementation from becoming a dead-end script.

This phase is developer-facing. It does not need to be a polished customer experience.

## 3.2 Build scope

| Area | Deliverables |
|---|---|
| Repository | pnpm workspace monorepo, package boundaries, shared lint/type/test configuration |
| Applications | `web`, `api`, `browser-worker`, and `demo-portal` application shells |
| Local infrastructure | Docker Compose with PostgreSQL; local artifact directory; health checks |
| Domain contracts | Initial Zod/TypeScript schemas for Agent IR, run state, events, artifacts, errors, IDs |
| Demo portal | Controlled read-only service-request portal with stable test IDs and seeded data |
| Persistence baseline | Database connection, migration capability, baseline schema conventions |
| Storage boundary | Artifact storage interface with local filesystem adapter |
| Test baseline | Vitest, Playwright Test, CI pipeline, fixture conventions |
| Documentation | `CLAUDE.md`, README, active Phase 1 requirements, architecture decisions |

## 3.3 Technology stack

```text
TypeScript strict mode
pnpm workspaces
React + Vite + Tailwind CSS
Node.js + Fastify
PostgreSQL
Drizzle ORM
Zod
Playwright
Vitest
Playwright Test
Pino
Docker Compose
GitHub Actions or equivalent CI
```

## 3.4 Demo portal contract

The first controlled target application should use a service-request lookup.

```text
Route: http://localhost:3001/requests

Known request:
- Request number: SR-1001
- Status: In Progress
- Assigned team: Infrastructure Operations

Unknown request:
- SR-9999
```

Required test IDs:

```text
request-number-input
search-request-button
request-result
request-number-result
request-status
assigned-team
request-not-found
```

## 3.5 Explicitly defer

- LLM provider integration
- SOP upload and parsing
- Redis, BullMQ, Temporal, SQS, Kafka, or EventBridge
- S3/MinIO and cloud deployment
- Authentication and multi-tenancy enforcement
- External target systems and real credentials
- Workflow canvas and Studio
- Policies and approvals
- API/webhook/schedule triggers

## 3.6 Exit criteria

- A clean checkout can install dependencies and start the local environment.
- PostgreSQL migrations run successfully.
- The demo portal supports known and unknown request scenarios.
- Shared contracts compile under TypeScript strict mode.
- CI runs type checks, linting, unit tests, and demo-portal browser tests.
- The repository has current setup instructions and Claude Code instructions.

---

# 4. Phase 1 — Deterministic Proof Loop

## 4.1 Objective

Prove the smallest complete Orbit product loop:

```text
Watchtower manual trigger
  -> typed dynamic input
  -> immutable Agent Version
  -> deterministic Playwright execution
  -> structured events and evidence artifacts
  -> Watchtower run inspection
```

The goal is not “automate any website.” The goal is to demonstrate that Orbit can execute a documented procedure and prove what happened.

## 4.2 Initial business SOP

```text
Title: Find Service Request

1. Open the service request portal.
2. Search for the service request using its request number and confirm that the matching service request and current status are displayed.
```

## 4.3 User flow

1. User opens Orbit Watchtower.
2. User sees one agent: `Find Service Request`.
3. User clicks `Run Agent`.
4. Watchtower renders a form from the Agent IR input schema.
5. User enters `requestNumber`, such as `SR-1001`.
6. Backend validates the input and creates a version-pinned run.
7. Browser worker loads the Agent IR and runs Playwright against the controlled demo portal.
8. The runtime persists step status, events, screenshots, DOM snapshots, trace, outputs, and outcome.
9. Watchtower displays live or polled progress and final evidence.

## 4.4 Required dynamic input

| Field | Type | Required | Example |
|---|---|---|---|
| `requestNumber` | string | Yes | `SR-1001` |

## 4.5 Supported Agent IR actions

```text
browser.navigate
browser.fill
browser.click
browser.assert
browser.expect_one_of
browser.extract
complete
fail
```

## 4.6 Required outcomes

| Runtime status | Business outcome | Meaning |
|---|---|---|
| `succeeded` | `request_found` | Request exists and required fields were verified/extracted |
| `succeeded` | `request_not_found` | Procedure completed correctly; target record does not exist |
| `failed` | `locator_not_found`, `assertion_failed`, etc. | Technical failure with diagnostic evidence |

## 4.7 Required evidence

| Evidence | Requirement |
|---|---|
| Run record | Version-pinned Agent Version, inputs, state, timestamps, outcome |
| Step records | Per-Agent-IR-step status, output, timing, error where applicable |
| Events | Append-only structured lifecycle events |
| Screenshots | After navigation, fill, click, and final state |
| DOM snapshots | After navigation and state-changing browser action |
| Trace | Playwright trace for every run |
| Assertions | Persist pass/fail result and safe context |
| Outputs | Request status and assigned team for found case |
| Error classification | Typed technical error details for failed case |

## 4.8 Required Watchtower capability

| Screen | Minimum functionality |
|---|---|
| Agent list | Show seeded agent, version, description, and Run Agent action |
| Run form | Render typed dynamic input and validate it |
| Run detail | Show run status, business outcome, input, logical steps, action timeline, outputs, assertions, artifacts, errors |
| Artifact viewer | Display screenshots and text DOM snapshots; link/open trace artifact |

## 4.9 Security baseline

- Read-only demo workflow only.
- Localhost-only browser domain allowlist.
- No real credentials, production systems, or external websites.
- No arbitrary JavaScript or shell evaluation in Agent IR.
- No browser coordinate actions.
- Local artifact storage outside PostgreSQL.
- Secrets absent from code, IR, SOP, logs, artifacts, and events.

## 4.10 Explicitly defer

- Natural-language parsing
- SOP Graph authoring UI
- Generic browser capture
- Queues and distributed workers
- Real users, SSO, RBAC, multi-tenancy
- Policies/approvals UI
- API/webhook/schedule triggers
- LLM decisions/recovery
- Cloud deployment

## 4.11 Exit criteria

1. A user can start the agent from Watchtower.
2. Input is rendered from Agent IR schema rather than hard-coded UI.
3. `SR-1001` completes as `succeeded/request_found`.
4. `SR-9999` completes as `succeeded/request_not_found`.
5. The successful run extracts `In Progress` and `Infrastructure Operations`.
6. Every run persists events, step records, screenshots, DOM snapshots, and trace artifact metadata.
7. Watchtower reconstructs the run using persisted backend data.
8. A broken locator produces a typed failure and diagnostic evidence.
9. Automated tests cover found, not-found, and a technical failure path.
10. No out-of-scope infrastructure is required to run the demo.

---

# 5. Phase 2 — Natural-Language SOP Understanding

## 5.1 Objective

Allow business users to write a short SOP in normal language and have Orbit create a reviewable draft of the structured process.

The output is not an executable prompt. It is a proposed SOP Graph with identified ambiguity, source references, dynamic attributes, and execution gaps.

## 5.2 User flow

```text
Business user writes/pastes SOP
  -> Orbit preserves source text
  -> Orbit identifies steps, inputs, expected states, rules, and outcomes
  -> Orbit highlights ambiguity and asks clarification questions
  -> User reviews/corrects draft
  -> Orbit stores SOP Graph draft
  -> Technical user maps semantic steps to execution details
```

## 5.3 Build scope

| Capability | Description |
|---|---|
| SOP editor | Business-friendly rich/plain text editor for authored SOPs |
| SOP source versioning | Immutable source revisions with author and timestamp |
| LLM gateway | Provider abstraction, prompt/template versioning, model metadata, structured output validation |
| Parser | Extract candidate steps, inputs, outputs, expected states, decisions, and ambiguity |
| Clarification loop | Ask explicit questions instead of inventing missing execution behavior |
| SOP Graph draft | Store structured semantic process nodes/edges with source spans |
| Input attributes | Business user can define/confirm typed dynamic attributes |
| Source provenance | Link Graph nodes to SOP text spans/paragraphs |
| Review UI | User can accept, edit, reject, or reorder parser proposals |
| Manual mapping handoff | Mark what needs browser/API implementation configuration |

## 5.4 Initial SOP Graph scope

Start with:

```text
start
instruction
action
input
output
assertion
decision
exception
end
```

Defer full loops, nested graphs, parallelism, and complex reusable sub-processes until real SOPs require them.

## 5.5 LLM contract

The parser must return structured schema-valid output such as:

```yaml
name: Find Service Request
inputs:
  - key: requestNumber
    type: string
    required: true
steps:
  - id: open_portal
    type: instruction
    instruction: Open the service request portal
    expectedState:
      description: Search form is visible
    missingDetails:
      - target_application
  - id: search_request
    type: action
    instruction: Search for the service request using its request number
    inputs: [requestNumber]
    expectedState:
      description: Matching request and current status are displayed
    missingDetails:
      - request_number_field_mapping
      - no_match_behavior
```

The parser may propose. It may not directly execute browser/API actions.

## 5.6 Required clarification behavior

Orbit must identify unresolved execution-relevant items such as:

| SOP language | Required clarification |
|---|---|
| “Open the portal” | Which application, environment, and route? |
| “Search for the request” | Which field, action, and matching rule? |
| “Confirm the correct record” | What exact fields prove correctness? |
| “If it is eligible” | What rule/data determines eligibility? |
| “Notify the customer” | Which channel/template/approval policy applies? |
| “Handle exceptions” | Which exceptions and desired business outcomes? |

## 5.7 Security and quality requirements

- Treat SOP text as potentially untrusted input to the model.
- Use structured output schema validation.
- Store model/provider/version and parser prompt/template version metadata.
- Minimize/redact sensitive data passed to models.
- Display confidence and unresolved ambiguities; do not present inferred content as unquestioned fact.
- Preserve original SOP text; never overwrite it with parsed output.

## 5.8 Explicitly defer

- PDF/DOCX/OCR/video ingestion, except architecture hooks if low-cost
- Fully automated selector discovery
- Direct compilation to production execution without review
- Runtime LLM decisions
- Broad policy authoring
- General workflows with complex loops/parallelism

## 5.9 Exit criteria

1. A business user can write a 2–5 step SOP.
2. Orbit produces a schema-valid SOP Graph draft.
3. Each parsed step has a source text reference.
4. Orbit identifies missing execution details and asks reviewable clarification questions.
5. User can correct the graph and input attributes.
6. The system preserves the original SOP version and parser metadata.
7. A reviewed simple Graph can be handed to the Agent IR mapping/compiler flow.
8. Parser quality is measured using a small golden SOP fixture suite.

---

# 6. Phase 3 — Studio, Testing, Versioning, and Publishing

## 6.1 Objective

Turn Orbit from a demo runtime into a controlled agent-authoring product. Users must be able to inspect, modify, test, diff, version, and publish workflow behavior without modifying source code.

## 6.2 User flow

```text
SOP source
  -> SOP Graph draft/review
  -> generated Agent IR draft
  -> configure mappings, selectors, assertions, outcomes, and tests
  -> validate
  -> run in test environment
  -> review evidence and diff
  -> publish immutable Agent Version
  -> execute from Watchtower/approved triggers
```

## 6.3 Build scope

| Capability | Description |
|---|---|
| Orbit Studio | Dedicated authoring workspace in the existing web application |
| Source viewer | View SOP text, later documents/screenshots, alongside graph and agent mapping |
| SOP Graph editor | Edit node labels, steps, inputs, outputs, branches, rules, and expected states |
| Agent IR editor | Structured form and advanced YAML/JSON review for technical users |
| Browser mapping | Configure locator bundles, URLs, extraction fields, assertions, and capture points |
| Compiler | Generate Agent IR draft from SOP Graph; preserve source mappings |
| Validator | Detect graph/IR errors before test/publish |
| Test Lab | Run fixture inputs against a demo/staging environment |
| Versioning | Drafts, immutable versions, version history, restore/clone flow |
| Diffs | Graph, Agent IR, tests, mappings, and policies where applicable |
| Publishing | Validation gate and immutable publication workflow |
| Role groundwork | Separate editor/publisher permissions in the domain model; initial enforcement can be basic |

## 6.4 Required static validations

- Required input definitions exist.
- All referenced variables are declared and type-compatible.
- Every step is reachable from the start.
- Every branch has valid target(s).
- Every path reaches a terminal outcome or explicit loop boundary.
- Browser/API actions include allowed execution settings.
- Required assertions are configured for consequential actions.
- Required permissions, credentials, and policies are referenced where configured.
- Retry limits are bounded.
- Sensitive/unsafe unsupported actions are rejected.

## 6.5 Test Lab requirements

- Named test cases with input fixtures.
- Expected runtime status and business outcome.
- Expected extracted outputs/assertions.
- Test run evidence stored separately but using the same runtime/evidence model.
- Regression comparison across versions.
- Ability to mark test suite status as required for publishing.

## 6.6 Explicitly defer

- Full enterprise RBAC/SSO enforcement if not required by pilot
- Broad integration marketplace
- Multi-agent orchestration
- General-purpose user code steps
- High-impact financial or destructive workflows without Guard/approval maturity

## 6.7 Exit criteria

1. A user can edit a reviewed SOP Graph and Agent IR through Studio.
2. Changes produce a visible, understandable diff.
3. Test cases execute through the real runtime and produce evidence.
4. Publishing creates a new immutable Agent Version.
5. Old runs remain linked to their original version and evidence.
6. Watchtower can compare runs by agent version.
7. A workflow can be updated without source-code changes to the runtime.

---

# 7. Phase 4 — Bounded LLM Decisions

## 7.1 Objective

Add AI only where the SOP requires ambiguity resolution, classification, extraction, or judgment that is explicitly modeled and safely bounded.

This phase does **not** make Orbit an autonomous tool-using agent.

## 7.2 Appropriate use cases

| Use case | Example |
|---|---|
| Classification | Categorize support ticket as billing, access, or technical issue |
| Extraction | Extract order number and requested amount from a customer email |
| Intent determination | Determine whether a request is cancellation, refund, or address change |
| Branch selection | Select approved SOP path based on normalized facts |
| Exception recommendation | Recommend whether an exception appears justified |
| Response selection | Choose a template from an approved library |

## 7.3 Agent IR decision node

```yaml
- id: classify_request
  type: llm.decision
  input:
    subject: ${inputs.subject}
    body: ${inputs.body}
  modelRef: model_policy_classification_v1
  outputSchema:
    type: object
    required: [category, confidence, reason]
    properties:
      category:
        type: string
        enum: [billing, access, technical_issue]
      confidence:
        type: number
      reason:
        type: string
  allowedOutcomes: [billing, access, technical_issue]
  policyRef: policy_request_classification
```

## 7.4 Minimum governance required before LLM decisions

- Structured output schema validation.
- Fixed allowed outputs and corresponding Agent IR branches.
- Model/provider/version reference.
- Prompt/template version reference.
- Input data classification, minimization, and redaction.
- Model output stored as evidence subject to authorization policy.
- Policy evaluation of output before consequential action.
- Human approval for sensitive outcomes.
- Evaluation fixtures and regression tests.
- No direct LLM access to arbitrary browser, API, code, shell, or secret tools.

## 7.5 Watchtower decision evidence

For every LLM decision show, subject to permissions:

- Source SOP/Agent step.
- Structured input/context references.
- Redaction state.
- Model/provider/version.
- Prompt/template version.
- Structured output.
- Schema validation outcome.
- Policy evaluation.
- Selected branch or blocked action.
- Timing and cost metadata where permitted.

## 7.6 Explicitly defer

- Fully autonomous browser recovery.
- Model-directed arbitrary tool use.
- Automatic publication of model-suggested workflow changes.
- Unbounded open-ended reasoning as an execution primitive.

## 7.7 Exit criteria

1. An LLM decision can only return validated structured output.
2. It can only select predefined allowed branches.
3. Invalid/unsafe output is rejected and recorded.
4. The model cannot directly execute a browser/API action.
5. A golden evaluation suite measures expected behavior and known adversarial cases.
6. Watchtower explains the model decision, validation, policy result, and downstream effect.

---

# 8. Phase 5 — Enterprise Triggers and Governance

## 8.1 Objective

Connect Orbit to production business systems and introduce the controls required for real, potentially sensitive, and eventually state-changing workflows.

## 8.2 Trigger expansion

| Trigger | Capability |
|---|---|
| Manual Watchtower | Already available from Phase 1 |
| Authenticated API | Internal services create runs with typed inputs |
| Signed webhook | External systems trigger runs from events |
| Schedule | Run processes on recurring schedules with timezone rules |
| Event bus | Consume/publish events from SQS, EventBridge, Kafka/MSK, or CloudEvents-compatible systems |
| File/spreadsheet | Controlled batch processing using validated rows |
| Email | Controlled inbox-triggered workflows with extraction and policy |
| Parent workflow | Governed agent/subworkflow composition |
| Approval continuation | Resume a paused run after authorized decision |

## 8.3 Trigger requirements

All trigger types must normalize to a Run Request with:

```text
tenant/workspace identity
agent version identity
actor/system identity
trigger source metadata
validated input payload
correlation ID
idempotency key when required
source event reference
policy context
```

## 8.4 Governance scope

| Capability | Description |
|---|---|
| Authentication | OIDC/SAML or appropriate identity provider integration |
| RBAC | Roles for editor, publisher, operator, approver, auditor, security admin, etc. |
| Tenant isolation | Application authorization plus database controls where appropriate |
| Vault integration | Scoped credential references and secure runtime resolution |
| Domain/tool permissions | Restrict browser/API destinations and actions |
| Policy engine | Financial limits, data access, retry limits, model permissions, escalation rules |
| Approval lifecycle | Pause/resume workflow with immutable approval context |
| Idempotency | Prevent duplicate state-changing effects |
| Concurrency control | Prevent conflicting runs against same business entity where required |
| Audit logging | Record authoring, publication, trigger, policy, approval, credential, and artifact access events |
| Retention/PII controls | Artifact sensitivity, masking, retention, export, and deletion rules |

## 8.5 Policy examples

```text
- Browser may navigate only to allowlisted domains.
- Agent may use only bound credentials and approved tools.
- Refunds below $100 may be automatic; refunds above $100 require manager approval.
- No external email may be sent without approved template and policy check.
- PII may not be included in LLM context unless a policy permits it.
- An agent may retry a financial action at most once.
- Only a publisher role can promote an agent version.
```

## 8.6 Approval lifecycle

```text
Run reaches governed action
  -> policy evaluation returns require_approval
  -> run enters waiting_for_approval
  -> approval request captures exact context and action
  -> authorized approver approves or denies
  -> same immutable run resumes or completes blocked
  -> decision and evidence remain in Watchtower/audit log
```

## 8.7 Production deployment scope

A pragmatic initial cloud deployment can use:

| Concern | Candidate AWS direction |
|---|---|
| API and web | ECS/Fargate or equivalent managed container platform |
| Browser workers | Isolated ECS/Fargate worker tasks |
| Database | RDS/Aurora PostgreSQL |
| Artifacts | S3 |
| Queue | Redis/BullMQ, SQS, or durable execution system based on workload |
| Secrets | AWS Secrets Manager |
| Encryption | AWS KMS |
| Logs/metrics | CloudWatch plus OpenTelemetry-compatible tooling |
| IaC | Terraform or AWS CDK |

## 8.8 Explicitly defer

- Unbounded autonomous recovery
- Broad marketplace/plugin ecosystem
- Multi-region active-active unless customer requirements justify it
- Kubernetes/service mesh unless operational need justifies it

## 8.9 Exit criteria

1. An authenticated external system can trigger an agent using a typed contract.
2. Webhook/API trigger duplication cannot produce duplicate governed actions.
3. Credentials are referenced, scoped, and never exposed in workflow definitions or evidence.
4. Role and tenant boundaries are enforced for authoring, publishing, running, approving, and evidence access.
5. Policies can allow, deny, or require approval for a run step.
6. Approval pauses and resumes the same run with full evidence.
7. Production artifacts are encrypted, authorized, and retained according to policy.
8. A production deployment has operational dashboards, alerts, backups, and runbooks.

---

# 9. Phase 6 — Intelligent Recovery and Continuous Improvement

## 9.1 Objective

Enable Orbit to handle controlled execution drift and use runtime evidence to propose improvements—without permitting silent mutation of approved workflows.

## 9.2 Recovery use case

```text
Expected Agent IR action:
Click button "Refund"

Observed:
Locator not found

Captured context:
- Current screenshot
- DOM/accessibility snapshot
- URL
- Current Agent IR step
- Expected locator/action
- Recent event history
- Allowed domain and policy context

Recovery proposal:
The equivalent control appears to be "Issue Refund".

Runtime decision:
- Validate proposal structure
- Verify action/domain/tool permissions
- Apply policy
- Obtain approval if required
- Perform one bounded action if permitted
- Record recovered result

Suggested durable change:
Create a draft Agent IR/SOP mapping update for human review.
```

## 9.3 Build scope

| Capability | Description |
|---|---|
| Failure-context package | Bounded, redacted context collected on deterministic failure |
| Recovery proposal | LLM or rules engine proposes structured remediation |
| Proposal validation | Verify allowed step/action/locator format and safety constraints |
| Policy gate | Allow, deny, or require human approval |
| Bounded execution | Execute only approved recovery operation(s) within limits |
| Recovered state | Mark run as recovered with explicit original failure and action history |
| Suggested patch | Generate Graph/IR/locator update as draft only |
| Drift analytics | Group recurring failure patterns and measure recovery quality |
| Evaluation suite | Test known drift/recovery cases before broad enablement |

## 9.4 Recovery guardrails

- Recovery cannot change published SOP, Agent IR, policy, or test baseline automatically.
- Recovery cannot introduce a new domain, credential, tool type, or high-impact action.
- Recovery is bounded by maximum attempts and allowed action types.
- Every recovery proposal, policy result, approval, action, and outcome is persisted.
- A failed recovery must preserve the original evidence and classify the final failure clearly.
- High-impact actions require approval even if recovery proposal confidence is high.

## 9.5 Exit criteria

1. Orbit can capture deterministic failure context.
2. It can produce a schema-valid recovery proposal for a controlled drift fixture.
3. Policy can deny or require approval for the proposed recovery.
4. Watchtower explains expected action, observed mismatch, proposal, approval/policy result, actual recovery action, and outcome.
5. Suggested permanent fixes are drafts requiring normal test/publish workflow.
6. Recovery effectiveness and false-positive behavior are measured against an evaluation corpus.

---

# 10. Phase 7 — Scale, Ecosystem, and Optimization

## 10.1 Objective

Operate Orbit as a mature multi-team, multi-tenant enterprise platform with broad integrations, operational insights, scalable execution, and measured economics.

## 10.2 Build scope

| Area | Capabilities |
|---|---|
| Scale | Horizontal workers, queue partitioning, quotas, backpressure, capacity planning |
| Multi-tenancy | Mature tenant isolation, usage limits, tenant-admin controls, data residency options if required |
| Ecosystem | Connector SDK, API marketplace, reusable templates, governed partner integrations |
| Insights | Agent reliability, drift, process metrics, version comparisons, cost, ROI, adoption analytics |
| Search | Full-text SOP/source search and scalable evidence search |
| Compliance | Enhanced retention/legal holds, export, audit packages, data residency, customer-managed keys where needed |
| Enterprise operations | SLOs, incident response, disaster recovery, resilience testing, platform runbooks |
| Cost management | Metering, showback/chargeback, artifact lifecycle optimization, model/browsing budgets |
| Collaboration | Comments, assignments, review workflows, notifications, ownership, change requests |
| Reuse | Process templates, reusable subflows, policy libraries, test fixture libraries |

## 10.3 Scale considerations

- Separate browser workers from control-plane scaling.
- Partition queues by tenant, region, workload class, or trust tier as needed.
- Enforce per-tenant concurrency, artifact, and model budgets.
- Add distributed tracing across trigger, runtime, worker, policy, model, and artifact workflows.
- Use data lifecycle policies to control artifact storage growth.
- Extract services only when scale, isolation, or ownership makes it necessary.

## 10.4 Exit criteria

1. Multiple tenants can operate isolated agents and evidence safely.
2. Production reliability, cost, latency, and capacity metrics are measured and managed.
3. Connector and template strategy allows repeatable adoption without compromising governance.
4. Enterprise support, incident response, backup/recovery, and compliance operations are documented and practiced.
5. Platform scaling does not weaken provenance, policy, or evidence guarantees.

---

# 11. Cross-phase architecture evolution

| Concern | Phase 0–1 | Phase 2–3 | Phase 4–5 | Phase 6–7 |
|---|---|---|---|---|
| SOP source | Seeded text fixture | Authored text and basic source versioning | Document ingestion and richer source assets | Advanced source/media and knowledge integrations |
| SOP Graph | Minimal contracts/design hook | Draft/review/edit/versioned graph | Complex rules, branches, loops, reusable constructs | Process analytics and improvement feedback |
| Agent IR | Small fixed action set | Compiler, validation, tests, version/publish | API, approvals, LLM nodes, policy refs | Recovery instructions and broader execution adapters |
| Triggering | Watchtower manual | Test/manual flows | API, webhook, schedule, events | Connector ecosystem and subworkflow composition |
| Execution | Local single worker | Controlled test/staging execution | Durable queue, scoped credentials, API executor | Scaled worker pools and recovery |
| Evidence | Local screenshots/DOM/traces | Source provenance and test evidence | Access control, retention, approvals, LLM evidence | Analytics, compliance packages, drift intelligence |
| Governance | Localhost allowlist | Publish/test controls | RBAC, tenancy, Vault, policies, approvals | Trust-tier optimization and advanced governance |
| Intelligence | None | SOP parsing/clarification | Bounded decisions | Recovery/improvement |
| Deployment | Local Docker Compose | Shared dev/test environment | Cloud production deployment | Scale/resilience/compliance architecture |

---

# 12. Non-negotiable guardrails

These rules apply throughout every phase:

1. Never execute raw SOP text as tool instructions.
2. Never let an LLM directly invoke unrestricted browser/API/code/shell tools.
3. Never allow arbitrary JavaScript evaluation in user-authored workflows.
4. Never silently alter a published SOP, Agent IR, policy, selector baseline, or test because a run failed.
5. Never lose the provenance chain: source SOP -> SOP Graph -> Agent IR -> run -> evidence.
6. Never store raw secrets in SOPs, graphs, Agent IR, logs, events, screenshots, traces, or model context.
7. Never treat a successful click as proof that the business process completed; require expected-state assertions and outputs.
8. Never allow high-impact actions without the appropriate trust tier, policies, approval, idempotency, and audit controls.
9. Never treat `not_found`, `ineligible`, or `no_action_required` as generic technical failures.
10. Never overbuild microservices, distributed orchestration, or cloud complexity before the product loop justifies it.
11. Never use a polished UI as a substitute for persisted, reproducible evidence.
12. Never allow a future feature to compromise the deterministic evidence model established in Phase 1.

---

# 13. Phase gates and decision checklist

Before moving to the next phase, review the relevant gate.

## 13.1 Before Phase 2

- Does Phase 1 produce reliable events and artifacts for successful, not-found, and failed runs?
- Can a non-developer understand what occurred in Watchtower?
- Is the Agent IR actually driving execution rather than a hard-coded script?
- Are business outcomes distinct from technical failures?

## 13.2 Before Phase 3

- Can the SOP parser produce reliable Graph drafts for a representative fixture set?
- Are ambiguity and missing details surfaced rather than hallucinated?
- Does each Graph node retain source provenance?
- Is there a clear manual mapping workflow from Graph to Agent IR?

## 13.3 Before Phase 4

- Are Agent Versions immutable, diffable, testable, and publishable?
- Can users understand changes before publication?
- Are test runs using the same runtime and evidence model as production runs?
- Is there a clear owner for agent failures and workflow changes?

## 13.4 Before Phase 5

- Are LLM decision outputs schema-constrained and limited to approved branches?
- Is model input redacted/minimized and evidence retained appropriately?
- Are adversarial/prompt-injection and incorrect-output tests in place?
- Can a model decision ever bypass a policy or invoke arbitrary tools? If yes, do not advance.

## 13.5 Before Phase 6

- Are tenant boundaries, RBAC, credentials, policies, approvals, and artifact access controls in place?
- Are API/webhook triggers authenticated, authorized, idempotent, and auditable?
- Can the platform safely execute a permitted production action with an appropriate human approval path?
- Do on-call, monitoring, backups, and incident procedures exist?

## 13.6 Before Phase 7

- Is deterministic browser execution reliable enough to identify genuine drift patterns?
- Is recovery evaluated on controlled failure fixtures?
- Can recovery remain bounded and policy-controlled?
- Are suggested changes routed through normal test/review/publish controls?

---

# 14. Definition of production readiness by trust tier

Orbit should not claim universal production readiness. Readiness is evaluated per use case and trust tier.

| Trust tier | Example | Minimum production readiness |
|---|---|---|
| Tier 0: Observe | Look up service request | Read-only scoped account, evidence, isolation, input validation, monitored failure handling |
| Tier 1: Recommend | Suggest route/category | Structured model output, evaluation suite, human review, evidence |
| Tier 2: Prepare | Populate change form but do not submit | Human commit/approval, artifact redaction, least-privilege scope |
| Tier 3: Bounded execute | Update low-risk classification | Policy, idempotency, retry controls, audit, scoped credentials, rollback/compensation where possible |
| Tier 4: High-impact execute | Refund, deletion, access change | Strong approvals, segregation of duties, financial/action thresholds, immutable audit, incident controls |
| Tier 5: Recover | Substitute renamed UI control | Bounded recovery policy, rigorous evaluation, complete evidence, approval for consequential actions |

A workflow is production-ready only when its implementation, controls, operational ownership, and evidence satisfy the requirements of its trust tier.

---

# 15. Claude Code instructions

Claude must treat this document as long-term roadmap context, not a request to build all phases at once.

For implementation work:

1. Read `CLAUDE.md` first.
2. Read the active phase requirements second.
3. Use this document to understand future direction and preserve low-cost extension points.
4. Follow the active phase scope over later-phase ideas.
5. Before material changes, propose a plan with changed files, tradeoffs, tests, and acceptance criteria.
6. Wait for approval when changing public contracts, data schema, architecture boundaries, security posture, or active-phase scope.
7. Implement one bounded milestone at a time.
8. Run relevant type checks, tests, and end-to-end checks.
9. Report known limitations and intentionally deferred work.

When uncertain, build the smallest implementation that satisfies the active phase and document the extension seam rather than building future infrastructure.
