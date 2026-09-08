/**
 * Resolving a credential reference from deployment configuration.
 *
 * This is the whole feature, and it is deliberately small. There is no vault, no
 * rotation, no scoping, no per-tenant isolation and no UI; those are Phase 5 in
 * the vision document and they stay there. What exists is the seam ADR-038
 * needs: a name in a published Agent Version resolves to a value the deployment
 * holds, at the moment it is used.
 *
 * It implements `CredentialResolver` from @orbit/runtime **structurally rather
 * than by importing it**, so the runtime's boundary tests keep proving that
 * @orbit/runtime reaches no implementation of its own ports.
 */

export const PACKAGE_NAME = '@orbit/credentials' as const;

/** The environment prefix a credential reference is looked up under. */
export const CREDENTIAL_ENV_PREFIX = 'ORBIT_CREDENTIAL_';

/**
 * The variable a reference reads from: `tsoPassword` -> `ORBIT_CREDENTIAL_TSO_PASSWORD`.
 *
 * Upper snake case because that is what an environment variable looks like, and
 * a reference is `[A-Za-z][A-Za-z0-9_]*` by the Agent IR grammar, so this
 * mapping is total and reversible enough to report in a configuration error.
 */
export function environmentVariableFor(reference: string): string {
  const snake = reference
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/__+/g, '_')
    .toUpperCase();

  return `${CREDENTIAL_ENV_PREFIX}${snake}`;
}

export interface EnvCredentialResolverOptions {
  /** Defaults to `process.env`. Injected so the resolver is testable without mutating it. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * A resolver backed by environment variables.
 *
 * Returns `undefined` for a name the deployment has not configured rather than
 * throwing, because the caller is what decides the consequence — and the
 * consequence is failing the step, never typing an empty string into a live
 * credential field.
 *
 * The value is read on each call rather than snapshotted at construction. That
 * costs nothing and means a resolver holds no secret in memory between uses.
 */
export function createEnvCredentialResolver(options: EnvCredentialResolverOptions = {}) {
  const env = options.env ?? process.env;

  return {
    resolve(reference: string): Promise<string | undefined> {
      const value = env[environmentVariableFor(reference)];
      return Promise.resolve(value === undefined || value === '' ? undefined : value);
    },
  };
}
