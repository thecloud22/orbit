import type { AgentIr } from '@orbit/agent-ir';
import { describe, expect, it } from 'vitest';

import { assessSandboxReadiness } from './sandbox';

/**
 * The fail-closed check, which is the whole reason it is a precondition.
 *
 * These assert the decision is reachable *from the candidate alone*, before
 * anything has been launched. The test that no browser is started is in
 * `packages/sop-service`, where the thing that would launch one lives.
 */
function candidate(steps: AgentIr['steps']): AgentIr {
  return {
    schemaVersion: '0.1',
    id: 'agent_signin',
    version: '0.1.0',
    name: 'Sign in',
    source: { sopId: 'sop_1', sopVersion: '1', sourceSopStepIds: ['a'] },
    lifecycle: { status: 'draft', trustTier: 'observe' },
    trigger: { type: 'watchtower_manual' },
    inputs: {
      password: { type: 'string', required: true, label: 'Password' },
      username: { type: 'string', required: true, label: 'Username' },
    },
    variables: {},
    outputs: {},
    permissions: { browser: { allowedDomains: ['localhost'], allowedActions: ['fill'] } },
    steps,
  } as unknown as AgentIr;
}

function fill(id: string, value: string): AgentIr['steps'][number] {
  return {
    id,
    sourceSopStepIds: ['a'],
    type: 'browser.fill',
    locator: { strategy: 'test_id', value: id },
    value,
  };
}

describe('sandbox readiness', () => {
  it('refuses to try a workflow that needs a secret Orbit cannot supply', () => {
    const result = assessSandboxReadiness(
      candidate([fill('password_field', '${inputs.password}')]),
      ['password'],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.reason).toBe('secret_unresolvable');
    expect(result.inputIds).toEqual(['password']);
    // The message has to say why nothing was tried, or it reads as a failure
    // to run rather than a refusal to.
    expect(result.message).toContain('opening a browser');
  });

  it('names every secret a run would need, not just the first', () => {
    const result = assessSandboxReadiness(
      candidate([
        fill('a', '${inputs.password}'),
        fill('b', '${inputs.apiToken}'),
        fill('c', '${inputs.username}'),
      ]),
      ['password', 'apiToken'],
    );

    expect(result.ok ? [] : result.inputIds).toEqual(['apiToken', 'password']);
  });

  it('allows a workflow that needs no secret', () => {
    const result = assessSandboxReadiness(candidate([fill('a', '${inputs.username}')]), []);

    expect(result.ok).toBe(true);
  });

  it('allows a workflow that declares a secret but never types it anywhere', () => {
    // Declared and unused means no credential field is ever reached, so there
    // is nothing to fail closed about. Refusing here would block workflows for
    // a risk that does not exist in them.
    const result = assessSandboxReadiness(candidate([fill('a', '${inputs.username}')]), [
      'password',
    ]);

    expect(result.ok).toBe(true);
  });

  it('does not treat a literal that merely looks like a reference as one', () => {
    const result = assessSandboxReadiness(candidate([fill('a', 'password')]), ['password']);

    expect(result.ok).toBe(true);
  });
});
