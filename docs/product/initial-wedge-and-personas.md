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
