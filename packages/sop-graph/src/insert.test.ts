import { describe, expect, it } from 'vitest';

import { generateStepId, slugForStepId, sopStepDraftSchema, type SopStepDraft } from './steps';

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

describe('naming a step after what it is for', () => {
  const click = (purpose: string): SopStepDraft => ({
    kind: 'click',
    targetHint: 'Something',
    purpose,
  });

  it('derives the id from the words the author already wrote', () => {
    // Nobody is asked to name anything. The purpose is a sentence they were
    // writing regardless, and it is the same one `describeStep` shows a
    // reviewer -- so the id and the label cannot describe different things.
    expect(generateStepId([], click('Attach the mortgage insurance condition'))).toBe(
      'attach_the_mortgage_insurance_condition',
    );
  });

  it('names a decision after its question rather than its purpose', () => {
    const decision: SopStepDraft = {
      kind: 'decision',
      question: 'Is debt-to-income above the limit?',
      branches: [
        { when: 'yes', nextStepId: 'escalate' },
        { when: 'no', nextStepId: 'approve', otherwise: true },
      ],
    };

    expect(generateStepId([], decision)).toBe('is_debt_to_income_above_the_limit');
  });

  it('numbers a derived name only when it is already taken', () => {
    const step = click('Approve the file');

    expect(generateStepId([], step)).toBe('approve_the_file');
    expect(generateStepId(['approve_the_file'], step)).toBe('approve_the_file_2');
    expect(generateStepId(['approve_the_file', 'approve_the_file_2'], step)).toBe(
      'approve_the_file_3',
    );
  });

  it('falls back to the numbered kind when no usable words survive', () => {
    // Punctuation alone, and a purpose starting with a digit: both would
    // produce an id the grammar rejects, so neither is used.
    expect(generateStepId([], click('!!! ???'))).toBe('click_1');
    expect(generateStepId([], click('2 factor authentication'))).toBe('click_1');
  });

  it('always produces an id the graph grammar accepts', () => {
    for (const purpose of ['Attach it', '  spaced  out  ', 'Ends with punctuation!!!', 'é—ü']) {
      expect(generateStepId([], click(purpose))).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe('slugForStepId', () => {
  it('cuts a long label back to a word boundary, never mid-word', () => {
    // The entire reason for deriving an id from words is that somebody reads it
    // afterwards, and a truncated word is worse than a number would have been.
    const slug = slugForStepId(
      'Attach the private mortgage insurance condition before closing the file',
    );

    expect(slug).toBe('attach_the_private_mortgage_insurance');
    expect(slug?.length).toBeLessThanOrEqual(40);
    expect(slug?.endsWith('_')).toBe(false);
  });

  it('returns null when nothing usable survives', () => {
    expect(slugForStepId('')).toBeNull();
    expect(slugForStepId('   ')).toBeNull();
    expect(slugForStepId('!!!')).toBeNull();
    expect(slugForStepId('9 lives')).toBeNull();
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
