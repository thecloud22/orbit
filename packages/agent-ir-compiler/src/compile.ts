import {
  parseAgentIrDocument,
  type AgentIr,
  type AgentIrStep,
  type BrowserAction,
  type InputDeclaration as IrInputDeclaration,
  type Locator,
} from '@orbit/agent-ir';
import { stepChecksum } from '@orbit/db/checksum';
import type { ExecutionBinding } from '@orbit/execution-mapping';
import {
  classifyValue,
  type InputDeclaration as SopInputDeclaration,
  type SopGraph,
  type SopStep,
} from '@orbit/sop-graph';

import { refusal, type CompileRefusal } from './refusals';

/**
 * Compiling a reviewed SOP Graph and its approved bindings into candidate
 * Agent IR.
 *
 * Pure by construction: no database, no browser, no model, no clock. It imports
 * `stepChecksum` from `@orbit/db/checksum` — a subpath carrying `node:crypto`
 * and nothing else, so the one definition ADR-019 established is used
 * *structurally* rather than by a convention the caller has to honour. A
 * boundary test asserts this package cannot reach a connection pool.
 *
 * The compiler refuses far more than it accepts, and that is the design. A
 * candidate that runs is a claim that a person's workflow was understood
 * completely; anything only partly understood must produce a refusal naming the
 * step, never a candidate that silently does less than the document says.
 */

/** Maps a SOP outcome name onto the business outcome Agent IR can express. */
export type OutcomeMapping = Readonly<Record<string, 'request_found' | 'request_not_found'>>;

export interface CompileInput {
  readonly graph: SopGraph;
  /** The approved bindings for this document, at most one per step. */
  readonly bindings: readonly ExecutionBinding[];
  readonly outcomeMapping: OutcomeMapping;
  /**
   * Hosts a compiled navigation may target.
   *
   * Passed in rather than imported because the one definition lives in
   * `@orbit/runtime` (`ALLOWED_HOSTS`) and a pure compiler must not depend on
   * the runtime. The caller passes that constant; a service test asserts it
   * passes that one and not a copy.
   */
  readonly allowedHosts: readonly string[];
  readonly agentId: string;
  readonly version: string;
  readonly sopId: string;
  readonly sopVersion: string;
}

export type CompileResult =
  | { readonly ok: true; readonly agentIr: AgentIr; readonly secretInputIds: readonly string[] }
  | { readonly ok: false; readonly refusals: readonly CompileRefusal[] };

function unlocatable(stepId: string): CompileRefusal {
  return refusal(
    'missing_binding',
    `Step "${stepId}" has a mapping that names no element to act on.`,
    stepId,
  );
}

/**
 * Step kinds that must carry an approved binding to be compiled.
 *
 * `navigate` is deliberately absent. A navigation names no element — it names a
 * destination, which is business intent and lives in the graph (ADR-002) — so
 * the recorder emits no binding for one, and requiring one here would mean no
 * recorded workflow could ever compile. A navigate binding may still exist, and
 * when it does its URL is preferred: it is where the recording actually landed
 * rather than where the draft said it would.
 */
const BINDABLE_KINDS = new Set<SopStep['kind']>(['fill', 'click', 'extract']);

/** Agent IR declares one value type today; anything else cannot be expressed. */
function irInputFor(declaration: SopInputDeclaration): IrInputDeclaration | null {
  // A secret compiles to a string declaration because Agent IR has no secret
  // type. The secret-ness is therefore *not* recoverable from the IR, which is
  // exactly why the compiler returns the secret input ids separately and the
  // sandbox precondition reads those rather than the compiled document.
  if (declaration.type !== 'string' && declaration.type !== 'secret') {
    return null;
  }

  return {
    type: 'string',
    required: declaration.required,
    label: declaration.label,
    ...(declaration.description === undefined ? {} : { description: declaration.description }),
  };
}

function locatorFor(binding: ExecutionBinding): Locator | undefined {
  // The first selector in the chain is the preferred one; 2.4b verified every
  // candidate resolves to the same single element, so taking the head is not a
  // guess. Agent IR carries one locator per step, so the rest of the chain is
  // not expressible here and stays in the binding.
  //
  // An empty chain should be unreachable — the schema requires one — but it is
  // handled rather than asserted away, because the failure it would cause is a
  // step that acts on nothing.
  const [first] = binding.body.target.selectors;

  if (first === undefined) {
    return undefined;
  }

  return first.strategy === 'role_and_name' && first.name !== undefined
    ? { strategy: 'role_and_name', value: first.value, name: first.name }
    : { strategy: first.strategy, value: first.value };
}

/**
 * The value a fill step should send.
 *
 * A sensitive step takes the graph's own `${inputs.…}` reference rather than
 * the binding's value source. Sub-phase 2.1 forbids a sensitive fill from
 * holding a literal, so the recorder had nothing valid to put in the binding
 * and writes an empty literal placeholder; using it would compile an empty
 * value into a password field.
 */
function fillValueFor(
  step: Extract<SopStep, { kind: 'fill' }>,
  binding: ExecutionBinding,
  graph: SopGraph,
): { readonly value: string } | { readonly refusal: CompileRefusal } {
  if (step.sensitive === true) {
    const classified = classifyValue(step.value);

    if (classified.kind !== 'reference' || classified.reference.namespace !== 'inputs') {
      return {
        refusal: refusal(
          'unusable_value_source',
          `Step "${step.id}" is marked sensitive, so its value must reference a declared secret input.`,
          step.id,
        ),
      };
    }

    return { value: classified.reference.raw };
  }

  if (binding.body.kind !== 'fill') {
    return {
      refusal: refusal(
        'missing_binding',
        `Step "${step.id}" is a fill but its binding is a ${binding.body.kind}.`,
        step.id,
      ),
    };
  }

  const source = binding.body.valueSource;

  if (source.kind === 'literal') {
    if (source.value === '') {
      return {
        refusal: refusal(
          'unusable_value_source',
          `Step "${step.id}" has an empty literal value, so there is nothing to type into the field.`,
          step.id,
        ),
      };
    }

    return { value: source.value };
  }

  const isInput = graph.inputs.some((input) => input.id === source.name);
  const declaresVariable = graph.steps.some(
    (candidate) =>
      candidate.kind === 'extract' && candidate.fields.some((field) => field.name === source.name),
  );

  if (isInput) {
    return { value: `\${inputs.${source.name}}` };
  }

  if (declaresVariable) {
    return { value: `\${variables.${source.name}}` };
  }

  return {
    refusal: refusal(
      'unusable_value_source',
      `Step "${step.id}" reads "${source.name}", which the workflow does not declare as an input or produce as a value.`,
      step.id,
    ),
  };
}

export function compileCandidate(input: CompileInput): CompileResult {
  const { graph } = input;
  const refusals: CompileRefusal[] = [];

  const bindingsByStep = new Map<string, ExecutionBinding>();
  for (const binding of input.bindings) {
    bindingsByStep.set(binding.stepId, binding);
  }

  const steps: AgentIrStep[] = [];
  const variables: Record<string, { type: 'string' }> = {};
  const actions = new Set<BrowserAction>();
  const domains = new Set<string>();
  const secretInputIds: string[] = [];

  const inputs: Record<string, IrInputDeclaration> = {};
  for (const declaration of graph.inputs) {
    const compiled = irInputFor(declaration);

    if (compiled === null) {
      refusals.push(
        refusal(
          'unsupported_input_type',
          `Input "${declaration.id}" is a ${declaration.type}, and an agent can only take text values today.`,
        ),
      );
      continue;
    }

    if (declaration.type === 'secret') {
      secretInputIds.push(declaration.id);
    }

    inputs[declaration.id] = compiled;
  }

  for (const step of graph.steps) {
    if (step.kind === 'decision') {
      refusals.push(
        refusal(
          'branching_unsupported',
          `Step "${step.id}" is a decision, and branching workflows cannot be compiled yet.`,
          step.id,
        ),
      );
      continue;
    }

    if (step.kind === 'manual_review') {
      refusals.push(
        refusal(
          'manual_review_unsupported',
          `Step "${step.id}" routes to a person, which an agent cannot do.`,
          step.id,
        ),
      );
      continue;
    }

    if (step.kind === 'outcome') {
      const outcome = input.outcomeMapping[step.outcome];

      if (outcome === undefined) {
        refusals.push(
          refusal(
            'unmapped_outcome',
            `Outcome "${step.outcome}" has no business outcome mapped to it.`,
            step.id,
          ),
        );
        continue;
      }

      const outputs: Record<string, string> = {};
      for (const returned of step.returns ?? []) {
        outputs[returned.name] = `\${variables.${returned.name}}`;
      }

      steps.push({
        id: step.id,
        sourceSopStepIds: [step.id],
        type: 'complete',
        outcome,
        ...(Object.keys(outputs).length === 0 ? {} : { outputs }),
      });
      continue;
    }

    if (step.kind === 'navigate') {
      const bound = bindingsByStep.get(step.id);
      const destination =
        bound !== undefined && bound.body.kind === 'navigate' ? bound.body.url : step.urlHint;

      if (destination === undefined) {
        refusals.push(
          refusal(
            'missing_destination',
            `Step "${step.id}" opens a page but does not say which one.`,
            step.id,
          ),
        );
        continue;
      }

      let url: URL;
      try {
        url = new URL(destination);
      } catch {
        refusals.push(
          refusal(
            'missing_destination',
            `Step "${step.id}" names "${destination}", which is not a URL.`,
            step.id,
          ),
        );
        continue;
      }

      if (!input.allowedHosts.includes(url.hostname)) {
        refusals.push(
          refusal(
            'navigation_not_permitted',
            `Step "${step.id}" opens "${url.hostname}", which Orbit is not permitted to visit.`,
            step.id,
          ),
        );
        continue;
      }

      domains.add(url.hostname);
      actions.add('navigate');
      steps.push({
        id: step.id,
        sourceSopStepIds: [step.id],
        type: 'browser.navigate',
        url: destination,
        evidence: { captureScreenshot: true, captureDomSnapshot: true },
      });
      continue;
    }

    if (!BINDABLE_KINDS.has(step.kind)) {
      continue;
    }

    const binding = bindingsByStep.get(step.id);

    if (binding === undefined) {
      refusals.push(
        refusal(
          'missing_binding',
          `Step "${step.id}" has not been mapped to anything on a real page yet.`,
          step.id,
        ),
      );
      continue;
    }

    if (binding.stepSha256 !== stepChecksum(step)) {
      refusals.push(
        refusal(
          'stale_binding',
          `Step "${step.id}" has been edited since it was mapped, so its mapping may point at the wrong element.`,
          step.id,
        ),
      );
      continue;
    }

    if (step.kind === 'fill') {
      const value = fillValueFor(step, binding, graph);

      if ('refusal' in value) {
        refusals.push(value.refusal);
        continue;
      }

      const fillLocator = locatorFor(binding);

      if (fillLocator === undefined) {
        refusals.push(unlocatable(step.id));
        continue;
      }

      actions.add('fill');
      steps.push({
        id: step.id,
        sourceSopStepIds: [step.id],
        type: 'browser.fill',
        locator: fillLocator,
        value: value.value,
        evidence: { captureScreenshot: true },
      });
      continue;
    }

    if (step.kind === 'click') {
      if (binding.body.kind !== 'click') {
        refusals.push(
          refusal('missing_binding', `Step "${step.id}" clicks but its mapping does not.`, step.id),
        );
        continue;
      }

      const clickLocator = locatorFor(binding);

      if (clickLocator === undefined) {
        refusals.push(unlocatable(step.id));
        continue;
      }

      actions.add('click');
      steps.push({
        id: step.id,
        sourceSopStepIds: [step.id],
        type: 'browser.click',
        locator: clickLocator,
        evidence: { captureScreenshot: true, captureDomSnapshot: true },
      });
      continue;
    }

    // extract
    if (binding.body.kind !== 'extract') {
      refusals.push(
        refusal(
          'missing_binding',
          `Step "${step.id}" reads a value but its mapping does not.`,
          step.id,
        ),
      );
      continue;
    }

    const bound = binding.body;

    if (step.fields.length > 1) {
      // Naming the unmapped fields rather than counting them: "2 values, one
      // mapped" leaves the reader to work out which one is missing, and that
      // is the only thing they actually need to know.
      const unmapped = step.fields
        .map((candidate) => candidate.name)
        .filter((name) => name !== bound.variable);

      refusals.push(
        refusal(
          'extract_coverage_gap',
          `Step "${step.id}" reads ${String(step.fields.length)} values but only "${bound.variable}" was mapped. ` +
            `${unmapped.map((name) => `"${name}"`).join(', ')} ${unmapped.length === 1 ? 'has' : 'have'} nowhere to come from.`,
          step.id,
        ),
      );
      continue;
    }

    const [field] = step.fields;

    if (field === undefined || field.name !== bound.variable) {
      refusals.push(
        refusal(
          'extract_coverage_gap',
          `Step "${step.id}" reads "${field?.name ?? 'nothing'}" but its mapping fills "${bound.variable}".`,
          step.id,
        ),
      );
      continue;
    }

    if (bound.readMethod.kind !== 'text') {
      refusals.push(
        refusal(
          'extract_coverage_gap',
          `Step "${step.id}" reads by ${bound.readMethod.kind}, and an agent can only read visible text today.`,
          step.id,
        ),
      );
      continue;
    }

    const extractLocator = locatorFor(binding);

    if (extractLocator === undefined) {
      refusals.push(unlocatable(step.id));
      continue;
    }

    variables[field.name] = { type: 'string' };
    actions.add('extract');
    steps.push({
      id: step.id,
      sourceSopStepIds: [step.id],
      type: 'browser.extract',
      fields: { [field.name]: { locator: extractLocator, method: 'text' } },
      assign: { [field.name]: `\${result.${field.name}}` },
      evidence: { captureScreenshot: true },
    });
  }

  if (refusals.length > 0) {
    return { ok: false, refusals };
  }

  const outputs: Record<string, { type: 'string' }> = {};
  for (const output of graph.outputs) {
    outputs[output.name] = { type: 'string' };
  }

  // Evidence grants are consumed separately from the action itself, so what the
  // steps above asked to capture has to be granted here or the IR validator
  // rejects its own compiler's output.
  actions.add('screenshot');
  actions.add('dom_snapshot');

  const candidate = {
    schemaVersion: '0.1',
    id: input.agentId,
    version: input.version,
    name: graph.title,
    ...(graph.description === undefined ? {} : { description: graph.description }),
    source: {
      sopId: input.sopId,
      sopVersion: input.sopVersion,
      sourceSopStepIds: graph.steps.map((step) => step.id),
    },
    lifecycle: { status: 'draft', trustTier: 'observe' },
    trigger: { type: 'watchtower_manual' },
    inputs,
    variables,
    outputs,
    permissions: {
      browser: {
        allowedDomains: [...domains].sort(),
        allowedActions: [...actions].sort(),
      },
    },
    steps,
  };

  // The compiler's own output is untrusted input, exactly as a model's is. It
  // goes through the real Agent IR validator rather than being assumed valid
  // because this code produced it.
  const parsed = parseAgentIrDocument(candidate);

  if (!parsed.ok) {
    return {
      ok: false,
      refusals: parsed.issues.map((issue) =>
        refusal(
          'invalid_candidate',
          `The compiled workflow is not valid: ${issue.message} (${issue.path.join('.')})`,
        ),
      ),
    };
  }

  return { ok: true, agentIr: parsed.agentIr, secretInputIds };
}
