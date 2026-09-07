# Orbit Architecture Decisions

**Status:** Active decisions

**Purpose:** Record the architecture decisions that guide the current implementation. Add a new decision record when a material technical or product architecture decision changes.

## How to use this file

- Do not rewrite prior decisions silently.
- Mark superseded decisions rather than deleting their history.
- Each decision should include context, decision, consequences, alternatives, and phase relevance.
- The active Phase 1 requirements override future-state architecture aspirations.

---

## ADR-001: Use a modular TypeScript monolith first

**Status:** Accepted

**Phase:** 0–3

### Context

Orbit needs Studio, Watchtower, Agent IR, SOP Graph, runtime, browser execution, artifacts, policies, and future LLM capabilities. A microservice architecture would introduce deployment, observability, contract, and operational complexity before the product loop is proven.

### Decision

Build Orbit as a modular TypeScript monolith with clear package/module boundaries. Run the browser worker as a separate process because browser execution has distinct resource and isolation needs.

### Consequences

- Faster iteration and simpler local development.
- Shared TypeScript contracts across UI, API, runtime, and tests.
- Fewer network boundaries and deployment units initially.
- Modules must remain independently testable and avoid inappropriate dependencies.
- Future extraction is possible when scaling, security, ownership, or release cadence requires it.

### Alternatives considered

| Alternative | Why not now |
|---|---|
| Microservices from day one | Too much operational and coordination overhead |
| Serverless-only architecture | Browser automation lifecycle and artifacts are less natural for the first runtime |
| Single API process containing Playwright | Weak browser isolation and poor production evolution |

---

## ADR-002: Preserve SOP Graph separately from Agent IR

**Status:** Accepted

**Phase:** Foundation onward

### Context

Business SOPs express business intent. Browser/API actions express one possible implementation. Coupling the process model directly to Playwright would make the product brittle and limit future execution adapters.

### Decision

Maintain two distinct representations:

```text
SOP Graph = business process semantics
Agent IR = typed execution plan
```

### Consequences

- SOP Graph has no Playwright selectors, browser calls, or secret values.
- Agent IR maps each execution step to source SOP Graph node IDs.
- A future API implementation can replace browser implementation without changing core business intent.
- Studio can show source-to-execution traceability.

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| SOP text passed directly to LLM/runtime | Not deterministic, diffable, testable, or governable enough |
| Direct SOP-to-Playwright script generation | Loses semantic layer and makes future implementation changes difficult |
| Playwright page object model as process model | Too implementation-specific |

---

## ADR-003: Start with deterministic browser execution

**Status:** Accepted

**Phase:** 1

### Context

Orbit will eventually support LLM understanding, decisions, and recovery. Introducing autonomous LLM browser control early would weaken reliability, evidence, policy enforcement, and debugging.

### Decision

Phase 1 browser actions are deterministic and defined in Agent IR. LLMs do not select browser actions, navigate domains, access credentials, or execute arbitrary tools.

### Consequences

- The first demo is less magical but more trustworthy.
- Failures are attributable to deterministic steps, locators, assertions, or target behavior.
- Evidence and policy foundations can mature before AI authority increases.

---

## ADR-004: Treat evidence as first-class product data

**Status:** Accepted

**Phase:** 1 onward

### Context

Orbit's differentiation is governed, inspectable execution. Logs alone cannot prove what the browser observed or why the workflow reached an outcome.

### Decision

Persist structured events and first-class artifacts for material actions. Use PostgreSQL for metadata/indexing and external artifact storage for binary data.

### Required Phase 1 evidence

- Run and step records
- Structured events
- Screenshots
- DOM snapshots
- Playwright trace
- Assertion outcomes
- Extracted values
- Typed error data

### Consequences

- Storage and redaction must be designed early.
- Watchtower can reconstruct execution from persisted data.
- Artifacts must be authorized and treated as potentially sensitive.

---

## ADR-005: Use version-pinned immutable Agent Versions

**Status:** Accepted

**Phase:** 1 onward

### Context

Operational evidence is meaningless if an old run can be reinterpreted through a changed workflow definition.

### Decision

Every run references one immutable Agent Version. Drafts may be edited, but publication creates a new immutable version.

### Consequences

- Historical evidence remains reproducible.
- Rollback is explicit.
- Diffs and test results can be associated with exact versions.
- Database schema must support agent identity separately from agent version identity.

---

## ADR-006: Separate runtime status from business outcome

**Status:** Accepted

**Phase:** 1 onward

### Context

A workflow can execute correctly and determine that a target record does not exist. That is not equivalent to a browser failure.

### Decision

Model both runtime status and business outcome.

Example:

```text
runtime status: succeeded
business outcome: request_not_found
```

### Consequences

- Watchtower can distinguish work completed correctly from technical failure.
- Retry and escalation behavior can be outcome-aware.
- Reporting is meaningful for operations teams.

---

## ADR-007: Use a restricted expression/interpolation model

**Status:** Accepted

**Phase:** 1 onward

### Context

Agent definitions need dynamic values such as `${inputs.requestNumber}`. Arbitrary JavaScript or shell evaluation would introduce a severe execution and tenant-security risk.

### Decision

Use a restricted interpolation and expression model. Phase 1 supports only declared input/variable references. Add limited typed comparisons and transforms later through approved operations.

### Consequences

- No `eval`, `Function`, arbitrary dynamic module loading, or arbitrary shell commands.
- Agent IR remains safer, portable, and easier to validate.
- Complex transformations require explicit typed steps or future adapters.

---

## ADR-008: Use Playwright behind an executor boundary

**Status:** Accepted

**Phase:** 1 onward

### Context

Playwright is the first browser implementation, but Orbit must later support API actions and potentially other execution adapters.

### Decision

Runtime depends on executor interfaces. `executor-playwright` implements approved browser action types but does not control workflow order or business outcomes.

### Consequences

- Browser execution can evolve independently.
- API executor can be added later without replacing runtime semantics.
- Playwright code must not leak into SOP Graph or generic Agent IR packages.

---

## ADR-009: Start with Watchtower as the trigger UI

**Status:** Accepted

**Phase:** 1

### Context

The earliest product value is triggering a simple agent and inspecting proof of execution. Full Studio authoring is unnecessary before runtime/evidence works.

### Decision

Watchtower is the Phase 1 manual trigger interface. Studio is introduced later for SOP authoring, review, testing, and publishing.

### Consequences

- Phase 1 can seed one SOP and Agent Version manually.
- Trigger metadata still uses a normalized Run Request to support API/webhook/schedule triggers later.
- Watchtower becomes both an operational console and initial product entry point.

---

## ADR-010: Local filesystem artifacts first, S3-compatible storage later

**Status:** Accepted

**Phase:** 1

### Context

Screenshots, traces, and DOM snapshots must be captured in the first vertical slice. Adding MinIO/S3 immediately increases local setup complexity.

### Decision

Implement an artifact storage interface. Use a local filesystem adapter in Phase 1. Add MinIO/S3-compatible implementations before shared/cloud deployment.

### Consequences

- Artifact bytes stay out of PostgreSQL.
- Migration to object storage does not change runtime/evidence contracts.
- Local artifact directory must be gitignored and access-controlled.

---

## ADR-011: No durable queue in the first vertical slice

**Status:** Accepted

**Phase:** 1

### Context

A queue is useful for independent browser workers, retries, schedules, and scaling. It is not required to prove one local manual trigger flow.

### Decision

Use an in-process run-dispatch abstraction in Phase 1. Do not couple runtime execution to HTTP request handling. Add a durable queue when asynchronous reliability, concurrency, or production triggers require it.

### Consequences

- Phase 1 remains operationally simple.
- Runtime/job interfaces must allow a future queue adapter.
- API should return a run ID promptly even if local execution begins immediately.

---

## ADR-012: Introduce LLMs as bounded structured services

**Status:** Accepted

**Phase:** 2 onward

### Context

LLMs are useful for SOP understanding, classification, extraction, and recovery proposals. They are unsafe as unrestricted tool controllers.

### Decision

All LLM outputs must be schema-constrained, versioned, validated, and routed through explicit Agent IR/policy boundaries. The LLM Gateway is a provider abstraction.

### Consequences

- No raw model output becomes executable browser/API code.
- Prompt/model metadata and output validation become evidence.
- Prompt injection and data classification must be considered before runtime LLM decisions.

---

## ADR-013: Adopt trust tiers for agent authority

**Status:** Accepted

**Phase:** 1 onward

### Context

A read-only lookup agent and a refund agent should not have equivalent controls.

### Decision

Classify agent use cases by authority tier and require stronger controls as authority increases.

```text
Tier 0: observe
Tier 1: recommend
Tier 2: prepare
Tier 3: bounded execute
Tier 4: high-impact execute
Tier 5: bounded autonomous recovery
```

### Consequences

- Phase 1 is Tier 0 only.
- Product readiness is assessed per use case/tier rather than universally.
- Policies, approval, idempotency, audits, and evaluations grow with authority.

---

## ADR-014: Enforce Agent Version immutability and event append-only in the repository layer first

**Status:** Accepted

**Phase:** 1

### Context

ADR-005 requires immutable Agent Versions, and the events contract requires an append-only event log. Both invariants can be enforced in the application layer, in the database, or in both. Database triggers are the stronger guarantee: they hold even against a stray `psql` session or a future caller that bypasses the repositories. They also add DDL that must be hand-written outside Drizzle's generated migrations, and they are only meaningful once more than one process writes to the database.

### Decision

Phase 1 enforces both invariants in `@orbit/db`:

- `AgentVersionRepository` exposes no update, publish, patch, or delete method.
- `RunEventRepository` exposes only `append` and read methods.
- Every Agent Version row stores `ir_sha256`, a checksum over the canonical JSON of its Agent IR. The checksum is recomputed on every read, so an out-of-band edit raises `DatabaseIntegrityError` instead of being executed.
- Integration tests assert all of the above, including that a tampered row is detected.

Database-level enforcement — triggers, or revoking `UPDATE`/`DELETE` from the application role — is deferred to production hardening.

### Consequences

- Phase 1 stays with a single generated migration and no hand-maintained DDL.
- The invariants are enforced wherever Orbit code writes, and violations from outside Orbit are detected on read rather than prevented on write.
- **TODO (production hardening):** add `agent_versions` and `run_events` triggers, or column-level privilege revocation, before more than one service writes to this database.
- The checksum column that makes detection possible is already in place, so adding enforcement later is additive.

### Alternatives considered

| Alternative | Why not now |
|---|---|
| Triggers in Phase 1 | Real value, but hand-written DDL and rollback complexity before any second writer exists |
| Application enforcement with no checksum | Tampering would be undetectable rather than merely unprevented |
| Append-only enforced by an event-store abstraction | More machinery than one repository interface needs at this stage |

---

## ADR-015: Contain artifact storage with a generated key grammar and exclusive publication

**Status:** Accepted

**Phase:** 1

### Context

Phase 1 writes evidence bytes — screenshots, DOM snapshots, Playwright traces — to the local filesystem (ADR-010) while PostgreSQL holds only metadata (ADR-004). Any component that turns an identifier into a filesystem path is a path-traversal surface, and evidence that can be silently overwritten or partially read is not evidence. These properties had to be decided once, in one place, rather than emerging from whatever the first adapter happened to do.

### Decision

**Keys are generated, never supplied.** An artifact storage key is an application-generated, opaque, relative identifier matching one restrictive grammar: 1–8 `/`-separated ASCII segments, each `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`, with an optional `.<ext>` on the final segment only, and a total length of at most 512 characters. Absolute paths, `.` and `..` segments, backslashes, whitespace, control characters, and non-ASCII codepoints are unrepresentable, so all of them are rejected by the same rule. Keys are validated as given and never normalized to make them pass. A backslash is never translated to `/` on any platform.

`buildArtifactStorageKey` is the only producer, emitting `runs/<runId>/<artifactId>.<ext>` or `runs/<runId>/steps/<runStepId>/<artifactId>.<ext>`. The filename is the artifact's own opaque id, so keys are unique by construction — which is also what satisfies the database's global `storage_key` uniqueness constraint without coordination between writers. No caller-supplied filename ever reaches the filesystem.

**Containment is checked three times**, because each check has a gap the others close: the grammar, a lexical check that the joined path is still under the root, and a `realpath` of the destination's parent directory immediately before the I/O call. Only the third detects a symlink planted in an intermediate directory; lexical checks cannot see symlinks. Reads additionally reject a symlinked final component via `lstat` and `O_NOFOLLOW` where the platform provides it.

**Publication is atomic and exclusive.** Bytes are written to a `.orbit-tmp-<ulid>.part` file in the destination's own directory, fsynced, then published with `link()` — not `rename()`, which silently replaces an existing file. `link()` fails with `EEXIST` instead, so completed artifact bytes are never overwritten and a reader never observes a partial file.

**Orphaned bytes are left in place.** If the byte write succeeds and metadata persistence then fails, the transaction rolls back and no `artifacts` or `artifact_links` row exists, but the bytes remain on disk. They are not deleted.

### Consequences

- Traversal, symlink escape, and overwrite are properties of one small module with one grammar, not of every caller.
- The digest and size persisted as metadata are always computed from the bytes actually written, and reads recompute rather than trust — the same posture `agent_versions.ir_sha256` already takes.
- An orphan is inert: its key embeds a freshly generated artifact id, so it can never be confused with or collide with a live artifact. A compensating delete would run inside failure handling, the least-tested path, and could race a concurrent writer.
- **Not guaranteed:** the parent directory is not fsynced, so a power loss just after publication can still lose the directory entry; hard links require the temporary file to share a filesystem with its destination, which holds only because it is written in the same directory; and a crash mid-write leaves an inert `.part` file. Nothing removes orphans or stale temporary files automatically — retention and cleanup workers are out of Phase 1 scope.
- Phase 1 defends against traversal bugs and accidents, not against a local attacker who can already rewrite the artifact root. That is stated rather than implied.
- **TODO (future phase):** a retention/garbage-collection pass reconciles orphaned bytes and stale `.part` files against `artifacts` rows.

### Alternatives considered

| Alternative | Why not |
|---|---|
| `rename()` for publication | Silently overwrites; completed evidence must not be replaceable |
| Compensating delete on metadata failure | Adds a filesystem delete to the least-tested code path, and can race a concurrent writer, to reclaim disk that costs nothing |
| Caller-supplied filenames with sanitization | Sanitization is a denylist; a generated grammar is an allowlist |
| Relying only on the database's `storage_key` uniqueness | Leaves the filesystem willing to overwrite, and surfaces the failure later than it can be detected |

---

## ADR-016: Keep the SOP Graph non-executable by construction, and version it as immutable checksummed revisions

**Status:** Accepted

**Phase:** 2

### Context

Phase 2 turns free-form text into a structured SOP Graph that a person reviews, edits, and approves. Everything after sub-phase 2.1 — generation from a language model, a review UI, execution mapping, candidate Agent IR — is built on the assumption that a graph is inert: reviewing one, editing one, or approving one cannot navigate to a URL, start a run, or touch a browser. That assumption is load-bearing for the rest of the phase, and it is the kind of property that decays quietly. A single convenient import in a later sub-phase would erode it without any test failing.

The graph is also the record of what a human approved. Sub-phase 2.3 lets reviewers edit and answer clarification questions, which means a document changes over time while an approval has to keep referring to something specific and unchanged. Phase 1 met the same requirement for Agent Versions and answered it with immutability plus a stored checksum (ADR-005, ADR-014); the question here is whether SOP Graphs should reuse that shape or invent another.

Finally, SOP Graph and Agent IR both need a restricted way for a step to name a value. Their grammars are nearly identical, which makes sharing one implementation the obvious move and, for the reason below, the wrong one.

### Decision

**The non-executable boundary is enforced four times, independently.** `@orbit/sop-graph` declares exactly one runtime dependency, Zod, so it has no route to Playwright, the runtime, a database, the filesystem, or the network. ESLint rejects those imports, plus `@orbit/agent-ir`, `@orbit/runtime`, `@orbit/executor-playwright` and `@orbit/db`. A test opens every non-test source file in the package and asserts that none contains `fetch(`, `XMLHttpRequest`, `chromium`, `playwright`, `page.`, `node:net`, `node:http`, `node:dns`, `child_process`, or a forbidden package import. A second test replaces global `fetch` with a spy that throws, then parses, validates and reorders a graph whose steps carry `urlHint` values, and asserts the spy was never called.

The redundancy is deliberate and each layer covers a different failure. The dependency surface is the strongest guarantee but says nothing about Node built-ins, which need no dependency at all. ESLint catches those, but only for import syntax it recognises and only while the rule survives future edits. The static scan catches a dynamic import, a global, or a stray `page.` that no import rule would see, but only in this package's own source. The `fetch` spy is the only one that observes actual behaviour rather than text, and it is the one that would still fail if the other three were quietly weakened. A boundary asserted once is a comment; the point is that removing it should require four deliberate acts rather than one careless one.

**A URL in a graph is an untrusted draft reference.** `urlHint` is parsed with `new URL()` for syntax and protocol only. Nothing in this task's code fetches, probes, resolves, or allowlists it. Domain policy belongs to execution mapping in sub-phase 2.4.

**Revisions are immutable, checksummed, and stored whole.** A revision holds its entire validated graph as JSONB beside `graph_sha256`, a checksum over the canonical JSON, recomputed on every read — the same posture `agent_versions.ir_sha256` already takes, and adopted here for the same reason: an artifact whose meaning can drift silently cannot serve as the record of what someone approved. A revision that no longer validates, or whose bytes no longer match, raises rather than being handed back as the reviewed document. The graph is stored as one document rather than shredded into step and branch tables because it is a versioned contract owned by `@orbit/sop-graph`, always read as a unit, and decomposing it would fork the contract and make every schema change a migration.

**An edit is a new revision, so the revision chain is the edit history.** The repository exposes no method that rewrites a stored graph. Creating a revision supersedes its parent in the same transaction, and `parent_revision_id` and `superseded_by_revision_id` are real self-referencing foreign keys: this chain *is* the record of what was reviewed and what replaced it, and Phase 1 already established that a pointer able to dangle is not a record.

**Lifecycle state lives on the revision; document status is derived.** `approved`, `rejected` and `superseded` are statements about one specific revision, not about a document, so the column belongs there. A document's current status is computed from its newest non-superseded revision rather than stored, so the two cannot disagree and no reconciliation rule is needed. Transitions are applied with the permitted prior states in the `WHERE` clause, as `runs.markRunning` already does, so a concurrent writer cannot slip between the check and the write.

**`source_text` has no update path.** "What did the user originally write?" is a question Phase 2 must always be able to answer, and it stops being answerable the moment the original can be edited in place.

**The interpolation grammar is re-implemented, not shared with Agent IR.** SOP Graph accepts a literal or exactly one whole-string `${inputs.x}` / `${variables.y}` reference — nearly the same grammar `@orbit/agent-ir` uses, deliberately duplicated. ADR-002 keeps business intent and the executable plan as two independent representations, and a shared module is a shared dependency: it would put Agent IR in the SOP Graph's import graph, defeat the boundary above, and mean a change made for an execution reason silently altering what a business draft is allowed to say. The two grammars are free to diverge, and `${result.…}`, which exists only in Agent IR's extraction step, is precisely a case where they already do.

### Consequences

- The claim "an SOP Graph cannot execute anything" is checked by the build, by lint, by a source scan, and by observed behaviour, so a later sub-phase cannot erode it accidentally.
- The four guards must each be maintained. The static scan's denylist is text matching and will need extending if a new execution surface appears; it is a floor, not a proof.
- `@orbit/sop-graph` cannot read a file or a URL, so callers own reading bytes — parsing functions take text or a decoded document, never a path.
- An approved revision stays byte-identical to what was approved, and out-of-band edits are detected on read rather than prevented on write, matching ADR-014's posture.
- Storing the graph whole means queries about individual steps open the document. That is acceptable while a graph is reviewed as a unit; it would need revisiting if step-level querying becomes a product requirement.
- Duplicating the interpolation grammar means a future change wanted in both places must be made twice. That cost is the point: it is what keeps a change to one representation from silently becoming a change to the other.
- **Not guaranteed:** nothing here prevents a *future* package from importing `@orbit/sop-graph` and doing something executable with a graph. The boundary is about what the graph package can do, not about what a caller may build on top of it; sub-phase 2.6 introduces exactly such a caller, under explicit separate approval.
- **TODO (sub-phase 2.4+):** URL scheme policy, reviewed domain allowlists, redirect handling, and read-only versus side-effecting classification, none of which exist yet.

### Alternatives considered

| Alternative | Why not |
|---|---|
| One guard (dependency surface alone) | Says nothing about Node built-ins, which need no dependency, and nothing about behaviour |
| Trusting ESLint alone | Enforces import syntax only, and is one config edit away from silently permitting everything |
| Sharing the interpolation module with `@orbit/agent-ir` | Puts the executable plan in the SOP Graph's import graph and couples business intent to execution semantics, against ADR-002 |
| Mutable graphs with a separate edit-log table | Two records of one history that can disagree; an approval could no longer point at unchanged bytes |
| Shredding the graph into step and branch tables | Forks the contract owned by `@orbit/sop-graph` and makes every contract change a migration |
| Lifecycle state stored on the document as well | Two sources of truth for one fact, immediately requiring rules for what happens when they differ |
| Lifecycle on the document only | `approved` and `superseded` are statements about a specific revision; a document-level column cannot express which one |

## ADR-017: Hold SOP review-workflow rules in the service layer, not in the revision state machine

**Status:** Accepted

**Phase:** 2

### Context

Sub-phase 2.3 lets a person review a generated SOP Graph: read it, edit steps, reorder them, answer the clarification questions the model raised, and move the revision through `draft → needs_clarification → in_review → approved/rejected`. Building that surfaced two questions the existing machinery does not answer, and cannot.

`SOP_REVISION_TRANSITIONS` (ADR-016) says which state changes are structurally possible. It permits *any* state to be superseded, because a new revision always replaces whatever came before it regardless of how far that one got. That is correct as a statement about the shape of the history — and it means nothing structural prevents an edit to an `approved` revision, which would supersede it and silently drop the document's derived status back to `draft`. An approval would quietly stop referring to anything.

Separately, the requirements document requires Orbit to raise clarification questions "instead of silently inventing missing business or browser details". Nothing so far stops a reviewer from approving a revision while those questions sit unanswered, which reintroduces exactly the failure the questions exist to prevent — one step later, and with a human signature on it.

Neither question is about which transitions exist. Both are about when taking a legal transition is appropriate.

### Decision

**Edits, reorders, and clarification answers are accepted only from `draft` and `needs_clarification`.** A reviewer looking at an `in_review` revision who spots a problem moves it back with `request_clarification` first, which is precisely what the existing `in_review → needs_clarification` edge is for. An `approved` or `rejected` revision cannot be edited at all: those states are statements about a specific reviewed artifact, and rewriting the artifact would make the statement refer to something nobody reviewed.

**A revision cannot reach `in_review` while any of its clarification questions is unanswered.** The escape hatch is answering, not bypassing: "not applicable" and "decide before execution mapping" are valid answers, because they are recorded, attributable human judgements rather than silent skips. There is deliberately no bypass flag — a flag would make the rule advisory, and an advisory version of this rule is the same as not having it.

**Both rules live in `@orbit/sop-service`, and `SOP_REVISION_TRANSITIONS` is unchanged.** The state machine stays a statement of what is structurally possible; the service layer holds what the product currently permits. Keeping them apart matters because they change for different reasons and on different timescales: the set of legal edges is a persistence contract that migrations and repositories depend on, while "must every question be answered first?" is a product judgement that later sub-phases may well revisit.

**The gate is enforced at the transition, not only reflected in the offered actions.** `availableActionsFor` withholds `submit_for_review` while questions remain, and `transition` refuses it independently. Hiding a control is a courtesy to the person using the UI; it is never what makes a rule hold.

**Offered actions are derived from the transition table rather than listed.** `availableActionsFor` filters `SOP_REVISION_ACTIONS` by `SOP_REVISION_TRANSITIONS[state]`, so the actions a caller is offered cannot drift from the ones the repository will accept. `superseded` is absent from the action vocabulary entirely: it is a consequence of editing, never something a person chooses.

### Consequences

- An approval keeps referring to the exact revision that was approved, because no path exists to edit one.
- A reviewer who wants to change an `in_review` revision must take a visible step back through `request_clarification`, which leaves the state history showing that it happened.
- Ambiguity the model flagged cannot reach `approved` unaddressed, so sub-phase 2.4's execution mapping inherits answered questions rather than open ones.
- The rules are enforced in one place and tested against real persistence, but they are **not** database constraints. A direct SQL writer, or a future service that forgets to call this one, can still violate them — the same posture ADR-014 takes for Agent Version immutability, and acceptable for the same reason: one service owns these writes today.
- Answering is write-once per revision, per the `unique(revision_id, question_id)` constraint. A changed mind is a new revision, which keeps "what did the reviewer say when they saw *this* graph?" answerable.
- **Not guaranteed:** nothing here decides what an approved SOP Graph may *become*. Turning one into an Agent Version is sub-phase 2.5 and later, under separate approval, and approval in this phase still means only that the graph describes the intended process.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Add the rules to `SOP_REVISION_TRANSITIONS` | Conflates "which edges exist" with "when is taking one appropriate"; a product judgement would become a persistence contract that migrations depend on |
| Allow editing any revision, deriving status afresh | An edit to an approved revision silently un-approves the document, and the approval stops referring to anything a person read |
| Warn about unanswered questions but allow submission | Makes the rule advisory, which is indistinguishable from not having it; flagged ambiguity reaches `approved` and then execution mapping |
| A bypass flag for unanswerable questions | Answering dismissively already covers the case, and does it with an attributable record instead of an anonymous override |
| Enforce the gate only by hiding the action in the UI | A hidden control is not an enforced rule; any non-UI caller would walk straight past it |
| Hand-roll the offered-action list in the API or UI | A second copy of the transition table, free to drift from the one the repository actually enforces |

## ADR-018: Bind SOP steps to elements with a fingerprint the runtime checks before every action

**Status:** Accepted

**Phase:** 2

### Context

An approved SOP Graph says "the field labelled Password". Nothing in it says which element on which page that is, and ADR-016 deliberately deferred the question to sub-phase 2.4. Answering it means a human demonstrating each step once against a sandbox and Orbit recording what they picked — an **Execution Binding**, which sub-phase 2.5 compiles into Agent IR and 2.6 executes.

That introduces a failure mode Phase 1 never had. Phase 1 automated one controlled portal whose markup it owned; 2.4 aims at systems that change without telling anyone. A selector can keep resolving long after the page it was recorded against has been redesigned, and the element it now finds can mean something entirely different. Clicking it would be a real action on a real system that nobody reviewed. "The locator resolved" and "the locator resolved to the thing a human approved" are different claims, and only the second is worth acting on.

Three narrowing decisions from Phase 1 stood in the way, each deliberate and each commented as such: `Locator.strategy` was a single-member enum (`test_id`); `BrowserExecutor` exposed no way to read an element's properties; and the executor had no `evaluate` and no page handle.

### Decision

**The locator vocabulary widens to a closed set: `test_id`, `role_and_name`, `label`.** CSS and XPath remain absent. The property worth protecting was never "only one strategy" — it was that no raw selector string is representable, because a selector string is a small program for walking the DOM and once one can be expressed, "no arbitrary selectors" becomes a convention rather than a property of the type. Each of the three names an element by something a person can read on the page. A binding carries an ordered chain of them, primary first, so a page that drops one attribute is still reachable by another; a single locator has nothing to fall back to.

**A binding is verified against a fingerprint before every action, deterministically.** The fingerprint records the computed ARIA role, the accessible name, the visible text, and the bounding box as they were when a human confirmed the element. Before a real `fill` or `click` the runtime compares the live page against it. No model is consulted. On a mismatch the run stops, captures evidence, and routes back to re-mapping; **the executor is never asked to find a substitute element**, because choosing a different element than the one a human approved is exactly the decision no automated part of this system may make.

**The check lives in the runtime, not the executor.** One read-only capability, `describeElement`, was added to `BrowserExecutor`; the comparison, the decision, and the fail-safe live in the interpreter, and the three methods that perform real browser actions were not modified at all. Deciding "this is drift, stop the run" is a workflow judgement, which ADR-008 reserves for the runtime. The comparison itself lives in `@orbit/execution-mapping` and is unit-testable with no browser.

**`tagName` is not in the fingerprint, and the role is read from the accessibility tree.** Reading a tag name, or a computed role from the DOM, requires `evaluate` — and keeping script injection out of the executor is worth more than one field. `locator.ariaSnapshot()` reports the *computed* role and accessible name through a first-class API. That distinction is practical, not theoretical: measured against the demo portal, **every** element returned `null` for an explicit `role` attribute while `ariaSnapshot` correctly reported `button`, `textbox` and `definition`. Reading the attribute alone would have left the role empty for most elements and gutted the drift signal.

**Text is compared for action targets and not for read targets.** A button's text is its label, so a change to it is real drift. An extract target's text is the value being extracted — `In Progress` one run, `Closed` the next — so comparing it would manufacture drift on every extract step in every workflow. Position is recorded but never blocks: layout legitimately moves.

**The wait has two phases, and only the second is bounded by a short window.**

*Phase one — waiting for the element to exist* — is the first `describeElement` call, and it is given **the step's entire timeout**, the same budget `fill` or `click` would have had on their own. Slow page loads are therefore tolerated exactly as they were before this check existed. This matters more than it looks: a drift check that is *less* patient than the action it guards would fail a page that merely took a while to render, reporting it as a changed page. The check must never be the reason a slow-but-correct run fails.

*Phase two — waiting for an element that is already on screen to settle* — is bounded to **two seconds**. Once the element is visible, the only thing still legitimately in flux is the gap between it rendering and its accessible name resolving, which is hydration-shaped and measured in hundreds of milliseconds. Spending the full step budget here would make every genuinely drifted step take fifteen seconds to fail, turning a fail-safe into a stall and pushing a run that should stop quickly toward its own deadline.

So the two-second window bounds *post-visibility settling only*, never overall page timing. The step's own timeout still caps the total, so a step configured shorter than two seconds is never overrun.

**A binding is keyed by `(document, step)`, not by revision, and carries `stepSha256`.** Sub-phase 2.3 made editing a graph routine, and keying by revision would orphan every binding whenever any unrelated step changed. The checksum of the bound step is what makes step-keying safe: when *this* step's content changes, the hash stops matching and the binding is known stale — deterministically, with nothing inferred.

**A binding has its own lifecycle table, not the SOP revision one.** `draft → needs_review → approved | rejected`, plus `superseded`. The mechanism is reused exactly — a transition table, the states permitted to reach a target, the expected state in the `WHERE` clause — but `SOP_REVISION_TRANSITIONS` is typed `Record<SopRevisionState, …>`, so reusing it would make a binding's state literally *be* a revision's state, coupling two unrelated entities; and `needs_clarification` is meaningless for a binding, which is demonstrated rather than asked.

**The `scope` field exists now and is unused.** Single-record navigation holds for everything Orbit can currently execute: the runtime has no iteration construct and Agent IR has no loop. But the SOP vocabulary already expresses cardinality decisions, so lists are coming, and adding the field after 2.5 and 2.6 had compiled against the schema would mean reworking it. One optional field now costs nothing; the rework would cost two sub-phases.

### Consequences

- An approved binding is checked on every use, so a redesigned page stops a run instead of quietly driving it into the wrong element.
- Existing agents are unaffected. Bindings are optional throughout, and an Agent Version without them takes a path byte-for-byte identical to before — which is what `pnpm verify:phase1` asserts.
- The executor gained exactly one read-only method. It still cannot evaluate script, still exposes no page handle, and still cannot express a raw selector.
- **Bindings are captured against a sandbox and trusted against production.** Where the two structurally diverge, the check fails safe — correct behaviour — but produces more false drift than real drift. Sub-phase 2.6 inherits this when it surfaces failures to an operator.
- A fingerprint is not a guarantee. A page can change in ways it does not capture — the same role, name and text on a genuinely different control. It raises the cost of an undetected substitution; it does not eliminate it.
- **Not guaranteed:** nothing here records *who* approved a binding, and the review states are enforced in the repository rather than by database triggers, matching ADR-014's posture.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Keep `test_id` as the only strategy | A single locator has no fallback, and §4's robustness ranking would have nothing to rank |
| Allow CSS/XPath selectors in bindings | Makes an arbitrary DOM-walking expression representable, which is the one property the closed vocabulary exists to prevent |
| Put the drift check inside the executor's `fill`/`click` | Puts a stop-the-run policy decision in the executor, which ADR-008 reserves for the runtime, and edits the three methods that perform real actions |
| Read the role from the `role` attribute | Measured as `null` on every element of the demo portal; would leave the role empty for most real controls |
| Use `evaluate` to read tag name and computed role | Reintroduces script injection into the executor to gain one fingerprint field |
| Compare text for every binding | Manufactures drift on every extract step, whose text is the value being extracted |
| Block on bounding-box changes | Layout legitimately moves; this would fail runs for a stylesheet edit |
| Poll for the full step timeout before declaring drift | Turns a fail-safe into a fifteen-second stall on every genuinely drifted step |
| Bound the whole check, including the visibility wait, to two seconds | Makes the drift check less patient than the action it guards, so a page that merely rendered slowly fails as though it had changed |
| Key bindings by revision | Sub-phase 2.3 made graph edits routine; every edit would orphan every binding |
| Reuse `SOP_REVISION_TRANSITIONS` for bindings | Couples two unrelated entities at the type level and imports a state (`needs_clarification`) that has no meaning for a binding |
| Defer the `scope` field until lists are supported | Exactly the schema rework the forward-compatibility requirement exists to prevent |

## ADR-019: Record Execution Bindings from a terminal, with script injection confined to one file and parity proven by test

**Status:** Accepted

**Phase:** 2

### Context

ADR-018 defined the Execution Binding and the runtime drift check, but nothing produced a binding: they were hand-authored fixtures. Sub-phase 2.4b is the human half — a person demonstrates a step once against a sandbox and Orbit records what they did.

Capturing that demonstration requires a listener inside the page. There is no way around it: a human's click is an event in the browser, and observing it means running code where the event happens. That is precisely the capability ADR-008 denies the runtime, which was the reason 2.4 was split in two — 4a's contract and drift check are deterministic and touch shared runtime code; 4b's capture engine is a second Playwright surface with fundamentally broader powers.

Three questions followed. Where does the human confirm what was captured? How much code runs inside the page? And how do two independent implementations — the recorder that writes a fingerprint and `describeElement` that later checks it — stay in agreement when one of them is frozen?

### Decision

**Recording is a CLI, not a Watchtower surface.** `pnpm record:binding`, in the shape `pnpm agent:run` already established. The human is already looking at two windows — the browser they are clicking in and the shell they started from — and driving a headed browser from a third would add a window without adding clarity. `describeStep` is a pure export of `@orbit/sop-graph`, so the terminal confirm screen calls the same renderer the review view uses; there is no second renderer and no projection layer in between.

**The cost is real and worth stating: bindings are confirmed in a terminal while SOP graphs are reviewed in Watchtower.** Two surfaces for two halves of the same workflow is a genuine seam, and someone reviewing a graph cannot see its bindings. It is accepted because a recording session is inherently local and interactive — it drives a browser on the operator's own machine — while graph review is not, and forcing them together would have meant hosting a long-lived headed browser from the API process and inventing a session lifecycle over HTTP for it. If binding review later needs to be visible alongside graph review, the artifacts are already persisted and a read-only view can be added without moving the recorder.

**The injected script marks an element and reports an event, and does nothing else.** It computes no selectors, reads no accessibility data, and makes no decisions. Everything — the role, the accessible name, the selector candidates, the verification — is derived in Node through the same first-class Playwright APIs `describeElement` uses. Anything the script derived would be a second implementation of existing logic running in the least trustworthy place available, and a page that lied about a role would change nothing: the token is looked up and the element re-derived on this side.

**Two capture modes, and the difference is behavioural.** *Action* mode listens passively and lets the event through, because demonstrating a step means actually performing it. *Pick* mode intercepts the event so that choosing a value to read performs nothing — an extract step must never fire the page's own handlers just because someone pointed at a value. Mode is a variable inside the page rather than a separate script, so switching costs nothing; an earlier version re-injected and reloaded, which silently discarded whatever the human had navigated to, putting anything past a sign-in out of reach.

**Selector candidates are verified, not guessed.** Each is checked to resolve to exactly one element *and* to the element the human picked — a locator count and an identity check, both deterministic, so no model is consulted. A capture with no uniquely-resolving candidate is refused rather than saved, because a binding whose selector reaches the wrong element is worse than no binding at all.

**The recorder is structurally unreachable from anything that executes an agent.** `@orbit/runtime`, `@orbit/executor-playwright`, `apps/api` and `apps/browser-worker` are all forbidden from importing it, enforced by lint and verified by probing each path. The process that runs agents must not be able to load script-injection code — not directly, and not through a shared dependency.

**Parity between the recorder and the runtime is proven by a contract test.** `describeElement` is frozen, so the derivation cannot be shared; two implementations must agree on the fingerprint or every binding drifts on its first real run — which would look exactly like the drift check working and would actually be the recorder being wrong. A test records a binding for an element, calls `describeElement` on that same element, and asserts `compareFingerprint` matches, for both an action target and a read target. When code cannot be shared, agreement is asserted rather than assumed.

**Two of the four assists use no model.** Ranking three known selector strategies is a fixed order, and asking which steps lack a binding is a set difference; both are exact questions, and a model would make an exact answer approximate. Semantic-mismatch and drift-recovery keep a model, in one file, and every assist is advisory: none auto-applies, none blocks a save, and none can reach the drift check's pass/fail logic. A provider failure produces no advice rather than an error, because a recording must not fail for want of a suggestion.

**`stepChecksum` lives in `@orbit/db`, next to `sha256Of`.** ADR-018 declared the field and validated against it, but nothing computed it. Putting the wrapper in the recorder would have moved the gap rather than closed it: sub-phase 2.5 lives in another package and cannot import a function out of a CLI app, so it would have reimplemented the rule from this document. `@orbit/db` already depends on `@orbit/sop-graph` and already owns `node:crypto`, so the definition sits where both can import it. There is one function, and it cannot drift.

### Consequences

- A binding can be produced by demonstration rather than hand-authored, which is what 2.5 needs to compile anything real.
- How much Orbit code runs inside a page has a one-file answer, and a test asserts it stays that way.
- The recorder cannot be loaded by any process that executes an agent, so the broader capability cannot leak into the narrower one by accident.
- Recording and graph review happen in different places. Someone reviewing a graph in Watchtower cannot see its bindings, and closing that gap is a later, additive change.
- **No authentication.** Phase 1 has none to reuse (ADR-018's discrepancy), so the recorder targets unauthenticated sandbox flows only. Anything behind a login is unreachable until session handling exists.
- **Frames and iframes are out of scope**, so an element inside one cannot be recorded.
- **An interactive CLI is only partly testable.** The capture engine and the decision logic are covered against a real browser and in isolation respectively; the terminal shell over them is thin precisely because it is not.
- **Parity is proven at one moment, not enforced forever.** The contract test fails loudly if the two derivations diverge, which is the strongest guarantee available without sharing code — but it is a test, and a test can be deleted.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Record from Watchtower, with the API hosting a headed browser | Invents a session lifecycle over HTTP for something inherently local, and adds a third window without adding clarity |
| Let the injected script compute selectors and roles | A second implementation of existing logic, running in the least trustworthy place available |
| Re-inject and reload to switch capture mode | Silently discards the page, putting anything past a sign-in out of reach |
| Let pick mode allow the click through | An extract step would fire the page's handlers merely because someone pointed at a value |
| Emit a CSS selector when nothing else resolves | Makes an arbitrary DOM-walking expression representable, which the closed vocabulary exists to prevent |
| Save a capture with no uniquely-resolving selector | A binding that reaches the wrong element is worse than no binding |
| Put the recorder in `apps/browser-worker` | The process that executes agents would then be able to load script-injection code |
| Route all four assists through a model | Makes two exact answers approximate, and widens the model surface for nothing |
| Keep `stepChecksum` in the recorder app | 2.5 cannot import from a CLI app, so it would reimplement the rule from an ADR — the gap moved, not closed |
| Trust the recorder and `describeElement` to agree | Two independent implementations of one value, with no signal when they diverge except every binding failing at once |

## ADR-020: Record from Watchtower over a session API, narrowing ADR-019's ban rather than lifting it

**Status:** Accepted

**Phase:** 2

### Context

ADR-019 put recording in a terminal and listed "record from Watchtower, with the API hosting a headed browser" as an alternative it rejected — it invents a session lifecycle over HTTP for something inherently local, and adds a window without adding clarity. That reasoning was about recording an Execution Binding: a step-by-step task, done by whoever is already deep in a shell.

Sub-phase 2.4f changed what recording is for. A recording no longer produces a binding for one step; it produces a whole SOP Graph document — someone does the task once and Orbit writes down the workflow. That is the first thing in Orbit a non-engineer would do, and it is the entry point to the review, editing and approval flow that already lives entirely in Watchtower. Reaching it through `pnpm record:workflow` puts a terminal in front of the one person the feature exists for.

So the alternative ADR-019 rejected has to be revisited, and with it the ban that made it impossible: ADR-019 forbade `apps/api` from importing the recorder at all.

### Decision

**Recording is available from Watchtower, over a session API.** `POST /v1/recording-sessions` opens one and returns an id, `GET` reports what has been recorded so far, `POST …/finish` compiles the sequence into a document, `DELETE` throws it away. The shape is run dispatch's (ADR-011) for the same reason: a recording lasts as long as a person takes, which is far longer than an HTTP request should live. Nothing is held open across the request; the id is the handle.

**ADR-019's alternative is reversed on its merits, not waved away.** Its two objections were a session lifecycle over HTTP and a third window. The first turned out to be the smaller half of the work and mirrors machinery the API already has. The second was simply wrong for this case: recording a whole workflow *starts* in Watchtower, so the browser is the second window, not the third. **The CLI remains** — ADR-019's judgement still holds for binding a single step from a shell — and neither path is the other's fallback.

**The ban is narrowed to one directory, not lifted.** `apps/api/src/recording/` may import `@orbit/execution-recorder`; nothing else in the API may. ADR-019's actual concern was that the code executing an agent must not be able to load script injection, and that is preserved exactly: lint restricts the import to that directory, and a test walks the module graph from the run-dispatch entry point and asserts it reaches the recorder at no depth. A narrowed ban is worth only its proof, so the proof is the module graph rather than a comment. `apps/browser-worker` keeps its own separate ban, unchanged and unrelaxed.

**The browser opens on the machine running the API, and the UI says so.** Someone has to see and click the page, so a headed browser needs a display where the API runs. That is a real constraint on where Orbit can be deployed rather than an implementation detail, and it is stated on the form before a recording starts — not discovered by waiting for a window that never appears.

**Only the local sandbox may be recorded.** Recording performs real clicks and real fills in a real browser, so the target is checked against the same localhost-only allowlist the runtime enforces, before a browser opens. A remote target is refused at session creation.

**A recording that cannot be compiled keeps its session open.** If the captured sequence fails validation, the session survives, the browser keeps the page, and the error says so explicitly. The alternative — close the session and report the failure — destroys work a person cannot repeat from memory, which is the one irreversible thing in the whole flow.

**Sessions are reaped when idle, and closed with the process.** A recording nobody finishes holds a Chromium open indefinitely; polling counts as activity, thirty idle minutes closes it, and API shutdown closes whatever remains. A stranded browser outliving the process that opened it is a leak, not an inconvenience.

**The end-to-end test substitutes the browser and nothing else.** A test runner has no display and no person to click, so the session factory is faked behind `src/testing/` — the same containment the fake model provider has, with a guard that now covers local modules under that directory as well as published `/testing` subpaths. The registry, the lifecycle, the translation, the validation and the persistence are all real, so what the test produces is a genuine document.

### Consequences

- Recording a workflow is reachable by the person the feature is for, in the same place the resulting document is reviewed and approved.
- Orbit's API can no longer be deployed to a machine without a display and still record. Running a recording remotely is not possible and the UI says so rather than failing obscurely.
- The property ADR-019 protected is intact and now has a module-graph proof it did not have before; what changed is the blast radius of the rule, not the rule.
- Two recording entry points exist, with different jobs — a whole workflow from Watchtower, a single step's binding from the CLI. Someone could reasonably expect either to do the other's job.
- **A recording session is process-local state.** It lives in one API process's memory, so a restart loses any session open at the time, and more than one API instance would not share them. Acceptable while the API is a single modular monolith (ADR-001); it is the first thing that breaks if that stops being true.
- **Secrets are not detected, only password fields are.** A value typed into a non-password field is captured verbatim. Anything sensitive entered somewhere Orbit cannot recognise ends up in the recorded step, and a reviewer has to catch it. Stated as an accepted risk, unsolved.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Keep recording CLI-only, per ADR-019 | Puts a terminal in front of the non-engineer the workflow-recording feature exists for |
| Lift ADR-019's recorder ban across `apps/api` | Trades away the property ADR-019 protected to solve a directory-shaped problem |
| Hold the session open for the duration of one HTTP request | A recording lasts as long as a person takes; the request would be open for minutes |
| Close the session when a recording fails to compile | Destroys work a person cannot repeat from memory — the one irreversible step in the flow |
| Let a recording session live until the process ends | An unfinished recording holds a Chromium open indefinitely |
| Run a real headed browser in the end-to-end test | No display on a test runner, and no person to click; the browser is the one thing that must be faked |
| Ship the recording UI without stating where the browser opens | Someone on a laptop pointed at a remote API waits for a window that never appears |

## ADR-021: Compile candidate Agent IR by refusing everything not fully understood, and gate approval on a fail-closed sandbox check

**Status:** Accepted

**Phase:** 2

### Context

ADR-016 kept the SOP Graph non-executable and ADR-018 defined the Execution Binding, but nothing turned either into something a runtime could execute. Sub-phase 2.5 compiles a reviewed graph plus its approved bindings into candidate Agent IR — the document 2.6 later publishes as a runnable Agent Version.

Reading the two contracts against each other surfaced gaps that no amount of careful compiling closes, because they are differences in what the two representations can express. A SOP outcome name is any identifier; Agent IR's `complete.outcome` is a closed Phase 1 enum of two values. Agent IR branches with `browser.expect_one_of`, which needs one locator per alternative; a SOP `decision` step's binding carries one element. A SOP `extract` step declares many fields; `execution_bindings` holds one current binding per step. `manual_review` has no executable form at all. And Agent IR has one value type, `string`, so four of the SOP input types cannot be carried.

A compiler facing gaps like these has two options: emit something approximate, or refuse. The first is worse than it sounds — a candidate that silently does less than the document says is a workflow whose approval means something different from what the approver read.

### Decision

**The compiler refuses far more than it accepts, and every refusal names a step and a reason.** "Why can my workflow not run?" is the entire product surface of this sub-phase, so "compilation failed" is not an answer. Refusals are collected rather than thrown one at a time: somebody fixing a recorded workflow wants the whole list, not to rediscover the next problem after every edit.

**Branching is refused, not approximated.** 2.5 compiles linear graphs only. The alternative was widening the frozen binding schema to carry a target per branch, which is a contract change made to serve a compiler. A recorded workflow is linear by construction (ADR-019), so this compiles everything recording can produce. **The cost is explicit: the reference escalation-review workflow — the requirements document's own worked example — does not compile, and a test asserts that refusal rather than leaving it to prose.**

**Outcome mapping is carried on the candidate, not on the graph.** A SOP outcome name is business vocabulary; `request_found` is Agent IR's. Putting the mapping on the SOP document would push an execution concern into a business artifact, which ADR-002 exists to prevent; widening the Phase 1 enum would change a contract for one workflow's convenience. So the mapping is part of the compilation record — chosen by a person, stored with the candidate, and part of what approving that candidate approves.

**The compiler's own output is untrusted input.** It goes through the real `parseAgentIrDocument` before being returned, exactly as a model's output goes through `parseSopGraphDocument`. Code that produces a document is not thereby entitled to assume the document is valid.

**Sandbox validation is a precondition, not a guard.** A recorded sign-in compiles to a fill whose value is `${inputs.password}`, and Phase 1 has no runtime secret resolution. The readiness check walks the candidate *before anything launches a browser* and, if any step needs a secret, reports `cannot_validate` and launches nothing. A per-step guard would mean discovering the problem with a browser already open on a real credential field — the exact moment when typing a placeholder into it looks like a reasonable repair. There is no path on which a password field is reached with nothing to give it, because no field is reached.

**`cannot_validate` is a distinct state from a failure.** A workflow nobody could check was never tried, and recording that as a failure would suggest something was attempted and did not work — untrue in the one place where precision matters most, the record of what a person approved.

**Approval requires readiness, and the check lives in the repository.** A candidate that could not be checked cannot be approved. That rule sits at the persistence layer rather than in a service because it is the only thing between a compiled proposal and something 2.6 will publish, and a guard that can be bypassed by calling a different function is not a guard. Rejection has no such precondition: refusing something unverifiable is exactly what a reviewer should be able to do.

**The compiler is pure, and imports the one checksum definition structurally.** `@orbit/db/checksum` is a subpath carrying `node:crypto` and a type import, so importing it yields a hash function rather than a database — which is what ADR-019's "there is one function, and both import it" actually promised. Lint bans `@orbit/db` by exact path so the subpath stays reachable, and the ban was probed to confirm it fires. The host allowlist could not be handled the same way, since its one definition lives in `@orbit/runtime`, which a pure compiler must not import; it is passed in, supplied from exactly one place, and that place re-exports rather than redeclares it.

**A candidate is derived, never authored.** Its first state is `compiled`, not `draft`. Nobody writes one and nobody edits one: recompiling produces a new candidate that supersedes its predecessor in the same transaction, exactly as a re-recording supersedes a binding and an edit supersedes a revision.

### Consequences

- A reviewed workflow can become a typed, validated candidate agent, which is what 2.6 needs to publish anything.
- Every reason a workflow cannot yet run is a named refusal against a named step, rather than a failure a person has to interpret.
- **The escalation-review reference workflow does not compile.** Branch support is a later task, and the requirements document's worked example is the thing waiting on it.
- **A workflow needing credentials can be compiled but never approved.** That is the intended shape — the work is not lost, and it cannot proceed — but it is a dead end until credential handling exists.
- **Four SOP input types cannot be carried.** `number`, `boolean`, `enum` and `date` are refused, because Agent IR declares one value type.
- **Sandbox validation assesses readiness; it does not yet execute the candidate.** Actually running a candidate against a sandbox is a run, which this task excludes. The design and the fail-closed gate are here; the execution is 2.6's.
- A new opaque id prefix, `aircand_`, and a new table were added. `@orbit/contracts` was otherwise untouched.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Widen the binding schema so a decision can carry a target per branch | Changes a frozen contract to serve a compiler, before anything can produce such a binding |
| Widen `terminalBusinessOutcomeSchema` to accept any SOP outcome name | Changes a Phase 1 contract for one workflow's convenience, and removes the only thing forcing a person to say what an outcome means |
| Put the outcome mapping on the SOP document | Pushes an execution concern into a business artifact, which ADR-002 exists to prevent |
| Compile a multi-field extract using the one binding it has | Silently drops declared fields, so approving the candidate approves less than the document says |
| Trust the compiler's own output as valid Agent IR | Code that produces a document is not thereby entitled to assume it is valid |
| Check for unresolvable secrets per step, during validation | Discovers the problem with a browser already open on a real credential field |
| Record "could not validate" as a validation failure | Suggests something was attempted; nothing was |
| Let a service own the approval precondition | A guard reachable around by calling another function is not a guard |
| Inject the step checksum as a function argument | Leaves one definition guaranteed only by convention, which is what ADR-019 set out to avoid |
