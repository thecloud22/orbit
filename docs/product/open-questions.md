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
