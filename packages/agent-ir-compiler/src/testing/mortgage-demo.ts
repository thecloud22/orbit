import { stepChecksum } from '@orbit/db/checksum';
import type { ExecutionBinding } from '@orbit/execution-mapping';
import { EXECUTION_BINDING_SCHEMA_VERSION } from '@orbit/execution-mapping';
import { mortgageUnderwritingGraph } from '@orbit/sop-graph/testing';
import type { SopGraph } from '@orbit/sop-graph';

/**
 * The mortgage underwriting workflow's bindings, as demonstrating it produces.
 *
 * The interesting thing about this list is what is *not* in it. The workflow
 * has five decisions; only one appears here. The four computed ones compare
 * figures the run already read, so there is no page state to put a screen into
 * and no element to point at -- demonstrating them would mean inventing a
 * situation with no bearing on the answer (ADR-040). If a binding were ever
 * required for them, this fixture would have to grow four entries that mean
 * nothing, and the omission is the assertion.
 *
 * The judged decision does appear, because it reads a real region of a real
 * page: all three of its branches point at the income analyst's note, which
 * deduplicates to one region the judge is shown.
 */

const REVISION_ID = 'soprev_mortgage_demo';

function target(testId: string, role: string, name: string | null, text: string | null) {
  return {
    selectors: [
      { strategy: 'test_id' as const, value: testId },
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

/** A control whose visible text is its own label. */
function control(testId: string, name: string) {
  return target(testId, 'button', name, name);
}

/** A text field: named by its label, showing no text of its own. */
function field(testId: string, name: string) {
  return target(testId, 'textbox', name, '');
}

/**
 * A figure the workflow reads.
 *
 * No recorded text: the text *is* the value and differs per loan file, which is
 * why a `read` fingerprint compares identity and never content (ADR-018). That
 * matters more here than anywhere else in the repository -- every one of these
 * feeds a comparison, so a fingerprint that pinned the number would go stale on
 * the second loan file.
 */
function readout(testId: string) {
  return target(testId, 'generic', null, null);
}

function bindingFor(
  graph: SopGraph,
  stepId: string,
  body: ExecutionBinding['body'],
): ExecutionBinding {
  const step = graph.steps.find((candidate) => candidate.id === stepId);

  if (step === undefined) {
    throw new Error(`fixture changed: mortgageUnderwritingGraph has no step "${stepId}"`);
  }

  return {
    schemaVersion: EXECUTION_BINDING_SCHEMA_VERSION,
    stepId,
    body,
    capturedAgainstRevisionId: REVISION_ID,
    stepSha256: stepChecksum(step),
  };
}

export function mortgageUnderwritingBindings(): readonly ExecutionBinding[] {
  const graph = mortgageUnderwritingGraph();
  const judged = graph.steps.find((step) => step.id === 'check_income_stability');

  if (judged?.kind !== 'decision') {
    throw new Error('fixture changed: expected a "check_income_stability" decision');
  }

  const binding = (stepId: string, body: ExecutionBinding['body']) =>
    bindingFor(graph, stepId, body);

  return [
    binding('enter_loan_number', {
      kind: 'fill',
      target: field('loan-number-input', 'Open a file by loan number'),
      valueSource: { kind: 'sop_variable', name: 'loanNumber' },
    }),
    binding('open_file', { kind: 'click', target: control('open-loan-button', 'Open file') }),

    binding('read_ltv', {
      kind: 'extract',
      target: readout('ltv-value'),
      readMethod: { kind: 'text' },
      variable: 'loanToValue',
    }),
    binding('read_dti', {
      kind: 'extract',
      target: readout('dti-value'),
      readMethod: { kind: 'text' },
      variable: 'debtToIncome',
    }),
    binding('read_credit_score', {
      kind: 'extract',
      target: readout('credit-score-value'),
      readMethod: { kind: 'text' },
      variable: 'creditScore',
    }),
    binding('read_flood_zone', {
      kind: 'extract',
      target: readout('flood-zone-value'),
      readMethod: { kind: 'text' },
      variable: 'floodZone',
    }),

    // The judged decision: every branch reads the same paragraph, which is the
    // point -- the judge is shown one region and classifies what it says. The
    // `when` text is copied from the graph rather than retyped, because the
    // compiler matches branches by it.
    binding('check_income_stability', {
      kind: 'decision',
      branches: judged.branches.map((branch) => ({
        when: branch.when,
        ...readout('employment-note'),
      })),
    }),

    binding('add_pmi_condition', {
      kind: 'click',
      target: control('add-pmi-condition', 'Require private mortgage insurance'),
    }),
    binding('add_flood_condition', {
      kind: 'click',
      target: control('add-flood-condition', 'Require flood insurance'),
    }),
    binding('add_tax_returns_condition', {
      kind: 'click',
      target: control('add-tax-returns-condition', 'Require two years of tax returns'),
    }),

    binding('approve_file', { kind: 'click', target: control('approve-button', 'Approve file') }),
    binding('read_decision', {
      kind: 'extract',
      target: readout('decision-status'),
      readMethod: { kind: 'text' },
      variable: 'fileDecision',
    }),
    binding('decline_file', { kind: 'click', target: control('decline-button', 'Decline file') }),
    binding('escalate_file', {
      kind: 'click',
      target: control('escalate-button', 'Refer to senior underwriter'),
    }),
  ];
}

export { mortgageUnderwritingGraph };
