import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index';

describe('@orbit/db', () => {
  it('exposes its package identity', () => {
    expect(PACKAGE_NAME).toBe('@orbit/db');
  });
});
