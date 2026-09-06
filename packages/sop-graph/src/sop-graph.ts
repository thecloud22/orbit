import { z } from 'zod';

import { inputDeclarationSchema, outputDeclarationSchema } from './declarations';
import { sopStepSchema, stepIdSchema } from './steps';

/**
 * The SOP Graph document.
 *
 * A structured, reviewable, **non-executable** statement of intent. It is the
 * thing a human reads, edits, and approves — and approving it does nothing but
 * record that it describes the intended process.
 *
 * Assumptions, clarification questions, and risks live in the document rather
 * than beside it because they are produced with a draft and revised with it;
 * an assumption belongs to the version of the graph that made it. Answers do
 * not live here — an answer arrives after the question and drives a new
 * revision, so it is persisted separately.
 */

export const assumptionSchema = z.strictObject({
  id: z.string().min(1),
  statement: z.string().min(1),
  /** What in the source text led here, so a reviewer can judge the leap. */
  rationale: z.string().min(1).optional(),
});
export type Assumption = z.infer<typeof assumptionSchema>;

export const clarificationQuestionSchema = z.strictObject({
  id: z.string().min(1),
  question: z.string().min(1),
  /** The step the question is about, when it is about one. */
  aboutStepId: stepIdSchema.optional(),
  /** Offered answers, when the question is a choice rather than free text. */
  options: z.array(z.string().min(1)).optional(),
});
export type ClarificationQuestion = z.infer<typeof clarificationQuestionSchema>;

export const riskSchema = z.strictObject({
  id: z.string().min(1),
  statement: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
});
export type Risk = z.infer<typeof riskSchema>;

export const SOP_GRAPH_SCHEMA_VERSION = '0.1';

export const sopGraphSchema = z.strictObject({
  schemaVersion: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  /** Where execution would begin. Validated to exist. */
  entryStepId: stepIdSchema,
  inputs: z.array(inputDeclarationSchema),
  outputs: z.array(outputDeclarationSchema),
  steps: z.array(sopStepSchema).min(1),
  assumptions: z.array(assumptionSchema).default([]),
  clarificationQuestions: z.array(clarificationQuestionSchema).default([]),
  risks: z.array(riskSchema).default([]),
});

export type SopGraph = z.infer<typeof sopGraphSchema>;
