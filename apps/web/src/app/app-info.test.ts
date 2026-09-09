import { describe, expect, it } from 'vitest';

import { APP_INFO } from './app-info';

describe('Orbit Watchtower', () => {
  it('describes itself', () => {
    expect(APP_INFO.title).toBe('Orbit Watchtower');
    expect(APP_INFO.description.length).toBeGreaterThan(0);
  });
});
