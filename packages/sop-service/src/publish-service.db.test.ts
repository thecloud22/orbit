import type { AgentIr } from '@orbit/agent-ir';
import type { SopRevisionId } from '@orbit/contracts';
import { createRepositories, type OrbitDatabase } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import type { SelectorChain } from '@orbit/execution-mapping';
import { buttonFingerprint, fieldFingerprint } from '@orbit/execution-mapping/testing';
import type { RecordedEntry } from '@orbit/sop-recording';
import { describe, expect, it } from 'vitest';

import { createSopCandidateService } from './candidate-service';
import {
  assertOnlyPublicationFieldsChanged,
  createSopPublishService,
  nextVersionAfter,
  publishedDocumentFor,
  PublishTransformationError,
} from './publish-service';
import { createSopRecordingService } from './recording-service';
import { createSopRevisionService } from './revision-service';

/**
 * Publishing an approved candidate, against real persistence.
 *
 * The input is a genuine recording put through the real translation, the real
 * binding lifecycle and the real compiler, because publishing a hand-written
 * fixture would only prove that hand-written fixtures publish.
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

/** Moves a revision through its real lifecycle to `approved`, same as a reviewer would. */
async function approveRevision(database: OrbitDatabase, revisionId: SopRevisionId): Promise<void> {
  const revisions = createSopRevisionService({ database });
  const submitted = await revisions.transition({ revisionId, action: 'submit_for_review' });
  if (!submitted.ok) throw new Error(`could not submit for review: ${JSON.stringify(submitted)}`);

  const approved = await revisions.transition({ revisionId, action: 'approve' });
  if (!approved.ok) throw new Error(`could not approve the revision: ${JSON.stringify(approved)}`);
}

describe('publishing an approved candidate', () => {
  const getDatabase = useTestDatabase();

  async function approvedCandidate(database: OrbitDatabase = getDatabase().db) {
    const recorded = await createSopRecordingService({ database }).createFromRecording({
      title: 'Find a service request',
      startUrl: 'http://localhost:3001/requests',
      sequence: SEQUENCE,
    });

    if (!recorded.ok) throw new Error('the fixture recording should persist');
    await approveRevision(database, recorded.revision.id);

    const candidates = createSopCandidateService({ database });
    const compiled = await candidates.compileDocument({
      documentId: recorded.document.id,
      outcomeMapping: { completed: 'request_found' },
    });

    if (!compiled.ok) throw new Error(`expected a candidate: ${JSON.stringify(compiled)}`);

    const approvedCandidate = await candidates.approve(compiled.candidate.id, 'Checked by hand.');
    if (!approvedCandidate.ok) {
      throw new Error(`could not approve the candidate: ${JSON.stringify(approvedCandidate)}`);
    }

    return { recorded, candidateId: compiled.candidate.id, candidate: compiled.candidate };
  }

  it('mints a published, runnable Agent Version', async () => {
    const { candidateId } = await approvedCandidate();

    const result = await createSopPublishService({ database: getDatabase().db }).publish(
      candidateId,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Published in the document, because that is what the runtime reads, and in
    // the column, because that is what the agent list filters on.
    expect(result.agentVersion.agentIr.lifecycle.status).toBe('published');
    expect(result.agentVersion.lifecycleStatus).toBe('published');
    expect(result.agentVersion.publishedAt).not.toBeNull();
  });

  it('records which candidate it came from', async () => {
    const { candidateId } = await approvedCandidate();
    const result = await createSopPublishService({ database: getDatabase().db }).publish(
      candidateId,
    );
    if (!result.ok) throw new Error('expected a version');

    expect(result.agentVersion.publishedFromCandidateId).toBe(candidateId);
  });

  it('stays traceable back to the SOP revision through the candidate', async () => {
    const { recorded, candidateId } = await approvedCandidate();
    const result = await createSopPublishService({ database: getDatabase().db }).publish(
      candidateId,
    );
    if (!result.ok) throw new Error('expected a version');

    const repositories = createRepositories(getDatabase().db);
    const candidate = await repositories.agentIrCandidates.findById(
      result.agentVersion.publishedFromCandidateId!,
    );

    // version -> candidate -> revision -> document, with no step guessed.
    expect(candidate?.revisionId).toBe(recorded.revision.id);
    expect(candidate?.documentId).toBe(recorded.document.id);
  });

  it('differs from the approved candidate in exactly the publication fields', async () => {
    // The heart of what "traceable" means here: the published bytes can be
    // re-derived from the approved bytes, so nothing was smuggled in on the way.
    const { candidate, candidateId } = await approvedCandidate();
    const result = await createSopPublishService({ database: getDatabase().db }).publish(
      candidateId,
    );
    if (!result.ok) throw new Error('expected a version');

    expect(() =>
      assertOnlyPublicationFieldsChanged(candidate.agentIr, result.agentVersion.agentIr),
    ).not.toThrow();

    expect(result.agentVersion.agentIr.steps).toEqual(candidate.agentIr.steps);
    expect(result.agentVersion.agentIr.permissions).toEqual(candidate.agentIr.permissions);
  });

  it('leaves both checksums covering what they claim', async () => {
    const { candidateId } = await approvedCandidate();
    const result = await createSopPublishService({ database: getDatabase().db }).publish(
      candidateId,
    );
    if (!result.ok) throw new Error('expected a version');

    const repositories = createRepositories(getDatabase().db);

    // Each mapper re-parses and re-checksums on read and raises on a mismatch,
    // so reading both back is the assertion: the candidate's checksum still
    // covers the approved draft and the version's covers the executed document.
    await expect(repositories.agentIrCandidates.findById(candidateId)).resolves.not.toBeNull();
    await expect(
      repositories.agentVersions.findById(result.agentVersion.id),
    ).resolves.not.toBeNull();
  });

  it('appears in the published agent list, which knows nothing about candidates', async () => {
    const { candidateId } = await approvedCandidate();
    const result = await createSopPublishService({ database: getDatabase().db }).publish(
      candidateId,
    );
    if (!result.ok) throw new Error('expected a version');

    const listed = await createRepositories(getDatabase().db).agentVersions.listPublished();

    expect(listed.map((version) => version.id)).toContain(result.agentVersion.id);
  });
});

describe('refusals', () => {
  const getDatabase = useTestDatabase();

  it('refuses a candidate nobody approved', async () => {
    const database = getDatabase().db;
    const recorded = await createSopRecordingService({ database }).createFromRecording({
      title: 'Find a service request',
      startUrl: 'http://localhost:3001/requests',
      sequence: SEQUENCE,
    });
    if (!recorded.ok) throw new Error('the fixture recording should persist');
    await approveRevision(database, recorded.revision.id);

    const compiled = await createSopCandidateService({ database }).compileDocument({
      documentId: recorded.document.id,
      outcomeMapping: { completed: 'request_found' },
    });
    if (!compiled.ok) throw new Error('expected a candidate');

    const result = await createSopPublishService({ database }).publish(compiled.candidate.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_approved');
  });

  it('says plainly when there is no such candidate', async () => {
    const result = await createSopPublishService({ database: getDatabase().db }).publish(
      'aircand_missing' as never,
    );

    expect(result.ok ? null : result.reason).toBe('not_found');
  });

  it('refuses to publish the same candidate twice', async () => {
    // Two versions from one approval would read as two decisions where a
    // person made one.
    const database = getDatabase().db;
    const recorded = await createSopRecordingService({ database }).createFromRecording({
      title: 'Find a service request',
      startUrl: 'http://localhost:3001/requests',
      sequence: SEQUENCE,
    });
    if (!recorded.ok) throw new Error('the fixture recording should persist');
    await approveRevision(database, recorded.revision.id);

    const candidates = createSopCandidateService({ database });
    const compiled = await candidates.compileDocument({
      documentId: recorded.document.id,
      outcomeMapping: { completed: 'request_found' },
    });
    if (!compiled.ok) throw new Error('expected a candidate');

    const approvedCandidate = await candidates.approve(compiled.candidate.id);
    if (!approvedCandidate.ok) throw new Error('expected the candidate to approve');

    const publisher = createSopPublishService({ database });
    const first = await publisher.publish(compiled.candidate.id);
    const second = await publisher.publish(compiled.candidate.id);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok || !first.ok) return;
    expect(second.reason).toBe('already_published');
    if (second.reason !== 'already_published') return;
    expect(second.agentVersionId).toBe(first.agentVersion.id);
  });
});

describe('version allocation', () => {
  it('starts at 0.1.0 and increments per agent', () => {
    expect(nextVersionAfter([])).toBe('0.1.0');
    expect(nextVersionAfter(['0.1.0'])).toBe('0.1.1');
    expect(nextVersionAfter(['0.1.0', '0.1.1'])).toBe('0.1.2');
  });

  it('ignores versions it did not allocate rather than tripping over them', () => {
    // The seeded agent is 0.1.0 under a different agent id, but a hand-authored
    // version under the same one must not make allocation throw.
    expect(nextVersionAfter(['1.2.3', '0.1.0'])).toBe('0.1.1');
    expect(nextVersionAfter(['not-a-version'])).toBe('0.1.0');
  });
});

describe('the transformation guard', () => {
  const base: AgentIr = {
    schemaVersion: '0.1',
    id: 'agent_guard',
    version: '0.0.1',
    name: 'Guard',
    source: { sopId: 'sop_1', sopVersion: '1', sourceSopStepIds: ['a'] },
    lifecycle: { status: 'draft', trustTier: 'observe' },
    trigger: { type: 'watchtower_manual' },
    inputs: {},
    variables: {},
    outputs: {},
    permissions: { browser: { allowedDomains: ['localhost'], allowedActions: ['navigate'] } },
    steps: [
      {
        id: 'open',
        sourceSopStepIds: ['a'],
        type: 'browser.navigate',
        url: 'http://localhost:3001/',
      },
    ],
  } as unknown as AgentIr;

  it('accepts the transformation publishing actually performs', () => {
    expect(() =>
      assertOnlyPublicationFieldsChanged(base, publishedDocumentFor(base, '0.1.0')),
    ).not.toThrow();
  });

  it('catches a widened permission smuggled in alongside publication', () => {
    // The failure this exists for. A published version reaching a host the
    // approved candidate never declared would be a real escalation, and the
    // lifecycle change is exactly the moment something could ride along.
    const tampered = {
      ...publishedDocumentFor(base, '0.1.0'),
      permissions: {
        browser: { allowedDomains: ['localhost', 'evil.example'], allowedActions: ['navigate'] },
      },
    } as unknown as AgentIr;

    expect(() => assertOnlyPublicationFieldsChanged(base, tampered)).toThrow(
      PublishTransformationError,
    );
  });

  it('catches an added step', () => {
    const tampered = {
      ...publishedDocumentFor(base, '0.1.0'),
      steps: [
        ...base.steps,
        { id: 'extra', sourceSopStepIds: ['a'], type: 'browser.click', locator: {} },
      ],
    } as unknown as AgentIr;

    expect(() => assertOnlyPublicationFieldsChanged(base, tampered)).toThrow(
      PublishTransformationError,
    );
  });

  it('is not fooled by key order, which is serialisation rather than meaning', () => {
    // Rebuilt with its keys in a different order, so a naive string comparison
    // would report a difference where the document is the same.
    const published = publishedDocumentFor(base, '0.1.0');
    const reordered = Object.fromEntries(Object.entries(published).reverse()) as unknown as AgentIr;

    expect(() => assertOnlyPublicationFieldsChanged(base, reordered)).not.toThrow();
  });
});
