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
