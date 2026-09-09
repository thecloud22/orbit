import type { SopRevisionId } from '@orbit/contracts';
import { createRepositories, type OrbitDatabase } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import type { SelectorChain } from '@orbit/execution-mapping';
import { buttonFingerprint, fieldFingerprint } from '@orbit/execution-mapping/testing';
import type { RecordedEntry } from '@orbit/sop-recording';
import { describe, expect, it } from 'vitest';

import { createSopCandidateService } from './candidate-service';
import { createSopRecordingService } from './recording-service';
import { createSopRevisionService } from './revision-service';

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

/**
 * Moves a revision through its real lifecycle to `approved`.
 *
 * Not a shortcut into the state: `draft -> in_review -> approved` is exactly
 * what a reviewer clicking through Watchtower would do, driven through the
 * same service that page calls. A test that wrote `approved` directly into the
 * row would prove nothing about the precondition it exists to exercise.
 */
async function approveRevision(database: OrbitDatabase, revisionId: SopRevisionId): Promise<void> {
  const revisions = createSopRevisionService({ database });
  const submitted = await revisions.transition({ revisionId, action: 'submit_for_review' });
  if (!submitted.ok) throw new Error(`could not submit for review: ${JSON.stringify(submitted)}`);

  const approved = await revisions.transition({ revisionId, action: 'approve' });
  if (!approved.ok) throw new Error(`could not approve the revision: ${JSON.stringify(approved)}`);
}

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
    await approveRevision(getDatabase().db, recorded.revision.id);

    const result = await service().compileDocument({
      documentId: recorded.document.id,
    });

    return { recorded, result };
  }

  it('compiles a recorded, approved workflow and stores the candidate', async () => {
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

  it('refuses to compile a revision nobody has approved', async () => {
    // This is the precondition sub-phase 2.5 left out: findCurrent returns the
    // newest revision in any state short of superseded, so without this check
    // a draft or in-review graph could become a candidate — the SOP review
    // lifecycle (ADR-017) bypassed by the one caller positioned to bypass it.
    const recorded = await recordDocument();

    const stillDraft = await service().compileDocument({
      documentId: recorded.document.id,
    });

    expect(stillDraft.ok).toBe(false);
    if (stillDraft.ok) return;
    expect(stillDraft.reason).toBe('revision_not_approved');
    expect(stillDraft.reason === 'revision_not_approved' && stillDraft.state).toBe('draft');

    // In review is not approved either — there is exactly one state this
    // accepts.
    const revisions = createSopRevisionService({ database: getDatabase().db });
    const submitted = await revisions.transition({
      revisionId: recorded.revision.id,
      action: 'submit_for_review',
    });
    if (!submitted.ok) throw new Error('expected the submission to succeed');

    const inReview = await service().compileDocument({
      documentId: recorded.document.id,
    });

    expect(inReview.ok).toBe(false);
    if (inReview.ok) return;
    expect(inReview.reason).toBe('revision_not_approved');
    expect(inReview.reason === 'revision_not_approved' && inReview.state).toBe('in_review');
  });

  it('derives a stable agent identity from the document, not from the call', async () => {
    // Recompiling the same document must land under the same agent, or
    // publish-service's per-agent version numbering would fragment across what
    // a reviewer experiences as one workflow.
    const { recorded, result } = await compile();
    if (!result.ok) throw new Error('expected a candidate');

    const second = await service().compileDocument({
      documentId: recorded.document.id,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.candidate.agentIr.id).toBe(result.candidate.agentIr.id);
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

    // `none` is reserved for a run that has reached no business conclusion
    // (ADR-030), so a workflow cannot declare it as an outcome. Renaming the
    // recorder's appended outcome to it is an ordinary mistake a person could
    // make in the step editor, not a fault in the system.
    const outcome = recorded.revision.graph.steps.find((step) => step.kind === 'outcome');
    if (outcome === undefined || outcome.kind !== 'outcome') {
      throw new Error('the recording should append an outcome step');
    }

    const edited = await createSopRevisionService({ database: getDatabase().db }).editStep({
      revisionId: recorded.revision.id,
      stepId: outcome.id,
      step: { ...outcome, outcome: 'none' },
    });
    if (!edited.ok) throw new Error(`the edit should be accepted: ${JSON.stringify(edited)}`);

    await approveRevision(getDatabase().db, edited.revision.id);

    const result = await service().compileDocument({ documentId: recorded.document.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('refused');
    if (result.reason !== 'refused') return;
    expect(result.refusals.map((entry) => entry.code)).toEqual(['unusable_outcome_name']);
  });

  it('says plainly when there is no such document', async () => {
    const result = await service().compileDocument({
      documentId: 'sopdoc_missing' as never,
    });

    expect(result.ok ? null : result.reason).toBe('not_found');
  });
});

describe('the separate technical approval', () => {
  const getDatabase = useTestDatabase();

  async function compiled(sequence: readonly RecordedEntry[] = SEQUENCE) {
    const database = getDatabase().db;
    const recorded = await createSopRecordingService({ database }).createFromRecording({
      title: 'Find a service request',
      startUrl: 'http://localhost:3001/requests',
      sequence,
    });

    if (!recorded.ok) throw new Error('the fixture recording should persist');
    await approveRevision(database, recorded.revision.id);

    const service = createSopCandidateService({ database });
    const result = await service.compileDocument({
      documentId: recorded.document.id,
    });

    if (!result.ok) throw new Error(`expected a candidate: ${JSON.stringify(result)}`);

    return { service, candidate: result.candidate };
  }

  it('approves a candidate that could be checked', async () => {
    const { service, candidate } = await compiled();

    const approved = await service.approve(candidate.id, 'Checked the selectors by hand.');

    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.candidate.state).toBe('approved');
    expect(approved.candidate.reviewNote).toBe('Checked the selectors by hand.');
    expect(approved.candidate.reviewedAt).not.toBeNull();
  });

  it('refuses to approve a workflow that needs a secret Orbit cannot supply', async () => {
    // The fail-closed rule, at the layer that would otherwise let a candidate
    // through to publication. Nothing was tried, so nothing can be approved.
    const { service, candidate } = await compiled(SIGN_IN);

    expect(candidate.sandboxState).toBe('cannot_validate');
    expect(candidate.secretInputIds.length).toBeGreaterThan(0);
    expect(candidate.sandboxNote).toContain('opening a browser');

    const result = await service.approve(candidate.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_ready');
    expect(result.reason === 'not_ready' && result.sandboxState).toBe('cannot_validate');
  });

  it('carries the specific refusal through to what the review page reads', async () => {
    // The gap this closes: assessSandboxReadiness computes exactly which
    // input blocks validation, and it used to stop at the candidate row --
    // PublicationStatus (what SopReviewPage actually reads) had no field for
    // it, so a reviewer only ever saw the generic "needs a sign-in" fact
    // regardless of which secret it was.
    const { candidate } = await compiled(SIGN_IN);

    const review = await createSopRevisionService({ database: getDatabase().db }).reviewDocument(
      candidate.documentId,
    );

    expect(review.ok).toBe(true);
    if (!review.ok) return;

    expect(review.review.publication.sandboxState).toBe('cannot_validate');
    expect(review.review.publication.sandboxNote).toBe(candidate.sandboxNote);
  });

  it('lets a reviewer reject what nobody could check', async () => {
    // Rejection has no readiness precondition: refusing something unverifiable
    // is exactly what a reviewer should be able to do.
    const { service, candidate } = await compiled(SIGN_IN);

    const rejected = await service.reject(candidate.id, 'Needs credentials Orbit cannot hold.');

    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.candidate.state).toBe('rejected');
  });

  it('refuses to approve a candidate twice', async () => {
    const { service, candidate } = await compiled();

    const first = await service.approve(candidate.id);
    expect(first.ok).toBe(true);

    const second = await service.approve(candidate.id);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('illegal_transition');
    expect(second.reason === 'illegal_transition' && second.state).toBe('approved');
  });

  it('says plainly when there is no such candidate to approve', async () => {
    const service = createSopCandidateService({ database: getDatabase().db });
    const result = await service.approve('aircand_missing' as never);

    expect(result.ok ? null : result.reason).toBe('not_found');
  });

  it('refuses to reject a candidate that is already approved', async () => {
    const { service, candidate } = await compiled();
    await service.approve(candidate.id);

    const result = await service.reject(candidate.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('illegal_transition');
  });
});
