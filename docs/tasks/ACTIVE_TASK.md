# Active Task — Required Reading

**Status:** Authoritative required-reading list

**Purpose:** The documents below must be read, in order, before planning or implementing material
work in this repository — a new session, a delegated task, or a subagent picking up work. This
list does not replace `CLAUDE.md`; it is the enforceable checklist derived from it. If a document
here conflicts with `CLAUDE.md`, stop and clearly identify the conflict rather than choosing
silently.

## Required reading order

1. `CLAUDE.md` — engineering instructions, scope, architecture rules, coding standards.
2. `docs/engineering/model-routing.md` — which model owns which class of work, and the delegation
   and escalation rules between them.
3. `docs/tasks/phase-1-backlog.md` — the completed Phase 1 task sequence.
4. `docs/tasks/phase-2-sop-graph-requirements.md` — the Phase 2 direction and sub-phase
   sequence; work one approved task at a time.
5. `docs/contracts/agent-ir.md` — the Agent IR contract.
6. `docs/contracts/events-and-evidence.md` — the event envelope and artifact/evidence contract.
7. `docs/contracts/api.md` — the Phase 1 HTTP API contract, including the run-scoped
   artifact route and the evidence-access rules.
8. `docs/architecture/decisions.md` — accepted ADRs; do not silently supersede one.
9. `docs/architecture/phase-1-system-design.md` — the Phase 1 system architecture.
10. `docs/testing/phase-1-test-strategy.md` — required test layers and coverage.
11. `docs/sop/find-service-request.md` — the one Phase 1 business procedure.
12. `fixtures/find-service-request.agent.yaml` — the seeded Agent IR fixture.
13. Relevant existing source under `packages/` and `apps/` for the area being changed.
14. The most recent report under `docs/tasks/reports/` for the last completed task, for current
    state and known limitations.

## Current state

**Phase 1 is complete.** All nine tasks are merged; the deterministic proof loop runs from a clean
checkout via `pnpm dev` and is asserted by `pnpm verify:phase1`. See
`docs/tasks/reports/PHASE-1-SUMMARY-report.md`.

**Phase 2 is underway.** Sub-phases 2.1, 2.2, 2.3, **2.4a, 2.4b, 2.4f, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10,
2.11, 2.12, 2.13, 2.14 and 2.15** are complete.
`@orbit/sop-graph` provides the non-executable graph contract and its validation;
`@orbit/sop-generation` turns free text into a proposed graph; `@orbit/sop-service` persists drafts
and drives review; `@orbit/execution-mapping` defines the Execution Binding and the runtime verifies
its fingerprint before every real action; and `@orbit/execution-recorder` plus `apps/recorder`
produce bindings from a human's one-time demonstration against a sandbox. Watchtower's review page
shows, read-only, which steps have bindings and how far each got — the gap 4b's own report flagged.
Watchtower also has navigation and a Documents list, so a workflow is reachable without knowing its
id.

Four rules are binding and recorded in ADRs: only `draft` and `needs_clarification` revisions may be
changed, and every clarification question must be answered before `in_review` (**ADR-017**); a
mismatch between an approved binding and the live page stops the run rather than substituting an
element (**ADR-018**); and script injection is confined to one file, unreachable from anything that
executes an agent, with recorder/runtime fingerprint parity proven by a contract test (**ADR-019**), narrowed for one
API directory by **ADR-020**.

Binding status and staleness are reported separately: an approved binding whose step has since been
edited is still approved and still not safe to run, and `superseded` is never a current status
because supersession only happens alongside a replacement.

A whole workflow can also be recorded in one sitting: `@orbit/sop-recording` turns a captured
sequence into a linear SOP Graph with a binding per step, and `@orbit/sop-service` persists it with
`provenance.kind: 'recorded'` and bindings driven through the lifecycle to `approved`. Passwords are
never read from the page; the translator declares a `secret` input instead.

A workflow can now be recorded **from Watchtower** as well as from a terminal: `/v1/recording-sessions`
starts, polls and finishes a session in the shape run dispatch already uses, and finishing lands on
the review page for the new document. The headed browser opens on the machine running the API, which
the UI states plainly. **ADR-020** narrows ADR-019's ban on script injection in execution paths to a
single API directory rather than lifting it, and a module-graph test from the run-dispatch entry
point proves the two stay apart.

**Sub-phase 2.5 is complete.** `@orbit/agent-ir-compiler` turns a reviewed graph plus its approved
bindings into candidate Agent IR, refusing anything it cannot compile completely and naming the step
and reason for each refusal. Candidates are persisted in `agent_ir_candidates`, superseded on
recompilation, and gated behind a separate technical approval that refuses any candidate whose
sandbox readiness is `cannot_validate` — the fail-closed secret check, applied before a browser
could be launched (**ADR-021**). The reference escalation-review workflow still does not compile — but as of
sub-phase 2.8 that is because three of its steps route to a person and its decisions have no
bindings, not because branching is unsupported.

**Sub-phase 2.6 is complete.** An approved candidate publishes into a runnable Agent Version, minted
already-published rather than promoted, with `published_from_candidate_id` recording where it came
from and a check proving only the lifecycle status and the allocated version differ from what was
approved (**ADR-023**). A published agent runs through the existing route, gate and interpreter.
The review page gained a Publish action and a link out; the SOP Graph's `executable: false` is
unchanged.

**Compiling and approving a candidate now have a Watchtower surface too.** Building it surfaced a
real gap in 2.5: `compileDocument` accepted a revision in any state short of superseded, so a draft
or in-review graph could be compiled. Compiling now requires an `approved` revision, named as its
own refusal; `approve`/`reject` were converted to typed results to match every other write in the
service; and an agent's identity is derived from its document rather than supplied, so recompiling
the same workflow always lands under the same agent (**ADR-024**). A recorded workflow can now go
from Home to a running, published agent using nothing but the browser.

**Publishing a recorded workflow is now one action, not four.** `publish-recording-service.ts`
composes revision approval, compile, candidate approval, and publish behind a single
`POST /v1/sop-documents/:id/publish-recording`, refusing outright if the document was not recorded —
a drafted or AI-assisted workflow keeps the full manual review, because nothing has yet confirmed
its steps against a real page. The one judgement still asked of a person is mapping what each
declared outcome means; every governance gate the manual path enforced, including the fail-closed
sandbox-secret check, still runs in the same order and is proven byte-identical to the manual path
by an equivalence test (**ADR-025**). Watchtower's navigation also split into dedicated Agents,
Runs, and per-run pages — triggering a run leaves the page that started it for the run's own page —
and the review page's old three-button publish panel was removed along with its now-dead view-model
code.

**Agents can now be archived.** `agents.archivedAt` retires an agent's identity — hiding every
version published under it from the active catalog and blocking new runs against it — without
writing to a single `agent_versions` row; every past run and its evidence stays exactly as it was
(**ADR-026**). This is deliberately not deletion: Agent Versions stay immutable (ADR-005, ADR-014),
and the mutable field lives on the `agents` identity row that was already mutable before this task.
Archiving is symmetric (`restore` reverses it) and Watchtower offers an inline undo. Watchtower also
moved to Tailwind CSS 4.3 with a professional-SaaS visual pass — card elevation, rounded-md
interactive elements, a sticky translucent header, and a consistent focus-visible ring — with no
change to any `data-testid` or component behavior.

**A drafted workflow's steps can now be bound from Watchtower, closing the guided path's dead end.**
A generated or hand-authored graph arrived at the compiler with no Execution Bindings and was refused
`missing_binding`, and the only way to create one was the recorder CLI — a terminal, in front of
exactly the person the guided path exists for. `/v1/binding-sessions` opens a headed browser aimed at
one step, polls what was captured, re-aims the same browser at the next step, and saves a binding
created-submitted-approved in one transaction, because demonstrating the step against the page *is*
the review. **ADR-027** reverses ADR-019 for this case on the same merits ADR-020 used for
whole-workflow recording; the recorder CLI remains, and neither path is the other's fallback.

A binding session is a **sitting**, not one session per step: saving writes one row and leaves the
browser exactly where it is, because each step starts where the last left the page. That is why it is
a separate registry from recording, where finishing closes the browser — what the two share is their
hazard, a real Chromium that must not outlive the API, and that is shared as
`recording/session-store.ts`. Binding assembly moved out of the recorder CLI into
`@orbit/sop-service`, so what a real browser click means has one definition; that package still does
not import `@orbit/execution-recorder`, because a capture crosses the boundary as a plain shape.
Once every bindable step carries an approved, non-stale binding, a drafted workflow gets ADR-025's
same one-click publish through `publish-bound-document-service.ts` — the four-call sequence is now
shared as `publish-pipeline.ts`, so the recorded and bound paths differ only in their precondition.
An unbound or partly bound draft still gets no button. `routes/sop-bindings.ts` stays read-only.

**What follows**: sub-phase 2.5's own limitations remain — the escalation-review reference workflow
does not compile because branching is unsupported, and a workflow needing credentials compiles but
can never be approved. Rejecting a candidate has a service and a route but no button; recompiling
already supersedes whatever existed, which is today's actual unblock mechanism. Approving or
rejecting somebody else's binding still has no Watchtower surface, and a binding session is
in-memory: an API restart drops every open session, and only one sitting per document is allowed.
See the Task P2-001 through P2-007 reports under `docs/tasks/reports/`.

Phase 2 direction and the remaining sub-phases are in
`docs/tasks/phase-2-sop-graph-requirements.md`. Model output is untrusted input: anything a model
produces goes through `parseSopGraphDocument` before it is persisted, and Task 3 inherits the same
rule for every user edit.

**Sub-phase 2.8 is complete: a workflow can branch, and model spend is capped.**

A `decision` step now compiles, publishes and runs. Nothing in `@orbit/agent-ir`, `@orbit/runtime` or
`@orbit/executor-playwright` changed to make that true — `browser.expect_one_of` had been executable
since Phase 1. What was missing was an Execution Binding that could describe a branch, so the
`decision` body changed (additively, no migration) from `{target, readMethod, condition}` — read a
value, evaluate a predicate nothing can evaluate — to `branches: [{when, selectors, fingerprint}]`,
one demonstrated element per branch, with `EXECUTION_BINDING_SCHEMA_VERSION` at `0.2`. The branches
live in one body because a binding is keyed by step, and a row per branch would make each supersede
the last. Branches are matched to the graph by the reviewer's own condition text, never by array
position, and a binding covering anything but the exact declared set is refused (**ADR-029**).
Watchtower binds a decision by walking its branches one at a time, writing nothing until all are
covered. `BINDABLE_KINDS` now has one definition, owned by the compiler.

**Every model call is metered, and refused before it is made once a budget is spent.** Three scopes —
global, per agent (per *document* at drafting time, since a document is 1:1 with the agent it will
become), and per run (one Generate: the attempt plus its one repair) — all checked before **each**
call, with the most restrictive one reported. `model_usage` is an append-only ledger of one row per
provider *call*; every scope is a sum over it, with no running total kept anywhere else. Cost is an
estimate from configured rates and says so on every surface. Ceilings default to *set*, not
unlimited, and are configurable per scope. The server is the gate; the Generate button reflects it.
A repair refused mid-request returns the draft's own validation issues alongside the budget reason —
never a silent half-result.

**Sub-phase 2.10 is complete: a workflow declares its own outcomes, and a reviewer can add a step.**

**A business outcome is now a declared identifier, not a two-name enum.** `terminalBusinessOutcomeSchema`
was `['request_found', 'request_not_found']` — names inherited from the Phase 1 demo that every other
workflow had to map onto, so the seeded library demo published `borrowed → request_found` and recorded
the right branch under the wrong name. An outcome is now the name the workflow's own outcome step
carries, matching `^[a-z][a-z0-9_]{0,63}$`, with `none` reserved for a run that has reached no business
conclusion. The mapping concept is gone entirely: `OutcomeMapping`, the `outcomeMapping` body field on
the three publish/compile routes, and the mapping form in `SopPublishPanel`. Publishing is a button
with no question attached. **No data migrated**: `request_found` and `request_not_found` satisfy the new
grammar exactly as they satisfied the old enum, so the seeded Phase 1 agent, its fixture and every
existing `runs` row are untouched — asserted by a test against the real CHECK constraint, not assumed.
Migration `0007_free_form_business_outcomes` swaps a value-list check for a format check and touches no
row. `packages/runtime` and `packages/executor-playwright` needed no change; the library demo now
records `borrowed` and `held` end to end. Watchtower reports an outcome without judging it — the old
"attention" state for `request_not_found` is gone, because Watchtower cannot rank a stranger's business
conclusions (**ADR-030**).

**A reviewer can insert a step.** `insertStep` and `POST /v1/sop-revisions/:revisionId/steps` add a step
at a chosen position as a new revision, from an editable state only, with the whole graph re-validated.
This is the only route by which a recorded workflow can become a branching one, since the recording
translator refuses to invent a branch nobody demonstrated. Step ids are generated, never supplied.
Inserting in front of the entry step moves `entryStepId`, or the new step would be silently unreachable.
**An inserted step has no binding, so it shows as "Not recorded" and blocks publishing until somebody
demonstrates it — that is the system working, not a gap.** Deleting a step is deliberately not
implemented (**ADR-030**).

**Sub-phase 2.11 is complete: the app says what it is, a run reads as one thing, and the model is
configurable.**

**The authoring tab is Studio.** Home · Studio · Agents · Runs, in the order the work moves through
them. "Agents vs Workflows" gave two names to one idea and left neither meaning *authoring*; Studio
is this product's own word for that surface, opposite Watchtower as the observability one. The URL
value stays `?view=documents` — review links were shared before this navigation existed, and renaming
a query parameter to agree with a label breaks them for nothing (**ADR-031**).

**A run is one timeline, not three lists.** `RunPage` rendered Steps, Events and Evidence side by
side and left the reader to join them by timestamp. The join was never missing from the data:
`RunEventView.runStepId` and `ArtifactView.runStepId` both name their step. Each step now carries its
own events and its own evidence inline; run-level events (the four with a null `runStepId`) keep
their own group; the trace gets its own place; and a `browser.expect_one_of` step reports "took the
*request not found* branch, and continued at `complete_not_found`" rather than an array index. The
raw event stream is kept verbatim in a collapsed section, because the woven view is a reading aid and
the stream is the record — an event naming a step outside the run's step list appears only there.
`run-timeline-view-model.ts` holds the join as pure functions; `EvidenceList.tsx` no longer exports a
page-level list, only the group and row the timeline places under each step.

**Home is a landing page.** A hero stating what Orbit is, the two ways in as named peers, and
at-a-glance state — published agents, recent runs, what is waiting in Studio — each linking into the
tab that owns it. Read from three endpoints that already existed; none was added. A genuinely fresh
deployment (all three empty, not just one) gets one instruction instead of three empty boxes.

**The binding panel is headed "What each step does on the page"**, with a lead that explains it
without the word *binding*. The old heading, "Mapping to a real page", had to be explained three
times, and at that point the label is the defect.

**The model provider is a seam, and the default is the cheapest current Claude model.**
`createSopProvider` selects between `anthropic` (default) and `bedrock` from configuration;
`ORBIT_LLM_PROVIDER` chooses, `ORBIT_LLM_MODEL` overrides the model, and the default is
`claude-haiku-4-5` — drafting is bounded structured extraction behind a strict schema and a repair
loop, so the validator is what makes the output trustworthy, not model size. The Bedrock provider
satisfies the identical `LLMProvider` contract including Task 8's token-usage reporting, so the spend
ledger and all three budget scopes behave the same either way, and the rate table gained the
`anthropic.*` ids so a Bedrock call is not silently costed at the fallback rate. Credentials come from
the AWS default provider chain — Orbit holds none and offers no variable for one. A missing key or
region still fails on the one route that needs a model rather than at boot; a *mistyped provider
name* is the one thing that stops the API, deliberately. **Bedrock is untested against real AWS:
there are no credentials in this environment, so its correctness is structural, not demonstrated.**

**The branching demo** is `docs/demo/branching-library-demo.md`: search the library catalog, then
borrow the title or place a hold on it depending on what the page shows. Both branches are driven in
a real browser against the real library portal (port 3020) by
`apps/browser-worker/src/library-borrow-or-hold.runtime.test.ts`. It is deliberately not seeded into
`orbit_dev`.

It now also carries a **"Draft it with AI instead"** section: a ready-to-paste prompt, written in the
register a real person would use, that produces the borrow-or-hold workflow including its decision
step. The draft still needs its steps demonstrated before it can be published, and its outcomes are
its own words (ADR-030).

Known, and recorded rather than left to be discovered: a decision's fingerprints are **not**
re-verified at run time, because `expect_one_of` resolves by visibility and does not call the drift
check.

**Sub-phase 2.9 is complete: a decision can be judged by a model, bounded to an index.**

A `decision` step is now resolved one of two ways, chosen per step at review time. **Deterministic**
stays the default — the branch is bound to a demonstrated element, and it costs nothing. **Judged**
compiles to a new Agent IR step, `model.decide`, which asks a model to classify what the page *says*
into the branches the workflow already declares. That is the case deterministic branching cannot
reach: the same meaning arriving in different words, with the declared outcome set unchanged
(**ADR-032**).

**The bound is the whole design. The widest thing a model does at run time is pick a number between 0
and n−1.** It returns an index into a closed list the runtime already holds; nothing it returns
becomes a locator, URL, selector, expression or step id, and it is never shown where an alternative
leads. `next` comes from the step definition. The rationale is recorded as evidence and read by no
code path — asserted directly, with a rationale that names the other branch and its step id.

**`packages/runtime` gained a port, not a provider.** It declares `DecisionJudge` and depends on
nothing new; `@orbit/decision-judge` holds the model client; `apps/browser-worker` wires them, exactly
as it wires `@orbit/executor-playwright` behind `BrowserExecutor`. A boundary test walks the whole
workspace closure to prove the runtime reaches no provider transitively.

**Every failure halts the run, with five distinguishable reasons**: `DECISION_JUDGE_UNAVAILABLE`,
`DECISION_JUDGE_FAILED`, `DECISION_OUT_OF_SET`, `DECISION_LOW_CONFIDENCE`,
`DECISION_BUDGET_EXHAUSTED`. No default branch, no retry into a different answer. A confidence
threshold is per step over a conservative deployment default, and a *missing* confidence fails closed.

**One budget definition and one ledger.** `@orbit/model-budget` was extracted from
`@orbit/sop-generation` with `run` and `agent` scopes added; `model_usage` gained nullable `run_id`
and `agent_version_id`; every scope is still a `SUM` over the same append-only rows, checked before
each call. The per-agent scope joins through to the *agent*, so republishing does not clear a cap.

**Schema version moved to `0.2`, and every `0.1` agent runs unchanged** — the compiler emits `0.2`
only for a workflow that actually uses the widened contract, and `verify:phase1` is the check.

Two limitations are recorded rather than papered over, both because the compiler *cannot* detect
them: a judged decision's alternatives must partition the cases and nothing checks that they do, and
they must also partition what each branch can then *do* — the demo gets the second wrong on purpose
and its test says so. Redaction of page text before it reaches a model is a reduction, not a
guarantee. See `docs/demo/judged-decision-demo.md`.

**Task 12 is complete: bounded recovery from UI drift (ADR-033).** When a run stops on drift, Orbit
can now say — deterministically, with no model call — that the approved test id stopped resolving
while the same binding's `role_and_name` fallback still finds the element that was approved. It
writes a **proposal** against the workflow document, which a person accepts in Studio; accepting
creates a binding through the ordinary lifecycle and supersedes the drifted one. **The run that met
the drift still fails and stays failed**, and no code path applies a proposal. Recovery is granted
per document (`permissions.recovery`, compiled into each published version) and is Tier 1
`recommend` under ADR-013; an agent without the grant is not even probed. When narrowing leaves more
than one plausible candidate, Orbit proposes nothing and asks for a re-demonstration. The model seam
is declared and inert — `diagnoseDrift` is synchronous, so it cannot call one — and no spend exists
to record. See `docs/demo/drift-recovery-demo.md`.

Two things this task turned on for the first time, both worth knowing before touching adjacent code:
the **drift check now runs in production runs** (`createDatabaseExecutionBindingResolver` is wired
into both composition roots; it had never been supplied a binding outside tests), and an approved
locator that resolves to *nothing* is now typed drift rather than a raw executor timeout. Wiring it
immediately found wrong data — several library-demo fixture fingerprints were guesses that had never
been compared to the portal, and are now measured through `describeElement`. It also found that
`@orbit/db` keeps its own copy of the event-type vocabulary; the two lists are now pinned equal by a
test.

### Where the pieces live

| Concern | Owner |
|---|---|
| Persistence, migrations, repositories | `@orbit/db` (Task 4) |
| Artifact bytes and their containment | `@orbit/artifacts`, `@orbit/artifact-service` (Task 5, ADR-015) |
| Agent IR interpretation | `@orbit/runtime` over the `BrowserExecutor` and `RunStore` ports (Task 6) |
| Browser actions | `@orbit/executor-playwright` (Task 6) |
| HTTP surface and run dispatch | `apps/api` (Tasks 7–8) |
| Trigger and evidence console | `apps/web` (Tasks 7–8) |
| SOP Graph contract, validation, reorder rules | `@orbit/sop-graph` (Phase 2 Task 1) |
| SOP document, revision, and provenance persistence | `@orbit/db` (Phase 2 Task 1) |
| Model spend caps, scopes and rate estimates | `@orbit/model-budget` (Phase 2 Task 9) |
| Judged-decision provider, prompt and ledger write | `@orbit/decision-judge` (Phase 2 Task 9) |
| Judged-decision interpretation and refusal | `@orbit/runtime` over the `DecisionJudge` port (Phase 2 Task 9) |
| Drift diagnosis and proposal writing | `@orbit/drift-recovery` (Phase 2 Task 12, ADR-033) |
| Drift observation at the moment it happens | `@orbit/runtime` over the `RecoveryProposer` port (Phase 2 Task 12) |
| Accepting or dismissing a proposal, and the per-document grant | `@orbit/sop-service` (Phase 2 Task 12) |
| Aligning one walkthrough against a drafted workflow's unbound steps | `@orbit/sop-recording` (Phase 2 Task 14, ADR-035) |
| Forking a finished workflow into a new editable revision | `@orbit/sop-service` (Phase 2 Task 15, ADR-036) |
| Turning that alignment into validated proposals | `@orbit/sop-service` (Phase 2 Task 14) |
| Which model family is called, how it is reached, and with which credential | `@orbit/model-provider` (Phase 2 Task 13, ADR-034) |

`prepareExecution` in `@orbit/runtime` is the single validation gate the API and the browser-worker
CLI both use.

**Sub-phase 2.13 is complete.** Every model call in Orbit — drafting, judged decisions, and
authoring advice — now resolves through one selection layer, `@orbit/model-provider`. Two
independent axes: `LLM_PROVIDER` chooses the family (`anthropic` or `gemini`) and `LLM_INVOCATION`
chooses how it is reached (`direct` or `bedrock`), so direct-on-a-laptop and through-Bedrock-in-
production is a deployment setting rather than a code change. `gemini` + `bedrock` is refused at
startup, because Bedrock does not serve Gemini. `ORBIT_LLM_PROVIDER` / `ORBIT_LLM_MODEL` are
honoured as deprecated aliases that translate to the new axes. `@orbit/runtime` still cannot reach
a provider, and the boundary test that proves it now names the shared package too (**ADR-034**).
Gemini and Bedrock are structurally verified and **not** exercised against a real service — there
are no Google or AWS credentials in this environment.

**Sub-phase 2.14 is complete: a whole workflow is bound from one walkthrough.**

A drafted workflow arrives with every step unbound, and the per-step flow (ADR-027) meant nine
sittings for the seeded library workflow — open a browser, perform one action, save, re-aim. It can
now be bound by **performing the task once**: `/v1/walkthrough-sessions` opens one browser, the
person does the job, and `alignDemonstration` lines what they did up against the steps still
waiting. Matching is on **kind and order only** — the first `fill` performed is the first unbound
`fill` in the workflow — and the function is synchronous, so no model can be called from it.

Static matching of drafted hints against the page was considered and does not work: **most of the
elements a workflow acts on do not exist until you have interacted with the page**, so a scan of the
start URL could bind one library step of nine and would have to guess the rest.

**Nothing is applied.** A walkthrough writes *proposals*, reusing ADR-033's machinery rather than
paralleling it: `binding_recovery_proposals` gained an `origin` column (`drift` | `demonstration`)
and a nullable `proposed_for_binding_id`, and accepting still runs `create` → `submitForReview` →
`approve` through `acceptRecoveryProposal`. **There is still exactly one function by which a binding
is ever created.** Migration `0010_proposals_from_demonstration` alters two columns and touches no
row.

**Decisions are excluded deliberately and permanently**, and the UI says so before anyone starts:
one walkthrough follows one path and a decision needs an element per branch (ADR-029). They keep the
branch-by-branch flow, and the per-step flow is otherwise untouched — it is how a wrong proposal is
corrected. The review screen shows every drafted step with what was proposed for it and, for the
steps that got nothing, **why**; accepting is available individually and in bulk.

The known sharp edge, recorded rather than left to be discovered: **a second walkthrough over a
partly-bound branching workflow misaligns.** The walkthrough re-performs the bound prefix while
alignment is offered only the unbound steps, so the library workflow's hold branch is offered the
search box for its member-ID step. It is visibly wrong in review, which is what review is for, and
`docs/demo/walkthrough-binding-demo.md` says to bind the second branch per step. A greedy alignment
that is predictably wrong was preferred to an optimal one that is unpredictably right (**ADR-035**).

`pnpm db:seed:library:unbound` seeds the branching workflow with no bindings, which is what the
walkthrough demo needs; the ordinary `db:seed:library` still seeds it bound for the branching and
drift demos.

**Home now offers recording first and describing second.** Content unchanged, order swapped; nothing
asserted their order before, so the e2e suite now pins it.

**Sub-phase 2.15 is complete: a published workflow has a next version, and the review page has one
shape per phase.**

**Revising forks; it does not reopen (ADR-036).** `approved` has always been terminal but for
supersession, and ADR-028's one-click publish drives a workflow past the last state anyone could
have turned back from without their ever seeing it — so a published workflow was finished,
permanently. `reviseDocument` copies the current revision's graph into revision N+1 as a `draft`
with provenance `edited`, superseding the parent in the same transaction through the one
`sopGraphRevisions.create({ ..., parentRevisionId })` path every edit already uses. The approved
revision is kept exactly as it was approved, because a live, immutable Agent Version was compiled
from it (ADR-005, ADR-014). `POST /v1/sop-documents/:documentId/revisions`; revising something
already editable is refused as `already_editable`, typed, not thrown.

**Forking is cheap, and the whole feature rests on it.** Binding staleness is
`binding.stepSha256 !== stepChecksum(step)` and a binding row is keyed by `(document, step)` —
neither knows what a revision is — so a byte-identical fork leaves every binding approved and fresh.
Only a step somebody then actually edits goes stale. Asserted directly, not assumed: checksum
equality across the fork, a real persisted approved binding still passing `isBindingUsable`
afterwards, and an end-to-end publish → revise → publish loop producing two versions under one
agent.

**Publish came back for a revised document.** It was gated on `stage.kind !== 'published'`, a
complete answer only while published meant finished. `PublicationStatus` gained
`compiledFromRevisionId`, read off the candidate row that already recorded it — nothing new is
persisted — and a document whose current revision is not the one its version was compiled from is
offered Publish again. A revised *recorded* workflow publishes through the **bound** path, because
its new revision's provenance is `edited`: the recorded fast path exists because a person
demonstrated every action personally, which stops being true of a graph somebody has since edited.

**The review page is laid out from one derived phase.** `reviewPhase(review, bindings)` returns
`drafting`, `ready` or `published`, and the page leads with what that makes relevant — what is still
unmapped, or Publish, or what is running. Published wins over everything, because a revised document
is published *and* editable *and* fully bound at once. On a published document the binding surfaces
stay **available and collapsed, not hidden behind Revise**: binding is legal on an approved revision
and is how a drifted mapping is repaired and republished without changing any step (ADR-033). The
walkthrough offer moved **inside** the binding panel — a walkthrough is a binding action, and its
being a sibling section was most of the reported confusion. The two live workspaces, a binding
sitting and an open walkthrough, stay outside anything that collapses: each holds a real Chromium,
and a window a person cannot see is a window they cannot close.

Known and deliberate: revising and immediately republishing an unchanged fork mints a version that
behaves identically to the last one. Harmless, and not prevented.

**Task 16 is complete: the test suites fail for real reasons.** Tooling only — no product
behaviour changed, and the drift-recovery test's assertions are exactly as they were.

Three false-failure classes are closed. **A blocked reset is now a failure, not a hang**: `TRUNCATE`
needs ACCESS EXCLUSIVE on every table and PostgreSQL waits for that lock forever, so a leftover
connection did not make a suite fail — it made it stop, until a `testTimeout` expired naming the
test rather than the lock. The reset runs with a 10s `lock_timeout` and reports the other
connections to the database by pid; every test connection also carries a 30s `statement_timeout`,
carried in the startup packet rather than issued as a queued `SET`. **One heavy suite at a time is
enforced, not just documented**: `test:db`, `test:runtime` and `test:e2e:watchtower` all mutate
`orbit_test`, and each now claims an exclusive lock in global setup — a second is refused in about a
second naming the holder, instead of deleting rows out from under it and surfacing as plausible
assertion failures. A lock whose holder is dead is reclaimed. **`check:teardown` no longer fails on a
developer's own `pnpm dev`**: only ports 3010/3102, reserved for the end-to-end stack, count as a
leak; the development ports are reported and never failed on, because the suites deliberately adopt
those servers rather than replace them.

Also: `pnpm test:fast` (unit + db, browserless) is the documented middle tier; the heavy suites write
a full report to `logs/` so a failure survives a truncated terminal capture; and one runtime file's
run is bounded by `withDeadline` so a stuck browser says so instead of running out the file's clock.

Note for anyone reading the Task 16 brief: its claim that `drift-recovery.runtime.test.ts` has no
per-test truncation is **incorrect** — the file has called `useTestDatabase()` since it was written.
The real cause of the observed hang was the unbounded lock wait, which is what was fixed. See the
Task 16 report.

### Before starting Phase 2

Read the Task 16 report's limitations section first, then Task 15's, Task 14's, Task 13's, Task 12's and Task 9's. The open items carried out of Phase 1 are:
`NOT_FOUND` missing from the error taxonomy; no server-side duplicate-dispatch suppression; no
recovery for runs orphaned by a killed API process; no retention or orphan reconciliation; and
database-level enforcement of immutability and append-only still deferred (ADR-014).

## Historical task reading

`docs/architecture/task-5-artifact-storage-preflight.md` records the decisions the Task 5 plan had
to make explicit (artifact root, opaque storage keys, path traversal, symlink containment, atomic
writes, temporary-file cleanup, overwrite behavior, checksum behavior, database ordering, test
cleanup containment). It remains the reference for artifact storage behavior.

## Maintaining this file

Update the "Current state" section as tasks complete. Do not add or remove required-reading
entries without also updating `CLAUDE.md` if the change reflects a new standing document.
