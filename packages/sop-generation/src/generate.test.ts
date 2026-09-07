import { SOP_GRAPH_SCHEMA_VERSION } from '@orbit/sop-graph';
import { describe, expect, it } from 'vitest';

import { ASSUMED_TOKENS_PER_CALL } from './budget';
import { generateSopGraph } from './generate';
import { SOP_GENERATION_PROMPT_VERSION } from './prompt';
import { SopProviderError, type LLMProvider } from './provider';
import {
  createFakeSopProvider,
  failWith,
  invalidSopGraphProposal,
  respondInOrder,
  respondWith,
  validSopGraphProposal,
} from './testing';

const SOURCE_TEXT = 'Sign in to the portal, search for the request, and report its status.';

describe('generateSopGraph', () => {
  it('accepts a valid proposal on the first attempt', async () => {
    const provider = createFakeSopProvider({
      respond: respondInOrder([respondWith(validSopGraphProposal())]),
    });

    const result = await generateSopGraph({ provider, sourceText: SOURCE_TEXT });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(provider.callCount).toBe(1);
    expect(result.graph.title).toBe('Service request escalation review');
    expect(result.generation.attempts).toBe(1);
    expect(result.generation.promptVersion).toBe(SOP_GENERATION_PROMPT_VERSION);
    expect(result.generation.provider).toBe('fake');
    expect(result.generation.model).toBe('fake-model');
  });

  it('injects the schema version the model was never asked for', async () => {
    const provider = createFakeSopProvider({
      respond: respondInOrder([respondWith(validSopGraphProposal())]),
    });

    const result = await generateSopGraph({ provider, sourceText: SOURCE_TEXT });

    expect(result.ok && result.graph.schemaVersion).toBe(SOP_GRAPH_SCHEMA_VERSION);
  });

  it('overrides a schema version the model volunteered anyway', async () => {
    const provider = createFakeSopProvider({
      respond: respondInOrder([
        respondWith({ ...validSopGraphProposal(), schemaVersion: '99.9-invented' }),
      ]),
    });

    const result = await generateSopGraph({ provider, sourceText: SOURCE_TEXT });

    // Overwritten rather than merged: which contract a document claims to
    // satisfy is this codebase's statement, not the model's.
    expect(result.ok && result.graph.schemaVersion).toBe(SOP_GRAPH_SCHEMA_VERSION);
  });

  it('repairs once, and the repair carries the real validation issues', async () => {
    const provider = createFakeSopProvider({
      respond: respondInOrder([
        respondWith(invalidSopGraphProposal()),
        respondWith(validSopGraphProposal()),
      ]),
    });

    const result = await generateSopGraph({ provider, sourceText: SOURCE_TEXT });

    expect(result.ok).toBe(true);
    expect(result.ok && result.generation.attempts).toBe(2);
    expect(provider.callCount).toBe(2);

    const repair = provider.requests[1];
    expect(repair?.repairContext).toBeDefined();

    // The specific failure, not a generic retry: the entry step named a step
    // that does not exist, and the model is told exactly that.
    const codes = repair?.repairContext?.issues.map((issue) => issue.code) ?? [];
    expect(codes).toContain('UNKNOWN_ENTRY_STEP');

    // And it is given the document that was actually validated, so the issue
    // paths point at something it can read.
    const previous = repair?.repairContext?.previousAttempt as Record<string, unknown>;
    expect(previous['entryStepId']).toBe('no_such_step');
    expect(previous['schemaVersion']).toBe(SOP_GRAPH_SCHEMA_VERSION);
  });

  it('reports validation failure when the repair is also invalid, and gives back the final issues', async () => {
    const provider = createFakeSopProvider({
      respond: respondInOrder([
        respondWith(invalidSopGraphProposal()),
        respondWith(invalidSopGraphProposal()),
      ]),
    });

    const result = await generateSopGraph({ provider, sourceText: SOURCE_TEXT });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.reason).toBe('invalid_after_repair');
    expect(result.reason === 'invalid_after_repair' && result.attempts).toBe(2);
    expect(
      result.reason === 'invalid_after_repair' && result.issues.map((issue) => issue.code),
    ).toContain('UNKNOWN_ENTRY_STEP');
  });

  it('stops after exactly one repair', async () => {
    const provider = createFakeSopProvider({
      respond: () => respondWith(invalidSopGraphProposal()),
    });

    await generateSopGraph({ provider, sourceText: SOURCE_TEXT });

    expect(provider.callCount).toBe(2);
  });

  it('reports a provider failure as its own kind, never as a validation failure', async () => {
    const provider = createFakeSopProvider({
      respond: respondInOrder([failWith('the model endpoint refused the connection')]),
    });

    const result = await generateSopGraph({ provider, sourceText: SOURCE_TEXT });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.reason).toBe('provider_error');
    expect(result.reason === 'provider_error' && result.message).toContain(
      'refused the connection',
    );
    // No repair is attempted: there is nothing to repair.
    expect(provider.callCount).toBe(1);
  });

  it('does not retry a provider failure that happens during the repair', async () => {
    const provider = createFakeSopProvider({
      respond: respondInOrder([
        respondWith(invalidSopGraphProposal()),
        failWith('the model endpoint timed out'),
      ]),
    });

    const result = await generateSopGraph({ provider, sourceText: SOURCE_TEXT });

    expect(result.ok === false && result.reason).toBe('provider_error');
    expect(provider.callCount).toBe(2);
  });

  it('rejects a reply that is not a document at all', async () => {
    const provider = createFakeSopProvider({
      respond: () => respondWith('I could not work out what you meant.'),
    });

    const result = await generateSopGraph({ provider, sourceText: SOURCE_TEXT });

    expect(result.ok === false && result.reason).toBe('invalid_after_repair');
  });

  it('lets a defect propagate instead of disguising it as a provider failure', async () => {
    // A provider that throws something other than SopProviderError is a bug in
    // this process, and converting it would hide the bug behind a message about
    // the model.
    const broken: LLMProvider = {
      descriptor: { provider: 'broken', model: 'broken' },
      generateSopGraphProposal() {
        return Promise.reject(new TypeError('cannot read properties of undefined'));
      },
    };

    await expect(generateSopGraph({ provider: broken, sourceText: SOURCE_TEXT })).rejects.toThrow(
      TypeError,
    );
  });

  it('records the moment of generation', async () => {
    const provider = createFakeSopProvider({
      respond: respondInOrder([respondWith(validSopGraphProposal())]),
    });

    const result = await generateSopGraph({
      provider,
      sourceText: SOURCE_TEXT,
      now: () => new Date('2026-09-05T10:30:00.000Z'),
    });

    expect(result.ok && result.generation.generatedAt).toBe('2026-09-05T10:30:00.000Z');
  });
});

describe('SopProviderError', () => {
  it('keeps the original failure as its cause without exposing it in the message', () => {
    const cause = new Error('x-api-key rejected for account acct_123');
    const error = new SopProviderError('The model provider could not generate a proposal.', {
      provider: 'anthropic',
      cause,
    });

    expect(error.provider).toBe('anthropic');
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain('acct_123');
  });
});

/**
 * The budget, inside the pipeline.
 *
 * The claims here are the ones a cap has to make to be worth anything: the
 * check happens *before* the call, usage accumulates across both attempts of a
 * draft, and a repair that would exceed a ceiling is refused rather than made —
 * with the invalid draft's own issues returned alongside the reason, so nothing
 * is silently half-done.
 */
describe('generateSopGraph, under a token budget', () => {
  it('records what each call spent, on the way through', async () => {
    const provider = createFakeSopProvider({
      respond: respondInOrder([
        respondWith(validSopGraphProposal(), { inputTokens: 700, outputTokens: 300 }),
      ]),
    });

    const result = await generateSopGraph({ provider, sourceText: 'anything' });

    expect(result.calls).toEqual([
      { attempt: 1, usage: { inputTokens: 700, outputTokens: 300 }, assumed: false },
    ]);
  });

  it('accumulates usage across the attempt and its repair', async () => {
    const provider = createFakeSopProvider({
      respond: respondInOrder([
        respondWith(invalidSopGraphProposal(), { inputTokens: 700, outputTokens: 300 }),
        respondWith(validSopGraphProposal(), { inputTokens: 900, outputTokens: 100 }),
      ]),
    });

    const result = await generateSopGraph({ provider, sourceText: 'anything' });

    expect(result.ok).toBe(true);
    expect(result.calls.map((call) => call.attempt)).toEqual([1, 2]);
    expect(
      result.calls.reduce(
        (total, call) => total + call.usage.inputTokens + call.usage.outputTokens,
        0,
      ),
    ).toBe(2_000);
  });

  it('makes no call at all when a budget is already exhausted', async () => {
    const provider = createFakeSopProvider({
      respond: respondInOrder([respondWith(validSopGraphProposal())]),
    });

    const result = await generateSopGraph({
      provider,
      sourceText: 'anything',
      budgets: { global: 1_000 },
      spend: { global: 1_000, document: 0, request: 0 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('budget_exhausted');
    // The point of checking before the call rather than after it.
    expect(provider.callCount).toBe(0);
    expect(result.calls).toEqual([]);
  });

  it('refuses the repair when the first call used up the budget, and says so', async () => {
    // The mid-session case: the attempt succeeds, spends real tokens, and the
    // repair that might have fixed it is no longer affordable. This must not be
    // a silent half-result, and must not be reported as the model failing.
    const provider = createFakeSopProvider({
      respond: respondInOrder([
        respondWith(invalidSopGraphProposal(), { inputTokens: 9_000, outputTokens: 1_000 }),
        respondWith(validSopGraphProposal()),
      ]),
    });

    const result = await generateSopGraph({
      provider,
      sourceText: 'anything',
      budgets: { request: 12_000 },
      spend: { global: 0, document: 0, request: 0 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('budget_exhausted_before_repair');
    // The repair was never made — one call, not two.
    expect(provider.callCount).toBe(1);
    expect(result.calls).toHaveLength(1);

    if (result.reason !== 'budget_exhausted_before_repair') return;
    // And the draft's own problems come back with it, so the person is not told
    // only that they ran out.
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.refusal.scope).toBe('request');
  });

  it('charges an assumed size when the provider reports no usage', async () => {
    // A provider that stops reporting usage must not silently become free, or
    // the next check would let an unbounded number of calls through.
    const provider = createFakeSopProvider({
      respond: respondInOrder([respondWith(validSopGraphProposal(), null)]),
    });

    const result = await generateSopGraph({ provider, sourceText: 'anything' });

    expect(result.calls[0]?.assumed).toBe(true);
    expect(result.calls[0]?.usage.inputTokens).toBe(ASSUMED_TOKENS_PER_CALL);
  });

  it('still reports what a failed provider call spent', async () => {
    const provider = createFakeSopProvider({
      respond: respondInOrder([failWith('the provider is unreachable')]),
    });

    const result = await generateSopGraph({ provider, sourceText: 'anything' });

    expect(result.ok).toBe(false);
    // Nothing came back, so nothing was charged — but the field is present on
    // every outcome, so a caller never has to ask whether it exists.
    expect(result.calls).toEqual([]);
  });
});
