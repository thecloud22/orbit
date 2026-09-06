# Phase 2 — Task 2 Prompt: Free-Text SOP Understanding (Sub-phase 2.2)

Paste this into a fresh Claude Code session on a new branch off current master.

---

We are continuing Orbit Phase 2, Task 2.

Read these files in this order:

1. CLAUDE.md
2. docs/tasks/ACTIVE_TASK.md
3. docs/tasks/phase-2-sop-graph-requirements.md
4. docs/tasks/plans/TASK-P2-001-sop-graph-foundation-plan.md
5. docs/tasks/reports/TASK-P2-001-sop-graph-foundation-report.md
6. docs/architecture/decisions.md (including ADR-002 and ADR-016)
7. packages/sop-graph source in full — `index.ts`, `sop-graph.ts`, `steps.ts`, `declarations.ts`, `values.ts`, `parse.ts`, `validate.ts`, `graph.ts`, `reorder.ts`, `describe.ts`
8. packages/db source relevant to SOP persistence — `schema/sop-documents.ts`, `schema/sop-graph-revisions.ts`, `schema/sop-clarification-answers.ts`, `mappers/sop-document.ts`, `mappers/sop-graph-revision.ts`, `repositories/sop-documents.ts`, `repositories/sop-graph-revisions.ts`, and whatever `Executor`/transaction pattern the db package already exposes
9. README.md

Confirm before planning that:

- Phase 2 Task 1 (sub-phase 2.1) is merged to master, `@orbit/sop-graph` exists and exports what is documented above.
- Task 2 is the only active task.
- No Phase 2.2 code exists yet.
- The active branch is based on current master.
- The working tree is clean.

## Task 2 goal

Turn free-form SOP text into a persisted draft SOP Graph revision. Given source text, call an LLM to produce an object matching `sopGraphSchema` (minus `schemaVersion`, which code sets), run it through the exact validation Task 1 built (`parseSopGraphDocument` / `validateSopGraph`), repair once against real validation issues if invalid, and — only if valid — persist a new SOP document and its first revision with `provenance.kind: 'generated'` populated. No review UI, no step editor, no reorder UI exposed to users, no Agent IR, no execution.

## LLM integration decision — already made, do not revisit

Use LangChain at the model layer only: `ChatAnthropic` plus `.withStructuredOutput(schema)`, bound directly to the SOP Graph proposal schema (see §2). Do not pull in `createAgent`, chains, memory, retrieval, or LangGraph — none of that is needed for a single generate-then-validate call, and the SOP Graph itself is already the state machine. Do not use the Vercel AI SDK (blocked by org policy). Wrap the LangChain call behind your own `LLMProvider` interface (see §1) so a deterministic fake provider can stand in for tests with zero network calls.

## Model-routing requirement

Use Opus as the primary model for:

- Reading and synthesizing repository context, including the actual shape of `@orbit/sop-graph` and the db repositories (not a guessed API).
- Designing the `LLMProvider` interface, the proposal schema (with `schemaVersion` excluded and injected by code), the prompt, and the repair-loop policy.
- Deciding how document + first-revision persistence becomes transactional — see §3, this requires investigation before implementation.
- Reasoning about the non-network boundary for graph *content* versus the legitimate network dependency this task introduces for calling the model provider (see §4 — these are different things and must not be conflated).
- Writing or reviewing production implementation changes.
- Reviewing the full diff before commit.

Delegate to Sonnet only for bounded verification and mechanical work after Opus has established the design: running/interpreting test output, writing narrowly specified unit tests, fixing TypeScript/ESLint/formatting errors, mechanical fixture repair, running focused test commands. Sonnet must not change the provider interface, the proposal schema, the repair-loop policy, the persistence/transaction approach, add dependencies, or commit.

## §1 — LLMProvider interface

Define an `LLMProvider` interface with one method, roughly:

```text
generateSopGraphProposal(input: {
  sourceText: string;
  repairContext?: { previousAttempt: unknown; issues: readonly SopGraphIssue[] };
}): Promise<{ raw: unknown } | { error: string }>
```

Provide two implementations:

- A real provider backed by `ChatAnthropic` + `.withStructuredOutput`, bound to the proposal schema.
- A deterministic fake provider for tests, configurable per test to return a scripted valid proposal, a scripted invalid proposal, a scripted repaired-and-now-valid proposal on the second call, or a thrown/simulated provider error — with zero network calls.

Neither implementation performs its own Zod validation or persistence — that is a separate orchestration step, not the provider's job.

## §2 — Proposal schema and generation pipeline

The model is bound to `sopGraphSchema` with `schemaVersion` omitted (the model should never be asked to invent it). After a response comes back, code assembles the full document by adding `schemaVersion: SOP_GRAPH_SCHEMA_VERSION`, then runs it through `parseSopGraphDocument` (catches malformed shape) and `validateSopGraph` (catches semantic issues — reachability, cycles, availability, secret rules, everything from Task 1's 22 issue codes).

Repair policy — bounded to one repair attempt:

```text
generate(sourceText)
  → assemble with schemaVersion
  → parseSopGraphDocument + validateSopGraph
  → valid?  → proceed to §3
  → invalid? → generate again, passing back the previous attempt and its
               SopGraphIssue[] (code, message, path, stepId) as repair context
             → assemble + validate again
             → valid?   → proceed to §3
             → invalid? → return a generation failure result carrying the
                           final issues; do not persist anything
```

A thrown/simulated provider error (network failure, API error) is a distinct failure case from a validation failure — do not conflate them in the result type. Design a result type with three cases: succeeded-with-graph, failed-validation-after-repair (carries `SopGraphIssue[]`), failed-provider-error (carries an error message). No case silently swallows a failure.

## §3 — Persistence: investigate before implementing

There is currently no function that creates a `sop_documents` row and its first `sop_graph_revisions` row transactionally — they are separate repository calls today. Before writing any code:

1. Confirm whether `packages/db`'s existing `Executor`/transaction pattern already lets you construct both repositories against the same transaction handle from a new composition layer, with no change to `packages/db` itself (likely, if `createSopGraphRevisionRepository(executor)` and its document-repository counterpart both simply accept any `Executor`, including a transaction-scoped one).
2. If that works, do it entirely from a new package (§ below) with no `packages/db` changes.
3. If it does not work — e.g. only a top-level pool exposes `.transaction()` and repositories can't be composed inside one from outside — propose the smallest additive function to `packages/db` (e.g. a `createSopDocumentWithFirstRevision` service function) and **stop for approval** before implementing it, the same way Task 1 stopped for the three additive contract IDs.

Either way, the successful path populates `provenance` with `kind: 'generated'`, `model`, `provider`, `promptVersion` (define and document a version string for this task's prompt), and `generatedAt`.

## §4 — The non-network boundary this task must still respect

This task legitimately calls the network — to the configured LLM provider's API. That is not a violation of anything Task 1 built. What must still hold:

- No code path in this task ever fetches, navigates, or probes a URL that appears *inside* a generated graph (`urlHint`, `systemHint` values). Those remain untrusted draft references, exactly as the requirements document requires, all the way through this task.
- The only network destination any code in this task's new package(s) may reach is the configured model provider's client library. A static scan test, similar in spirit to Task 1's, should assert this package contains no `chromium`, `playwright`, or direct `fetch(`/`http.request(` call outside the LangChain provider client itself.

## §5 — Minimal input surface (not the review UI)

Per the sub-phase 2.2 scope in the requirements document, provide a minimal free-text input surface: one API route accepting `{ sourceText: string }` (and optionally an existing `documentId` to add a revision to), and a bare textarea + submit UI in Watchtower that calls it and displays either the resulting draft's raw fields (title, steps, assumptions, clarification questions) or the returned issues on failure. Do **not** build the step-form editor, accessible reorder controls, an advanced JSON editor, or a clarification-answer workflow — those are sub-phase 2.3.

## Task 2 must provide

- Package placement: propose it explicitly (e.g. `packages/sop-generation` for the pure provider/schema/repair-loop logic with a dependency on `@orbit/sop-graph` plus LangChain packages only; a second thin package or service module composing generation with `@orbit/db` persistence, following the same "neither existing package may import the other" principle Task 5's `@orbit/artifact-service` used).
- The `LLMProvider` interface, real LangChain-backed implementation, and deterministic fake implementation.
- The generation pipeline with bounded repair, per §2.
- The persistence composition, per §3, with the transaction investigation resolved and documented either way.
- The minimal input API route and UI, per §5.
- The static network-boundary scan test, per §4.

## Test requirements

- Fake provider returns a valid proposal on the first call → persisted document + revision, correct `provenance.kind: 'generated'` with model/provider/promptVersion/generatedAt populated, transactionally (verify both rows exist together, never one without the other).
- Fake provider returns an invalid proposal first, a valid one on repair → persisted; assert the repair call actually received the real `SopGraphIssue[]` from the first failed attempt, not a generic retry.
- Fake provider returns invalid proposals on both attempts → generation failure result with final issues, nothing persisted (assert zero rows written).
- Fake provider simulates a provider/network error → failure result distinct from a validation failure, nothing persisted, no unhandled rejection.
- `schemaVersion` in a scripted fake response is ignored/overridden; the persisted graph always has `SOP_GRAPH_SCHEMA_VERSION`.
- A generated graph containing `urlHint`/`systemHint` values is parsed, assembled, and persisted with zero `fetch`/navigate calls (fetch-spy style test, same technique as Task 1 §6).
- API route + minimal UI: submitting source text shows either the generated draft's fields or the returned issues; no step editor, no reorder controls exposed.
- Regression — the full Phase 1 and Phase 2 Task 1 gates stay green.

## Explicit exclusions

- No step-form editor, no accessible reorder UI exposure (the library-level reorder logic from Task 1 is not touched or exposed here), no advanced JSON editor.
- No clarification-answer collection workflow — the model may populate `clarificationQuestions` on the graph, but answering them is sub-phase 2.3.
- No approval/rejection UI or workflow beyond the `draft` state already created.
- No execution mapping, domain allowlisting, or element discovery.
- No Agent IR generation, compilation, or publishing.
- No Playwright, browser worker/runtime, or evidence capture.
- No secret storage, encryption, rotation, masking, or audit-policy implementation — secrets remain declarations only, exactly as Task 1 left them.
- No multi-provider fallback, retry-budget beyond the one repair attempt, or cost/rate-limit design — flag these as later concerns if they come up, don't solve them now.
- Do not modify `@orbit/sop-graph`'s validation, schema, or reorder logic — Task 2 is a consumer of that package, not a contributor to it. If a genuine gap is found, stop, name it precisely, and wait for approval before touching that package.
- Do not add dependencies beyond LangChain's core/Anthropic packages without explaining why and waiting for approval.

## Before modifying files, installing dependencies, or making any commit

1. Inspect the actual `@orbit/sop-graph` and `packages/db` source (already read above) and confirm the API surface matches what this brief assumes; report any discrepancy before proceeding.
2. Resolve the §3 transaction investigation and report the finding.
3. Summarize Task 2's goal, scope, and exclusions back in your own words.
4. Propose package/module boundaries and wait for approval before writing code.
