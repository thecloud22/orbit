import type { SopDocumentId, SopRevisionId } from '@orbit/contracts';
import { createRepositories, stepChecksum } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import { buttonFingerprint } from '@orbit/execution-mapping/testing';
import { bindingTargets, type BindingBody, type SelectorChain } from '@orbit/execution-mapping';
import { escalationReviewGraph } from '@orbit/sop-graph/testing';
import type { SopGraph, SopStep } from '@orbit/sop-graph';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  approveBinding,
  assembleBinding,
  boundStepIds,
  createBinding,
  rejectBinding,
} from './binding-service';

/**
 * Turning a capture into a persisted binding.
 *
 * The capture engine is exercised against a real browser elsewhere; what is
 * proven here is the composition — that a binding is validated against the
 * graph it claims to bind to, that a step which cannot be automated is refused
 * in terms a person can act on, and that the checksum future sub-phases trust
 * is the one this task writes.
 */
const GRAPH: SopGraph = escalationReviewGraph();

function step(id: string): SopStep {
  const found = GRAPH.steps.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`The fixture has no step "${id}".`);
  }
  return found;
}

const SELECTORS = [
  { strategy: 'test_id', value: 'search-request-button' },
  { strategy: 'role_and_name', value: 'button', name: 'Search' },
] as SelectorChain;

function clickBody(): BindingBody {
  return { kind: 'click', target: { selectors: SELECTORS, fingerprint: buttonFingerprint() } };
}

describe('recording a binding', () => {
  const getDatabase = useTestDatabase();

  let documentId: SopDocumentId;
  let revisionId: SopRevisionId;

  beforeEach(async () => {
    const repositories = createRepositories(getDatabase().db);
    const document = await repositories.sopDocuments.create({
      title: 'Escalation review',
      sourceText: 'Sign in and review the escalation.',
    });
    const revision = await repositories.sopGraphRevisions.create({
      documentId: document.id,
      graph: GRAPH,
      provenance: { kind: 'authored' },
    });
    documentId = document.id;
    revisionId = revision.id;
  });

  function create(input: {
    step: SopStep;
    body: BindingBody;
    parentBindingId?: string;
    confirmedByDemonstration?: { reviewNote: string };
  }) {
    return createBinding({
      database: getDatabase().db,
      documentId,
      revisionId,
      graph: GRAPH,
      step: input.step,
      body: input.body,
      ...(input.parentBindingId === undefined
        ? {}
        : { parentBindingId: input.parentBindingId as never }),
      ...(input.confirmedByDemonstration === undefined
        ? {}
        : { confirmedByDemonstration: input.confirmedByDemonstration }),
    });
  }

  it('persists a confirmed capture as a draft binding', async () => {
    const result = await create({ step: step('sign_in'), body: clickBody() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.binding.state).toBe('draft');
    expect(result.binding.stepId).toBe('sign_in');
    expect(bindingTargets(result.binding.binding.body)[0]?.selectors.length).toBe(2);
  });

  it('records the checksum the compiler will later trust', async () => {
    const result = await create({ step: step('sign_in'), body: clickBody() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The one definition, imported from @orbit/db rather than recomputed here.
    // Sub-phase 2.5 imports the same function, so the two cannot drift.
    expect(result.binding.binding.stepSha256).toBe(stepChecksum(step('sign_in')));
  });

  it('records which revision was on screen when it was demonstrated', async () => {
    const result = await create({ step: step('sign_in'), body: clickBody() });
    expect(result.ok && result.binding.binding.capturedAgainstRevisionId).toBe(revisionId);
  });

  it('never records a scope, because nothing can need one yet', async () => {
    const result = await create({ step: step('sign_in'), body: clickBody() });
    expect(result.ok && bindingTargets(result.binding.binding.body)[0]?.scope).toBeUndefined();
  });

  it('refuses a manual_review step in terms a person can act on', async () => {
    const manual = GRAPH.steps.find((candidate) => candidate.kind === 'manual_review');
    expect(manual).toBeDefined();

    const result = await create({ step: manual!, body: clickBody() });

    expect(result.ok).toBe(false);
    // Refused before the schema gets a chance to reject it as a malformed
    // discriminated union, so the answer is a sentence rather than a parse error.
    expect(!result.ok && result.reason).toBe('not_bindable');

    const stored = await createRepositories(getDatabase().db).executionBindings.listByDocument(
      documentId,
    );
    expect(stored).toEqual([]);
  });

  it('refuses a fill bound to a value the workflow never declared', async () => {
    const result = await create({
      step: step('enter_request_number'),
      body: {
        kind: 'fill',
        target: { selectors: SELECTORS, fingerprint: buttonFingerprint() },
        valueSource: { kind: 'sop_variable', name: 'neverDeclared' },
      },
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason === 'invalid' && result.issues.map((i) => i.code)).toContain(
      'UNDECLARED_VARIABLE',
    );
  });

  it('accepts a fill that references a declared input', async () => {
    const result = await create({
      step: step('enter_request_number'),
      body: {
        kind: 'fill',
        target: { selectors: SELECTORS, fingerprint: buttonFingerprint() },
        valueSource: { kind: 'sop_variable', name: 'requestNumber' },
      },
    });

    expect(result.ok).toBe(true);
  });

  it('refuses a binding whose action does not match the step', async () => {
    const result = await create({ step: step('enter_request_number'), body: clickBody() });

    expect(!result.ok && result.reason === 'invalid' && result.issues.map((i) => i.code)).toContain(
      'STEP_KIND_MISMATCH',
    );
  });

  it('supersedes the binding it replaces when a step is re-recorded', async () => {
    const first = await create({ step: step('sign_in'), body: clickBody() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await create({
      step: step('sign_in'),
      body: clickBody(),
      parentBindingId: first.binding.id,
    });

    expect(second.ok && second.binding.bindingNumber).toBe(2);

    const parent = await createRepositories(getDatabase().db).executionBindings.findById(
      first.binding.id,
    );
    expect(parent?.state).toBe('superseded');
  });

  it('reports which steps already have a binding', async () => {
    await create({ step: step('sign_in'), body: clickBody() });

    const bound = await boundStepIds(getDatabase().db, documentId);

    expect(bound.has('sign_in')).toBe(true);
    expect(bound.has('open_portal')).toBe(false);
  });

  describe('reviewing a binding someone else demonstrated', () => {
    it('approves a draft binding, submitting it for review in the same call', async () => {
      const result = await create({ step: step('sign_in'), body: clickBody() });
      if (!result.ok) throw new Error('expected the fixture binding to be created');
      expect(result.binding.state).toBe('draft');

      const approved = await approveBinding(
        getDatabase().db,
        result.binding.id,
        'Confirmed against the real page.',
      );

      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      expect(approved.binding.state).toBe('approved');
      expect(approved.binding.reviewNote).toBe('Confirmed against the real page.');
    });

    it('rejects a draft binding the same way', async () => {
      const result = await create({ step: step('sign_in'), body: clickBody() });
      if (!result.ok) throw new Error('expected the fixture binding to be created');

      const rejected = await rejectBinding(
        getDatabase().db,
        result.binding.id,
        'This is the wrong element.',
      );

      expect(rejected.ok).toBe(true);
      if (!rejected.ok) return;
      expect(rejected.binding.state).toBe('rejected');
    });

    it('approves a binding already sitting in needs_review without re-submitting it', async () => {
      const result = await create({ step: step('sign_in'), body: clickBody() });
      if (!result.ok) throw new Error('expected the fixture binding to be created');
      await createRepositories(getDatabase().db).executionBindings.submitForReview(
        result.binding.id,
      );

      const approved = await approveBinding(getDatabase().db, result.binding.id);

      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      expect(approved.binding.state).toBe('approved');
    });

    it('refuses to approve a binding nobody may currently review', async () => {
      // Approved -> superseded is the only legal move left; approving again
      // is refused rather than silently repeated.
      const result = await create({
        step: step('sign_in'),
        body: clickBody(),
        confirmedByDemonstration: { reviewNote: 'Approved by demonstrating the step.' },
      });
      if (!result.ok) throw new Error('expected the fixture binding to be created');
      expect(result.binding.state).toBe('approved');

      const reviewed = await approveBinding(getDatabase().db, result.binding.id);

      expect(reviewed.ok).toBe(false);
      expect(reviewed.ok === false && reviewed.reason).toBe('illegal_transition');
      expect(
        reviewed.ok === false && reviewed.reason === 'illegal_transition' && reviewed.state,
      ).toBe('approved');
    });

    it('reports an unknown binding as missing rather than throwing', async () => {
      const reviewed = await approveBinding(
        getDatabase().db,
        'execbind_01hzz0000000000000000000' as never,
      );

      expect(reviewed.ok).toBe(false);
      expect(reviewed.ok === false && reviewed.reason).toBe('not_found');
    });
  });
});

describe('assembleBinding', () => {
  it('stamps the frozen schema version rather than inventing one', () => {
    const binding = assembleBinding({
      step: step('sign_in'),
      body: clickBody(),
      revisionId: 'soprev_x' as SopRevisionId,
    });

    // 0.2 since the decision body gained one element per branch (ADR-029).
    expect(binding.schemaVersion).toBe('0.2');
    expect(binding.stepId).toBe('sign_in');
  });
});

/**
 * A binding demonstrated against a real page, which lands approved.
 *
 * Not a bypass of the lifecycle but a drive through it: the repository refuses
 * draft -> approved, so a binding that reaches `approved` did so by being
 * created, submitted and approved — the same sequence `recording-service.ts`
 * performs for a whole recorded workflow, and for the same reason (ADR-027).
 */
describe('a binding confirmed by demonstration', () => {
  const getDatabase = useTestDatabase();

  let documentId: SopDocumentId;
  let revisionId: SopRevisionId;

  beforeEach(async () => {
    const repositories = createRepositories(getDatabase().db);
    const document = await repositories.sopDocuments.create({
      title: 'Escalation review',
      sourceText: 'Sign in and review the escalation.',
    });
    const revision = await repositories.sopGraphRevisions.create({
      documentId: document.id,
      graph: GRAPH,
      provenance: { kind: 'generated', model: 'fake', provider: 'test', promptVersion: 'v1' },
    });
    documentId = document.id;
    revisionId = revision.id;
  });

  function demonstrate(parentBindingId?: string) {
    return createBinding({
      database: getDatabase().db,
      documentId,
      revisionId,
      graph: GRAPH,
      step: step('sign_in'),
      body: clickBody(),
      ...(parentBindingId === undefined ? {} : { parentBindingId: parentBindingId as never }),
      confirmedByDemonstration: { reviewNote: 'Approved by demonstrating the step.' },
    });
  }

  it('lands approved, with the note saying how it was approved', async () => {
    const result = await demonstrate();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.binding.state).toBe('approved');
    expect(result.binding.reviewNote).toContain('demonstrating');
  });

  it('supersedes the binding it replaces when a step is bound again', async () => {
    const first = await demonstrate();
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await demonstrate(first.binding.id);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const repositories = createRepositories(getDatabase().db);
    const replaced = await repositories.executionBindings.findById(first.binding.id);
    const current = await repositories.executionBindings.findCurrent(documentId, 'sign_in');

    expect(replaced?.state).toBe('superseded');
    expect(current?.id).toBe(second.binding.id);
    expect(current?.state).toBe('approved');
  });

  it('writes nothing at all when the step cannot be bound', async () => {
    const manual = GRAPH.steps.find((candidate) => candidate.kind === 'manual_review');

    const result = await createBinding({
      database: getDatabase().db,
      documentId,
      revisionId,
      graph: GRAPH,
      step: manual!,
      body: clickBody(),
      confirmedByDemonstration: { reviewNote: 'Approved by demonstrating the step.' },
    });

    expect(result.ok).toBe(false);

    const stored = await createRepositories(getDatabase().db).executionBindings.listByDocument(
      documentId,
    );
    expect(stored).toHaveLength(0);
  });

  it('writes nothing when the binding does not validate against the graph', async () => {
    const result = await createBinding({
      database: getDatabase().db,
      documentId,
      revisionId,
      graph: GRAPH,
      step: step('enter_request_number'),
      body: {
        kind: 'fill',
        target: { selectors: SELECTORS, fingerprint: buttonFingerprint() },
        valueSource: { kind: 'sop_variable', name: 'nothingDeclaresThis' },
      },
      confirmedByDemonstration: { reviewNote: 'Approved by demonstrating the step.' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');

    const stored = await createRepositories(getDatabase().db).executionBindings.listByDocument(
      documentId,
    );
    expect(stored).toHaveLength(0);
  });
});
