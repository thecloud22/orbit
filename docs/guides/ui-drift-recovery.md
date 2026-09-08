# UI drift and recovery

What happens when a page changes underneath a bound workflow, and what Orbit is —
and is not — permitted to do about it.

Decided in **ADR-018** (the check) and **ADR-033** (the recovery). This guide
describes what is implemented, not what is planned.

---

## The drift check

An approved SOP step says *"the field labelled Request number"*. An **Execution
Binding** says which element that turned out to be: an ordered chain of locators,
plus a **fingerprint** of the element as it looked when a person confirmed it.

Before every real `fill` or `click` that uses a binding, the runtime describes
the live element and compares it against that fingerprint.

```text
approved binding ──> describeElement ──> compareFingerprint ──┬── matches ──> act
                                                              └── differs ──> stop + evidence
```

The comparison is **deterministic** — no model is consulted — and it **fails
safe**. On a mismatch the run stops, captures a screenshot and a DOM snapshot,
and reports what changed. The executor is never asked to find a substitute
element, because choosing a different element than the one a human approved is
the decision no automated part of Orbit may make.

Two properties worth stating plainly:

- The check is invisible to an agent without bindings, so every Phase 1 run
  behaves exactly as it did before it existed.
- It runs at exactly two step types, `browser.fill` and `browser.click` — the
  ones that act on a real system. `browser.expect_one_of` does **not**
  drift-check: it is a branch predicate over alternatives, not an action on an
  approved element. Neither does `browser.extract`, whose text is the value being
  read and changes every run.
- It is checked **before** the action, never after. The point is to not type into
  the wrong field, not to discover afterwards that we did.
- It **does not mistake slowness for change**: the check polls until the step's
  own deadline before declaring drift, so a page still settling gets the same
  benefit of the doubt every other wait in the runtime gives it.

Locators are a closed vocabulary — `test_id`, `role_and_name`, `label`. CSS and
XPath are not expressible, so a binding cannot carry an arbitrary DOM-walking
expression. A chain gives the runtime a fallback when a page drops one attribute,
and that chain is also the whole of the material recovery is allowed to work
from.

## The recovery model

**This is the part that must not be paraphrased into something weaker.** Each
clause below is a bound on what recovery may do.

- **A drifted run fails.** Recovery never resumes or rescues it.
- Recovery suggests a repair **only from the approved binding's existing fallback
  locator chain**.
- It **never scans the page for unapproved lookalikes**.
- Proposals are **separate records** from bindings.
- A human accepts through the normal **create → review → approve** process.
- **Acceptance does not publish.** A person must publish before later runs use
  the change.
- Recovery is **deterministic and uses no LLM or model**.
- Recovery is **per-document/SOP permission-gated** via `permissions.recovery`.

### Why each of those, concretely

**A drifted run fails.** Resuming would mean the run continued past a step whose
target nobody had confirmed. The evidence would then describe a run that acted on
an element no human ever approved, which is precisely the thing the fingerprint
exists to prevent.

**Only the existing chain.** The question a diagnosis asks is narrow on purpose:
*of the locators a person already demonstrated for this element, does exactly one
still find the element they approved?* If yes, that is "the test id changed, the
button did not", and it is worth telling somebody. If more than one does, or none
does, it refuses — because choosing between plausible replacements is judgement,
and judgement here would be a guess wearing a confidence score.

**Never scans for lookalikes.** A page-wide search for something that resembles
the old element is how an automation silently starts clicking the wrong button.
The material is bounded to what a person demonstrated, and the bound is
structural: `@orbit/drift-recovery` has no code path that reaches a browser.

**Deterministic, no model.** `diagnoseDrift` is a **synchronous** function. A
synchronous function cannot make a network call, so "consults no model" is a
property of the type signature rather than a promise in a document. Turning
ranking on later would mean changing that type, which is a change that shows up
in review.

**Separate records.** Proposals live in `binding_recovery_proposals`, never in
the bindings table. A proposal cannot be mistaken for a mapping, and nothing that
reads bindings can accidentally read a proposal.

**Acceptance does not publish.** Accepting creates a binding through the ordinary
lifecycle and marks the proposal accepted. It cannot publish, cannot touch an
Agent Version, and cannot make a mapping live. Accepting makes the next run
possible; starting that run stays a separate, human act.

There is deliberately **no endpoint that applies a proposal automatically**, and
none that re-runs the workflow after accepting.

## Granting recovery

The grant is **per document**, and it is off unless granted.

```bash
curl -X POST http://localhost:3002/v1/sop-documents/{documentId}/recovery \
  -H 'content-type: application/json' \
  -d '{"enabled": true}'
```

> **There is no UI control for the grant in this build.** Accepting and
> dismissing proposals *are* in Studio; turning the capability on is API-only.

Withdrawing the grant stops *future* versions declaring the capability. It cannot
retract it from versions already published, because those are immutable and a
published version that no longer said what it does would be worse than the grant
(ADR-005).

## What a person sees

1. A run fails on drift. Its evidence holds the screenshot and DOM snapshot
   captured at the moment it stopped.
2. If the document has recovery granted and the diagnosis reached a proposal, an
   open proposal appears in **Studio**, beside the step it concerns.
3. The proposal states the locator before, the locator after, and the element
   identity behind the claim — role, accessible name, the control's own label.
   Element identity only: never page content, and never a value the workflow read.
4. **Accept** creates a binding through the ordinary create → review → approve
   path. **Dismiss** closes the proposal and changes nothing else.
5. **Publish a new version yourself.** Until you do, no run uses the repair.

A stale proposal is **withdrawn, never adjusted to fit**. If the step was
re-recorded or edited underneath it, or the proposal was already resolved,
accepting is refused with a conflict rather than repaired.

At most one open proposal exists per step. A second drift on a step that already
has one does not stack.

## When there is no proposal

A diagnosis reaches one of three refusals, and each means something different:

| Refusal | Meaning |
|---|---|
| `no_candidate` | Nothing in the approved chain still finds the approved element. The element is gone, not moved |
| `ambiguous` | More than one locator in the chain still resolves. Choosing between them is judgement, so it refuses |
| `not_recoverable` | The observation cannot support a diagnosis at all |

Three further decline reasons are not diagnoses but circumstances:

| Reason | Meaning |
|---|---|
| `already_proposed` | This step already has an open proposal. A second drift does not stack |
| `unknown_binding` | The binding the run reported could not be resolved — a version published from a fixture, or a document since deleted. Reported rather than guessed at |
| `store_failed` | The proposal could not be written |

In every one of these cases the answer is the same, and it is not a
shortcoming: **re-record the step**. A person demonstrating the step again is the
authoritative way to say what the element now is, and it is the only way Orbit
ever learns that.

## Related

| | |
|---|---|
| The check itself | ADR-018 |
| The recovery model | ADR-033 |
| Immutable versions | ADR-005 |
| A scripted drift demo | [`../demo/drift-recovery-demo.md`](../demo/drift-recovery-demo.md) |
| In-app version of this page | Watchtower → **Wiki** → *When a run stops because the page changed* |
| What an upgrade means for existing bindings | [upgrade.md](./upgrade.md#the-drift-enforcement-change-read-this-first) |
