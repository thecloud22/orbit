import { buttonFingerprint, statusFingerprint } from '@orbit/execution-mapping/testing';
import type { SelectorChain } from '@orbit/execution-mapping';
import { escalationReviewGraph } from '@orbit/sop-graph/testing';
import { describeStep } from '@orbit/sop-graph';
import { describe, expect, it } from 'vitest';

import { buildConfirmSummary, summarizeValueSource } from './confirm';

const GRAPH = escalationReviewGraph();
const STEP = GRAPH.steps.find((step) => step.id === 'sign_in')!;

const SELECTORS = [
  { strategy: 'test_id', value: 'search-request-button' },
  { strategy: 'role_and_name', value: 'button', name: 'Search' },
] as SelectorChain;

function capture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'capture-1',
    type: 'click' as const,
    typedValue: undefined,
    sensitive: false,
    selectors: SELECTORS,
    fingerprint: buttonFingerprint(),
    considered: [
      { locator: SELECTORS[0]!, matchCount: 1, isTarget: true },
      { locator: SELECTORS[1]!, matchCount: 1, isTarget: true },
    ],
    url: 'http://localhost:3001/requests',
    capturedAt: new Date('2026-09-06T12:00:00.000Z'),
    ...overrides,
  };
}

describe('the confirm screen', () => {
  it('names the step exactly as the review view does', () => {
    const summary = buildConfirmSummary({
      step: STEP,
      capture: capture(),
      valueSourceSummary: undefined,
      readMethodSummary: undefined,
      advice: [],
    });

    // The same renderer, so a step reads identically wherever it appears and
    // there is no second one to drift.
    expect(summary.stepLabel).toBe(describeStep(STEP));
    expect(summary.lines[0]).toContain(describeStep(STEP));
  });

  it('shows how the element will be found, in order', () => {
    const lines = buildConfirmSummary({
      step: STEP,
      capture: capture(),
      valueSourceSummary: undefined,
      readMethodSummary: undefined,
      advice: [],
    }).lines.join('\n');

    expect(lines).toContain('1. test_id=search-request-button');
    expect(lines).toContain('2. role_and_name=button "Search"');
  });

  it('shows what was rejected and why', () => {
    const lines = buildConfirmSummary({
      step: STEP,
      capture: capture({
        considered: [
          { locator: SELECTORS[0]!, matchCount: 1, isTarget: true },
          { locator: SELECTORS[1]!, matchCount: 3, isTarget: false },
        ],
      }),
      valueSourceSummary: undefined,
      readMethodSummary: undefined,
      advice: [],
    }).lines.join('\n');

    expect(lines).toContain('Not used:');
    expect(lines).toContain('matched 3 elements');
  });

  it('shows the fingerprint a future run will be checked against', () => {
    const lines = buildConfirmSummary({
      step: STEP,
      capture: capture(),
      valueSourceSummary: undefined,
      readMethodSummary: undefined,
      advice: [],
    }).lines.join('\n');

    expect(lines).toContain('role            button');
    expect(lines).toContain('accessible name Search');
  });

  it('marks advice as advisory, and says which came from a model', () => {
    const lines = buildConfirmSummary({
      step: STEP,
      capture: capture(),
      valueSourceSummary: undefined,
      readMethodSummary: undefined,
      advice: [
        {
          kind: 'semantic_mismatch',
          severity: 'warning',
          message: 'Looks unrelated.',
          fromModel: true,
        },
        {
          kind: 'selector_robustness',
          severity: 'info',
          message: 'Only one selector.',
          fromModel: false,
        },
      ],
    }).lines.join('\n');

    expect(lines).toContain('nothing here changes what is saved');
    expect(lines).toContain('Looks unrelated. [model]');
    expect(lines).toContain('- Only one selector.');
  });

  it('renders a read target’s method', () => {
    const lines = buildConfirmSummary({
      step: STEP,
      capture: capture({ type: 'pick', fingerprint: statusFingerprint() }),
      valueSourceSummary: undefined,
      readMethodSummary: 'text',
      advice: [],
    }).lines.join('\n');

    expect(lines).toContain('Read        text');
  });
});

describe('summarizeValueSource', () => {
  it('says the typed value will not be saved when a variable was chosen', () => {
    const summary = summarizeValueSource(
      { kind: 'sop_variable', name: 'requestNumber' },
      'SR-1001',
    );

    expect(summary).toContain('from the workflow value "requestNumber"');
    expect(summary).toContain('will not be saved');
  });

  it('states plainly when a fixed default is what gets stored', () => {
    expect(summarizeValueSource({ kind: 'literal', value: 'SR-1001' }, 'SR-1001')).toContain(
      'a fixed default: "SR-1001"',
    );
  });

  it('does not echo a long typed value in full', () => {
    const summary = summarizeValueSource(
      { kind: 'sop_variable', name: 'password' },
      'x'.repeat(200),
    );

    expect(summary.length).toBeLessThan(160);
    expect(summary).toContain('…');
  });
});
