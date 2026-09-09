/**
 * Redacting page text before it becomes model input.
 *
 * It lives in @orbit/runtime rather than beside the provider because the
 * runtime is what reads the page and what stores the evidence: redacting in the
 * provider would send clean text to the model and write the raw text to the
 * artifact store, which is the worse half of the problem. One definition, one
 * call site, both paths.
 *
 * A judged decision reads regions of a live page, and page text is broader than
 * an element: a password field's *value* is never captured (the recorder
 * guarantees that, and this never reads an input's value at all), but a page can
 * still render a token, an API key, an account number or an email address in
 * ordinary text. That text is about to leave the machine and be stored as
 * evidence, so it passes through here first — before it is sent *and* before it
 * is stored, from one call site, so the two can never diverge.
 *
 * **This is a reduction, not a guarantee, and the ADR says so.** Pattern
 * matching finds the shapes it knows. It will not recognise a secret that looks
 * like prose, and it may redact a harmless string that looks like a key. The
 * real containment is that a judged decision reads only the regions its Agent
 * Version declares — a small, reviewed, deliberate slice of the page rather
 * than the whole thing.
 */

export const REDACTION_VERSION = 'decision-input-v1';

/** What a redaction replaced, so evidence shows that something was removed. */
export const REDACTED_MARKER = '[redacted]';

interface Rule {
  readonly label: string;
  readonly pattern: RegExp;
}

/**
 * Shapes worth removing, in the order they are applied.
 *
 * Deliberately conservative in what it claims and broad in what it matches:
 * over-redacting a judged decision's input costs a little accuracy on that
 * decision, and under-redacting it sends a live credential to a third party.
 */
const RULES: readonly Rule[] = [
  { label: 'bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi },
  // The tail allows `_` and `-`, because the real shapes are `sk_live_…` and
  // `api-key-…`: a tail of bare alphanumerics matched neither, which is the
  // kind of rule that looks right in review and redacts nothing in production.
  {
    label: 'api key',
    pattern: /\b(?:sk|pk|rk|api|key|token|secret)[-_][A-Za-z0-9][A-Za-z0-9_-]{15,}/gi,
  },
  { label: 'aws access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    label: 'private key block',
    pattern: /-----BEGIN[^-]{0,40}PRIVATE KEY-----[\s\S]*?-----END[^-]{0,40}PRIVATE KEY-----/g,
  },
  { label: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { label: 'email address', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { label: 'payment card number', pattern: /\b(?:\d[ -]?){13,19}\b/g },
];

export interface RedactionResult {
  readonly text: string;
  /** Which rules fired, for the evidence trail. Never the removed values. */
  readonly removed: readonly string[];
}

export function redactForModel(text: string): RedactionResult {
  const removed: string[] = [];
  let output = text;

  for (const rule of RULES) {
    // `test` on a global regex advances lastIndex, so a fresh one is used for
    // the probe. A stateful check here would silently skip every other match.
    if (new RegExp(rule.pattern.source, rule.pattern.flags).test(output)) {
      removed.push(rule.label);
      output = output.replace(rule.pattern, REDACTED_MARKER);
    }
  }

  return { text: output, removed };
}

/**
 * Caps how much page text one decision may send.
 *
 * A cap on input is a cap on cost and on injection surface at the same time,
 * and truncation is marked rather than silent: a judge shown a cut-off page
 * should be able to say so, and a person reading the evidence should be able to
 * see that it was cut off.
 */
export const MAX_SOURCE_CHARACTERS = 4_000;

export function truncateForModel(text: string, limit = MAX_SOURCE_CHARACTERS): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…[truncated]`;
}
