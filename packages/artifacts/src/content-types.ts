import { artifactKindSchema, type ArtifactKind } from '@orbit/contracts';

/**
 * The media type and filename extension each artifact kind is stored as.
 *
 * `satisfies Record<ArtifactKind, …>` makes adding a kind to
 * `artifactKindSchema` without deciding how it is stored a compile error,
 * rather than something discovered when a run tries to write one.
 */
export const ARTIFACT_KIND_CONTENT_TYPES = {
  browser_screenshot: 'image/png',
  dom_snapshot: 'text/html; charset=utf-8',
  browser_trace: 'application/zip',
  terminal_screen: 'text/plain; charset=utf-8',
  extracted_json: 'application/json',
  error_context: 'application/json',
  /** The judge's input as JSON: the question, the alternatives, the page text. */
  decision_input: 'application/json',
} as const satisfies Record<ArtifactKind, string>;

export const ARTIFACT_KIND_EXTENSIONS = {
  browser_screenshot: 'png',
  dom_snapshot: 'html',
  browser_trace: 'zip',
  terminal_screen: 'txt',
  extracted_json: 'json',
  error_context: 'json',
  decision_input: 'json',
} as const satisfies Record<ArtifactKind, string>;

export function defaultContentTypeForKind(kind: ArtifactKind): string {
  return ARTIFACT_KIND_CONTENT_TYPES[kind];
}

export function extensionForKind(kind: ArtifactKind): string {
  return ARTIFACT_KIND_EXTENSIONS[kind];
}

/** Every kind the contract declares, for exhaustiveness tests. */
export const ARTIFACT_KINDS = artifactKindSchema.options;
