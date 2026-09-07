import type { SelectorChain } from '@orbit/execution-mapping';
import { buttonFingerprint, fieldFingerprint } from '@orbit/execution-mapping/testing';
import { escalationReviewGraph } from '@orbit/sop-graph/testing';
import type { SopStep } from '@orbit/sop-graph';
import { describe, expect, it } from 'vitest';

import {
  bindingBodyFor,
  captureModeForStepKind,
  declaredNames,
  defaultValueSourceFor,
  type BindingCapture,
} from './binding-service';

/**
 * The decisions the terminal and Watchtower must make identically.
 *
 * Both paths assemble a binding from a capture and one judgement, and the whole
 * reason this lives in @orbit/sop-service is that there must be exactly one
 * answer for each. These are that answer.
 */
const GRAPH = escalationReviewGraph();

function step(id: string): SopStep {
  const found = GRAPH.steps.find((candidate) => candidate.id === id);

  if (found === undefined) {
    throw new Error(`The fixture has no step "${id}".`);
  }

  return found;
}

const SELECTORS = [{ strategy: 'test_id', value: 'request-number-input' }] as SelectorChain;

const CAPTURE: BindingCapture = {
  selectors: SELECTORS,
  fingerprint: fieldFingerprint(),
  url: 'http://localhost:3001/requests',
  typedValue: 'SR-1001',
};

describe('bindingBodyFor', () => {
  it('builds a fill body carrying the chosen value source, never the typed value', () => {
    const result = bindingBodyFor({
      step: step('enter_request_number'),
      capture: CAPTURE,
      choice: { kind: 'fill', valueSource: { kind: 'sop_variable', name: 'requestNumber' } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toEqual({
      kind: 'fill',
      target: { selectors: SELECTORS, fingerprint: fieldFingerprint() },
      valueSource: { kind: 'sop_variable', name: 'requestNumber' },
    });
    expect(JSON.stringify(result.body)).not.toContain('SR-1001');
  });

  it('builds a click body, which decides nothing beyond the element', () => {
    const result = bindingBodyFor({
      step: step('sign_in'),
      capture: { ...CAPTURE, fingerprint: buttonFingerprint() },
      choice: { kind: 'click' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.kind).toBe('click');
  });

  it('builds an extract body with the read method and variable it was given', () => {
    const result = bindingBodyFor({
      step: step('extract_request_details'),
      capture: CAPTURE,
      choice: { kind: 'extract', readMethod: { kind: 'text' }, variable: 'status' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      kind: 'extract',
      readMethod: { kind: 'text' },
      variable: 'status',
    });
  });

  it('records where the page was for a navigate body', () => {
    const result = bindingBodyFor({
      step: step('open_portal'),
      capture: CAPTURE,
      choice: { kind: 'navigate' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({ kind: 'navigate', url: 'http://localhost:3001/requests' });
  });

  it('refuses a step that routes to a person, in words rather than a schema error', () => {
    const result = bindingBodyFor({
      step: step('credential_expired'),
      capture: CAPTURE,
      choice: { kind: 'click' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('routes to a person');
  });

  it('refuses a decision that does not match the step it claims to bind', () => {
    const result = bindingBodyFor({
      step: step('sign_in'),
      capture: CAPTURE,
      choice: { kind: 'fill', valueSource: { kind: 'literal', value: 'x' } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('"click" step');
  });
});

describe('defaultValueSourceFor', () => {
  it('reads a reference straight off the step, so a drafted fill needs no second answer', () => {
    expect(defaultValueSourceFor(step('enter_request_number'))).toEqual({
      kind: 'sop_variable',
      name: 'requestNumber',
    });
  });

  it('never derives a value for a password field', () => {
    // The step declares `${inputs.password}`, and the binding still gets an
    // empty placeholder: nothing about a secret field belongs in a durable
    // artifact this phase does not protect.
    expect(defaultValueSourceFor(step('enter_password'))).toEqual({ kind: 'literal', value: '' });
  });

  it('keeps a literal a drafted step already states', () => {
    const literalFill: SopStep = {
      id: 'enter_fixed',
      kind: 'fill',
      fieldHint: 'Region',
      value: 'EMEA',
      purpose: 'Fill the region',
    };

    expect(defaultValueSourceFor(literalFill)).toEqual({ kind: 'literal', value: 'EMEA' });
  });

  it('derives nothing from a malformed reference, so the defect is reported not hidden', () => {
    const brokenFill: SopStep = {
      id: 'enter_broken',
      kind: 'fill',
      fieldHint: 'Request number',
      value: '${inputs.requestNumber',
      purpose: 'Fill the request number',
    };

    expect(defaultValueSourceFor(brokenFill)).toBeNull();
  });

  it('has no answer for a step that fills nothing', () => {
    expect(defaultValueSourceFor(step('sign_in'))).toBeNull();
  });
});

describe('captureModeForStepKind', () => {
  it('has the person perform an action for the kinds that act', () => {
    expect(captureModeForStepKind('click')).toBe('action');
    expect(captureModeForStepKind('fill')).toBe('action');
    expect(captureModeForStepKind('navigate')).toBe('action');
  });

  it('has the person point at a value for the kinds that read', () => {
    expect(captureModeForStepKind('extract')).toBe('pick');
    expect(captureModeForStepKind('decision')).toBe('pick');
    expect(captureModeForStepKind('outcome')).toBe('pick');
  });
});

describe('declaredNames', () => {
  it('offers exactly the inputs and produced variables the graph declares', () => {
    const names = declaredNames(GRAPH);

    expect(names).toContain('requestNumber');
    expect(names).toContain('status');
    expect(names).not.toContain('nothingDeclaresThis');
  });

  it('is sorted, so two callers listing them agree on the order', () => {
    const names = declaredNames(GRAPH);
    expect([...names].sort()).toEqual(names);
  });
});
