import { describe, expect, it } from 'vitest';

import { applyReorder, ReorderError, validateReorder } from './reorder';
import { escalationReviewGraph } from './testing/fixtures';
import { validateSopGraph } from './validate';

describe('validateReorder', () => {
  it('accepts a valid move and does not mutate the original graph', () => {
    const graph = escalationReviewGraph();
    const originalOrder = graph.steps.map((step) => step.id);
    const toIndex = graph.steps.findIndex((step) => step.id === 'enter_date_to');

    const result = validateReorder(graph, { stepId: 'enter_date_from', toIndex });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected the move to be accepted');
    }

    expect(validateSopGraph(result.graph)).toEqual([]);
    expect(graph.steps.map((step) => step.id)).toEqual(originalOrder);
  });

  it('rejects a move that reads a variable produced later, with the exact explanation', () => {
    const graph = escalationReviewGraph();
    const toIndex = graph.steps.findIndex((step) => step.id === 'extract_request_details');

    const result = validateReorder(graph, { stepId: 'search_team_directory', toIndex });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected the move to be rejected');
    }

    expect(result.issues.map((issue) => issue.code)).toContain(
      'VARIABLE_NOT_AVAILABLE_ON_ALL_PATHS',
    );
    expect(result.explanation).toBe(
      'Cannot move "Search the team directory for the assigned team" before "Extract request details" because the moved step uses Assigned Team, which is produced later in the workflow.',
    );
  });

  it('rejects a move that escapes the decision guarding the moved step', () => {
    const graph = escalationReviewGraph();
    const toIndex = graph.steps.findIndex((step) => step.id === 'check_team_name_match');

    const result = validateReorder(graph, { stepId: 'open_on_call_schedule', toIndex });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected the move to be rejected');
    }

    expect(result.explanation).toContain('only reachable on one branch of that decision');
    expect(result.explanation).toContain('paths where that decision has not been made');
  });

  it('throws when moving an unknown step id', () => {
    const graph = escalationReviewGraph();

    expect(() => applyReorder(graph, { stepId: 'does_not_exist', direction: 'up' })).toThrow(
      ReorderError,
    );
  });

  it('throws when moving beyond either end of the workflow', () => {
    const graph = escalationReviewGraph();
    const firstStepId = graph.steps[0]!.id;
    const lastStepId = graph.steps[graph.steps.length - 1]!.id;

    expect(() => applyReorder(graph, { stepId: firstStepId, direction: 'up' })).toThrow(
      ReorderError,
    );
    expect(() => applyReorder(graph, { stepId: lastStepId, direction: 'down' })).toThrow(
      ReorderError,
    );
  });
});
