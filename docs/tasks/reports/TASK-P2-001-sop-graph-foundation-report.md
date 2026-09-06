# Phase 2 Task 1 Report — SOP Graph Foundation (sub-phase 2.1)

**Status:** Complete, pending commit approval

**Branch:** `phase-2-task-1-sop-graph-foundation`

**Scope:** Sub-phase 2.1 only. No LLM, no free-text parsing, no review UI, no execution mapping,
no Agent IR generation.

## Goal

Build the foundation the rest of Phase 2 stands on: the SOP Graph contract, its validation, and
its draft/revision/provenance persistence — with nothing yet generating graphs.

Doing it in that order is the point. A graph produced by a model in sub-phase 2.2 is untrusted
input, so the validator has to exist and already be strict before anything starts feeding it
machine-generated documents.

### What an SOP Graph is here

A typed, versioned, **non-executable** description of business and browser intent: ordered steps in
a seven-kind vocabulary, typed run inputs, variables produced by extraction, declared outcomes, and
the assumptions, questions and risks that surround a draft. It is what a human reviews and edits.

### What this task deliberately does not create

No selectors, locators, `data-testid`s, domain permissions, or dispatch data. No Agent IR and no
path to one. Nothing that navigates, fetches, probes, resolves DNS, launches a browser, or writes
evidence. An approved SOP Graph here is a reviewed document and nothing more.

## The non-executable boundary

Four independent guards, because "this cannot execute anything" deserves more than a convention.
The reasoning, and why the redundancy is warranted, is recorded in **ADR-016**.

| # | Guard | Result |
|---|---|---|
| 1 | **Dependency surface** — `@orbit/sop-graph` depends on **Zod and nothing else** | Verified: the package's entire import surface is `zod` plus its own relative modules |
| 2 | **ESLint boundary** — Playwright, React, Fastify, Drizzle, the filesystem, `node:net/http/https/dns`, `@orbit/agent-ir`, `@orbit/runtime`, `@orbit/executor-playwright`, `@orbit/db` all rejected | `pnpm lint` clean |
| 3 | **Static source scan** — a test opens every non-test source file and asserts none contains `fetch(`, `XMLHttpRequest`, `chromium`, `playwright`, `page.`, `node:net`, `node:http`, `node:dns`, `child_process`, or a forbidden package import | Passing |
| 4 | **Runtime proof** — global `fetch` is replaced with a spy that throws, then a graph full of `urlHint` values is parsed, validated and reordered | Zero calls |

It came out stronger than planned: the package does not import `@orbit/contracts` either, because it
turned out not to need it, so that unused dependency was removed rather than left declared.

A fifth, smaller guard: the package exports no **callable** named like an action. `navigateStepSchema`
is a Zod schema — describing what a navigation *would be* is the whole job — and a test asserts
explicitly that it is a value and not a function.

## Package: `@orbit/sop-graph`

One package, mirroring `@orbit/agent-ir`, filling the slot README already reserved.

| Module | Contents |
|---|---|
| `declarations.ts` | Typed inputs (`string`, `number`, `boolean`, `enum`, `date`, `secret`), produced values, outputs |
| `values.ts` | Literal / `${inputs.x}` / `${variables.y}` — no expression language |
| `steps.ts` | The seven step kinds, branches, extract fields, outcome returns |
| `sop-graph.ts` | The document: entry, inputs, outputs, steps, assumptions, questions, risks |
| `graph.ts` | Successors, reachability, cycles, topological order, **dominators** |
| `validate.ts` | Semantic validation and the issue taxonomy |
| `reorder.ts` | Move application, re-validation, plain-language explanation |
| `describe.ts` | Human labels, so messages name steps the way a reviewer sees them |
| `parse.ts` | Parse + validate; takes text or a decoded document, never a path or a URL |

The interpolation grammar is re-implemented rather than imported from `@orbit/agent-ir`. That
duplication is deliberate: ADR-002 keeps business intent and the executable plan independent, and
importing one into the other is how that separation erodes. Recorded in **ADR-016**.

### Validation

`validateSopGraph` returns a list of issues rather than throwing, so a whole document is reported at
once — what a reviewer wants, and what 2.2 will need to decide whether to retry a generation.

Covered: duplicate step/input/output/variable identifiers; entry step declared and resolvable; branch
targets exist; reachability; every reachable path reaches a terminal; the workflow ends on a terminal;
acyclicity; malformed references; undeclared input and variable references; **availability analysis**;
outcome-return rules; secret rules; URL syntax.

**Availability analysis** mirrors Agent IR's definite-assignment pass: variables flowing into a step
are the *intersection* of what flows out of its predecessors, in topological order over an acyclic
graph.

**Outcome returns** are where the requirements document's `onCallEngineer` case lands. A return not
available on every path into that outcome must be declared `optional: true`, or it is rejected —
silently returning a value that may not exist is not permitted.

**Secrets**, structurally and with no heuristics about what looks like a password:

- The `secret` input variant has no `example` and no `default` **in the schema**, so a literal secret
  is unrepresentable rather than merely checked for.
- A `fill` marked `sensitive` must reference a declared secret input; a literal is rejected.
- A secret may be referenced only from `fill.value` — never from a decision or an outcome payload.

**URLs** are parsed with `new URL()` for syntax only. Nothing resolves, fetches, or probes them.

### Reorder

`validateReorder` applies the move to a copy, re-validates in full, and returns either the new graph
or the issues plus one sentence a reviewer can act on.

Precedence turned out to matter more than expected, and getting it wrong was the first real defect
found (below). One bad move usually breaks several things at once, and all the resulting reports are
true while only one *explains what the person did*. The order is most-specific-cause first: the
dependency the moved step violates, then the decision guard it escaped, then the structural
symptoms (a loop, a stranded step, a path that stops terminating).

Branch-structure violations are detected with **dominator analysis**, which is the precise tool:
reachability cannot see the problem, because after such a move the step is still perfectly reachable
— just reachable from places the decision never ran.

The two explanations, produced by the implementation against the requirements document's own worked
example:

> Cannot move "Search the team directory for the assigned team" before "Extract request details"
> because the moved step uses Assigned Team, which is produced later in the workflow.

> Cannot move "Open the on-call schedule page" above "Does the directory team name match the
> assigned team on the request?" because "Open the on-call schedule page" is only reachable on one
> branch of that decision. Moving it would place it on paths where that decision has not been made.

## Persistence

Recorded in **ADR-016**. Three new tables, migration `0001_sop_graph_foundation`. **No Phase 1 table, column, or constraint
was changed.**

```text
sop_documents             id, title, source_text, timestamps
sop_graph_revisions       id, document_id, revision_number, graph JSONB, graph_sha256,
                          state, provenance JSONB, parent_revision_id,
                          superseded_by_revision_id, reviewed_at, review_note
sop_clarification_answers id, revision_id, question_id, answer, answered_at
```

- `source_text` has **no update path**. "What did the user originally write?" stops being answerable
  the moment the original can be edited in place.
- The whole validated graph is JSONB beside a checksum, following `agent_versions`. `graph_sha256`
  is recomputed on read, so a revision altered out of band raises instead of being served as the one
  that was reviewed.
- Revisions are immutable apart from state and supersession. There is no method that rewrites a
  stored graph, so an edit is a new revision and **the revision chain is the edit history**.
- `parent_revision_id` and `superseded_by_revision_id` are real self-referencing foreign keys
  (`ON DELETE SET NULL`). This chain *is* the record of what was reviewed and what replaced it, and
  Phase 1 already established that a pointer which can dangle is not a record.
- An invalid graph is rejected before anything is written — the repository runs
  `parseSopGraphDocument` first, which is what 2.2 will rely on.

### Lifecycle

State lives on the **revision**; a document's status is derived from its newest non-superseded
revision, so the two can never disagree.

```text
draft ──► needs_clarification ──► in_review ──► approved
  │                                   │     └──► rejected
  └───────────────────────────────────┘
                    every state ──► superseded (terminal)
```

`draft → in_review` is permitted when nothing needs asking; `in_review → needs_clarification` when a
reviewer raises a new question. Transitions are enforced with the expected state in the `WHERE`
clause, the way `runs.markRunning` already is, so a concurrent writer cannot slip between check and
write.

## Defects found and fixed

1. **Reorder explanation precedence was wrong.** Both worked examples produced true but unhelpful
   messages — the dependency case reported a lost branch guard, and the branch case reported a
   cycle. Found by probing the implementation against the requirements document's own examples
   before writing any test around it. Fixed by ordering the explanation by specificity of cause.
2. **The ESLint block had no test carve-out.** `packages/contracts` and `packages/agent-ir` both
   allow their tests to read the filesystem; the SOP Graph block did not, which made the static
   safety scan — a test whose entire job is to open every source file — unlintable. Fixed by adding
   the same carve-out, lifting **only** the filesystem rule while every ban that constitutes the
   non-executable boundary still applies to tests.
3. **My own export-name assertion was too crude.** It matched export *names* against action verbs
   and so flagged `navigateStepSchema`, a Zod schema. Rewritten to test callables, which is the
   property that actually matters, plus an explicit assertion that the schema is not a function.
4. **Two test expectations of mine were wrong**, not the code: a document title confused with a
   graph title, and a Phase 1 assertion hard-coding "7 tables". The latter now derives from
   `ORBIT_TABLE_NAMES`, so adding a table is no longer a reason to edit it.

Sonnet escalated (2) and (3) rather than editing the ESLint config or weakening the assertion, which
is the behaviour the routing policy asks for.

## Commands and exact results

| Command | Result |
|---|---|
| `pnpm install` | `Already up to date`, 13 workspace projects, nothing downloaded |
| `pnpm typecheck` | Pass, all workspaces |
| `pnpm lint` | Pass |
| `pnpm format:check` | Pass |
| `pnpm test` | **471 passed**, 44 files |
| `pnpm db:generate` | `No schema changes, nothing to migrate` — the committed SQL matches the schema |
| `pnpm db:migrate` | Applied to `orbit_dev`; 10 tables; Phase 1 rows intact (9 runs, 1 agent version) |
| `pnpm test:db` | **109 passed**, 10 files against `orbit_test` |
| `pnpm verify:phase1` | Pass — 471 unit, 109 db, 6 runtime, 11 Watchtower E2E, 9 demo portal, teardown clean |

Test counts before this task were 432 unit and 93 db; the additions are 39 SOP Graph unit tests and
16 SOP persistence tests.

### Safety greps

Reported exactly, because the originally specified form does **not** return nothing:

```bash
grep -rnE "fetch\(|chromium|playwright|node:(net|http|https|dns)" packages/sop-graph/src
grep -rnE "@orbit/(agent-ir|runtime|executor-playwright|db)" packages/sop-graph/src
```

Both match — and every match is a **string literal inside `safety-boundary.test.ts`'s denylist**.
That file is the scan that enforces the boundary, so it necessarily contains the forbidden strings
as data. Restricted to production sources, both return nothing:

```bash
$ grep -rnE "fetch\(|chromium|playwright|node:(net|http|https|dns)" \
    packages/sop-graph/src --include="*.ts" | grep -v "\.test\.ts:"
$ grep -rnE "@orbit/(agent-ir|runtime|executor-playwright|db)" \
    packages/sop-graph/src --include="*.ts" | grep -v "\.test\.ts:"
```

Both empty. The package's declared runtime dependencies are `{"zod":"^4.5.4"}`.

## Changed files

**Created** — `packages/sop-graph/` (package.json, tsconfig, 9 source modules, 4 test files,
`testing/fixtures.ts` + index), `packages/db/src/schema/sop-{documents,graph-revisions,clarification-answers}.ts`,
`packages/db/src/mappers/sop-{document,graph-revision}.ts`,
`packages/db/src/repositories/sop-{documents,graph-revisions}.ts`,
`packages/db/src/repositories/sop-graph.db.test.ts`,
`packages/db/drizzle/0001_sop_graph_foundation.sql` + snapshot, and this report.

**Modified** — `packages/contracts/src/{ids,generate-id}.ts` (three additive id types),
`packages/db/src/{schema,mappers,repositories}/index.ts`, `packages/db/package.json`,
`packages/db/drizzle/meta/_journal.json`, `packages/db/src/testing/reset.db.test.ts` (table count now
derived), `apps/api/src/testing/stub-context.ts` (widened interface), `eslint.config.js`,
`README.md`, `docs/tasks/ACTIVE_TASK.md`.

**Untouched** — every Phase 1 table and migration `0000`, `@orbit/agent-ir`, `@orbit/runtime`,
`@orbit/executor-playwright`, `@orbit/artifacts`, `@orbit/artifact-service`, all Phase 1 production
code in `apps/`, and `fixtures/`.

**Dependencies:** none added. `@orbit/db` gained a workspace link to `@orbit/sop-graph` for the JSONB
column type, exactly as it already links `@orbit/agent-ir`.

## Known limitations

- **Step kinds are not sequenced.** Nothing requires an `extract` to follow a `navigate`, so a
  reorder that is semantically odd but structurally valid is accepted. The requirements list no such
  rule for 2.1; it belongs with execution mapping, which is where "what does this step actually act
  on" is decided.
- **Graph-level `outputs` are not cross-checked against produced variables.** Outcome `returns` are,
  which is the payload that matters; `outputs` is currently a declaration for reviewers.
- **Loops are rejected outright**, per the requirements' first-version scope.
- **Clarification answers do not automatically produce the next revision.** Recording an answer and
  creating the revision that incorporates it are separate calls; the workflow that joins them is
  sub-phase 2.3.
- **Provenance fields for generated proposals exist but nothing populates them** — that is 2.2.
- **Step-level querying would need a different storage shape.** The graph is stored whole, which is
  right while it is reviewed as a unit; querying individual steps means opening the document. See
  ADR-016.

## For sub-phase 2.2

`parseSopGraphDocument` is the gate generated output must pass before persistence, and
`SopGraphRevisionRepository.create` already refuses anything that fails it. A fake provider should
produce documents that exercise the issue taxonomy, not just the happy path — the escalation-review
fixture in `@orbit/sop-graph/testing` is the realistic target shape.
