import type { ExecutionBinding } from '@orbit/execution-mapping';
import type { DriftObservation } from '@orbit/runtime';
import { describe, expect, it, vi } from 'vitest';

import { createDriftRecoveryProposer, type RecoveryProposalStore } from './proposer';

/**
 * The proposer, with the database replaced by a spy.
 *
 * The assertions worth reading twice are the ones about what a proposal does
 * *not* change. Accepting one is the only thing that can move a mapping, and it
 * is only worth offering someone if what they accept is the binding they
 * already approved with one locator chain swapped — not a workflow edit
 * arriving through a recovery path (ADR-033).
 */
const APPROVED_FINGERPRINT = {
  role: 'button',
  accessibleName: 'Borrow',
  text: 'Borrow',
  boundingBox: null,
};

const FAILED = { strategy: 'test_id' as const, value: 'catalog-borrow-button' };
const FALLBACK = { strategy: 'role_and_name' as const, value: 'button', name: 'Borrow' };

function approvedBinding(): ExecutionBinding {
  return {
    schemaVersion: '0.2',
    stepId: 'borrow_title',
    body: {
      kind: 'fill',
      target: { selectors: [FAILED, FALLBACK], fingerprint: APPROVED_FINGERPRINT },
      valueSource: { kind: 'sop_variable', name: 'memberId' },
    },
    capturedAgainstRevisionId: 'soprev_1',
    stepSha256: 'a'.repeat(64),
  };
}

function observation(): DriftObservation {
  return {
    context: {
      runId: 'run_1' as DriftObservation['context']['runId'],
      agentVersionId: 'agentv_1' as DriftObservation['context']['agentVersionId'],
      agentId: 'library',
      agentStepId: 'borrow_title',
    },
    bindingId: 'execbind_1',
    mode: 'action',
    expected: APPROVED_FINGERPRINT,
    failedLocator: FAILED,
    failure: 'unresolved',
    observed: null,
    mismatches: [],
    candidates: [{ locator: FALLBACK, resolved: true, fingerprint: APPROVED_FINGERPRINT }],
  };
}

function store(overrides: Partial<RecoveryProposalStore> = {}): RecoveryProposalStore {
  return {
    contextFor: () =>
      Promise.resolve({
        documentId: 'sopdoc_1',
        stepId: 'borrow_title',
        binding: approvedBinding(),
      }),
    save: () => Promise.resolve({ saved: true as const, proposalId: 'recprop_1' }),
    ...overrides,
  };
}

describe('the drift recovery proposer', () => {
  it('proposes the approved binding with only its selector chain changed', async () => {
    const save = vi.fn<RecoveryProposalStore['save']>(() =>
      Promise.resolve({ saved: true as const, proposalId: 'recprop_1' }),
    );
    const proposer = createDriftRecoveryProposer({ store: store({ save }) });

    const outcome = await proposer.propose(observation());

    expect(outcome.proposed).toBe(true);

    const proposed = save.mock.calls[0]![0].proposedBinding;
    const original = approvedBinding();

    // Everything that is not the chain carries over untouched. A reviewer
    // accepting this is accepting one changed locator, not a workflow edit.
    expect(proposed.stepId).toBe(original.stepId);
    expect(proposed.stepSha256).toBe(original.stepSha256);
    expect(proposed.capturedAgainstRevisionId).toBe(original.capturedAgainstRevisionId);
    expect(proposed.body).toMatchObject({
      kind: 'fill',
      valueSource: { kind: 'sop_variable', name: 'memberId' },
    });
    expect(proposed.body.kind !== 'decision' && proposed.body.target.selectors).toEqual([FALLBACK]);
  });

  it('keeps the approved fingerprint, so a wrong guess drifts again next run', async () => {
    // Orbit is claiming this is the same element under a different name. If the
    // claim is wrong, the next run must stop on it rather than quietly adopting
    // whatever the fallback happened to find.
    const save = vi.fn<RecoveryProposalStore['save']>(() =>
      Promise.resolve({ saved: true as const, proposalId: 'recprop_1' }),
    );
    await createDriftRecoveryProposer({ store: store({ save }) }).propose(observation());

    const proposed = save.mock.calls[0]![0].proposedBinding;
    expect(proposed.body.kind !== 'decision' && proposed.body.target.fingerprint).toEqual(
      APPROVED_FINGERPRINT,
    );
  });

  it('writes nothing when the diagnosis refuses', async () => {
    const save = vi.fn();
    const outcome = await createDriftRecoveryProposer({ store: store({ save }) }).propose({
      ...observation(),
      candidates: [],
    });

    expect(save).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ proposed: false, reason: 'no_candidate' });
  });

  it('reports an existing open proposal rather than writing a second copy', async () => {
    // A drifted agent on a schedule must not fill Studio with one identical
    // sentence per run.
    const outcome = await createDriftRecoveryProposer({
      store: store({ save: () => Promise.resolve({ saved: false, reason: 'already_proposed' }) }),
    }).propose(observation());

    expect(outcome).toMatchObject({ proposed: false, reason: 'already_proposed' });
  });

  it('reports an unresolvable binding rather than guessing at a document', async () => {
    const outcome = await createDriftRecoveryProposer({
      store: store({ contextFor: () => Promise.resolve(null) }),
    }).propose(observation());

    expect(outcome).toMatchObject({ proposed: false, reason: 'unknown_binding' });
  });

  it('refuses a decision binding, which names one element per branch', async () => {
    const decision: ExecutionBinding = {
      ...approvedBinding(),
      body: {
        kind: 'decision',
        branches: [
          { when: 'available', selectors: [FAILED], fingerprint: APPROVED_FINGERPRINT },
          { when: 'on loan', selectors: [FALLBACK], fingerprint: APPROVED_FINGERPRINT },
        ],
      },
    };

    const outcome = await createDriftRecoveryProposer({
      store: store({
        contextFor: () =>
          Promise.resolve({ documentId: 'sopdoc_1', stepId: 'borrow_title', binding: decision }),
      }),
    }).propose(observation());

    expect(outcome).toMatchObject({ proposed: false, reason: 'not_recoverable' });
  });
});
