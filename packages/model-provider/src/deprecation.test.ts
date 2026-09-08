import { beforeEach, describe, expect, it } from 'vitest';

import { noticeDeprecations, resetDeprecationNotices } from './deprecation';
import { resolveModelSelection } from './selection';

describe('noticeDeprecations', () => {
  beforeEach(() => {
    resetDeprecationNotices();
  });

  it('says each thing once, however many times it is told', () => {
    // The browser worker resolves a selection for the judge and may later
    // resolve one for something else. A person should not be told twice.
    const said: string[] = [];

    noticeDeprecations(['old name A', 'old name B'], (message) => said.push(message));
    noticeDeprecations(['old name A'], (message) => said.push(message));

    expect(said).toEqual(['old name A', 'old name B']);
  });

  it('says nothing when there is nothing to say', () => {
    const said: string[] = [];

    noticeDeprecations([], (message) => said.push(message));

    expect(said).toEqual([]);
  });

  it('warns rather than failing, so a working .env keeps working', () => {
    const resolution = resolveModelSelection({
      ORBIT_LLM_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-test',
    });

    expect(resolution.status).toBe('configured');

    const said: string[] = [];
    expect(() => {
      noticeDeprecations(resolution.deprecations, (message) => said.push(message));
    }).not.toThrow();

    expect(said).toHaveLength(1);
    expect(said[0]).toContain('LLM_PROVIDER=anthropic');
  });
});
