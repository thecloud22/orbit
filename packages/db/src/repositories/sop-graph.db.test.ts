import { newSopRevisionId } from '@orbit/contracts';
import { escalationReviewGraph, minimalGraph, cloneGraph } from '@orbit/sop-graph/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRepositories } from '../repositories';
import { SOP_REVISION_TRANSITIONS, SopGraphValidationError } from './sop-graph-revisions';
import { sopGraphRevisions, type SopRevisionState } from '../schema';
import { DatabaseIntegrityError } from '../errors';
import { useTestDatabase } from '../testing';

/**
 * SOP Graph persistence against a real database.
 *
 * The questions these tests exist to keep answerable are the ones Phase 2 is
 * built on: what did the user originally write, which revision was reviewed,
 * what was asked and answered, and which revision was approved.
 */
describe('SOP graph persistence', () => {
  const getDatabase = useTestDatabase();

  let repositories: ReturnType<typeof createRepositories>;

  beforeEach(() => {
    repositories = createRepositories(getDatabase().db);
  });

  async function newDocument(sourceText = 'Go to the portal and look up a request.') {
    return repositories.sopDocuments.create({ title: 'Escalation review', sourceText });
  }

  async function newRevision(
    documentId: Parameters<typeof repositories.sopGraphRevisions.create>[0]['documentId'],
  ) {
    return repositories.sopGraphRevisions.create({
      documentId,
      graph: escalationReviewGraph(),
      provenance: { kind: 'authored' },
    });
  }

  it('stores the original text and offers no way to change it', async () => {
    const document = await newDocument('The exact words the user typed.');

    const found = await repositories.sopDocuments.findById(document.id);

    expect(found?.sourceText).toBe('The exact words the user typed.');
    // The absence of an update path is the enforcement, so assert the surface.
    expect(Object.keys(repositories.sopDocuments)).not.toContain('updateSourceText');
    expect(Object.keys(repositories.sopDocuments)).not.toContain('update');
  });

  it('round-trips a full graph through JSONB without losing anything', async () => {
    const document = await newDocument();
    const revision = await newRevision(document.id);

    const found = await repositories.sopGraphRevisions.findById(revision.id);

    expect(found).not.toBeNull();
    expect(found?.graph).toEqual(escalationReviewGraph());
    expect(found?.revisionNumber).toBe(1);
    expect(found?.state).toBe('draft');
    expect(found?.graphSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(found?.parentRevisionId).toBeNull();
  });

  it('refuses to store a graph that does not validate', async () => {
    const document = await newDocument();
    const broken = cloneGraph(minimalGraph());
    broken.entryStepId = 'no_such_step';

    await expect(
      repositories.sopGraphRevisions.create({
        documentId: document.id,
        graph: broken,
        provenance: { kind: 'generated', model: 'fake', provider: 'test', promptVersion: 'v1' },
      }),
    ).rejects.toBeInstanceOf(SopGraphValidationError);

    expect(await repositories.sopGraphRevisions.listByDocument(document.id)).toHaveLength(0);
  });

  it('detects a graph altered outside Orbit', async () => {
    const document = await newDocument();
    const revision = await newRevision(document.id);

    const tampered = cloneGraph(escalationReviewGraph());
    tampered.title = 'Quietly renamed';

    await getDatabase()
      .db.update(sopGraphRevisions)
      .set({ graph: tampered })
      .where(eq(sopGraphRevisions.id, revision.id));

    await expect(repositories.sopGraphRevisions.findById(revision.id)).rejects.toBeInstanceOf(
      DatabaseIntegrityError,
    );
  });

  it('records provenance, including the fields a generated proposal will fill', async () => {
    const document = await newDocument();

    const revision = await repositories.sopGraphRevisions.create({
      documentId: document.id,
      graph: escalationReviewGraph(),
      provenance: {
        kind: 'generated',
        model: 'claude-opus-5',
        provider: 'anthropic',
        promptVersion: 'sop-v3',
        generatedAt: '2026-09-05T12:00:00.000Z',
      },
    });

    const found = await repositories.sopGraphRevisions.findById(revision.id);

    expect(found?.provenance).toEqual({
      kind: 'generated',
      model: 'claude-opus-5',
      provider: 'anthropic',
      promptVersion: 'sop-v3',
      generatedAt: '2026-09-05T12:00:00.000Z',
    });
  });

  it('makes the revision chain the edit history and supersedes the parent', async () => {
    const document = await newDocument();
    const first = await newRevision(document.id);

    const edited = cloneGraph(escalationReviewGraph());
    edited.title = 'Escalation review, clarified';

    const second = await repositories.sopGraphRevisions.create({
      documentId: document.id,
      graph: edited,
      provenance: { kind: 'edited', note: 'Answered the password-expiry question' },
      parentRevisionId: first.id,
    });

    expect(second.revisionNumber).toBe(2);
    expect(second.parentRevisionId).toBe(first.id);

    const parent = await repositories.sopGraphRevisions.findById(first.id);
    expect(parent?.state).toBe('superseded');
    expect(parent?.supersededByRevisionId).toBe(second.id);
    // The superseded revision still holds exactly what was reviewed, not the
    // edit that replaced it.
    expect(parent?.graph.title).toBe('Service request escalation review');
    expect(second.graph.title).toBe('Escalation review, clarified');

    const chain = await repositories.sopGraphRevisions.listByDocument(document.id);
    expect(chain.map((entry) => entry.revisionNumber)).toEqual([1, 2]);
  });

  it('reports the newest non-superseded revision as current', async () => {
    const document = await newDocument();
    const first = await newRevision(document.id);
    const second = await repositories.sopGraphRevisions.create({
      documentId: document.id,
      graph: escalationReviewGraph(),
      provenance: { kind: 'edited' },
      parentRevisionId: first.id,
    });

    const current = await repositories.sopGraphRevisions.findCurrent(document.id);
    expect(current?.id).toBe(second.id);

    const summary = await repositories.sopDocuments.summarize(document.id);
    expect(summary?.status).toBe('draft');
    expect(summary?.revisionCount).toBe(2);
  });

  it('persists clarification questions with their answers', async () => {
    const document = await newDocument();
    const revision = await newRevision(document.id);

    const questions = revision.graph.clarificationQuestions;
    expect(questions.length).toBeGreaterThan(0);

    await repositories.sopGraphRevisions.recordAnswer({
      revisionId: revision.id,
      questionId: questions[0]!.id,
      answer: 'A red banner reading "Your password has expired".',
    });

    const answers = await repositories.sopGraphRevisions.listAnswers(revision.id);

    expect(answers).toHaveLength(1);
    expect(answers[0]?.questionId).toBe(questions[0]!.id);
    expect(answers[0]?.answer).toContain('red banner');

    // The question text is still readable from the revision the reviewer saw.
    const asked = revision.graph.clarificationQuestions.find(
      (question) => question.id === answers[0]?.questionId,
    );
    expect(asked?.question).toContain('password-expired');
  });

  it('accepts one answer per question per revision', async () => {
    const document = await newDocument();
    const revision = await newRevision(document.id);
    const questionId = revision.graph.clarificationQuestions[0]!.id;

    await repositories.sopGraphRevisions.recordAnswer({
      revisionId: revision.id,
      questionId,
      answer: 'First answer',
    });

    // Changing an answer means a new revision, not a rewrite of this one.
    await expect(
      repositories.sopGraphRevisions.recordAnswer({
        revisionId: revision.id,
        questionId,
        answer: 'Second answer',
      }),
    ).rejects.toThrow();
  });

  describe('lifecycle', () => {
    it('follows the documented path to approval', async () => {
      const document = await newDocument();
      const revision = await newRevision(document.id);

      expect((await repositories.sopGraphRevisions.requestClarification(revision.id)).state).toBe(
        'needs_clarification',
      );
      expect((await repositories.sopGraphRevisions.submitForReview(revision.id)).state).toBe(
        'in_review',
      );

      const approved = await repositories.sopGraphRevisions.approve(revision.id, {
        reviewNote: 'Matches the intended process.',
      });

      expect(approved.state).toBe('approved');
      expect(approved.reviewedAt).not.toBeNull();
      expect(approved.reviewNote).toBe('Matches the intended process.');
    });

    it('allows review without clarification when nothing needs asking', async () => {
      const document = await newDocument();
      const revision = await newRevision(document.id);

      await repositories.sopGraphRevisions.submitForReview(revision.id);
      const rejected = await repositories.sopGraphRevisions.reject(revision.id, {
        reviewNote: 'The search step is wrong.',
      });

      expect(rejected.state).toBe('rejected');
      expect(rejected.reviewedAt).not.toBeNull();
    });

    it('refuses a transition the state machine does not allow', async () => {
      const document = await newDocument();
      const revision = await newRevision(document.id);

      // draft -> approved skips review entirely.
      await expect(repositories.sopGraphRevisions.approve(revision.id)).rejects.toThrow();

      await repositories.sopGraphRevisions.submitForReview(revision.id);
      await repositories.sopGraphRevisions.approve(revision.id);

      // An approved revision cannot be quietly re-reviewed or reversed.
      await expect(repositories.sopGraphRevisions.reject(revision.id)).rejects.toThrow();
      await expect(repositories.sopGraphRevisions.submitForReview(revision.id)).rejects.toThrow();
      await expect(
        repositories.sopGraphRevisions.requestClarification(revision.id),
      ).rejects.toThrow();
    });

    it('leaves a superseded revision terminal', async () => {
      const document = await newDocument();
      const first = await newRevision(document.id);
      await repositories.sopGraphRevisions.create({
        documentId: document.id,
        graph: escalationReviewGraph(),
        provenance: { kind: 'edited' },
        parentRevisionId: first.id,
      });

      for (const move of [
        () => repositories.sopGraphRevisions.submitForReview(first.id),
        () => repositories.sopGraphRevisions.approve(first.id),
        () => repositories.sopGraphRevisions.reject(first.id),
        () => repositories.sopGraphRevisions.requestClarification(first.id),
      ]) {
        await expect(move()).rejects.toThrow();
      }

      expect(SOP_REVISION_TRANSITIONS.superseded).toEqual([]);
    });

    it('raises rather than inventing a revision that does not exist', async () => {
      await expect(
        repositories.sopGraphRevisions.submitForReview(newSopRevisionId()),
      ).rejects.toThrow();
    });

    it('covers every declared state in the transition table', () => {
      const declared: readonly SopRevisionState[] = [
        'draft',
        'needs_clarification',
        'in_review',
        'approved',
        'rejected',
        'superseded',
      ];

      expect(Object.keys(SOP_REVISION_TRANSITIONS).sort()).toEqual([...declared].sort());
    });
  });

  it('keeps SOP data entirely separate from Phase 1 agent and run tables', async () => {
    const document = await newDocument();
    await newRevision(document.id);

    // Nothing an SOP graph does creates an agent version or a run. Phase 2.1
    // draws no line from an approved graph to anything executable, and this is
    // the assertion that would fail first if one appeared.
    expect(await repositories.agentVersions.listPublished()).toHaveLength(0);
    expect(await repositories.agents.list()).toHaveLength(0);
  });
});

describe('summarizing a document', () => {
  const getDatabase = useTestDatabase();

  it("reports the current revision's step count, not the first one's", async () => {
    const repositories = createRepositories(getDatabase().db);
    const document = await repositories.sopDocuments.create({
      title: 'Escalation review',
      sourceText: 'Sign in and review the escalation.',
    });

    const first = await repositories.sopGraphRevisions.create({
      documentId: document.id,
      graph: minimalGraph(),
      provenance: { kind: 'authored' },
    });

    const summaryAfterFirst = await repositories.sopDocuments.summarize(document.id);
    expect(summaryAfterFirst?.stepCount).toBe(minimalGraph().steps.length);

    // A bigger graph supersedes the small one; the summary must follow the live
    // revision rather than whichever came first.
    await repositories.sopGraphRevisions.create({
      documentId: document.id,
      graph: escalationReviewGraph(),
      provenance: { kind: 'edited', note: 'Expanded.' },
      parentRevisionId: first.id,
    });

    const summary = await repositories.sopDocuments.summarize(document.id);

    expect(summary?.stepCount).toBe(escalationReviewGraph().steps.length);
    expect(summary?.revisionCount).toBe(2);
    expect(summary?.status).toBe('draft');
  });

  it('reports no steps for a document with no revision yet', async () => {
    const repositories = createRepositories(getDatabase().db);
    const document = await repositories.sopDocuments.create({
      title: 'Nothing drafted yet',
      sourceText: 'Written, not yet drafted.',
    });

    const summary = await repositories.sopDocuments.summarize(document.id);

    expect(summary?.stepCount).toBe(0);
    expect(summary?.status).toBeNull();
    expect(summary?.revisionCount).toBe(0);
  });
});
