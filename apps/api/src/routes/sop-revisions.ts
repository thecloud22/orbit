import { sopDocumentIdSchema, sopRevisionIdSchema } from '@orbit/contracts';
import {
  identifierSchema,
  sopStepDraftSchema,
  sopStepSchema,
  type SopGraphIssue,
} from '@orbit/sop-graph';
import { SOP_REVISION_ACTIONS } from '@orbit/sop-service';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../context';
import { ApiError, badRequest, notFound } from '../errors';
import { toSopDocumentSummaryView, toSopReviewView } from '../projections';
import type { DataEnvelope, SopDocumentSummaryView, SopReviewView } from '../views';

/**
 * Reviewing, editing and deciding on a SOP Graph revision (sub-phase 2.3).
 *
 * Every rule these routes apply belongs to `@orbit/sop-service`; nothing here
 * decides whether an edit is valid, whether a move is legal, or which lifecycle
 * actions are available. The route's job is the wire contract.
 *
 * A step edited here can carry `urlHint` and `systemHint` values a person just
 * typed. They are validated for shape, stored, and returned as text — never
 * fetched, navigated, probed, or resolved (ADR-016).
 */

const editStepBodySchema = z.strictObject({
  step: sopStepSchema,
  note: z.string().trim().min(1).max(500).optional(),
});

/**
 * Declaring a new run input. String-only, matching `declareInput`'s own scope
 * note in @orbit/sop-service.
 */
const declareInputBodySchema = z.strictObject({
  id: identifierSchema,
  label: z.string().trim().min(1).max(200),
  required: z.boolean().default(true),
  note: z.string().trim().min(1).max(500).optional(),
});

/** Declaring a new run output, symmetric to `declareInputBodySchema`. */
const declareOutputBodySchema = z.strictObject({
  name: identifierSchema,
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500).optional(),
  note: z.string().trim().min(1).max(500).optional(),
});

/**
 * Adding a step. The body carries no id: one is generated (`generateStepId`),
 * because branches name their targets by it and the step editor refuses to
 * change one, so a name chosen badly here could not be undone.
 */
const insertStepBodySchema = z.strictObject({
  /** 0 puts the step first; `steps.length` puts it last. */
  index: z.number().int().nonnegative(),
  step: sopStepDraftSchema,
  note: z.string().trim().min(1).max(500).optional(),
});

/**
 * Revising a published workflow. Nothing but an optional note: what the new
 * revision contains is the current one's graph, copied (ADR-036).
 */
const reviseBodySchema = z.strictObject({
  note: z.string().trim().min(1).max(500).optional(),
});

const reorderBodySchema = z.strictObject({
  move: z.union([
    z.strictObject({ stepId: z.string().min(1), direction: z.enum(['up', 'down']) }),
    z.strictObject({ stepId: z.string().min(1), toIndex: z.number().int().nonnegative() }),
  ]),
  note: z.string().trim().min(1).max(500).optional(),
});

const answerBodySchema = z.strictObject({
  questionId: z.string().min(1),
  answer: z.string().trim().min(1).max(5000),
});

/**
 * The action vocabulary comes from the service, which derives it from
 * `SOP_REVISION_TRANSITIONS`. Writing the four names here would be the second
 * copy of the transition table the brief forbids.
 */
const transitionBodySchema = z.strictObject({
  action: z.enum(SOP_REVISION_ACTIONS),
  note: z.string().trim().min(1).max(2000).optional(),
});

function toIssueDetails(issues: readonly SopGraphIssue[]) {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : (issue.stepId ?? 'graph'),
    message: `[${issue.code}] ${issue.message}`,
  }));
}

/** 422: the request was well formed, but the resulting graph would not be valid. */
function unprocessable(message: string, details?: readonly { field: string; message: string }[]) {
  return new ApiError({
    code: 'VALIDATION_ERROR',
    statusCode: 422,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

/** 409: the write conflicts with one that already exists. */
function conflict(message: string) {
  return new ApiError({ code: 'VALIDATION_ERROR', statusCode: 409, message });
}

function parseParams<T extends z.ZodType>(schema: T, params: unknown, what: string): z.infer<T> {
  const parsed = schema.safeParse(params);

  if (!parsed.success) {
    throw badRequest(`The ${what} is not a valid Orbit identifier.`);
  }

  return parsed.data;
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, what: string): z.infer<T> {
  const parsed = schema.safeParse(body ?? {});

  if (!parsed.success) {
    throw badRequest(
      `The request body is not a valid ${what}.`,
      parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    );
  }

  return parsed.data;
}

export function registerSopRevisionRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/sop-documents', async () => {
    const documents = await context.repositories.sopDocuments.list();

    const summaries = await Promise.all(
      documents.map((document) => context.repositories.sopDocuments.summarize(document.id)),
    );

    const data: readonly SopDocumentSummaryView[] = summaries
      .filter((summary) => summary !== null)
      .map(toSopDocumentSummaryView);

    return { data };
  });

  app.get<{ Params: { documentId: string } }>('/v1/sop-documents/:documentId', async (request) => {
    const { documentId } = parseParams(
      z.object({ documentId: sopDocumentIdSchema }),
      request.params,
      'document id',
    );

    const result = await context.sopRevisionService.reviewDocument(documentId);

    if (!result.ok) {
      throw notFound(`SOP document "${documentId}" does not exist.`);
    }

    const payload: DataEnvelope<SopReviewView> = { data: toSopReviewView(result.review) };
    return payload;
  });

  /**
   * A new editable revision of a workflow that has stopped being editable.
   *
   * Under the document rather than under the revision, because the caller is
   * asking for the *next* revision of this workflow and does not need to know —
   * or race against — which one is current. Publishing again afterwards mints
   * the next version under the same agent (ADR-023/ADR-024); nothing here
   * touches the version that is running.
   */
  app.post<{ Params: { documentId: string } }>(
    '/v1/sop-documents/:documentId/revisions',
    async (request, reply) => {
      const { documentId } = parseParams(
        z.object({ documentId: sopDocumentIdSchema }),
        request.params,
        'document id',
      );
      const body = parseBody(reviseBodySchema, request.body, 'revision request');

      const result = await context.sopRevisionService.reviseDocument({
        documentId,
        ...(body.note === undefined ? {} : { note: body.note }),
      });

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound(`SOP document "${documentId}" does not exist.`);
          case 'already_editable':
            throw conflict(
              `This workflow is already "${result.state}" and can be edited as it stands, so there is nothing to revise.`,
            );
        }
      }

      const payload: DataEnvelope<{
        revisionId: string;
        revisionNumber: number;
        state: string;
      }> = {
        data: {
          revisionId: result.revision.id,
          revisionNumber: result.revision.revisionNumber,
          state: result.revision.state,
        },
      };

      return reply.code(201).send(payload);
    },
  );

  app.get<{ Params: { revisionId: string } }>('/v1/sop-revisions/:revisionId', async (request) => {
    const { revisionId } = parseParams(
      z.object({ revisionId: sopRevisionIdSchema }),
      request.params,
      'revision id',
    );

    const result = await context.sopRevisionService.reviewRevision(revisionId);

    if (!result.ok) {
      throw notFound(`SOP revision "${revisionId}" does not exist.`);
    }

    const payload: DataEnvelope<SopReviewView> = { data: toSopReviewView(result.review) };
    return payload;
  });

  app.patch<{ Params: { revisionId: string; stepId: string } }>(
    '/v1/sop-revisions/:revisionId/steps/:stepId',
    async (request, reply) => {
      const { revisionId } = parseParams(
        z.object({ revisionId: sopRevisionIdSchema, stepId: z.string().min(1) }),
        request.params,
        'revision id',
      );
      const stepId = (request.params as { stepId: string }).stepId;
      const body = parseBody(editStepBodySchema, request.body, 'step edit');

      const result = await context.sopRevisionService.editStep({
        revisionId,
        stepId,
        step: body.step,
        ...(body.note === undefined ? {} : { note: body.note }),
      });

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound(`SOP revision "${revisionId}" does not exist.`);
          case 'not_editable':
            throw conflict(
              `This revision is "${result.state}" and can no longer be edited. Send it back for clarification first.`,
            );
          case 'unknown_step':
            throw notFound(`Step "${result.stepId}" is not part of this workflow.`);
          case 'step_id_immutable':
            throw badRequest('A step id cannot be changed from the step editor.');
          case 'invalid_graph':
            throw unprocessable(
              'That edit would make the workflow invalid, so it was not saved.',
              toIssueDetails(result.issues),
            );
        }
      }

      const payload: DataEnvelope<{ revisionId: string; revisionNumber: number }> = {
        data: { revisionId: result.revision.id, revisionNumber: result.revision.revisionNumber },
      };

      return reply.code(201).send(payload);
    },
  );

  app.post<{ Params: { revisionId: string } }>(
    '/v1/sop-revisions/:revisionId/steps',
    async (request, reply) => {
      const { revisionId } = parseParams(
        z.object({ revisionId: sopRevisionIdSchema }),
        request.params,
        'revision id',
      );
      const body = parseBody(insertStepBodySchema, request.body, 'new step');

      const result = await context.sopRevisionService.insertStep({
        revisionId,
        index: body.index,
        step: body.step,
        ...(body.note === undefined ? {} : { note: body.note }),
      });

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound(`SOP revision "${revisionId}" does not exist.`);
          case 'not_editable':
            throw conflict(
              `This revision is "${result.state}" and can no longer be edited. Send it back for clarification first.`,
            );
          case 'out_of_range':
            throw badRequest(result.explanation);
          case 'invalid_graph':
            throw unprocessable(
              'Adding that step would make the workflow invalid, so it was not saved.',
              toIssueDetails(result.issues),
            );
        }
      }

      const payload: DataEnvelope<{
        revisionId: string;
        revisionNumber: number;
        stepId: string;
      }> = {
        data: {
          revisionId: result.revision.id,
          revisionNumber: result.revision.revisionNumber,
          stepId: result.stepId,
        },
      };

      return reply.code(201).send(payload);
    },
  );

  /**
   * Declaring a new run input, as a new revision.
   *
   * The other half of an interpolation reference: `${inputs.x}` is refused by
   * the step editor unless `x` is declared, and until this route existed there
   * was no way to declare one on a workflow that did not come from the
   * drafting flow -- including every recorded workflow, whose captured values
   * arrive as literals with nothing to parameterize them.
   */
  app.post<{ Params: { revisionId: string } }>(
    '/v1/sop-revisions/:revisionId/inputs',
    async (request, reply) => {
      const { revisionId } = parseParams(
        z.object({ revisionId: sopRevisionIdSchema }),
        request.params,
        'revision id',
      );
      const body = parseBody(declareInputBodySchema, request.body, 'input declaration');

      const result = await context.sopRevisionService.declareInput({
        revisionId,
        id: body.id,
        label: body.label,
        required: body.required,
        ...(body.note === undefined ? {} : { note: body.note }),
      });

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound(`SOP revision "${revisionId}" does not exist.`);
          case 'not_editable':
            throw conflict(
              `This revision is "${result.state}" and can no longer be edited. Send it back for clarification first.`,
            );
          case 'duplicate_input':
            throw conflict(`"${result.inputId}" is already declared on this workflow.`);
          case 'invalid_graph':
            throw unprocessable(
              'That declaration would make the workflow invalid, so it was not saved.',
              toIssueDetails(result.issues),
            );
        }
      }

      const payload: DataEnvelope<{ revisionId: string; revisionNumber: number }> = {
        data: { revisionId: result.revision.id, revisionNumber: result.revision.revisionNumber },
      };

      return reply.code(201).send(payload);
    },
  );

  /**
   * Declaring a new run output, as a new revision. Symmetric to declaring an
   * input: an outcome step's `returns` names a variable a step produces, but
   * the compiler also requires that name in the graph's own `outputs`
   * declaration (it becomes `agentIr.outputs`), and until this route existed
   * there was no way to add one after the fact.
   */
  app.post<{ Params: { revisionId: string } }>(
    '/v1/sop-revisions/:revisionId/outputs',
    async (request, reply) => {
      const { revisionId } = parseParams(
        z.object({ revisionId: sopRevisionIdSchema }),
        request.params,
        'revision id',
      );
      const body = parseBody(declareOutputBodySchema, request.body, 'output declaration');

      const result = await context.sopRevisionService.declareOutput({
        revisionId,
        name: body.name,
        label: body.label,
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.note === undefined ? {} : { note: body.note }),
      });

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound(`SOP revision "${revisionId}" does not exist.`);
          case 'not_editable':
            throw conflict(
              `This revision is "${result.state}" and can no longer be edited. Send it back for clarification first.`,
            );
          case 'duplicate_output':
            throw conflict(`"${result.outputName}" is already declared on this workflow.`);
          case 'invalid_graph':
            throw unprocessable(
              'That declaration would make the workflow invalid, so it was not saved.',
              toIssueDetails(result.issues),
            );
        }
      }

      const payload: DataEnvelope<{ revisionId: string; revisionNumber: number }> = {
        data: { revisionId: result.revision.id, revisionNumber: result.revision.revisionNumber },
      };

      return reply.code(201).send(payload);
    },
  );

  app.post<{ Params: { revisionId: string } }>(
    '/v1/sop-revisions/:revisionId/reorder',
    async (request, reply) => {
      const { revisionId } = parseParams(
        z.object({ revisionId: sopRevisionIdSchema }),
        request.params,
        'revision id',
      );
      const body = parseBody(reorderBodySchema, request.body, 'reorder request');

      const result = await context.sopRevisionService.reorderStep({
        revisionId,
        move: body.move,
        ...(body.note === undefined ? {} : { note: body.note }),
      });

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound(`SOP revision "${revisionId}" does not exist.`);
          case 'not_editable':
            throw conflict(
              `This revision is "${result.state}" and can no longer be edited. Send it back for clarification first.`,
            );
          case 'out_of_range':
            throw badRequest(result.explanation);
          case 'rejected':
            // The one-sentence explanation is the message, not a dump of issue
            // codes: the person reordering wrote the SOP in plain language and
            // is owed an answer in the same register.
            throw unprocessable(result.explanation, toIssueDetails(result.issues));
        }
      }

      const payload: DataEnvelope<{ revisionId: string; revisionNumber: number }> = {
        data: { revisionId: result.revision.id, revisionNumber: result.revision.revisionNumber },
      };

      return reply.code(201).send(payload);
    },
  );

  app.post<{ Params: { revisionId: string } }>(
    '/v1/sop-revisions/:revisionId/answers',
    async (request, reply) => {
      const { revisionId } = parseParams(
        z.object({ revisionId: sopRevisionIdSchema }),
        request.params,
        'revision id',
      );
      const body = parseBody(answerBodySchema, request.body, 'clarification answer');

      const result = await context.sopRevisionService.answerQuestion({
        revisionId,
        questionId: body.questionId,
        answer: body.answer,
      });

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound(`SOP revision "${revisionId}" does not exist.`);
          case 'not_editable':
            throw conflict(`This revision is "${result.state}" and no longer accepts answers.`);
          case 'unknown_question':
            throw notFound(`This revision did not ask question "${result.questionId}".`);
          case 'already_answered':
            throw conflict(
              'That question has already been answered on this revision. A changed answer means a new revision.',
            );
        }
      }

      return reply.code(201).send({ data: { questionId: result.answer.questionId } });
    },
  );

  app.post<{ Params: { revisionId: string } }>(
    '/v1/sop-revisions/:revisionId/transitions',
    async (request) => {
      const { revisionId } = parseParams(
        z.object({ revisionId: sopRevisionIdSchema }),
        request.params,
        'revision id',
      );
      const body = parseBody(transitionBodySchema, request.body, 'lifecycle action');

      const result = await context.sopRevisionService.transition({
        revisionId,
        action: body.action,
        ...(body.note === undefined ? {} : { note: body.note }),
      });

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound(`SOP revision "${revisionId}" does not exist.`);
          case 'illegal_transition':
            throw conflict(
              `A revision that is "${result.from}" cannot be moved by "${result.action}".`,
            );
          case 'questions_unanswered':
            // ADR-017: answering is the only way past this, and the response
            // names which questions are outstanding so the UI can point at them.
            throw unprocessable(
              'Every clarification question must be answered before this workflow can be reviewed.',
              result.unansweredQuestionIds.map((questionId) => ({
                field: questionId,
                message: 'This question has not been answered.',
              })),
            );
        }
      }

      return { data: { revisionId: result.revision.id, state: result.revision.state } };
    },
  );
}
