import { describe, expect, it } from 'vitest';

import { createEnvCredentialResolver, environmentVariableFor } from './index';

describe('@orbit/credentials', () => {
  it('maps a reference to an environment variable name', () => {
    expect(environmentVariableFor('tsoPassword')).toBe('ORBIT_CREDENTIAL_TSO_PASSWORD');
    expect(environmentVariableFor('token')).toBe('ORBIT_CREDENTIAL_TOKEN');
    expect(environmentVariableFor('api_key')).toBe('ORBIT_CREDENTIAL_API_KEY');
  });

  it('resolves a configured reference', async () => {
    const resolver = createEnvCredentialResolver({
      env: { ORBIT_CREDENTIAL_TSO_PASSWORD: 'hunter2' },
    });
    await expect(resolver.resolve('tsoPassword')).resolves.toBe('hunter2');
  });

  it('reports nothing for a name that is unset or empty', async () => {
    // Empty is treated as unset on purpose: an empty credential is never a
    // credential, and the alternative is typing "" into a live password field.
    const resolver = createEnvCredentialResolver({ env: { ORBIT_CREDENTIAL_TOKEN: '' } });
    await expect(resolver.resolve('token')).resolves.toBeUndefined();
    await expect(resolver.resolve('missing')).resolves.toBeUndefined();
  });

  it('reads the environment on each call rather than snapshotting it', async () => {
    const env: Record<string, string | undefined> = {};
    const resolver = createEnvCredentialResolver({ env });

    await expect(resolver.resolve('token')).resolves.toBeUndefined();
    env['ORBIT_CREDENTIAL_TOKEN'] = 'later';
    await expect(resolver.resolve('token')).resolves.toBe('later');
  });
});
