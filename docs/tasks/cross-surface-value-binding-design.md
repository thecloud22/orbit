# Design: Cross-Step, Cross-Surface Value Binding

**Status:** Proposal — not approved, no code written. This is the design-approval
artifact called for by `CLAUDE.md`'s development workflow (step 3) before any
implementation, because part B below changes a public contract shape
(`@orbit/sop-graph` step kinds, `@orbit/execution-mapping` binding bodies).

**Scope of the question asked:** a value produced by one step — a browser
selection, an extracted screen field, an API response field — must be capturable
and usable as another step's input, including across surfaces (browser → 3270,
3270 → API, etc).

## 1. Finding: the hard part is already built

Before proposing anything new, it's worth being precise about what
`@orbit/agent-ir` and `@orbit/runtime` already do, because the scenario reads
like it needs a new "data flow" concept and it doesn't.

`packages/runtime/src/interpreter.ts` holds one flat map for the whole run:

```ts
const variables: Record<string, string> = {};
```

(`interpreter.ts:430`). It is populated by whichever step produces a value and
read by whichever step consumes one, with **no surface check anywhere in the
read or write path** — the same object is passed into `browser.extract`,
`terminal.read`, and `api.request` alike (`interpreter.ts:849-854`,
`interpreter.ts:948-949`, `interpreter.ts:1055-1069`). A value extracted from a
browser page is exactly as available to a later `terminal.type` as a value read
off a screen is available to a later `api.request`. This was true before this
design and needs no change:

| Produced by | `assign` shape | Consumed by | Reference syntax |
|---|---|---|---|
| `browser.extract` | field name → `${result.field}` | `browser.fill`, `browser.assert`, `terminal.type`, `api.request.arguments`, `complete.outputs` | `${variables.name}` |
| `terminal.read` | field name → `${result.field}` | same set | `${variables.name}` |
| `api.request` | variable → JSON Pointer into response | same set | `${variables.name}` |

Interpolation is a fixed, closed grammar (`packages/agent-ir/src/interpolation.ts`,
consumed by `packages/agent-ir/src/validate.ts:9`), with four namespaces:
`inputs`, `variables`, `credentials` (value positions only), and `result`
(assign positions only, scoped to the current step's own extraction). There is
no templating, no concatenation, no expression evaluator — a value is a literal
or exactly one whole-string reference, which is what keeps `eval`/`Function`/
arbitrary-expression exclusion in `CLAUDE.md` intact while still letting a value
cross steps and surfaces.

`packages/agent-ir/src/validate.ts`'s definite-assignment pass
(`checkDefiniteAssignment`, line 543) already proves — for the paths it covers —
that a variable is assigned on **every** path reaching a step that reads it,
regardless of which surface produced or consumes it. This is the actual
guarantee behind "capture in step N, use in step M": M can only compile/publish
if every path from the entry step to M assigns the variable first.

**Consequence for this design:** nothing new is needed in the value-flow
contract itself (Agent IR shape, interpolation grammar, or the runtime's
variable scope). The work is (a) closing validator gaps that currently make the
terminal surface's contribution to that flow unverified or wrongly rejected, and
(b) extending the **authoring** path — SOP Graph, Execution Bindings, the
compiler — to the terminal surface, which today has none of this at all. API and
browser authoring already exercise real cross-surface capture (browser →
variable → API argument is live: `compile.ts:466`, `compile.ts:477-497`).

## 2. Gap A — Agent IR validator blind spots (fix first, small, no contract change)

Two bugs in `packages/agent-ir/src/validate.ts` sit directly in the path of the
requested scenario whenever a terminal step is on either end. They are bugs
against the *existing* contract, not new scope, and should be fixed regardless
of whether Gap B/C are built, because terminal workflows are already
hand-authorable in Agent IR YAML today (per `docs/tasks/ACTIVE_TASK.md`: "a
terminal workflow must be hand-authored in Agent IR").

**A1 — `checkDefiniteAssignment` never marks a `terminal.read` variable
assigned.**

```ts
if (step.type === 'browser.extract') {
  for (const variableName of Object.keys(step.assign)) { assigned.add(variableName); }
} else if (step.type === 'api.request') {
  for (const variableName of Object.keys(step.assign ?? {})) { assigned.add(variableName); }
}
```

(`validate.ts:604-612`). `terminal.read` also has an `assign` map
(`packages/agent-ir/src/steps.ts:300-301`) but is not in this list. Concretely:
extract a customer ID from a screen with `terminal.read`, then reference
`${variables.customerId}` in a later `api.request.arguments` — the validator
reports `VARIABLE_NOT_ASSIGNED_ON_ALL_PATHS` even though the run would execute
correctly. **This is a false positive that blocks exactly the terminal→API leg
of the requested scenario.** Fix: add `terminal.read` to the branch, or better,
switch on `'assign' in step` generically so a fourth surface's future
assign-producing step doesn't repeat the omission.

**A2 — `checkReferences` never validates `terminal.type.value`,
`api.request.arguments`, or a `terminal.read` field name inside `assign`.**

The `switch (step.type)` in `checkReferences` (`validate.ts:444`) has cases for
`browser.fill`, `browser.assert`, `api.request` (assign-target existence only,
not the arguments themselves), `browser.extract`, and `complete`. There is no
case for `terminal.type`, `terminal.read`, or `terminal.connect`, and no call to
`checkValue` for `api.request.arguments`. Consequences:

- A malformed reference (`${variables.foo` typo) or a reference to an
  undeclared input/variable/credential in `terminal.type.value` compiles
  silently and fails only at run time, inside a live terminal session.
- The same is true for every `api.request.arguments` entry today, independent
  of this design — worth fixing in the same pass since it's the same missing
  `checkValue` call, one switch case away.
- `checkValue`'s `result`-namespace field check (`validate.ts:177-189`,
  `UNKNOWN_EXTRACT_FIELD`) is hard-coded to `step.type === 'browser.extract'`,
  so a `terminal.read.assign` entry referencing `${result.nonexistentField}`
  is never caught, even though `terminal.read` has the identical
  fields/assign shape.

Fix: add `terminal.type`, `terminal.read`, and the `api.request.arguments` loop
to `checkReferences`, and widen the `result`-namespace field check to branch on
`step.type === 'browser.extract' || step.type === 'terminal.read'` (checking
`step.fields[name]`, which both share). No schema change; this is purely
completing validation coverage the contract already implies.

Both are additive, behavior-only fixes with no migration concern (validation
logic isn't persisted in a published Agent Version). They should land as their
own small task ahead of, or alongside, Gap B, with regression tests asserting:
a `terminal.read` → `api.request.arguments` reference passes; a malformed or
undeclared reference in `terminal.type.value` / `api.request.arguments` is now
rejected with the right issue code.

## 3. Gap B — Terminal has no authoring vocabulary at all

This is the real gap for the browser-selection → mainframe-field and
mainframe-field → API-argument scenarios: **the terminal surface cannot be
authored.** Per `ACTIVE_TASK.md`: "Still not authorable: terminal. A SOP step
cannot say which surface it runs on, so a `fill` is ambiguous between browser
and terminal." Concretely:

- `packages/sop-graph/src/steps.ts` has exactly seven kinds:
  `navigate`, `fill`, `click`, `extract`, `call`, `decision`, `outcome`,
  `manual_review` (plus `manual_review`). `fill`/`click`/`extract`/`navigate`
  read as page actions; nothing says "this fill types into a 3270 field."
- `packages/execution-mapping/src/binding.ts`'s `bindingBodySchema` has
  `call | navigate | fill | click | decision | extract | outcome` — every body
  but `call` assumes `target: ElementTarget` (page selectors + a DOM
  fingerprint). There is no body shaped for a `ScreenAddress`
  (`@orbit/screen-mapping`'s `field_at` / `field_after_label` / `named_field`)
  or an `AidKey` press.
- The compiler (`packages/agent-ir-compiler/src/compile.ts`) has no branch that
  could produce `terminal.connect` / `.type` / `.press` / `.read` /
  `.expect_screen` from anything, because nothing upstream can express intent
  for them.
- Sub-phase 3.7 ("Terminal recording and compilation") is explicitly the open
  item in `docs/tasks/phase-3-execution-surfaces.md`'s sequence table, blocked
  on nothing (3.6 is done).

### 3.1 Proposed shape: additive kinds, not a `surface` flag on existing ones

Two options were weighed:

1. **Add `surface: 'browser' | 'terminal'` to `fill`/`click`/`extract`.**
   Rejected. `click` has no terminal meaning (a 3270 keyboard doesn't click; it
   locally buffers keystrokes and only transmits on an AID key —
   `packages/agent-ir/src/steps.ts:271-291`), and the surfaces don't share a
   session-open step (`terminal.connect` has no browser equivalent —
   `browser.navigate` both opens and moves) or a screen-level assertion
   (`terminal.expect_screen` has no browser equivalent). Overloading would mean
   every existing consumer of these three kinds — SOP validation,
   `sop-generation`, the recorder, Studio's binding panel, the compiler's
   `BINDABLE_KINDS` — grows a surface branch inside a shape that used to be
   unconditionally browser-shaped, which is exactly the "broad refactor"
   `CLAUDE.md` says to avoid when a narrower path exists.

2. **New terminal-shaped kinds, mirroring the split Agent IR itself already
   made** (`terminal.connect/type/press/read/expect_screen` alongside
   `browser.navigate/fill/click/extract`). **Recommended.** This is additive to
   the discriminated unions in `sop-graph`, `execution-mapping`, and the
   compiler's switch statements — the same shape of change 3.9-3.11 already
   made for `call`, with a working precedent to copy from.

Proposed SOP Graph kinds (`packages/sop-graph/src/steps.ts`), each carrying
`stepBase` (`id`, `purpose`) the same way `fill`/`extract` do:

```ts
terminalConnectStepSchema:   { kind: 'terminal_connect', systemHint: string }
terminalTypeStepSchema:      { kind: 'terminal_type', fieldHint: string, value: string, sensitive?: boolean }
terminalPressStepSchema:     { kind: 'terminal_press', keyHint: string }   // "Enter", "PF3" in the author's words
terminalReadStepSchema:      { kind: 'terminal_read', fields: ExtractField[], onMissing?: ... }
terminalExpectScreenStepSchema: { kind: 'terminal_expect_screen', screenHint: string }
```

`terminal_type.value` reuses **exactly** the grammar `fill.value` already
documents: "a literal, `${inputs.id}`, or `${variables.name}` — nothing else."
`terminal_read.fields` reuses `extractFieldSchema` unchanged (`name`,
`labelHint`, `required`). No new value-reference vocabulary — this is the
point of Gap A being fixed first: the reference grammar already generalizes,
so Gap B is purely "give the terminal surface a place to sit in the existing
discriminated unions."

Proposed Execution Binding bodies (`packages/execution-mapping/src/binding.ts`),
following the `call` body's precedent of *not* spreading `bindingBase` where
there's no page element:

```ts
{ kind: 'terminal_connect', host: string }
{ kind: 'terminal_type', address: ScreenAddress, valueSource: ValueSource }   // reuses ValueSource as-is
{ kind: 'terminal_press', key: AidKey }
{ kind: 'terminal_read', address: ScreenAddress, variable: string }          // one binding per field, like `extract`
{ kind: 'terminal_expect_screen', fingerprint: ScreenFingerprint }
```

`valueSourceSchema` (`binding.ts:52-64`, `sop_variable | literal`) is reused
without modification for `terminal_type` — this is the exact mechanism that
already lets a `fill` bind its value to a previously captured graph variable,
and it is surface-agnostic by construction (it names a graph variable, not a
DOM concept). This is also how "browser selection → mainframe field" resolves
concretely: the browser side is an `extract` binding with `variable: "customerId"`
(possibly `readMethod: 'attribute'` if the "selection" is an id rather than
visible text — already supported, `binding.ts:66-72`); the terminal side is a
`terminal_type` binding with `valueSource: { kind: 'sop_variable', name: 'customerId' }`.
No new capture/reference concept — just a binding body that can name a screen
address instead of a page element.

`hasSingleTarget` (`binding.ts:250-254`) and `bindingTargets`
(`binding.ts:266-277`) already exist specifically to keep "does this body have
one page element, many, or none" from being re-litigated ad hoc at each call
site; the new bodies extend that same function rather than adding parallel
`kind !== X` checks.

### 3.2 Compiler wiring

`compile.ts` needs one branch per new kind, mirroring the existing
`extract`/`call` branches almost line for line:

- `terminal_connect` → `terminal.connect` step; `permissions.terminal.allowedHosts`
  derived from the bound `host`, the same way `permissions.api.allowedHosts` is
  derived from what `call` steps actually reached (`ACTIVE_TASK.md`: "Permissions
  are derived from what compiled, never from what the catalog offers").
- `terminal_type` → `terminal.type` step; `valueSource.kind === 'sop_variable'`
  compiles to `${variables.${name}}` after the same "is this name declared as
  an input or produced as a value" check `compile.ts:329-343` already performs
  for `call` arguments — reused, not reimplemented.
- `terminal_read` → one `terminal.read` step per field (or a single step with
  merged `fields`, matching how `browser.extract` already declares multiple
  fields in one step) with `variables[field.name] = { type: 'string' }`
  declared, exactly as the `extract` branch does at `compile.ts:845`.
- `terminal_press` → `terminal.press`, `keyHint` resolved to a closed `AidKey`
  at binding time (a person confirms which key their demonstration pressed;
  never inferred from free text at compile time — same "closed vocabulary a
  human approved" property every other binding has).
- `terminal_expect_screen` → `terminal.expect_screen`, fingerprint taken
  verbatim from the binding, same relationship `decision` branches have to
  their fingerprints.

This closes both directions of the requested scenario symmetrically: a
`terminal_read` variable is available to a later `call`'s
`argumentSourceSchema` `{ kind: 'variable' }` (already implemented,
`compile.ts:466`) with no further change, and a `browser.extract` or `call`
variable is available to a later `terminal_type`'s `valueSource`
`{ kind: 'sop_variable' }` with no further change either. Both legs go through
the one variable-declaration map the compiler already threads through
`compileDocument` (`compile.ts:359`).

## 4. Gap C — Terminal recording (sub-phase 3.7 itself)

Binding a browser step today means opening a headed browser and clicking the
real element (`@orbit/execution-recorder`, `/v1/binding-sessions`). Terminal
needs the equivalent against `@orbit/executor-x3270`'s `b3270` session: a
person connects, drives the screen to the right state, and **names the field**
— the terminal analogue of clicking an element is confirming a `ScreenAddress`
(`field_at` / `field_after_label` / `named_field`) against the live screen the
same way `describeElement` confirms a DOM element today.

This is 3.7's stated remaining scope and is not re-designed here beyond noting
that it should produce exactly the binding bodies in §3.1 — the recording
mechanism is a separate concern (a screen-capture-and-confirm loop) from the
value-flow question this document answers, and 3.5/3.6 already built the
screen model and executor it would sit on.

One authoring-UX point specific to *this* design does belong here: wherever
Studio lets an author choose a value source for `fill` (browser) or a `call`
argument today, the same picker — "a declared input" / "a variable captured
earlier in this workflow" / "a literal" — should be reused verbatim for
`terminal_type`, rather than building a second one. `valueSourceSchema` and
`argumentSourceSchema` are structurally the same three-way choice already
(`binding.ts:52-64`, `binding.ts:108-113`); the UI should reflect that they're
one concept, not three.

## 5. Non-goals — what stays exactly as it is

- **`Locator` and `ScreenAddress` are not widened**, and no generic
  `perform(action)` escape hatch is added. ADR-018 and ADR-037 rule this out,
  and nothing in this design needs it — a new binding *kind* is not a wider
  vocabulary within a kind.
- **Variables stay single-typed (`string`).** Every current producer
  (`browser.extract`'s text read, `terminal.read`'s trimmed field text,
  `api.request`'s JSON-Pointer read which already stringifies numbers/booleans
  and reports non-scalars absent — `packages/runtime/src/api-request.ts:107-109`)
  already normalizes to a string. A terminal-sourced value fits this with no
  change.
- **No expression language.** A value is still a literal or exactly one
  reference; cross-surface capture does not need concatenation, coercion, or
  computed values, and none is proposed.
- **Definite-assignment stays a static, pre-run guarantee**, not a runtime
  fallback. Gap A fixes it to cover the surfaces it already claims to cover; it
  does not become more permissive.
- **`api.request`'s existing behavior is unchanged** by Gap B; Gap A's fix to
  validate its `arguments` is a strict tightening (previously-invalid
  references that silently compiled now correctly refuse), which is safe
  because no currently-published agent can be relying on a malformed or
  undeclared reference actually working.

## 6. Sequencing

| Order | Work | Depends on | Contract change? |
|---|---|---|---|
| 1 | Gap A: validator fixes in `@orbit/agent-ir` | — | No (behavior-only; adds refusals, doesn't remove any) |
| 2 | Gap B: terminal SOP kinds, binding bodies, compiler branches | 1 (so newly-authorable terminal↔other-surface flows are actually validated correctly) | **Yes** — new discriminated-union members in `@orbit/sop-graph` and `@orbit/execution-mapping`. Needs the same kind of review Gate B gave 3.1, since binding bodies are persisted and read back. |
| 3 | Gap C: terminal recording UX (3.7 proper) + shared value-source picker in Studio | 2 | No new persisted contract beyond what 2 defines |

Gap A is small enough to be its own task, independent of whether Gap B/C are
approved — it fixes real bugs in already-shipped surfaces (3.6's terminal
steps, 3.10's `api.request`) and should not wait on a terminal-authoring
decision.

## 7. Test plan (for whoever picks this up)

- **Gap A**: unit tests in `packages/agent-ir/src/validate.test.ts` — a
  `terminal.read` → later `${variables.x}` reference passes
  `checkDefiniteAssignment`; a malformed/undeclared reference in
  `terminal.type.value` and in `api.request.arguments` is rejected with the
  matching issue code; a `terminal.read.assign` referencing an unknown field
  produces the field-existence error `browser.extract` already gets.
- **Gap B**: schema round-trip tests for each new SOP kind and binding body
  (mirroring `binding.test.ts`'s existing coverage of `call`); a compiler test
  proving a `terminal_read` variable is consumable by a later `terminal_type`,
  `call`, or `fill` binding, and vice versa for a `browser.extract` /
  `call.reads` variable consumed by a later `terminal_type`; a permissions test
  proving `permissions.terminal.allowedHosts` is derived only from hosts
  actually reached, matching the `call`/`allowedHosts` precedent.
- **End-to-end demo**: a small fixture workflow — browser search returns a
  customer id (`browser.extract`), terminal session types it into a screen
  field and reads back a status (`terminal.type` + `terminal.read`), API call
  posts that status (`api.request.arguments` with `{ kind: 'variable' }`) —
  run against the existing byte-emitter 3270 host and a stub HTTP service,
  asserting the same "one timeline across surfaces" property 3.8 already
  proved (`buildRunTimeline`, unchanged).

## 8. Open questions for approval

1. Confirm the additive-kinds direction (§3.1, option 2) over a `surface`
   flag on existing kinds — this is the one architectural fork in this design.
2. Confirm Gap A ships as its own task ahead of Gap B, rather than bundled.
3. Whether `terminal_read`/`terminal_type` should each bind one field per step
   (matching `terminal.read`'s Agent IR shape, which already allows multiple
   fields in one `assign` map) or one binding per field the way `extract`'s
   binding is currently one-body-per-field — affects how many sittings a
   terminal binding session needs per screen.
