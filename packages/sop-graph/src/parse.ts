import { sopGraphSchema, type SopGraph } from './sop-graph';
import { validateSopGraph, type SopGraphIssue } from './validate';

/**
 * Parsing is pure: these functions accept a decoded document or JSON *text*,
 * never a filesystem path and never a URL. @orbit/sop-graph has no filesystem
 * and no network dependency — callers own reading bytes, and this package owns
 * deciding whether those bytes are a valid SOP Graph.
 *
 * Both structural and semantic validation run here, in that order, because
 * Phase 2.2 will feed this the output of a language model. Model output is
 * untrusted input: it must clear the schema and then the graph rules before
 * anything persists it as a revision.
 */
export type ParseSopGraphResult =
  | { readonly ok: true; readonly graph: SopGraph }
  | { readonly ok: false; readonly issues: readonly SopGraphIssue[] };

export function parseSopGraphDocument(document: unknown): ParseSopGraphResult {
  const parsed = sopGraphSchema.safeParse(document);

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

  const issues = validateSopGraph(parsed.data);

  return issues.length === 0 ? { ok: true, graph: parsed.data } : { ok: false, issues };
}

export function parseSopGraphJson(text: string): ParseSopGraphResult {
  let document: unknown;

  try {
    document = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: 'JSON_PARSE_ERROR',
          message: error instanceof Error ? error.message : 'The document is not valid JSON.',
          path: [],
        },
      ],
    };
  }

  return parseSopGraphDocument(document);
}
