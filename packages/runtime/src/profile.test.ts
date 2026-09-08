import type { AgentIr, AgentIrStep } from '@orbit/agent-ir';
import { describe, expect, it } from 'vitest';

import { isRuntimeError, type RuntimeError } from './errors';
import {
  assertExecutableProfile,
  assertNavigable,
  findUnsupportedConstructs,
  SUPPORTED_STEP_TYPES,
  timeoutFor,
} from './profile';
import { loadFixtureAgentIr } from './testing/fixture';

function cloneFixture(): AgentIr {
  return structuredClone(loadFixtureAgentIr());
}

function findStep<T extends AgentIrStep['type']>(
  agentIr: AgentIr,
  type: T,
): Extract<AgentIrStep, { type: T }> {
  const step = agentIr.steps.find((candidate) => candidate.type === type);

  if (step === undefined) {
    throw new Error(`fixture is missing a step of type "${type}"`);
  }

  return step as Extract<AgentIrStep, { type: T }>;
}

function findStepById(agentIr: AgentIr, id: string): AgentIrStep {
  const step = agentIr.steps.find((candidate) => candidate.id === id);

  if (step === undefined) {
    throw new Error(`fixture is missing step "${id}"`);
  }

  return step;
}

function captureRuntimeError(fn: () => unknown): RuntimeError {
  try {
    fn();
  } catch (error) {
    if (isRuntimeError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error('expected function to throw a RuntimeError');
}

describe('findUnsupportedConstructs — the seeded fixture', () => {
  it('yields zero unsupported constructs', () => {
    expect(findUnsupportedConstructs(loadFixtureAgentIr())).toEqual([]);
  });

  it('does not throw from assertExecutableProfile', () => {
    expect(() => assertExecutableProfile(loadFixtureAgentIr())).not.toThrow();
  });
});

describe('findUnsupportedConstructs — individual violations', () => {
  it('reports an unsupported schemaVersion with field "schemaVersion"', () => {
    const agentIr = cloneFixture();
    agentIr.schemaVersion = '0.9';

    const violations = findUnsupportedConstructs(agentIr);

    expect(violations.some((violation) => violation.field === 'schemaVersion')).toBe(true);
  });

  it('reports lifecycle.status "draft" with field "lifecycle.status"', () => {
    const agentIr = cloneFixture();
    agentIr.lifecycle.status = 'draft';

    const violations = findUnsupportedConstructs(agentIr);

    expect(violations.some((violation) => violation.field === 'lifecycle.status')).toBe(true);
  });

  it('reports an unsupported locator strategy', () => {
    const agentIr = cloneFixture();
    const step = findStep(agentIr, 'browser.fill');
    (step.locator as { strategy: string }).strategy = 'css';

    const violations = findUnsupportedConstructs(agentIr);

    expect(violations.some((violation) => violation.field.endsWith('.locator.strategy'))).toBe(
      true,
    );
  });

  it('reports an unsupported assertion type', () => {
    const agentIr = cloneFixture();
    const step = findStep(agentIr, 'browser.assert');
    (step.assertion as { type: string }).type = 'element_count';

    const violations = findUnsupportedConstructs(agentIr);

    expect(violations.some((violation) => violation.field.endsWith('.assertion.type'))).toBe(true);
  });

  it('reports an unsupported extract method', () => {
    const agentIr = cloneFixture();
    const step = findStep(agentIr, 'browser.extract');
    const field = step.fields['requestStatus'];
    if (field === undefined) {
      throw new Error('fixture is missing extract field "requestStatus"');
    }
    (field as { method: string }).method = 'html';

    const violations = findUnsupportedConstructs(agentIr);

    expect(
      violations.some((violation) => violation.field.endsWith('.fields.requestStatus.method')),
    ).toBe(true);
  });

  it('reports an unsupported input value type', () => {
    const agentIr = cloneFixture();
    (agentIr.inputs['requestNumber'] as { type: string }).type = 'number';

    const violations = findUnsupportedConstructs(agentIr);

    expect(violations.some((violation) => violation.field === 'inputs.requestNumber.type')).toBe(
      true,
    );
  });

  it('reports an unsupported variable value type', () => {
    const agentIr = cloneFixture();
    (agentIr.variables['requestStatus'] as { type: string }).type = 'number';

    const violations = findUnsupportedConstructs(agentIr);

    expect(violations.some((violation) => violation.field === 'variables.requestStatus.type')).toBe(
      true,
    );
  });

  it('reports an unsupported output value type', () => {
    const agentIr = cloneFixture();
    (agentIr.outputs['requestNumber'] as { type: string }).type = 'number';

    const violations = findUnsupportedConstructs(agentIr);

    expect(violations.some((violation) => violation.field === 'outputs.requestNumber.type')).toBe(
      true,
    );
  });

  it('returns every violation, not just the first', () => {
    const agentIr = cloneFixture();
    agentIr.schemaVersion = '0.9';
    agentIr.lifecycle.status = 'draft';

    const violations = findUnsupportedConstructs(agentIr);

    expect(violations.length).toBeGreaterThan(1);
    expect(violations.some((violation) => violation.field === 'schemaVersion')).toBe(true);
    expect(violations.some((violation) => violation.field === 'lifecycle.status')).toBe(true);
  });
});

describe('assertExecutableProfile', () => {
  it('throws a RuntimeError with code VALIDATION_ERROR whose details contain the violations', () => {
    const agentIr = cloneFixture();
    agentIr.schemaVersion = '0.9';

    const error = captureRuntimeError(() => assertExecutableProfile(agentIr));

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.some((detail) => detail.field === 'schemaVersion')).toBe(true);
  });
});

describe('assertNavigable', () => {
  it('returns a URL for an allowed localhost target', () => {
    const url = assertNavigable(
      'http://localhost:3001/requests',
      ['localhost'],
      'open_request_portal',
    );

    expect(url).toBeInstanceOf(URL);
    expect(url.href).toBe('http://localhost:3001/requests');
  });

  it('throws NAVIGATION_FAILED for a non-absolute, invalid URL', () => {
    const error = captureRuntimeError(() => assertNavigable('not-a-url', ['localhost'], 'step'));

    expect(error.code).toBe('NAVIGATION_FAILED');
  });

  it('throws NAVIGATION_FAILED for a file: protocol', () => {
    const error = captureRuntimeError(() =>
      assertNavigable('file:///etc/passwd', ['localhost'], 'step'),
    );

    expect(error.code).toBe('NAVIGATION_FAILED');
  });

  it('throws NAVIGATION_FAILED for a javascript: protocol', () => {
    const error = captureRuntimeError(() =>
      assertNavigable('javascript:alert(1)', ['localhost'], 'step'),
    );

    expect(error.code).toBe('NAVIGATION_FAILED');
  });

  it('throws NAVIGATION_FAILED for a host absent from allowedDomains', () => {
    const error = captureRuntimeError(() =>
      assertNavigable('http://localhost:3001/requests', [], 'step'),
    );

    expect(error.code).toBe('NAVIGATION_FAILED');
  });

  it('permits an external host the agent declared, since containment is per agent', () => {
    // There is no blanket host list any more. What an agent may open is what it
    // declared, checked at publish and again here.
    expect(() =>
      assertNavigable('https://www.plano.gov/x', ['www.plano.gov'], 'step'),
    ).not.toThrow();
  });

  it('still refuses a neighbouring host the agent did not declare', () => {
    // The declaration is exact, not a domain suffix: an agent recorded on one
    // host cannot wander to another that merely looks related.
    const error = captureRuntimeError(() =>
      assertNavigable('https://internal.plano.gov/x', ['www.plano.gov'], 'step'),
    );

    expect(error.code).toBe('NAVIGATION_FAILED');
  });
});

describe('timeoutFor', () => {
  it("returns the step's declared timeoutMs when present", () => {
    const agentIr = cloneFixture();
    const step = findStepById(agentIr, 'submit_request_search');
    if (!('timeoutMs' in step)) {
      throw new Error('fixture step "submit_request_search" does not declare timeoutMs');
    }
    step.timeoutMs = 5000;

    expect(timeoutFor(step)).toBe(5000);
  });

  it('returns 30000 for a browser.navigate step with no timeoutMs', () => {
    const agentIr = cloneFixture();
    const step = findStepById(agentIr, 'open_request_portal');
    if (!('timeoutMs' in step)) {
      throw new Error('fixture step "open_request_portal" does not declare timeoutMs');
    }
    delete step.timeoutMs;

    expect(timeoutFor(step)).toBe(30_000);
  });

  it('returns 15000 for another step type with no timeoutMs', () => {
    const agentIr = cloneFixture();
    const step = findStepById(agentIr, 'submit_request_search');
    if (!('timeoutMs' in step)) {
      throw new Error('fixture step "submit_request_search" does not declare timeoutMs');
    }
    delete step.timeoutMs;

    expect(timeoutFor(step)).toBe(15_000);
  });
});

describe('the schema version widening of sub-phase 2.9', () => {
  it('still executes a 0.1 agent unchanged', () => {
    const agentIr = cloneFixture();
    expect(agentIr.schemaVersion).toBe('0.1');
    expect(findUnsupportedConstructs(agentIr)).toEqual([]);
  });

  it('executes a 0.2 agent too', () => {
    const agentIr = cloneFixture();
    agentIr.schemaVersion = '0.2';
    expect(findUnsupportedConstructs(agentIr)).toEqual([]);
  });

  it('refuses a version this runtime has never heard of', () => {
    const agentIr = cloneFixture();
    agentIr.schemaVersion = '0.9';
    expect(
      findUnsupportedConstructs(agentIr).some((violation) => violation.field === 'schemaVersion'),
    ).toBe(true);
  });

  it('lists model.decide as an executable step type', () => {
    expect(SUPPORTED_STEP_TYPES).toContain('model.decide');
  });
});
