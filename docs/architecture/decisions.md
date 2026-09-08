# Orbit Architecture Decisions

**Status:** Active. This file is maintained continuously and is the authoritative
record of why Orbit is shaped as it is.

**Purpose:** Record the architecture decisions that guide the current implementation. Add a new decision record when a material technical or product architecture decision changes.

## How to use this file

- Do not rewrite prior decisions silently.
- Mark superseded decisions rather than deleting their history.
- Each decision should include context, decision, consequences, alternatives, and phase relevance.
- Where a decision has been amended or is only partly built, its **Status** says
  so and a note under it says which part. Read the note before treating a
  decision as describing what runs today.

## Status vocabulary

| Status | Means |
|---|---|
| **Accepted** | Decided and implemented. Describes what runs today |
| **Partially implemented** | Decided, and part of it is built. The note under the status says which part is not, and that part is forward-looking |
| **Accepted — amended by ADR-nnn** | Still in force, with one clause changed by a later decision. The note says which clause |
| **Accepted — partly superseded by ADR-nnn** | The core stands; a named mechanism in it was replaced |
| **Accepted — not exercised against …** | Decided and built, but a named path has never run against the real service it targets. The qualifier names that path |
| **Superseded by ADR-nnn** | No longer in force. Retained for history |
| **Deprecated** | In force but being retired |
| **Proposed** | Not decided. Nothing depends on it |

No ADR is currently **Superseded**, **Deprecated** or **Proposed** outright.
Every decision here still holds in its core; nine carry a qualifier.

**Nothing in this file is speculative except where a status says so.** Two
decisions describe capabilities that do not exist yet — ADR-010's S3 adapter and
ADR-013's tier-gated policy engine — and both are marked *Partially implemented*
with the unbuilt half named. ADR-034 is implemented but has never run against a
real Gemini or Bedrock service.

## Index

| ADR | Decision | Status |
|---|---|---|
| [ADR-001](#adr-001-use-a-modular-typescript-monolith-first) | Use a modular TypeScript monolith first | Accepted |
| [ADR-002](#adr-002-preserve-sop-graph-separately-from-agent-ir) | Preserve SOP Graph separately from Agent IR | Accepted |
| [ADR-003](#adr-003-start-with-deterministic-browser-execution) | Start with deterministic browser execution | Accepted — amended by ADR-032 |
| [ADR-004](#adr-004-treat-evidence-as-first-class-product-data) | Treat evidence as first-class product data | Accepted |
| [ADR-005](#adr-005-use-version-pinned-immutable-agent-versions) | Use version-pinned immutable Agent Versions | Accepted |
| [ADR-006](#adr-006-separate-runtime-status-from-business-outcome) | Separate runtime status from business outcome | Accepted — amended by ADR-030 |
| [ADR-007](#adr-007-use-a-restricted-expressioninterpolation-model) | Use a restricted expression/interpolation model | Accepted |
| [ADR-008](#adr-008-use-playwright-behind-an-executor-boundary) | Use Playwright behind an executor boundary | Accepted |
| [ADR-009](#adr-009-start-with-watchtower-as-the-trigger-ui) | Start with Watchtower as the trigger UI | Accepted — amended by ADR-031 |
| [ADR-010](#adr-010-local-filesystem-artifacts-first-s3-compatible-storage-later) | Local filesystem artifacts first, S3-compatible storage later | Partially implemented |
| [ADR-011](#adr-011-no-durable-queue-in-the-first-vertical-slice) | No durable queue in the first vertical slice | Accepted |
| [ADR-012](#adr-012-introduce-llms-as-bounded-structured-services) | Introduce LLMs as bounded structured services | Accepted |
| [ADR-013](#adr-013-adopt-trust-tiers-for-agent-authority) | Adopt trust tiers for agent authority | Partially implemented |
| [ADR-014](#adr-014-enforce-agent-version-immutability-and-event-append-only-in-the-repository-layer-first) | Enforce Agent Version immutability and event append-only in the repository layer first | Partially implemented |
| [ADR-015](#adr-015-contain-artifact-storage-with-a-generated-key-grammar-and-exclusive-publication) | Contain artifact storage with a generated key grammar and exclusive publication | Accepted |
| [ADR-016](#adr-016-keep-the-sop-graph-non-executable-by-construction-and-version-it-as-immutable-checksummed-revisions) | Keep the SOP Graph non-executable by construction, and version it as immutable checksummed revisions | Accepted |
| [ADR-017](#adr-017-hold-sop-review-workflow-rules-in-the-service-layer-not-in-the-revision-state-machine) | Hold SOP review-workflow rules in the service layer, not in the revision state machine | Accepted |
| [ADR-018](#adr-018-bind-sop-steps-to-elements-with-a-fingerprint-the-runtime-checks-before-every-action) | Bind SOP steps to elements with a fingerprint the runtime checks before every action | Accepted |
| [ADR-019](#adr-019-record-execution-bindings-from-a-terminal-with-script-injection-confined-to-one-file-and-parity-proven-by-test) | Record Execution Bindings from a terminal, with script injection confined to one file and parity proven by test | Accepted — partly superseded by ADR-020 and ADR-028 |
| [ADR-020](#adr-020-record-from-watchtower-over-a-session-api-narrowing-adr-019s-ban-rather-than-lifting-it) | Record from Watchtower over a session API, narrowing ADR-019's ban rather than lifting it | Accepted — amended by ADR-022 |
| [ADR-021](#adr-021-compile-candidate-agent-ir-by-refusing-everything-not-fully-understood-and-gate-approval-on-a-fail-closed-sandbox-check) | Compile candidate Agent IR by refusing everything not fully understood, and gate approval on a fail-closed sandbox check | Accepted |
| [ADR-022](#adr-022-contain-browser-navigation-per-agent-and-lift-the-blanket-localhost-allowlist) | Contain browser navigation per agent, and lift the blanket localhost allowlist | Accepted |
| [ADR-023](#adr-023-mint-an-agent-version-at-publication-rather-than-promoting-a-candidate-and-keep-the-sop-graph-non-executable) | Mint an Agent Version at publication rather than promoting a candidate, and keep the SOP Graph non-executable | Accepted |
| [ADR-024](#adr-024-reach-compile-and-approve-from-watchtower-and-close-the-review-lifecycle-gap-that-exposing-them-surfaced) | Reach compile and approve from Watchtower, and close the review-lifecycle gap that exposing them surfaced | Accepted |
| [ADR-025](#adr-025-collapse-review-compile-and-candidate-approval-into-one-publish-action-for-a-recorded-workflow) | Collapse review, compile, and candidate approval into one publish action for a recorded workflow | Accepted |
| [ADR-026](#adr-026-archive-an-agent-by-retiring-its-identity-never-by-deleting-or-mutating-a-version) | Archive an agent by retiring its identity, never by deleting or mutating a version | Accepted |
| [ADR-027](#adr-027-bind-a-drafted-workflows-steps-from-watchtower-in-a-sitting-that-holds-one-browser-open) | Bind a drafted workflow's steps from Watchtower, in a sitting that holds one browser open | Accepted |
| [ADR-028](#adr-028-hold-an-interaction-until-it-has-been-derived-and-stop-asking-anyone-to-approve-a-workflow) | Hold an interaction until it has been derived, and stop asking anyone to approve a workflow | Accepted |
| [ADR-029](#adr-029-bind-a-decision-per-branch-and-cap-model-spend-in-three-scopes-before-the-call) | Bind a decision per branch, and cap model spend in three scopes before the call | Accepted |
| [ADR-030](#adr-030-let-a-workflow-declare-its-own-business-outcomes-and-let-a-reviewer-add-a-step) | Let a workflow declare its own business outcomes, and let a reviewer add a step | Accepted |
| [ADR-031](#adr-031-name-the-authoring-surface-studio-and-read-a-run-as-one-timeline) | Name the authoring surface Studio, and read a run as one timeline | Accepted |
| [ADR-032](#adr-032-let-a-model-decide-a-branch-bounded-to-an-index-into-a-closed-list) | Let a model decide a branch, bounded to an index into a closed list | Accepted |
| [ADR-033](#adr-033-recover-from-ui-drift-by-proposing-a-reviewed-binding-never-by-applying-one) | Recover from UI drift by proposing a reviewed binding, never by applying one | Accepted |
| [ADR-034](#adr-034-one-selection-layer-for-every-model-call-with-family-and-invocation-as-separate-axes) | One selection layer for every model call, with family and invocation as separate axes | Accepted — not exercised against a real Gemini or Bedrock service |
| [ADR-035](#adr-035-bind-a-whole-workflow-from-one-walkthrough-by-proposing-an-alignment-nobody-has-to-trust) | Bind a whole workflow from one walkthrough, by proposing an alignment nobody has to trust | Accepted |
| [ADR-036](#adr-036-revising-a-published-workflow-forks-a-new-draft-and-binding-stays-available-without-it) | Revising a published workflow forks a new draft, and binding stays available without it | Accepted |
| [ADR-037](#adr-037-give-every-execution-surface-its-own-permission-section-addressing-vocabulary-and-evidence-set) | Give every execution surface its own permission section, addressing vocabulary, and evidence set | Accepted |

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

**Status:** Accepted — amended by ADR-032

> The decision stands: browser execution is deterministic and the runtime never improvises. ADR-032 opened exactly one hole in it — a model may choose a branch, bounded to an index into a list the workflow already declares — and that call is gated by `permissions.model` on the published version. Nothing else at run time consults a model.

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

**Status:** Accepted — amended by ADR-030

> The separation of run status from business outcome is unchanged and is load-bearing. What ADR-030 amended is the *vocabulary*: outcomes are no longer a fixed pair but names a workflow declares for itself.

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

**Status:** Accepted — amended by ADR-031

> Watchtower is still the trigger and evidence surface. This ADR's "Studio comes later" clause is satisfied: ADR-031 named the authoring surface Studio and put it in the same application, as this ADR anticipated.

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

**Status:** Partially implemented

> **Implemented:** the `ArtifactStorage` interface and its local filesystem adapter, with the generated key grammar of ADR-015.
>
> **Not implemented:** the S3-compatible adapter. It exists only as a sentence in `packages/artifacts/src/storage.ts` saying a future implementation must be able to replace the filesystem one. The seam is real and tested; the second implementation behind it does not exist. Treat S3 as forward-looking, not as available.

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

**Status:** Partially implemented

> **Implemented:** the tier vocabulary (`trustTier` in `@orbit/agent-ir`), the persisted `trust_tier` column on `agent_versions`, and a first step beyond pure observation — recovery, granted per document through `permissions.recovery` (ADR-033).
>
> **Not implemented:** any tier-gated policy engine. The compiler writes `observe` unconditionally and **nothing in the codebase branches on the value**. Containment today comes from per-agent domains (ADR-022), `permissions.model` (ADR-032) and `permissions.recovery` (ADR-033), each checked directly — not from the tier. The tiers are a designed vocabulary awaiting an engine, and should be read as forward-looking.

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

**Status:** Partially implemented

> **Implemented as decided:** immutability and append-only enforcement in the repository layer, with tests.
>
> **Still deferred:** the database-level half. There are no triggers, rules or constraints enforcing this in any migration `0000`–`0010`; a direct `UPDATE` against `agent_versions` or `run_events` in `psql` would succeed. This ADR always presented the database half as a later hardening step, and it remains one.

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

**Status:** Accepted — partly superseded by ADR-020 and ADR-028

> **Narrowed, then partly replaced, and both were deliberate.** ADR-020 narrowed the ban on script injection to one API directory rather than lifting it, so recording became reachable from Watchtower without reaching any process that executes an agent — a module-graph test proves the two stay apart. ADR-028 replaced this ADR's action mode with holding an interaction until it has been derived.
>
> What survives unchanged, and is the part that matters: **injection is confined to one file**, everything else is derived in Node through first-class Playwright APIs, and a test asserts that file is the whole of the injection surface.

**Phase:** 2

### Context

ADR-018 defined the Execution Binding and the runtime drift check, but nothing produced a binding: they were hand-authored fixtures. Sub-phase 2.4b is the human half — a person demonstrates a step once against a sandbox and Orbit records what they did.

Capturing that demonstration requires a listener inside the page. There is no way around it: a human's click is an event in the browser, and observing it means running code where the event happens. That is precisely the capability ADR-008 denies the runtime, which was the reason 2.4 was split in two — 4a's contract and drift check are deterministic and touch shared runtime code; 4b's capture engine is a second Playwright surface with fundamentally broader powers.

Three questions followed. Where does the human confirm what was captured? How much code runs inside the page? And how do two independent implementations — the recorder that writes a fingerprint and `describeElement` that later checks it — stay in agreement when one of them is frozen?

### Decision

**Recording is a CLI, not a Watchtower surface.** `pnpm record:binding`, in the shape `pnpm agent:run` already established. The human is already looking at two windows — the browser they are clicking in and the shell they started from — and driving a headed browser from a third would add a window without adding clarity. `describeStep` is a pure export of `@orbit/sop-graph`, so the terminal confirm screen calls the same renderer the review view uses; there is no second renderer and no projection layer in between.

**The cost is real and worth stating: bindings are confirmed in a terminal while SOP graphs are reviewed in Watchtower.** Two surfaces for two halves of the same workflow is a genuine seam, and someone reviewing a graph cannot see its bindings. It is accepted because a recording session is inherently local and interactive — it drives a browser on the operator's own machine — while graph review is not, and forcing them together would have meant hosting a long-lived headed browser from the API process and inventing a session lifecycle over HTTP for it. If binding review later needs to be visible alongside graph review, the artifacts are already persisted and a read-only view can be added without moving the recorder.

**The injected script marks an element and reports an event, and does nothing else.** It computes no selectors, reads no accessibility data, and makes no decisions. Everything — the role, the accessible name, the selector candidates, the verification — is derived in Node through the same first-class Playwright APIs `describeElement` uses. Anything the script derived would be a second implementation of existing logic running in the least trustworthy place available, and a page that lied about a role would change nothing: the token is looked up and the element re-derived on this side.

**Two capture modes, and the difference is behavioural.** *Action* mode lets the interaction happen, because demonstrating a step means actually performing it. *Pick* mode intercepts the event so that choosing a value to read performs nothing — an extract step must never fire the page's own handlers just because someone pointed at a value. Mode is a variable inside the page rather than a separate script, so switching costs nothing; an earlier version re-injected and reloaded, which silently discarded whatever the human had navigated to, putting anything past a sign-in out of reach. (**Superseded in part by ADR-028**: action mode originally listened passively and let the event through untouched, which lost every interaction that navigated. It now holds the interaction, waits for derivation, and replays it. What the script derives — nothing — is unchanged.)

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

**Status:** Accepted — amended by ADR-022

> The session API and the Watchtower recording flow stand. This ADR's localhost clause does not: ADR-022 lifted the blanket allowlist and replaced it with per-agent domains. Recording may now target any `http` or `https` URL, because a person is driving the browser; other protocols are still refused everywhere.

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

**Only the local sandbox may be recorded.** Recording performs real clicks and real fills in a real browser, so the target is checked against the same localhost-only allowlist the runtime enforces, before a browser opens. A remote target is refused at session creation. — *Superseded by ADR-022: recording now accepts any `http` or `https` URL, and containment moved to the `allowedDomains` each agent declares. The protocol check described here remains.*

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

## ADR-022: Contain browser navigation per agent, and lift the blanket localhost allowlist

**Status:** Accepted

**Phase:** 2

### Context

Phase 1 pinned every navigation to `localhost` through `ALLOWED_HOSTS` in `@orbit/runtime`, and `CLAUDE.md` listed external websites under explicit exclusions. That was right for what Phase 1 was: proving deterministic execution and evidence against a controlled page, where an external site changing under a run would make a real regression indistinguishable from a redesign.

Sub-phase 2.4f made recording a whole workflow the entry point for a non-engineer, and 2.5 made a reviewed workflow compile into a candidate agent. Both are useless against a demo portal — a person records the task they actually do, on the system they actually use. The first attempt to record a real site was refused by the recording route, which is what prompted revisiting this.

The important observation is that the blanket list was never the thing providing containment. Agent IR already declares `permissions.browser.allowedDomains` per version; the semantic validator checks it when a version is published, and `assertNavigable` re-checks it before every navigation. `ALLOWED_HOSTS` sat *on top* of that as a second, global ceiling.

### Decision

**Containment is per agent, through `allowedDomains`, and the blanket host list is removed.** The compiler collects every host a workflow actually opens and emits exactly those. An agent recorded against one site is permitted that site and nothing else — a *tighter* guarantee than a shared allowlist, because it is specific to the agent rather than common to all of them. The match is exact rather than a domain suffix, so a neighbouring host is refused even if a later edit puts its URL in a step.

**Recording accepts any `http` or `https` URL.** A recording is a person driving a browser and doing their job; the thing that needs containing is the agent compiled from it, which runs unattended. Both recording entry points — the Watchtower session route and the CLI — now check only the protocol.

**Protocol restrictions stay everywhere.** `file:`, `data:` and `javascript:` are not places a browser goes on somebody's behalf, and lifting a host restriction is not a reason to accept them. They are refused at the recording routes before a browser is created, and by the runtime before a navigation.

**The compiler no longer takes a host allowlist.** The `navigation_not_permitted` refusal and the `allowedHosts` input introduced in 2.5 are gone, along with `sop-service`'s `allowed-hosts.ts` re-export. What replaces them is the `allowedDomains` the compiler already derived; there is now one enforcement mechanism rather than two.

**This is a documented scope change, not a bug fix.** `CLAUDE.md` said "Phase 1 browser navigation allowlist is `localhost` only" and "Do not automate external websites in Phase 1". Both were changed deliberately and in the same commit as the code, because a standing instruction that the code silently contradicts is worse than either the old rule or the new one.

### Consequences

- A workflow can be recorded, compiled and run against the system it actually concerns, which is what makes 2.4f and 2.5 useful at all.
- Each agent carries its own, narrower permission set. The failure mode "some agent could reach some host" is replaced by "this agent may reach these hosts".
- **Orbit can now send traffic to third-party systems**, and real actions performed during a recording happen on a real service. Whether a given site may be automated is a judgement about that site — its terms, its owner, its data — and Orbit does not make it. `CLAUDE.md` now says so.
- **Nothing behind a login is reachable**, because Orbit still cannot supply a secret: such a candidate compiles, is recorded `cannot_validate`, and can never be approved (ADR-021). The credential barrier does the work the host list used to.
- **A misrecorded destination is now a real risk.** Under the old rule the worst case was reaching the wrong local page; now a recording made on the wrong site produces an agent permitted that site. The recording confirm step and graph review are where that gets caught.
- **Sandbox-versus-production drift becomes ordinary rather than theoretical.** ADR-018 noted it as a limitation when recording only ever happened against a sandbox; recording against production means the fingerprint was captured on the system it will run against, which mostly removes the problem and makes any remaining drift a real change on that site.
- The demo portal, the seeded Phase 1 agent, and `verify:phase1` are unaffected: they declare `localhost` and still get exactly `localhost`.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the blanket list and add an environment variable to widen it | A security boundary gated by a variable somebody could set by accident — the pattern rejected for the fake model provider in sub-phase 2.2 |
| Lift it for recording only | A person could record a real workflow and never run it; the wall simply moves to compile time |
| Keep a configurable global allowlist alongside per-agent domains | Two enforcement mechanisms for one property, which is how they drift apart |
| Allow domain-suffix matches in `allowedDomains` | An agent recorded on a public page would reach internal hosts under the same domain |
| Drop the protocol restriction too | `file:` and `javascript:` are not navigation, and nothing about lifting a host rule makes them so |

## ADR-023: Mint an Agent Version at publication rather than promoting a candidate, and keep the SOP Graph non-executable

**Status:** Accepted

**Phase:** 2

### Context

Sub-phase 2.5 produced candidate Agent IR: validated, checksummed, approved, and inert. 2.6 turns an approved candidate into something the runtime will execute.

One fact shapes the whole design. The compiler emits `lifecycle.status: 'draft'`, and the runtime's `SUPPORTED_LIFECYCLE_STATUSES` is `['published']` — so what is approved cannot be byte-identical to what runs. That looks like a problem to engineer around, and reading the code showed it is the opposite: if a candidate were byte-identical to a runnable version, it would be runnable *before anyone approved it*, which inverts the gate 2.5 exists to provide.

ADR-014 had already settled the mechanism: `AgentVersionRepository` deliberately exposes "no update, publish, patch, or delete method". There is no row to flip a status on.

### Decision

**Publishing mints a new artifact; it never promotes an existing one.** The Agent Version is created already-published, and its `irSha256` covers the bytes that will actually execute. Nothing is mutated, so ADR-005 immutability and ADR-014's repository-level enforcement are untouched.

**Traceability means re-derivability, not a pointer.** `published_from_candidate_id` records the link, and exactly two fields differ between the approved document and the published one — `lifecycle.status`, because the runtime requires it, and `version`, because `agent_versions` is unique on `(agent_id, version)` and the number is allocated per agent at publish time. `assertOnlyPublicationFieldsChanged` verifies this against the document actually being stored, so a widened `allowedDomains`, an added step, or a changed trust tier cannot ride along with the lifecycle change. Both checksums keep covering exactly what they claim: the candidate's the approved draft, the version's the executed document.

**The provenance column is nullable, permanently.** The seeded Phase 1 agent was published from a fixture and every version predating 2.5 has no candidate. A non-nullable column would have meant rewriting rows whose immutability is the point. The migration is a single nullable `ADD COLUMN` with no backfill and no default, and no existing row is touched.

**Versions are allocated, not supplied.** A caller-supplied version turns republishing after an edit into a collision somebody resolves by inventing a number. The version answers "which publication of this workflow is this", which the system can answer itself.

**Publishing does not make the SOP Graph executable, and the review page must not imply it does.** The document keeps `executable: false` and keeps its "draft only" notice after publication; what became runnable is a different row. The review page gains a read-only publication panel that offers one action and then *links out* to the agent. This is ADR-016 holding under the exact pressure it was written for — the moment when widening one boolean would have been the shortest path.

**Execution reuses the existing path entirely.** `assertNavigable` already reads `permissions.browser.allowedDomains` off the document, and the run route already loads any version by id and calls `prepareExecution`. A published, non-seeded agent needs no new runtime code, and ADR-022's per-agent containment holds for it unchanged: an agent recorded against one host is permitted that host, matched exactly.

### Consequences

- A recorded workflow can be published and run, which closes the loop Phase 2 set out to build.
- A candidate and the version published from it are different artifacts with different checksums, and the relationship between them is verifiable rather than asserted.
- **Home lists every published agent.** Before 2.6 it rendered `versions[0]`, which was indistinguishable from "the agent" when only the seeded one existed. Publishing makes that a real omission, so it now lists them — which also means the end-to-end stack's deliberately broken fixture agent is visible where it previously was not.
- **Compiling and approving a candidate still have no Watchtower surface.** 2.5 shipped them service-level only, so the Publish action is reachable only for candidates created outside the UI. That is the next gap, and it is stated rather than papered over.
- **`agents` gains its first non-seed writer.** Publishing upserts the agent row the version's foreign key needs. Additive, and it uses the repository's existing method.
- The schema change requires `pnpm db:migrate` against the development database, which `reset.db.test.ts` will otherwise fail on, because it deliberately connects there.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Widen `SUPPORTED_LIFECYCLE_STATUSES` to accept `draft` | That list is the gate; widening it makes every unapproved candidate runnable |
| Have the compiler emit `published` so the bytes match | An unapproved candidate would be executable-shaped, inverting 2.5's approval |
| Store the candidate's bytes and override the status on read | The checksum would no longer cover what actually executes — the worst option available |
| Move `lifecycle` out of the Agent IR document | Changes a frozen contract, and `profile.ts` reads status from the document |
| Add a `publish()` method that flips the row | Exactly the mutation ADR-014 removed, on the one table whose immutability runs depend on |
| Make `published_from_candidate_id` non-nullable | Requires rewriting or excluding the seeded agent, whose row must not change |
| Let the caller supply the version at publish time | Puts a semver decision in front of the non-engineer the recording flow exists for |
| Flip the document's `executable` flag once published | The SOP Graph is non-executable by construction; the runnable thing is a separate artifact (ADR-016) |

## ADR-024: Reach compile and approve from Watchtower, and close the review-lifecycle gap that exposing them surfaced

**Status:** Accepted

**Phase:** 2

### Context

ADR-021 and ADR-023 gave sub-phase 2.5 a compiler and a technical approval, but neither ever got a Watchtower surface: `compileDocument` and `approve` existed only as calls a test could make. The Publish action ADR-023 added was consequently reachable only for a candidate created by hand outside the browser — a review page that says "this workflow has not been turned into an agent yet" with no way to change that.

Building the missing routes required reading `compileDocument` closely enough to wire it, and that reading surfaced a real gap rather than a purely mechanical one. `sopGraphRevisions.findCurrent` returns the newest revision in *any* state short of `superseded` — draft, in review, rejected, all included. `compileDocument` called it and used whatever came back with no state check at all. Nothing had ever exercised this over HTTP, so nothing had ever needed a revision that was still being written to be refused.

A second thing fell out at the same time: `approve` and `reject` were direct pass-throughs to the repository, which throws `RecordNotFoundError`, `InvalidRunTransitionError`, and `CandidateNotValidatedError` rather than returning a typed result — consistent with nothing in the codebase, including `compileDocument` two lines above it. Every other service in `@orbit/sop-service` (`revision-service`, `publish-service`, `compileDocument` itself) returns a discriminated result; a route calling `approve` would have been the first place in the API forced to catch bare repository exceptions to avoid a raw 500 for an ordinary "not ready yet".

### Decision

**Compiling now requires the current revision to be `approved`, not merely current.** A new refusal, `revision_not_approved`, names the actual state. This is not new policy — ADR-017 already established that only `draft` and `needs_clarification` revisions may be *edited*; compiling an unapproved one into a candidate is the same lifecycle bypassed a different way, through the one caller positioned to bypass it silently because nothing had asked it to refuse before.

**`approve` and `reject` return typed results, matching every other write in this service.** Both pre-check the candidate's state so the ordinary case never throws, and both still catch the repository's own transition guard as the fallback for the race the pre-check cannot close — the same defense-in-depth `recordAnswer` was required to have in sub-phase 2.3, applied here because it is now reachable over HTTP rather than only from a test holding the only reference to a candidate.

**An agent's identity is derived from its document, not supplied.** `compileDocument` no longer takes `agentId`/`version` as caller input — a person turning a workflow into an agent should not be asked to invent an opaque identifier. The id is `agent_<document's own suffix>`, a pure function of the document id with no state of its own, so recompiling the same document after fixing a binding lands under the same agent every time. `publish-service`'s per-agent version allocation and its "already published" check both depend on that stability; a random or caller-supplied id would have silently fragmented one workflow across what looks like several agents.

**Compiling asks a reviewer to map each declared outcome to a business result, computed and shown by the server.** `SopReviewView` gained `declaredOutcomes`, deduplicated from the graph's own `outcome` steps, because the mapping is a business judgement (ADR-023) that the compiler cannot make and a reviewer should not have to derive from raw step JSON.

**Neither new route, nor the panel that calls them, touches the SOP document.** Compiling produces a candidate row; approving moves it through its own lifecycle. `executable` and the "draft only" notice are exactly as untouched as publishing already left them (ADR-023), and a test asserts it at every layer this task added: the route response, the end-to-end HTTP loop, and the browser test.

### Consequences

- A workflow can now go from a recording to a running agent using nothing but Watchtower — compile, approve, publish, run — closing the loop 2.4f through 2.6 built one service at a time.
- Compiling an unapproved revision is refused everywhere, not only through routes built after this task. Existing tests that had been compiling straight from a freshly recorded (`draft`) document were themselves exercising the gap; fixing the precondition meant teaching them to approve a revision first, the same way a reviewer would.
- `approve` and `reject`'s signatures changed from `Promise<AgentIrCandidateRecord>` to a typed result union — a breaking change contained entirely to `@orbit/sop-service` and its own two call sites, both updated in this task.
- A person compiling a workflow chooses only what each outcome *means*; the agent identity and its provisional version are no longer theirs to supply or get wrong.
- **Rejecting a candidate still has no Watchtower surface.** The route and the service support it; recompiling a document already supersedes whatever candidate existed for it, which is the actual unblock mechanism today. Adding a Reject button is deferred until a real need for it — not "nobody could check it", which recompiling already resolves — is identified.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Ship the routes without the revision-approval check | Exposes an existing gap to more callers instead of closing it; a reviewer could compile a draft they had not finished |
| Let the caller supply `agentId` at compile time | Puts an opaque identifier in front of the person the recording flow exists for, and risks the id changing across recompiles |
| Keep `approve`/`reject` throwing, catch the specific error classes in the route | Every other write in this service returns a typed result; the route becomes the one place forced to know repository-level exception types |
| Pre-check candidate state without also catching the repository's guard | Leaves the exact TOCTOU window `recordAnswer` was required to close in sub-phase 2.3, now reachable over HTTP from two concurrent requests |
| Let the client compute `declaredOutcomes` from raw step JSON | Duplicates a projection the server already owns, and couples the UI to the SOP step shape rather than a stable view |

## ADR-025: Collapse review, compile, and candidate approval into one publish action for a recorded workflow

**Status:** Accepted

**Phase:** 2

### Context

ADR-024 closed the mechanical gap — compile and approve were reachable from Watchtower — but left the UI as three separate screens: approve the revision, compile it, approve the resulting candidate, then publish. A person who had just finished recording a workflow, watching it in real time, found that sequence read as ceremony rather than review: nothing about the four clicks asked them anything they had not already answered by performing the task with their hands. Feedback on the review page itself made the same point about its own copy — "Running this workflow" as a section heading, sitting above a multi-step technical pipeline, described what the *agent* does once published, not what the button in front of the reviewer does.

A generated draft is a different case. Nothing has confirmed that a free-text description of a procedure matches what a real page actually does — that confirmation is exactly what review, compile, and candidate approval each check for in turn. Collapsing those steps for a draft would remove the only check standing between an LLM's guess and something that runs.

### Decision

**A recorded workflow gets one action: map what each outcome means, then publish.** `publish-recording-service.ts` composes the same four calls the manual path made — submit-for-review/approve the revision as needed, compile, approve the candidate, publish — behind a single `POST /v1/sop-documents/:id/publish-recording`. It refuses outright, with `not_recorded`, for any document whose current revision is not `provenance.kind === 'recorded'`; a drafted or AI-assisted document keeps the full manual path unchanged, with every screen ADR-024 built.

**Every governance gate the manual path enforced still runs, in the same order, producing the same rows.** The fail-closed sandbox-secret check (ADR-021's precondition) still blocks a candidate that cannot be validated. The revision transition rules (ADR-017) still apply — a `rejected` or `superseded` revision still refuses rather than silently reviving. Nothing is skipped; what is removed is the requirement that a person click through states a recording already vouches for. An equivalence test compiles the same recording through both the fast path and the five manual calls and asserts the resulting Agent IR — steps and permissions — are byte-identical, so "one click" is proven to mean fewer screens, not a different outcome.

**The one thing still asked of a person is preserved deliberately: what each outcome means.** `SopPublishPanel` keeps the outcome-mapping form even on the one-click path. Mapping a graph's own outcome step to `request_found` versus `request_not_found` is a business judgement ADR-023 already established the compiler cannot make; a recording proves *how* a step was performed, not what a business should call the result. This is the one place the fast path still stops and asks.

**The panel now branches on provenance, not on publication-lifecycle state.** `offersOneClickPublish` is `provenanceKind === 'recorded' && stage.kind !== 'published'` — a recorded, unpublished document gets the one-click form regardless of how far its underlying revision or candidate has already gotten (useful when a person answers the outcome mapping, the request fails, and they retry). A document that is not recorded gets an honest note that its steps cannot yet be mapped to a real page, rather than a button that can only ever be refused.

**The manual three-action UI (`onCompile`/`onApprove`/`onPublish(candidateId)`) is removed from `SopPublishPanel` entirely, not kept as a second code path behind a flag.** The routes and services behind it (`compileDocument`, `approveCandidate`, `publishCandidate`) are untouched and still independently tested at the API layer — a drafted document still uses `SopReviewPage`'s ordinary lifecycle actions to reach `approved`, then has no compile/approve/publish surface in Watchtower yet, same as before ADR-024 for that document kind. Only the recorded case gained a path; nothing regressed for the drafted case, and nothing lost test coverage — `publication-view-model.ts`'s dead `canApprove`/`canCompile`/`compileBlockedReason`/`describeCompileFailure`/`describeApproveFailure`/`describePublishFailure` were deleted along with their tests once nothing called them, rather than left as an unused second contract beside the one now in use.

### Consequences

- Recording a workflow and publishing it now takes one click past the outcome mapping, not four — the ceremony the feedback named is gone for the case that no longer needs it.
- A drafted or AI-assisted document is unaffected: it still needs a person to review, approve, compile, and approve the candidate as separate acts, because nothing has confirmed its steps against a real page yet.
- `SopReviewPage` no longer holds `compiling`/`compileFailure`/`approving`/`approveFailure` state; it holds `isPublishingRecording`/`publishRecordingFailure` instead, calling the one new endpoint.
- The end-to-end test that walks a recording to a published agent now performs one action after finishing the recording instead of four, and no longer clicks through the SOP Graph's own `submit_for_review`/`approve` actions first — publishing performs that transition itself when needed.
- **Rejecting a candidate still has no Watchtower surface**, unchanged from ADR-024 — recompiling still supersedes whatever candidate existed, which remains the practical unblock.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Keep four screens for every document, improve their copy only | Leaves the actual complaint unaddressed — a person who just performed a task is still asked to confirm a sequence they finished performing |
| Collapse the four steps for every document, recorded or not | Removes the only check standing between an ungrounded LLM draft and something that runs; ADR-021's refusal exists because a generated graph is not yet demonstrated |
| Add a "skip review" toggle a person can set per document | A configurable bypass of a governance gate is the pattern ADR-022 and ADR-021 both reject elsewhere for the same reason: a setting somebody can flip is not a property of the workflow |
| Auto-answer the outcome mapping from the graph's own step text | The mapping is a business judgement, not a fact the graph already states; guessing it wrong would misreport a run's business outcome silently |
| Keep the old three-button API surface alongside the new one, both reachable from the panel | Two contracts doing the same job invite drift, and the removed one had no caller left to justify keeping it tested |

## ADR-026: Archive an agent by retiring its identity, never by deleting or mutating a version

**Status:** Accepted

**Phase:** 2

### Context

Watchtower had no way to remove an agent from the active catalog. The request was for "delete," but Agent Versions are immutable by design (ADR-005), and `AgentVersionRepository` deliberately exposes no update, publish, patch, or delete method (ADR-014) — a run's evidence is meaningless if the definition it executed can later be reinterpreted or removed. Deleting a version row outright would either cascade-delete every run and every piece of evidence ever recorded against it, or fail on the foreign key `runs` already holds to it. Both are wrong for a product whose central claim is that a run's evidence can always be reconstructed.

### Decision

**Archiving retires the agent's identity, not any version of it.** `agents.archivedAt` is a nullable timestamp on the `agents` table — the row that already models "logical agent identity, separate from any version of it" and already outlives every version published under it. Setting it hides every version published under that agent from the active catalog (`GET /v1/agent-versions`) without writing to a single `agent_versions` row. No `agent_versions` content, checksum, or lifecycle status ever changes; no run, step, event, or artifact linked to any version of that agent is touched.

**This is not the exception ADR-014 warns about.** ADR-014's guarantee is scoped to a version's own content — the thing a run's evidence depends on being unchanged. The `agents` table was already mutable before this task (`upsert` already exists, refreshing display fields), because agent identity is not the thing runs pin; a version is. Adding `archive`/`restore` here extends an already-mutable row by one field; it does not open a mutation path on the immutable one.

**`AgentVersionRepository.listPublished()` filters against `agents.archivedAt`, in application code, not a database join.** The active catalog is: every version with `lifecycleStatus: 'published'`, whose agent is not archived. This mirrors the codebase's existing pattern of composing across tables in the repository or route layer (`toRunListItemView`'s per-run agent lookup) rather than reaching for SQL joins, and keeps `listByAgent` — used internally by publish and revision services to allocate version numbers and check "already published" — unfiltered, since those internal uses must see every version regardless of archive state.

**Archiving is symmetric.** `restore` reverses it. An accidental archive with no way back would be a footgun disproportionate to how cheap the reverse operation is; the two routes (`POST /v1/agent-versions/:id/archive`, `POST /v1/agent-versions/:id/restore`) and the Watchtower "Undo" affordance next to the confirmation exist for the same reason.

### Consequences

- An agent can be removed from the active catalog and can no longer start new runs, while every run it ever produced, and that run's full evidence, remains exactly as reconstructible as before.
- `agents` gains its second mutable field (`archivedAt`, alongside the display-field refresh `upsert` already allowed) — additive, no migration touches `agent_versions`.
- Republishing a new version under an archived agent (recompiling and republishing the same recorded document) does not implicitly restore it — the new version would also be hidden. This is a stated limitation, not solved here; nothing in this task's scope required handling it.
- `listPublished()`'s archive filter is a second query per call; acceptable at Phase 1 scale and consistent with the N+1 posture already taken for run listing.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Add a delete method to `AgentVersionRepository`, cascading to its runs | Directly violates ADR-005/ADR-014 and destroys the audit evidence the product exists to preserve |
| Add a delete method that only removes the version, restricted by the FK | Fails outright the moment any run references the version — which is every published version that has ever been run |
| Add `archivedAt` to `agent_versions` instead of `agents` | An agent with more than one published version would need every one of its version rows updated to retire the agent as a whole, turning a one-row identity change into a multi-row mutation of otherwise-immutable content |
| Filter archived agents with a SQL join in `listPublished` | No join precedent exists elsewhere in this repository layer; the existing pattern composes across tables in application code, and Phase 1 scale does not need the join's efficiency |
| Archive with no restore path | A destructive action with no undo is a worse default for a "delete" a person can trigger by mistake, for a trivially cheap reverse operation |

## ADR-027: Bind a drafted workflow's steps from Watchtower, in a sitting that holds one browser open

**Status:** Accepted

**Phase:** 2

### Context

A drafted workflow — generated from free text, or authored by hand — reaches the compiler with no Execution Bindings and is refused with `missing_binding`. ADR-019 put binding creation in the recorder CLI on the grounds that demonstrating a step needs a real browser and a person's hands, which a web page cannot supply. That was true, and it left a structural dead end: the guided path produces a workflow in Watchtower, and the only way out of the state it lands in was a terminal. The person the guided path exists for is precisely the person who does not have one.

ADR-020 had already answered the same objection for whole-workflow recording. The browser is opened by the API on the machine the API runs on, headed, and a person drives it; Watchtower is the first window and the browser is the second. Nothing about that reasoning was specific to recording an entire workflow rather than one step of one.

The second question is what a bound draft is then allowed to do. ADR-025 gave a recorded workflow one-click publish and deliberately withheld it from a draft, because nothing had confirmed a draft's steps against a real page. That reason is sound, and it is a statement about *evidence*, not about *provenance* — which means it stops applying exactly when the evidence exists.

### Decision

**Binding a step is reachable from the review page, through a session the API holds open.** `POST /v1/binding-sessions` opens a headed browser aimed at a start URL and targets one step; `GET` polls what has been captured; `POST /target` re-aims the same open browser at another step; `POST /binding` saves one; `DELETE` closes it. This reverses ADR-019 for this case on ADR-020's merits, and does not retire the recorder CLI — `pnpm record:binding` remains, and neither path is the other's fallback.

**A binding session is a sitting, not one session per step.** Mapping a workflow means binding several steps in sequence, and each starts where the last left the page — signed in, filtered, three clicks deep. Saving a binding therefore writes one row and leaves the browser exactly where it is, where finishing a *recording* creates a document and closes it. That difference is why this is a separate registry rather than a mode of `RecordingSessionRegistry`: one method meaning both things behind one id space is the overload ADR-020 already warned against.

**What the two registries share is their hazard, and that is shared in code.** Each holds a real Chromium process that must not outlive the API. `recording/session-store.ts` owns ids, idle reaping, an unreferenced sweeper and `closeAll`; both registries build on it. Two copies of that handling would drift in exactly the way that strands a browser. Session ids are prefixed (`rec_`, `bind_`) so one can never be used against the other. The 30-minute idle timeout is unchanged from recording.

**Binding assembly moved out of the recorder CLI into `packages/sop-service/src/binding-service.ts`.** Two things now turn a demonstration into a binding, and what a real browser click *means* must have exactly one definition — the same reasoning that put `stepChecksum` in `@orbit/db`. `@orbit/sop-service` does not import `@orbit/execution-recorder`: a capture crosses that boundary as a plain `{selectors, fingerprint, url, typedValue?}` shape, so the composition root never depends on the package that injects script into a page.

**A binding created through Watchtower is approved on creation**, in one transaction — created, submitted for review, approved — matching `recording-service.ts`'s existing precedent. The act of demonstrating the step against the page *is* the review; asking the same person to then approve their own demonstration on a second screen is the ceremony ADR-025 removed for recordings.

**The revision and checksum a binding records are read at save time, not at session start.** A sitting outlives edits to the workflow it is binding, so a binding records what it actually bound against; a step edited out from under the session is refused rather than bound to something that no longer exists.

**A drafted workflow gets ADR-025's one publish action once every bindable step has an approved, non-stale binding.** `publish-bound-document-service.ts` gates on that and then runs the same pipeline the recorded path runs — extracted to `publish-pipeline.ts` so the two differ only in their precondition. The gate is technical, not a review waiver: `compileDocument` already refuses `missing_binding`, so what this adds is checking the precondition *before* driving the revision through approval, letting a refusal name the unbound steps instead of leaving a workflow approved and uncompilable. An unbound or partly bound draft still gets no button, because nothing has confirmed its steps against a real page.

**`routes/sop-bindings.ts` stays read-only.** The write path is its own route file. The guard tests asserting that binding data cannot be mutated through the read surface are unchanged and still pass.

### Consequences

- A guided workflow can now reach compile → approve → publish → run without a terminal, closing the dead end the guided path led to.
- The review page offers "Bind this step" only for `fill`, `click` and `extract` — exactly the compiler's `BINDABLE_KINDS`. A `navigate` step compiles from the graph's own `urlHint`, `manual_review` routes to a person, and `decision`/`outcome` are not compiled today; offering to bind any of them would be offering work that changes nothing.
- The open session id lives in the review page's URL, so a reload reattaches to the browser rather than orphaning the window it opened.
- The API process now holds two kinds of browser-holding session. Both are closed on the same shutdown path; `check:teardown` covers both.
- Approving or rejecting *somebody else's* binding still has no Watchtower surface, and the panel now says so rather than leaving it to be discovered.
- A typed value is deliberately absent from the capture summaries the API returns. It exists to prove the right field was hit; echoing it back through the API would put whatever someone typed into a place this phase does not protect. A password field's value is never captured at all.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Leave binding in the recorder CLI and document it better | The person the guided path exists for is the person without a terminal; better docs do not give them one |
| Fold binding sessions into `RecordingSessionRegistry` as a mode | Finishing a recording closes the browser; saving a binding must not. One method meaning both behind one id space is the overload ADR-020 warned against |
| One session per step, opened and closed around each binding | Each step starts where the last left the page — signed in, filtered, deep in a flow. Reopening at the start URL each time discards exactly the state that made the next step reachable |
| Keep binding assembly in `apps/recorder` and call it from the API | The API would import the CLI, and `@orbit/sop-service` would gain a path to the package that injects script into a page. One definition in the composition root, no recorder import |
| Create bindings as `draft` and require a separate approval click | The demonstration is the review; a second screen confirming one's own demonstration is the ceremony ADR-025 removed. Matches `recording-service.ts`'s precedent |
| Let a partly bound draft publish and rely on the compiler's refusal | The revision would already have been driven through approval by then, leaving a workflow approved and uncompilable, with a refusal that names nothing actionable |
| Offer binding for every step kind | `navigate` compiles from the graph's own hint and `manual_review` routes to a person; binding either changes no compiler outcome |

## ADR-028: Hold an interaction until it has been derived, and stop asking anyone to approve a workflow

**Status:** Accepted

**Phase:** 2

### Context

Two things came from using the product rather than from planning it.

**The recorder lost most of a real workflow.** ADR-019 made the injected script as small as it could be: it stamps the element and reports a token, and every selector and fingerprint is derived in Node through first-class Playwright APIs. Action mode "listens and lets the event through", which read as the safe, non-invasive choice. It is not, because derivation happens *after* the event and one round trip away. A click that submits a form or follows a link tears down the document, and its JavaScript execution context with it, before that round trip finishes. Playwright discards the in-flight binding call along with the dead context — so the interaction was recorded as nothing at all, and not even as a failure, because the error path lived in the context that had just died. The fill before it died the same way: `change` fires on blur during mousedown, and its derivation raced the same teardown.

Every test passed. The demo portal re-renders in place and never navigates, and the one fill test called `blur()` and then waited for derivation to settle before asserting — a sequence no person performs. On a real site, the steps that submit a form or follow a link are most of a workflow, so the recorder silently captured the least important half of what it was shown.

**Nobody wanted the review lifecycle.** ADR-025 had already collapsed it for recorded workflows, and ADR-027 for fully bound drafted ones, on the grounds that a demonstration is the review. What remained was a review page that still asked a person to Submit for review and then Approve — for a workflow that publishing would drive through those same states by itself, seconds later, whether they clicked or not.

### Decision

**Action mode intercepts, waits, and replays.** The injected script now holds a click (`preventDefault`, `stopImmediatePropagation`), waits for Node to finish deriving the element it named, and then re-issues it — guarded by a flag so the replay passes through untouched. A `submit` listener does the same for the Enter key, which produces no click at all and would otherwise lose the field just typed into. Reports are chained in order, so a click waits for the fill that preceded it, which is what keeps a typed value from being lost to the very button that makes the step worth recording.

This reverses ADR-019's stated property that action mode "lets the event through". That property was chosen for non-interference and delivered silence instead: the interaction is now delayed by a few milliseconds and recorded, rather than undisturbed and lost.

**The wait is bounded.** A two-second ceiling, after which the interaction proceeds regardless. Losing a capture is bad; leaving a page permanently unclickable because the binding stopped answering is worse, and a person driving a real browser must never be trapped by the thing recording them.

**What the script still does not do is unchanged.** It computes no selectors, reads no accessibility data, and derives nothing. It stamps, reports, waits, and replays. ADR-019's actual containment — one file, unreachable from anything that executes an agent, everything derived in Node — is untouched, and `recording-boundary.test.ts` still proves it.

**No workflow is submitted for review or approved by a person.** The review page's lifecycle buttons are gone. The state machine underneath is not: `SOP_REVISION_TRANSITIONS`, the repository guards, and ADR-017's rule that only a `draft` or `needs_clarification` revision may be edited all stand, and `publish-pipeline.ts` drives the transitions itself, so every row still records the states it actually went through. What was removed is the asking.

**One precondition stays in front of a person**: an unanswered clarification question. Publishing refuses on it, and `publishBlockedReason` says so before the click rather than after it — derived from the unanswered questions directly, since no lifecycle action is offered any more to derive it from.

### Consequences

- A recorded workflow on a real website now contains the steps that navigate, which is most of them. This is the difference between the recorder working and appearing to.
- A capture can still be lost if derivation exceeds two seconds, and that is now the only way it can happen. It is a bounded, stated risk rather than a silent structural one.
- Action mode is observable to the page: the click it dispatches is untrusted (`isTrusted: false`) and arrives a few milliseconds late. A site that gates behaviour on `isTrusted` would behave differently under recording. No such site is in scope, and the alternative is not recording it at all.
- The review page has no lifecycle controls, so a workflow's state is something publishing decides. `stateLabel` still reports what the server did.
- `reviewActions` and `REVIEW_ACTION_LABELS` were deleted along with their tests; `transitionSopRevision` remains in the API client and the route remains live, since the transition endpoint is real API surface even with no UI caller.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Derive selectors inside the injected script | Puts the logic ADR-019 deliberately kept out of the page into the least trustworthy place available, and forks `describeElement`'s derivation in the process |
| Report and hope, but surface the loss loudly | Honest, and still leaves the recorder unable to record a form submission — the most common step in a real workflow |
| Snapshot the element's own HTML synchronously and derive from that later | Derivation needs the live element (`ariaSnapshot`, locator counts, bounding box); a detached copy cannot be verified to resolve to exactly one element |
| Block navigation with `beforeunload` | Not reliable, user-visible, and does not help the in-page re-render case |
| Wait indefinitely rather than bounding it | A page that stops responding to clicks is a worse failure than a missed capture, and it would be blamed on the site rather than on Orbit |
| Keep the approve button "just in case" | It approves something publishing approves anyway; a control whose only effect is to do early what happens regardless teaches people it matters when it does not |
| Remove the revision state machine as well | It is the audit trail — what a workflow went through is the product — and ADR-017's editability rule depends on it |

## ADR-029: Bind a decision per branch, and cap model spend in three scopes before the call

**Status:** Accepted

**Phase:** 2

### Context

Two unrelated things, decided together because they landed in the same task.

**A workflow that chooses could be drafted but never run.** `decision` is one of the seven SOP Graph step kinds and has been since sub-phase 2.1; the reference workflow in the requirements document branches three times. The compiler refused every one of them with `branching_unsupported`, so an AI draft or a hand edit that produced a decision produced a workflow that could not be published. That refusal was recorded as "2.5 compiles linear graphs only", which read as a statement about a missing capability. It was not: Agent IR has had `browser.expect_one_of` since Phase 1 (`alternatives: [{whenVisible, next}]`, minimum two, with `graph.ts` deriving successors from it and enforcing acyclicity), and the runtime has executed it since Task 6 — `selectAlternative` races the alternatives' locators, jumps to the winner's `next`, and records `selectedAlternativeIndex` and `matchedLocator` as evidence. The seeded Phase 1 fixture already used it.

What was actually missing sat in one field of one schema. `ExecutionBinding`'s `decision` body was `{target, readMethod, condition}` — read one value off the page, evaluate a predicate against it. Nothing in Orbit can evaluate a predicate: there is no expression evaluator, and arbitrary expressions are excluded by CLAUDE.md and will stay excluded. So the one shape that was supposed to make a decision executable described something the runtime could not do, while the thing it *could* do — wait to see which of several known states appeared — had no way to be described at all.

**Nothing bounded what the model could spend.** Free-text drafting calls a provider up to twice per Generate, and the only thing standing between a deployment and an unbounded bill was that nobody pressed the button too often. There was no ledger, no ceiling, and no figure anywhere in the product saying what a draft had cost.

### Decision

**Branching is implemented without touching Agent IR, the runtime, or the Playwright executor.** `packages/agent-ir`, `packages/runtime` and `packages/executor-playwright` are byte-identical after this task. A graph `decision` compiles to one `browser.expect_one_of` with one alternative per branch: `whenVisible` is that branch's demonstrated locator, `next` is the graph branch's own `nextStepId`. That this was possible is the evidence that the gap was never in the executable layer.

**A decision binding carries one element per branch, and no `target` at all.** The body is now `{kind: 'decision', branches: [{when, selectors, fingerprint}]}`, minimum two. `EXECUTION_BINDING_SCHEMA_VERSION` moves to `0.2`. This is a deliberate change to a contract ADR-018 froze, made because the frozen shape described an operation that could not be performed; the four other bodies are untouched and rows written at `0.1` still parse, since the version is read as an opaque string and no decision binding could have existed at `0.1`.

**The branches live inside one binding body rather than as one binding per branch.** A binding is keyed by step — `listCurrent` keeps exactly one live binding per `stepId`, and a re-record supersedes its predecessor. One row per branch would therefore make each branch supersede the last, and a decision would end up bound to whichever branch was demonstrated most recently. The storage model made this the only correct shape; no migration was needed, because the body column is JSONB.

**Branches are matched by the reviewer's own condition text, never by array position.** `validateBindingAgainstStep` accepts a decision binding only when its `when` values are exactly the set the graph step declares — no extras, none missing — and the compiler re-checks the same thing rather than trusting it. Position matching would mean that reordering a graph's branches silently rebinds the decision to the wrong outcome, which is the class of error that produces a correct-looking agent doing the opposite of what it says.

**A decision is bound by walking its branches, in `pick` mode, in one sitting.** The person puts the page into each state in turn and points at the element that proves it; pointing performs nothing. Captures are held in session state and **nothing is written until every branch has one**, so an abandoned half-demonstration leaves no partial binding. The API's save route reports a null `bindingId` for a branch that was recorded but did not complete the set, because reporting an id for a row that does not exist would be worse than reporting none.

**`BINDABLE_KINDS` now has one definition.** The compiler owns it; `publish-bound-document-service.ts` and the API's binding-session registry import it through `@orbit/sop-service` rather than restating it. Three hand-copied literals would have meant a kind the compiler requires and the session refuses to bind — a workflow that can never be published, with nothing saying why. Watchtower keeps its own literal deliberately: importing the compiler would pull `node:crypto` and a database checksum into a browser bundle, and the client only decides what to *offer*.

**Model spend is capped in three scopes, and every scope is checked before the call is made.** A cap enforced after the fact is not a cap — the tokens are already gone. At drafting time neither an agent nor a run exists, so the three scopes map onto what is real at that moment, and this mapping is stated rather than left implicit:

| Scope | At drafting time it means | Why |
|---|---|---|
| **Global** | every call in the deployment | the overall pot; nothing else bounds it |
| **Per agent** | every call for one SOP **document** | a document is 1:1 with the agent it will become — `agentIdForDocument` derives that agent's id from the document id deterministically — so "per agent" before publication is "per document" |
| **Per run** | one Generate request: the initial call plus its one repair | a "run" of the drafting flow is one request; the repair is part of the same unit of work and is charged to it |

All three are checked before **each** call, and the **most restrictive** one that would be exceeded is the one reported. Reporting the first scope that happened to fail would send someone to raise a ceiling that was not the one stopping them.

**The ledger is one row per provider *call*, and every scope is a sum over it.** Not one row per draft: a draft costs up to two calls, and a counter of drafts would let the expensive case through free. There is no stored running total anywhere — a counter would be a second source of truth that could drift from the evidence, and the number a budget is enforced against and the number a person is shown now come from the same rows. `model_usage` is append-only by construction: the repository has no update and no delete, except `attachDocument`, which only ever fills in a null.

**The first call of a brand-new document is recorded unattributed and adopted afterwards.** At the moment that call is made, no document exists — one is created only if the draft turns out to be valid. So `document_id` is nullable, the rows are written anyway, and the transaction that creates the document adopts its own request's unattributed rows. `attachDocument` cannot move a row from one document to another.

**Cost is an estimate, and says so everywhere it appears.** Per-model rates live in this deployment's configuration (`ORBIT_LLM_RATES_USD_PER_MTOK`, with defaults). Nothing fetches a price list, because calling one would turn an estimate into something that looks like a bill. It is stored as integer micro-USD, since floating-point dollars summed over a ledger stop adding up. A model with no configured rate is costed at a conservative non-zero fallback rather than at zero: zero is the one answer that is certainly wrong and the one a reader would not question.

**Budgets default to *set*, not to unlimited.** A deployment that configures nothing still has a ceiling in all three scopes. Removing one is spelled `unlimited`, deliberately, because a blank and a zero are both things somebody types by accident. Anything unparseable throws at boot rather than falling back: starting with a ceiling somebody meant to set and mistyped is the failure this must not have.

**The server is the gate; the button is a courtesy.** `POST /v1/sop-drafts` refuses an over-budget Generate with **429** — distinct from the 422 that means the model produced something unusable — whether or not any UI ever rendered. `GET /v1/model-usage` reports spend and headroom so the button can be disabled before someone writes three paragraphs, and it cannot change a ceiling: a cap a client could lift is not a cap.

**A repair refused mid-request returns both facts.** If the first call succeeds, spends real tokens, and the repair is no longer affordable, the result is `budget_exhausted_before_repair`, carrying the invalid draft's own validation issues *and* the budget reason. Reporting only the issues would blame the model for a budget decision; reporting only the budget would hide what the draft actually got wrong. Never a silent half-result, and never a charged call that was not allowed.

### Consequences

- A branching workflow compiles, publishes and runs. The library demo (`docs/demo/branching-library-demo.md`) searches a catalog and either borrows a title or places a hold on it, proven by a real-browser test that drives both branches.
- The escalation-review reference workflow still does not compile, and the refusal is now accurate: three of its steps route to a person, and its decisions have no bindings. Branching is no longer the obstacle.
- `branching_unsupported` is gone as a refusal code, replaced by `missing_branch_binding` and `unresolved_branch_target` — both of which name something a person can act on.
- **A decision's fingerprints are not re-verified at run time.** `verifyBinding` runs before an action or a read; `browser.expect_one_of` resolves by visibility and does not call it. A branch locator that had drifted onto a different element would be selected rather than refused. Changing that means changing `packages/runtime`, which this task deliberately did not.
- The recorder CLI refuses to bind a decision and says where to do it instead. Its flow is one capture, one binding, and a decision needs several; half-binding one from a terminal is worse than not offering it.
- Every model call is now recorded whether the draft it produced was kept or thrown away, so a run of invalid drafts appears in the ledger rather than vanishing.
- A deployment upgrading to this version gains ceilings it did not previously have. That is intended, and the defaults are generous, but a heavy user will meet them; raising one is a single environment variable.
- `SavedBindingView.bindingId` and `.state` are now nullable. Every existing caller reads them only after a completed save, so nothing regressed, but the type is honest about the branch-in-progress case.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Add a branching construct to Agent IR | It is already there and already executed. Adding a second would fork control flow across two representations |
| Teach the runtime to evaluate the binding's `condition` predicate | An expression evaluator in the runtime is excluded by CLAUDE.md, and would put arbitrary user-authored logic on the execution path |
| Keep the `decision` body's `target` and add `branches` beside it | A target that means nothing for the one kind that has it. Every reader would have to know which field to ignore |
| One binding row per branch | `listCurrent` keeps one live binding per step, so each branch would supersede the last and the decision would end up bound to whichever was demonstrated most recently |
| Match branches to bindings by array position | Reordering a graph's branches would silently rebind the decision to the wrong outcome — a correct-looking agent doing the opposite of what it says |
| Write each branch's capture as it is demonstrated, completing the binding later | A partly written decision would compile to an `expect_one_of` that cannot name a state the agent can reach, and the agent would hang on a page it is looking at |
| Cap spend by counting drafts rather than calls | A draft costs one call or two, and the expensive case would go free |
| Check the budget once, before the first call | The repair is a second real call; a check that has not seen the first call's tokens cannot bound the second |
| Enforce the cap after the call, and report the overrun | The tokens are spent. That is a report, not a cap |
| Keep a running total column and compare against it | A second source of truth beside the ledger, free to drift from the evidence it is supposed to summarise |
| Default every budget to unlimited and let deployments opt in | The failure mode is an unbounded bill nobody chose. Raising a ceiling is one variable; discovering an unbounded one is a postmortem |
| Fetch real prices from the provider | It would make an estimate look like a bill, and put a network call on a path that has no need of one |
| Cost an unpriced model at zero | The one answer that is certainly wrong, and the one nobody would question |
| Enforce the cap in the UI by disabling the button | A gate a client owns is not a gate. The button reflects the budget; the server enforces it |

## ADR-030: Let a workflow declare its own business outcomes, and let a reviewer add a step

**Status:** Accepted

**Phase:** 2

### Context

Two changes to the same review-and-publish path, decided together.

**A recorded workflow could never become a branching one.** `packages/sop-recording`'s translator deliberately refuses to invent a branch nobody demonstrated, which is right: a recording is evidence of what a person did, and a decision they never made is not in it. But the review editor had `editStep` and `reorderStep` and no way to *add* a step. So the only routes to a `decision` step were the AI drafting flow and a hand-written fixture. A person who recorded a workflow, then realised it needed to branch, had nowhere to say so.

**Every agent had to lie about what it concluded.** `terminalBusinessOutcomeSchema` was `z.enum(['request_found', 'request_not_found'])` — two names inherited from the Phase 1 "Find Service Request" demo and never chosen to describe workflows in general. Every compiled agent had to map its real outcomes onto those two, and a person was asked at publish time to pick which. The seeded library demo published `borrowed → request_found` and `held → request_not_found`. The branch taken was exact and the evidence was complete; the *name* recorded against the run was wrong. `docs/demo/branching-library-demo.md` carried this as a known limitation, and the UI had grown a comment apologising for the vocabulary while defaulting around it.

That is worse than an untidy name. Watchtower's whole claim is that a run's evidence reconstructs what happened. A run that concluded "this book is on loan, so I placed a hold" recorded `request_not_found`.

### Decision

**A business outcome is a declared identifier — the name the workflow's own outcome step already carries.** `borrowed` is the outcome. There is no mapping, and the mapping concept is gone: `OutcomeMapping`, the `outcomeMapping` body field on the three publish/compile routes, and the whole mapping form in `SopPublishPanel`. Publishing is now a button with no question attached, for every workflow.

The grammar is `^[a-z][a-z0-9_]{0,63}$` — the same shape as the SOP Graph's own `outcomeNameSchema`, with a length bound the graph does not impose, stated once in `BUSINESS_OUTCOME_PATTERN` and used by both the Zod schema and the database CHECK constraint so the two cannot disagree.

**`none` stays reserved** for a run that has reached no business conclusion. Reserved rather than merely conventional, because it is the column default: a workflow able to declare an outcome called `none` would make "no conclusion yet" and "the conclusion is none" the same stored value. The compiler refuses it by name, at the step, rather than letting it reach a constraint violation at run time.

**Technical run status stays separate from business outcome**, exactly as ADR-006 says. A free-form outcome influences neither `succeeded` nor `failed`.

**A reviewer can insert a step at a chosen position**, through `insertStep` on `SopRevisionService` and `POST /v1/sop-revisions/:revisionId/steps`. It follows the shape `editStep` already uses: a new revision rather than a mutation, only from an editable state (ADR-017), the whole resulting graph re-validated through the normal parse path, and a typed refusal rather than a throw for every expected case. **Step ids are generated, never asked for** — the same reasoning that made `agentIdForDocument` derived in ADR-024, and sharper here, because branches name their targets by step id and the step editor refuses to change one, so a name chosen badly could not be undone.

**Deleting a step is deliberately not part of this.** Removing a step can strand a branch that targets it, and the honest handling of that is its own decision.

### Consequences

- **No data migration, and that is a property rather than a lucky escape.** `request_found` and `request_not_found` satisfy the new grammar exactly as they satisfied the old enum, so every existing `runs` row, the seeded Phase 1 agent, its fixture and `verify:phase1` keep working untouched. A test asserts this against the real CHECK constraint rather than assuming it.
- The migration (`0007_free_form_business_outcomes`) swaps one CHECK for another: a value list becomes a format check. It touches no row.
- The library demo's outcomes are `borrowed` and `held` for real. Its runtime test asserts those names end to end, which is the proof the change actually reached a run's evidence.
- **Watchtower reports an outcome without judging it.** `describeRunStatus` used to single out `request_not_found` as an "attention" state with a sentence about service requests. An outcome is now whatever a stranger's workflow declares, and Watchtower has no basis for deciding which business conclusion deserves a warning colour. A succeeded run is shown as succeeded, named by its outcome. This is a deliberate loss of a UI affordance whose premise was a closed vocabulary.
- **An inserted step has no binding, so it correctly blocks publishing.** It shows as "Not recorded" until somebody demonstrates it on a real page. That is the system working, not a gap: an unbound step is a claim about a page that nothing has confirmed (ADR-025, ADR-027), and a step typed into a form is precisely the case that must not bypass that. It is worth saying plainly so nobody later "fixes" it.
- **Inserting in front of the entry step moves `entryStepId`.** The graph names its entry explicitly rather than meaning "whatever is first", so without this the inserted step would be silently unreachable and the workflow would still start where it always did. The condition is the index of the entry step, not index 0, because that — not the head of the list — is the only position where fall-through puts a new step before the workflow's beginning.
- `agent_ir_candidates.outcome_mapping` is **kept but no longer written**: new candidates record `{}`. The rows written before this change hold a real answer a person gave, and dropping the column would destroy that. Retiring it is a separate, destructive change and is not smuggled into this one.
- `CompleteRunInput.businessOutcome` is now `TerminalBusinessOutcome` rather than `Exclude<BusinessOutcome, 'none'>`. That `Exclude` had quietly become a no-op over `string` and stated a rule it no longer enforced; the reservation is enforced by the schema at the boundary, where it can be checked.
- The three publish/compile routes now take an empty body, kept strict so a caller still sending `outcomeMapping` is told rather than silently ignored.
- `packages/runtime` and `packages/executor-playwright` needed **no change**: the runtime carries the outcome value through and never switched on the specific names. Only the now-vacuous type annotation above was tightened.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the enum and add more names to it | Every new customer workflow would be a change to a frozen contract, and the vocabulary would still be Orbit's rather than theirs |
| Keep the mapping but let a person type a free-form target | The same question, still asked, with the answer now also unvalidated. The mapping was the thing with no purpose |
| Let a workflow declare `none` as an outcome | It is the column default, so "no conclusion yet" and "the conclusion is none" would become the same stored value |
| Migrate existing rows to new names | There is nothing to migrate to. `request_found` is a perfectly good name for the Phase 1 agent's outcome, and it is what that agent actually declares |
| Drop `outcome_mapping` from the candidates table in this task | It destroys the record of an answer a person gave, for a column that is merely inert. A destructive migration deserves its own decision |
| Keep `request_not_found` as an "attention" state in Watchtower | It only reads as attention-worthy if you already know the Phase 1 demo. Applied to `held` or `escalated` it would be a guess presented as a judgement |
| Let the caller supply the new step's id | Branches name their targets by step id and the editor refuses to change one, so a bad name would be permanent |
| Validate only the inserted step | An insert can strand the step it displaced, read a value produced after it, or leave a path that never reaches an outcome — none of which is visible from the step alone |
| Add delete alongside insert | Deleting can strand a branch that targets the deleted step. Handling that honestly is a separate decision, and a half-answer would be worse than the current absence |
| Make the inserted step publishable without a binding | It would let a step nothing has confirmed against a real page reach a running agent, which is the line ADR-025 and ADR-027 draw |

## ADR-031: Name the authoring surface Studio, and read a run as one timeline

**Status:** Accepted

**Phase:** 2

### Context

Two information-architecture decisions, both prompted by watching somebody use the product, and both recorded together because they share a premise: Watchtower already held the information, and was arranging it in a way that made the reader do work the system had already done.

**"Agents vs Workflows" gave two names to one idea.** The tabs were Home, Agents, Runs, Workflows. A published agent came from a workflow; a workflow was on its way to becoming an agent. Neither label meant *authoring*, so "which tab holds the thing I am about to edit?" was a coin toss — and the user asked exactly that. The product already had the right word: `CLAUDE.md` has named **Studio** as the authoring surface, opposite Watchtower as the observability one, since Phase 1. The tab was named after what it listed rather than what it was for.

**A run was three parallel lists.** `RunPage` rendered Steps, Events and Evidence side by side, each complete, each in its own order. Answering "what happened at the click, and what did the page look like afterwards?" meant joining three lists by timestamp in the reader's head. The join was never missing from the data: `RunEventView.runStepId` and `ArtifactView.runStepId` both name the step they belong to, and the runtime has recorded them since Phase 1. Watchtower was declining to use an attribution it was already storing, and asking a person to reconstruct it instead.

A third, smaller instance of the same failure: the review page's binding panel was headed **"Mapping to a real page"**. The user asked three times what it meant. When a label needs explaining three times, the label is the defect.

### Decision

**The authoring tab is Studio, and the tab order follows the work.** Home · Studio · Agents · Runs — arrive, author, run, observe. `navigation.ts` owns the labels and the order; `Nav` derives its `data-testid` from the label, so `nav-workflows` became `nav-studio`.

**The URL value stays `?view=documents`.** Review and document links were shared before this navigation existed. Renaming a query parameter so it agrees with a label breaks those links and buys nothing, because nobody reads `?view=`. The label is what a person sees; the query value is an address, and an address's job is to keep resolving.

**A run is one timeline.** One row per step in `sequence` order, with that step's own events and its own evidence rendered underneath it. Run-level events — the four with a null `runStepId` — keep a group of their own, because `run.started` appearing between two steps read as though it were one of them. Run-level evidence, in practice the Playwright trace, gets its own place rather than being attached to an arbitrary step.

**The raw event stream is kept verbatim, collapsed, in the document.** The woven view is a *reading aid*; the stream is the record. It stays in the DOM rather than being conditionally rendered, so nothing is lost and nothing has to be re-fetched to see it.

**A decision reports the branch it took, not the index.** `browser.expect_one_of` records `selectedAlternativeIndex`, `matchedLocator` and `next`. The index is an artifact of Agent IR's array ordering and means nothing to a reader; the matched element and the step that followed describe the decision in the workflow's own terms. Watchtower renders "took the *request not found* branch, and continued at `complete_not_found`".

**The binding panel is headed "What each step does on the page",** with a lead line that explains it without the word *binding*: the workflow says what to do, this is where someone showed Orbit exactly where to do it in a real browser.

### Consequences

- `apps/web/src/run-timeline-view-model.ts` is new and holds the join, the branch description and the humanising, as pure functions. `RunTimeline.tsx` renders what it returns and decides nothing — the same arrangement as `run-view-model.ts` beside it, and what makes the rules testable without a DOM.
- `EvidenceList.tsx` no longer exports a page-level list. It exports `EvidenceGroup` and `EvidenceRow`, which the timeline places under each step. The screenshot preview is unchanged, including its lazy fetch through the API client — which is what keeps a page of seven steps from loading seven screenshots nobody asked for.
- **Step rows are deliberately not collapsible.** Collapsing would shorten the page by putting the evidence back behind a click, which is the problem this change exists to solve. Density is managed by keeping each step's summary to one line and never loading a screenshot until it is asked for.
- An event naming a step that is not in the run's step list is *not* placed under one. It appears only in the raw stream. That is a real, if unlikely, gap in the woven view and is precisely why the raw stream is kept rather than replaced.
- `data-testid` churn is confined to `nav-workflows` → `nav-studio`. Every evidence and step test id is unchanged, so the end-to-end suite's assertions about evidence, downloads and step status still hold against the new arrangement — which is worth having, because they now assert it about evidence rendered *under its step*.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Rename Workflows to "Drafts" or "Authoring" | Accurate but foreign. Studio is already this product's word for the surface, and inventing a third name for it would be the same mistake again |
| Also change the URL to `?view=studio` | Breaks links people already hold, to make a query parameter agree with a label nobody cross-references |
| Merge Studio and Agents into one tab | They are genuinely different states with different actions — one is editable and unpublishable, the other is immutable and runnable. One tab would need a filter, which is two tabs with extra steps |
| Interleave run-level events into the step list by timestamp | It is what made the old list confusing. `run.started` is not a step and should not sit where one would |
| Drop the raw event stream now that events are attributed | The woven view is derived. Deleting the record it derives from to save a collapsed section trades a debugging capability for nothing |
| Collapse each step by default, expanding failures | Puts evidence back behind a click for six steps out of seven to save scrolling on a page nobody arrives at casually |
| Show `selectedAlternativeIndex` with a friendlier label | The number is not more truthful for being labelled; it is an array position a reader has no way to resolve |
| Explain "binding" better in the panel body | Three attempts had already failed. The heading was doing the damage, and a longer body under a wrong heading is a longer wrong answer |

---

## ADR-032: Let a model decide a branch, bounded to an index into a closed list

**Status:** Accepted

**Phase:** 2

### Context

ADR-029 gave Orbit deterministic branching: a `decision` step resolves by the visibility of an element a person demonstrated, and the run takes that branch. That is exactly right when a page states its condition the same way every time, and useless the moment the same meaning arrives in different words or a different layout.

The three demonstration domains all fail the same way, and they fail on the *surface*, never on the declared outcomes:

| Domain | Demonstrated | A later run actually shows | Declared outcomes |
|---|---|---|---|
| Retail order tracking | "Preparing for shipment" | "Out for delivery", "Delayed at carrier", "Return initiated" | `shipped` / `escalate` |
| Helpdesk triage | one closed-ticket layout | "Pending customer response", "Reopened", escalation language nowhere near the bound status field | `resolved` / `needs_human` |
| Municipal permits | one city's coloured badge | another city's paragraph; a third city's table row | `approved` / `follow_up` |

The outcome set never changed in any of them. Only the words did.

This is also the first time anything in an execution path is non-deterministic, in a product whose entire value proposition has been determinism. That is not a footnote, and the decision below is mostly about how far the non-determinism is allowed to reach.

### Decision

**A new step type, `model.decide`, whose only job is to map a messier page onto pre-declared alternatives.** Not "decide what to do". Not "find the element". Not "recover from a failure". It classifies, and the branch it takes comes from its own definition.

**The widest thing a model can do at run time is pick a number between 0 and n−1.** `JudgeResult` carries `alternativeIndex`, an index into a list the runtime already holds. Nothing the judge returns becomes a locator, a URL, a selector, an expression, or a step id — there is no spelling of an integer that becomes one. `next` comes from the step definition. The judge is not even *shown* where an alternative leads, so it cannot be steered by consequence and has no vocabulary for naming a destination.

**The runtime gets a port, never a provider.** `packages/runtime` gains a one-method `DecisionJudge` interface and no dependency at all; `packages/decision-judge` holds the model client; `apps/browser-worker` wires them, exactly as it wires `@orbit/executor-playwright` behind `BrowserExecutor`. ADR-008 denies the runtime broad capability on purpose, and a model client there would mean the process that executes approved steps could call a model for any reason it liked, with free text in both directions. `packages/runtime/src/decision-judge-boundary.test.ts` proves the runtime reaches no provider transitively — through the whole workspace closure, not just its direct dependencies, because a provider added two packages away would otherwise arrive unannounced.

**The runtime re-validates the answer independently.** The provider is called with a structured-output schema whose index field is bounded to the declared range, but a provider honouring a schema is a convenience, not a guarantee. `packages/decision-judge` deliberately passes an out-of-range index straight through: if it filtered, the runtime's own check would be untestable and would eventually be deleted as dead code — and that is precisely the check that must not be deleted.

**Fail-closed, with five distinguishable reasons.** `DECISION_JUDGE_UNAVAILABLE`, `DECISION_JUDGE_FAILED`, `DECISION_OUT_OF_SET`, `DECISION_LOW_CONFIDENCE`, `DECISION_BUDGET_EXHAUSTED`. Five codes rather than one, because someone diagnosing a halted run has to tell "the model was not sure" from "the model could not answer" from "we ran out of budget" — three different fixes. There is no default branch, no retry into a different answer, and no falling back to the first alternative. A retry is a second chance at a *different* answer, which is the one thing a bounded decision must not have, so the provider is configured with no retries and the runtime's halt is the correct response to a failed call.

**A confidence threshold per step, over a conservative deployment default.** A decision routing to a refund and one routing to a second lookup do not deserve the same bar, so the step may declare `confidenceThreshold`; when it does not, `ORBIT_LLM_DECISION_CONFIDENCE_MIN` applies, defaulting to `0.8`. **A missing confidence fails closed**: "the provider did not say" is not evidence that it was sure, and treating it as such would make the threshold optional in practice for any provider that stopped reporting one. The default is not baked into the published Agent Version on purpose — a threshold frozen at publish time could never be raised across a fleet.

**A judged decision must declare an "insufficient evidence" alternative, and this is a refusal.** A judged step whose alternatives are `senior | professional | standard` forces a confident answer for a record carrying no evidence either way, and `standard` returned because nothing else fit is indistinguishable in the run's evidence from `standard` returned because it was right. That is the shape that produces confident wrong answers at scale, so it does not compile. Where the alternative leads is the author's business decision; nothing forces it to a human.

**The judge reads declared page regions, not the page.** `readFrom` names the regions the Agent Version permits it to read, resolved by the executor's ordinary `readText`. Three consequences, all deliberate: `packages/executor-playwright` is untouched, so a judged decision needs no browser capability that did not already exist; the prompt is small and reviewed rather than whatever the page happens to contain; and the injection surface is a slice a person chose. Two branches demonstrated on the same region deduplicate to one region — which is what a person demonstrating a judged decision is actually doing, pointing at the one place the answer is written, once per case.

**Its own permission section.** `permissions.model` is `{ allowed, maxCallsPerRun }`, separate from browser permissions, because a model call leaves the machine and costs money. Smuggling it in under a browser grant would mean an agent granted `click` had quietly been granted judgement. `maxCallsPerRun` is a second limit beside the token cap because they catch different faults: a token cap catches an expensive workflow, and a call ceiling catches one that calls a model far more often than its author believed.

**One budget definition and one ledger.** `packages/model-budget` is extracted from `@orbit/sop-generation` with `run` and `agent` scopes added beside the existing three, and both callers use it — the same reason `stepChecksum` has one home. `model_usage` gains nullable `run_id` and `agent_version_id` (migration `0008_judged_decisions`), and every scope stays a `SUM` over the append-only rows, so no running total exists to drift. Checked **before** each call, proven by a test in which the model layer is never invoked. `ModelSpend` became partial, and a limit declared for a scope whose spend cannot be measured is **refused** rather than treated as zero: a ceiling nobody can measure is not a ceiling, and reporting it satisfied on the strength of having no idea is the failure this must not have.

The `agent` scope sums across an agent's versions by joining through `agent_version_id`, not per version. A cap that reset on republish would be a cap anyone could clear by publishing.

**Schema version `0.2`, and every `0.1` agent keeps running.** The compiler emits `0.2` only for a workflow that actually uses the widened contract, so republishing an unchanged document produces an unchanged document. `verify:phase1` is the check on that claim.

**Full audit trail, and `decision.requested` is appended before the call.** The question, the alternatives offered, the page text the judge saw (as a `decision_input` artifact), the chosen outcome and index, the rationale, the model, the provider, the tokens, the cost, and the latency. The input artifact and the request event are written *before* the provider is called, so a call that never returns still leaves behind what it was asked and what it was shown — evidence that only exists on the happy path is not evidence.

**The rationale is evidence and nothing else.** It is displayed to a person reading the run afterwards and is read by no code path. A test asserts this directly, with a rationale that names the other branch, its step id, and an instruction: the index decided, the prose did not.

### Consequences

**Two runs of the same agent against the same page can now differ.** This is the real cost and it is not mitigated away. What bounds it: the step is opt-in per workflow step, the answer is an index, every failure halts, everything is audited, and spend is capped. Temperature is 0 and there are no retries. But the property is real, and choosing a judged decision is a review-time decision a person makes — never a fallback the system reaches for on its own.

**Latency and cost rise wherever a judged decision is used.** A judged step is a network round trip inside an execution that previously had none.

**Prompt injection is a live surface, reduced rather than eliminated.** Page content becomes model input and a hostile page can try to talk to the judge. The prompt says the content is data and never instructions, and it is fenced — but the *structural* defence is the closed enum: the worst achievable outcome is the wrong declared branch, never an executed instruction. Worth saying plainly, because the mitigations are the weaker half of that sentence.

**Secrets: redaction is a reduction, not a guarantee.** Page text is broader than an element. A password field's value is never read, but a page can render a token, a key, an account number or an email address in ordinary prose. `redactForModel` runs in the *runtime*, once, before the text is either sent or stored — putting it in the provider would have sent clean text to the model and written the raw text to the artifact store, which is the worse half of the problem. It matches shapes it knows: it will not recognise a secret that reads like prose, and it may redact a harmless string that looks like a key. Both are pinned as tests so the limitation is visible in the suite rather than only here. The containment that does the real work is that a judged decision reads only the regions its Agent Version declares.

**A judged decision classifies into a partition, and the compiler cannot check that it is one.** A pick-one node returns exactly one alternative, so its alternatives must be mutually exclusive and jointly exhaustive over the cases the workflow will meet. A 70-year-old doctor is both "senior" and "professional"; asking a judge to break a tie the SOP never explained produces an answer that looks like an answer. Overlap is a fact about the author's business meanings, not about the graph — nothing distinguishes `senior | professional` from `available | on_loan` — so no schema check can catch it. The three ways out are all business decisions:

| Way out | What it looks like | When it fits |
|---|---|---|
| Separate decisions per attribute | One judged step per axis: age band, then occupation | The attributes are genuinely independent and both matter |
| Enumerated combinations | `senior_professional`, `senior_other`, … as distinct alternatives | Few attributes, and the combinations really do behave differently |
| A policy ranking | One decision whose alternatives are ordered, with the SOP stating which wins | There is a real precedence rule the business already applies |

Leaving overlapping categories on a pick-one node is the failure mode, because it produces a workflow that runs, never errors, and is quietly wrong on every overlapping case.

**And a sibling of that problem, found while building the demo.** The library workflow's judged decision classifies into `can borrow` / `cannot borrow` / `unclear`, which is a correct partition of the *question*. It is a wrong partition of what the workflow can then *do*: the branch behind "cannot borrow" assumes a hold form, and the catalog renders one for a title on loan but not for one already on hold. The judgement is right and the workflow is wrong. `judged-availability.runtime.test.ts` pins that real behaviour rather than choosing an input that hides it. Nothing in the schema can detect this either, for the same reason: both facts live in the author's head.

**Trust tier.** A judged decision is still read-only and still Tier 0 `observe` under ADR-013 — it reads a page and picks a declared branch, and it can take no action a deterministic workflow could not. But it is *judgement*, which the tiers did not previously have a place for. It sits at `observe` because authority is about what an agent may do, not about how it decided; the safeguard against a wrong decision is the closed branch set, not the tier.

**A follow-up, explicitly not built here.** The drafting flow's clarification questions are the natural place to force the partition questions into the open for a plain-English SOP: where the evidence for this judgement comes from, what the unclear case should do, whether any two categories can be true at once, and any number the prose implies but never states ("recent", "large", "senior"). That is a change to draft generation rather than to the runtime.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Give the runtime a model client directly | The process that executes approved steps would gain an unbounded capability with free text in both directions. A port cannot be repurposed; a client can |
| Have the judge return the outcome *name* | A string is a thing someone will eventually resolve against something. An index into a list the runtime already holds has no such affordance |
| Let the judge see each alternative's `next` | It would let a model be steered by consequence, and gives it a vocabulary for naming a destination it currently lacks entirely |
| Send the whole page to the judge | Larger prompt, larger bill, larger injection surface, and a decision nobody reviewed the inputs of. Declared regions are a slice a person chose |
| Retry a failed or low-confidence call | A retry is a second chance at a *different* answer. That is the property a bounded decision exists to not have |
| Treat a missing confidence as confident | Makes the threshold optional in practice for any provider that stops reporting one — a silent, deployment-wide lowering of the bar |
| One `DECISION_FAILED` code | Four different fixes behind one code. The evidence would agree with itself and tell nobody anything |
| A global confidence threshold only | A refund decision and a second-lookup decision do not deserve the same bar, and the author is who knows which is which |
| A per-step threshold only, with no default | A step whose author did not think about confidence would have none, and the permissive default is the one that produces confident wrong branches |
| Warn about a missing "insufficient evidence" alternative | A warning on the shape that produces confident wrong answers at scale is a warning nobody reads twice |
| Detect overlapping categories in the compiler | Overlap is a fact about business meanings. Nothing in the graph distinguishes `senior \| professional` from `available \| on_loan` |
| A second budget mechanism for run-time spend | Two definitions of a cap eventually disagree, and the one enforced would not be the one anyone was shown |
| Default `ModelSpend` to zero for unmeasured scopes | Reports a budget satisfied on the strength of having no idea. Refusing is the honest answer |
| Bump every agent to schema `0.2` | A widening that forces immutable published versions to be reissued is a break wearing a version number |
| Redact inside the provider | Clean text to the model, raw text to the artifact store. The wrong half of the problem solved |

---

## ADR-033: Recover from UI drift by proposing a reviewed binding, never by applying one

**Status:** Accepted

**Phase:** 2

### Context

ADR-018 gave Orbit a fingerprint check that runs before every action, and it works: when a page stops matching what a person approved, the run stops instead of clicking something nobody reviewed. What it produces is a halt and a stack of evidence, and nothing else. Somebody has to read it, work out what changed, open a browser, and demonstrate the step again — for a change that is usually trivial.

The common case really is trivial. A team renames a `data-testid` in a refactor; the button keeps its role, its label, its position and its meaning. The binding already holds a second way of naming that element, because the recorder captures a ranked chain (ADR-018) — and until this task, **nothing ever used the rest of that chain**. Agent IR carries only the chain's head, so the fallbacks sat in the database being paid for and never read.

Three things were also true when this task started, and only the first was documented:

- `narrowDriftCandidates` had existed in `@orbit/execution-assist` since 2.4b, filtering page elements down to plausible replacements. Nothing in the runtime's drift path referenced it.
- The drift check itself was **never wired in production**. `executeAgentVersion` takes an optional binding resolver; every real entry point omitted it. The check was live in tests and inert in every actual run.
- The library demo's fixture fingerprints had never been compared to the library portal, because nothing had ever compared them to anything. Several were wrong.

This is the first Orbit feature whose subject is Orbit's own definitions. Everything before it acted on somebody else's system; this one has opinions about the workflow itself, which is a different kind of authority and needs a different kind of limit.

### Decision

**Four stages, and only the first three are automatic: detect, diagnose, propose, gate.**

**Recovery does not rescue the run that met the drift.** This is the load-bearing sentence and the reason for most of what follows. The drifted run fails, with its typed error and its evidence, exactly as it did before recovery existed. `attemptRecovery` returns `void`, is awaited before the error is constructed, cannot prevent it being thrown, and is not consulted in constructing it. A proposal makes the **next** run possible, after a person approves it. Anything else would be the system quietly substituting an element nobody sanctioned — which is precisely what the drift check exists to prevent, only with a proposal attached to make it look sanctioned. `packages/runtime/src/recovery.test.ts` asserts the run still fails while a proposal is being made, and that no click reached the page.

**Diagnosis is deterministic, and its determinism is a type rather than a promise.** `diagnoseDrift` is **synchronous**. A synchronous function cannot await a network round trip, so "v1 consults no model" is a property of the signature. Switching ranking on means changing that signature, which is a change a reviewer sees — the same property `permissions.model` gives a judged decision.

**Diagnosis searches the binding's own chain and nothing else.** The candidates are the locators a person already demonstrated for this element, probed in place against the live page. Orbit is never handed the page and never asked to search it. An element found by scanning would be a candidate nobody had ever approved; a locator from the chain carries a human's signature and the recorder's proof that it resolved uniquely to the element they meant.

**A candidate "matches" by exactly the comparison the drift check uses, in the same mode.** A replacement is proposed only when the runtime would have accepted that element had the binding named it in the first place. A looser, recovery-specific notion of "close enough" would be a second definition of approval that no reviewer ever agreed to.

**More than one plausible replacement means Orbit proposes nothing.** Ranking lookalikes is what a model is good at and it is switched off. Ambiguity is reported as `ambiguous`, with a request that a person demonstrate the step again. Confidence is the word `high` and never a number: a float computed from a boolean test is false precision, and the moment one exists somebody tunes a threshold against it.

**A proposal is a row in its own table, not a `draft` binding.** This deviates from the shape the task described, and the reason is a property of the existing repository that shape would have broken. `listCurrent` returns the newest non-superseded binding per step, and compile and publish then require that binding to be `approved`. A draft binding written by a failing run would become "current" and shadow the approved binding it hopes to replace, so a pending proposal would silently block publishing a document with nothing wrong with it. `executionBindings.create` also supersedes its parent in the same transaction by design — which is right for a re-recording and wrong for a proposal, which must leave the approved mapping untouched while it waits, including if it waits forever. `binding_recovery_proposals` keeps the intent of "a drafted binding attached to its document, referencing the run that motivated it" without breaking either.

**Accepting one goes through the ordinary binding lifecycle, never around it.** `create` → `submitForReview` → `approve`, the same three calls a demonstrated binding makes, with the drifted binding superseded at accept time and not one moment earlier. There is exactly one way a binding is ever made, and recovery is not a second one. Accepting is also the *only* thing that changes anything: nothing polls for proposals, nothing accepts one on a timer, and accepting does not start a run.

**Accepting refuses whenever the world has moved.** The step re-recorded since the proposal, the step edited so its checksum no longer matches, or a proposed binding that no longer validates against the step — all three are refusals, none are repairs. A proposal is a sentence written at a particular moment, and a stale one is withdrawn rather than adjusted to fit.

**A proposal rewrites the selector chain and nothing else.** The step id, the value source, the extracted variable, the captured revision, the step checksum and **the fingerprint** all carry over untouched. Keeping the fingerprint matters most: Orbit is claiming this is the same element under a different name, so if the claim is wrong the next run drifts again and stops again, rather than quietly adopting whatever the fallback found.

**One open proposal per step, enforced by a partial unique index.** A drifted agent on a schedule would otherwise write one identical proposal per run and a reviewer would open Studio to a hundred copies of one sentence. Later observations are recorded as `recovery.declined` with reason `already_proposed`, which is honest: the proposal exists, it is just not a new one.

**Its own permission, and a trust-tier step up.** `permissions.recovery = { allowed }`, granted per document and compiled into each published version. An agent without it produces no proposals at all — the page is not even probed on its behalf. Under ADR-013 this is Tier 0 `observe` to Tier 1 `recommend`, and it stops there: `autonomous_recovery` is Tier 5 and describes something Orbit does not do. There is no `apply` to grant, because there is no code path that applies a proposal. The grant is frozen into the IR rather than read live, because a published version is immutable and must state its own authority (ADR-005) — withdrawing it stops future versions declaring it and cannot retract it from versions already published.

**The runtime observes; it does not diagnose.** `packages/runtime` gains a `RecoveryProposer` port and no new dependency, exactly as ADR-032 did for the judge. At the moment of drift the runtime is the only place the live page and the approved fingerprint exist together, so it gathers what both say; deciding what the difference *means* needs neither, so neither happens there. `decision-judge-boundary.test.ts` now proves the runtime cannot reach `@orbit/drift-recovery` or `@orbit/execution-assist` through the whole workspace closure.

**The model seam is built and inert, and this is stated in the code rather than only here.** `DriftCandidateRanker` is declared, implemented by nothing, called by nothing, and unreachable from a synchronous `diagnoseDrift`. `narrowDriftCandidates` is called in the position a ranker would attach to — and the comment there says plainly that with the exact-match filter below it currently removes nothing the comparison would not also remove. It is the seam in the seam's proper place, not hidden work. **No model call exists, so no spend is recorded**; if a ranker is ever added, `@orbit/model-budget`'s three scopes and the `model_usage` ledger apply from the first call, as they do for the judge.

**Two evidence events, and no third.** `recovery.proposed` and `recovery.declined`, both appended by the run that hit the drift and both about the *document*. Declining is reported as precisely as proposing, because "Orbit looked and would not guess" is the claim this feature most needs to be able to prove afterwards. There is deliberately no `recovery.applied`: an event type for it would describe a code path that does not exist and invite one that should not.

**An unresolvable approved locator is drift.** The original check compared an element it had found, so the most ordinary way a page changes — the test id renamed, the button untouched — escaped the drift path entirely and surfaced as a raw executor timeout with none of the evidence ADR-018 promises. It is drift, it is now reported as drift with a typed `drift.failure` of `unresolved`, and it is the case recovery is best at explaining.

**The binding resolver is wired into both composition roots.** Without it none of this is reachable, because the drift check had never been fed a binding in a real run. Bindings are loaded from **the candidate the version was published from**, never from the document's current bindings: a run executes an immutable Agent Version and must be checked against the fingerprints compiled into it, not ones edited afterwards.

### Consequences

**The drift check is live in production for the first time, and that is a behaviour change.** Any bound agent whose recorded fingerprints do not match its page will now stop where it previously proceeded. That is the correct behaviour and it is why ADR-018 exists — but it was latent until now, and turning it on immediately found real wrong data: several library-demo fixture fingerprints were guesses that had never been compared to the portal. They are now measured through the executor's own `describeElement`. Anyone with existing bindings recorded against a page they no longer match will see runs stop; the fix is to re-demonstrate, which recovery will often propose for them.

**Two duplicated event-type lists had silently diverged, and the duplication is now pinned.** `@orbit/db` holds its own copy of the vocabulary because a CHECK constraint must be a literal list at migration time. Adding a type to `@orbit/contracts` alone produces code that typechecks, passes every unit test, and **drops the event at run time** — which is exactly what happened while this was being built, hidden by the deliberate decision that a failed evidence write must not replace the failure being recorded. `packages/db/src/index.test.ts` now asserts the two lists are identical.

**A proposal is durable and broadly readable, so it holds element identity and nothing else.** Roles, accessible names, control labels, and which locators were tried. Never page content and never a value the workflow read. A run event carries even less: which locators were probed and whether each resolved.

**Recovery cannot help the case it would be most valuable for.** A binding with a single locator has nothing to fall back on, so a page that renames its only test id produces `no_candidate` and a request to re-demonstrate. `adviseOnSelectors` already warns about single-locator chains; this is the cost of ignoring that warning, made concrete.

**A decision binding is not recoverable.** It names one element per branch and the runtime never drift-checks one, so there is no single target to replace. Refused explicitly rather than half-handled.

**The demo requires a page that really changed, and the portal is not left changed.** `apps/library-portal` renames one test id for a page load when the URL carries `?drift=1` — opt-in, off by default, nothing to revert, and pinned by three e2e tests including one asserting the default page is unchanged.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Let the runtime retry through the surviving fallback | The system substituting an element nobody approved, at run time, silently. The exact thing ADR-018 exists to prevent |
| Write the proposal as a `draft` execution binding | It becomes the step's "current" binding and blocks compiling and publishing a document with nothing wrong with it |
| Set `parentBindingId` at proposal time | `create` supersedes the parent in the same transaction. A proposal that supersedes something is not a proposal |
| Rank candidates with a model in v1 | The common case needs no model, and a model here turns a wrong guess into a proposal a busy person accepts. Deterministic first, seam ready |
| Report a numeric confidence | A float from a boolean test is false precision, and someone will tune a threshold against it |
| Propose the best of several plausible candidates | That is judgement, and judgement about which element to click is the decision this whole design withholds |
| Search the page for lookalike elements | Produces candidates no human ever approved. The chain is a bounded set with a person's signature on it |
| Let the proposal carry a fresh fingerprint | Orbit would adopt whatever the fallback found. Keeping the approved fingerprint means a wrong claim drifts again |
| Give the runtime the diagnosis logic | It already holds the page; adding "and decides what changes mean" is capability creep past ADR-008 |
| A `recovery.applied` event | Describes a code path that does not exist and invites one that should not |
| Re-run the workflow automatically after accepting | Accepting is a review decision; starting a run is a separate human act, and merging them hides one behind the other |
| Read the document's current bindings at run time | A published agent would silently change what it verifies when someone re-records an unrelated step |
| Grant recovery under an existing browser permission | An agent granted `click` would have quietly been granted opinions about its own mapping |
| Move recovery-enabled agents to Tier 5 `autonomous_recovery` | Tier 5 describes recovery that acts. This one proposes, which is Tier 1 `recommend` |
| Leave the guessed fixture fingerprints alone | They were wrong. Wiring the drift check without fixing them would have shipped a demo that fails on its first step |

## ADR-034: One selection layer for every model call, with family and invocation as separate axes

**Status:** Accepted — not exercised against a real Gemini or Bedrock service

> The selection layer is implemented and unit-tested across both axes, and the Anthropic direct path is exercised continuously. The **Gemini and Bedrock paths have never been called against a real service** — they are structurally correct and unproven. `.env.example` says so at each of them. Treat them as untested integrations rather than as supported configurations.

**Phase:** 2

### Context

Three packages in Orbit call a model, and until this task each of them decided for itself which one.

- `@orbit/sop-generation` drafts a graph from free text. It had a provider factory, an Anthropic provider, a Bedrock provider, and a vocabulary of provider names.
- `@orbit/decision-judge` resolves a judged decision at run time (ADR-032). Anthropic only, with its own client, its own default model, and a character-for-character copy of the token-usage reader.
- `@orbit/execution-assist` advises a person mapping a workflow to a page. Anthropic only, its own client, and a default of Sonnet — the one call site that had never been brought in line, noted as out of scope by the task that introduced the seam.

The user's request was to choose between Anthropic and Gemini with one variable. Adding a second family to the drafting factory alone would have satisfied that request literally and produced the worst available outcome: `LLM_PROVIDER=gemini` would have moved drafting to Gemini and left judged decisions and authoring advice on Claude, spending against the same budget, writing into the same ledger, and looking entirely coherent while doing it. A configuration switch that moves *some* of the calls is worse than no switch at all, because nothing surfaces the half that did not move.

The second problem was in the existing vocabulary. `ORBIT_LLM_PROVIDER` accepted `anthropic | bedrock` — one variable holding two different questions welded together. `bedrock` is not a vendor of models; it is a way of reaching Anthropic's. So "the same models, direct on a laptop and through Bedrock in production" had no spelling, and a second *family* had nowhere to go that did not collide with a transport.

### Decision

**One package, `@orbit/model-provider`, owns which model is called and how.** All three call sites resolve through it and construct their client through it. It is deliberately narrow: which family, reached how, with which credential, at which model id, reporting usage in one shape. It knows nothing about SOPs, runs or steps.

**The three domain contracts are not merged, and merging them would have been the mistake.** `LLMProvider` returns an unvalidated SOP proposal for a repair loop to fix; `DecisionModel` returns an index into a closed list; `AssistProvider` returns an advisory verdict nothing applies. These are three different contracts with three different failure meanings — a drafting failure means no draft, a judge failure halts a run, an assist failure means no advice — and one interface over them would have had to be the weakest of the three. Each package keeps its own interface and binds its own schema; what it does not keep is a client.

**Family and invocation are separate axes.**

| Axis | Variable | Values | Default |
|---|---|---|---|
| Which model family | `LLM_PROVIDER` | `anthropic`, `gemini` | `anthropic` |
| How it is reached | `LLM_INVOCATION` | `direct`, `bedrock` | `direct` |

This is what makes the deployment story work without a code change: a laptop runs `anthropic` + `direct` with an API key, the same build in an AWS account runs `anthropic` + `bedrock` with a region and the AWS default credential chain, and no application code — not one line in drafting, the judge or assist — knows the difference. The environment decides.

**`gemini` + `bedrock` is refused at resolution, at startup.** Bedrock does not serve Google's models, so the combination cannot be satisfied by anything. The error names the problem and both ways out. Failing at the first drafting request of the day, as an opaque "model not found" from someone else's API, would be a far more expensive way to learn the same fact.

**A mistyped value stops the process; an absent one does not.** An unrecognised `LLM_PROVIDER` or `LLM_INVOCATION` throws — a deployment that wrote `gemni` meant Gemini, and silently serving it Anthropic bills an account it never chose. Missing *credentials* are the opposite case and return an `unconfigured` resolution: the API still boots, every route that does not need a model still works, and the one that does says which variable is missing. Each consumer appends the feature that is affected, so the message names both the variable and the thing that stopped working.

**The superseded names are honoured and translated, not merely tolerated.** `ORBIT_LLM_PROVIDER=bedrock` meant Claude models through Bedrock, so it now sets `LLM_PROVIDER=anthropic` and `LLM_INVOCATION=bedrock` — the same behaviour it always had, now expressible. `ORBIT_LLM_MODEL` maps to the selected family's model variable. The new names win when both are set, because a deployment that adopted the new spelling said so more recently and preferring the old one would make migration impossible to finish. A deprecation notice is emitted once per process, as a warning: refusing to boot over one would defeat the point of accepting it.

**The ledger's existing values keep meaning what they meant.** `providerLabel` reports `bedrock` whenever invocation is Bedrock and the family name otherwise, so `model_usage` still holds `anthropic` and `bedrock` exactly as before, with `gemini` as the only new value. No migration, and no re-reading of history.

**Gemini's default is `gemini-2.5-flash-lite`, and the rate table gained a row for it.** Rates are keyed by model id, so a default with no row would silently fall to `FALLBACK_MODEL_RATE` — conservative, so the failure would show as a spend readout several times too high rather than as anything that looked broken. The test that pins this now iterates `DEFAULT_MODEL_IDS` from the selection layer rather than a hand-written list, so a new family or a new default cannot be added without a rate.

**The judge's bound on its answer is not a provider's to keep, and that is now stated where it matters.** The index is constrained three times: the schema asks for it, LangChain refuses a reply that does not satisfy it, and `@orbit/runtime` re-validates independently before the index reaches control flow. The third is the guarantee, and it is deliberately outside every provider. This matters more under Gemini than under Claude: Gemini's structured output is built on a schema subset that does not carry every JSON Schema keyword, so a numeric bound there is a request rather than an enforcement. Orbit does not rely on anyone but itself to keep it, and ADR-032's guarantees are therefore unchanged by this task.

**`@orbit/runtime` still cannot reach a provider, and the new package is named in the guard.** `decision-judge-boundary.test.ts` walks the whole workspace dependency closure; `@orbit/model-provider` is on its forbidden list for the strongest reason on that list — it is now a single, convenient, entirely reasonable-looking import that would give the process executing approved steps the ability to call any model for any reason.

### Consequences

**A third family, or a fourth call site, is now a small change in one place.** Adding Gemini touched one `if` in one file, one default, and three rate rows; the drafting pipeline, the judge and the assist provider needed no provider-specific code at all. That is the property being bought.

**Authoring advice changed model.** It defaulted to Sonnet and now takes the deployment-wide default, which is Haiku or Flash-Lite. Reading a role, an accessible name and some visible text and saying whether they look related does not need a larger model, and this assist runs on every step a person records. A deployment that disagrees sets one variable.

**Two files became one, twice.** The Anthropic and Bedrock drafting providers were the same file with a different constructor at the top; both are gone. The judge's private copy of `usageOf` is gone. One usage reader now serves every call, which is what makes "the budget means the same thing whichever provider spent it" true rather than intended.

**Gemini and Bedrock are structurally verified and not exercised.** There are no Google or AWS credentials in this environment. What is demonstrated by test: the selection resolves, the client constructs, a schema binds, the descriptor is right, usage is read from the normalised shape, the rate table prices every default, and no boundary was crossed. What is *not* demonstrated: that a real Gemini or Bedrock endpoint replies the way this code expects. Treat the first real call on either as the test. The Anthropic direct path is the only one with a real credential available, and even that is not called by any test — no test in this repository calls a model.

**Every `createUnconfigured*` path is preserved.** Drafting, judging and assisting each still degrade to a clear failure on the route that needs a model, never at boot. What changed is that the reason is now assembled from a shared half that names the variable and a local half that names the feature.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Add Gemini to the drafting factory only | `LLM_PROVIDER` would move one of three call sites and leave two behind, spending from the same budget and looking coherent. The exact failure the requirement is written to prevent |
| One shared provider interface for all three call sites | They return a proposal, an index, and a verdict, and fail with three different meanings. The union would have to be the weakest of them |
| Keep `LLM_PROVIDER=bedrock` as a third value | It welds transport to vendor. `anthropic` direct and `anthropic` through Bedrock is one family reached two ways, and Gemini would have no non-colliding place to go |
| Let `gemini` + `bedrock` fail at the first call | The configuration cannot be satisfied by anything. Startup is where an impossible environment should be reported |
| Infer invocation from the presence of AWS credentials | A developer with an AWS profile on their laptop would silently be routed through Bedrock. Deployment intent must be stated, not guessed |
| Add an Orbit variable for AWS keys | A second place a secret could be typed. The AWS default credential chain is what everything else in the account already uses |
| Drop the `ORBIT_LLM_*` names outright | Someone's working `.env` breaks silently, which is the one thing a rename must not do |
| Prefer the old names when both are set | Migration could never be completed |
| Let each package read `process.env` for its own selection | That is precisely the arrangement being removed |
| Move `DecisionJudge` or a client into `@orbit/runtime` while consolidating | ADR-008 and ADR-032 deny the runtime that capability, and the boundary test that proves it now names the shared package too |
| Trust Gemini's schema to enforce the judge's index range | Its structured-output schema subset does not carry every keyword. The runtime's own re-validation is the guarantee, and it always was |
| Add Gemini defaults without rate-table rows | Every Gemini call would silently cost the conservative fallback rate, and the spend readout would be wrong in the safe-looking direction |

## ADR-035: Bind a whole workflow from one walkthrough, by proposing an alignment nobody has to trust

**Status:** Accepted

**Phase:** 2

### Context

ADR-027 gave a drafted workflow a way out of the compiler's `missing_binding` refusal: a binding session, started from Watchtower, that opens a headed browser aimed at one step. It works, and it is the wrong shape for the job it is most often asked to do.

The seeded library workflow has **nine** steps the compiler requires a binding for. Binding it means: open a browser, perform one action, save, re-aim at the next step, perform one action, save — nine times, each time re-establishing the page state the previous step left behind. This was hit in real use, and it is the main reason the guided and AI-drafted paths feel worse than recording. Recording a workflow from scratch takes one sitting; binding an existing drafted one takes nine.

The obvious alternative — match the drafted step's `targetHint` and `fieldHint` against the elements on the page — does not work, and the reason is worth stating because it is not obvious until you try it. **Most of the elements a workflow acts on do not exist until you have interacted with the page.** The library workflow's Borrow button is not on the catalog page; it appears after a search returns an available title. The confirmation text does not exist until the loan is placed. A static scan of the start URL can see the search box and nothing else, so it could bind one step out of nine and would have to guess at the rest — and a guess about which element to click is precisely the judgement ADR-018 and ADR-033 exist to withhold.

The information needed to bind those elements only exists while somebody is performing the task. So the task is what Orbit should watch.

### Decision

**Perform the whole task once; Orbit works out which captured interaction belongs to which drafted step.**

**The alignment is deliberately dull, and its dullness is the feature.** `alignDemonstration` in `@orbit/sop-recording` matches on **kind and order, and nothing else**: the first `fill` in the walkthrough is the first unbound `fill` in the workflow. Three properties are load-bearing.

- **Deterministic, as a type rather than a promise.** The function is synchronous, so a network call cannot be hidden in it, and switching a model on would mean changing a signature a reviewer sees. This is verbatim the guarantee ADR-033 gives `diagnoseDrift`, for the same reason.
- **Explainable.** Greedy, in order, first match wins. A person reviewing the result can check it by counting. A globally optimal alignment — a Levenshtein or Hungarian match over kinds — would match more steps in awkward cases, and nobody could predict what it would do, including the person who wrote it. When the output of a system is a set of claims a human must accept or reject one by one, being predictable beats being right slightly more often.
- **Silent when unsure.** A step with no clean match gets nothing, and says why. A confidently wrong element is worse than a blank, because a blank is obviously unfinished and a wrong element looks finished.

**Nothing is applied. A walkthrough writes proposals.** This is ADR-033's posture, taken for the same reason — the system has formed an opinion about Orbit's own definitions, and an opinion is not an approval — and it reuses ADR-033's machinery rather than paralleling it. `binding_recovery_proposals` gains an `origin` column (`drift` | `demonstration`) and a nullable `proposed_for_binding_id`; everything else about a proposal already fitted exactly. It is a drafted binding attached to its document and step, it supersedes nothing while it waits, exactly one may be open per step, and accepting it runs `create` → `submitForReview` → `approve` through `acceptRecoveryProposal`. **There is still exactly one function by which a binding is ever created, and this feature did not add a second.**

The table's name is now narrower than what it holds, and that is a deliberate trade. Renaming it to `binding_proposals` would have meant a migration on an audit table plus a rename through the repository, the mappers, the contract id type, the service, the routes, the views and the Watchtower panel — a broad refactor to buy a better noun, against a `CLAUDE.md` rule that says not to. The schema file says plainly what the table now holds.

**A walkthrough proposal replaces nothing, and the accept path was generalised rather than branched.** A drift proposal names the binding it replaces; a demonstration proposal names none, because its step has never been bound. Both are the same question — *is the step's live binding still what this proposal was written against?* — so `acceptRecoveryProposal` compares `current?.id ?? null` with `proposal.proposedForBindingId ?? null`. For a walkthrough proposal, a binding appearing in the meantime is exactly as much of a reason to refuse as a re-recording is for a drift one.

**A decision is excluded, permanently, and said so on screen.** One walkthrough follows one path, so it cannot demonstrate both branches of a `decision`; a decision needs one element per branch or it compiles to an `expect_one_of` that cannot name a state the agent can reach (ADR-029). Decisions keep the branch-by-branch flow. This is stated in the panel before anyone starts and again beside the decision's own row, because a person who is not told reads a blank row as Orbit having failed rather than as Orbit declining.

**A walkthrough is offered only the steps that have no binding**, in workflow order — which is what `alignDemonstration` documents its caller as doing. Re-proposing a mapping somebody has already demonstrated would ask them to review finished work.

**One value never leaves the browser: what was typed.** A fill's `valueSource` comes from `defaultValueSourceFor(step)` — the step's own declared `${inputs.bookIsbn}` — never from the demonstration. So a proposal holds the element's role and accessible name and nothing else, and a password field's contents cannot reach a durable row even in principle. This is the same rule the capture list already followed, applied to a record that persists.

**A third session registry, not a flag on an existing one.** What separates the three is what *finishing* means: a recording finishes by creating a document, a binding sitting never finishes (it saves a row and leaves the page where it is, because the next step starts there), and a walkthrough finishes by writing proposals and closing the browser, because the task is over and what remains is reading. One method meaning three things behind a discriminated input is the overload ADR-020 warned against. What the three actually share — ids, idle reaping, `closeAll`, and the hazard of a Chromium outliving the API — is `recording/session-store.ts`, already extracted.

**The session outlives its browser.** After proposing, the window closes and the entry stays, holding the outcome, so the review screen survives a reload. This matters for one specific thing: the refusals. A proposal is a row and a refusal is the *absence* of one, so "nothing in the walkthrough matched this step" cannot be recovered from the database at all. Each proposal's `state` is re-read live on every poll, so a proposal accepted in another tab stops offering an accept button.

**Reading a value is an explicit mode, not an inference.** A walkthrough runs in `action` mode because the person is doing the real task and the page must react as it would for them. An `extract` step is demonstrated by *pointing*, which must not fire the page's handlers, so the panel offers the switch and says which mode is active — rather than leaving somebody to wonder why their click did nothing.

**The per-step flow is untouched.** Not deprecated, not a fallback: it is how a wrong proposal is corrected, how a decision is bound, and how anything the walkthrough could not account for gets done. Every refused row on the review screen carries a button straight into it.

**Accepting in bulk is N calls, not a bulk endpoint.** Each acceptance is independently valid or refusable — a step somebody bound in another tab a moment ago must be refused while the rest still go through — and a server-side loop would have exactly those semantics with one more route to keep honest.

### Consequences

**A nine-step workflow is bound in one sitting instead of nine, for the path that was walked.** On the seeded library workflow, one borrow-path walkthrough proposes five of the nine and explains the other four: the decision, and the three steps of the hold branch nobody performed.

**A branching workflow needs more than one walkthrough, and the second one is the sharp edge.** Walking the hold path afterwards aligns against a set narrowed to the still-unbound steps — which no longer includes the borrow-path prefix, while the walkthrough itself still *performs* that prefix. The ISBN field gets demonstrated again and the first unbound fill is now `enter_hold_member_id`, so it is offered the search box. **This is a wrong proposal, it is visible in review as "Filled 'Search the catalog'" against a member-ID step, and the review screen exists precisely for it.** Greedy alignment cannot understand branches; making it try would trade a predictable failure for an unpredictable one. The demo documentation says to bind the second branch step by step.

**A walkthrough is worth doing on a workflow that is mostly unbound.** The narrowing that makes the first walkthrough clean is what makes a later one on a partly-bound workflow prone to the drift above. The panel says so.

**Every acceptance is a real binding through the real lifecycle**, so a workflow bound this way publishes through exactly the gate ADR-027 built, with no new path and no exception.

**One more browser-holding registry, and one more thing that must not outlive the API.** It is closed in `startApi`'s teardown beside the other two, and its idle reaping is the shared store's.

**The proposal table now serves two producers and one consumer.** That is the property to preserve. A third producer would be fine; a second *accepter* would not.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Match drafted hints against elements on the start page | Most elements the workflow acts on do not exist until you have interacted with the page. It could bind one step of nine and would guess the rest |
| Optimal (Levenshtein / Hungarian) alignment instead of greedy | Matches slightly more in awkward cases, and nobody can predict what it will do. For output a human must accept claim by claim, predictable beats occasionally-better |
| Score each match with a confidence number | A float computed from "the kinds matched and the order held" is false precision, and somebody will tune a threshold against it. ADR-033's reasoning, unchanged |
| Ask a model which capture is which step | The deterministic version already handles the common case, and a model here turns a wrong guess into a proposal a busy person accepts. The seam is a signature change, in the open |
| Write the bindings directly and let a person undo them | Nine unreviewed mappings, live, from an alignment that can be wrong. The undo would be the review, after the risk |
| Write proposals as `draft` execution bindings | Exactly ADR-033's rejected alternative: `listCurrent` would return them and block publishing a document with nothing wrong with it |
| A second proposals table for demonstrations | Two copies of "supersedes nothing, one open per step, accepted through the lifecycle" — the rules that make a proposal safe |
| Rename the table to `binding_proposals` | A migration on an audit table plus a rename through eight layers, to buy a noun. The schema comment states what it holds |
| Fold walkthroughs into the binding-session registry | Three different meanings of "finish" behind one method with a discriminated input — the overload ADR-020 named |
| Offer every bindable step, not just the unbound ones | Contradicts `alignDemonstration`'s stated contract, and misaligns the ordinary case (a walkthrough of a workflow bound from step 4 onwards) to protect an unusual one |
| Infer pick mode from what somebody clicked | A click that reads a value and a click that presses a button are the same event. Guessing wrong fires the page's handlers, which is not undoable |
| Let a walkthrough bind a decision from the path it took | A decision bound for one branch compiles to an `expect_one_of` that cannot name the state the agent reaches down the other (ADR-029) |
| Keep the walkthrough session id out of the URL | A reload would orphan a real Chromium, which is the hazard `bindingSessionId` is in the URL to avoid |
| A bulk accept endpoint | Each acceptance is independently refusable; a server loop has the same semantics with one more route to keep honest |

## ADR-036: Revising a published workflow forks a new draft, and binding stays available without it

**Status:** Accepted

**Phase:** 2

### Context

A person with a published workflow asked how to make a new version of it. There was no answer.

`SOP_REVISION_TRANSITIONS` has always had `approved: ['superseded']`, and `request_clarification` — the one transition that moves a revision backwards — is legal only from `in_review`. So an approved revision has never had a route back to an editable state. That was survivable while a person walked the lifecycle by hand: they passed through `in_review`, could see the workflow was wrong, and could send it back before approving.

ADR-028's one-click publish removed that pause. Publishing now drives `draft → in_review → approved → published` in a single action, so the last state a person could have turned back from goes by without them ever seeing it. The wall was always there; what changed is that everybody now walks into it at full speed, on their first publish, with no warning.

The same person reported the review page as confusing once a workflow was approved. It was: every section decided independently whether to render, so a finished workflow showed a publish panel, a "bind every step in one walkthrough" offer, and the per-step binding panel all at once — three surfaces each presenting itself as the next thing to do, on a document where the answer was *nothing*.

### Decision

**Revising forks. It does not reopen.**

`reviseDocument` copies the current revision's graph into revision N+1 as a `draft`, with provenance kind `edited`, and supersedes the parent in the same transaction — through `sopGraphRevisions.create({ ..., parentRevisionId })`, the one path every edit, insert and reorder already takes. No new superseding mechanism exists, and `approved: ['superseded']` is unchanged.

Reopening was the obvious alternative and it is wrong on the merits. An approved revision is what a published Agent Version was compiled from, and that version is immutable by ADR-005 and ADR-014. Mutating the revision it came from would leave a live agent whose stated source no longer says what it said when somebody approved it — traceability that quietly stops being true is worse than none, because it is still believed.

**Forking is cheap, and that is load-bearing rather than incidental.** Binding staleness is `binding.stepSha256 !== stepChecksum(step)` — a per-step content checksum — and a binding row is keyed by `(document, step)`. Neither knows what a revision is. So a fork whose steps are byte-identical leaves every binding `approved` and fresh, and only a step somebody actually edits afterwards goes stale. This is what makes revising a small act rather than a decision to redo the demonstration work. It is asserted directly — checksum equality across the fork, and a real persisted approved binding still passing `isBindingUsable` afterwards — because the feature is worth nothing if it ever stops holding.

**Revising a workflow that is already editable is refused, not silently satisfied.** `already_editable` is a typed result, following the convention every other write in this service uses; the route reports it as 409. There is nothing to fork, and quietly spending a revision number on a copy of a draft would leave two revisions where a person expected one.

**It asks before it does it.** Three things are reasonable to fear here and all three are false: that the published version will change, that the mappings will have to be redone, and that the approved revision will be rewritten. None of them is visible from a button, so the confirmation states each one before the click rather than leaving it to be discovered afterwards.

**Publish comes back for a revised document, and that is why `PublicationStatus` gained `compiledFromRevisionId`.** The publish action was gated on `stage.kind !== 'published'`, which was a complete answer only while published meant finished. A revised document is published *and* has an unpublished revision, and withholding the button there would make revising a dead end. The distinguishing fact — which revision the current candidate was compiled from — was already on the candidate row; nothing new is persisted, and the view field is derived on read.

**The review page is laid out from one derived phase.** `reviewPhase(review, bindings)` returns `drafting`, `ready` or `published`, and the page leads with what that phase makes relevant: what is still unmapped, or Publish, or what is running. It is a pure function with its own tests, so "what should this page show for a workflow in this state?" is a question something can answer rather than an emergent property of six independent conditions. Published wins over everything, because a running version is the most important true thing about a document — including a revised one, which is published *and* editable *and* fully bound simultaneously.

**On a published document the binding surfaces stay available, collapsed, not hidden behind Revise.** Binding is legal on an approved revision and always has been, and it is how a drifted mapping is repaired and republished *without changing any step* (ADR-033). Forcing a new revision for a pure re-bind would demand an edit nobody wants to make in order to fix something that is not an edit. So they are quieter and folded away by default, under a disclosure that says what they are for; they are not gated.

**The walkthrough offer moved inside the binding panel.** A walkthrough *is* a binding action — the fast route to what "What each step does on the page" is about. As a sibling section it read as a fourth, separate piece of work competing with the panel next to it, and that adjacency was most of the reported confusion. ADR-028's rule that the offer disappears once `isFullyBoundForPublish` holds is unchanged: the server refuses a walkthrough with nothing to bind, and the UI withholds the offer on the same fact.

**The two live workspaces — a binding sitting and an open walkthrough — stay outside anything that collapses.** Each holds a real Chromium open on the machine running the API, and a window a person cannot see is a window they cannot close.

### Consequences

**A published workflow has a next version.** Revise, edit or re-bind, publish; the new version is allocated under the same agent by ADR-023's `nextVersionAfter` and ADR-024's `agentIdForDocument`, and the version that was running is untouched throughout. Proven end to end: publish, revise, every binding still approved, publish again, two versions under one agent.

**A revised recorded workflow publishes through the bound path, not the recorded one.** Its new revision's provenance is `edited`, so `publish-recording-service.ts` refuses it as `not_recorded` and `publish-bound-document-service.ts` takes it — which is correct rather than incidental. The recorded fast path exists because a person demonstrated every action personally (ADR-025); once somebody has edited the graph afterwards, that is no longer true of the thing being published, and the bound path's requirement that every step carries an approved, non-stale mapping is the check that still is.

**Republishing an unchanged fork is possible and mints a version.** A person can revise and immediately publish, producing `0.1.1` byte-identical in behaviour to `0.1.0`. Harmless — versions are cheap and immutable — but it is not prevented, and nothing detects it.

**`open-published-agent` moved out of the publish panel into the published lead.** Rendered in both it would have been two controls with one name; left only in the panel it would have been buried inside the section a finished workflow collapses.

**The drift-recovery model is untouched.** A drifted run still fails and stays failed; recovery still proposes only from the approved binding's own fallback chain, still scans for no lookalikes, still writes a separate proposal record, and acceptance still does not publish. Revising is not a recovery mechanism and no copy anywhere suggests it is.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Add `approved -> needs_clarification` and reopen the revision in place | The revision a live, immutable Agent Version was compiled from would start saying something it did not say when it was approved. Traceability that silently stops being true is worse than none |
| Copy the whole document instead of forking a revision | A second document means a second agent (ADR-024 derives the agent from the document), so the new version would not be a version of anything — and every binding, keyed by document, would have to be redone |
| Fork automatically on the first edit of an approved revision | The fork is a decision with consequences worth naming — a new revision number, a supersession, and a workflow that now differs from what is running. Doing it as a side effect of typing hides all three |
| Skip the confirmation | The three things a person fears here are all false and none is visible from the button. This is exactly the case a confirmation is for |
| Hide the binding surfaces behind Revise on a published document | Binding is legal on an approved revision and is how a drifted mapping is fixed without changing a step. Forcing a revision for a pure re-bind would require an edit to fix something that is not an edit |
| Leave the walkthrough offer as its own section | The adjacency was the defect: the fast route and the slow route to one outcome, side by side, reading as two separate pieces of work |
| Derive "has unpublished changes" by comparing graph checksums | The candidate row already records the revision it was compiled from. Re-deriving the same fact from bytes would be a second answer to a question that already has one |
| Block republishing a fork nobody changed | Detecting it means defining "changed" across a graph and its bindings, to prevent something harmless. Versions are cheap and immutable |

## ADR-037: Give every execution surface its own permission section, addressing vocabulary, and evidence set

**Status:** Accepted

**Phase:** 3

> Recorded as *Proposed* and reviewed before sub-phase 3.1 wrote the contract it
> describes, because the shape lands inside immutable published Agent Versions
> and ADR-005 and ADR-014 forbid migrating those afterwards. Accepted at that
> gate; 3.1 implements the permission half. The addressing vocabularies and
> evidence sets arrive with the surfaces that bring them.

### Context

Orbit automates one surface, and that is a type-level fact rather than a
preference. `permissionsSchema` makes `browser` a **required** section, so a
workflow that never opens a browser must still declare a browser grant to be
valid at all. `STEP_TYPE_TO_BROWSER_ACTION` states that a step's permission *is*
a browser permission. `BrowserExecutor`'s every page-touching method takes the
browser-only `Locator`. The interpreter opens exactly one executor per run and
calls `finishTrace()` on it unconditionally — a Playwright concept sitting in the
generic run loop. Evidence grants are read from `permissions.browser.allowedActions`.
Half the error taxonomy is named after a browser: `BROWSER_TIMEOUT`,
`LOCATOR_NOT_FOUND`, `UNEXPECTED_UI_STATE`.

ADR-008 anticipated this. It put Playwright behind an executor boundary
specifically so "an API executor can be added later without replacing runtime
semantics," and ADR-002 kept SOP Graph separate from Agent IR because "coupling
the process model directly to Playwright would make the product brittle and limit
future execution adapters." Both were right about the seam and neither designed
what goes through it. The seam that exists is browser-shaped: it mixes generic
lifecycle concerns (`close`) with DOM concerns (`captureDom`, `describeElement`)
in one interface.

The pressure is a terminal (3270/5250) surface and an HTTP API surface. A green
screen is not a page and an endpoint is not an element, but both need exactly
what a page needed: a way to say what an agent is allowed to reach, a way to name
a thing without writing a program that finds it, and evidence a reviewer can read
afterwards.

### Decision

**A surface is the unit. Each one brings three things, and a surface that cannot
supply all three does not get added.**

**1. Its own permission section.** `permissions.browser` becomes optional, and
each surface gets a sibling section: `permissions.terminal`, `permissions.api`,
`permissions.credentials`. Absent means not permitted. This is not a new pattern
— `permissions.model` and `permissions.recovery` already work exactly this way,
for the reason stated in ADR-032 and ADR-033: a model call and a repair proposal
are different capabilities from anything a browser does, and smuggling one in
under a browser grant would mean an agent granted `click` had quietly been
granted judgement too. Reaching a mainframe is a different capability from
reaching a webpage by the same argument.

The step→permission map becomes step type → `{ surface, action }`, kept as a
`satisfies` table so a step type with no permission mapping fails to compile.

**2. Its own closed addressing vocabulary.** `Locator`'s three strategies —
`test_id`, `role_and_name`, `label` — exist so that no raw CSS or XPath is
*representable*, because a selector string is a small program for walking the DOM
(ADR-018). That property is what every surface must reproduce, and it is why
`Locator` is **not** widened to cover screens or endpoints. A terminal names a
field by `field_at(row, col)`, `field_after_label(text)` or `named_field(id)` —
never a raw buffer offset and never a regex over screen text. An API names an
operation by its id in a catalog imported from an OpenAPI or GraphQL document —
never a URL template typed into a box, because a template with interpolation is a
small program for constructing a request.

Widening one type to serve every surface would produce exactly the generic
string-shaped locator the closed vocabulary exists to prevent. Three narrow
vocabularies that cannot express each other are the point, not duplication.

**3. Its own evidence set.** ADR-004 makes evidence a product feature rather than
debug output, and Watchtower's expected-versus-observed view assumes
screenshot/DOM/trace. A surface that produces no evidence would render as a gap
in a run timeline and quietly weaken the central claim. So a terminal step's
evidence is the screen buffer as text — diffable, greppable, and better than an
image — and an API step's is a request/response envelope with headers redacted.

**Executors are split, not widened.** A surface-neutral lifecycle interface
(`close()`, `finishEvidence()`) plus per-surface capability interfaces. There is
deliberately no generic `perform(action)` and no widening of `BrowserExecutor`
into something surface-agnostic: `ports.ts` already argues that the set of things
Orbit can do to a browser is a list, and that widening it is an interface change
which must show up in review. One `ExecutorSet` keyed by surface, opened lazily,
so an agent that never reaches a terminal step never opens a terminal session.

**Contract changes are additive, permanently.** `permissions` and `errorCode` are
fields inside published, immutable Agent Versions. `BROWSER_TIMEOUT` and
`LOCATOR_NOT_FOUND` keep their browser-flavoured names forever; new surfaces get
new codes. No existing code is renamed and no published version is migrated,
because ADR-005 and ADR-014 forbid it.

### Consequences

**An agent can be published that never touches a browser**, which has not been
true before. The validator refuses a step whose surface section is absent, so the
capability is opt-in per published version and visible in review — the same
property `permissions.model` has.

**Evidence stays comparable across surfaces or the failure is visible.** A run
spanning two surfaces must render as one timeline (ADR-031), and that is the
acceptance test for whether this generalized rather than fragmented.

**The step vocabulary grows per surface rather than being generalized.** There is
no `surface.act` step with a payload; there are `terminal.type` and `api.request`
with their own fields. The discriminated union stays exhaustive and the
interpreter's `switch` keeps no `default`, so an unhandled step type is a compile
error rather than a run-time surprise.

**ADR-016's static non-executability scan needs extending**, which its own record
predicted: the denylist is text matching over browser terms and "will need
extending if a new execution surface appears." It is a floor, not a proof, and a
new surface lowers it until the terms are added.

**Three surfaces' worth of vocabulary is more code than one generic one.** That
is accepted deliberately. The alternative collapses to a string, and a string is
the thing ADR-018 exists to prevent.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Widen `Locator` with a `strategy` per surface | It becomes a generic string-shaped address that can name anything, which is precisely what the closed three-member vocabulary exists to prevent (ADR-018). A screen field and a DOM element have nothing in common to unify |
| Add a generic `perform(action, payload)` to the executor interface | `ports.ts` already refuses this for the browser: the set of things Orbit can do is a list, and widening it must show up in review. A generic method makes every future capability invisible |
| Keep `permissions.browser` required and let non-browser agents declare an empty grant | A required field nobody means is a field that stops being read. It would also make "does this agent touch a browser?" unanswerable from the contract |
| One `permissions.surfaces[]` array instead of named sections | Named sections are what `model` and `recovery` already are, and a typed section can carry surface-specific shape — `allowedDomains` for a browser, `allowedOperations` for an API — which a uniform array cannot |
| Rename browser-flavoured error codes to surface-neutral ones | `errorCode` is inside published immutable Agent Versions. A rename would invalidate history that ADR-005 and ADR-014 guarantee |
| Defer the seam and special-case the first new adapter into the browser path | Produces a second seam that never gets merged, and the second adapter pays the cost again. The whole point of ADR-008's boundary was to avoid this |
| One shared evidence format for every surface | A screenshot, a screen buffer and an HTTP envelope are not the same artifact. Forcing one shape would mean storing the weakest common denominator, when the terminal's text buffer is *better* evidence than an image |
