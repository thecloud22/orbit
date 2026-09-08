# TASK-P3-005 — Screen model, addressing, fingerprint (sub-phase 3.5)

**Status:** Complete. Non-blocking.

**Branch:** `phase-3-task-5-screen-model`.

## What this is

`@orbit/screen-mapping`: what a green screen *is*, how a step names a field on one, and how a screen
is compared against what somebody approved. Pure — Zod is the entire runtime dependency, and there is
no transport and no I/O of any kind.

That purity is why TASK-P3-000 could change the transport (from "write a TN3270E parser" to "drive
x3270") without invalidating any of this. A package that cannot reach a transport cannot be coupled
to one.

## The three pieces

**`Screen`** — a field-attribute buffer, not pixels. Fields with a start position, a length, and
attributes: `protected`, `numeric`, `nonDisplay`, `intensified`. This is the whole reason the surface
fits Orbit: a green screen already has the structured element model a webpage has to be coaxed into
providing, and it is more stable.

`nonDisplay` is worth naming carefully. On 3270 it is a **field attribute**, not a heuristic — the
host declares that a field is not to be displayed, and that is how password fields are marked. Orbit
can identify a credential field structurally rather than guessing from a label, which is strictly
better than the browser recorder's known limitation (`decisions.md:791`: only password *inputs* are
detected). The field still transmits in clear, so redaction is Orbit's job driven off this flag; the
wire does not do it.

**`ScreenAddress`** — three strategies, closed by construction, ADR-018's argument applied to a
buffer:

- `field_at(row, column)` — exact, and brittle in the honest way: if the screen moves, the binding
  fails rather than guessing.
- `field_after_label(text)` — the first input field following protected text. This is how green
  screens are actually laid out (`USERID ===> ____`) and it survives a screen shifting a row.
- `named_field(name)` — a name the binding gave, never one the host did.

No raw buffer offset and no regex over screen text: each would be a small program for finding a
field, which is what a reviewer cannot check and drift detection cannot reason about. `Locator` from
`@orbit/agent-ir` is neither reused nor widened — a DOM element and a buffer field have nothing to
unify, and one type serving both collapses into a string.

`resolveAddress` reports `ambiguous` rather than picking, the stance ADR-033 takes for recovery.
`named_field` deliberately resolves nothing here: a name is an artifact of the binding, and this
layer is given screens, never bindings.

**`ScreenFingerprint`** — geometry, field count, a `protectionMask` of `p`/`u` in buffer order, and
captions anchored at fixed positions. Only *protected* text is anchored, because unprotected content
is data that changes every run by design; including it would manufacture drift on every execution.
This is the distinction `ComparisonMode` draws for the browser, made structural instead.

`fingerprintOf` is the same function at record time and at run time, so both sides are produced
identically by construction rather than by a parity test.

### One comparison decision worth flagging

**A geometry mismatch returns alone and stops.** A 3278-2 binding run against a -4 is one fact, not
forty anchor mismatches caused by it. This is what makes the model-pinning gap named in the Phase 3
hardening task legible when it eventually bites.

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` per package (19) | clean |
| `eslint .` / `prettier --check .` | clean |
| `vitest run` | **1437 passed** (134 files), up from 1420 |

Ten behaviour tests, built on the same logon screen the 3.0 spike drove `s3270` against. The four
that carry the design:

- typing into an unprotected field is **not** drift — otherwise every run would drift on its own input;
- a reworded caption **is**;
- an input turned into a caption is caught by `protectionMask` **even when the visible text is identical**;
- a geometry change reports alone.

Plus a boundary test proving the package imports nothing that could act — extended beyond
`execution-mapping`'s with `node:tls`, `@orbit/executor-x3270`, `spawn(` and socket-connect shapes.
**Mutation-checked**: an import of `node:net` makes it fail.

## Known limitations

- Nothing produces a `Screen` yet. 3.6 populates it from `b3270`.
- `named_field` has no resolver, by design — the binding layer that owns names does not exist yet.
- `numeric` and `intensified` are recorded and never acted on; they exist for the fingerprint and for
  a future recorder to show a person.
- Double-byte (DBCS) screens are not modelled. `x3270` supports nine DBCS code pages, so this is a
  gap in Orbit's model rather than in the transport.
