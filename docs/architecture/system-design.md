# Orbit system design

**Status:** Active. Describes the system as implemented — Phase 1, sub-phases
2.1–2.16, and Phase 3 sub-phases 3.1–3.2 (the surface seam; no second surface
exists yet).

For the original Phase 1 architecture as it was designed, see
[`phase-1-system-design.md`](./phase-1-system-design.md), which is kept as a
historical record. For *why* any of this is shaped as it is, see
[`decisions.md`](./decisions.md).

---

## 1. What the system does

```text
free text, or a recorded demonstration
  -> SOP Graph revision      (immutable, checksummed, non-executable)
  -> Execution Bindings      (which element each step acts on)
  -> candidate Agent IR      (compiled; refused when not fully understood)
  -> published Agent Version (immutable)
  -> a run in real Chromium
  -> events, artifacts, evidence
  -> Watchtower
```

Four layers stay separate, and the separation is the architecture (ADR-002):

| Layer | Is | Is not |
|---|---|---|
| Natural-language SOP | Business intent, in a person's words | Executable |
| SOP Graph | Structured business intent, versioned and checksummed | Aware of selectors, or executable (ADR-016) |
| Execution Bindings | Which element on a real page a step acts on | Part of the graph — bound separately, per step |
| Agent IR | The typed executable contract | Aware of React, Fastify, Drizzle or Playwright |

## 2. Applications

Six, in `apps/`.

| App | Process | Responsibility |
|---|---|---|
| `web` | Vite dev server, port 3000 | Watchtower: Home, Studio, Agents, Runs, Wiki, Admin |
| `api` | Fastify, port 3002 | Every route; **also executes runs** (ADR-011) |
| `browser-worker` | CLI | Composition root for `pnpm agent:run`. Its `dev` script only logs its identity |
| `recorder` | CLI | Composition root for `record:binding` and `record:workflow` |
| `demo-portal` | Vite, port 3001 | Controlled service-request target |
| `library-portal` | Vite, port 3020 | Controlled branching-workflow target |

**Runs execute inside the API process.** There is no queue, no worker fleet and
no scheduler (ADR-011). `RunDispatcher` is an interface independent of the HTTP
request lifecycle, so a durable queue can be introduced behind it without
touching a route — but nothing implements one today. The separate
`browser-worker` process exists as a composition root for one-off CLI execution,
not as a queue consumer.

## 3. Packages

Nineteen, in `packages/`.

### Contracts and representation

| Package | Holds |
|---|---|
| `contracts` | Shared Zod schemas, event types, error taxonomy, opaque IDs |
| `agent-ir` | The typed executable workflow contract, permissions, trust tiers |
| `sop-graph` | The non-executable business-process representation |
| `execution-mapping` | Execution Bindings, selector chains, element fingerprints |

### Authoring

| Package | Holds |
|---|---|
| `sop-generation` | Free text → proposed SOP Graph |
| `sop-recording` | A recorded interaction → SOP Graph plus bindings |
| `sop-service` | Composes generation, review and recording with persistence |
| `execution-recorder` | The capture engine — **the only code Orbit injects into a page** |
| `execution-assist` | Advisory suggestions while mapping; two need no model |
| `agent-ir-compiler` | SOP Graph → candidate Agent IR, refusing what it cannot resolve |

### Execution

| Package | Holds |
|---|---|
| `runtime` | The executor-neutral interpreter, its ports, and the drift check |
| `executor-playwright` | Playwright action implementations — **the only Playwright dependency** |
| `drift-recovery` | Deterministic drift diagnosis and proposal (ADR-033) |
| `decision-judge` | A judged decision, bounded to an index (ADR-032) |

### Platform

| Package | Holds |
|---|---|
| `db` | Drizzle schema, migrations, repositories |
| `artifacts` | The storage interface and its local filesystem adapter |
| `artifact-service` | Composes artifact bytes with artifact metadata |
| `model-provider` | One selection layer: family and invocation as separate axes (ADR-034) |
| `model-budget` | Token ceilings, checked before every call (ADR-029) |

There is no `packages/policy`. Containment is enforced directly — by the
semantic validator at publish and the runtime before every navigation — not by a
policy engine.

## 4. Dependency rules

Enforced by lint, not by convention:

- **SOP Graph must not import Playwright.**
- **Agent IR must not import React, Fastify, Drizzle or Playwright.**
- **The runtime depends on executor interfaces**, never on a UI or framework.
- **The Playwright executor must not determine workflow order.** It executes
  approved Agent IR steps; the interpreter decides what comes next (ADR-008).
- **The recorder is structurally unreachable from anything that executes an
  agent.** Enforced by lint on `@orbit/runtime`, `@orbit/executor-playwright`,
  `apps/api` and `apps/browser-worker`, and by a test that walks the module graph
  from the run-dispatch path (ADR-019, ADR-020).
- **The UI must not access PostgreSQL.** Watchtower reads the API's view of
  durable server state and nothing else.

## 5. Lifecycle concepts

```text
SOP Document
  └─ SOP Graph Revision        immutable, checksummed, ordered history
       ├─ Execution Binding    per step; demonstrated, then approved
       └─ Agent IR Candidate   compiled from an approved revision
            └─ Agent Version   minted at publication; immutable
                 └─ Run
                      └─ Run Step
                           ├─ Run Event
                           └─ Artifact Link → Artifact Metadata → bytes on disk
```

Four immutability rules hold this together:

1. **A revision is never edited.** Editing a step produces the next revision
   (ADR-016). That is what makes it possible to say later exactly what a run was
   compiled from.
2. **A version is never mutated.** Publishing mints one; archiving retires the
   agent's mutable identity row and never touches a version (ADR-005, ADR-026).
3. **Publishing mints rather than promotes.** The runtime executes only
   `published` documents and the compiler emits `draft`, so a candidate can never
   be byte-identical to a runnable version — and that difference *is* the
   approval gate. Exactly two fields differ, verified against what was stored, so
   a widened permission cannot ride along (ADR-023).
4. **Events are append-only.** Enforced in the repository layer; see ADR-014 for
   the database half, which is still deferred.

## 6. Run flow

```text
1.  Watchtower GET /v1/agent-versions, renders declared inputs from the schema
2.  POST /v1/agent-versions/:id/runs
3.  API validates inputs against the version's declared schema
4.  Run created with status `queued`; 202 with the run id
5.  Dispatched through RunDispatcher — in-process, but off the request lifecycle
6.  Run transitions to `running`; an isolated browser context is created
7.  The interpreter walks the Agent IR
      · before every navigate  → the version's allowedDomains is re-checked
      · before every fill/click → the binding fingerprint is verified
      · at a decision step     → a judged call, if permissions.model allows
8.  Events, step state, outputs and artifact metadata are written continuously
9.  The trace is finalised; the run reaches a terminal status and an outcome
10. Watchtower polls GET /v1/runs/:runId and renders persisted data
```

Nothing in that flow reads the SOP text. The runtime executes Agent IR, never
raw SOP text, raw model output or user-supplied code.

### Three gates inside step 7

| Gate | When | Determinism |
|---|---|---|
| Domain allowlist | Before every navigation | Deterministic. Per agent, from the published version (ADR-022) |
| Drift check | Before every `browser.fill` and `browser.click` **that has a resolved binding** | Deterministic. No model (ADR-018) |
| Judged decision | At a decision step, only if `permissions.model` is declared | **The one model call at run time.** Returns an index into a closed branch list (ADR-032) |

The drift check runs at exactly two step types. `browser.expect_one_of` does not
drift-check — it is a branch predicate, not an action on an approved element —
and neither does `browser.extract`, whose text is the value being read.

It also reaches only the agents that have bindings to check. The resolver reads
the bindings of the **candidate the version was published from**, so an Agent
Version with no `publishedFromCandidateId` resolves to none and is not
drift-checked at all. That covers every agent published from a fixture,
including the seeded `Find Service Request 0.1.0` — which is why turning the
check on could not change how any pre-existing agent behaved
(`packages/runtime/src/persistence/binding-resolver.ts`).

## 7. Drift recovery

A page changes, a fingerprint no longer matches, the run stops. What may happen
next is bounded, and the bounds are the design:

- **A drifted run fails.** Recovery never resumes or rescues it.
- Recovery suggests a repair **only from the approved binding's existing fallback
  locator chain**.
- It **never scans the page for unapproved lookalikes**.
- Proposals are **separate records** from bindings
  (`binding_recovery_proposals`).
- A human accepts through the normal **create → review → approve** process.
- **Acceptance does not publish.** A person must publish before later runs use
  the change.
- Recovery is **deterministic and uses no LLM/model**.
- Recovery is **per-document/SOP permission-gated** via `permissions.recovery`.

```text
run fails on drift
  -> DriftObservation handed to the RecoveryProposer port
  -> diagnoseDrift(observation)          synchronous; cannot make a network call
  -> exactly one surviving locator?
       yes -> proposal written to binding_recovery_proposals
       no  -> declined: no_candidate | ambiguous | not_recoverable
  -> a person reads it in Studio
  -> accept -> binding created through create -> submitForReview -> approve
  -> a person publishes a new version        <- nothing automatic reaches here
```

Two structural facts, rather than rules anybody has to remember:

- `diagnoseDrift` is **synchronous**. A synchronous function cannot make a
  network call, so "consults no model" is a property of the type signature.
- `@orbit/drift-recovery` **depends on nothing that could apply a proposal** — no
  Agent Version, no browser, no publish path. The absence is structural.

Flow chart of the whole capability, including the grant:

| Step | Where | Gate |
|---|---|---|
| Grant recovery for a document | `POST /v1/sop-documents/:id/recovery` | **API only — no UI control exists** |
| Compile it into a version | Publish | Becomes `permissions.recovery`, immutable thereafter |
| A run drifts | Runtime | Run fails, evidence captured |
| A proposal is written | `@orbit/drift-recovery` | Only if granted, and only if the diagnosis found exactly one |
| Accept or dismiss | Studio | Accept creates a binding; it cannot publish |
| Publish a new version | Studio | A separate human act |

## 8. Data and migrations

PostgreSQL through Drizzle. **Eleven committed migrations**,
`packages/db/drizzle/0000_phase_1_evidence_schema.sql` through
`0010_proposals_from_demonstration.sql`.

- `pnpm db:generate` regenerates migration SQL after a schema change.
- `pnpm db:migrate` applies committed migrations.
- **`drizzle-kit push` is deliberately unused**: a schema that can drift without
  a versioned migration cannot be reproduced elsewhere.

Every schema change needs a migration. Binary artifact bytes are never stored in
PostgreSQL; metadata and links are (ADR-010, ADR-015).

Three seeds exist: `db:seed` (Find Service Request 0.1.0 from a fixture,
idempotent, refusing a changed fixture under the same version), `db:seed:library`
and `db:seed:library:unbound`.

## 9. Artifacts and evidence

Bytes live under `ARTIFACT_STORAGE_DIR` (default `./data/artifacts`, gitignored),
behind the `ArtifactStorage` interface. The key grammar is generated, never
supplied (ADR-015).

`data/artifacts` is **never statically served**. Evidence leaves Orbit only
through the run-scoped artifact route, which addresses it by two opaque ids,
proves the artifact belongs to that run, reads through the artifact service using
the *persisted* storage key, and verifies the digest before sending a byte. A
caller never supplies a key or a path, and no response ever contains one.

Screenshots are served `inline`; everything else — a DOM snapshot especially — is
an `attachment` with a locked-down `Content-Security-Policy`, so a captured page
cannot execute on the API's origin.

## 10. Configuration boundaries

Three tiers, and which tier a setting belongs to is a design decision rather than
an accident.

| Tier | Where it lives | Changed by |
|---|---|---|
| **Deployment** | Environment variables, read once at process start | Editing `.env` and restarting |
| **Per document** | The document's own state | An API call; sometimes a UI control |
| **Per version** | Compiled into a published Agent Version | Publishing a new version. **Never** afterwards |

**Deployment settings are not editable from the UI, deliberately.** Provider
selection and every token ceiling resolve at startup. A ceiling a client could
raise for itself would not be a ceiling. Watchtower displays spend against the
ceilings in force; it cannot change them.

**Per-version settings are immutable** (ADR-005):
`permissions.browser.allowedDomains`, `permissions.model`,
`permissions.recovery`. Withdrawing a document's recovery grant affects *future*
versions only. It cannot retract the capability from a version already published,
because a published version that no longer said what it does would be worse than
the grant.

**There are no user preferences**, because there is no authentication, no user
table and no session. `ORBIT_ACTOR_ID` (default `dev-user`) is the whole of the
notion of an actor.

Full reference: [`../guides/configuration.md`](../guides/configuration.md).

## 11. Ports

| Port | Bound by | Configurable |
|---|---|---|
| 3000 | Watchtower | `WEB_PORT` |
| 3001 | Demo portal | `DEMO_PORTAL_PORT` |
| 3002 | API | `API_PORT`, `API_HOST` |
| 3020 | Library portal | No — hard-coded |
| 3010 | Watchtower, end-to-end stack | **Reserved**; no app may bind it |
| 3102 | API, end-to-end stack | **Reserved**; same rule |

`GET /health` → `{"status":"ok"}` is the only non-`/v1` route.

## 12. Known limitations

Stated here rather than discovered:

- **No authentication, RBAC or multi-tenancy.** Any caller who can reach the API
  can read any run and its evidence.
- **No durable queue.** Runs execute in the API process; an API restart mid-run
  loses it.
- **No cancellation.** A started run runs to completion.
- **No server-side duplicate suppression.** Two clients can start two runs.
- **Sessions are in-memory.** Binding and walkthrough sessions do not survive an
  API restart (ADR-027).
- **Immutability is enforced in the repository layer only.** No database triggers
  (ADR-014).
- **No S3 adapter.** The interface exists; the second implementation does not
  (ADR-010).
- **No tier-gated policy engine.** `trust_tier` is persisted and nothing branches
  on it (ADR-013).
- **Gemini and Bedrock are unexercised.** Structurally complete, never called
  against a real service (ADR-034).
- **`docs/contracts/api.md` documents 6 of 44 `/v1` routes.** Treat
  `apps/api/src/routes/` as authoritative.

## 13. Seams kept open

| Future capability | The seam that exists today |
|---|---|
| A durable queue | `RunDispatcher`, independent of the HTTP lifecycle |
| S3 or MinIO | `ArtifactStorage` |
| Real identity | The trigger actor contract and an authorization middleware boundary |
| Multi-tenancy | Ownership fields, unpopulated |
| Another **browser** executor | `BrowserExecutor`, distinct from the Playwright implementation |
| Another **surface** | `SurfaceExecutor` + `ExecutorFactories`, keyed by surface (ADR-037) |
| Another model family | `@orbit/model-provider`'s two axes |
| Ranked drift recovery | `narrowDriftCandidates`, called in position and currently removing nothing |
| Live updates | The event query endpoint's ordered sequence values |

Each is an interface with one implementation, which is the honest description: a
seam, not a feature.

The last two are worth separating. `BrowserExecutor` is a *browser* seam — it
takes the browser-only `Locator` type on every method that touches a page, so a
second implementation of it would be another way to drive a browser, not another
surface. The surface seam is `SurfaceExecutor`, which is deliberately two methods
(`finishEvidence`, `close`): a run opens one executor per surface its steps
actually use, and the interpreter records whatever run-scoped evidence each hands
back without knowing that the browser's happens to be a Playwright trace.

Two things are still browser-shaped and are named here rather than implied.
Evidence capture defines only screenshots and DOM snapshots, so a run that opens
no browser captures none — correct today, and the surfaces that bring their own
evidence sets bring the code that captures them. And the error taxonomy keeps
`BROWSER_TIMEOUT` and `LOCATOR_NOT_FOUND` as browser-flavoured names forever,
because `errorCode` is embedded in published immutable Agent Versions (ADR-005,
ADR-014); new surfaces get new codes rather than renaming those.
