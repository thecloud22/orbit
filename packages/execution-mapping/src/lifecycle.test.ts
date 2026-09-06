import { describe, expect, it } from 'vitest';

import {
  BINDING_STATES,
  BINDING_TRANSITIONS,
  isExecutable,
  statesAllowedToReach,
} from './lifecycle';

describe('the binding lifecycle', () => {
  it('is terminal at superseded', () => {
    expect(BINDING_TRANSITIONS.superseded).toEqual([]);
  });

  it('lets any state be superseded, because re-recording replaces whatever came before', () => {
    for (const state of BINDING_STATES.filter((s) => s !== 'superseded')) {
      expect(BINDING_TRANSITIONS[state]).toContain('superseded');
    }
  });

  it('never lets a draft be approved without review', () => {
    expect(BINDING_TRANSITIONS.draft).not.toContain('approved');
    expect(BINDING_TRANSITIONS.draft).not.toContain('rejected');
  });

  it('lets a reviewer send a binding back to draft to be re-recorded', () => {
    expect(BINDING_TRANSITIONS.needs_review).toContain('draft');
  });

  it('computes the states permitted to reach a target from the table', () => {
    expect([...statesAllowedToReach('approved')]).toEqual(['needs_review']);
    expect([...statesAllowedToReach('needs_review')]).toEqual(['draft']);
    expect([...statesAllowedToReach('superseded')].sort()).toEqual([
      'approved',
      'draft',
      'needs_review',
      'rejected',
    ]);
  });

  it('only an approved binding may drive a real action', () => {
    for (const state of BINDING_STATES) {
      expect(isExecutable(state)).toBe(state === 'approved');
    }
  });
});
