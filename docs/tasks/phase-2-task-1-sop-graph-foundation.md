# Phase 2 — Task 1 Prompt: SOP Graph Foundation (Sub-phase 2.1)

Paste this into a fresh Claude Code session on a new branch off current master, the same way each Phase 1 task started.

---

We are starting Orbit Phase 2, Task 1.

Read these files in this order:

1. CLAUDE.md
2. docs/tasks/ACTIVE_TASK.md
3. docs/tasks/phase-2-sop-graph-requirements.md (this Phase 2 requirements document)
4. docs/tasks/phase-1-backlog.md
5. docs/contracts/events-and-evidence.md
6. docs/contracts/agent-ir.md
7. docs/architecture/decisions.md
8. docs/architecture/phase-1-system-design.md
9. docs/testing/phase-1-test-strategy.md
10. packages/contracts source
11. packages/db source, schema, repositories, migrations, and tests
12. README.md
13. .gitignore and .env.example

Confirm before planning that:

- Phase 1 (Tasks 1–9) is complete and merged to master.
- Task 1 of Phase 2 is the only active task.
- No Phase 2 code exists yet.
- The active branch is based on current master.
- The working tree is clean.

## Task 1 goal

Implement the non-executable SOP Graph foundation only: contracts/schemas, the draft/revision/provenance model, persistence and repositories, graph-level semantic validation, typed run-input declarations, and step reorder/dependency validation. This is sub-phase 2.1 exactly as scoped in the Phase 2 requirements document — no LLM, no free-text input, no review UI, no execution mapping, no Agent IR generation.

## Model-routing requirement

Use Opus as the primary model for:

- Reading and synthesizing repository context.
- Interpreting CLAUDE.md, the Phase 2 requirements document, contracts, ADRs, schemas, repositories, and test strategy.
- Defining Task 1 scope and acceptance criteria within the sub-phase 2.1 boundary.
- Designing the SOP Graph schema, step-kind vocabulary, input-declaration types, and validation error taxonomy.
- Reasoning about reachability, terminal-outcome coverage, cycle detection, and reorder-dependency validation.
- Deciding the draft/revision/provenance persistence model and lifecycle states.
- Identifying contract/schema gaps against Phase 1 and requesting approval before changing anything shared.
- Writing or reviewing production implementation changes.
- Reviewing the full diff before commit.
- Resolving any failure that might expose a design defect, validation gap, or scope ambiguity.

Delegate to Sonnet only for bounded verification and mechanical repair work after Opus has established the intended design:

- Running and interpreting focused test output.
- Writing or updating narrowly specified unit tests.
- Fixing TypeScript compiler errors.
- Fixing ESLint errors.
- Fixing formatting errors.
- Repairing straightforward test assertions where expected behavior is already unambiguous.
- Re-running targeted tests and reporting exact pass/fail results.
- Making small mechanical refactors that do not alter contracts, the graph schema, validation rules, public APIs, or persistence ordering.

Sonnet must not independently:

- Change architecture or expand scope.
- Add dependencies.
- Change database schema or migrations.
- Change public contracts, the step-kind vocabulary, or the validation error taxonomy.
- Change reorder-dependency rules, reachability rules, or terminal-outcome rules.
- Change Task 1 acceptance criteria or exclusions.
- Make commits.

If Sonnet finds an issue requiring any restricted change, stop and return it to Opus with exact error output, affected files, the smallest reproducible command, and a short description of why the issue crosses the stated boundary.

Before delegating any Sonnet task, Opus must give Sonnet exact files it may modify, expected behavior or assertions, exact commands to run, and explicit boundaries it must not cross.

## Task 1 must provide

- A generic, non-executable SOP Graph schema (contracts + Zod), covering the step-kind vocabulary: `navigate`, `fill`, `click`, `extract`, `decision`, `outcome`, `manual_review`.
- Graph-level concepts: inputs, variables produced by extraction, outputs, assumptions, clarification questions, risks/limitations, and revision/provenance metadata.
- Typed run-input declarations limited to `string`, `number`, `boolean`, `enum`, `date`, `secret` — per the simplified Secret Input Rules in the requirements document, a secret is only a declared input of type `secret`; no vault, encryption-at-rest, rotation, or audit design is required in this task.
- Draft/revision/provenance persistence: what was originally written, which graph revision is under review, which assumptions/questions were generated, which answers/edits were made, which revision was approved/rejected, and which model/provider/prompt version produced a proposal (the model/provider plumbing itself is not built in this task — only the schema fields to record it later).
- Lifecycle states: `draft`, `needs_clarification`, `in_review`, `approved`, `rejected`, `superseded`.
- Graph-level semantic validation:
  - Stable unique step IDs.
  - Valid supported step kinds only.
  - Every branch targets an existing step.
  - A defined entry step.
  - Reachability for all non-draft steps.
  - Every reachable path reaches a supported terminal outcome.
  - No unsupported cycles/loops.
  - No duplicate output/input identifiers.
  - Input references resolve to declared inputs.
  - Variable references resolve to values produced on every reachable earlier path.
  - No secret literal value embedded in graph JSON — only a reference to the declared input id.
  - URLs are syntactically valid draft references when present, and are never navigated, fetched, or probed by this task's code.
- Step reorder/dependency validation: after any proposed reorder, validate reachability, valid branch targets, that no required input/extracted value is used before it is available, that a move does not break decision-branch structure, and reject or explain in plain language (per the two examples already in the requirements document) any move that would invalidate the graph.
- The non-executable safety boundary: no code path in this task can create an Agent Version, start a run, invoke a browser, fetch a URL, or cause any external side effect.
- Unit tests and database integration tests.

## Task 1 test requirements

- Valid minimal graph (entry step through one terminal outcome) parses and validates successfully.
- Graph with an unreachable step is rejected with a clear error.
- Graph with a branch targeting a nonexistent step ID is rejected.
- Graph with no defined entry step is rejected.
- Graph with a reachable path that never reaches a terminal outcome is rejected.
- Graph with an unsupported cycle is rejected.
- Graph referencing an undeclared run input is rejected.
- Graph referencing a variable not produced on every reachable earlier path is rejected.
- Graph with a literal secret value embedded in a step is rejected; a reference to a declared `secret`-type input id is accepted.
- Valid reorder that preserves dependency validity is accepted.
- Reorder that would use a variable before it is produced is rejected with a plain-language explanation, matching the style of the two examples in the requirements document.
- Reorder that would break decision-branch structure is rejected.
- Draft/revision/provenance fields persist and are retrievable: original text placeholder, revision id, assumptions, clarification questions and answers, edit history, approval/rejection state, and generation metadata fields.
- Lifecycle state transitions are valid only in the documented directions (e.g., `draft` → `needs_clarification` → `in_review` → `approved`/`rejected` → `superseded`).
- No test or code path in this task performs a network fetch, DNS resolution, or browser navigation to any URL appearing in graph data.
- Run existing Phase 1 checks after implementation to confirm no regression.

## Task 1 explicit exclusions

- No LLM calls, no provider abstraction, no free-text SOP parsing.
- No user-facing review UI, step-form editor, or advanced JSON editor.
- No execution-mapping, domain allowlisting, or element-discovery work.
- No Agent IR generation, compilation, or publishing.
- No Playwright, browser worker/runtime, or evidence capture.
- No API routes or Watchtower UI changes.
- No secret storage, encryption, rotation, masking-in-logs, or audit-policy implementation — declarations only, per the requirements document.
- No authentication, authorization, tenancy, or collaboration.
- Do not modify Phase 1 runtime, evidence, or Watchtower behavior.
- Do not change database schema or migrations outside what this task's new tables/entities require. If an existing Phase 1 schema element must change, stop, explain the precise gap, cite the affected schema/repository/contract, and wait for approval.
- Do not add dependencies without explaining why existing workspace dependencies are insufficient and waiting for approval.

## Before modifying files, installing dependencies, running migrations, or making any commit

1. Inspect current contracts, schemas, repository interfaces, database constraints, and test helpers relevant to Phase 1.
2. Summarize Task 1's goal, scope, acceptance criteria, and exclusions back in your own words.
3. State what an SOP Graph means at this stage and what Task 1 deliberately does not create.
4. Propose module/package boundaries (e.g., `packages/sop-graph-contracts`, `packages/sop-graph-validation`, persistence additions to `packages/db`) and wait for approval before writing code.
