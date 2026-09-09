import { SOP_GRAPH_SCHEMA_VERSION } from '../sop-graph';
import type { SopGraph } from '../sop-graph';

/**
 * Mortgage underwriting: the workflow ADR-040 exists for.
 *
 * A lender's underwriting manual is a list of thresholds and one or two
 * genuine judgements, and this workflow is both kinds side by side against
 * `apps/mortgage-portal`:
 *
 *   - four **computed** decisions -- the credit floor, the DTI limit, the PMI
 *     threshold, the flood zone -- each comparing a figure the loan origination
 *     system already computed and displays. No model, no page state to point at,
 *     the same answer every run;
 *   - one **judged** decision, reading the income analyst's note to decide
 *     whether the income needs two years of returns to stand up. That is not a
 *     number and never will be: it is a paragraph of prose written by a person,
 *     and it is exactly the case ADR-032 added a model for.
 *
 * The order of the four thresholds is the order a real underwriter applies
 * them, and it matters: a file below the credit floor is declined without ever
 * reaching the DTI limit, so the branch a run takes changes which questions it
 * even asks.
 *
 * `loanToValue`, `debtToIncome`, `creditScore` and `floodZone` are all read
 * from the screen rather than derived. That is the constraint, not an
 * accident -- a rule about loan-to-value requires a step that reads
 * loan-to-value, and the compiler refuses it otherwise.
 */
export function mortgageUnderwritingGraph(): SopGraph {
  return {
    schemaVersion: SOP_GRAPH_SCHEMA_VERSION,
    title: 'Underwrite a mortgage file',
    description:
      'Open a loan file, read its underwriting summary, apply the credit, debt-to-income, mortgage-insurance and flood rules, and record a decision.',
    entryStepId: 'open_pipeline',
    inputs: [
      {
        id: 'loanNumber',
        label: 'Loan number',
        type: 'string',
        required: true,
        minLength: 1,
        example: 'ML-26-04471',
      },
    ],
    outputs: [{ name: 'fileDecision', label: 'File decision' }],
    steps: [
      {
        id: 'open_pipeline',
        kind: 'navigate',
        purpose: 'Open the underwriting pipeline',
        urlHint: 'http://localhost:3030/pipeline',
        systemHint: 'Meridian Home Lending',
        group: 'Open the file',
      },
      {
        id: 'enter_loan_number',
        kind: 'fill',
        purpose: 'Enter the loan number',
        fieldHint: 'Open a file by loan number',
        value: '${inputs.loanNumber}',
        group: 'Open the file',
      },
      {
        id: 'open_file',
        kind: 'click',
        purpose: 'Open the file',
        targetHint: 'Open file',
        group: 'Open the file',
      },

      {
        id: 'read_ltv',
        kind: 'extract',
        purpose: 'Read the loan-to-value the system calculated',
        fields: [{ name: 'loanToValue', labelHint: 'Loan-to-value', required: true }],
        group: 'Read the underwriting summary',
      },
      {
        id: 'read_dti',
        kind: 'extract',
        purpose: 'Read the debt-to-income the system calculated',
        fields: [{ name: 'debtToIncome', labelHint: 'Debt-to-income', required: true }],
        group: 'Read the underwriting summary',
      },
      {
        id: 'read_credit_score',
        kind: 'extract',
        purpose: 'Read the credit score',
        fields: [{ name: 'creditScore', labelHint: 'Credit score', required: true }],
        group: 'Read the underwriting summary',
      },
      {
        id: 'read_flood_zone',
        kind: 'extract',
        purpose: 'Read the FEMA flood zone',
        fields: [{ name: 'floodZone', labelHint: 'FEMA flood zone', required: true }],
        group: 'Read the underwriting summary',
      },

      {
        id: 'check_credit_floor',
        kind: 'decision',
        question: 'Is the credit score below the program floor?',
        ruleText: 'A file with a credit score below 620 is declined.',
        resolution: 'computed',
        comparison: { left: '${variables.creditScore}', operator: 'lt', right: '620' },
        branches: [
          { when: 'below the 620 floor', nextStepId: 'decline_file' },
          { when: 'at or above the floor', nextStepId: 'check_dti_limit', otherwise: true },
        ],
        group: 'Apply the underwriting rules',
      },
      {
        id: 'check_dti_limit',
        kind: 'decision',
        question: 'Is debt-to-income above the limit?',
        ruleText: 'A file whose debt-to-income exceeds 43% is referred to a senior underwriter.',
        resolution: 'computed',
        comparison: { left: '${variables.debtToIncome}', operator: 'gt', right: '43' },
        branches: [
          { when: 'above 43%', nextStepId: 'escalate_file' },
          { when: 'within the limit', nextStepId: 'check_pmi_threshold', otherwise: true },
        ],
        group: 'Apply the underwriting rules',
      },
      {
        id: 'check_pmi_threshold',
        kind: 'decision',
        question: 'Is loan-to-value above the mortgage insurance threshold?',
        ruleText:
          'A file whose loan-to-value exceeds 80% requires private mortgage insurance before closing.',
        resolution: 'computed',
        comparison: { left: '${variables.loanToValue}', operator: 'gt', right: '80' },
        branches: [
          { when: 'above 80%', nextStepId: 'add_pmi_condition' },
          { when: 'at or below 80%', nextStepId: 'check_flood_zone', otherwise: true },
        ],
        group: 'Apply the underwriting rules',
      },
      {
        id: 'add_pmi_condition',
        kind: 'click',
        purpose: 'Attach the mortgage insurance condition',
        targetHint: 'Require private mortgage insurance',
        group: 'Apply the underwriting rules',
      },
      {
        id: 'check_flood_zone',
        kind: 'decision',
        question: 'Is the property in a special flood hazard area?',
        ruleText:
          'A property outside flood zone X requires a flood insurance policy before closing.',
        resolution: 'computed',
        // Text equality rather than a categorical operator: every zone that is
        // not `X` is a special flood hazard area, so "is not X" is the rule as
        // written, and listing AE, AO and VE would go stale the moment FEMA
        // publishes another.
        comparison: { left: '${variables.floodZone}', operator: 'neq', right: 'X' },
        branches: [
          { when: 'in a flood hazard area', nextStepId: 'add_flood_condition' },
          {
            when: 'outside the hazard area',
            nextStepId: 'check_income_stability',
            otherwise: true,
          },
        ],
        group: 'Apply the underwriting rules',
      },
      {
        id: 'add_flood_condition',
        kind: 'click',
        purpose: 'Attach the flood insurance condition',
        targetHint: 'Require flood insurance',
        group: 'Apply the underwriting rules',
      },

      {
        id: 'check_income_stability',
        kind: 'decision',
        question:
          "Does the income analyst's note describe income that needs two years to stand up?",
        ruleText:
          'Self-employed or seasonal income requires two years of tax returns before it can be used.',
        // The one genuine judgement in the workflow. No threshold settles it:
        // the answer is in a paragraph a person wrote about how the borrower
        // earns money.
        resolution: 'judged',
        judgement:
          'Read the income analyst note. Say the income needs two years of returns when the borrower is self-employed, owns the business, or the note describes the income as seasonal, variable, or dependent on a contract that may not renew. Say it is straightforward when the borrower is salaried, hourly, or draws a fixed pension.',
        branches: [
          { when: 'needs two years of returns', nextStepId: 'add_tax_returns_condition' },
          { when: 'straightforward income', nextStepId: 'approve_file' },
          {
            when: 'the note does not settle it',
            nextStepId: 'escalate_file',
            insufficientEvidence: true,
          },
        ],
        group: 'Apply the underwriting rules',
      },
      {
        id: 'add_tax_returns_condition',
        kind: 'click',
        purpose: 'Attach the two-years-of-returns condition',
        targetHint: 'Require two years of tax returns',
        group: 'Apply the underwriting rules',
      },

      {
        id: 'approve_file',
        kind: 'click',
        purpose: 'Approve the file',
        targetHint: 'Approve file',
        group: 'Record the decision',
      },
      {
        id: 'read_decision',
        kind: 'extract',
        purpose: 'Read the decision the system recorded',
        fields: [{ name: 'fileDecision', labelHint: 'File decision', required: true }],
        group: 'Record the decision',
      },
      {
        id: 'outcome_approved',
        kind: 'outcome',
        outcome: 'file_approved',
        message: 'The file was approved, with any conditions the rules required.',
        returns: [{ name: 'fileDecision' }],
        group: 'Record the decision',
      },

      {
        id: 'decline_file',
        kind: 'click',
        purpose: 'Decline the file',
        targetHint: 'Decline file',
        group: 'Record the decision',
      },
      {
        id: 'outcome_declined',
        kind: 'outcome',
        outcome: 'file_declined',
        message: 'The file was declined against the credit floor.',
        group: 'Record the decision',
      },

      {
        id: 'escalate_file',
        kind: 'click',
        purpose: 'Refer the file to a senior underwriter',
        targetHint: 'Refer to senior underwriter',
        group: 'Record the decision',
      },
      {
        id: 'outcome_referred',
        kind: 'outcome',
        outcome: 'file_referred',
        message: 'The file was referred to a senior underwriter.',
        group: 'Record the decision',
      },
    ],
    assumptions: [
      {
        id: 'ratios_are_published',
        statement:
          'Every ratio this workflow reads is calculated and displayed by the loan origination system.',
        rationale:
          'Orbit compares figures the system of record published and stands behind. It derives none of its own, which is why each is read from the screen rather than worked out from the loan amount and the appraisal.',
      },
    ],
    clarificationQuestions: [],
    risks: [
      {
        id: 'thresholds_go_stale',
        statement:
          'A threshold written into a rule goes stale when the lender changes it. The rule text on each decision is what a reviewer checks the comparison against.',
        severity: 'medium',
      },
    ],
  };
}

/** The outcomes this workflow can reach, in its own words (ADR-030). */
export const MORTGAGE_OUTCOMES = ['file_approved', 'file_declined', 'file_referred'] as const;
