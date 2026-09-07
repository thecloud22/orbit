import { ALLOWED_HOSTS } from '@orbit/runtime';

/**
 * The hosts a compiled workflow may navigate to.
 *
 * Re-exported rather than redeclared. The compiler is pure and must not import
 * `@orbit/runtime`, so it takes the list as an argument — and this is the one
 * place that argument is supplied, so there is still exactly one definition. A
 * second list of permitted hosts is a second thing to keep in step, which is
 * the defect this file exists to make impossible.
 */
export const ALLOWED_HOSTS_FOR_COMPILATION: readonly string[] = ALLOWED_HOSTS;
