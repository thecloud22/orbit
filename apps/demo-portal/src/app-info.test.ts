import { describe, expect, it } from 'vitest';

import { APP_INFO } from './app-info';

describe('Orbit Demo Portal', () => {
  it('describes itself', () => {
    expect(APP_INFO.title).toBe('Orbit Demo Portal');
    expect(APP_INFO.description.length).toBeGreaterThan(0);
  });
});
