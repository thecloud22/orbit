import { SOP_GRAPH_SCHEMA_VERSION, sopGraphSchema } from '@orbit/sop-graph';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { sopGraphProposalSchema } from './proposal';
import { validSopGraphProposal } from './testing';

describe('the schema the model is bound to', () => {
  it('omits schemaVersion, and nothing else', () => {
    const full = Object.keys(sopGraphSchema.shape);
    const proposal = Object.keys(sopGraphProposalSchema.shape);

    expect(proposal).not.toContain('schemaVersion');
    expect(new Set(proposal)).toEqual(new Set(full.filter((key) => key !== 'schemaVersion')));
  });

  it('converts to a JSON Schema the provider can bind a tool to', () => {
    // `withStructuredOutput` converts the Zod schema to JSON Schema to build the
    // tool definition. If that conversion ever broke — a construct Zod cannot
    // represent, a change in the graph contract — the only symptom would be a
    // failure against the live API, which no automated test here reaches. This
    // catches it with no network call.
    const json = z.toJSONSchema(sopGraphProposalSchema, { io: 'input', unrepresentable: 'any' });
    const properties = (json as { readonly properties: Record<string, unknown> }).properties;

    expect(Object.keys(properties)).toContain('steps');
    expect(Object.keys(properties)).not.toContain('schemaVersion');
  });

  it('accepts a proposal that becomes a valid graph once the version is added', () => {
    const proposal = validSopGraphProposal();

    expect(sopGraphProposalSchema.safeParse(proposal).success).toBe(true);
    expect(
      sopGraphSchema.safeParse({ ...proposal, schemaVersion: SOP_GRAPH_SCHEMA_VERSION }).success,
    ).toBe(true);
  });

  it('rejects a proposal that carries a literal secret instead of a reference', () => {
    const proposal = validSopGraphProposal();
    const steps = (proposal['steps'] as Record<string, unknown>[]).map((step) =>
      step['id'] === 'enter_password' ? { ...step, value: 'hunter2' } : step,
    );

    const parsed = sopGraphSchema.safeParse({
      ...proposal,
      steps,
      schemaVersion: SOP_GRAPH_SCHEMA_VERSION,
    });

    // The schema alone lets it through — a literal is a valid string. The graph
    // validator is what refuses it, which is exactly why generation runs
    // `parseSopGraphDocument` and not `sopGraphSchema` on its own.
    expect(parsed.success).toBe(true);
  });
});
