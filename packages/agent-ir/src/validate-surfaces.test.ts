import { describe, expect, it } from 'vitest';

import type { AgentIr } from './agent-ir';
import { validateAgentIrSemantics, type AgentIrIssueCode } from './validate';

/**
 * The semantic validator's coverage of the terminal and API surfaces.
 *
 * `checkReferences` and the definite-assignment pass (`readsOf` plus the
 * "what does this step assign" tracking in `checkDefiniteAssignment`) were
 * written against `browser.fill` and `browser.extract` and never extended
 * when `terminal.type`, `terminal.read` and `api.request.arguments` were
 * added: a step type absent from a `switch` there is silently skipped rather
 * than refused, so an undeclared `${inputs.x}` typed into a terminal field,
 * an undeclared assign target on a screen read, or an undeclared input
 * threaded into an API call argument all passed validation and would have
 * reached a published, immutable Agent Version.
 *
 * No compiler path produces these step types yet (Phase 3's terminal and API
 * tracks), so there is no seeded fixture to mutate the way
 * `__tests__/fixture.test.ts` mutates `find-service-request.agent.yaml`.
 * These documents are hand-built instead, directly against the schemas in
 * `steps.ts` and `permissions.ts`.
 */

const BASE = {
  schemaVersion: '1',
  id: 'agent_validator_surface_test',
  version: '0.1.0',
  name: 'Validator surface test fixture',
  source: {
    sopId: 'sop_validator_surface_test',
    sopVersion: '1',
    sourceSopStepIds: ['s1'],
  },
  lifecycle: { status: 'draft', trustTier: 'observe' },
  trigger: { type: 'watchtower_manual' },
} as const;

function issuesOf(agentIr: AgentIr): readonly AgentIrIssueCode[] {
  return validateAgentIrSemantics(agentIr).map((issue) => issue.code);
}

describe('terminal.type is covered by checkReferences', () => {
  function document(value: string): AgentIr {
    return {
      ...BASE,
      inputs: { screenId: { type: 'string', required: true } },
      variables: {},
      outputs: {},
      permissions: {
        terminal: { allowedHosts: ['mainframe.local'], allowedActions: ['connect', 'type'] },
      },
      steps: [
        {
          id: 'connect',
          sourceSopStepIds: ['s1'],
          type: 'terminal.connect',
          host: 'mainframe.local',
        },
        {
          id: 'type_it',
          sourceSopStepIds: ['s1'],
          type: 'terminal.type',
          address: { strategy: 'named_field', name: 'screen_id_field' },
          value,
        },
        { id: 'done', sourceSopStepIds: ['s1'], type: 'complete', outcome: 'completed' },
      ],
    } as unknown as AgentIr;
  }

  it('accepts a declared input', () => {
    expect(issuesOf(document('${inputs.screenId}'))).not.toContain('UNDECLARED_INPUT_REFERENCE');
  });

  it('refuses an undeclared input, the same as browser.fill would', () => {
    // The bug this guards against: before the fix, `terminal.type` had no case
    // in `checkReferences`'s switch, so this reference was never looked at.
    expect(issuesOf(document('${inputs.notDeclared}'))).toContain('UNDECLARED_INPUT_REFERENCE');
  });
});

describe('terminal.read is covered by checkReferences and definite assignment', () => {
  function document(overrides: {
    assignTarget?: string;
    resultRef?: string;
    variables?: AgentIr['variables'];
    extraStep?: AgentIr['steps'][number];
  }): AgentIr {
    const assignTarget = overrides.assignTarget ?? 'screenName';
    const resultRef = overrides.resultRef ?? '${result.name_field}';

    return {
      ...BASE,
      inputs: {},
      variables: overrides.variables ?? { screenName: { type: 'string' } },
      outputs: {},
      permissions: {
        terminal: {
          allowedHosts: ['mainframe.local'],
          allowedActions: ['connect', 'read', 'type'],
        },
      },
      steps: [
        {
          id: 'connect',
          sourceSopStepIds: ['s1'],
          type: 'terminal.connect',
          host: 'mainframe.local',
        },
        {
          id: 'read_it',
          sourceSopStepIds: ['s1'],
          type: 'terminal.read',
          fields: { name_field: { strategy: 'named_field', name: 'name_field' } },
          assign: { [assignTarget]: resultRef },
        },
        ...(overrides.extraStep === undefined ? [] : [overrides.extraStep]),
        { id: 'done', sourceSopStepIds: ['s1'], type: 'complete', outcome: 'completed' },
      ],
    } as unknown as AgentIr;
  }

  it('accepts a declared assign target reading a field the step declares', () => {
    const issues = issuesOf(document({}));
    expect(issues).not.toContain('UNDECLARED_ASSIGN_TARGET');
    expect(issues).not.toContain('UNKNOWN_EXTRACT_FIELD');
  });

  it('refuses an assign target that names no declared variable', () => {
    // Before the fix, `terminal.read` had no case in `checkReferences`, so an
    // assign target with a typo went unreported -- exactly the check
    // `browser.extract` already gets.
    expect(issuesOf(document({ assignTarget: 'screenName', variables: {} }))).toContain(
      'UNDECLARED_ASSIGN_TARGET',
    );
  });

  it('refuses a result reference that names no field the step reads', () => {
    // `checkValue`'s `UNKNOWN_EXTRACT_FIELD` check was hard-coded to
    // `browser.extract`, so `terminal.read` fell through it silently.
    expect(issuesOf(document({ resultRef: '${result.does_not_exist}' }))).toContain(
      'UNKNOWN_EXTRACT_FIELD',
    );
  });

  it('does not flag a variable assigned only by terminal.read as unassigned downstream', () => {
    // The other half of the same bug: `checkDefiniteAssignment` only knew
    // `browser.extract` and `api.request` as assigning steps, so a variable a
    // screen read produced looked permanently unassigned to every later step
    // -- which would have made a correct terminal workflow refuse to
    // validate at all.
    const issues = issuesOf(
      document({
        extraStep: {
          id: 'type_it',
          sourceSopStepIds: ['s1'],
          type: 'terminal.type',
          address: { strategy: 'named_field', name: 'confirm_field' },
          value: '${variables.screenName}',
        } as AgentIr['steps'][number],
      }),
    );
    expect(issues).not.toContain('VARIABLE_NOT_ASSIGNED_ON_ALL_PATHS');
  });
});

describe('api.request arguments are covered by checkReferences', () => {
  function document(argumentValue: string): AgentIr {
    return {
      ...BASE,
      inputs: { memberId: { type: 'string', required: true } },
      variables: {},
      outputs: {},
      permissions: {
        api: {
          allowedHosts: ['api.example.com'],
          allowedOperations: ['getMember'],
          allowedActions: ['request'],
        },
      },
      steps: [
        {
          id: 'call_it',
          sourceSopStepIds: ['s1'],
          type: 'api.request',
          catalogId: 'members',
          operationId: 'getMember',
          arguments: { id: argumentValue },
        },
        { id: 'done', sourceSopStepIds: ['s1'], type: 'complete', outcome: 'completed' },
      ],
    } as unknown as AgentIr;
  }

  it('accepts a declared input threaded into an argument', () => {
    expect(issuesOf(document('${inputs.memberId}'))).not.toContain('UNDECLARED_INPUT_REFERENCE');
  });

  it('refuses an undeclared input in an argument', () => {
    // Before the fix, the `api.request` case in `checkReferences` only
    // walked `step.assign` -- `step.arguments`, the half of the step that
    // actually reads dynamic values, was never checked at all.
    expect(issuesOf(document('${inputs.notDeclared}'))).toContain('UNDECLARED_INPUT_REFERENCE');
  });

  it('refuses a credential reference in an argument', () => {
    // Authentication goes through `step.auth.credentialRef`, resolved by the
    // runtime and never serialized (ADR-038). An argument is a request value
    // that does get serialized, so `${credentials.x}` here must be refused
    // the same way it would be in an assertion or an output.
    expect(issuesOf(document('${credentials.apiToken}'))).toContain('REFERENCE_NOT_ALLOWED_HERE');
  });
});
