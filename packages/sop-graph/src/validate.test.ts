import { describe, expect, it } from 'vitest';

import { parseSopGraphDocument } from './parse';
import { cloneGraph, escalationReviewGraph, minimalGraph } from './testing/fixtures';
import { validateSopGraph } from './validate';

/**
 * Graph-level semantic validation.
 *
 * Each test builds an invalid graph from a known-good fixture via
 * `cloneGraph`, mutates the clone narrowly, and asserts the resulting issue
 * codes rather than exact message text, except where a message is pinned by
 * the task spec.
 */

describe('validateSopGraph', () => {
  it('produces zero issues for the minimal graph', () => {
    const graph = minimalGraph();

    expect(validateSopGraph(graph)).toEqual([]);
    expect(parseSopGraphDocument(graph).ok).toBe(true);
  });

  it('produces zero issues for the full escalation review example', () => {
    expect(validateSopGraph(escalationReviewGraph())).toEqual([]);
  });

  it('reports a step that can never be reached', () => {
    const graph = cloneGraph(minimalGraph());

    // Appended after the existing terminal step ("done"), so nothing branches
    // to it and nothing falls through into it. A second terminal step keeps
    // the array ending on an outcome.
    graph.steps.push(
      {
        id: 'stray_navigate',
        kind: 'navigate',
        purpose: 'Never reached from the entry step',
        urlHint: 'https://example.com/stray',
      },
      {
        id: 'stray_done',
        kind: 'outcome',
        outcome: 'completed',
        message: 'Unreachable outcome',
      },
    );

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain('UNREACHABLE_STEP');
  });

  it('reports a branch pointing at a step that does not exist', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'check_password_expired');
    if (step?.kind !== 'decision') {
      throw new Error('fixture changed: expected "check_password_expired" to be a decision step');
    }

    step.branches[0]!.nextStepId = 'does_not_exist';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain('UNKNOWN_BRANCH_TARGET');
  });

  it('reports a missing entry step', () => {
    const graph = cloneGraph(minimalGraph());
    graph.entryStepId = '';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain('MISSING_ENTRY_STEP');
  });

  it('reports an entry step that does not match any step', () => {
    const graph = cloneGraph(minimalGraph());
    graph.entryStepId = 'no_such_step';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain('UNKNOWN_ENTRY_STEP');
  });

  it('reports falling off the end when the last step is not terminal', () => {
    const graph = cloneGraph(minimalGraph());
    const index = graph.steps.findIndex((candidate) => candidate.id === 'done');

    graph.steps[index] = {
      id: 'done',
      kind: 'click',
      targetHint: 'Something',
      purpose: 'Not an outcome or manual review',
    };

    const codes = validateSopGraph(graph).map((issue) => issue.code);
    // NON_TERMINATING_PATH may also be reported; FALLS_OFF_END is the one required here.
    expect(codes).toContain('FALLS_OFF_END');
  });

  it('reports a cycle', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'check_directory_entry');
    if (step?.kind !== 'decision') {
      throw new Error('fixture changed: expected "check_directory_entry" to be a decision step');
    }

    const branch = step.branches.find((candidate) => candidate.when === 'entry found');
    if (branch === undefined) {
      throw new Error('fixture changed: expected an "entry found" branch');
    }

    // Loops back to an earlier step in the same path, forming a cycle.
    branch.nextStepId = 'open_team_directory';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain('CYCLE_NOT_SUPPORTED');
  });

  it('reports a duplicate step id', () => {
    const graph = cloneGraph(minimalGraph());
    graph.steps[1]!.id = graph.steps[0]!.id;

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain('DUPLICATE_STEP_ID');
  });

  it('reports a duplicate input id', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const endDate = graph.inputs.find((input) => input.id === 'reportingEndDate');
    if (endDate === undefined) {
      throw new Error('fixture changed: expected a "reportingEndDate" input');
    }

    endDate.id = 'reportingStartDate';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain('DUPLICATE_INPUT_ID');
  });

  it('reports an undeclared input reference', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'enter_login_id');
    if (step?.kind !== 'fill') {
      throw new Error('fixture changed: expected "enter_login_id" to be a fill step');
    }

    step.value = '${inputs.notDeclared}';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'UNDECLARED_INPUT_REFERENCE',
    );
  });

  it('reports an undeclared variable reference', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'enter_request_number');
    if (step?.kind !== 'fill') {
      throw new Error('fixture changed: expected "enter_request_number" to be a fill step');
    }

    step.value = '${variables.neverProduced}';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'UNDECLARED_VARIABLE_REFERENCE',
    );
  });

  it('reports a variable not available on every path that reaches it', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'search_team_directory');
    if (step?.kind !== 'fill') {
      throw new Error('fixture changed: expected "search_team_directory" to be a fill step');
    }

    // onCallEngineer is produced only on the late, stale sub-path.
    step.value = '${variables.onCallEngineer}';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'VARIABLE_NOT_AVAILABLE_ON_ALL_PATHS',
    );
  });

  it('reports a malformed reference', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'enter_request_number');
    if (step?.kind !== 'fill') {
      throw new Error('fixture changed: expected "enter_request_number" to be a fill step');
    }

    step.value = '${inputs.requestNumber';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain('MALFORMED_REFERENCE');
  });

  it('reports a secret literal embedded in a sensitive fill', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'enter_password');
    if (step?.kind !== 'fill') {
      throw new Error('fixture changed: expected "enter_password" to be a fill step');
    }

    step.value = 'hunter2';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain('SECRET_LITERAL_EMBEDDED');
  });

  it('reports a sensitive fill that does not reference a secret input', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'enter_password');
    if (step?.kind !== 'fill') {
      throw new Error('fixture changed: expected "enter_password" to be a fill step');
    }

    step.value = '${inputs.requestNumber}';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'SENSITIVE_FILL_WITHOUT_SECRET_INPUT',
    );
  });

  it('reports a secret referenced outside a fill', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'check_closed');
    if (step?.kind !== 'decision') {
      throw new Error('fixture changed: expected "check_closed" to be a decision step');
    }

    step.usesInputs = ['password'];

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'SECRET_REFERENCE_NOT_ALLOWED_HERE',
    );
  });

  it('accepts a secret used correctly, with no secret-related issues', () => {
    const graph = escalationReviewGraph();
    const step = graph.steps.find((candidate) => candidate.id === 'enter_password');
    if (step?.kind !== 'fill') {
      throw new Error('fixture changed: expected "enter_password" to be a fill step');
    }

    expect(step.value).toBe('${inputs.password}');
    expect(step.sensitive).toBe(true);

    const passwordInput = graph.inputs.find((input) => input.id === 'password');
    expect(passwordInput?.type).toBe('secret');

    const codes = validateSopGraph(graph).map((issue) => issue.code);
    expect(codes).not.toContain('SECRET_LITERAL_EMBEDDED');
    expect(codes).not.toContain('SENSITIVE_FILL_WITHOUT_SECRET_INPUT');
    expect(codes).not.toContain('SECRET_REFERENCE_NOT_ALLOWED_HERE');
  });

  it('reports an outcome return not available on every path, and accepts it once marked optional', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'completed');
    if (step?.kind !== 'outcome') {
      throw new Error('fixture changed: expected "completed" to be an outcome step');
    }

    const entry = step.returns?.find((candidate) => candidate.name === 'onCallEngineer');
    if (entry === undefined) {
      throw new Error('fixture changed: expected a "onCallEngineer" return entry');
    }

    delete entry.optional;
    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'OPTIONAL_VARIABLE_IN_OUTCOME',
    );

    entry.optional = true;
    expect(validateSopGraph(graph)).toEqual([]);
  });

  it('reports an outcome returning a value that no step produces', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'completed');
    if (step?.kind !== 'outcome') {
      throw new Error('fixture changed: expected "completed" to be an outcome step');
    }

    step.returns = [...(step.returns ?? []), { name: 'neverProduced' }];

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'UNDECLARED_OUTCOME_RETURN',
    );
  });

  it('reports an invalid URL', () => {
    const graph = cloneGraph(minimalGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'open_page');
    if (step?.kind !== 'navigate') {
      throw new Error('fixture changed: expected "open_page" to be a navigate step');
    }

    step.urlHint = 'not a url';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain('INVALID_URL');
  });

  it('reports a non-http(s) URL scheme as invalid', () => {
    const graph = cloneGraph(minimalGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'open_page');
    if (step?.kind !== 'navigate') {
      throw new Error('fixture changed: expected "open_page" to be a navigate step');
    }

    step.urlHint = 'file:///etc/passwd';

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain('INVALID_URL');
  });
});

describe('parseSopGraphDocument', () => {
  it('rejects a document that does not match the schema', () => {
    const result = parseSopGraphDocument({});

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected parseSopGraphDocument({}) to fail');
    }

    expect(result.issues.map((issue) => issue.code)).toContain('SCHEMA_ERROR');
  });

  it('rejects a secret input declaration that carries a value', () => {
    const graph = cloneGraph(escalationReviewGraph());
    const index = graph.inputs.findIndex((input) => input.id === 'password');
    if (index === -1) {
      throw new Error('fixture changed: expected a "password" input');
    }

    // The secret input schema has no `example`/`default` field at all, so
    // adding one is rejected by the strict object schema, not by a
    // hand-written check.
    const mutableInput = graph.inputs[index] as unknown as Record<string, unknown>;
    mutableInput.example = 'hunter2';

    const result = parseSopGraphDocument(graph);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected parseSopGraphDocument to reject a secret input carrying a value');
    }

    expect(result.issues.map((issue) => issue.code)).toContain('SCHEMA_ERROR');
  });
});

/**
 * Computed decisions (ADR-040).
 *
 * The escalation fixture's `check_password_expired` is an ordinary
 * demonstrated decision, so each test here converts it into a computed one and
 * then breaks exactly one thing about it. `status` is a variable the fixture's
 * extract step really produces, which is what makes the "no step reads that
 * value" test meaningful rather than trivially true of everything.
 */
describe('a decision resolved by comparing values', () => {
  function computedGraph(comparison: {
    left: string;
    operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
    right: string;
  }) {
    const graph = cloneGraph(escalationReviewGraph());
    const step = graph.steps.find((candidate) => candidate.id === 'check_password_expired');

    if (step?.kind !== 'decision') {
      throw new Error('fixture changed: expected "check_password_expired" to be a decision');
    }

    step.resolution = 'computed';
    step.comparison = comparison;
    step.branches = [
      { when: 'the condition holds', nextStepId: 'credential_expired' },
      { when: 'it does not', nextStepId: 'open_advanced_search', otherwise: true },
    ];

    return { graph, step };
  }

  it('accepts a comparison against values the workflow holds at that point', () => {
    const { graph } = computedGraph({
      left: '${inputs.requestNumber}',
      operator: 'eq',
      right: 'SR-1001',
    });

    expect(validateSopGraph(graph)).toEqual([]);
  });

  it('refuses a rule that reads a value the workflow has not read yet', () => {
    // `status` is genuinely produced by this workflow -- but by a step that
    // runs *after* this decision. A rule can only compare what the run already
    // holds when it reaches the rule, and the existing availability analysis
    // enforces that for a comparison exactly as it does for a filled field.
    const { graph } = computedGraph({
      left: '${variables.status}',
      operator: 'eq',
      right: 'Escalated',
    });

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'VARIABLE_NOT_AVAILABLE_ON_ALL_PATHS',
    );
  });

  it('refuses a comparison against a value nothing produces', () => {
    // The rule this enforces: Orbit reads figures a system of record computed,
    // and will not work one out for itself. A rule about loan-to-value needs a
    // step that reads loan-to-value.
    const { graph } = computedGraph({
      left: '${variables.loanToValue}',
      operator: 'gt',
      right: '80',
    });

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'UNDECLARED_VARIABLE_REFERENCE',
    );
  });

  it('refuses a comparison against an input the workflow does not declare', () => {
    const { graph } = computedGraph({
      left: '${inputs.requestNumber}',
      operator: 'eq',
      right: '${inputs.notDeclared}',
    });

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'UNDECLARED_INPUT_REFERENCE',
    );
  });

  it('refuses a malformed reference rather than reading it as literal text', () => {
    const { graph } = computedGraph({
      left: '${inputs.requestNumber',
      operator: 'eq',
      right: 'SR-1001',
    });

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain('MALFORMED_REFERENCE');
  });

  it('refuses the resolution with no comparison to make', () => {
    const { graph, step } = computedGraph({
      left: '${inputs.requestNumber}',
      operator: 'eq',
      right: 'SR-1001',
    });
    delete step.comparison;

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'COMPUTED_DECISION_WITHOUT_COMPARISON',
    );
  });

  it('refuses a comparison on a decision that is not resolved by comparing', () => {
    // Otherwise it would sit in the graph reading like a rule, be approved as
    // one, and never be evaluated.
    const { graph, step } = computedGraph({
      left: '${inputs.requestNumber}',
      operator: 'eq',
      right: 'SR-1001',
    });
    delete step.resolution;

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'COMPARISON_WITHOUT_COMPUTED_RESOLUTION',
    );
  });

  it('refuses two branches where neither is the one taken when it does not hold', () => {
    // Without this the runtime would have to choose by position, and reordering
    // two branches in review would silently invert the decision.
    const { graph, step } = computedGraph({
      left: '${inputs.requestNumber}',
      operator: 'eq',
      right: 'SR-1001',
    });
    step.branches = step.branches.map((branch) => ({
      when: branch.when,
      nextStepId: branch.nextStepId,
    }));

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'COMPUTED_DECISION_BRANCH_SHAPE',
    );
  });

  it('refuses a yes-or-no question with three branches', () => {
    const { graph, step } = computedGraph({
      left: '${inputs.requestNumber}',
      operator: 'eq',
      right: 'SR-1001',
    });
    step.branches = [
      ...step.branches,
      { when: 'a third possibility', nextStepId: 'credential_expired' },
    ];

    expect(validateSopGraph(graph).map((issue) => issue.code)).toContain(
      'COMPUTED_DECISION_BRANCH_SHAPE',
    );
  });
});
