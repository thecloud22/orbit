import { CandidateNotValidatedError, createRepositories, type OrbitDatabase } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import type { SelectorChain } from '@orbit/execution-mapping';
import { buttonFingerprint, fieldFingerprint } from '@orbit/execution-mapping/testing';
import type { RecordedEntry } from '@orbit/sop-recording';
import { describe, expect, it } from 'vitest';

import { createSopCandidateService } from './candidate-service';
import { createSopRecordingService } from './recording-service';

/**
 * Compiling a recorded workflow into a candidate agent, against real
 * persistence.
 *
 * The input is a genuine recording put through the real translation and the
 * real binding lifecycle, because that is the actual path 2.5 exists to serve —
 * a hand-written graph would only prove the compiler works on hand-written
 * graphs.
 */
const FIELD = [{ strategy: 'test_id', value: 'request-number-input' }] as SelectorChain;
const BUTTON = [
  { strategy: 'test_id', value: 'search-request-button' },
  { strategy: 'role_and_name', value: 'button', name: 'Search' },
] as SelectorChain;

const SEQUENCE: readonly RecordedEntry[] = [
  { kind: 'navigate', url: 'http://localhost:3001/requests' },
  { kind: 'fill', selectors: FIELD, fingerprint: fieldFingerprint(), typedValue: 'SR-1001' },
  { kind: 'click', selectors: BUTTON, fingerprint: buttonFingerprint() },
];

const SIGN_IN: readonly RecordedEntry[] = [
  { kind: 'navigate', url: 'http://localhost:3001/requests' },
  { kind: 'fill', selectors: FIELD, fingerprint: fieldFingerprint(), sensitive: true },
];

describe('compiling a document into a candidate agent', () => {
  const getDatabase = useTestDatabase();

  async function recordDocument(sequence: readonly RecordedEntry[] = SEQUENCE) {
    const result = await createSopRecordingService({
      database: getDatabase().db,
    }).createFromRecording({
      title: 'Find a service request',
      startUrl: 'http://localhost:3001/requests',
      sequence,
    });

    if (!result.ok) {
      throw new Error(`the fixture recording should persist: ${JSON.stringify(result)}`);
    }

    return result;
  }

  function service(database: OrbitDatabase = getDatabase().db) {
    return createSopCandidateService({ database });
  }

  async function compile(sequence: readonly RecordedEntry[] = SEQUENCE) {
    const recorded = await recordDocument(sequence);

    const result = await service().compileDocument({
      documentId: recorded.document.id,
      outcomeMapping: { completed: 'request_found' },
      agentId: 'agent_compiled',
      version: '0.1.0',
    });

    return { recorded, result };
  }

  it('compiles a recorded workflow and stores the candidate', async () => {
    const { recorded, result } = await compile();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.candidate.documentId).toBe(recorded.document.id);
    expect(result.candidate.state).toBe('compiled');
    expect(result.candidate.candidateNumber).toBe(1);
    expect(result.candidate.agentIr.steps.map((step) => step.type)).toEqual([
      'browser.navigate',
      'browser.fill',
      'browser.click',
      'complete',
    ]);
  });

  it('records exactly which mappings went in, so approval names a fixed set', async () => {
    const { recorded, result } = await compile();
    if (!result.ok) throw new Error('expected a candidate');

    const bindings = await createRepositories(getDatabase().db).executionBindings.listCurrent(
      recorded.document.id,
    );

    expect([...result.candidate.compiledFromBindingIds].sort()).toEqual(
      bindings.map((binding) => binding.id).sort(),
    );
  });

  it('re-reads the candidate as validated Agent IR, not as a JSON blob', async () => {
    const { recorded, result } = await compile();
    if (!result.ok) throw new Error('expected a candidate');

    const current = await service().current(recorded.document.id);

    expect(current?.id).toBe(result.candidate.id);
    expect(current?.agentIr.lifecycle).toEqual({ status: 'draft', trustTier: 'observe' });
  });

  it('supersedes the previous candidate when recompiled, leaving exactly one current', async () => {
    const { recorded } = await compile();

    const second = await service().compileDocument({
      documentId: recorded.document.id,
      outcomeMapping: { completed: 'request_not_found' },
      agentId: 'agent_compiled',
      version: '0.2.0',
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const all = await createRepositories(getDatabase().db).agentIrCandidates.listByDocument(
      recorded.document.id,
    );

    expect(all).toHaveLength(2);
    expect(all.filter((candidate) => candidate.supersededByCandidateId === null)).toHaveLength(1);
    expect(all.find((candidate) => candidate.candidateNumber === 1)?.state).toBe('superseded');
  });

  it('reports a refusal as a refusal rather than throwing', async () => {
    const recorded = await recordDocument();

    const result = await service().compileDocument({
      documentId: recorded.document.id,
      // The recorder names its appended outcome `completed`; leaving it unmapped
      // is an ordinary state of affairs, not a fault.
      outcomeMapping: {},
      agentId: 'agent_compiled',
      version: '0.1.0',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('refused');
  });

  it('says plainly when there is no such document', async () => {
    const result = await service().compileDocument({
      documentId: 'sopdoc_missing' as never,
      outcomeMapping: {},
      agentId: 'agent_compiled',
      version: '0.1.0',
    });

    expect(result.ok ? null : result.reason).toBe('not_found');
  });
});

describe('the separate technical approval', () => {
  const getDatabase = useTestDatabase();

  async function compiled(sequence: readonly RecordedEntry[] = SEQUENCE) {
    const recorded = await createSopRecordingService({
      database: getDatabase().db,
    }).createFromRecording({
      title: 'Find a service request',
      startUrl: 'http://localhost:3001/requests',
      sequence,
    });

    if (!recorded.ok) throw new Error('the fixture recording should persist');

    const service = createSopCandidateService({ database: getDatabase().db });
    const result = await service.compileDocument({
      documentId: recorded.document.id,
      outcomeMapping: { completed: 'request_found' },
      agentId: 'agent_compiled',
      version: '0.1.0',
    });

    if (!result.ok) throw new Error(`expected a candidate: ${JSON.stringify(result)}`);

    return { service, candidate: result.candidate };
  }

  it('approves a candidate that could be checked', async () => {
    const { service, candidate } = await compiled();

    const approved = await service.approve(candidate.id, 'Checked the selectors by hand.');

    expect(approved.state).toBe('approved');
    expect(approved.reviewNote).toBe('Checked the selectors by hand.');
    expect(approved.reviewedAt).not.toBeNull();
  });

  it('refuses to approve a workflow that needs a secret Orbit cannot supply', async () => {
    // The fail-closed rule, at the layer that would otherwise let a candidate
    // through to publication. Nothing was tried, so nothing can be approved.
    const { service, candidate } = await compiled(SIGN_IN);

    expect(candidate.sandboxState).toBe('cannot_validate');
    expect(candidate.secretInputIds.length).toBeGreaterThan(0);
    expect(candidate.sandboxNote).toContain('opening a browser');

    await expect(service.approve(candidate.id)).rejects.toThrow(CandidateNotValidatedError);
  });

  it('lets a reviewer reject what nobody could check', async () => {
    // Rejection has no readiness precondition: refusing something unverifiable
    // is exactly what a reviewer should be able to do.
    const { service, candidate } = await compiled(SIGN_IN);

    const rejected = await service.reject(candidate.id, 'Needs credentials Orbit cannot hold.');

    expect(rejected.state).toBe('rejected');
  });

  it('refuses to approve a candidate twice', async () => {
    const { service, candidate } = await compiled();

    await service.approve(candidate.id);

    await expect(service.approve(candidate.id)).rejects.toThrow(/only allowed from/);
  });
});
