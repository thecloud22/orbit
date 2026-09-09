import { describe, expect, it } from 'vitest';

import { APP_INFO } from './app-info';

describe('Fairview Township Public Library', () => {
  it('describes itself', () => {
    expect(APP_INFO.title).toBe('Fairview Township Public Library');
    expect(APP_INFO.description.length).toBeGreaterThan(0);
  });
});
