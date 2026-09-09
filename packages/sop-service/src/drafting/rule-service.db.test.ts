import { createRepositories } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import { createFakeSopProvider, respondWith } from '@orbit/sop-generation/testing';
import { mortgageUnderwritingGraph } from '@orbit/sop-graph/testing';
import { describe, expect, it } from 'vitest';

import { createSopRuleService, valuesReadBy } from './rule-service';

/**
 * Rule drafting against a real stored workflow (ADR-040).
 *
 * The model is the one thing faked. What is real — and what these tests are
 * about — is the *context*: the values this workflow reads, gathered from the
 * graph as it is actually persisted, and the check that every name the model
 * returned is one of them.
 *
 * Drafted against the mortgage workflow because it is the one with figures
 * worth writing rules about, and because a fixture whose values were invented
 * for this test would prove nothing about reading a real graph.
 */

async function storedWorkflow(database: Parameters<typeof createRepositories>[0]) {
  const repositories = createRepositories(database);
  const document = await repositories.sopDocuments.create({
    title: 'Underwrite a mortgage file',
    sourceText: 'Open a loan file, apply the underwriting rules, and record a decision.',
  });

  await repositories.sopGraphRevisions.create({
    documentId: document.id,
    graph: mortgageUnderwritingGraph(),
    provenance: { kind: 'generated' },
  });

  return document.id;
}

/** What a model would answer for "refer a file over 43% debt-to-income". */
const DTI_RULE = {
  resolution: 'computed',
  question: 'Is debt-to-income above the limit?',
  leftValue: 'debtToIncome',
  operator: 'gt',
  rightValue: '43',
  judgement: '',
  whenTrueLabel: 'above 43%',
  whenTrueStepId: 'escalate_file',
  whenFalseLabel: 'within the limit',
  whenFalseStepId: 'approve_file',
  insertAfterStepId: 'read_dti',
};

describe('valuesReadBy', () => {
  it('reports every value the workflow reads, with where it is read', () => {
    expect(valuesReadBy(mortgageUnderwritingGraph())).toEqual([
      { name: 'loanToValue', readAtStepId: 'read_ltv' },
      { name: 'debtToIncome', readAtStepId: 'read_dti' },
      { name: 'creditScore', readAtStepId: 'read_credit_score' },
      { name: 'floodZone', readAtStepId: 'read_flood_zone' },
      { name: 'fileDecision', readAtStepId: 'read_decision' },
    ]);
  });
});

describe('drafting a rule against a stored workflow', () => {
  const getDatabase = useTestDatabase();

  it('shows the model only what this workflow actually reads', async () => {
    const documentId = await storedWorkflow(getDatabase().db);
    const provider = createFakeSopProvider({
      respond: () => respondWith({}),
      respondToRule: () => respondWith(DTI_RULE),
    });

    await createSopRuleService({ database: getDatabase().db, provider }).draft({
      documentId,
      ruleText: 'A file whose debt-to-income exceeds 43% goes to a senior underwriter.',
    });

    const request = provider.ruleRequests[0];

    // The closed lists, built from the graph as stored. This is the whole
    // safety argument: the model picks names out of these.
    expect(request?.availableValues.map((value) => value.name)).toContain('debtToIncome');
    expect(request?.inputs).toEqual(['loanNumber']);
    expect(request?.steps.map((step) => step.id)).toContain('escalate_file');
  });

  it('proposes a decision step, and writes nothing', async () => {
    const documentId = await storedWorkflow(getDatabase().db);
    const provider = createFakeSopProvider({
      respond: () => respondWith({}),
      respondToRule: () => respondWith(DTI_RULE),
    });

    const result = await createSopRuleService({ database: getDatabase().db, provider }).draft({
      documentId,
      ruleText: 'A file whose debt-to-income exceeds 43% goes to a senior underwriter.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.step.kind !== 'decision') return;

    expect(result.step.comparison).toEqual({
      left: '${variables.debtToIncome}',
      operator: 'gt',
      right: '43',
    });
    // Placed after the step that reads what it tests, as an index the insert
    // route takes rather than as a step id every caller would have to convert.
    expect(result.insertAfterStepId).toBe('read_dti');
    expect(result.insertAtIndex).toBe(5);

    // Nothing was added: the revision is untouched until a person accepts.
    const revision = await createRepositories(getDatabase().db).sopGraphRevisions.findCurrent(
      documentId,
    );
    expect(revision?.revisionNumber).toBe(1);
    expect(revision?.graph.steps.some((step) => step.id.startsWith('decision'))).toBe(false);
  });

  it('refuses a rule about a figure this workflow never reads', async () => {
    // The case a real underwriting manual produces constantly: a rule about a
    // number nobody recorded. The answer is to record it, and saying so is
    // more useful than a step that would not compile.
    const documentId = await storedWorkflow(getDatabase().db);
    const provider = createFakeSopProvider({
      respond: () => respondWith({}),
      respondToRule: () => respondWith({ ...DTI_RULE, leftValue: 'reserveMonths' }),
    });

    const result = await createSopRuleService({ database: getDatabase().db, provider }).draft({
      documentId,
      ruleText: 'A file with fewer than 3 months of reserves needs additional reserves.',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.reason).toBe('unusable_proposal');
    if (result.reason !== 'unusable_proposal') return;
    expect(result.refusals[0]?.code).toBe('unknown_value');
  });

  it('reports a document that does not exist rather than drafting against nothing', async () => {
    const provider = createFakeSopProvider({
      respond: () => respondWith({}),
      respondToRule: () => respondWith(DTI_RULE),
    });

    const result = await createSopRuleService({ database: getDatabase().db, provider }).draft({
      documentId: (await storedWorkflow(getDatabase().db)).replace(/.$/, 'Z') as never,
      ruleText: 'Anything.',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_found');
  });
});
