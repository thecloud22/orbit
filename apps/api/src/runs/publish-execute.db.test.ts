import type { SopRevisionId } from '@orbit/contracts';
import { createRepositories, seedFindServiceRequest, type OrbitDatabase } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import type { SelectorChain } from '@orbit/execution-mapping';
import { buttonFingerprint, fieldFingerprint } from '@orbit/execution-mapping/testing';
import { assertNavigable, isRuntimeError, prepareExecution } from '@orbit/runtime';
import type { RecordedEntry } from '@orbit/sop-recording';
import {
  createSopCandidateService,
  createSopPublishService,
  createSopRecordingService,
  createSopRevisionService,
} from '@orbit/sop-service';
import { describe, expect, it } from 'vitest';

/**
 * A published agent goes through the runtime's own gate, not a new one.
 *
 * The claim 2.6 has to make good on is that publishing produces something the
 * *existing* runtime executes — the same path the seeded agent already uses.
 * This asserts it against `prepareExecution`, which is the single gate both the
 * API route and the CLI apply, so passing it here means passing it there.
 *
 * `apps/api` is where this lives because it is the one place that already
 * depends on both the runtime and the SOP services, which is exactly the
 * composition a real publish-then-run performs.
 */
const FIELD = [{ strategy: 'test_id', value: 'request-number-input' }] as SelectorChain;
const BUTTON = [
  { strategy: 'test_id', value: 'search-request-button' },
  { strategy: 'role_and_name', value: 'button', name: 'Search' },
] as SelectorChain;

function recordingAt(host: string): readonly RecordedEntry[] {
  return [
    { kind: 'navigate', url: `https://${host}/requests` },
    { kind: 'fill', selectors: FIELD, fingerprint: fieldFingerprint(), typedValue: 'SR-1001' },
    { kind: 'click', selectors: BUTTON, fingerprint: buttonFingerprint() },
  ];
}

/** Moves a revision through its real lifecycle to `approved`, same as a reviewer would. */
async function approveRevision(database: OrbitDatabase, revisionId: SopRevisionId): Promise<void> {
  const revisions = createSopRevisionService({ database });
  const submitted = await revisions.transition({ revisionId, action: 'submit_for_review' });
  if (!submitted.ok) throw new Error(`could not submit for review: ${JSON.stringify(submitted)}`);

  const approved = await revisions.transition({ revisionId, action: 'approve' });
  if (!approved.ok) throw new Error(`could not approve the revision: ${JSON.stringify(approved)}`);
}

describe('publishing produces something the existing runtime will execute', () => {
  const getDatabase = useTestDatabase();

  async function publish(host: string, database: OrbitDatabase = getDatabase().db) {
    const recorded = await createSopRecordingService({ database }).createFromRecording({
      title: 'Find a service request',
      startUrl: `https://${host}/requests`,
      sequence: recordingAt(host),
    });
    if (!recorded.ok) throw new Error('the fixture recording should persist');
    await approveRevision(database, recorded.revision.id);

    const candidates = createSopCandidateService({ database });
    const compiled = await candidates.compileDocument({ documentId: recorded.document.id });
    if (!compiled.ok) throw new Error(`expected a candidate: ${JSON.stringify(compiled)}`);

    const approvedCandidate = await candidates.approve(compiled.candidate.id);
    if (!approvedCandidate.ok) throw new Error('expected the candidate to approve');

    const result = await createSopPublishService({ database }).publish(compiled.candidate.id);
    if (!result.ok) throw new Error(`expected a version: ${JSON.stringify(result)}`);

    return { recorded, agentVersion: result.agentVersion };
  }

  it('passes prepareExecution, the same gate the seeded agent passes', async () => {
    const { agentVersion } = await publish('www.plano.gov');

    const prepared = prepareExecution({
      agentVersionId: agentVersion.id,
      agentIr: agentVersion.agentIr,
      rawInputs: {},
    });

    expect(prepared.agentIr.id).toBe(agentVersion.agentIr.id);
  });

  it('would be refused before publishing, because a compiled candidate is still a draft', async () => {
    // The other half of the same claim: the gate is real, and the lifecycle
    // change publishing performs is what gets a workflow through it. A
    // candidate — approved or not — carries lifecycle.status 'draft' until it
    // is published, and that is what the runtime actually refuses.
    const database = getDatabase().db;
    const recorded = await createSopRecordingService({ database }).createFromRecording({
      title: 'Find a service request',
      startUrl: 'https://www.plano.gov/requests',
      sequence: recordingAt('www.plano.gov'),
    });
    if (!recorded.ok) throw new Error('the fixture recording should persist');
    await approveRevision(database, recorded.revision.id);

    const compiled = await createSopCandidateService({ database }).compileDocument({
      documentId: recorded.document.id,
    });
    if (!compiled.ok) throw new Error('expected a candidate');
    expect(compiled.candidate.agentIr.lifecycle.status).toBe('draft');

    try {
      prepareExecution({
        agentVersionId: 'agentv_never' as never,
        agentIr: compiled.candidate.agentIr,
        rawInputs: {},
      });
      throw new Error('a draft candidate must not pass the runtime gate');
    } catch (error) {
      expect(isRuntimeError(error)).toBe(true);
      if (!isRuntimeError(error)) return;
      expect(error.details.some((detail) => detail.field === 'lifecycle.status')).toBe(true);
    }
  });
});

describe('containment survives publication (ADR-022)', () => {
  const getDatabase = useTestDatabase();

  it('permits the host the workflow was recorded against, and refuses its neighbour', async () => {
    const database = getDatabase().db;
    const recorded = await createSopRecordingService({ database }).createFromRecording({
      title: 'Find a service request',
      startUrl: 'https://www.plano.gov/requests',
      sequence: recordingAt('www.plano.gov'),
    });
    if (!recorded.ok) throw new Error('the fixture recording should persist');
    await approveRevision(database, recorded.revision.id);

    const candidates = createSopCandidateService({ database });
    const compiled = await candidates.compileDocument({ documentId: recorded.document.id });
    if (!compiled.ok) throw new Error('expected a candidate');

    const approvedCandidate = await candidates.approve(compiled.candidate.id);
    if (!approvedCandidate.ok) throw new Error('expected the candidate to approve');

    const result = await createSopPublishService({ database }).publish(compiled.candidate.id);
    if (!result.ok) throw new Error('expected a version');

    const allowed = result.agentVersion.agentIr.permissions.browser?.allowedDomains ?? [];

    // Derived from what was recorded, not from a shared list.
    expect(allowed).toEqual(['www.plano.gov']);

    expect(() => assertNavigable('https://www.plano.gov/requests', allowed, 'open')).not.toThrow();

    // Exact, not a domain suffix: a neighbouring host is a different system.
    expect(() => assertNavigable('https://internal.plano.gov/x', allowed, 'open')).toThrow();
    expect(() => assertNavigable('https://evil.example/x', allowed, 'open')).toThrow();
  });

  it('leaves the seeded Phase 1 agent exactly as it was', async () => {
    // Seeded here rather than assumed present: the tables are truncated between
    // tests, and a check that quietly skips when its subject is missing is not
    // a check. The seeded fixture predates candidates entirely, so publishing
    // must not have reached into it.
    const database = getDatabase().db;
    const seeded = await seedFindServiceRequest(database);

    expect(seeded.agentVersion.publishedFromCandidateId).toBeNull();
    expect(seeded.agentVersion.agentIr.permissions.browser?.allowedDomains).toEqual(['localhost']);

    // And it still reads back cleanly, so the new column did not disturb the
    // checksum over the immutable document (ADR-014).
    const record = await createRepositories(database).agentVersions.findById(
      seeded.agentVersion.id,
    );

    expect(record?.publishedFromCandidateId).toBeNull();
    expect(record?.irSha256).toBe(seeded.agentVersion.irSha256);
  });
});
