import { createRepositories, type OrbitDatabase } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import type { BindingBody, SelectorChain } from '@orbit/execution-mapping';
import { buttonFingerprint, fieldFingerprint } from '@orbit/execution-mapping/testing';
import { SOP_GRAPH_SCHEMA_VERSION, type SopGraph, type SopStep } from '@orbit/sop-graph';
import { describe, expect, it } from 'vitest';

import { createBinding } from '../binding/binding-service';
import { createSopCandidateService } from '../drafting/candidate-service';
import { createSopDiscardService } from '../drafting/discard-service';
import { createPublishBoundDocumentService } from './publish-bound-document-service';
import { createSopPublishService } from './publish-service';
import { createSopRevisionService } from '../revision/revision-service';

/**
 * The one-click path from a drafted, fully bound workflow to a running agent.
 *
 * The claim under test is the same one `publish-recording-service.db.test.ts`
 * makes for a recording: what the fast path produces must be indistinguishable
 * from clicking through revision-approve, compile, candidate-approve and
 * publish by hand. The difference is only what confirmed the workflow against
 * a real page — a recording all at once, or a binding session one step at a
 * time (ADR-027).
 */
const FIELD = [{ strategy: 'test_id', value: 'request-number-input' }] as SelectorChain;
const BUTTON = [
  { strategy: 'test_id', value: 'search-request-button' },
  { strategy: 'role_and_name', value: 'button', name: 'Search' },
] as SelectorChain;
const RESULT = [{ strategy: 'test_id', value: 'request-status' }] as SelectorChain;

/** A drafted workflow with no branching, so the compiler can accept it. */
function draftedGraph(): SopGraph {
  return {
    schemaVersion: SOP_GRAPH_SCHEMA_VERSION,
    title: 'Find a service request',
    entryStepId: 'open_portal',
    inputs: [
      {
        id: 'requestNumber',
        label: 'Request number',
        type: 'string',
        required: true,
        minLength: 1,
      },
    ],
    outputs: [{ name: 'requestStatus', label: 'Status' }],
    steps: [
      {
        id: 'open_portal',
        kind: 'navigate',
        urlHint: 'http://localhost:3001/requests',
        purpose: 'Open the service request portal',
      },
      {
        id: 'enter_request_number',
        kind: 'fill',
        fieldHint: 'Request number',
        value: '${inputs.requestNumber}',
        purpose: 'Provide the request number',
      },
      { id: 'search', kind: 'click', targetHint: 'Search', purpose: 'Run the search' },
      {
        id: 'read_status',
        kind: 'extract',
        fields: [{ name: 'requestStatus', labelHint: 'Status', required: true }],
        purpose: 'Read the current status',
      },
      { id: 'found', kind: 'outcome', outcome: 'completed', message: 'The request was found' },
    ],
    assumptions: [],
    clarificationQuestions: [],
    risks: [],
  };
}

const BODIES: Readonly<Record<string, BindingBody>> = {
  enter_request_number: {
    kind: 'fill',
    target: { selectors: FIELD, fingerprint: fieldFingerprint() },
    valueSource: { kind: 'sop_variable', name: 'requestNumber' },
  },
  search: { kind: 'click', target: { selectors: BUTTON, fingerprint: buttonFingerprint() } },
  read_status: {
    kind: 'extract',
    target: { selectors: RESULT, fingerprint: fieldFingerprint() },
    readMethod: { kind: 'text' },
    variable: 'requestStatus',
  },
};

describe('publishing a fully bound drafted workflow in one action', () => {
  const getDatabase = useTestDatabase();

  function service(database: OrbitDatabase = getDatabase().db) {
    return createPublishBoundDocumentService({ database });
  }

  /** A drafted document, with a binding for each named step, approved as demonstrated. */
  async function draftedDocument(boundStepIds: readonly string[]) {
    const database = getDatabase().db;
    const repositories = createRepositories(database);
    const graph = draftedGraph();

    const document = await repositories.sopDocuments.create({
      title: graph.title,
      sourceText: 'Search the portal for a service request and read its status.',
    });

    const revision = await repositories.sopGraphRevisions.create({
      documentId: document.id,
      graph,
      provenance: { kind: 'generated', model: 'fake', provider: 'test', promptVersion: 'v1' },
    });

    for (const stepId of boundStepIds) {
      const step = graph.steps.find((candidate) => candidate.id === stepId) as SopStep;
      const body = BODIES[stepId];

      if (body === undefined) {
        throw new Error(`the fixture has no binding for "${stepId}"`);
      }

      const created = await createBinding({
        database,
        documentId: document.id,
        revisionId: revision.id,
        graph,
        step,
        body,
        confirmedByDemonstration: { reviewNote: 'Approved by demonstrating the step.' },
      });

      if (!created.ok) {
        throw new Error(`the fixture binding should persist: ${JSON.stringify(created)}`);
      }
    }

    return { document, revision, graph };
  }

  const ALL_BOUND = ['enter_request_number', 'search', 'read_status'];

  it('goes from a drafted, fully bound workflow to a published agent in one call', async () => {
    const drafted = await draftedDocument(ALL_BOUND);

    const result = await service().publish(drafted.document.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agentVersion.lifecycleStatus).toBe('published');
  });

  it('cannot be discarded once it is running, and the refusal names the version', async () => {
    // The rule lives in the discard service and is tested here, where a
    // genuinely published document already exists. Faking one would test the
    // fake: the whole point is that a *live* agent's source cannot vanish.
    const drafted = await draftedDocument(ALL_BOUND);
    const published = await service().publish(drafted.document.id);
    expect(published.ok).toBe(true);

    const discarded = await createSopDiscardService({ database: getDatabase().db }).discard(
      drafted.document.id,
    );

    expect(discarded.ok).toBe(false);
    if (discarded.ok || discarded.reason !== 'published') return;

    expect(discarded.reason).toBe('published');
    expect(discarded.agentVersion).toBe('0.1.0');

    // And it is still listed, because refusing has to mean nothing happened.
    const listed = await createRepositories(getDatabase().db).sopDocuments.list();
    expect(listed.map((document) => document.id)).toContain(drafted.document.id);
  });

  it('still refuses to discard when a newer candidate has not published', async () => {
    // The gap this closes. Compilation supersedes the previous candidate before
    // the new one is approved, so a second publish attempt that fails leaves a
    // current candidate with no version while the *earlier* version is still
    // running. Reading only the current candidate reported this document as
    // unpublished, and discard removed the source of a live agent -- the one
    // thing the discard service says it must never do.
    const database = getDatabase().db;
    const drafted = await draftedDocument(ALL_BOUND);

    const published = await service().publish(drafted.document.id);
    expect(published.ok).toBe(true);

    // A second compile, left unapproved: the current candidate now carries no
    // published version, exactly as a failed publish attempt would leave it.
    const recompiled = await createSopCandidateService({ database }).compileDocument({
      documentId: drafted.document.id,
    });
    expect(recompiled.ok).toBe(true);

    const discarded = await createSopDiscardService({ database }).discard(drafted.document.id);

    expect(discarded.ok).toBe(false);
    if (discarded.ok || discarded.reason !== 'published') return;
    expect(discarded.agentVersion).toBe('0.1.0');

    const listed = await createRepositories(database).sopDocuments.list();
    expect(listed.map((document) => document.id)).toContain(drafted.document.id);
  });

  it('produces exactly what the manual, four-step path would have', async () => {
    const database = getDatabase().db;
    const manual = await draftedDocument(ALL_BOUND);

    const revisions = createSopRevisionService({ database });
    await revisions.transition({ revisionId: manual.revision.id, action: 'submit_for_review' });
    await revisions.transition({ revisionId: manual.revision.id, action: 'approve' });

    const candidates = createSopCandidateService({ database });
    const compiled = await candidates.compileDocument({
      documentId: manual.document.id,
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const approved = await candidates.approve(compiled.candidate.id);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const published = await createSopPublishService({ database }).publish(approved.candidate.id);
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    const fast = await draftedDocument(ALL_BOUND);
    const viaFastPath = await service().publish(fast.document.id);

    expect(viaFastPath.ok).toBe(true);
    if (!viaFastPath.ok) return;

    // A UX shortcut, not a second and looser way to compile a workflow.
    expect(viaFastPath.agentVersion.agentIr.steps).toEqual(published.agentVersion.agentIr.steps);
    expect(viaFastPath.agentVersion.agentIr.permissions).toEqual(
      published.agentVersion.agentIr.permissions,
    );
  });

  it('refuses a workflow with a step still unbound, and names it', async () => {
    const drafted = await draftedDocument(['enter_request_number', 'search']);

    const result = await service().publish(drafted.document.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_fully_bound');
    if (result.reason !== 'not_fully_bound') return;
    expect(result.unboundStepIds).toEqual(['read_status']);
  });

  it('leaves the revision untouched when it refuses for a missing binding', async () => {
    // The point of checking bindings first: a workflow that cannot compile must
    // not be walked through approval on the way to finding that out.
    const drafted = await draftedDocument(['enter_request_number']);

    await service().publish(drafted.document.id);

    const revision = await createRepositories(getDatabase().db).sopGraphRevisions.findCurrent(
      drafted.document.id,
    );

    expect(revision?.state).toBe('draft');
  });

  it('refuses a workflow whose approved binding has gone stale', async () => {
    const drafted = await draftedDocument(ALL_BOUND);
    const revisions = createSopRevisionService({ database: getDatabase().db });

    // Editing the step changes its checksum, so the binding recorded against
    // the old text is approved and no longer usable — different facts.
    const edited = await revisions.editStep({
      revisionId: drafted.revision.id,
      stepId: 'search',
      step: { id: 'search', kind: 'click', targetHint: 'Find', purpose: 'Run the search' },
    });

    expect(edited.ok).toBe(true);

    const result = await service().publish(drafted.document.id);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'not_fully_bound') return;
    expect(result.unboundStepIds).toContain('search');
  });

  it('is a not_found for a document that does not exist', async () => {
    const result = await service().publish('sopdoc_01hzz0000000000000000000' as never);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_found');
  });
});
