# Task P2-008 — Branching, a model-spend cap, and a workflow that chooses

**Sub-phase:** 2.8
**Branch:** `phase-2-task-8-branching-and-token-cap`
**Status:** Complete — not committed, not merged, not pushed

## Why this task exists

Three things, delivered together.

**A workflow that chooses could be drafted but never run.** `decision` has been one of the seven SOP
Graph step kinds since sub-phase 2.1, and the reference workflow in the requirements document
branches three times. The compiler refused every one of them with `branching_unsupported`, recorded
as "2.5 compiles linear workflows only". That description was wrong about where the gap was.

**Nothing bounded what the model could spend.** Free-text drafting calls a provider up to twice per
Generate. There was no ledger, no ceiling, and no figure anywhere in the product saying what a draft
had cost.

**Nothing demonstrated branching.** A capability with no worked example is a claim.

## What was built

### Task A — Branching, without touching the executable layer

The single most important finding, established before any code was written: **Agent IR and the
runtime already did this.** `browser.expect_one_of` has existed since Phase 1 — `alternatives:
[{whenVisible, next}]`, minimum two, with `graph.ts` deriving successors and enforcing acyclicity —
and `interpreter.ts` has executed it since Task 6, racing the alternatives' locators, jumping to the
winner's `next`, and recording `selectedAlternativeIndex` and `matchedLocator` as evidence. The
seeded Phase 1 fixture already used it.

What was missing sat in one field of one schema. `ExecutionBinding`'s `decision` body was
`{target, readMethod, condition}` — read one value, evaluate a predicate. Nothing in Orbit can
evaluate a predicate, and nothing will: arbitrary expressions are excluded by `CLAUDE.md`. So the one
shape meant to make a decision executable described an operation that could not be performed, while
the operation the runtime *could* perform had no way to be described.

**The binding contract changed, additively and deliberately** (ADR-029). The `decision` body is now
`{kind: 'decision', branches: [{when, selectors, fingerprint}]}`, minimum two, with no `target` at
all. `EXECUTION_BINDING_SCHEMA_VERSION` moved to `0.2`. This is a change to a contract ADR-018 froze;
the four other bodies are untouched, `0.1` rows still parse because the version is read as an opaque
string, and **no migration was needed** — the body column is JSONB, and no decision binding could
have existed at `0.1` because nothing could create one.

**The branches live in one body because the storage model requires it.**
`executionBindings.listCurrent` keeps exactly one live binding per `stepId`, and a re-record
supersedes its predecessor. One row per branch would make each branch supersede the last, leaving a
decision bound to whichever branch happened to be demonstrated most recently.

**Branches are matched by the reviewer's own condition text, never by position.**
`validateBindingAgainstStep` gained `BRANCH_MISMATCH`: a decision binding is valid only when its
`when` values are exactly the set the graph step declares — no extras, none missing, reported in both
directions. The compiler re-checks the same thing rather than trusting it. Position matching would
mean reordering a graph's branches silently rebinds the decision to the wrong outcome.

**The compiler emits `browser.expect_one_of`.** `decision` joined `BINDABLE_KINDS`, so it goes
through the same approved-binding and staleness gates as a fill or a click, and then compiles to one
alternative per graph branch: `whenVisible` from that branch's binding locator (through the same
`locatorFromChain` used for every other step), `next` from the graph branch's own `nextStepId`. It
refuses `missing_branch_binding` for a branch nobody demonstrated and `unresolved_branch_target` for
a branch naming a step the workflow does not have. `branching_unsupported` is gone;
`manual_review_unsupported` is unchanged.

**`BINDABLE_KINDS` now has one definition.** The compiler owns it; `publish-bound-document-service.ts`
and the API's binding-session registry import it via `@orbit/sop-service`. All three previously held
hand-copied literals, and a kind the compiler requires but a session refuses to bind is a workflow
that can never be published, with nothing saying why. Watchtower keeps its own literal on purpose —
importing the compiler would pull `node:crypto` and a database checksum into a browser bundle, and
the client only decides what to *offer*.

**Binding a decision from Watchtower walks the branches, one at a time.** `pick` mode, so pointing
performs nothing. `BindInput` gained `branchWhen`; captures accumulate in session state keyed by the
branch text, and **nothing is written until every branch has one** — so an abandoned
half-demonstration leaves no partial binding. `BindResult.binding` and `SavedBindingView.bindingId`
are now nullable for exactly that case: reporting an id for a row that does not exist would be worse
than reporting none. Switching the targeted step clears held branch captures. `BindingSessionPanel`
shows which branch is being asked for ("Branch 1 of 2: the title is available to borrow"), how far
through the sitting is, and a save button that says whether this capture completes the binding.

The recorder CLI **refuses** a decision and says to use Watchtower instead. Its flow is one capture,
one binding; half-binding a decision from a terminal is worse than not offering it.

### Task B — A model-spend cap, in three scopes, checked before each call

**The three scopes, and their draft-time mapping** — stated in the ADR, in `budget.ts`, and here,
because at drafting time neither an agent nor a run exists:

| Scope | At drafting time | Default ceiling | Env var |
|---|---|---|---|
| **Global** | every call in the deployment | 5,000,000 tokens | `ORBIT_LLM_TOKEN_BUDGET_GLOBAL` |
| **Per agent** | every call for one SOP **document** | 500,000 tokens | `ORBIT_LLM_TOKEN_BUDGET_PER_AGENT` |
| **Per run** | one Generate: the attempt plus its one repair | 100,000 tokens | `ORBIT_LLM_TOKEN_BUDGET_PER_RUN` |

"Per agent" is per document because a document is 1:1 with the agent it will become —
`agentIdForDocument` derives that agent's id from the document id deterministically — so before
publication the two are the same thing. "Per run" is one Generate request, because that is what a run
of the drafting flow is; the repair is part of the same unit of work.

**Checked before each call, not after.** `checkModelBudget` runs before the first call and again
before the repair, against a spend total that includes the first call's real tokens. A cap enforced
afterwards is not a cap. The **most restrictive** scope that would be exceeded is the one reported —
naming the first one that happened to fail would send someone to raise a ceiling that was not
stopping them.

**Usage now travels with the proposal.** `LLMProvider.generateSopGraphProposal` returns
`{proposal, usage}`. `anthropic-provider.ts` reads `usage_metadata` off the raw `AIMessage` —
available only because `includeRaw` was already set for the repair loop's sake — defensively, since
the shape is LangChain's. A call whose usage cannot be read is charged an **assumed** size rather
than zero, and flagged `assumed: true`: a provider that stops reporting usage must not silently
become free.

**The ledger is one row per provider *call*.** `model_usage`, added by migration
`0006_model_usage_ledger`, carries the request id (the per-run scope), a nullable document id, the
provider, the model, input and output tokens, an estimated cost in integer micro-USD, and which
attempt it was. There is no stored running total anywhere — every scope is a `SUM` over these rows,
so the number a budget is enforced against and the number a person is shown come from the same place.
The repository is append-only: no update and no delete, except `attachDocument`, which only ever
fills in a null.

**A brand-new document's first call is recorded unattributed and adopted afterwards.** At the moment
that call is made no document exists — one is created only if the draft is valid — so the rows are
written with a null document id and the transaction that creates the document adopts its own
request's unattributed rows. A test asserts `attachDocument` cannot move spend between documents.

**Calls are recorded whatever became of the draft.** Written before the outcome is decided and
outside the transaction that persists the revision, so a run of invalid drafts appears in the ledger
rather than vanishing.

**A repair refused mid-request returns both facts.** `budget_exhausted_before_repair` carries the
invalid draft's own validation issues *and* the budget reason, and reaches the client as **429** with
both. Never a silent half-result, never a charged call that was not allowed. The API separates it
from the 422 that means the model produced something unusable, because the two ask for different
things.

**Cost is an estimate and says so.** Per-model rates live in configuration
(`ORBIT_LLM_RATES_USD_PER_MTOK`, with defaults for the Claude models Orbit configures). Nothing
fetches a price list. Stored as integer micro-USD, because floating-point dollars summed over a
ledger stop adding up. An unpriced model is costed at a conservative non-zero fallback, not zero —
zero is the one answer that is certainly wrong and the one nobody would question.

**Budgets default to set, not to unlimited.** Removing a ceiling is spelled `unlimited`; anything
unparseable throws at boot rather than falling back, because starting with a ceiling somebody meant
to set and mistyped is the failure this must not have.

**The server is the gate; the button is a courtesy.** `GET /v1/model-usage` reports spend, cost and
per-scope headroom; `SopDraftForm` shows it and disables Generate when a scope is out. The refusal
happens in `createDraft` whether or not any UI rendered, and the read route cannot change a ceiling.

### Task C — The library demo

`borrowOrHoldGraph()` (in `@orbit/sop-graph/testing`): search the catalog by ISBN, then either borrow
the title with a member ID or place a hold on it, depending on which state the row is in. The library
portal renders a Borrow form only for an available title and a Hold form only for one on loan —
mutually exclusive and visibility-distinguishable, which is exactly what `expect_one_of` resolves.

`@orbit/agent-ir-compiler/testing` holds the bindings a person would produce by demonstrating it,
including the decision's two branches, checksummed against the graph rather than pinned.

`apps/browser-worker/src/library-borrow-or-hold.runtime.test.ts` compiles the workflow, publishes it
through the real `publishedDocumentFor`, and runs it **twice in a real Chromium against the real
library portal on port 3020** — once on `978-0-13-235088-4` (available) and once on
`978-0-201-63361-0` (on loan). Each run asserts the run status, the business outcome, that the
decision resolved to the expected `selectedAlternativeIndex` and `next`, that the branch not taken
**never ran**, and that the confirmation text was extracted. It starts the portal itself if one is
not already listening and stops only a portal it started, so it does not fight `pnpm dev`.

`docs/demo/branching-library-demo.md` explains how to run it by hand. The workflow is **not** seeded
into `orbit_dev`.

## Verification

Every command below was run on this branch, and these are its real numbers.

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | pass, no warnings |
| `pnpm format:check` | pass |
| `pnpm test` | **96 files, 1010 tests, all passing** |
| `pnpm test:db` | **23 files, 278 tests, all passing** |
| `pnpm test:runtime` | **5 files, 28 tests, all passing** |
| `pnpm test:e2e:watchtower` | **36 tests passing** |
| `pnpm test:e2e` | **9 tests passing** |
| `pnpm test:e2e:library` | **45 tests passing** |
| `pnpm check:teardown` | pass — ports 3000, 3001, 3002, 3010, 3102 free, no surviving process |

No port conflict was hit; the user's `pnpm dev` was not running during the gate, and nothing of
theirs was killed.

New tests, by claim rather than by count:

- **Branching compiles** (`packages/agent-ir-compiler/src/branching.test.ts`) — the workflow
  compiles; one alternative per branch pointing at that branch's element; `expect_one_of` granted;
  the graph is the only source of where a branch goes; refusals for an undemonstrated branch, a
  branch target that does not exist, and a decision edited since it was bound.
- **A decision binding must cover its step exactly**
  (`packages/execution-mapping/src/validate.test.ts`) — missing branch, extra branch, and a caller
  that supplied no branch conditions at all, which is refused rather than passed.
- **A decision body is assembled in graph order, and refused when incomplete**
  (`packages/sop-service/src/binding-service.test.ts`) — including that it needs no single capture.
- **The panel walks branches** (`apps/web/src/binding-session-view-model.test.ts`) — which branch is
  asked for next, progress, the instruction naming the branch, and a save label that only claims to
  save on the last one.
- **The budget stops the call before it happens** (`packages/sop-generation/src/budget.test.ts`,
  `generate.test.ts`) — including the most-restrictive-scope rule, usage accumulating across both
  attempts, the mid-session repair refusal returning the draft's issues, and an unreported usage
  being charged rather than treated as free.
- **The ledger is the only source of spend** (`packages/db/src/repositories/model-usage.db.test.ts`,
  `packages/sop-service/src/draft-service.db.test.ts`) — scopes kept apart, a document's earlier
  drafts counted against its own budget, another document's spend not counted, a call recorded even
  when its draft was thrown away, nothing persisted when the budget refuses, and `attachDocument`
  never moving spend between documents.
- **Configuration** (`apps/api/src/model-budget-env.test.ts`) — defaults are set, `unlimited` works,
  a mistyped ceiling throws.
- **The API contract** (`apps/api/src/routes/model-usage.test.ts`) — headroom reporting, uncapped
  scopes, never-negative remaining, and 429-not-422 for both budget refusals.
- **Both branches execute in a real browser**
  (`apps/browser-worker/src/library-borrow-or-hold.runtime.test.ts`).

## Defects self-caught

- **`packages/agent-ir-compiler`'s boundary test caught a comment.** A comment I wrote contained the
  string `page.`, which the "the compiler cannot act on anything" test forbids. Reworded. The test
  was right to fire, and it is a good sign that it did.
- **`body.target` was read in four places I had to find rather than guess.** Removing `target` from
  the decision body broke `projections.ts` and `compile.ts` at compile time. Rather than adding a
  non-null assertion at each, I added `bindingTargets(body)` to `@orbit/execution-mapping`, so a
  future body with different element arity breaks loudly in one place instead of silently in four.
- **`bindingBodyFor` took a mandatory `capture` a decision has no use for.** My first version passed
  a dummy capture and ignored it. Made `capture` optional, with an explicit refusal for every other
  kind when it is absent, so a decision is not the only caller quietly relying on an ignored argument.
- **The demo's first draft used member ID `M-1001`, which does not exist.** The runtime test caught
  it: both branches were selected correctly and the portal answered "No member was found for that
  ID." The real seed uses `LIB-`; the fixture and the graph's `example` were corrected.
- **The compiled candidate is `lifecycle.status: 'draft'` and the runtime executes only
  `published`.** My first runtime test failed on the profile check. Fixed by publishing through the
  real `publishedDocumentFor` rather than by forcing the field, so the test exercises a document the
  product can actually produce.

## Deviations from the brief

- **`@orbit/agent-ir-compiler` is imported by the API through `@orbit/sop-service`, not directly.**
  The brief said to extend `WATCHTOWER_BINDABLE_KINDS` and the session registry's kind set. Rather
  than editing a third hand-copied literal, the compiler's set is now re-exported through the
  composition root that already imported it. Watchtower's own literal stays a literal, for the bundle
  reason above.
- **The brief said "put the page in that state, point at the element" for the binding session; I also
  made the session refuse to write anything until every branch is covered.** The brief said "accumulate
  one capture per branch and save them as a single binding", which this satisfies; the addition is
  that an incomplete set writes nothing at all rather than a binding the compiler would then refuse.
- **Two new opaque id kinds** (`modelusage_`, `modelreq_`) were added to `@orbit/contracts`. The brief
  called for "enough to attribute a call to its generate-request"; a branded id follows the
  repository's existing convention rather than inventing a bare string key.
- **`FALLBACK_MODEL_RATE` is non-zero.** The brief said rates come from configuration. It did not say
  what an unconfigured model costs; zero would report it as free, so it is costed conservatively and
  visibly instead.

## Known limitations

- **A decision's fingerprints are not re-verified at run time.** `verifyBinding` runs before an
  action or a read; `browser.expect_one_of` resolves by visibility and does not call it. A branch
  locator that had drifted onto a different element would be selected rather than refused. Fixing
  this means changing `packages/runtime`, which the brief forbade — correctly, and it is recorded in
  ADR-029 rather than left to be discovered.
- **The business outcome vocabulary is still Phase 1's two values.** The demo maps
  `borrowed → request_found` and `held → request_not_found`, which is semantically poor. The run
  status and the branch taken are exact; the outcome *name* is a placeholder. Widening that is a
  change to a frozen Agent IR contract and was out of scope.
- **A decision cannot be bound from the recorder CLI.** It refuses and points at Watchtower.
- **A decision cannot be *created* by recording.** `@orbit/sop-recording`'s translator is unchanged
  and untouched: a recording is linear and cannot produce a branch nobody took. Decisions come from
  an AI draft or from editing one.
- **The escalation-review reference workflow still does not compile.** Three of its steps route to a
  person and its decisions have no bindings. Branching is no longer the obstacle, and the test that
  pins this now says so.
- **`ASSUMED_TOKENS_PER_CALL` is a flat 8,000.** A cap can therefore be reached slightly early, and a
  single call larger than the assumption can overshoot its ceiling. Both are stated; a cap reached
  early is a budget working, and the ledger records what actually happened either way.
- **Spend is summed on every Generate.** Two `SUM` queries per request, indexed, over a table that
  grows by at most two rows per draft. Fine at this scale, and not something to notice yet.
- **A deployment upgrading to this version gains ceilings it did not have.** Intended; the defaults
  are generous, and raising one is a single environment variable.
- **`GET /v1/model-usage` has no authorization**, like every other route in this phase.

## Files

**Created** — `packages/agent-ir-compiler/src/branching.test.ts`;
`packages/agent-ir-compiler/src/testing/{index,library-demo}.ts`;
`packages/sop-generation/src/{budget.ts,budget.test.ts}`;
`packages/db/src/schema/model-usage.ts`; `packages/db/src/mappers/model-usage.ts`;
`packages/db/src/repositories/{model-usage.ts,model-usage.db.test.ts}`;
`packages/db/drizzle/0006_model_usage_ledger.sql` and its snapshot;
`apps/api/src/{model-budget-env.ts,model-budget-env.test.ts}`;
`apps/api/src/routes/{model-usage.ts,model-usage.test.ts}`;
`apps/browser-worker/src/library-borrow-or-hold.runtime.test.ts`;
`docs/demo/branching-library-demo.md`; this report.

**Modified** — `packages/execution-mapping/src/{binding,validate}.ts` and their tests and fixtures;
`packages/agent-ir-compiler/src/{compile,refusals}.ts` and their tests, plus its `package.json`;
`packages/sop-service/src/{binding-service,draft-service,publish-bound-document-service}.ts` and
their tests; `packages/sop-generation/src/{provider,anthropic-provider,generate,index}.ts`,
`src/testing/fake-provider.ts` and `generate.test.ts`; `packages/sop-graph/src/testing/fixtures.ts`;
`packages/sop-recording/src/translate.test.ts`; `packages/contracts/src/{ids,generate-id}.ts`;
`packages/db/src/{schema,mappers,repositories}/index.ts`, `drizzle/meta/_journal.json`,
`src/repositories/execution-bindings.db.test.ts`;
`apps/api/src/{bootstrap,context,index,projections,server,views}.ts`,
`src/recording/binding-session-registry.ts` and its test, `src/routes/{binding-sessions,sop-drafts}.ts`
and their tests, `src/testing/stub-context.ts`, `src/api.db.test.ts`;
`apps/web/src/{App,BindingSessionPanel,SopDraftForm}.tsx`,
`src/{api-client,binding-session-view-model,sop-binding-view-model,sop-draft-view-model}.ts` and
their tests; `apps/recorder/src/cli/record-binding.ts` and `src/record-workflow.runtime.test.ts`;
`apps/browser-worker/package.json`; `docs/architecture/decisions.md` (ADR-029);
`docs/tasks/ACTIVE_TASK.md`; `pnpm-lock.yaml`.

**Untouched, as required** — `packages/runtime`, `packages/agent-ir`, `packages/executor-playwright`
(byte-identical); `packages/sop-recording/src/translate.ts`; `apps/library-portal` source and its
port; every Phase 1 table and the seeded fixture; `routes/sop-bindings.ts` and its read-only guards.
