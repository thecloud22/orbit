# TASK-P3-008 / 011 — Multi-surface timeline, and the SOP `call` kind (sub-phases 3.8, 3.11)

**Status:** 3.8 complete. **3.11 is half done** — the intent kind and its refusal exist; binding a
call to an operation does not. See *Known limitations*.

**Branches:** `phase-3-task-8-terminal-evidence`, `phase-3-task-11-sop-call-kind`.

## 3.8 — one timeline across surfaces

This was the acceptance test for whether the evidence model generalised rather than fragmented, and
it did: `buildRunTimeline` needed no structural change. Steps, events and artifacts already joined by
`runStepId`, and a terminal or API step flows through the same path a browser step does.

What was missing was legibility. A run that looks something up over an API, does the work on a green
screen and writes the result back is one timeline through three surfaces, and without saying which is
which it reads as an undifferentiated list — the evidence under each step loses the context that
explains it.

- `surfaceOf(stepType)` derives the surface, returning **null** for `complete`, `fail` and
  `model.decide`. Those touch no surface, and labelling them would be a claim that is not true.
- **The badge appears only when a run actually spans surfaces.** On a browser-only run — every agent
  published before Phase 3 — a badge on every step would be noise stating the one thing that never
  varies. Derived from the timeline's own contents rather than passed in.
- Event names keep their surface prefix **except the browser's**: "typed" alone is ambiguous in a run
  that also fills browser fields, while "terminal typed" is not. Browser stays bare because it is the
  implicit surface for everything published before now, and prefixing it would churn how every
  existing run reads.
- `terminal_screen` and `api_exchange` are labelled in the evidence panel.

## 3.11 — the `call` intent kind

`call` joins the SOP Graph's step kinds: business intent only, carrying `requestHint` and
`systemHint` and **no endpoint, method, payload or authentication**. Which operation answers it is a
separately reviewed mapping, exactly as which element a click lands on is (ADR-002).

**There is deliberately no `urlHint`**, though `navigate` has one. A URL a person typed into a draft
is a plausible-looking thing that binding would be tempted to trust, and an endpoint is a more
consequential thing to guess at than a page: a step named against a real contract can be checked, one
named against a remembered URL cannot.

### The refusal is the substantive part

The compiler dispatches on `step.kind` through an if-chain, not an exhaustive switch, so a `call`
step fell through to the extract branch and refused with **"Step X reads a value but its mapping does
not"** — true of an extract and meaningless for a call.

A refusal that describes the wrong problem is worse than a generic one, because it sends the reader
somewhere real and wrong. `call_binding_unsupported` names the actual gap, and a test asserts it
appears *and* that `extract_coverage_gap` does not.

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` per package (23) | clean |
| `eslint .` / `prettier --check .` | clean |
| `vitest run` | **1459 passed** (138 files) |
| `test:db` | **331 passed** |

## Known limitations

- **3.11's binding half is not built.** There is no `call` binding body in `@orbit/execution-mapping`,
  no service that maps a call to a catalog operation, and no Studio surface for reviewing one. A
  `call` step therefore refuses to compile by design, and an `api.request` workflow must still be
  hand-authored in Agent IR. This needs the same authoring-surface decision as 3.7.
- The surface badge is presentational only; nothing filters or groups a timeline by surface.
- A terminal screen artifact is labelled and downloadable but not rendered as a 24x80 grid in the
  evidence panel — it is stored as text, so the browser shows it as text.
- `produces` on a `call` step is declared but nothing validates that the bound operation can actually
  supply those values, because there is no binding to check against yet.
