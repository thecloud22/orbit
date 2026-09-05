import type { AgentIr } from '@orbit/agent-ir';
import { runInputsSchema, type RunInputs } from '@orbit/contracts';

import { RuntimeError, type ErrorDetail } from './errors';

/**
 * Validates run inputs against the Agent Version's own declarations.
 *
 * CLAUDE.md requires inputs to be validated before a run is created or
 * dispatched, so this runs ahead of run creation and a rejection leaves no run
 * row behind. It lives here rather than in the entry point because Task 7's API
 * must apply exactly these rules — two implementations would eventually
 * disagree about what a valid request is.
 */
export function validateRunInputs(
  declarations: AgentIr['inputs'],
  raw: Readonly<Record<string, unknown>>,
): RunInputs {
  const details: ErrorDetail[] = [];
  const accepted: Record<string, string> = {};

  for (const name of Object.keys(raw)) {
    if (declarations[name] === undefined) {
      details.push({ field: name, message: 'is not a declared input of this Agent Version.' });
    }
  }

  for (const [name, declaration] of Object.entries(declarations)) {
    const value = raw[name];

    if (value === undefined || value === null) {
      if (declaration.required) {
        details.push({ field: name, message: `is required (${declaration.label}).` });
      }
      continue;
    }

    if (typeof value !== 'string') {
      details.push({ field: name, message: `must be a ${declaration.type}.` });
      continue;
    }

    const { minLength, maxLength } = declaration.validation ?? {};

    if (minLength !== undefined && value.length < minLength) {
      details.push({ field: name, message: `must be at least ${minLength} character(s).` });
      continue;
    }

    if (maxLength !== undefined && value.length > maxLength) {
      details.push({ field: name, message: `must be at most ${maxLength} character(s).` });
      continue;
    }

    accepted[name] = value;
  }

  if (details.length > 0) {
    throw new RuntimeError({
      code: 'INPUT_ERROR',
      message: 'The supplied run inputs do not satisfy the Agent Version input declarations.',
      details,
    });
  }

  return runInputsSchema.parse(accepted);
}
