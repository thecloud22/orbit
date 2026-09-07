import { stepChecksum } from '@orbit/db/checksum';
import type { ExecutionBinding } from '@orbit/execution-mapping';
import { escalationReviewGraph } from '@orbit/sop-graph/testing';
import { translateRecording } from '@orbit/sop-recording';
import { describe, expect, it } from 'vitest';

import { compileCandidate } from './compile';

/**
 * The compiler against real inputs rather than hand-written fixtures.
 *
 * A recorded workflow is what this sub-phase exists to compile, and the
 * escalation-review graph is the realistic target Phase 2 is aiming at. Both are
 * asserted here — one because it must work, and one because it must fail for a
 * reason that is written down rather than discovered later.
 */

const FINGERPRINT = {
  role: 'textbox',
  accessibleName: 'Request number',
  text: '',
  boundingBox: null,
} as const;

const IDS = {
  allowedHosts: ['localhost', '127.0.0.1'],
  agentId: 'agent_recorded',
  version: '0.1.0',
  sopId: 'sop_recorded',
  sopVersion: '1',
} as const;

function bindingsFrom(translated: ReturnType<typeof translateRecording>): ExecutionBinding[] {
  if (!translated.ok) {
    throw new Error('the fixture recording should translate');
  }

  return translated.steps.flatMap(({ step, binding }) =>
    binding === undefined
      ? []
      : [
          {
            schemaVersion: '0.1',
            stepId: step.id,
            body: binding,
            capturedAgainstRevisionId: 'soprev_recorded',
            stepSha256: stepChecksum(step),
          } satisfies ExecutionBinding,
        ],
  );
}

describe('a recorded workflow', () => {
  const recording = translateRecording({
    title: 'Find a service request',
    sequence: [
      { kind: 'navigate', url: 'http://localhost:3001/requests' },
      {
        kind: 'fill',
        typedValue: 'SR-1001',
        selectors: [{ strategy: 'test_id', value: 'request-number-input' }],
        fingerprint: FINGERPRINT,
      },
      {
        kind: 'click',
        selectors: [{ strategy: 'test_id', value: 'search-request-button' }],
        fingerprint: FINGERPRINT,
      },
    ],
  });

  it('compiles end to end, which is the whole point of the sub-phase', () => {
    if (!recording.ok) throw new Error('the recording should translate');

    const result = compileCandidate({
      graph: recording.graph,
      bindings: bindingsFrom(recording),
      // `completed` is what the recorder names its appended outcome, and it is
      // not a business outcome Agent IR knows. The mapping is the bridge.
      outcomeMapping: { completed: 'request_found' },
      ...IDS,
    });

    expect(result.ok ? [] : result.refusals).toEqual([]);
    if (!result.ok) return;

    expect(result.agentIr.steps.map((step) => step.type)).toEqual([
      'browser.navigate',
      'browser.fill',
      'browser.click',
      'complete',
    ]);
    expect(result.secretInputIds).toEqual([]);
  });

  it('refuses when the recorder-appended outcome has not been mapped', () => {
    if (!recording.ok) throw new Error('the recording should translate');

    // Without this refusal a recorded workflow would compile to an outcome
    // nobody chose, which is a business claim the compiler is not entitled to
    // make on its own.
    const result = compileCandidate({
      graph: recording.graph,
      bindings: bindingsFrom(recording),
      outcomeMapping: {},
      ...IDS,
    });

    expect(result.ok ? [] : result.refusals.map((entry) => entry.code)).toEqual([
      'unmapped_outcome',
    ]);
  });
});

describe('the escalation-review reference workflow', () => {
  it('is refused: it routes to a person, and nothing in it is bound', () => {
    // This is the worked example from the requirements document and the
    // realistic target for Phase 2. It still does not compile, and pinning that
    // here means the limitation is a test rather than a paragraph someone has
    // to remember. What changed in this task is *why*: branching itself is no
    // longer the obstacle — these decisions simply have no bindings, and three
    // steps still route to a human, which nothing can automate.
    const graph = escalationReviewGraph();

    const result = compileCandidate({
      graph,
      bindings: [],
      outcomeMapping: {},
      ...IDS,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const codes = new Set(result.refusals.map((entry) => entry.code));
    // Not `missing_branch_binding`: with no bindings at all, a decision is
    // refused for having none, exactly as a fill or a click is.
    expect(codes.has('missing_binding')).toBe(true);
    expect(codes.has('manual_review_unsupported')).toBe(true);
  });
});
