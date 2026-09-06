import { createRepositories, type OrbitDatabase } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import { buttonFingerprint, fieldFingerprint } from '@orbit/execution-mapping/testing';
import type { SelectorChain } from '@orbit/execution-mapping';
import type { RecordedEntry } from '@orbit/sop-recording';
import { describe, expect, it } from 'vitest';

import { createSopRecordingService } from './recording-service';

/**
 * A recording becoming a document, against real persistence.
 *
 * What matters here is that a recorded workflow is stored exactly like a
 * free-text one — same tables, same validation, same shape — so the review page
 * built in 2.3 needs no knowledge that recording exists.
 */
const BUTTON = [
  { strategy: 'test_id', value: 'search-request-button' },
  { strategy: 'role_and_name', value: 'button', name: 'Search' },
] as SelectorChain;

const FIELD = [{ strategy: 'test_id', value: 'request-number-input' }] as SelectorChain;

const SEQUENCE: readonly RecordedEntry[] = [
  { kind: 'navigate', url: 'http://localhost:3001/requests' },
  { kind: 'fill', selectors: FIELD, fingerprint: fieldFingerprint(), typedValue: 'SR-1001' },
  { kind: 'click', selectors: BUTTON, fingerprint: buttonFingerprint() },
];

describe('creating a document from a recording', () => {
  const getDatabase = useTestDatabase();

  function service(database: OrbitDatabase) {
    return createSopRecordingService({ database });
  }

  async function record(sequence: readonly RecordedEntry[] = SEQUENCE) {
    return service(getDatabase().db).createFromRecording({
      title: 'Find a service request',
      startUrl: 'http://localhost:3001/requests',
      sequence,
    });
  }

  it('stores the document, its first revision, and a binding per action', async () => {
    const result = await record();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.title).toBe('Find a service request');
    expect(result.revision.revisionNumber).toBe(1);
    expect(result.revision.graph.steps.map((step) => step.kind)).toEqual([
      'navigate',
      'fill',
      'click',
      'outcome',
    ]);

    // Two actions touch an element; the navigate and the outcome do not.
    expect(result.bindings).toHaveLength(2);
  });

  it('records where it came from, distinctly from an authored or generated one', async () => {
    const result = await record();
    if (!result.ok) return;

    expect(result.revision.provenance).toEqual({
      kind: 'recorded',
      recordedFromUrl: 'http://localhost:3001/requests',
      recordedActionCount: 3,
    });
  });

  it('leaves every binding approved, having been performed', async () => {
    const result = await record();
    if (!result.ok) return;

    for (const binding of result.bindings) {
      expect(binding.state).toBe('approved');
      expect(binding.reviewedAt).toBeInstanceOf(Date);
      expect(binding.reviewNote).toContain('performing the step during recording');
    }
  });

  it('drives the lifecycle rather than writing approved directly', async () => {
    const result = await record();
    if (!result.ok) return;

    // The repository refuses draft -> approved, so a binding reaching approved
    // is proof the intermediate transition happened.
    const stored = await createRepositories(getDatabase().db).executionBindings.listCurrent(
      result.document.id,
    );

    expect(stored.map((binding) => binding.state)).toEqual(['approved', 'approved']);
  });

  it('stores a recorded document exactly like any other, so review needs no special case', async () => {
    const result = await record();
    if (!result.ok) return;

    const repositories = createRepositories(getDatabase().db);
    const summary = await repositories.sopDocuments.summarize(result.document.id);
    const current = await repositories.sopGraphRevisions.findCurrent(result.document.id);

    // It appears in the 4d list and opens in the 2.3 review page with no
    // knowledge that recording exists.
    expect(summary?.status).toBe('draft');
    expect(summary?.stepCount).toBe(4);
    expect(current?.graph.title).toBe('Find a service request');
  });

  it('binds each step to the step it actually came from', async () => {
    const result = await record();
    if (!result.ok) return;

    const stepIds = result.revision.graph.steps.map((step) => step.id);

    for (const binding of result.bindings) {
      expect(stepIds).toContain(binding.stepId);
      expect(binding.binding.capturedAgainstRevisionId).toBe(result.revision.id);
    }
  });

  it('declares a secret input for a password field and stores no value for it', async () => {
    const result = await record([
      SEQUENCE[0]!,
      {
        kind: 'fill',
        selectors: FIELD,
        fingerprint: { ...fieldFingerprint(), accessibleName: 'Password' },
        sensitive: true,
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.revision.graph.inputs).toEqual([
      { id: 'password', label: 'Password', type: 'secret', required: true },
    ]);

    const fill = result.revision.graph.steps.find((step) => step.kind === 'fill');
    expect(fill?.kind === 'fill' && fill.value).toBe('${inputs.password}');
  });

  it('writes nothing at all when the recording cannot become a workflow', async () => {
    const result = await record([]);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.reason).toBe('invalid_recording');

    const documents = await createRepositories(getDatabase().db).sopDocuments.list();
    expect(documents).toEqual([]);
  });
});
