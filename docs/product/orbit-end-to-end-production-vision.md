# Orbit: End-to-End Production Vision

**Status:** Product and architecture vision

**Audience:** Product owner, engineering leadership, solution architects, security/compliance stakeholders, and Claude Code

**Purpose:** Describe the target production product for Orbit, the architectural principles that must remain stable as it grows, the major components and boundaries, security and operational requirements, and the phased route from the current Phase 1 vertical slice to a production-grade governed-agent platform.

**Important implementation instruction:** This document is a north-star architecture and product vision. It is **not** authorization to implement every component immediately. Claude must follow the currently approved phase scope and task plan. When a Phase 1 document conflicts with broad future vision, the Phase 1 document takes precedence for implementation.

---

# 1. Executive vision

Orbit turns existing business operating procedures into governed, executable, observable agents.

Businesses already have operational knowledge in SOPs, runbooks, policy documents, screenshots, screen recordings, workflow diagrams, ticket templates, knowledge bases, spreadsheets, and tribal process knowledge. That knowledge is usually static, inconsistently executed, difficult to audit, and expensive to maintain.

Orbit transforms that knowledge through a controlled progression:

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
  -> Introduce bounded AI judgment
  -> Govern
  -> Recover safely
  -> Continuously improve
```

Orbit is not a generic chatbot, a prompt wrapper, or merely “AI browser automation.”

Orbit is a **governed process compiler and execution platform**:

- The SOP is retained as business source material.
- The SOP Graph captures business intent independently of execution technology.
- The Agent IR is a typed executable contract.
- The runtime executes only approved Agent Versions.
- Watchtower records evidence for every material action.
- Policies, permissions, approvals, and trust tiers govern what agents may do.
- AI is introduced only in explicitly modeled, schema-constrained, policy-controlled decision and recovery nodes.

## 1.1 Product promise

> Orbit turns documented business procedures into governed agents—with proof of every run.

## 1.2 Core customer value

| Customer problem | Orbit outcome |
|---|---|
| SOPs are documents that humans interpret inconsistently | SOPs become structured, reviewable process definitions |
| Browser/API work is repetitive and error-prone | Approved agents execute deterministic workflow steps |
| Existing RPA is opaque or brittle | Each action is mapped to intent, assertions, evidence, and a versioned workflow |
| AI automation lacks trust and auditability | AI decisions are typed, bounded, policy-gated, and observable |
| Failures require log archaeology | Watchtower reconstructs runs step by step with artifacts |
| Process changes are difficult to govern | Versioning, diffs, tests, publishing, and approvals make change explicit |
| UI drift causes automations to silently break | Recovery proposals are bounded, recorded, and never silently mutate published logic |

---

# 2. Stable conceptual architecture

Orbit must preserve four separate layers. This separation is a foundational product and architecture decision.

```text
Natural-language / documented SOP
              |
              v
SOP Graph: business process semantics
              |
              v
Agent IR: typed executable implementation
              |
              v
Runtime execution: observed actions and state transitions
              |
              v
Evidence: events, artifacts, decisions, and outcomes
```

## 2.1 Natural-language and documented SOP

The SOP is the business-facing source of truth. It may be entered as natural language, imported from existing documents, or assembled from templates.

Possible source content:

- Narrative instructions
- Numbered steps
- Screenshots and annotated images
- PDFs, DOCX, PowerPoint, HTML, Markdown
- Screen recordings and extracted key frames
- Flow diagrams and decision trees
- Business rules and policy documents
- Examples and expected outcomes
- Supporting documents and linked knowledge

Orbit preserves the original source and captures provenance for the structured representation derived from it.

## 2.2 SOP Graph

The SOP Graph represents the meaning of a business process independently from browser selectors, API endpoints, model prompts, or implementation details.

The SOP Graph answers:

> What does the business intend this process to accomplish?

It must support:

- Process metadata and ownership
- Inputs, outputs, variables, and data classifications
- Preconditions
- Instructions and business actions
- Expected states and completion criteria
- Business rules
- Decisions, branches, loops, and exceptions
- Human intervention and escalation points
- Source references to documents, paragraphs, pages, screenshots, diagrams, or recordings
- Reference screenshots and expected-state bindings
- Confidence, ambiguity, and clarification records

SOP Graph nodes are semantic business-process nodes, such as:

```text
start
instruction
action
input
output
assertion
decision
loop
rule
exception
approval
human_task
end
```

SOP Graph must not contain:

- Playwright code
- CSS selectors
- XPath
- Browser page handles
- Credential values
- Raw LLM prompt text as execution logic
- Environment-specific URLs except through controlled references where appropriate

## 2.3 Agent IR

Agent IR is a typed, versioned, serializable, diffable execution plan produced from a reviewed SOP Graph and execution configuration.

The Agent IR answers:

> How does an approved agent execute this process safely and observably?

Agent IR must support:

- Agent identity, version, lifecycle state, and provenance
- Mapping from execution steps to source SOP Graph nodes
- Trigger and typed input schema
- Variables and output schema
- Browser and API actions
- Deterministic transforms and conditions
- Loops and bounded retries
- Assertions and expected state checks
- Error handlers and business outcomes
- Tool/domain/credential permission references
- Policy and approval references
- Artifact capture directives
- Explicit LLM decision nodes in later phases
- Explicit recovery envelopes in later phases

Agent IR must be:

- Validated before test or publication
- Executable without an LLM at runtime for deterministic steps
- Immutable once published
- Referenced by every production run
- Renderable as a workflow in Studio
- Diffable between versions
- Testable against controlled environments

## 2.4 Runtime and evidence

The runtime interprets an immutable Agent Version and produces an append-only record of what occurred.

Evidence answers:

> What did the agent do, why did it do it, what did it observe, and did it achieve the intended business outcome?

Evidence includes:

- Run and step lifecycle events
- Input/output snapshots subject to masking policy
- Browser screenshots and DOM/accessibility snapshots
- Browser traces and selected network evidence
- API request/response evidence subject to redaction policy
- Assertions and extracted values
- Policy evaluation results
- Human approvals and denials
- LLM input context, model metadata, structured output, validation, and policy outcome where applicable
- Errors, retries, recovery attempts, timing, and final outcomes

---

# 3. Product surface and components

Orbit is a unified product with named capabilities. These may begin as modules in a modular monolith and later be extracted only when scale, isolation, ownership, or release cadence requires it.

| Component | Product responsibility | Primary users | Initial introduction |
|---|---|---|---|
| **Orbit Studio** | Create/import SOPs, inspect sources, review SOP Graphs, configure Agent IR, test, diff, version, publish | Process owners, business analysts, automation builders, QA | Phase 2-3 |
| **Orbit Watchtower** | Trigger runs, observe progress, inspect evidence, manage exceptions, approvals, and recovered runs | Operations users, supervisors, auditors, support teams | Phase 1 |
| **Orbit Graph** | Semantic representation and lifecycle of SOP Graphs | Platform capability; surfaced in Studio | Phase 2 |
| **Orbit Compiler** | Generate/validate Agent IR drafts from SOP Graphs and mappings | Platform capability; Studio users review output | Phase 2-3 |
| **Orbit Agent Registry** | Store agents, immutable versions, tests, publication state, provenance, and dependencies | Studio, Runtime, Watchtower | Phase 1 onward |
| **Orbit Runtime** | Orchestrate runs, state transitions, variables, retries, pauses, events, and terminal outcomes | Platform capability | Phase 1 |
| **Orbit Browser** | Execute browser actions through isolated Playwright workers | Platform capability | Phase 1 |
| **Orbit API Executor** | Execute approved API actions with typed request/response contracts | Platform capability | Later Phase 3-5 |
| **Orbit Evidence** | Collect, redact, store, index, retain, and authorize artifacts and evidence | Watchtower, compliance, operators | Phase 1 |
| **Orbit Intelligence** | LLM gateway for SOP understanding, clarification, bounded decisions, evaluations, and recovery proposals | Studio and runtime under guardrails | Phase 2 / 4 / 6 |
| **Orbit Guard** | Policy evaluation, authorization, approval gates, thresholds, tool permissions, escalation rules | Security, compliance, operations admins | Minimal Phase 1; expanded Phase 5 |
| **Orbit Connect** | Trigger and integration framework: manual UI, API, webhook, schedule, event bus, files, email, SaaS | Integration engineers, enterprise architects | Manual Phase 1; expanded Phase 5 |
| **Orbit Vault** | Credential/secret bindings and scoped runtime resolution | Security/platform admins | Stub Phase 1; production Phase 5 |
| **Orbit Test Lab** | Test cases, fixtures, staging execution, golden evidence, regression testing, evaluation suites | Automation builders, QA, process owners | Phase 3 |
| **Orbit Recovery** | Failure analysis, bounded repair proposals, recovery controls, suggested SOP/IR patches | Operators and automation owners | Phase 6 |
| **Orbit Insights** | Agent health, drift, reliability, costs, adoption, and process-performance analytics | Product owners, ops leaders, platform admins | Later |

## 3.1 Product interactions

```text
                         +-------------------+
                         |    Orbit Studio    |
                         | SOPs / Graphs /    |
                         | Agents / Tests     |
                         +---------+---------+
                                   |
                                   v
                         +-------------------+
                         | Orbit Compiler /   |
                         | Agent Registry     |
                         +---------+---------+
                                   |
        +--------------------------+--------------------------+
        |                          |                          |
        v                          v                          v
+---------------+        +-------------------+       +-------------------+
| Orbit Connect |------->|   Orbit Runtime   |<----->|   Orbit Guard     |
| triggers      |        | runs / steps      |       | policies/approval |
+---------------+        +---------+---------+       +-------------------+
                                   |
          +------------------------+------------------------+
          |                        |                        |
          v                        v                        v
+-------------------+   +-------------------+    +---------------------+
| Orbit Browser     |   | Orbit API Executor|    | Orbit Intelligence  |
| Playwright        |   | approved APIs     |    | bounded decisions   |
+---------+---------+   +-------------------+    +---------------------+
          |
          v
+-------------------+
| Orbit Evidence    |
| events/artifacts  |
+---------+---------+
          |
          v
+-------------------+
| Orbit Watchtower  |
| trigger/inspect   |
+-------------------+
```

---

# 4. Personas and operating model

Orbit is not only a builder tool. It has distinct users with different permissions and responsibilities.

| Persona | Primary goals | Typical permissions |
|---|---|---|
| Process owner | Document process intent, verify business rules, approve process changes | Create/edit SOP drafts, review Graphs, request publication |
| Automation builder | Map business steps to browser/API actions, configure assertions, create tests | Edit Agent IR drafts, locator mappings, test configurations |
| Publisher | Promote tested version into production | Publish approved Agent Versions |
| Operator | Trigger runs, observe status, resolve routine exceptions | Run agents, view allowed evidence, rerun permitted workflows |
| Approver | Approve/deny policy-gated actions | View approval context, decide, comment |
| Auditor | Verify what happened and why | Read-only access to retained evidence and audit history |
| Security admin | Control credentials, permissions, policies, data access | Manage Vault bindings, roles, policies, artifact access |
| Integration engineer | Connect source systems and triggers | Configure APIs, webhooks, schedules, event mappings |
| Platform admin | Operate Orbit infrastructure and reliability | Manage tenancy, workers, limits, retention, platform health |

Every production workflow needs explicit operational ownership:

- Who owns the SOP?
- Who owns the Agent Version?
- Who handles failed runs?
- Who approves high-impact actions?
- Who is permitted to change selectors, policies, or credentials?
- What is the escalation SLA?

---

# 5. End-to-end lifecycle

## 5.1 Authoring and ingestion lifecycle

```text
Create/import SOP
  -> preserve immutable source
  -> extract text/assets/provenance
  -> parse and identify candidate structure
  -> generate SOP Graph draft
  -> surface ambiguity and clarification questions
  -> human review and correction
  -> approve SOP Graph version
```

### Source ingestion requirements

Orbit should eventually support:

- Direct text entry
- PDF/DOCX/PPTX upload
- Markdown/HTML import
- Knowledge-base import
- Linked support-document references
- Images and embedded screenshots
- Screen recording metadata/keyframe processing later

For each source, Orbit stores:

- Immutable original artifact and checksum
- Extracted text with source location references
- Rendered pages/slides when applicable
- Extracted images/screenshots
- OCR output and confidence where applicable
- Parser/model/version metadata
- Associations between source sections/assets and SOP Graph nodes

## 5.2 Agent design lifecycle

```text
Approved SOP Graph
  -> compiler generates Agent IR draft
  -> browser/API mappings configured
  -> assertions, expected states, outcomes, policies configured
  -> static validation
  -> test execution in controlled environment
  -> review diffs and evidence
  -> publish immutable Agent Version
```

### Required validation before publishing

- Schema validity
- Reachability from start node
- Defined terminal outcomes
- No orphan steps or unresolved references
- Variable declaration and type compatibility
- Input schema completeness
- Branch completeness
- Retry bounds
- Required policy references for sensitive actions
- Tool and domain allowlist compatibility
- Credential binding presence where required
- Test status and required approvals
- No unsupported step types for target runtime

## 5.3 Trigger and execution lifecycle

```text
Trigger received
  -> authenticate and authorize trigger source
  -> validate typed inputs
  -> deduplicate/idempotency check where required
  -> resolve immutable Agent Version
  -> policy/permission preflight
  -> create version-pinned Run
  -> enqueue/schedule work
  -> worker executes steps
  -> emit events and collect artifacts continuously
  -> evaluate assertions, policies, and approvals
  -> complete, pause, fail, or recover under policy
  -> publish Watchtower projections and notifications
```

### Trigger sources

| Trigger source | Example | Maturity |
|---|---|---|
| Manual Watchtower trigger | Operator enters dynamic inputs and starts a run | Phase 1 |
| API trigger | CRM or internal service invokes an agent | Phase 5 |
| Signed webhook | Ticket creation/event starts a run | Phase 5 |
| Schedule | Daily reconciliation workflow | Phase 5 |
| Event bus | EventBridge, SQS, Kafka, MSK, or CloudEvents source | Phase 5+ |
| File/spreadsheet | One run per validated row | Later |
| Email | Inbound mailbox event and extraction | Later |
| Parent workflow/subworkflow | One agent calls a governed child workflow | Later |
| Approval continuation | Approved paused run resumes | Phase 5 |

All trigger sources normalize to a common Run Request contract containing:

- Tenant/workspace identity
- Target immutable Agent Version
- Trigger metadata and actor identity
- Typed input values
- Correlation ID
- Idempotency key where applicable
- Source event reference/original event artifact subject to retention policy

## 5.4 Evidence lifecycle

```text
Expected SOP intent
  + expected state/assertions
  + policy/approval requirements
              |
              v
Observed action/state/evidence
              |
              v
Artifact storage + metadata indexing
              |
              v
Watchtower run timeline and step drill-down
              |
              v
Audit, troubleshooting, evaluation, and improvement
```

---

# 6. Watchtower production vision

Watchtower is Orbit's operational control plane and agent flight recorder.

## 6.1 Initial Phase 1 responsibilities

- List agents
- Start a manual run
- Supply typed dynamic inputs
- Show run status and progress
- Display step outcomes, screenshots, DOM snapshots, trace, outputs, and errors

## 6.2 Production Watchtower capabilities

| View | Function |
|---|---|
| Agent catalog | View agents, versions, ownership, status, and health |
| Run list | Filter by agent, version, status, outcome, policy result, date, operator, tenant, or correlation ID |
| Live run detail | Follow step-by-step execution in real time |
| Evidence comparison | Compare SOP expectation/reference state to observed runtime evidence |
| Step detail | Inspect action, locator/tool call, assertions, artifacts, timing, retries, errors, and source mapping |
| Trace/artifact viewer | View screenshots, DOM/accessibility snapshots, browser traces, structured outputs, reports, and sanitized API artifacts |
| Exception queue | Triage failed, blocked, approval-waiting, or recovered runs |
| Approval inbox | Review policy-gated actions and context |
| LLM decision view | Inspect structured input, model metadata, output, policy evaluation, branch, and final action |
| Recovery review | Inspect expected vs observed state, proposal, policy/approval result, action, and suggested update |
| Agent health | Monitor success rate, failure taxonomy, drift patterns, runtime cost, latency, and version comparisons |
| Audit view | Search authoring, publishing, policy, credential-binding, approval, trigger, and artifact-access history |

## 6.3 Step-level evidence model

For each material step, Watchtower should render two related views:

| Expected | Observed |
|---|---|
| SOP instruction and source reference | Actual action/tool invocation |
| Reference screenshot where available | Actual screenshot |
| Expected state and assertions | Assertion results |
| Business rule/policy expectation | Policy evaluation |
| Completion criteria | Extracted values and terminal outcome |
| Source SOP Graph node | Agent IR step/version |
| Approved action | Retry, error, recovery, or human intervention history |

---

# 7. Studio production vision

Studio is Orbit's authoring, review, testing, and publishing environment.

## 7.1 Main Studio workspaces

| Workspace | Purpose |
|---|---|
| SOP Source | View original source, pages, screenshots, extracted text, provenance, and parser findings |
| SOP Understanding | Review draft Graph, ambiguity, clarification questions, business rules, and source mappings |
| Agent Builder | Review generated Agent IR, configure browser/API mappings, locators, assertions, outcomes, and permissions |
| Visual Workflow | Render SOP Graph and Agent IR with source-to-execution traceability |
| Test Lab | Define inputs, fixtures, expected outcomes, run tests, compare evidence, and manage regressions |
| Change Review | Diff SOP Graph, Agent IR, policies, and tests; support undo/restore and approvals |
| Publish | Validate and promote immutable versions |
| Policy Configuration | Configure allowed actions, domains, thresholds, role requirements, and approval obligations |

## 7.2 Natural-language editing

A business user may request:

> After checking eligibility, add a step that verifies the refund amount is less than $500.

Orbit must not append this to an LLM prompt. It should:

1. Interpret the request as a structured patch proposal.
2. Show before/after SOP Graph changes.
3. Show resulting Agent IR changes.
4. Identify new inputs, variables, policies, tests, and mappings required.
5. Validate the draft.
6. Require review and publishing before production behavior changes.

---

# 8. Agent IR production design

## 8.1 Top-level properties

A production Agent IR should contain:

```text
schemaVersion
agent identity
agent version
lifecycle status
source SOP Graph/version/provenance
trigger definitions
input schema
variable declarations
output schema
permissions and credential references
policy references
steps and control flow
error/retry configuration
artifact/evidence directives
test references
metadata and ownership
```

## 8.2 Supported step families

| Family | Examples |
|---|---|
| Browser | navigate, click, fill, select, upload, download, wait, extract, assert |
| API | typed request, response validation, extraction, pagination |
| Data | deterministic transform, map, filter, template, validation |
| Control flow | condition, switch, loop, parallel/fan-out where governed, subworkflow |
| Governance | policy check, approval request, escalation, human task |
| Intelligence | LLM decision with strict schema and allowed outcomes |
| Evidence | screenshot, DOM snapshot, trace, report, artifact capture |
| Resilience | retry, timeout, error handler, fallback, controlled recovery |
| Completion | complete with typed business outcome, fail with classified error |

## 8.3 Expression and interpolation rules

Orbit must not allow arbitrary code execution inside Agent IR.

Use a restricted, typed expression language for:

- `${inputs.customerEmail}`
- `${variables.orderId}`
- Equality and basic comparisons
- Null checks
- Boolean logic
- Simple deterministic formatting/transforms

Complex transformations should be implemented through approved typed operations or service adapters, not arbitrary user-provided JavaScript.

## 8.4 Versioning model

```text
SOP Document Version
  -> SOP Graph Version
    -> Agent Draft
      -> Agent Version
        -> Published Agent Version
          -> Run
            -> Step Attempts and Artifacts
```

Rules:

- Published Agent Versions are immutable.
- Every run references one exact Agent Version.
- Historical evidence must never be reinterpreted through a newer version.
- Drafts can be edited; publication creates a new immutable version.
- Diffs are first-class between Graph, IR, policy, and test versions.

---

# 9. Browser execution production vision

Playwright is the first execution adapter, not the product's workflow model.

## 9.1 Worker lifecycle

```text
Durable job acquired
  -> load immutable Agent Version
  -> validate runtime inputs
  -> preflight policy and permissions
  -> acquire scoped credentials/session
  -> create isolated browser context
  -> execute Agent IR steps
  -> emit events and persist artifacts continuously
  -> resolve policy/approval pauses
  -> finalize trace and artifacts
  -> commit terminal state
  -> release resources
```

## 9.2 Browser isolation and controls

Production browser workers must support:

- One isolated browser context per run by default
- Tenant/workspace isolation
- Ephemeral profiles unless an approved managed session is required
- Domain and network egress allowlists
- Per-run resource limits and timeouts
- Controlled file download/upload handling
- Popup/new-tab handling
- Sanitized network evidence
- Credential broker integration
- No unrestricted access to cloud metadata endpoints or internal networks
- Worker/container hardening and sandboxing
- Concurrency quotas and backpressure

## 9.3 Locator strategy

Prefer locator approaches in this order:

1. Product-owned `data-testid` / automation IDs
2. Accessible role and accessible name
3. Form label
4. Stable semantic attributes
5. Narrow CSS selector
6. XPath only as a last resort

Represent locators as explicit strategy bundles, not opaque strings:

```yaml
locator:
  primary:
    strategy: role
    role: button
    name: Refund
  fallbacks:
    - strategy: test_id
      value: issue-refund-button
  strict: true
```

## 9.4 UI drift and recovery

Deterministic failure comes first. Recovery is later and must be bounded.

```text
Expected action: click "Refund"
Observed: locator not found
Captured: screenshot, DOM, URL, expected locator, recent history
LLM proposal: button "Issue Refund" appears equivalent
Policy evaluation: allowed or approval required
Controlled action: one approved recovery attempt
Evidence: recorded as recovered
Suggested update: draft patch; no automatic published-agent mutation
```

---

# 10. LLM and intelligence production vision

Orbit uses LLMs for understanding and bounded reasoning, not unrestricted autonomous tool control.

## 10.1 LLM use cases by maturity

| Use case | Phase | Model authority |
|---|---|---|
| SOP parsing and step extraction | Phase 2 | Propose SOP Graph structure and clarification questions |
| Natural-language agent modifications | Phase 3+ | Propose structured Graph/IR patch |
| Classification/extraction/branch choice | Phase 4 | Return schema-valid decision within fixed allowed outcomes |
| Exception recommendation | Phase 4+ | Recommend path; policy/human controls decide action |
| UI drift recovery proposal | Phase 6 | Propose bounded replacement action |
| Continuous process improvement | Phase 6+ | Suggest revisions; humans publish changes |

## 10.2 LLM gateway requirements

Orbit Intelligence must provide:

- Provider abstraction
- Model/version selection controls
- Prompt/template versioning
- Structured output schema validation
- Input minimization and redaction
- Data classification controls
- Token/cost/latency tracking where appropriate
- Retry/fallback behavior with clear evidence
- Evaluation harnesses and golden datasets
- Audit metadata retention under policy
- No direct possession of credentials or unrestricted browser/API permissions

## 10.3 Decision node contract

An LLM decision node must include:

- Explicit typed input context
- Explicit output schema
- Allowed enumerated outcomes or bounded numeric ranges
- Model/provider configuration reference
- Policy reference
- Confidence/uncertainty handling
- Human approval obligation where needed
- Traceable link to source SOP rule or ambiguity

Example:

```yaml
- id: classify_request
  type: llm.decision
  input:
    subject: ${inputs.subject}
    body: ${inputs.body}
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

The model output is not a tool call. Runtime maps validated output to fixed Agent IR branches.

## 10.4 Prompt-injection boundary

Treat SOPs, webpages, emails, attachments, tickets, external payloads, and retrieved content as potentially untrusted.

Required pattern:

```text
Untrusted content
  -> bounded model context
  -> schema-constrained proposal
  -> validation
  -> policy evaluation
  -> fixed approved branch/action
  -> evidence
```

Never allow untrusted text to directly:

- Define tool authority
- Bypass policies
- Invoke arbitrary browser/API actions
- Access secrets
- Alter published Agent Versions

---

# 11. Governance, policy, and approvals

Orbit Guard separates what a user, workflow, or LLM proposes from what the business allows.

## 11.1 Policy categories

| Policy category | Examples |
|---|---|
| Tool permissions | Browser only, approved APIs only, no file upload |
| Domain permissions | Allow only approved internal domains |
| Credential permissions | Which Agent Version may use which scoped secret |
| Financial thresholds | Automatic refund up to $100; manager approval above $100 |
| Action restrictions | No deletion, no privilege changes, no external email without approval |
| Data access | Restrict PII/regulated data access by role and agent |
| Retry limits | Maximum retries for safe/read-only vs write operations |
| Concurrency | One run per customer/order/case at a time |
| Escalation | Route exceptions to named role/team after timeout |
| Model usage | Which model may be used for which decision/data class |
| Retention | How long artifacts and run evidence are retained |

## 11.2 Policy decision contract

```yaml
input:
  tenantId: tenant_123
  agentVersionId: agentv_123
  stepId: issue_refund
  action:
    type: browser.click
    semanticAction: issue_refund
  context:
    refundAmount: 650
    actorRole: operations_agent

output:
  decision: require_approval
  reasons:
    - Refund amount exceeds automatic threshold.
  obligations:
    - type: approval
      approverRole: refund_manager
      expiresInMinutes: 30
```

## 11.3 Approval lifecycle

```text
Run reaches governed step
  -> policy requires approval
  -> run transitions to waiting_for_approval
  -> immutable approval request and evidence created
  -> authorized user approves or denies
  -> same run resumes or terminates
  -> approval decision appears in Watchtower and audit log
```

Approvals must bind to the exact run, step, policy context, and action parameters. A changed action requires a new approval.

---

# 12. Security and privacy production vision

Orbit will execute sensitive business processes. Security is a first-class architectural concern.

## 12.1 Tenancy and authorization

- Every tenant-scoped record carries tenant/workspace ownership.
- Enforce authorization in the application and, where practical, with database row-level security.
- Support roles such as tenant admin, SOP editor, agent editor, publisher, operator, approver, auditor, security admin, integration developer, and platform admin.
- Apply resource-level authorization for sensitive agents, credentials, and artifacts.
- Audit authoring, publishing, triggering, approvals, policy changes, credential bindings, and artifact access.

## 12.2 Secrets and credentials

- SOPs and Agent IR contain secret references, never secret values.
- Runtime resolves short-lived, scoped secrets from Orbit Vault or external secret manager.
- Credentials are tenant-scoped and Agent Version/tool-binding-scoped.
- Never display secrets in Studio, Watchtower, logs, events, traces, screenshots, DOM snapshots, or LLM contexts.
- Prefer least-privilege service accounts over personal employee credentials.
- Support rotation, revocation, audit, and access-boundary enforcement.

## 12.3 Data protection and artifacts

- Encrypt in transit and at rest.
- Use object storage for large artifacts and PostgreSQL for metadata/indexing.
- Maintain artifact sensitivity labels and access-control checks.
- Redact known secrets and configured PII from logs, browser evidence, API artifacts, and model contexts where feasible.
- Use short-lived, authorized access URLs for artifacts.
- Support tenant-configurable retention, legal hold, deletion, and export policies.
- Record artifact access for high-sensitivity deployments.

## 12.4 Browser security

- Isolated browser contexts and tenant separation.
- Domain allowlists plus network egress controls.
- Prevent SSRF-like access to metadata services, private internal networks, and arbitrary addresses.
- Disable/restrict file system, clipboard, downloads, uploads, and browser capabilities unless explicitly permitted.
- Harden worker containers and enforce CPU/memory/time limits.
- Treat browser storage state, cookies, and traces as sensitive credential-adjacent artifacts.

## 12.5 AI security

- Minimize/redact model context.
- Validate all structured outputs.
- Require policy checks before action.
- Defend against prompt injection and unsafe tool suggestion.
- Keep LLMs away from raw secrets and unrestricted tools.
- Evaluate model behavior with adversarial and domain-specific test fixtures.

---

# 13. Data and artifact model

## 13.1 Core hierarchy

```text
Tenant
  -> SOP Document
    -> SOP Document Version
      -> SOP Graph
        -> SOP Graph Version
          -> Agent
            -> Agent Version
              -> Test Run / Production Run
                -> Run Step
                  -> Run Step Attempt
                    -> Events and Artifacts
```

## 13.2 Artifact types

| Artifact type | Example |
|---|---|
| SOP source | Original PDF, DOCX, HTML, Markdown, recording |
| SOP page render | Rendered page or slide image |
| SOP reference screenshot | Screenshot associated with source step |
| Browser screenshot | Before/after action capture |
| Browser trace | Playwright trace archive |
| DOM/accessibility snapshot | Sanitized HTML or accessibility tree |
| Network artifact | Sanitized selected HTTP/HAR evidence |
| Extracted JSON | Structured values extracted from UI/API |
| API evidence | Redacted request/response artifact |
| LLM decision | Model context reference, structured output, validation data |
| Policy evaluation | Input, decision, obligations, policy version |
| Approval record | Decision, identity, comment, time |
| Error report | Classified failure, stack/context, remediation details |
| Generated report | Completion report or downstream deliverable |

## 13.3 Artifact metadata requirements

Every artifact must have:

- Opaque ID
- Tenant/workspace ownership
- Type/kind
- Content type and size
- Storage key/URI
- Checksum/content hash
- Encryption/sensitivity metadata
- Creation time
- Retention policy reference
- Links to relevant SOP, Agent Version, run, step, attempt, event, or approval
- Authorization requirements

---

# 14. Event model and observability

Orbit uses structured append-only events for execution reconstruction, operations, and audit.

## 14.1 Event envelope

```json
{
  "id": "evt_01J...",
  "schemaVersion": "1.0",
  "tenantId": "tenant_01J...",
  "runId": "run_01J...",
  "runStepId": "rstep_01J...",
  "attemptId": "attempt_01J...",
  "agentVersionId": "agentv_01J...",
  "agentStepId": "search_request",
  "eventType": "browser.fill.completed",
  "occurredAt": "2026-09-04T20:00:00Z",
  "sequence": 42,
  "correlationId": "corr_01J...",
  "causationId": "evt_01J...",
  "payload": {},
  "artifactRefs": [],
  "redactionVersion": "1.0"
}
```

## 14.2 Event families

```text
run.queued
run.started
run.completed
run.failed
run.cancelled
run.paused
run.resumed

step.queued
step.started
step.completed
step.failed
step.skipped
step.retry_scheduled

browser.session.started
browser.navigation.started
browser.navigation.completed
browser.fill.started
browser.fill.completed
browser.click.started
browser.click.completed
browser.extract.completed
browser.screenshot.captured
browser.dom_snapshot.captured
browser.trace.captured

api.request.started
api.request.completed

assertion.started
assertion.passed
assertion.failed

policy.evaluated
approval.requested
approval.granted
approval.denied

llm.decision.requested
llm.decision.completed
llm.decision.rejected

recovery.proposed
recovery.approved
recovery.executed
recovery.failed

artifact.created
artifact.linked
```

## 14.3 Error taxonomy

At minimum, classify failures as:

```text
VALIDATION_ERROR
INPUT_ERROR
CREDENTIAL_ERROR
AUTHENTICATION_EXPIRED
POLICY_DENIED
APPROVAL_DENIED
BROWSER_TIMEOUT
LOCATOR_NOT_FOUND
ASSERTION_FAILED
NAVIGATION_FAILED
NETWORK_ERROR
RATE_LIMITED
UNEXPECTED_UI_STATE
API_ERROR
IDEMPOTENCY_CONFLICT
WORKER_FAILURE
INTERNAL_ERROR
```

Technical failure must remain distinct from business outcomes such as `request_not_found`, `ineligible`, or `no_action_required`.

---

# 15. Database and storage production vision

## 15.1 Authoritative storage roles

| Storage | Purpose |
|---|---|
| PostgreSQL | Metadata, versioning, run state, events, policies, approvals, indexes, audit records |
| Object storage | Large immutable artifacts such as documents, screenshots, traces, DOM snapshots, reports |
| Redis or durable queue | Job dispatch, worker coordination, delayed/retry work, rate limiting as needed |
| Search/analytics later | Full-text document search, log/event analytics, large-scale reporting if PostgreSQL no longer suffices |

## 15.2 Core relational entities

```text
tenants
users
roles
memberships

audit_log

sop_documents
sop_document_versions
sop_document_pages
sop_source_spans
sop_assets

sop_graphs
sop_graph_versions
sop_graph_nodes
sop_graph_edges
sop_graph_asset_bindings

agents
agent_versions
agent_step_definitions
agent_source_mappings
agent_tests
agent_test_runs

policies
policy_versions
policy_evaluations
approval_requests
approval_decisions

credentials
credential_bindings
secret_references

triggers
trigger_versions
trigger_deliveries

runs
run_steps
run_step_attempts
run_events
artifacts
artifact_links

worker_jobs
worker_leases
```

## 15.3 Versioning requirements

- Treat published product behavior as immutable.
- Preserve source-to-Graph-to-IR provenance.
- Snapshot relevant policy versions and permission configurations for each run.
- Preserve historical evidence even if current SOP/Agent/Policy versions later change.
- Support draft, review, published, deprecated, and archived lifecycle states as product maturity requires.

---

# 16. Integration vision

Orbit must become an enterprise-friendly participant in existing systems rather than an isolated browser tool.

## 16.1 Input and trigger integrations

- REST API with typed contracts and idempotency
- Signed webhooks
- Scheduled triggers with timezone/business-calendar controls
- Cloud event/event-bus connectors
- Queue integrations such as SQS, Kafka/MSK, EventBridge, or similar
- SaaS connectors for ticketing, CRM, ERP, collaboration, and file storage
- Spreadsheet/file ingestion where safely governed
- Email ingestion where safely governed

## 16.2 Execution integrations

- Browser adapter first
- API adapter next
- Approved database/query adapter later with strict controls
- File/document adapter later
- Human task/approval adapter
- Notification adapter for controlled messages

## 16.3 Output integrations

- Typed run result API
- Callbacks/webhooks for terminal outcome
- Event publication
- Generated reports/artifacts
- Controlled updates to source systems

All integrations must have typed contracts, authentication, authorization, idempotency, auditability, and data classification controls.

---

# 17. Reliability and operational requirements

Production Orbit must be operated as a workflow platform, not only an application UI.

## 17.1 Run reliability

- Durable run creation and dispatch
- Idempotent triggers and state-changing actions
- Explicit retry policy by action safety class
- Per-agent and per-tenant concurrency controls
- Rate limits and backpressure
- Worker lease/heartbeat and recovery after worker failure
- Timeout standards at run, step, browser, API, and approval levels
- Cancellation semantics
- Pause/resume for approvals and long-running workflows
- Dead-letter/error triage patterns where needed

## 17.2 Business correctness

- Explicit business outcomes distinct from technical status
- Assertions tied to expected business state
- Input quality and schema validation
- Data freshness and consistency considerations
- Duplicate/concurrency controls by business key where applicable
- Test fixtures that represent found, not-found, ambiguous, and error states

## 17.3 Observability and SLOs

Define and measure:

- Run success rate by Agent Version
- Business outcome distribution
- Technical failure taxonomy distribution
- Locator/selector drift rate
- Mean/percentile run duration
- Queue latency and worker utilization
- Retry rate
- Approval wait duration
- LLM schema-validation and policy-rejection rate
- Artifact storage growth/cost
- Per-agent/browser/model cost
- Availability and error rates for platform services

## 17.4 Cost controls

- Configurable trace/screenshot retention and sampling rules, while preserving required compliance evidence
- Artifact compression and lifecycle policies
- Browser worker concurrency quotas
- Model cost budgets and quotas
- Per-tenant and per-agent usage metering
- Storage and execution cost attribution

---

# 18. Testing and evaluation strategy

Testing must cover the entire compilation-and-execution chain.

## 18.1 Domain and schema tests

- SOP Graph validity and graph integrity
- Agent IR schema validation
- Variable declaration/type compatibility
- Branch reachability and terminal outcomes
- Policy contract validation
- Event and artifact schema validation

## 18.2 Compiler tests

- Known SOP Graph fixture -> expected Agent IR draft
- Source mapping retained
- Unsupported concepts produce explicit diagnostics
- Normalized IR snapshots where stable

## 18.3 Runtime tests

- Successful deterministic path
- Valid business-not-found path
- Invalid input path
- Assertion failure
- Locator failure
- Timeout
- Policy denial
- Approval pause/resume
- Retry limits
- Worker crash/recovery
- Cancellation
- Idempotency behavior
- Artifact-storage failure handling

## 18.4 Browser contract tests

- Target page locator stability
- Expected state assertions
- Allowed-domain controls
- Authentication/session behavior in supported target environments
- Regression detection for target UI changes

## 18.5 Evidence tests

- Required events emitted in order
- Required artifact types exist and link correctly
- Redaction/masking behavior
- Exact Agent/Graph/Policy version association
- Watchtower reconstruction from persisted data only

## 18.6 LLM evaluation tests

Before production LLM features:

- Golden SOP parsing documents and expected Graphs
- Ambiguity/clarification test cases
- Structured-output validation tests
- Classification/decision goldens
- Adversarial/prompt-injection examples
- Sensitive-data redaction tests
- Policy-denied decision examples
- Recovery proposal evaluation corpus

---

# 19. Deployment evolution

## 19.1 Local and early development

```text
Docker Compose
  - PostgreSQL
  - optional local object storage later

Local Node processes
  - web
  - API
  - browser worker
  - demo portal
```

## 19.2 Initial cloud production direction

A pragmatic AWS-oriented deployment can include:

| Need | Candidate managed service |
|---|---|
| Web delivery | CloudFront + static hosting or container service |
| API | ECS/Fargate or managed container platform |
| Browser workers | ECS/Fargate isolated tasks, tuned for browser execution |
| PostgreSQL | Amazon RDS or Aurora PostgreSQL |
| Artifact storage | Amazon S3 |
| Queue/cache | ElastiCache Redis initially, or SQS/event-driven design where appropriate |
| Secrets | AWS Secrets Manager |
| Key management | AWS KMS |
| Logs/metrics | CloudWatch plus OpenTelemetry-compatible observability |
| Identity | Enterprise OIDC/SAML provider integration |
| Infrastructure as code | Terraform or AWS CDK |

Do not prematurely adopt Kubernetes, service mesh, multi-region active-active, or microservice decomposition before demonstrated need.

## 19.3 Service extraction criteria

Extract a module into an independently deployed service only when one or more are true:

- It has materially different scaling characteristics.
- It requires a stronger isolation/security boundary.
- It has a distinct release cadence.
- It is owned by a separate team.
- It has an operational availability requirement that differs from the monolith.
- It imposes unacceptable coupling or deployment risk in the monolith.

Likely early extraction candidates are browser workers, ingestion workers, and later high-volume event/queue processing—not Studio, Graph, Registry, or Watchtower APIs by default.

---

# 20. Phased delivery roadmap

## Phase 0: Foundation

**Goal:** Reproducible developer environment and shared contracts.

Build:

- Monorepo and baseline CI
- Local PostgreSQL and development tooling
- Controlled demo portal
- Core types/contracts for Agent IR, runs, events, artifacts, and errors
- Artifact storage abstraction
- Basic logging and test conventions

Exit condition:

- A clean environment can start required local services and execute automated checks.

## Phase 1: Deterministic proof loop

**Goal:** Prove manual trigger -> deterministic browser execution -> evidence.

Build:

- Watchtower agent list, manual trigger, and run detail
- One read-only demo SOP/Agent
- Typed dynamic input
- Version-pinned run
- Playwright worker
- Screenshots, DOM snapshots, traces, events, outputs, and error taxonomy

Exit condition:

- A non-developer can run a two-step read-only workflow and inspect proof of every action.

## Phase 2: Natural-language SOP understanding

**Goal:** Let business users write short SOPs and review structured interpretation.

Build:

- SOP text authoring/import foundation
- LLM-assisted but schema-constrained parser
- Clarification loop
- Draft SOP Graph
- Source provenance and screenshot/reference asset associations where available
- Manual execution mapping

Exit condition:

- A business user can write a 2-5 step SOP and obtain a reviewable Graph draft with explicit gaps.

## Phase 3: Studio, test, version, publish

**Goal:** Make authoring and change control operational.

Build:

- Studio workspaces
- Graph/IR editing
- Locator/assertion configuration
- Compiler
- Test Lab
- Diffs, draft history, immutable publishing, restore/undo
- Initial API execution adapter where justified

Exit condition:

- A team can change, test, review, and publish an agent without changing historical runs.

## Phase 4: Bounded LLM decisions

**Goal:** Add controlled intelligence to explicit ambiguity/judgment nodes.

Build:

- LLM gateway
- Structured decision nodes
- Strict output schema and allowed outcomes
- Evaluation fixtures
- Decision evidence in Watchtower
- Minimum Guard controls and human review for sensitive effects

Exit condition:

- A model produces a typed, validated decision that only selects an approved workflow branch and is fully inspectable.

## Phase 5: Enterprise triggers and governance

**Goal:** Connect real systems and enforce enterprise controls.

Build:

- API/webhook/schedule/event triggers
- Queues and durable execution coordination
- Authentication, RBAC, tenancy enforcement
- Vault integration and credential bindings
- Policy engine, approval lifecycle, escalation
- Idempotency, concurrency controls, audit logs
- Artifact authorization, retention, and PII controls

Exit condition:

- A customer system can trigger a governed agent using real, scoped credentials and receive an auditable outcome.

## Phase 6: Intelligent recovery and improvement

**Goal:** Handle controlled UI drift and create a feedback loop to improve agents/SOPs.

Build:

- Failure-context capture
- Recovery proposal engine
- Policy-gated, bounded recovery execution
- Recovery evidence and review
- Suggested SOP Graph/Agent IR patch generation
- Drift analytics and regression feedback into Test Lab

Exit condition:

- Orbit can safely propose and, when explicitly permitted, perform a bounded recovery while preserving immutable evidence and requiring review for persistent changes.

---

# 21. What must never be compromised

These are enduring architecture and product guardrails:

1. Do not make SOP text a hidden runtime prompt that directly controls tools.
2. Do not let LLMs directly execute arbitrary browser/API actions.
3. Do not let runtime failures silently modify published SOPs, Agent IR, policies, or tests.
4. Do not lose the chain from source SOP -> Graph -> Agent IR -> run -> evidence.
5. Do not permit untyped/unvalidated dynamic data to control sensitive execution.
6. Do not treat technical success as proof of business completion without assertions/evidence.
7. Do not mix secrets into SOPs, IR, events, logs, artifacts, or model contexts.
8. Do not use arbitrary user-provided code execution in workflow definitions.
9. Do not give every agent unrestricted domain, credential, API, or browser authority.
10. Do not overbuild distributed infrastructure before the product loop is proven.
11. Do not let a polished UI substitute for persisted, reproducible execution evidence.
12. Do not advance agent authority faster than policy, approval, evaluation, and operational ownership mature.

---

# 22. Claude Code implementation instructions

Claude should use this document as future-state context but must implement only the currently approved milestone.

Before material implementation work, Claude must:

1. Read `CLAUDE.md` and the active phase requirements.
2. Treat the active phase document as higher priority than broad future vision.
3. Inspect the repository and existing contracts.
4. Produce a bounded plan with assumptions, files to change, tests, and acceptance criteria.
5. Avoid architecture changes without explicit approval.
6. Keep future extension seams where low-cost, but do not build future infrastructure prematurely.
7. Run type checks, tests, and relevant E2E tests after changes.
8. Report changed files, commands run, test results, and known limitations.

When uncertain between a broad future capability and a narrow current requirement, choose the narrow current requirement and document the extension point.

---

# 23. Production definition of done

Orbit is production-ready for a given trust tier and use case only when all applicable conditions are met:

- The SOP/Graph/IR provenance chain is complete.
- The Agent Version is immutable, validated, tested, approved, and published.
- Trigger authentication, authorization, input validation, and idempotency are implemented.
- Required credentials are scoped, protected, rotated, and auditable.
- Policies and approvals enforce the use case's authority boundaries.
- Browser/API execution is isolated and constrained.
- Evidence is persisted, redacted/authorized, retrievable, and retained according to policy.
- Technical errors and business outcomes are clearly distinguishable.
- Monitoring, alerting, and exception ownership exist.
- Runbooks and escalation paths exist for operational failures.
- LLM behavior, if present, is schema-constrained, evaluated, audited, and policy-gated.
- Security testing, threat modeling, and privacy review match the data/action sensitivity.
- Cost, capacity, and storage-retention behavior are understood for the expected workload.

The product should deliberately earn its way from read-only observation to high-impact execution. Reliability, governance, and evidence are not afterthoughts; they are the mechanism by which Orbit becomes trustworthy.
