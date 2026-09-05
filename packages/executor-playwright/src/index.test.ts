import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index';

describe('@orbit/executor-playwright', () => {
  it('exposes its package identity', () => {
    expect(PACKAGE_NAME).toBe('@orbit/executor-playwright');
  });
});
