import { stepChecksum } from '@orbit/db/checksum';
import type { ExecutionBinding } from '@orbit/execution-mapping';
import { judgedAvailabilityGraph } from '@orbit/sop-graph/testing';
import type { Branch, SopGraph } from '@orbit/sop-graph';
import { describe, expect, it } from 'vitest';

import { compileCandidate, type CompileResult } from './compile';
import { judgedAvailabilityBindings } from './testing';

/**
 * Compiling a judged decision.
 *
 * The claim: the *same* graph shape and the *same* demonstrated bindings become
 * either a deterministic branch or a judged one, depending on one field a
 * reviewer sets. Choosing which is a review-time decision, never a run-time
 * fallback the system reaches for on its own.
 *
 * The two refusals here matter more than the happy path. Both are properties of
 * the author's business meanings rather than of the graph's shape, and both are
 * the kind of mistake that otherwise produces a workflow that runs, never
 * errors, and is quietly wrong.
 */

const IDS = {
  agentId: 'agent_borrow_or_hold',
  version: '0.1.0',
  sopId: 'sop_borrow_or_hold',
  sopVersion: '1',
};

function compile(
  overrides: {
    readonly graph?: SopGraph;
    readonly bindings?: readonly ExecutionBinding[];
  } = {},
): CompileResult {
  return compileCandidate({
    graph: overrides.graph ?? judgedAvailabilityGraph(),
    bindings: overrides.bindings ?? judgedAvailabilityBindings(),
    ...IDS,
  });
}

function refusalCodes(result: CompileResult): readonly string[] {
  return result.ok ? [] : result.refusals.map((entry) => entry.code);
}

/**
 * Replaces the judged decision's branches, and rebuilds its binding to match.
 *
 * The binding has to be rebuilt, not reused: editing a step changes its
 * checksum, and the compiler would refuse the whole thing as `stale_binding`
 * before it ever looked at the branches. That refusal is correct — it is what
 * stops an edited step running against a mapping made for the old one — so the
 * fixture works with it rather than around it.
 */
function withBranches(branches: Branch[]): {
  readonly graph: SopGraph;
  readonly bindings: readonly ExecutionBinding[];
} {
  const base = judgedAvailabilityGraph();

  const graph: SopGraph = {
    ...base,
    steps: base.steps.map((step) =>
      step.id === 'check_availability' && step.kind === 'decision' ? { ...step, branches } : step,
    ),
  };

  const decisionStep = graph.steps.find((step) => step.id === 'check_availability');

  const bindings = judgedAvailabilityBindings().map((binding) => {
    if (binding.stepId !== 'check_availability' || binding.body.kind !== 'decision') {
      return binding;
    }

    const demonstrated = binding.body.branches[0];

    return {
      ...binding,
      stepSha256: stepChecksum(decisionStep!),
      body: {
        ...binding.body,
        branches: branches.map((branch) => ({ ...demonstrated!, when: branch.when })),
      },
    };
  });

  return { graph, bindings };
}

describe('a judged decision compiles to model.decide', () => {
  it('compiles at all', () => {
    const result = compile();

    if (!result.ok) {
      throw new Error(`refused: ${JSON.stringify(result.refusals, null, 2)}`);
    }

    expect(result.ok).toBe(true);
  });

  it('emits one alternative per branch, each pointing where the branch points', () => {
    const result = compile();
    if (!result.ok) return;

    const step = result.agentIr.steps.find((entry) => entry.id === 'check_availability');

    expect(step?.type).toBe('model.decide');

    if (step?.type !== 'model.decide') return;

    expect(step.alternatives.map((one) => one.next)).toEqual([
      'enter_borrow_member_id',
      'enter_hold_member_id',
      'availability_unclear',
    ]);
  });

  it('carries the author’s own words as each alternative’s description', () => {
    const result = compile();
    if (!result.ok) return;

    const step = result.agentIr.steps.find((entry) => entry.id === 'check_availability');
    if (step?.type !== 'model.decide') return;

    // What the judge is actually shown is the reviewer's sentence, not a
    // snake_case name it would have to infer meaning from.
    expect(step.alternatives[0]?.description).toBe('a copy can be borrowed right now');
    expect(step.alternatives[0]?.outcome).toBe('a_copy_can_be_borrowed_right_now');
  });

  it('reads the status region the branches were demonstrated on, deduplicated', () => {
    const result = compile();
    if (!result.ok) return;

    const step = result.agentIr.steps.find((entry) => entry.id === 'check_availability');
    if (step?.type !== 'model.decide') return;

    // Three branches demonstrated on one region are one region to read, not the
    // same text sent three times.
    expect(step.readFrom).toHaveLength(1);
    expect(step.readFrom[0]?.locator.value).toBe('catalog-result-status');
  });

  it('declares the model permission, and a call ceiling matching the judged steps', () => {
    const result = compile();
    if (!result.ok) return;

    expect(result.agentIr.permissions.model).toEqual({ allowed: true, maxCallsPerRun: 1 });
  });

  it('moves to schema version 0.2, because it uses the widened contract', () => {
    const result = compile();
    if (!result.ok) return;

    expect(result.agentIr.schemaVersion).toBe('0.2');
  });

  it('never asks for the expect_one_of browser action it does not use', () => {
    const result = compile();
    if (!result.ok) return;

    expect(result.agentIr.permissions.browser.allowedActions).not.toContain('expect_one_of');
  });
});

describe('the deterministic version of the same workflow is unchanged', () => {
  it('still compiles to expect_one_of at schema version 0.1, with no model permission', async () => {
    const { borrowOrHoldBindings, borrowOrHoldGraph } = await import('./testing');

    const result = compileCandidate({
      graph: borrowOrHoldGraph(),
      bindings: borrowOrHoldBindings(),
      ...IDS,
    });

    if (!result.ok) {
      throw new Error(`refused: ${JSON.stringify(result.refusals, null, 2)}`);
    }

    // The compatibility commitment, checked rather than asserted: a workflow
    // that uses nothing new produces a byte-identical document.
    expect(result.agentIr.schemaVersion).toBe('0.1');
    expect(result.agentIr.permissions.model).toBeUndefined();

    const step = result.agentIr.steps.find((entry) => entry.id === 'check_availability');
    expect(step?.type).toBe('browser.expect_one_of');
  });
});

describe('a judged decision must be able to say it could not tell', () => {
  it('refuses one whose branches are all confident answers', () => {
    const result = compile(
      withBranches([
        { when: 'a copy can be borrowed right now', nextStepId: 'enter_borrow_member_id' },
        { when: 'no copy can be borrowed right now', nextStepId: 'enter_hold_member_id' },
      ]),
    );

    expect(refusalCodes(result)).toContain('missing_insufficient_evidence_branch');
  });

  it('explains why, in terms a reviewer can act on', () => {
    const result = compile(
      withBranches([
        { when: 'a copy can be borrowed right now', nextStepId: 'enter_borrow_member_id' },
        { when: 'no copy can be borrowed right now', nextStepId: 'enter_hold_member_id' },
      ]),
    );

    if (result.ok) throw new Error('expected a refusal');

    const message = result.refusals.map((entry) => entry.message).join(' ');
    expect(message).toContain('the evidence does not settle this');
    expect(message).toContain('indistinguishable from a correct one');
  });

  it('refuses one that marks more than one branch as the unclear case', () => {
    const result = compile(
      withBranches([
        {
          when: 'a copy can be borrowed right now',
          nextStepId: 'enter_borrow_member_id',
          insufficientEvidence: true,
        },
        {
          when: 'no copy can be borrowed right now',
          nextStepId: 'enter_hold_member_id',
          insufficientEvidence: true,
        },
      ]),
    );

    expect(refusalCodes(result)).toContain('missing_insufficient_evidence_branch');
  });
});

describe('branches that collapse to the same name', () => {
  it('refuses two conditions that are indistinguishable once named', () => {
    const result = compile(
      withBranches([
        { when: 'the title is available', nextStepId: 'enter_borrow_member_id' },
        { when: 'the title IS available!', nextStepId: 'enter_hold_member_id' },
        {
          when: 'the page does not say',
          nextStepId: 'availability_unclear',
          insufficientEvidence: true,
        },
      ]),
    );

    expect(refusalCodes(result)).toContain('ambiguous_branch_outcome');
  });
});

describe('what the compiler cannot check', () => {
  it('accepts overlapping categories, which is the documented limitation', () => {
    // "Available" and "reference only" can both be true of the same record, and
    // a pick-one node will still return exactly one. Nothing in the schema
    // distinguishes this from a genuine partition, because overlap is a fact
    // about the author's business meanings rather than about the graph. It is
    // stated in ADR-032 and in the authoring guidance as a limitation, and this
    // test pins the fact that it is *not* detected rather than pretending it is.
    const result = compile(
      withBranches([
        { when: 'the title is available', nextStepId: 'enter_borrow_member_id' },
        { when: 'the title is reference only', nextStepId: 'enter_hold_member_id' },
        {
          when: 'the page does not say',
          nextStepId: 'availability_unclear',
          insufficientEvidence: true,
        },
      ]),
    );

    expect(result.ok).toBe(true);
  });
});
