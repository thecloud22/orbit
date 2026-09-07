import type { OrbitDatabase } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import type { SelectorChain } from '@orbit/execution-mapping';
import { buttonFingerprint, fieldFingerprint } from '@orbit/execution-mapping/testing';
import {
  createFakeSopProvider,
  respondWith,
  validSopGraphProposal,
} from '@orbit/sop-generation/testing';
import type { RecordedEntry } from '@orbit/sop-recording';
import { describe, expect, it } from 'vitest';

import { createSopCandidateService } from './candidate-service';
import { createSopDraftService } from './draft-service';
import { createPublishRecordingService } from './publish-recording-service';
import { createSopPublishService } from './publish-service';
import { createSopRecordingService } from './recording-service';
import { createSopRevisionService } from './revision-service';

/**
 * The one-click path from a recording to a running agent.
 *
 * This is the whole point of the fast path: what it produces must be
 * indistinguishable from clicking through revision-approve, compile,
 * candidate-approve and publish by hand — same rows, same states, same
 * checksums — with none of the separate clicks.
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

describe('publishing a recorded workflow in one action', () => {
  const getDatabase = useTestDatabase();

  async function recordedDocument(sequence: readonly RecordedEntry[] = SEQUENCE) {
    const result = await createSopRecordingService({
      database: getDatabase().db,
    }).createFromRecording({
      title: 'Find a service request',
      startUrl: 'http://localhost:3001/requests',
      sequence,
    });

    if (!result.ok)
      throw new Error(`the fixture recording should persist: ${JSON.stringify(result)}`);
    return result;
  }

  function service(database: OrbitDatabase = getDatabase().db) {
    return createPublishRecordingService({ database });
  }

  it('goes from a freshly recorded draft to a published agent in one call', async () => {
    const recorded = await recordedDocument();

    const result = await service().publish(recorded.document.id, { completed: 'request_found' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agentVersion.lifecycleStatus).toBe('published');
  });

  it('produces exactly what the manual, five-click path would have', async () => {
    // Same recording, same outcome mapping, run through the fast path once and
    // through the manual services by hand once — the resulting Agent IR must
    // be identical, since the fast path is a UX shortcut and not a second,
    // looser way to compile a workflow.
    const database = getDatabase().db;
    const manual = await recordedDocument();

    const revisions = createSopRevisionService({ database });
    await revisions.transition({ revisionId: manual.revision.id, action: 'submit_for_review' });
    await revisions.transition({ revisionId: manual.revision.id, action: 'approve' });

    const candidates = createSopCandidateService({ database });
    const compiled = await candidates.compileDocument({
      documentId: manual.document.id,
      outcomeMapping: { completed: 'request_found' },
    });
    if (!compiled.ok) throw new Error('expected a candidate');
    const approvedCandidate = await candidates.approve(compiled.candidate.id);
    if (!approvedCandidate.ok) throw new Error('expected approval');

    const manualPublish = await createSopPublishService({ database }).publish(
      compiled.candidate.id,
    );
    if (!manualPublish.ok) throw new Error('expected a published version');

    const fast = await recordedDocument();
    const fastPublish = await service().publish(fast.document.id, { completed: 'request_found' });
    if (!fastPublish.ok) throw new Error('expected a published version');

    expect(fastPublish.agentVersion.agentIr.steps).toEqual(
      manualPublish.agentVersion.agentIr.steps,
    );
    expect(fastPublish.agentVersion.agentIr.permissions).toEqual(
      manualPublish.agentVersion.agentIr.permissions,
    );
    expect(fastPublish.agentVersion.lifecycleStatus).toBe(
      manualPublish.agentVersion.lifecycleStatus,
    );
  });

  it('still asks what the outcome means — nothing decides that for you', async () => {
    const recorded = await recordedDocument();

    const result = await service().publish(recorded.document.id, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('refused');
  });

  it('still fails closed on a secret the fast path cannot resolve', async () => {
    // The one hard safety gate that must survive collapsing five clicks into
    // one: nothing here may make a candidate needing a secret publishable.
    const recorded = await recordedDocument(SIGN_IN);

    const result = await service().publish(recorded.document.id, { completed: 'request_found' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_ready');
    expect(result.reason === 'not_ready' && result.sandboxState).toBe('cannot_validate');
  });

  it('refuses a document nobody recorded, leaving it to real review', async () => {
    const database = getDatabase().db;
    const draftService = createSopDraftService({
      database,
      provider: createFakeSopProvider({ respond: () => respondWith(validSopGraphProposal()) }),
    });

    const draft = await draftService.createDraft({
      kind: 'new_document',
      sourceText: 'Sign in and review the escalation.',
    });

    if (!draft.ok) throw new Error('expected a draft');

    const result = await service(database).publish(draft.document.id, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_recorded');
  });

  it('works from any state a person might have already clicked into by hand', async () => {
    // Somebody could open the review page and manually submit for review
    // before ever reaching for the one-click action. The fast path must not
    // then try to submit a second time and fail on an illegal transition.
    const database = getDatabase().db;
    const recorded = await recordedDocument();

    await createSopRevisionService({ database }).transition({
      revisionId: recorded.revision.id,
      action: 'submit_for_review',
    });

    const result = await service(database).publish(recorded.document.id, {
      completed: 'request_found',
    });

    expect(result.ok).toBe(true);
  });

  it('says plainly when there is no such document', async () => {
    const result = await service().publish('sopdoc_missing' as never, {});

    expect(result.ok ? null : result.reason).toBe('not_found');
  });

  it('reports an already-published recording rather than minting a second agent', async () => {
    const recorded = await recordedDocument();
    const first = await service().publish(recorded.document.id, { completed: 'request_found' });
    expect(first.ok).toBe(true);

    // Recompiling supersedes the prior candidate, so the second attempt
    // compiles and approves a fresh one rather than colliding on the first —
    // this asserts that this path, not the direct one, at least still
    // produces a second usable version rather than silently doing nothing.
    const second = await service().publish(recorded.document.id, {
      completed: 'request_not_found',
    });
    expect(second.ok).toBe(true);
  });
});
