import type { SopAnswerId, SopRevisionId } from '@orbit/contracts';
import { index, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { createdAt, opaqueId, timestamptz } from './columns';
import { sopGraphRevisions } from './sop-graph-revisions';

/**
 * An answer to one clarification question on one revision.
 *
 * The questions themselves live inside the graph document, because they are
 * produced with a draft and revised with it. Answers cannot: an answer arrives
 * after the question was asked, and recording it must not require rewriting the
 * revision that asked — that revision is what the reviewer saw.
 *
 * An answer therefore points back at a question by its id within a specific
 * revision, and answering is what motivates the *next* revision.
 */
export const sopClarificationAnswers = pgTable(
  'sop_clarification_answers',
  {
    id: opaqueId<SopAnswerId>('id').primaryKey(),
    revisionId: opaqueId<SopRevisionId>('revision_id')
      .notNull()
      .references(() => sopGraphRevisions.id, { onDelete: 'cascade' }),
    /** Matches `clarificationQuestions[].id` in that revision's graph. */
    questionId: text('question_id').notNull(),
    answer: text('answer').notNull(),
    answeredAt: timestamptz('answered_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    // One answer per question per revision; a changed mind is a new revision.
    unique('sop_clarification_answers_revision_question_unique').on(
      table.revisionId,
      table.questionId,
    ),
    index('sop_clarification_answers_revision_id_idx').on(table.revisionId),
  ],
);

export type SopClarificationAnswerRow = typeof sopClarificationAnswers.$inferSelect;
export type NewSopClarificationAnswerRow = typeof sopClarificationAnswers.$inferInsert;
