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

A value is either a literal string or exactly one whole-string reference. There is no template
concatenation, and the runtime must not execute arbitrary JavaScript, shell expressions, or
dynamically evaluated code.

### `${result.<field>}`

`${result.<field>}` is **not** a global runtime variable and does not name anything that outlives a
step. It is valid **only inside `browser.extract.assign`**, where it refers to a field of that same
step's extraction result:

```yaml
- id: extract_request_data
  type: browser.extract
  fields:
    requestStatus: { locator: { strategy: test_id, value: request-status }, method: text }
  assign:
    requestStatus: ${result.requestStatus}   # this step's own extraction result
```

Rules:

- The field named after `result.` must be declared in the same step's `fields`; an unknown field is
  rejected with `UNKNOWN_EXTRACT_FIELD`.
- `${result.<field>}` anywhere other than an extract step's `assign` is rejected with
  `REFERENCE_NOT_ALLOWED_HERE`.
- Conversely, an `assign` value must be a `${result.<field>}` reference: assigning
  `${inputs.…}` or `${variables.…}` there is rejected with `REFERENCE_NOT_ALLOWED_HERE`.

To use an extracted value later, read the **variable** it was assigned to
(`${variables.requestStatus}`), never `${result.…}`.

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

### `model.decide`

Added in sub-phase 2.9 (**ADR-032**) and previously missing from this document.

```yaml
- id: classify_condition
  type: model.decide
  sourceSopStepIds: [sop_step_assess_condition]
  question: What condition is this item recorded as?
  readFrom:
    - label: conditionNote
      locator:
        strategy: test_id
        value: condition-note
  alternatives:
    - outcome: serviceable
      description: The note describes an item that can be lent as-is.
      next: mark_available
    - outcome: needs_repair
      description: The note describes damage that must be repaired first.
      next: route_to_repair
    - outcome: unclear
      description: The note does not settle the question either way.
      next: route_to_human
      insufficientEvidence: true
  confidenceThreshold: 0.8
```

Rules:

- Requires `permissions.model.allowed`; otherwise `MODEL_NOT_PERMITTED`.
- At least two alternatives, each with a distinct `outcome` identifier matching
  `^[a-z][a-z0-9_]{0,63}$`.
- **Exactly one** alternative must set `insufficientEvidence: true`, so the judge
  has somewhere to go when the evidence does not settle the question. This is a
  refusal rather than a warning: forcing a confident answer for a record that
  carries no evidence either way makes "right" and "nothing else fit"
  indistinguishable in the run's evidence.
- The widest thing the model can return is an **index into this list**. `next`
  comes from the step definition, never from the answer — so nothing the model
  produces becomes a locator, a URL, an expression, or a step id.
- `outcome` here is a classification label, not a terminal business outcome, and
  is deliberately not checked against the agent's `complete` steps.
- `confidenceThreshold` is optional; absent means the deployment's conservative
  default applies, which the runtime owns rather than this contract.

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

### Phase 1 traceability bridge

SOP Graph does not exist until Phase 2, so there is no versioned node set to
validate step references against. For Phase 1 the Agent Version declares its own
registry of source step IDs, and every step is validated against it:

```yaml
source:
  sopId: sop_find_service_request
  sopVersion: '0.1'
  sourceSopStepIds:
    - sop_step_open_portal
    - sop_step_search_and_verify
```

A step referencing an ID absent from `source.sourceSopStepIds` is rejected with
`SOP_STEP_NOT_DECLARED`. This is deliberately a bridge: it enforces real
traceability without inventing a SOP artifact ahead of the phase that owns one.
**Phase 2 replaces it** with validation against versioned SOP Graph nodes, at
which point `source.sourceSopStepIds` becomes a derived value rather than the
authority.

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

### Credentials are named, never held

`permissions.credentials.allowedRefs` is the closed list of credential names a
published version may resolve. `${credentials.name}` is legal **only where a
value is typed into a field** — never in an assertion, an output, or an
assignment, because those are persisted and a credential must not be.

Resolution happens at the moment of use and the value never enters the
resolution scope, an event payload, an output, or the run row. An unresolvable
credential **fails the step**; it never types an empty string. The event records
`valueSource` (the reference) and omits `valueLength`, because the length of a
secret is information about the secret. A reference outside `allowedRefs` is
rejected with `CREDENTIAL_NOT_PERMITTED`. See **ADR-038**.

### Sections are keyed by surface, and absence means denied

`permissions` holds one optional section per capability: `browser`, `model`
(ADR-032), and `recovery` (ADR-033). **A section that is absent is a capability
that is not granted**, never a default — so an agent that contains a step it has
not been granted the surface for is refused rather than assumed.

`browser` is optional like the others. This is what lets an Agent Version exist
that never opens a browser, and it is the shape a second execution surface plugs
into: a surface brings its own permission section, its own closed addressing
vocabulary, and its own evidence set, or it is not added (**ADR-037**).

Adding a surface later is additive and safe — an Agent Version published before
it simply does not declare it. Changing the shape of a section that already
exists is not, because `permissions` is embedded in published, immutable Agent
Versions (ADR-005, ADR-014).

### Step type to permission mapping

Each step consumes at most one grant, named as a `{ surface, action }` pair, and
evidence capture consumes its own:

| Step type | Required `allowedActions` entry |
|---|---|
| `browser.navigate` | `navigate` |
| `browser.fill` | `fill` |
| `browser.click` | `click` |
| `browser.assert` | `assert` |
| `browser.expect_one_of` | `expect_one_of` |
| `browser.extract` | `extract` |
| `evidence.captureScreenshot: true` | `screenshot` |
| `evidence.captureDomSnapshot: true` | `dom_snapshot` |

`complete` and `fail` are absent by design: they terminate the workflow and
touch no surface, so they require no grant and must not be added to
`allowedActions`. `model.decide` is absent too — it consumes
`permissions.model.allowed`, which is a capability rather than a surface, and is
rejected with `MODEL_NOT_PERMITTED` when ungranted.

Three refusals, kept distinct because they need different fixes:

| Code | Means |
|---|---|
| `SURFACE_NOT_PERMITTED` | The agent never declared the surface this step runs on |
| `ACTION_NOT_PERMITTED` | It holds the surface, but not this action on it |
| `EVIDENCE_NOT_PERMITTED` | The step captures evidence it was not granted |

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
