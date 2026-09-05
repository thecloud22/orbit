import type { Locator } from '@orbit/agent-ir';
import { RuntimeError } from '@orbit/runtime';
import { errors as playwrightErrors } from 'playwright';

/**
 * Playwright failures translated into Orbit's error taxonomy.
 *
 * The composed message never includes Playwright's own text. A Playwright
 * timeout message carries a "call log" that embeds page state, and persisting it
 * would put page content into the database through the error field. The original
 * error travels as `cause` for the worker's logs and stops there.
 */

export function isTimeout(error: unknown): boolean {
  return error instanceof playwrightErrors.TimeoutError;
}

/** Playwright raises this when one locator matches several elements. */
function isStrictModeViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('strict mode violation');
}

function describe(locator: Locator): string {
  return `${locator.strategy}=${locator.value}`;
}

export interface LocatorFailureContext {
  readonly locator: Locator;
  readonly action: string;
  readonly timeoutMs: number;
}

export function classifyLocatorFailure(
  error: unknown,
  context: LocatorFailureContext,
): RuntimeError {
  const locator = describe(context.locator);

  if (isTimeout(error)) {
    return new RuntimeError({
      code: 'LOCATOR_NOT_FOUND',
      message: `${locator} did not become actionable for "${context.action}" within ${context.timeoutMs}ms.`,
      details: [
        { field: 'locator', message: locator },
        { field: 'action', message: context.action },
      ],
      cause: error,
    });
  }

  if (isStrictModeViolation(error)) {
    return new RuntimeError({
      code: 'UNEXPECTED_UI_STATE',
      message: `${locator} matched more than one element, so "${context.action}" is ambiguous.`,
      details: [{ field: 'locator', message: locator }],
      cause: error,
    });
  }

  return new RuntimeError({
    code: 'INTERNAL_ERROR',
    message: `The browser could not perform "${context.action}" on ${locator}.`,
    details: [{ field: 'locator', message: locator }],
    cause: error,
  });
}

export function classifyNavigationFailure(
  error: unknown,
  context: { readonly url: string; readonly timeoutMs: number },
): RuntimeError {
  if (isTimeout(error)) {
    return new RuntimeError({
      code: 'BROWSER_TIMEOUT',
      message: `Navigation did not complete within ${context.timeoutMs}ms.`,
      details: [{ field: 'url', message: context.url }],
      cause: error,
    });
  }

  return new RuntimeError({
    code: 'NAVIGATION_FAILED',
    message: 'The browser could not open the requested page.',
    details: [{ field: 'url', message: context.url }],
    cause: error,
  });
}
