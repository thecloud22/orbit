# Orbit Engineering Instructions

## Product and current milestone

Orbit turns business SOPs into governed, executable, and observable agents.

The long-term architecture is:

```text
Natural-language SOP
  -> SOP Graph
  -> Agent IR
  -> Execution Runtime
  -> Events and Artifacts
  -> Watchtower
```

The current implementation is **Phase 1 only**. Do not build the long-term product all at once.

Phase 1 proves one complete loop:

```text
Watchtower manual trigger
  -> typed dynamic input
  -> version-pinned Agent IR
  -> deterministic Playwright execution
  -> events and artifacts
  -> Watchtower evidence view
```

The only Phase 1 agent is `Find Service Request`.

Read these documents before planning or implementing material work:

- `docs/product/orbit-product-vision-and-requirements.md`
- `docs/sop/find-service-request.md`
- `fixtures/find-service-request.agent.yaml`
- Relevant contract and architecture documents

If a document conflicts with this file, stop and clearly identify the conflict rather than choosing silently.

## Product principles

- The natural-language SOP is the source of business intent.
- SOP Graph represents business intent and must not contain Playwright selectors or browser implementation details.
- Agent IR is the typed executable workflow contract.
- Runtime executes Agent IR, never raw SOP text, raw LLM output, or arbitrary user code.
- Every run must reference an immutable Agent Version.
- Every Agent IR step must map to one or more source SOP step IDs.
- Browser execution is deterministic in Phase 1. No runtime LLM decisions.
- Evidence is a first-class product feature, not debug output.
- Technical run status and business outcome are separate concepts.
- Policies are independent of prompts and model recommendations.
- Orbit earns autonomy gradually; Phase 1 is read-only Tier 0 automation.

## Phase 1 scope

### Included

- One controlled local demo portal.
- One manually seeded Agent Version: `Find Service Request` version `0.1.0`.
- One required dynamic input: `requestNumber` as a non-empty string.
- Watchtower UI that lists the agent, renders the dynamic input, starts a run, and displays evidence.
- Deterministic Playwright actions:
  - `browser.navigate`
  - `browser.fill`
  - `browser.click`
  - `browser.assert`
  - `browser.expect_one_of`
  - `browser.extract`
  - `complete`
  - `fail`
- Controlled outcomes:
  - run status: `queued`, `running`, `succeeded`, `failed`, `cancelled`
  - business outcomes: `request_found`, `request_not_found`, `none`
- PostgreSQL persistence for Agent versions, runs, steps, events, and artifact metadata.
- Local filesystem storage for screenshot, DOM snapshot, and Playwright trace bytes, behind an interface.
- Structured events and typed error taxonomy.
- Automated unit, integration, and relevant browser tests.

### Explicitly excluded

- SOP document upload, OCR, document parsing, source screenshot extraction, video ingestion.
- LLM-based SOP parsing, runtime LLM decision nodes, or LLM recovery.
- Studio authoring UI, graph canvas, natural-language workflow edits, publishing UI.
- Real credentials, authentication workflows, MFA, CAPTCHA. (External websites left this list in
  sub-phase 2.5 — see **ADR-022** — but nothing behind a login is reachable, because Orbit still
  cannot supply a secret.)
- State-changing business actions: refunds, payments, messages, account updates, deletions, permissions changes.
- API/webhook/schedule/email/file/event-bus triggers.
- Redis, BullMQ, Temporal, S3, MinIO, cloud deployment, Terraform, Kubernetes, microservices.
- Full authentication, RBAC, multi-tenancy implementation, policy UI, or approvals.
- Generic custom code steps, arbitrary JavaScript expressions, `eval`, `Function`, or arbitrary shell commands.

Do not add excluded capabilities unless the user explicitly changes scope.

## Required Phase 1 business behavior

The natural-language SOP is:

```text
Title: Find Service Request

1. Open the service request portal.
2. Search for the service request using its request number and confirm that the matching service request and current status are displayed.
```

Demo portal route:

```text
http://localhost:3001/requests
```

Known record:

```text
Request number: SR-1001
Status: In Progress
Assigned team: Infrastructure Operations
```

Unknown request test input:

```text
SR-9999
```

Expected outcomes:

- `SR-1001` produces run status `succeeded`, business outcome `request_found`, status `In Progress`, and team `Infrastructure Operations`.
- `SR-9999` produces run status `succeeded`, business outcome `request_not_found`.
- A broken locator produces a typed technical failure and diagnostic evidence.

Required demo portal test IDs:

```text
request-number-input
search-request-button
request-result
request-number-result
request-status
assigned-team
request-not-found
```

## Tech stack

- TypeScript, strict mode enabled
- pnpm workspaces monorepo
- React + Vite + Tailwind CSS for the web application
- Node.js + Fastify for the API
- Separate Node.js process for the browser worker
- Playwright for browser execution
- PostgreSQL via Docker Compose
- Drizzle ORM and migrations
- Zod for API, domain, persistence, and runtime validation
- Local filesystem artifact storage behind a storage interface
- Pino for structured logs
- Vitest for unit and integration testing
- Playwright Test for end-to-end browser testing

## Architecture rules

- Build a modular monolith, not microservices.
- Keep browser worker separate from the API process.
- Keep Watchtower and future Studio in one React application initially.
- UI must not access PostgreSQL directly.
- SOP Graph must not import Playwright.
- Agent IR must not import React, Fastify, Drizzle, or Playwright.
- Runtime must depend on executor interfaces, not direct UI or framework code.
- Playwright executor must not determine business workflow order; it executes approved Agent IR steps.
- Store binary artifact bytes outside PostgreSQL.
- Store artifact metadata and links in PostgreSQL.
- Use immutable Agent Versions. Published/seeded versions must not be mutated by a run.
- Use opaque string IDs for public/domain entities.
- Create an in-process dispatch abstraction for runs, but do not couple runtime execution to the HTTP request lifecycle.
- Do not add Redis or a durable queue in Phase 1.

## Dynamic values and expressions

- Inputs and variables must be declared and typed.
- Phase 1 supports `requestNumber` input and extracted variables such as `requestStatus` and `assignedTeam`.
- Support only restricted interpolation such as:

```text
${inputs.requestNumber}
${variables.requestStatus}
${variables.assignedTeam}
```

- Do not execute arbitrary user-provided JavaScript expressions.
- Do not use `eval`, `Function`, dynamic module import, or arbitrary shell commands.
- Validate run inputs before creating/dispatching a run.

## Browser and security rules

- Browser navigation is constrained **per agent**, by the `permissions.browser.allowedDomains` an
  Agent Version declares. The semantic validator checks it at publish and the runtime re-checks it
  before every navigation, so an agent may open the hosts its recording visited and nothing else.
  Phase 1's blanket `localhost`-only allowlist was lifted in sub-phase 2.5 (**ADR-022**); it was a
  ceiling on what Orbit could be used for rather than the thing providing containment.
- Recording may target any `http` or `https` URL, because a person drives the browser. Other
  protocols — `file:`, `data:`, `javascript:` — are still refused everywhere.
- External sites are real systems. Do not record or automate a workflow that performs
  state-changing actions on one, and do not automate a site whose terms forbid it.
- Use stable `data-testid` locators in the demo portal.
- Do not use coordinate clicking.
- Do not hard-code, log, persist, display, or commit secrets.
- Do not put secrets in SOPs, Agent IR, events, traces, screenshots, DOM snapshots, or source control.
- Preserve extension points for future credential references, tenant ownership, artifact authorization, PII redaction, policies, and approvals.
- Do not silently swallow errors.

## Required evidence behavior

For every Phase 1 run, persist enough information for Watchtower to reconstruct the execution from backend data.

Required evidence:

- Run record with exact Agent Version ID.
- Validated input values.
- Run and step status transitions.
- Structured events.
- Screenshot after navigation, fill, click, and final result state.
- DOM snapshot after navigation and state-changing click.
- Playwright trace for every run.
- Assertion results.
- Extracted output values for successful lookup.
- Typed error data for failures.
- Artifact metadata and links.

Required event types:

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

## Coding standards

- Use TypeScript strict mode. Do not introduce `any`.
- Use Zod schemas at API, persistence, and runtime boundaries.
- Prefer discriminated unions for Agent IR steps, events, and errors.
- Keep functions small and domain-focused.
- Add tests for every new behavior.
- Add migrations for every database schema change.
- Preserve causal context in persisted entities and events: agent version, run, step, attempt where applicable, and event.
- Keep implementation comments concise; explain non-obvious design decisions, not routine code.
- Avoid broad refactors unless explicitly requested.
- Update documentation when contracts, setup commands, or architecture change.
- Keep artifacts under a gitignored local data directory.

## Development workflow

Before implementing a non-trivial task:

1. Read this file and relevant documentation.
2. Inspect the relevant existing code.
3. State the proposed approach, files likely to change, important assumptions, tradeoffs, and test plan.
4. Wait for approval if the task changes architecture, data contracts, public API contracts, or security boundaries.
5. Implement only the bounded task.
6. Run formatting, type checking, unit tests, and relevant integration/E2E tests.
7. Report changed files, commands run, test results, and known limitations.

When uncertain, prefer the smallest implementation that satisfies the documented Phase 1 acceptance criteria.

## Model routing

Read and follow `docs/engineering/model-routing.md` before planning, delegating, modifying code, or committing work.

Use Opus by default. Sonnet is limited to explicitly bounded test, TypeScript, lint, formatting, and mechanical repair tasks after Opus has established the intended behavior.

## Commands

Update this section as the repository evolves. Do not invent commands; verify them against package scripts.

Expected eventual commands:

```text
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm db:migrate
docker compose up -d
```
