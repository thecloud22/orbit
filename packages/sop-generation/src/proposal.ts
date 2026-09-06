import { sopGraphSchema } from '@orbit/sop-graph';
import type { z } from 'zod';

/**
 * The schema the model is bound to.
 *
 * `schemaVersion` is omitted deliberately. It identifies the contract the
 * document conforms to, which is a fact this codebase knows and a model can
 * only guess at; asking for it invites a plausible-looking wrong answer that
 * would then have to be detected and overruled. Code injects it afterwards.
 */
export const sopGraphProposalSchema = sopGraphSchema.omit({ schemaVersion: true });

export type SopGraphProposal = z.infer<typeof sopGraphProposalSchema>;
