import type { ExecutionBinding } from '../binding';
import { EXECUTION_BINDING_SCHEMA_VERSION } from '../binding';
import type { ElementFingerprint } from '../fingerprint';

/**
 * Bindings the tests use.
 *
 * Hand-authored, exactly as Phase 1 hand-authored its Agent IR fixture before
 * anything generated one. Sub-phase 2.4b's recorder will produce these for
 * real; until then a fixture is what proves the contract, the lifecycle, and
 * the drift check work.
 */
const SHA = 'a'.repeat(64);

export function buttonFingerprint(): ElementFingerprint {
  return {
    role: 'button',
    accessibleName: 'Search',
    text: 'Search',
    boundingBox: { x: 604, y: 142, width: 78, height: 36 },
  };
}

export function fieldFingerprint(): ElementFingerprint {
  return {
    role: 'textbox',
    accessibleName: 'Service request number',
    text: '',
    boundingBox: { x: 336, y: 140, width: 256, height: 38 },
  };
}

export function statusFingerprint(): ElementFingerprint {
  return {
    role: 'definition',
    accessibleName: null,
    text: 'In Progress',
    boundingBox: { x: 0, y: 0, width: 200, height: 20 },
  };
}

export function clickBinding(overrides: Partial<ExecutionBinding> = {}): ExecutionBinding {
  return {
    schemaVersion: EXECUTION_BINDING_SCHEMA_VERSION,
    stepId: 'search_request',
    body: {
      kind: 'click',
      target: {
        selectors: [
          { strategy: 'test_id', value: 'search-request-button' },
          { strategy: 'role_and_name', value: 'button', name: 'Search' },
        ],
        fingerprint: buttonFingerprint(),
      },
    },
    capturedAgainstRevisionId: 'soprev_fixture',
    stepSha256: SHA,
    ...overrides,
  };
}

export function fillBinding(overrides: Partial<ExecutionBinding> = {}): ExecutionBinding {
  return {
    schemaVersion: EXECUTION_BINDING_SCHEMA_VERSION,
    stepId: 'enter_request_number',
    body: {
      kind: 'fill',
      target: {
        selectors: [{ strategy: 'test_id', value: 'request-number-input' }],
        fingerprint: fieldFingerprint(),
      },
      valueSource: { kind: 'sop_variable', name: 'requestNumber' },
    },
    capturedAgainstRevisionId: 'soprev_fixture',
    stepSha256: SHA,
    ...overrides,
  };
}

export function extractBinding(overrides: Partial<ExecutionBinding> = {}): ExecutionBinding {
  return {
    schemaVersion: EXECUTION_BINDING_SCHEMA_VERSION,
    stepId: 'extract_request_details',
    body: {
      kind: 'extract',
      target: {
        selectors: [{ strategy: 'test_id', value: 'request-status' }],
        fingerprint: statusFingerprint(),
      },
      readMethod: { kind: 'text' },
      variable: 'requestStatus',
    },
    capturedAgainstRevisionId: 'soprev_fixture',
    stepSha256: SHA,
    ...overrides,
  };
}

export const FIXTURE_STEP_SHA256 = SHA;
