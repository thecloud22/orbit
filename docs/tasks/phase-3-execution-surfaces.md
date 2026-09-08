# Phase 3 — Execution Surfaces

**Status:** Direction approved. Sub-phase 3.0 is next. Work one approved task at a time.

**Purpose:** Give Orbit execution surfaces beyond the browser — a terminal
(3270/5250) surface and an HTTP API surface — without weakening the guarantees
that distinguish it from RPA.

## Stack state at the time of writing

`master` at `5f2fbc1`, clean, sub-phases 2.1–2.16 complete. Branch
`phase-3-execution-surfaces` off `master` carries this document and ADR-037 only;
it is docs-only and merges before any code.

## Goal

Orbit automates exactly one surface, and that is a type-level fact rather than a
preference (see ADR-037's context). The SOPs worth automating rarely live on one
surface: the recurring shape is *look it up in the API, do the work in the green
screen, write the result back*.

Phase 3 makes a published Agent Version able to declare and execute more than one
surface, and delivers two of them.

**What must survive unchanged:** closed vocabularies a human approved, no raw
selector or free-form expression anywhere, fingerprint-checked actions, evidence
as a first-class feature, and a compiler that refuses what it does not
understand.

## Scope

### In

- A surface-neutral execution seam: per-surface permission sections, per-surface
  addressing vocabularies, per-surface evidence, and a run that can drive more
  than one executor (**ADR-037**).
- Credential references, minimal: a name in the Agent IR resolved from deployment
  config at run time.
- A **terminal** surface — screen model, addressing, fingerprint, executor,
  recording, compilation, and evidence in Watchtower.
- An **API** surface — an operation catalog imported from OpenAPI/GraphQL, a
  typed `api.request` step, and a SOP Graph `call` intent kind.

### Out — parked, designed for but not built

Recorded so ADR-037's contract has room for them and the shape is not
re-litigated later. **No task is opened for any of these in Phase 3.**

- **Database (read-only)**: `db.query` against a registered named-query catalog,
  parameters bound only from declared inputs and variables. No free-form SQL in
  Agent IR, ever. Writes stay out of scope until trust tiers (ADR-013) gate
  something.
- **Document/OCR**: `document.extract` on a document a workflow meets at run time.
  Settled constraint, recorded now because it is the one way this could undermine
  the type contract: fields are **declared in the step, never discovered**, so
  nothing untyped enters the variable scope.
- **Spreadsheet**: `sheet.read` / `sheet.write` by named range or header row,
  never raw A1 formulas.
- **Inbound triggers** (file/SFTP, email, queue): `SUPPORTED_TRIGGER_TYPES` work,
  not executor work — run creation, idempotency keys, batch-row semantics. A
  different subsystem; estimate separately.

### Out — named but unscheduled

**Terminal hardening against a real system (3.x).** Named here so it does not fall into the gap
between "the demo works" and "a customer has a mainframe." It cannot be written until someone has
access to a real LPAR, and Phase 3 must not be described as integration-complete without it.

Scope, from the 3.0 report's findings:

- **Unsolicited screens** — broadcast messages, session timeouts, `PRESS ENTER TO CONTINUE` pauses
  arriving between steps. This is where real 3270 automation spends most of its effort and none of
  it is designed. The byte-emitter host never interrupts, so no test currently provokes it.
- **Session lifecycle and LU pool etiquette** — LU pools are finite, and a worker that does not
  release sessions can lock real people out of the system.
- **Model pinning** — fingerprints are position-based, so a binding recorded against a 3278-2
  (24x80) is silently wrong against a -4 (43x80). The emulator model must become part of the
  binding rather than a connection flag.
- **TN3270E proper** — LU binding, structured fields, SNA responses. Sub-phase 3.6 exercises base
  TN3270 only.
- **TLS to the LPAR** with a real certificate chain, and the host's actual EBCDIC code page.

Note that **credentials, not the transport, gate the first real run**: a mainframe is entirely
behind a TSO/CICS logon, and under ADR-021 a workflow needing a secret compiles but can never be
approved. Sub-phase 3.3 is therefore the prerequisite for meeting a real system, not 3.6.

### Out — declined

- **Desktop/RPA** (Windows UI Automation, SAP GUI scripting). The automation
  model would fit — both expose a structured element tree with stable ids — but
  it needs a Windows agent host and a protocol between it and the worker, which
  is a new deployment surface rather than a new adapter.
- **RDP/Citrix.** Forces pixel/OCR interaction, which cannot supply a closed
  addressing vocabulary or a fingerprint. A surface that cannot supply those does
  not get added (ADR-037).
- **Non-idempotent API operations.** Need the idempotency-key design deferred to
  Phase 5; must refuse to compile until it exists.

## Settled decisions

Recorded so implementation does not reopen them.

### 1. No real mainframe exists to test against

The terminal track targets an **independent** open-source 3270 host. Phase 3
therefore delivers a capability demo, **not a validated integration**, and a green
suite must never be read as "works against a real LPAR."

The independence requirement is the point, not a detail: a hand-rolled fake would
validate the 3270 implementation against its own author's reading of the spec — a
closed loop in which a misread of the data stream leaves fake and executor
agreeing with each other and both wrong. What Orbit builds is the harness; the
peer on the other side of the wire must be code Orbit did not write.

Real-system gaps will surface whenever a real system appears — LU negotiation,
TLS to the LPAR, session pooling, screen timing under load. Budget a hardening
task then.

### 2. `Locator` is not widened

Each surface declares its own closed addressing vocabulary. Terminal:
`field_at(row, col)`, `field_after_label(text)`, `named_field(id)`. API: an
operation id in an imported catalog. Never a raw buffer offset, a regex over
screen text, or a URL template. Rationale in ADR-037 and ADR-018.

### 3. Contract changes are additive, permanently

`permissions` and `errorCode` live inside published immutable Agent Versions.
`BROWSER_TIMEOUT` and `LOCATOR_NOT_FOUND` keep their names forever; new surfaces
get new codes. ADR-005 and ADR-014 forbid migrating a published version, so a
wrong contract shape cannot be corrected later — which is why 3.1 is a review
gate.

### 4. Credentials stay minimal

A credential is a name resolved from deployment config at run time. No rotation,
no scoping UI, no per-tenant isolation, no vault — those remain Phase 5.

ADR-021's readiness gate is **narrowed, not removed**: today it reports
`cannot_validate` for any candidate needing a secret, which is what makes
authenticated workflows a documented dead end. It becomes *refuse unless every
secret input resolves to a declared credential reference*. The fail-closed
property is preserved; only its trigger changes.

Accepted gap, restated not fixed: the recorder detects password *fields*, not
secrets, so a value typed into a non-password field is still captured verbatim.

### 5. Response mapping uses JSON Pointer, not JSONPath

JSONPath has filters and wildcards and is an expression language, which ADR-007
rules out.

## Sub-phase sequence

Branch `phase-3-task-N-<name>`, brief at `docs/tasks/phase-3-task-N-<name>.md`,
report at `docs/tasks/reports/TASK-P3-NNN-<name>-report.md`. One task per branch.

| # | Task | Depends on |
|---|---|---|
| 3.0 | Test target and transport spike — report only, no production code | — |
| 3.1 | Surface contract freeze — Agent IR permissions and step→permission map | — |
| 3.2 | Multi-surface runtime seam — executor split, `ExecutorSet`, evidence grants | 3.1 |
| 3.3 | Credential references, minimal | 3.2 |
| 3.4 | Second-surface smoke test — stripped `api.request`, boundary tests | 3.2 |
| 3.5 | Screen model, addressing vocabulary, fingerprint — pure package | 3.1 |
| 3.6 | Terminal executor and steps | 3.0, 3.3, 3.5 |
| 3.7 | Terminal recording and compilation | 3.6 |
| 3.8 | Terminal evidence in Watchtower | 3.6 |
| 3.9 | API operation catalog — OpenAPI/GraphQL import | 3.1 |
| 3.10 | `api.request` full — permissions, mapping, evidence envelope | 3.3, 3.9 |
| 3.11 | SOP `call` kind and Studio | 3.10 |

3.1 → 3.2 → 3.3 → 3.4 is strictly sequential; they touch the same files. From 3.4
the terminal and API tracks touch disjoint packages and may run concurrently,
stacked the way 4a/4b/4c were.

3.4 exists so the terminal track is not *both* the first real adapter and the
validation that the seam works. It is deliberately not a product feature — fixed
URL from an allowlist, one JSON Pointer, no catalog, no evidence envelope — and
is absorbed by 3.10 or deleted.

## Review gates

| Gate | When | Blocking |
|---|---|---|
| A | 3.0 report — test host and transport choice | No. Cheap to reverse; nothing downstream built |
| B | **3.1 permissions shape** | **Yes.** Lands inside immutable published versions; cannot be migrated |
| C | End of 3.4 — foundation complete | No. Natural point to redirect before the tracks split |

## Verification

Per task: `pnpm typecheck && pnpm lint && pnpm test`, plus a report under
`docs/tasks/reports/` naming changed files, commands run, results and known
limitations.

Specific to this phase:

1. **Absence of change through 3.1–3.4.** The existing suite passes with no
   existing test's expectations edited. Needing such an edit is a signal the
   change was not additive.
2. **Byte-identical published IR** for the seeded `find-service-request` agent
   before and after 3.2, asserted as ADR-025's equivalence test does.
3. **Boundary tests per surface** (3.4), modelled on
   `decision-judge-boundary.test.ts`, proving `@orbit/runtime` reaches no executor
   implementation through the workspace closure. The recorder-unreachability
   module-graph test (ADR-019/020) extended for the terminal recorder in 3.7.
4. **The suite runs offline.** No real mainframe, no live API.
5. **Redaction** (3.3): a resolved secret appears in no event payload, artifact
   bytes, or log line.
6. **One timeline across surfaces** (3.8): a run spanning two surfaces renders as
   one timeline with per-surface evidence (ADR-031). This is the acceptance test
   for whether the evidence model generalized rather than fragmented.
7. **Named refusals** (3.7, 3.11): for each new step kind, an unresolvable case
   produces a named refusal rather than a compiled step (ADR-021).

## Documentation obligations

Per the ADR-022 precedent, doc changes land **in the same commit** as the code
they describe, because a standing rule the code silently violates is worse than
either version of the rule.

- `CLAUDE.md` — the phase statement ("Phase 1 only") is stale against 16 shipped
  sub-phases, and the excluded list bars API triggers. Update in 3.1; **leave the
  OCR and trigger exclusions standing**, since those are parked and the
  instruction remains accurate.
- `docs/contracts/agent-ir.md` — behind the code; it predates `model.decide` and
  documents 8 step types where the union has 9. Bring current in 3.1 before
  extending it.
- `docs/architecture/system-design.md` §13 — describes the executor seam as
  browser-shaped. Rewrite in 3.2.
- `docs/contracts/events-and-evidence.md` — per-surface event types and artifact
  kinds, as each surface lands.
- `docs/tasks/ACTIVE_TASK.md` — current-state section, updated per task.
- ADR-037 moves from *Proposed* to *Accepted* when 3.1 lands, or is rewritten.

## Risks

- **3.2 is invisible work with a wide blast radius** — agent-ir, runtime,
  contracts, compiler, sop-graph — and delivers no demo. The temptation is to skip
  it and special-case one adapter into the browser path, producing a second seam
  that never gets merged. 3.4 exists partly to make skipping it visibly fail.
- **Immutability constrains the refactor.** The seeded agent's IR must stay valid
  exactly as written; no published version is migrated.
- **The terminal adapter is validated only against a test host**, so protocol
  correctness rests entirely on the independence of 3.0's peer. If that peer turns
  out to be Orbit's own code, the test proves nothing and the failure is silent —
  green suite either way. This is the single most important thing 3.0 gets right
  or wrong.
- **Multi-surface runs can weaken evidence comparability.** Watchtower's model
  assumes screenshot/DOM/trace; ad hoc per-surface evidence degrades the central
  claim quietly rather than failing loudly.
- **`trust_tier` is inert** (ADR-013): the vocabulary and column exist and nothing
  branches on them. The first write-capable adapter forces that engine to be
  built; keeping database writes and non-idempotent API calls out of scope defers
  it.
