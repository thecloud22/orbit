import { describe, expect, it } from 'vitest';

import {
  isBindableStepKind,
  parseExecutionBinding,
  validateBindingAgainstStep,
  type BoundStepDescription,
} from './validate';
import { clickBinding, extractBinding, fillBinding, FIXTURE_STEP_SHA256 } from './testing/fixtures';

function step(overrides: Partial<BoundStepDescription> = {}): BoundStepDescription {
  return {
    stepId: 'search_request',
    kind: 'click',
    declaredNames: ['requestNumber', 'requestStatus'],
    stepSha256: FIXTURE_STEP_SHA256,
    ...overrides,
  };
}

describe('parseExecutionBinding', () => {
  it('accepts a well-formed binding', () => {
    expect(parseExecutionBinding(clickBinding()).ok).toBe(true);
  });

  it('rejects a CSS selector outright', () => {
    // The closed vocabulary is what makes "no arbitrary selectors" a property
    // of the type rather than a convention.
    const bad = clickBinding();
    const result = parseExecutionBinding({
      ...bad,
      body: {
        ...bad.body,
        target: {
          ...bad.body.target,
          selectors: [{ strategy: 'css', value: 'div > button:nth-child(2)' }],
        },
      },
    });

    expect(result.ok).toBe(false);
  });

  it('cannot express a binding for a manual_review step', () => {
    const result = parseExecutionBinding({
      ...clickBinding(),
      body: { kind: 'manual_review', target: clickBinding().body.target },
    });

    expect(result.ok).toBe(false);
  });

  it('requires at least one selector', () => {
    const bad = clickBinding();
    expect(
      parseExecutionBinding({
        ...bad,
        body: { ...bad.body, target: { ...bad.body.target, selectors: [] } },
      }).ok,
    ).toBe(false);
  });
});

describe('validateBindingAgainstStep', () => {
  it('accepts a binding whose step matches', () => {
    expect(validateBindingAgainstStep(clickBinding(), step())).toEqual([]);
  });

  it('reports a step the workflow does not have', () => {
    expect(validateBindingAgainstStep(clickBinding(), undefined).map((i) => i.code)).toEqual([
      'UNKNOWN_STEP',
    ]);
  });

  it('refuses to bind a manual_review step at all', () => {
    const issues = validateBindingAgainstStep(clickBinding(), step({ kind: 'manual_review' }));

    expect(issues.map((issue) => issue.code)).toEqual(['STEP_NOT_BINDABLE']);
    expect(issues[0]?.message).toContain('routes to a person');
  });

  it('reports a binding whose action does not match the step kind', () => {
    expect(
      validateBindingAgainstStep(clickBinding(), step({ kind: 'fill' })).map((i) => i.code),
    ).toContain('STEP_KIND_MISMATCH');
  });

  it('reports a fill bound to a value the workflow never declared', () => {
    const binding = fillBinding({
      body: {
        ...fillBinding().body,
        kind: 'fill',
        valueSource: { kind: 'sop_variable', name: 'notDeclared' },
      } as never,
    });

    expect(
      validateBindingAgainstStep(binding, step({ stepId: binding.stepId, kind: 'fill' })).map(
        (i) => i.code,
      ),
    ).toContain('UNDECLARED_VARIABLE');
  });

  it('accepts a literal default without consulting the declared names', () => {
    const binding = fillBinding({
      body: {
        ...fillBinding().body,
        kind: 'fill',
        valueSource: { kind: 'literal', value: 'SR-1001' },
      } as never,
    });

    expect(validateBindingAgainstStep(binding, step({ kind: 'fill' }))).toEqual([]);
  });

  it('reports an extract bound to an undeclared variable', () => {
    const binding = extractBinding();
    expect(
      validateBindingAgainstStep(
        binding,
        step({ kind: 'extract', declaredNames: ['somethingElse'] }),
      ).map((i) => i.code),
    ).toContain('UNDECLARED_VARIABLE');
  });

  it('reports a binding as stale once its step has changed', () => {
    // The whole reason a binding is keyed by step rather than by revision: an
    // unrelated edit leaves it alone, and a change to *this* step is caught.
    const issues = validateBindingAgainstStep(clickBinding(), step({ stepSha256: 'b'.repeat(64) }));

    expect(issues.map((issue) => issue.code)).toEqual(['STALE_BINDING']);
    expect(issues[0]?.message).toContain('re-recorded');
  });
});

describe('isBindableStepKind', () => {
  it('excludes manual_review and nothing else', () => {
    expect(isBindableStepKind('manual_review')).toBe(false);
    for (const kind of ['navigate', 'fill', 'click', 'extract', 'decision', 'outcome']) {
      expect(isBindableStepKind(kind)).toBe(true);
    }
  });
});
