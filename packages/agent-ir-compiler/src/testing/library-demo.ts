import { stepChecksum } from '@orbit/db/checksum';
import type { ExecutionBinding } from '@orbit/execution-mapping';
import { EXECUTION_BINDING_SCHEMA_VERSION } from '@orbit/execution-mapping';
import { borrowOrHoldGraph, judgedAvailabilityGraph } from '@orbit/sop-graph/testing';
import type { SopGraph } from '@orbit/sop-graph';

/**
 * The branching demo: the borrow-or-hold workflow, and the bindings a person
 * would produce by demonstrating it against `apps/library-portal`.
 *
 * Hand-authored, exactly as Phase 1 hand-authored its Agent IR fixture. Nothing
 * about it is generated: these are the elements someone would point at, and
 * pinning them here is what lets the compiler test and the real-browser runtime
 * test agree on the same workflow instead of each inventing one.
 *
 * Behind a `./testing` subpath so production code has no import path to it.
 */

const REVISION_ID = 'soprev_library_demo';

/**
 * An element as a person demonstrating it would have had it recorded.
 *
 * Two locators, not one, and that is the whole reason drift here is
 * *diagnosable*. A single test id has nothing to fall back on, so a page that
 * renames one leaves Orbit able to say only "this stopped working". With the
 * accessible role and name recorded beside it, a run that finds the test id
 * gone can check whether the same button is still there under its own name —
 * which is what turns "it broke" into a proposal somebody can accept (ADR-033).
 *
 * Agent IR still carries only the head of the chain, so adding the fallback
 * changes nothing about what any published version executes.
 *
 * The fingerprints are what `apps/library-portal` actually reports, measured
 * through the executor's own `describeElement` rather than guessed. They were
 * guessed originally, and were wrong — a text field's visible text is empty
 * rather than its label, and the confirmation paragraphs have no accessible
 * name at all. Nothing could tell, because until ADR-033 wired the binding
 * resolver into a real run, nothing had ever compared them to a page.
 */
function target(testId: string, role: string, name: string | null, text: string | null) {
  return {
    selectors: [
      { strategy: 'test_id' as const, value: testId },
      // Only when the element has an accessible name to be found by. A
      // `role_and_name` locator with no name would match every paragraph on the
      // page, which is a fallback that resolves ambiguously — worse than none.
      ...(name === null ? [] : [{ strategy: 'role_and_name' as const, value: role, name }]),
    ],
    fingerprint: {
      role,
      accessibleName: name,
      text,
      boundingBox: { x: 0, y: 0, width: 120, height: 32 },
    },
  };
}

/** A control: its visible text is its own label, and is stable. */
function control(testId: string, role: string, name: string) {
  return target(testId, role, name, name);
}

/**
 * A text field: named by its label, and showing no text of its own.
 *
 * The empty string rather than the label, which is what the page reports and
 * what an `action` comparison checks.
 */
function field(testId: string, name: string) {
  return target(testId, 'textbox', name, '');
}

/**
 * A value the workflow reads.
 *
 * No accessible name and no recorded text: the text *is* the extracted value
 * and differs every run, which is exactly why a `read` fingerprint compares
 * identity and never content (ADR-018).
 */
function readout(testId: string, role: string) {
  return target(testId, role, null, null);
}

/**
 * Checksummed against the step as the graph currently states it.
 *
 * Computed rather than pinned: a placeholder would make every one of these
 * bindings stale the moment the fixture graph is touched, and the resulting
 * refusal would be about drift that did not happen.
 */
function bindingFor(
  graph: SopGraph,
  stepId: string,
  body: ExecutionBinding['body'],
): ExecutionBinding {
  const step = graph.steps.find((candidate) => candidate.id === stepId);

  if (step === undefined) {
    throw new Error(`fixture changed: borrowOrHoldGraph has no step "${stepId}"`);
  }

  return {
    schemaVersion: EXECUTION_BINDING_SCHEMA_VERSION,
    stepId,
    body,
    capturedAgainstRevisionId: REVISION_ID,
    stepSha256: stepChecksum(step),
  };
}

/**
 * Every binding the workflow needs, including the decision's two branches.
 *
 * The decision's `when` values are copied from the graph rather than retyped,
 * because the compiler matches branches by that text and a typo here would
 * surface as a refusal about a branch nobody demonstrated.
 */
export function borrowOrHoldBindings(): readonly ExecutionBinding[] {
  const graph = borrowOrHoldGraph();
  const decision = graph.steps.find((step) => step.id === 'check_availability');

  if (decision?.kind !== 'decision') {
    throw new Error(
      'fixture changed: borrowOrHoldGraph must contain a "check_availability" decision',
    );
  }

  const [available, onLoan] = decision.branches;

  if (available === undefined || onLoan === undefined) {
    throw new Error('fixture changed: "check_availability" must declare two branches');
  }

  const binding = (stepId: string, body: ExecutionBinding['body']) =>
    bindingFor(graph, stepId, body);

  return [
    binding('enter_isbn', {
      kind: 'fill',
      target: field('catalog-search-input', 'Title or ISBN'),
      valueSource: { kind: 'sop_variable', name: 'bookIsbn' },
    }),
    binding('search_catalog', {
      kind: 'click',
      target: control('catalog-search-button', 'button', 'Search'),
    }),
    binding('check_availability', {
      kind: 'decision',
      branches: [
        // The Borrow form renders only for an available title and the Hold form
        // only for one on loan, so each branch's element is present in exactly
        // one of the two states. That mutual exclusivity is what makes the
        // runtime's race between them a decision rather than a guess.
        {
          when: available.when,
          ...control('catalog-borrow-button', 'button', 'Borrow'),
        },
        {
          when: onLoan.when,
          ...control('catalog-hold-button', 'button', 'Place a hold'),
        },
      ],
    }),
    binding('enter_borrow_member_id', {
      kind: 'fill',
      target: field('catalog-borrow-input', 'Member ID to borrow'),
      valueSource: { kind: 'sop_variable', name: 'memberId' },
    }),
    binding('borrow_title', {
      kind: 'click',
      target: control('catalog-borrow-button', 'button', 'Borrow'),
    }),
    binding('read_borrow_confirmation', {
      kind: 'extract',
      target: readout('catalog-borrow-result', 'paragraph'),
      readMethod: { kind: 'text' },
      variable: 'borrowConfirmation',
    }),
    binding('enter_hold_member_id', {
      kind: 'fill',
      target: field('catalog-hold-input', 'Member ID to place a hold'),
      valueSource: { kind: 'sop_variable', name: 'memberId' },
    }),
    binding('place_hold', {
      kind: 'click',
      target: control('catalog-hold-button', 'button', 'Place a hold'),
    }),
    binding('read_hold_confirmation', {
      kind: 'extract',
      target: readout('catalog-hold-result', 'paragraph'),
      readMethod: { kind: 'text' },
      variable: 'holdConfirmation',
    }),
  ];
}

/**
 * The outcomes this demo reaches, and they are its own words.
 *
 * They used to be mapped onto Phase 1's `request_found` / `request_not_found`,
 * which recorded the right branch under the wrong name. A business outcome is
 * now the declared name itself (ADR-030), so a run of this workflow records
 * "borrowed" or "held" — exactly what happened.
 */
export const BORROW_OR_HOLD_OUTCOMES = ['borrowed', 'held'] as const;

export { borrowOrHoldGraph };
export type { SopGraph };

/**
 * Bindings for the judged variant.
 *
 * Every branch points at the *same* element — the status region — because that
 * is where the evidence is. A person demonstrating a judged decision is not
 * showing three different screens; they are pointing at the one place the
 * answer is written, once per case. The compiler deduplicates them into a
 * single `readFrom` region, which is what the judge is shown.
 */
export function judgedAvailabilityBindings(): readonly ExecutionBinding[] {
  const graph = judgedAvailabilityGraph();
  const decision = graph.steps.find((step) => step.id === 'check_availability');

  if (decision?.kind !== 'decision') {
    throw new Error('fixture changed: judgedAvailabilityGraph must contain a decision');
  }

  // The availability line the judge reads. `text` with no accessible name is
  // what the portal actually reports for it, and its content is the value being
  // judged, so nothing about it is recorded as stable.
  const status = readout('catalog-result-status', 'text');

  // Only the decision step differs between the two graphs, so every other
  // binding's checksum still matches its step and is reused unchanged. The
  // decision's own binding is rebuilt against the judged graph — a binding
  // carrying the deterministic version's checksum would be refused as stale,
  // which is exactly what that check is for.
  return borrowOrHoldBindings()
    .filter((binding) => binding.stepId !== 'check_availability')
    .concat([
      bindingFor(graph, 'check_availability', {
        kind: 'decision',
        branches: decision.branches.map((branch) => ({ when: branch.when, ...status })),
      }),
    ]);
}
