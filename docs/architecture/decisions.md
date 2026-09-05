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
