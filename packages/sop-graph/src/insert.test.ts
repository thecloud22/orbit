import { describe, expect, it } from 'vitest';

import { generateStepId, sopStepDraftSchema } from './steps';

describe('generating a step id', () => {
  it('names the id after the kind and numbers it', () => {
    expect(generateStepId([], 'click')).toBe('click_1');
    expect(generateStepId(['click_1'], 'click')).toBe('click_2');
  });

  it('never collides, even when the numbering has holes', () => {
    // `click_2` exists but `click_1` does not, so counting alone would propose
    // a name already taken. A person can also write any id they like in a
    // fixture, so the guarantee has to be the loop rather than the count.
    expect(generateStepId(['click_2'], 'click')).toBe('click_3');
    expect(generateStepId(['click_1', 'click_2', 'click_4'], 'click')).toBe('click_5');
  });

  it('produces an id the graph grammar accepts', () => {
    for (const kind of ['navigate', 'manual_review', 'outcome'] as const) {
      expect(generateStepId([], kind)).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('counts only ids belonging to that kind', () => {
    expect(generateStepId(['fill_1', 'fill_2'], 'click')).toBe('click_1');
  });
});

describe('the step draft schema', () => {
  it('accepts a step with no id, and rejects one carrying its own', () => {
    const draft = { kind: 'click', targetHint: 'Search', purpose: 'Run the search' };

    expect(sopStepDraftSchema.safeParse(draft).success).toBe(true);
    // Strict objects: an id supplied by a caller is refused rather than used,
    // so nobody can smuggle in a name that collides or rewires a branch.
    expect(sopStepDraftSchema.safeParse({ ...draft, id: 'search' }).success).toBe(false);
  });
});
