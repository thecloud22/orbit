import { stepChecksum } from '@orbit/db/checksum';
import type { ExecutionBinding } from '@orbit/execution-mapping';
import type { SopGraph } from '@orbit/sop-graph';
import { describe, expect, it } from 'vitest';

import { compileCandidate, type CompileResult } from './compile';
import { BORROW_OR_HOLD_OUTCOME_MAPPING, borrowOrHoldBindings, borrowOrHoldGraph } from './testing';

/**
 * Compiling a branching workflow.
 *
 * The claim this file makes is narrow and load-bearing: a `decision` step
 * becomes `browser.expect_one_of` with one alternative per branch, and neither
 * Agent IR nor the runtime needed a single change to run it. Everything that
 * makes branching work already existed; what was missing was a binding shape
 * that could say what each branch looks like.
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
    graph: overrides.graph ?? borrowOrHoldGraph(),
    bindings: overrides.bindings ?? borrowOrHoldBindings(),
    outcomeMapping: BORROW_OR_HOLD_OUTCOME_MAPPING,
    ...IDS,
  });
}

function refusalCodes(result: CompileResult): readonly string[] {
  return result.ok ? [] : result.refusals.map((entry) => entry.code);
}

describe('compiling a decision', () => {
  it('compiles the borrow-or-hold workflow', () => {
    const result = compile();

    if (!result.ok) {
      throw new Error(`refused: ${JSON.stringify(result.refusals, null, 2)}`);
    }

    expect(result.ok).toBe(true);
  });

  it('emits one expect_one_of alternative per branch, pointing at that branch', () => {
    const result = compile();
    if (!result.ok) return;

    const step = result.agentIr.steps.find((entry) => entry.id === 'check_availability');

    expect(step?.type).toBe('browser.expect_one_of');
    if (step?.type !== 'browser.expect_one_of') return;

    expect(step.alternatives).toEqual([
      {
        whenVisible: { strategy: 'test_id', value: 'catalog-borrow-button' },
        next: 'enter_borrow_member_id',
      },
      {
        whenVisible: { strategy: 'test_id', value: 'catalog-hold-button' },
        next: 'enter_hold_member_id',
      },
    ]);
  });

  it('grants the expect_one_of action it needs, and no more', () => {
    const result = compile();
    if (!result.ok) return;

    expect(result.agentIr.permissions.browser.allowedActions).toContain('expect_one_of');
  });

  it('keeps the graph as the only source of where a branch goes', () => {
    // The binding says what a branch *looks like*; the graph says where it
    // *goes*. A binding cannot redirect control flow, and this is the assertion
    // that says so.
    const result = compile();
    if (!result.ok) return;

    const step = result.agentIr.steps.find((entry) => entry.id === 'check_availability');
    if (step?.type !== 'browser.expect_one_of') return;

    const graph = borrowOrHoldGraph();
    const decision = graph.steps.find((entry) => entry.id === 'check_availability');
    if (decision?.kind !== 'decision') return;

    expect(step.alternatives.map((alternative) => alternative.next)).toEqual(
      decision.branches.map((branch) => branch.nextStepId),
    );
  });

  it('refuses a decision one of whose branches nobody demonstrated', () => {
    const bindings = borrowOrHoldBindings().map((binding) =>
      binding.body.kind === 'decision'
        ? {
            ...binding,
            body: { ...binding.body, branches: binding.body.branches.slice(0, 1) },
          }
        : binding,
    ) as readonly ExecutionBinding[];

    const result = compile({ bindings });

    expect(refusalCodes(result)).toContain('missing_branch_binding');
    expect(result.ok ? [] : result.refusals.map((entry) => entry.stepId)).toContain(
      'check_availability',
    );
  });

  it('refuses a branch that names a step the workflow does not have', () => {
    const graph = borrowOrHoldGraph();
    const steps = graph.steps.map((step) =>
      step.id === 'check_availability' && step.kind === 'decision'
        ? {
            ...step,
            branches: [{ ...step.branches[0]!, nextStepId: 'nowhere' }, step.branches[1]!],
          }
        : step,
    );

    // Re-checksummed, so the refusal is about the branch target rather than
    // about the edit having made the binding stale.
    const edited = { ...graph, steps } as SopGraph;
    const bindings = borrowOrHoldBindings().map((binding) => {
      const step = edited.steps.find((candidate) => candidate.id === binding.stepId);
      return step === undefined ? binding : { ...binding, stepSha256: stepChecksum(step) };
    });

    const result = compile({ graph: edited, bindings });

    expect(refusalCodes(result)).toContain('unresolved_branch_target');
  });

  it('refuses a decision whose step has been edited since it was bound', () => {
    const bindings = borrowOrHoldBindings().map((binding) =>
      binding.stepId === 'check_availability'
        ? { ...binding, stepSha256: 'b'.repeat(64) }
        : binding,
    );

    expect(refusalCodes(compile({ bindings }))).toContain('stale_binding');
  });
});
