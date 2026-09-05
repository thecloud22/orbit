import type { AgentIr, AgentIrStep, Assertion, Locator } from '@orbit/agent-ir';

import { RuntimeError, type ErrorDetail } from './errors';

/**
 * The Task 6 runtime profile.
 *
 * Agent IR is a broader contract than any one runtime has to implement, so the
 * profile is an explicit allowlist of what this runtime executes rather than an
 * assumption that whatever validates can be run. Every list below is `as const`
 * and checked exhaustively, so widening the profile is a deliberate edit and
 * never an accident.
 */

export const SUPPORTED_SCHEMA_VERSIONS = ['0.1'] as const;
export const SUPPORTED_LIFECYCLE_STATUSES = ['published'] as const;
export const SUPPORTED_TRIGGER_TYPES = ['watchtower_manual'] as const;

export const SUPPORTED_STEP_TYPES = [
  'browser.navigate',
  'browser.fill',
  'browser.click',
  'browser.expect_one_of',
  'browser.assert',
  'browser.extract',
  'complete',
  'fail',
] as const;

export const SUPPORTED_LOCATOR_STRATEGIES = ['test_id'] as const;
export const SUPPORTED_ASSERTION_TYPES = ['locator_visible', 'locator_has_text'] as const;
export const SUPPORTED_EXTRACT_METHODS = ['text'] as const;
export const SUPPORTED_VALUE_TYPES = ['string'] as const;

/** Phase 1 automates the local demo portal and nothing else (CLAUDE.md > Browser and security rules). */
export const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'] as const;
export const ALLOWED_PROTOCOLS = ['http:', 'https:'] as const;

export const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
export const DEFAULT_STEP_TIMEOUT_MS = 15_000;

function includes(values: readonly string[], candidate: string): boolean {
  return values.includes(candidate);
}

/** Every locator a step resolves, with the path that names it. */
function locatorsOf(step: AgentIrStep): readonly (readonly [Locator, string])[] {
  switch (step.type) {
    case 'browser.fill':
    case 'browser.click':
      return [[step.locator, 'locator']];
    case 'browser.navigate':
      return (step.assertions ?? []).flatMap((assertion, index) =>
        assertionLocators(assertion, `assertions[${index}]`),
      );
    case 'browser.assert':
      return assertionLocators(step.assertion, 'assertion');
    case 'browser.expect_one_of':
      return step.alternatives.map(
        (alternative, index) =>
          [alternative.whenVisible, `alternatives[${index}].whenVisible`] as const,
      );
    case 'browser.extract':
      return Object.entries(step.fields).map(
        ([name, field]) => [field.locator, `fields.${name}.locator`] as const,
      );
    case 'complete':
    case 'fail':
      return [];
  }
}

function assertionLocators(
  assertion: Assertion,
  path: string,
): readonly (readonly [Locator, string])[] {
  return [[assertion.locator, `${path}.locator`] as const];
}

function assertionsOf(step: AgentIrStep): readonly (readonly [Assertion, string])[] {
  switch (step.type) {
    case 'browser.navigate':
      return (step.assertions ?? []).map(
        (assertion, index) => [assertion, `assertions[${index}]`] as const,
      );
    case 'browser.assert':
      return [[step.assertion, 'assertion'] as const];
    default:
      return [];
  }
}

/**
 * Rejects a navigation target the runtime is not permitted to open.
 *
 * The semantic validator already checked this when the version was published;
 * this is the last gate before the network, and it additionally enforces the
 * Phase 1 localhost allowlist, which is a runtime policy rather than a property
 * of the Agent IR document.
 */
export function assertNavigable(
  url: string,
  allowedDomains: readonly string[],
  agentStepId: string,
): URL {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new RuntimeError({
      code: 'NAVIGATION_FAILED',
      message: `Step "${agentStepId}" declares a navigation target that is not a valid absolute URL.`,
      details: [{ field: 'url', message: url }],
      agentStepId,
    });
  }

  if (!includes(ALLOWED_PROTOCOLS, parsed.protocol)) {
    throw new RuntimeError({
      code: 'NAVIGATION_FAILED',
      message: `Step "${agentStepId}" declares protocol "${parsed.protocol}", which the runtime does not permit.`,
      details: [{ field: 'url.protocol', message: parsed.protocol }],
      agentStepId,
    });
  }

  if (!allowedDomains.includes(parsed.hostname)) {
    throw new RuntimeError({
      code: 'NAVIGATION_FAILED',
      message: `Step "${agentStepId}" navigates to a host the Agent Version does not permit.`,
      details: [{ field: 'url.hostname', message: parsed.hostname }],
      agentStepId,
    });
  }

  if (!includes(ALLOWED_HOSTS, parsed.hostname)) {
    throw new RuntimeError({
      code: 'NAVIGATION_FAILED',
      message: `Step "${agentStepId}" navigates outside the Phase 1 localhost allowlist.`,
      details: [{ field: 'url.hostname', message: parsed.hostname }],
      agentStepId,
    });
  }

  return parsed;
}

/**
 * Checks a whole Agent IR against the profile.
 *
 * Returns every violation rather than the first, so an unsupported version is
 * reported completely instead of one problem at a time. Runs before the run row
 * is created and before a browser is launched.
 */
export function findUnsupportedConstructs(agentIr: AgentIr): readonly ErrorDetail[] {
  const details: ErrorDetail[] = [];

  if (!includes(SUPPORTED_SCHEMA_VERSIONS, agentIr.schemaVersion)) {
    details.push({
      field: 'schemaVersion',
      message: `"${agentIr.schemaVersion}" is not executable by this runtime; supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}.`,
    });
  }

  if (!includes(SUPPORTED_LIFECYCLE_STATUSES, agentIr.lifecycle.status)) {
    details.push({
      field: 'lifecycle.status',
      message: `Only a published Agent Version may be executed; this one is "${agentIr.lifecycle.status}".`,
    });
  }

  if (!includes(SUPPORTED_TRIGGER_TYPES, agentIr.trigger.type)) {
    details.push({
      field: 'trigger.type',
      message: `"${agentIr.trigger.type}" is not a trigger this runtime executes.`,
    });
  }

  for (const [name, declaration] of Object.entries(agentIr.inputs)) {
    if (!includes(SUPPORTED_VALUE_TYPES, declaration.type)) {
      details.push({
        field: `inputs.${name}.type`,
        message: `"${declaration.type}" is not supported.`,
      });
    }
  }

  for (const [name, declaration] of Object.entries(agentIr.variables)) {
    if (!includes(SUPPORTED_VALUE_TYPES, declaration.type)) {
      details.push({
        field: `variables.${name}.type`,
        message: `"${declaration.type}" is not supported.`,
      });
    }
  }

  for (const [name, declaration] of Object.entries(agentIr.outputs)) {
    if (!includes(SUPPORTED_VALUE_TYPES, declaration.type)) {
      details.push({
        field: `outputs.${name}.type`,
        message: `"${declaration.type}" is not supported.`,
      });
    }
  }

  agentIr.steps.forEach((step, index) => {
    const at = `steps[${index}]`;

    if (!includes(SUPPORTED_STEP_TYPES, step.type)) {
      details.push({
        field: `${at}.type`,
        message: `"${step.type}" is not a step type this runtime executes.`,
      });
    }

    for (const [locator, path] of locatorsOf(step)) {
      if (!includes(SUPPORTED_LOCATOR_STRATEGIES, locator.strategy)) {
        details.push({
          field: `${at}.${path}.strategy`,
          message: `"${locator.strategy}" is not a locator strategy this runtime resolves.`,
        });
      }
    }

    for (const [assertion, path] of assertionsOf(step)) {
      if (!includes(SUPPORTED_ASSERTION_TYPES, assertion.type)) {
        details.push({
          field: `${at}.${path}.type`,
          message: `"${assertion.type}" is not an assertion this runtime evaluates.`,
        });
      }
    }

    if (step.type === 'browser.extract') {
      for (const [name, field] of Object.entries(step.fields)) {
        if (!includes(SUPPORTED_EXTRACT_METHODS, field.method)) {
          details.push({
            field: `${at}.fields.${name}.method`,
            message: `"${field.method}" is not an extraction method this runtime performs.`,
          });
        }
      }
    }

    if (step.type === 'browser.navigate') {
      try {
        assertNavigable(step.url, agentIr.permissions.browser.allowedDomains, step.id);
      } catch (error) {
        details.push({
          field: `${at}.url`,
          message:
            error instanceof RuntimeError ? error.message : `"${step.url}" is not navigable.`,
        });
      }
    }
  });

  return details;
}

/**
 * The gate every execution passes before a run exists.
 *
 * A version the runtime cannot execute never produces a run row: there is
 * nothing to record about an execution that was refused before it began, and
 * the same is necessarily true of a version that is missing or whose checksum
 * no longer matches, so all four rejections behave alike.
 */
export function assertExecutableProfile(agentIr: AgentIr): void {
  const details = findUnsupportedConstructs(agentIr);

  if (details.length > 0) {
    throw new RuntimeError({
      code: 'VALIDATION_ERROR',
      message: `Agent Version ${agentIr.id} ${agentIr.version} declares constructs this runtime does not support.`,
      details,
    });
  }
}

/** The effective timeout for a step: what the IR declares, else the Phase 1 default. */
export function timeoutFor(step: AgentIrStep): number {
  const declared = 'timeoutMs' in step ? step.timeoutMs : undefined;

  if (declared !== undefined) {
    return declared;
  }

  return step.type === 'browser.navigate' ? DEFAULT_NAVIGATION_TIMEOUT_MS : DEFAULT_STEP_TIMEOUT_MS;
}
