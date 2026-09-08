# Orbit documentation

The documentation home. Everything under `docs/` is indexed here, with what each
document is for and — where it matters — whether it has kept up with the code.

**If you are using the product rather than changing it, the fastest route is
Watchtower's own `Wiki` tab** (`http://localhost:3000/?view=wiki`). It is
task-oriented: how to record a workflow, bind its steps, publish it, run it,
read the evidence, and answer a recovery proposal. This tree is the deeper
material behind that.

---

## Start here

| You want to | Read |
|---|---|
| Install Orbit on a clean machine | [`guides/installation.md`](./guides/installation.md) |
| Get from nothing to a completed run | [`guides/quick-start.md`](./guides/quick-start.md) |
| Upgrade an existing checkout | [`guides/upgrade.md`](./guides/upgrade.md) |
| Configure a deployment | [`guides/configuration.md`](./guides/configuration.md), and [`.env.example`](../.env.example) |
| Build and run your own workflow | [`guides/usage.md`](./guides/usage.md) |
| Understand a run that stopped on drift | [`guides/ui-drift-recovery.md`](./guides/ui-drift-recovery.md) |
| Fix something that is not working | [`guides/troubleshooting.md`](./guides/troubleshooting.md) |
| Understand how the system fits together | [`architecture/system-design.md`](./architecture/system-design.md) |
| Know why a design is the way it is | [`architecture/decisions.md`](./architecture/decisions.md) |
| Know what Orbit is for, and what it will not do | [`product/orbit-product-vision-and-requirements.md`](./product/orbit-product-vision-and-requirements.md), section 0 |
| Change the code | [`../CLAUDE.md`](../CLAUDE.md), then the contracts below |

## Guides

Practical, task-shaped documentation. These are maintained against the code and
are the right place to look first.

| Document | Covers |
|---|---|
| [`guides/installation.md`](./guides/installation.md) | Prerequisites, the database, the one-time setup sequence, verifying it worked |
| [`guides/quick-start.md`](./guides/quick-start.md) | Ten minutes from a clean checkout to a run with evidence |
| [`guides/upgrade.md`](./guides/upgrade.md) | Migrating an older checkout, and what drift enforcement means for agents that used to pass |
| [`guides/configuration.md`](./guides/configuration.md) | Every environment variable, the port map, what is deliberately not configurable |
| [`guides/usage.md`](./guides/usage.md) | Recording, drafting, reviewing, binding, publishing, running, reading evidence |
| [`guides/ui-drift-recovery.md`](./guides/ui-drift-recovery.md) | The drift check, what recovery does, and the eight limits on what it may do |
| [`guides/troubleshooting.md`](./guides/troubleshooting.md) | Failures that actually happen, by symptom |

## Product

| Document | Covers | Currency |
|---|---|---|
| [`product/orbit-product-vision-and-requirements.md`](./product/orbit-product-vision-and-requirements.md) | **Section 0 describes the product today** — users, value, workflow, safety philosophy, real limitations, and what is future. Sections 7+ are the Phase 1 build brief | Section 0 active; later sections historical, with superseded claims flagged |
| [`product/orbit-end-to-end-delivery-phases.md`](./product/orbit-end-to-end-delivery-phases.md) | Phases and phase gates | Written for Phase 1 |
| [`product/orbit-end-to-end-production-vision.md`](./product/orbit-end-to-end-production-vision.md) | Long-term product and production architecture | Deliberately forward-looking |
| [`product/initial-wedge-and-personas.md`](./product/initial-wedge-and-personas.md) | Who this is for, and the first wedge | Written for Phase 1 |
| [`product/open-questions.md`](./product/open-questions.md) | Questions not yet decided | Written for Phase 1 |
| [`product/phase-1-demo-script.md`](./product/phase-1-demo-script.md) | The Phase 1 demo, as a script | Accurate for Phase 1 |

## Architecture

| Document | Covers | Currency |
|---|---|---|
| [`architecture/system-design.md`](./architecture/system-design.md) | **The current architecture.** Applications, packages, dependency rules, lifecycle, run flow, drift recovery, data and migrations, configuration boundaries, known limitations | Active |
| [`architecture/decisions.md`](./architecture/decisions.md) | **The decision log — 37 ADRs**, each with a status and an index. The authoritative record of why Orbit is shaped as it is | Active, maintained continuously |
| [`architecture/phase-1-system-design.md`](./architecture/phase-1-system-design.md) | The Phase 1 system design | **Historical.** Five statements in it are superseded and flagged inline |
| [`architecture/task-5-artifact-storage-preflight.md`](./architecture/task-5-artifact-storage-preflight.md) | Artifact storage design work | Phase 1 |

Nine of the 37 ADRs carry a qualifier — *Partially implemented*, or *amended /
partly superseded by* a later one — and each says which part in a note under its
status. Two describe capabilities that do not exist yet (ADR-010's S3 adapter,
ADR-013's tier-gated policy engine) and are marked accordingly. ADR-037 is
*Proposed*: it is the subject of an open review gate and nothing depends on it.

## Contracts

| Document | Covers | Currency |
|---|---|---|
| [`contracts/agent-ir.md`](./contracts/agent-ir.md) | The Agent IR contract | Phase 1 |
| [`contracts/events-and-evidence.md`](./contracts/events-and-evidence.md) | Event types and the evidence model | Phase 1 |
| [`contracts/api.md`](./contracts/api.md) | HTTP contract and the error envelope | **Behind the code.** Documents the 6 Phase 1 endpoints; the API serves 44 `/v1` routes plus `/health`. Treat `apps/api/src/routes/` as authoritative until it catches up |

## Demos

Scripted walkthroughs against the controlled demo portals. Each one is a
sequence you can follow end to end.

| Document | Demonstrates |
|---|---|
| [`demo/phase-1-demo.md`](./demo/phase-1-demo.md) | The full Phase 1 loop: a success, a business not-found, a controlled technical failure, and every piece of evidence |
| [`demo/walkthrough-binding-demo.md`](./demo/walkthrough-binding-demo.md) | Binding a whole workflow from one walkthrough |
| [`demo/branching-library-demo.md`](./demo/branching-library-demo.md) | A branching workflow against the library portal |
| [`demo/judged-decision-demo.md`](./demo/judged-decision-demo.md) | A judged decision at run time |
| [`demo/drift-recovery-demo.md`](./demo/drift-recovery-demo.md) | A drifted run, and the proposal it produces |

## Other

| Document | Covers |
|---|---|
| [`sop/find-service-request.md`](./sop/find-service-request.md) | The initial natural-language SOP |
| [`security/phase-1-security-baseline.md`](./security/phase-1-security-baseline.md) | The Phase 1 security baseline |
| [`testing/phase-1-test-strategy.md`](./testing/phase-1-test-strategy.md) | The test strategy and suite boundaries |
| [`engineering/model-routing.md`](./engineering/model-routing.md) | Model routing rules for engineering work |
| [`tasks/`](./tasks/) | Approved task plans and delivery reports, including `ops-and-docs-baseline.md` |

---

## A note on currency

Documents marked "written for Phase 1" describe a real, still-working core, but
they predate sub-phases 2.5–2.14 and do not mention what those added: per-agent
domains, workflow-declared outcomes, judged decisions, drift recovery, or the
provider abstraction. They are kept because the Phase 1 material in them remains
correct, not because they are complete descriptions of today's system.

Where such a document makes a claim that is now false, the claim is **flagged
inline** rather than deleted — `phase-1-system-design.md` carries five such
flags, and the vision document three. Deleting the record of what was specified
first would lose the reasoning the rest was built on.

`docs/orbit_repository_supporting_markdown_files.md` was **removed**. It was
scaffolding from repository setup: a single file holding copies of fourteen other
documents — including the whole of `README.md` — inside fenced blocks. All
fourteen have existed as real files for a long time, so the copies were a second,
silently diverging source of truth. Git history retains it.

Where a document and the code disagree, the code wins, and the disagreement is a
bug in the document. `docs/architecture/decisions.md` is the exception worth
naming: it is maintained continuously and is the best single account of why the
system is shaped as it is.
