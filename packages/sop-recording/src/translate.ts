import {
  EXECUTION_BINDING_SCHEMA_VERSION,
  type BindingBody,
  type ElementFingerprint,
  type SelectorChain,
} from '@orbit/execution-mapping';
import { withoutFocusClicks } from './normalize';
import {
  SOP_GRAPH_SCHEMA_VERSION,
  parseSopGraphDocument,
  slugForStepId,
  type SopGraph,
  type SopGraphIssue,
  type SopStep,
} from '@orbit/sop-graph';

/**
 * Turning a recording into a workflow.
 *
 * A person performed a task once, and every click, fill and page change was
 * captured with the element it touched. This turns that sequence into a SOP
 * Graph and one Execution Binding per step — together, because both describe
 * the same real interaction and deriving them separately would let them
 * disagree about what happened.
 *
 * What it produces is a **linear draft**. A single recording walks one path, so
 * it cannot honestly produce a branch nobody took; decisions are added by hand
 * on the review page afterwards, the same way they are for any first draft.
 *
 * Pure by construction: no browser, no database, no model. It takes captures
 * and returns a document, so a fixed sequence can be checked against an exact
 * expected graph with nothing running.
 */

/** One captured interaction, as the recorder reports it. */
export type RecordedEntry =
  | {
      readonly kind: 'navigate';
      readonly url: string;
    }
  | {
      readonly kind: 'click' | 'fill';
      readonly selectors: SelectorChain;
      readonly fingerprint: ElementFingerprint;
      /** Absent for a password field, whose value is never read. */
      readonly typedValue?: string;
      readonly sensitive?: boolean;
    };

export interface TranslateInput {
  readonly title: string;
  readonly sequence: readonly RecordedEntry[];
  /** Named so the outcome step reads like something a person wrote. */
  readonly outcomeName?: string;
}

export interface TranslatedStep {
  readonly step: SopStep;
  /** Absent for the appended outcome, which touches no element. */
  readonly binding: BindingBody | undefined;
}

export type TranslateResult =
  | {
      readonly ok: true;
      readonly graph: SopGraph;
      readonly steps: readonly TranslatedStep[];
    }
  | { readonly ok: false; readonly issues: readonly SopGraphIssue[] };

export const DEFAULT_OUTCOME_NAME = 'completed';

/**
 * A step id a reviewer can read, derived from what the element is called.
 *
 * Ids are workflow-local names people read in the review page, so
 * `enter_service_request_number` beats `step_4`. Uniqueness is enforced by
 * suffixing rather than by hashing, because a duplicate here means the person
 * did the same thing twice and the numbering should say so.
 */
function stepId(prefix: string, label: string | null, taken: Set<string>): string {
  // Slugged by @orbit/sop-graph rather than here, so a step recorded in a
  // browser and one added in Studio are named by the same rules. The prefix
  // stays local: it is the *action* performed, which is richer than the step
  // kind an editor has to work from.
  const slug = slugForStepId(label ?? '');
  const base = slug === null ? prefix : `${prefix}_${slug}`;
  const safe = /^[a-z]/.test(base) ? base : `step_${base}`;

  if (!taken.has(safe)) {
    taken.add(safe);
    return safe;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${safe}_${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** What an element is called, preferring the name a person would say aloud. */
function label(fingerprint: ElementFingerprint): string | null {
  const named = fingerprint.accessibleName ?? fingerprint.text;
  return named === null || named.trim() === '' ? null : named.trim();
}

/**
 * The sentence a reviewer reads for a step.
 *
 * Every step kind requires a non-empty `purpose`, and a recording carries no
 * prose — nobody narrated while they worked. This says plainly what was done
 * rather than inventing an intent nobody stated, and a reviewer rewrites it in
 * the review page where the wording belongs.
 */
function purposeFor(entry: RecordedEntry): string {
  if (entry.kind === 'navigate') {
    return `Open ${entry.url}`;
  }

  const named = label(entry.fingerprint);
  const role = entry.fingerprint.role ?? 'element';

  if (entry.kind === 'click') {
    return named === null ? `Select the ${role}` : `Select "${named}"`;
  }

  return named === null ? `Fill the ${role}` : `Fill "${named}"`;
}

export function translateRecording(input: TranslateInput): TranslateResult {
  // Clicking into a box before typing in it is one action to the person and two
  // to the page. Filtered here rather than tolerated, and filtered by the same
  // function the demonstration aligner uses, so a recorded workflow and an
  // auto-bound one cannot disagree about how many steps one demonstration
  // contains.
  const sequence = withoutFocusClicks(input.sequence);

  // Checked before anything is appended: the outcome step below would otherwise
  // make an empty recording look like a one-step workflow, which is valid and
  // meaningless.
  if (sequence.length === 0) {
    return {
      ok: false,
      issues: [
        {
          code: 'SCHEMA_ERROR',
          message: 'A recording with no captured actions cannot become a workflow.',
          path: ['steps'],
        },
      ],
    };
  }

  const taken = new Set<string>();
  const translated: TranslatedStep[] = [];
  const secretInputs = new Map<string, string>();

  for (const entry of sequence) {
    const purpose = purposeFor(entry);

    if (entry.kind === 'navigate') {
      const id = stepId('open', hostOf(entry.url), taken);

      translated.push({
        step: { id, kind: 'navigate', purpose, urlHint: entry.url },
        // A navigate step's binding records where the recording actually
        // landed; it names no element, so its target is the page itself.
        binding: undefined,
      });
      continue;
    }

    const target = { selectors: entry.selectors, fingerprint: entry.fingerprint };

    if (entry.kind === 'click') {
      const id = stepId('click', label(entry.fingerprint), taken);

      translated.push({
        step: { id, kind: 'click', purpose, targetHint: label(entry.fingerprint) ?? 'the control' },
        binding: { kind: 'click', target },
      });
      continue;
    }

    const id = stepId('enter', label(entry.fingerprint), taken);

    // A password field declares a secret input and references it, rather than
    // carrying a value. Nothing typed into one ever entered this process, and
    // the graph validator refuses a sensitive fill that holds a literal — so
    // the honest translation is the one 2.1's rules already require, and the
    // recording arrives with its secret properly declared instead of deferring
    // that to review.
    const secretId = entry.sensitive === true ? declareSecret(entry, secretInputs) : undefined;

    translated.push({
      step: {
        id,
        kind: 'fill',
        purpose,
        fieldHint: label(entry.fingerprint) ?? 'the field',
        value: secretId === undefined ? (entry.typedValue ?? '') : `\${inputs.${secretId}}`,
        ...(secretId === undefined ? {} : { sensitive: true }),
      },
      binding: {
        kind: 'fill',
        target,
        // Never the recorded value: a literal default is a deliberate choice a
        // person makes in review, not a side effect of having typed something.
        valueSource: {
          kind: 'literal',
          value: entry.sensitive === true ? '' : (entry.typedValue ?? ''),
        },
      },
    });
  }

  // Every path must reach a terminal and the workflow must end on one, so an
  // outcome is appended. Nobody performed it — a recording ends when the person
  // stops, not with a declaration — and saying so is more honest than inferring
  // an outcome from the last page.
  const outcomeId = stepId('outcome', input.outcomeName ?? DEFAULT_OUTCOME_NAME, taken);

  translated.push({
    step: {
      id: outcomeId,
      kind: 'outcome',
      outcome: input.outcomeName ?? DEFAULT_OUTCOME_NAME,
      message: 'The recorded task finished.',
      purpose: 'Finish the workflow',
    },
    binding: undefined,
  });

  const graph: SopGraph = {
    schemaVersion: SOP_GRAPH_SCHEMA_VERSION,
    title: input.title,
    entryStepId: translated[0]!.step.id,
    inputs: [...secretInputs].map(([id, name]) => ({
      id,
      label: name,
      type: 'secret' as const,
      required: true,
    })),
    outputs: [],
    steps: translated.map((entry) => entry.step),
    assumptions: [],
    clarificationQuestions: [],
    risks: [],
  };

  // Validated here rather than trusted: this is generated output like any
  // other, and the graph validator is the gate everything passes through
  // before it becomes a revision.
  const parsed = parseSopGraphDocument(graph);

  return parsed.ok ? { ok: true, graph: parsed.graph, steps: translated } : parsed;
}

/**
 * Declares the secret input a password field needs, once per field.
 *
 * Two password boxes with the same label are the same secret; two with
 * different labels are not. Keying on the label is what keeps a sign-in form
 * from declaring one input and a change-password form from collapsing two.
 */
function declareSecret(
  entry: { readonly fingerprint: ElementFingerprint },
  declared: Map<string, string>,
): string {
  const name = label(entry.fingerprint) ?? 'password';
  const id =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^([0-9])/, 'x$1')
      .slice(0, 40) || 'password';

  declared.set(id, name);
  return id;
}

/** A host makes a readable step id; a full URL does not. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export { EXECUTION_BINDING_SCHEMA_VERSION };
