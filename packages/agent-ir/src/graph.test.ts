import { describe, expect, it } from 'vitest';

import type { AgentIrStep } from './steps';
import { successorsOf } from './graph';

function step(partial: Partial<AgentIrStep> & { type: AgentIrStep['type'] }): AgentIrStep {
  return partial as AgentIrStep;
}

describe('successorsOf', () => {
  it('falls through to the next step in order for ordinary steps', () => {
    const click = step({ type: 'browser.click', id: 'a' });
    expect(successorsOf(click, 'b')).toEqual(['b']);
  });

  it('gives complete and fail no successors', () => {
    expect(successorsOf(step({ type: 'complete', id: 'done' }), 'next')).toEqual([]);
    expect(successorsOf(step({ type: 'fail', id: 'boom' }), 'next')).toEqual([]);
  });

  it('branches only to explicit targets, never falling through', () => {
    const branch = step({
      type: 'browser.expect_one_of',
      id: 'detect',
      alternatives: [
        { whenVisible: { strategy: 'test_id', value: 'x' }, next: 'found' },
        { whenVisible: { strategy: 'test_id', value: 'y' }, next: 'missing' },
      ],
    } as unknown as AgentIrStep);

    expect(successorsOf(branch, 'ignored_fallthrough')).toEqual(['found', 'missing']);
  });

  it('has no successor when an ordinary step is last', () => {
    expect(successorsOf(step({ type: 'browser.click', id: 'a' }), undefined)).toEqual([]);
  });
});
