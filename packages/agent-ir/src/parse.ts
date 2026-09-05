import { parse as parseYaml } from 'yaml';

import { agentIrSchema, type AgentIr } from './agent-ir';
import { validateAgentIrSemantics, type AgentIrIssue } from './validate';

/**
 * Parsing is pure: these functions accept YAML or JSON *text*, never a
 * filesystem path. @orbit/agent-ir has no filesystem dependency, so callers
 * (the API, the seed script, tests) own reading bytes and this package owns
 * deciding whether those bytes are a valid Agent IR.
 */
export type ParseAgentIrResult =
  | { readonly ok: true; readonly agentIr: AgentIr }
  | { readonly ok: false; readonly issues: readonly AgentIrIssue[] };

/** Validates an already-decoded document: structure first, then cross-field rules. */
export function parseAgentIrDocument(document: unknown): ParseAgentIrResult {
  const parsed = agentIrSchema.safeParse(document);

  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'SCHEMA_ERROR' as const,
        message: issue.message,
        path: issue.path.map((segment) =>
          typeof segment === 'symbol' ? String(segment) : segment,
        ),
      })),
    };
  }

  const issues = validateAgentIrSemantics(parsed.data);

  return issues.length === 0 ? { ok: true, agentIr: parsed.data } : { ok: false, issues };
}

export function parseAgentIrYaml(text: string): ParseAgentIrResult {
  let document: unknown;

  try {
    document = parseYaml(text);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: 'YAML_PARSE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to parse YAML.',
          path: [],
        },
      ],
    };
  }

  return parseAgentIrDocument(document);
}
