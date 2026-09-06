import { buttonFingerprint, statusFingerprint } from '@orbit/execution-mapping/testing';
import type { SelectorChain } from '@orbit/execution-mapping';
import { describe, expect, it } from 'vitest';

import { adviseOnDriftRecovery, adviseOnSemanticMatch } from './assist';
import { AssistProviderError, type AssistProvider } from './provider';
import { createFakeAssistProvider } from './testing/fake-provider';

const SELECTORS = [{ strategy: 'test_id', value: 'search-request-button' }] as SelectorChain;

const SEMANTIC_INPUT = {
  stepPurpose: 'Run the advanced search',
  stepKind: 'click',
  fingerprint: buttonFingerprint(),
  selectors: SELECTORS,
};

describe('semantic mismatch — model-backed', () => {
  it('passes a plausible pairing quietly', async () => {
    const provider = createFakeAssistProvider({
      semantic: { plausible: true, reason: 'A Search button for a step about searching.' },
    });

    const advice = await adviseOnSemanticMatch(provider, SEMANTIC_INPUT);

    expect(advice[0]?.severity).toBe('info');
    expect(advice[0]?.fromModel).toBe(true);
  });

  it('warns about a deliberately mismatched pairing', async () => {
    const provider = createFakeAssistProvider({
      semantic: { plausible: false, reason: 'A "Delete account" button for a search step.' },
    });

    const advice = await adviseOnSemanticMatch(provider, SEMANTIC_INPUT);

    expect(advice[0]?.severity).toBe('warning');
    expect(advice[0]?.message).toContain('Delete account');
  });

  it('sends the step’s purpose and the element’s identity, and nothing else', async () => {
    const provider = createFakeAssistProvider();
    await adviseOnSemanticMatch(provider, SEMANTIC_INPUT);

    const request = provider.semanticRequests[0];
    expect(request?.stepPurpose).toBe('Run the advanced search');
    expect(request?.fingerprint.accessibleName).toBe('Search');
  });

  it('produces no advice when no model is reachable, rather than failing', async () => {
    // Advice is optional by definition. A recording must never fail for want of
    // a suggestion.
    const provider = createFakeAssistProvider({ failWith: 'no model configured' });

    await expect(adviseOnSemanticMatch(provider, SEMANTIC_INPUT)).resolves.toEqual([]);
  });

  it('lets a defect propagate instead of disguising it as a missing suggestion', async () => {
    const broken: AssistProvider = {
      descriptor: { provider: 'broken', model: 'broken' },
      checkSemanticMatch: () =>
        Promise.reject(new TypeError('cannot read properties of undefined')),
      rankDriftCandidates: () => Promise.reject(new AssistProviderError('unused')),
    };

    await expect(adviseOnSemanticMatch(broken, SEMANTIC_INPUT)).rejects.toThrow(TypeError);
  });
});

describe('drift recovery — model ranks, code narrows', () => {
  const candidates = [
    { selectors: SELECTORS, fingerprint: buttonFingerprint() },
    {
      selectors: [{ strategy: 'test_id', value: 'other' }] as SelectorChain,
      fingerprint: statusFingerprint(),
    },
  ];

  it('suggests the closest match without applying it', async () => {
    const provider = createFakeAssistProvider({
      drift: { bestIndex: 0, reason: 'The Search button moved but is otherwise the same.' },
    });

    const advice = await adviseOnDriftRecovery(provider, {
      stepPurpose: 'Run the advanced search',
      expected: buttonFingerprint(),
      candidates,
    });

    expect(advice[0]?.message).toContain('Re-record the step to confirm');
    expect(advice[0]?.message).toContain('suggestion, not a change');
  });

  it('narrows by role before the model sees anything', async () => {
    // Finding the candidates is not a judgement call, so it is not asked of a
    // model; only the ranking is.
    const provider = createFakeAssistProvider();

    await adviseOnDriftRecovery(provider, {
      stepPurpose: 'Run the advanced search',
      expected: buttonFingerprint(),
      candidates,
    });

    expect(provider.driftRequests[0]?.candidates.length).toBe(1);
  });

  it('says plainly when nothing on the page resembles the element', async () => {
    const provider = createFakeAssistProvider();

    const advice = await adviseOnDriftRecovery(provider, {
      stepPurpose: 'Run the advanced search',
      expected: buttonFingerprint(),
      candidates: [],
    });

    expect(advice[0]?.severity).toBe('warning');
    expect(advice[0]?.fromModel).toBe(false);
    expect(provider.driftRequests).toEqual([]);
  });

  it('reports the model finding no plausible replacement', async () => {
    const provider = createFakeAssistProvider({
      drift: { bestIndex: null, reason: 'None of these is the same control.' },
    });

    const advice = await adviseOnDriftRecovery(provider, {
      stepPurpose: 'Run the advanced search',
      expected: buttonFingerprint(),
      candidates,
    });

    expect(advice[0]?.severity).toBe('warning');
    expect(advice[0]?.message).toBe('None of these is the same control.');
  });

  it('produces no advice when no model is reachable', async () => {
    const provider = createFakeAssistProvider({ failWith: 'no model configured' });

    await expect(
      adviseOnDriftRecovery(provider, {
        stepPurpose: 'Run the advanced search',
        expected: buttonFingerprint(),
        candidates,
      }),
    ).resolves.toEqual([]);
  });
});

describe('every assist is advisory', () => {
  it('returns advice and nothing that could be applied', async () => {
    const provider = createFakeAssistProvider();
    const advice = await adviseOnSemanticMatch(provider, SEMANTIC_INPUT);

    // There is deliberately no field here that a caller could act on
    // automatically: no replacement selector, no patch, no "apply" flag.
    for (const entry of advice) {
      expect(Object.keys(entry).sort()).toEqual(['fromModel', 'kind', 'message', 'severity']);
    }
  });
});
