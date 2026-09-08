import {
  parseAgentIrDocument,
  type AgentIr,
  type AgentIrStep,
  type BrowserAction,
  type InputDeclaration as IrInputDeclaration,
  type Locator,
} from '@orbit/agent-ir';
import { isDeclarableBusinessOutcome, NO_BUSINESS_OUTCOME } from '@orbit/contracts';
import { operationById, type ApiCatalog } from '@orbit/api-catalog';
import { stepChecksum } from '@orbit/db/checksum';
import type { ExecutionBinding, SelectorChain } from '@orbit/execution-mapping';
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

export interface CompileInput {
  readonly graph: SopGraph;
  /** The approved bindings for this document, at most one per step. */
  readonly bindings: readonly ExecutionBinding[];
  readonly agentId: string;
  readonly version: string;
  readonly sopId: string;
  readonly sopVersion: string;
  /**
   * Whether the document grants Orbit permission to propose repairs for drift
   * in agents published from it (ADR-033).
   *
   * Compiled into the version rather than read live at run time, because a
   * published version is immutable and must state its own authority: a run
   * consults the IR it is executing, never the document it came from. Default
   * off, so a document that has never been asked the question produces exactly
   * the IR it produced before this existed.
   */
  readonly recoveryAllowed?: boolean;
  /**
   * The API contracts this deployment holds, by catalog id.
   *
   * Passed in rather than read from anywhere: the compiler is pure, and a
   * catalog is a fact about a service the deployment happens to hold. What the
   * *version* carries is the grant derived from it -- which operations and which
   * hosts -- because that is what a reviewer approved and it must not change
   * under a published agent (ADR-005).
   */
  readonly catalogs?: Readonly<Record<string, ApiCatalog>>;
}

export type CompileResult =
  | { readonly ok: true; readonly agentIr: AgentIr; readonly secretInputIds: readonly string[] }
  | { readonly ok: false; readonly refusals: readonly CompileRefusal[] };

/**
 * A branch condition as a stable outcome name.
 *
 * "Still on loan" becomes `still_on_loan`. The author's own words stay on the
 * alternative as its description — which is what the judge is actually shown —
 * so nothing is lost by giving the name a machine-safe form.
 */
function outcomeNameFor(when: string): string {
  const slug = when
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .slice(0, 64);

  return /^[a-z]/.test(slug) ? slug : `branch_${slug}`.slice(0, 64);
}

/** A locator value as a readFrom label: `catalog-result-status` → `catalogResultStatus`. */
function sourceLabelFor(locator: Locator): string {
  const parts = locator.value.split(/[^A-Za-z0-9]+/).filter((part) => part !== '');
  const [first, ...rest] = parts;

  const camel = `${(first ?? 'region').toLowerCase()}${rest
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('')}`;

  return /^[A-Za-z]/.test(camel) ? camel : `region${camel}`;
}

/** How many judged decisions the workflow contains, which is its call ceiling. */
function countJudgedSteps(graph: SopGraph): number {
  return graph.steps.filter((step) => step.kind === 'decision' && step.resolution === 'judged')
    .length;
}

interface JudgedAlternativeSource {
  readonly whenVisible: Locator;
  readonly next: string;
}

/**
 * Compiles a judged decision, or refuses it.
 *
 * Two refusals live here and nowhere else, because both are properties of the
 * author's branch *meanings* rather than of the graph's shape: a decision with
 * no "we could not tell" branch, and two branches whose conditions collapse to
 * the same name.
 */
function compileJudgedDecision(
  step: Extract<SopStep, { kind: 'decision' }>,
  alternativeSources: readonly JudgedAlternativeSource[],
): { readonly step: AgentIrStep } | { readonly refusals: readonly CompileRefusal[] } {
  const refusals: CompileRefusal[] = [];

  const escapeHatches = step.branches.filter((branch) => branch.insufficientEvidence === true);

  if (escapeHatches.length !== 1) {
    refusals.push(
      refusal(
        'missing_insufficient_evidence_branch',
        escapeHatches.length === 0
          ? `Step "${step.id}" asks a model to decide but declares no branch for "the evidence does not settle this". Without one it must return a confident answer for a case it cannot actually tell, and that answer is indistinguishable from a correct one.`
          : `Step "${step.id}" marks ${String(escapeHatches.length)} branches as "the evidence does not settle this", and there can be only one.`,
        step.id,
      ),
    );
  }

  const outcomes = step.branches.map((branch) => outcomeNameFor(branch.when));
  const seen = new Set<string>();

  for (const [index, outcome] of outcomes.entries()) {
    if (seen.has(outcome)) {
      refusals.push(
        refusal(
          'ambiguous_branch_outcome',
          `Step "${step.id}" has two branches whose conditions both read as "${outcome}" ("${String(step.branches[index]?.when)}"). A judged decision returns exactly one branch, so its conditions must be distinguishable.`,
          step.id,
        ),
      );
    }
    seen.add(outcome);
  }

  if (refusals.length > 0) {
    return { refusals };
  }

  // Deduplicated: two branches demonstrated on the same region are one region
  // for the judge to read, not the same text sent twice.
  const readFrom: { label: string; locator: Locator }[] = [];
  for (const source of alternativeSources) {
    const label = sourceLabelFor(source.whenVisible);
    if (!readFrom.some((existing) => existing.label === label)) {
      readFrom.push({ label, locator: source.whenVisible });
    }
  }

  return {
    step: {
      id: step.id,
      sourceSopStepIds: [step.id],
      type: 'model.decide',
      question: step.judgement ?? step.question,
      readFrom,
      alternatives: step.branches.map((branch, index) => ({
        outcome: outcomes[index]!,
        // The author's own words, which is what the judge is actually shown.
        description: branch.when,
        next: branch.nextStepId,
        ...(branch.insufficientEvidence === true ? { insufficientEvidence: true } : {}),
      })),
      evidence: { captureScreenshot: true, captureDomSnapshot: true },
    } as AgentIrStep,
  };
}

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
export const BINDABLE_KINDS = new Set<SopStep['kind']>([
  'fill',
  'click',
  'extract',
  // A decision is bound by demonstrating each branch: put the screen into that
  // state, then point at the element that proves it. That is one locator per
  // branch, which is what `browser.expect_one_of` resolves at run time.
  'decision',
]);

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
  // A decision names one element per branch, and a call names none at all --
  // it points at an operation in a contract. Neither has a single locator to
  // put in the compiled step.
  if (binding.body.kind === 'decision' || binding.body.kind === 'call') {
    return undefined;
  }

  return locatorFromChain(binding.body.target.selectors);
}

/**
 * The one locator Agent IR carries for an element, taken from its chain.
 */
function locatorFromChain(selectors: SelectorChain): Locator | undefined {
  // The first selector in the chain is the preferred one; 2.4b verified every
  // candidate resolves to the same single element, so taking the head is not a
  // guess. Agent IR carries one locator per step, so the rest of the chain is
  // not expressible here and stays in the binding.
  //
  // An empty chain should be unreachable — the schema requires one — but it is
  // handled rather than asserted away, because the failure it would cause is a
  // step that acts on nothing.
  const [first] = selectors;

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
  // Derived from what actually compiled, never from what the catalog offers: a
  // version grants the operations and hosts its own steps reach and nothing
  // more, the way allowedDomains is derived from hosts a recording visited
  // (ADR-022).
  const apiOperations = new Set<string>();
  const apiHosts = new Set<string>();
  const credentialRefs = new Set<string>();
  // Whether this workflow needs the model capability at all. Declared only when
  // a judged decision actually compiled, so an agent that never asks for
  // judgement never carries the permission that allows it.
  let usesModel = false;
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

    if (step.kind === 'call') {
      const binding = bindingsByStep.get(step.id);

      if (binding === undefined || binding.body.kind !== 'call') {
        refusals.push(
          refusal(
            'missing_binding',
            `Step "${step.id}" calls "${step.systemHint}" and nothing says which operation answers it.`,
            step.id,
          ),
        );
        continue;
      }

      const bound = binding.body;
      const catalog = input.catalogs?.[bound.catalogId];
      const operation =
        catalog === undefined ? undefined : operationById(catalog, bound.operationId);

      if (catalog === undefined || operation === undefined) {
        // Named rather than compiled optimistically. A step pointing at an
        // operation this deployment cannot show the reviewer is exactly the
        // thing ADR-021 says must refuse instead of passing through.
        refusals.push(
          refusal(
            'call_binding_unsupported',
            `Step "${step.id}" names operation "${bound.operationId}" in catalog "${bound.catalogId}", which this deployment does not hold.`,
            step.id,
          ),
        );
        continue;
      }

      const callArguments: Record<string, string> = {};
      let argumentRefused = false;

      for (const parameter of operation.parameters) {
        const source = bound.arguments[parameter.name];

        if (source === undefined) {
          if (parameter.required) {
            refusals.push(
              refusal(
                'unusable_value_source',
                `Step "${step.id}" leaves required parameter "${parameter.name}" of "${bound.operationId}" with nowhere to come from.`,
                step.id,
              ),
            );
            argumentRefused = true;
          }
          continue;
        }

        callArguments[parameter.name] =
          source.kind === 'literal'
            ? source.value
            : source.kind === 'input'
              ? `\${inputs.${source.inputId}}`
              : `\${variables.${source.name}}`;
      }

      if (argumentRefused) {
        continue;
      }

      apiOperations.add(bound.operationId);
      for (const host of catalog.hosts) {
        apiHosts.add(host);
      }

      if (bound.auth !== undefined) {
        credentialRefs.add(bound.auth.credentialRef);
      }

      steps.push({
        id: step.id,
        sourceSopStepIds: [step.id],
        type: 'api.request',
        catalogId: bound.catalogId,
        operationId: bound.operationId,
        ...(Object.keys(callArguments).length === 0 ? {} : { arguments: callArguments }),
        ...(Object.keys(bound.reads).length === 0 ? {} : { assign: { ...bound.reads } }),
        ...(bound.auth === undefined
          ? {}
          : {
              auth: {
                scheme: bound.auth.scheme,
                ...(bound.auth.headerName === undefined
                  ? {}
                  : { headerName: bound.auth.headerName }),
                credentialRef: bound.auth.credentialRef,
              },
            }),
      });
      continue;
    }

    if (step.kind === 'outcome') {
      // The outcome name passes straight through: a business outcome is the
      // workflow's own declared name, not a translation of it (ADR-030). The
      // graph's `outcomeNameSchema` is looser than the run contract's — it sets
      // no length bound — so this re-checks rather than assumes, and refuses
      // here where the step can be named rather than at run time in a CHECK
      // constraint violation.
      if (!isDeclarableBusinessOutcome(step.outcome)) {
        refusals.push(
          refusal(
            'unusable_outcome_name',
            `Outcome "${step.outcome}" cannot be a business outcome: a name must start with a lowercase letter, use only lowercase letters, digits and underscores, be at most 64 characters, and must not be "${NO_BUSINESS_OUTCOME}", which is reserved for a run that has reached no conclusion.`,
            step.id,
          ),
        );
        continue;
      }

      const outcome = step.outcome;

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

      // Every host the workflow actually opens becomes part of the agent's
      // declared `allowedDomains` below. That declaration is the containment:
      // the semantic validator checks it at publish and the runtime re-checks it
      // before every navigation, so a compiled agent can reach the sites its
      // recording visited and nothing else.
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

    if (step.kind === 'decision') {
      if (binding.body.kind !== 'decision') {
        refusals.push(
          refusal(
            'missing_binding',
            `Step "${step.id}" is a decision but its mapping is a ${binding.body.kind}.`,
            step.id,
          ),
        );
        continue;
      }

      const bound = binding.body;
      const alternatives: { readonly whenVisible: Locator; readonly next: string }[] = [];
      let refusedBranch = false;

      for (const branch of step.branches) {
        // Matched on the reviewer's own condition text rather than on position,
        // so reordering the graph's branches cannot rebind a decision to the
        // wrong outcome. The binding validator enforces the same set equality
        // at save time; this is the compiler refusing rather than trusting it.
        const demonstrated = bound.branches.find((candidate) => candidate.when === branch.when);

        if (demonstrated === undefined) {
          refusals.push(
            refusal(
              'missing_branch_binding',
              `Step "${step.id}" branches on "${branch.when}", and nobody has shown what that state looks like.`,
              step.id,
            ),
          );
          refusedBranch = true;
          continue;
        }

        if (!graph.steps.some((candidate) => candidate.id === branch.nextStepId)) {
          refusals.push(
            refusal(
              'unresolved_branch_target',
              `Step "${step.id}" branches to "${branch.nextStepId}" on "${branch.when}", and this workflow has no such step.`,
              step.id,
            ),
          );
          refusedBranch = true;
          continue;
        }

        const branchLocator = locatorFromChain(demonstrated.selectors);

        if (branchLocator === undefined) {
          refusals.push(unlocatable(step.id));
          refusedBranch = true;
          continue;
        }

        alternatives.push({ whenVisible: branchLocator, next: branch.nextStepId });
      }

      if (refusedBranch) {
        continue;
      }

      // The graph schema already requires two, so this is unreachable rather
      // than expected — and it is checked anyway, because `expect_one_of` with
      // one alternative is not a choice and Agent IR would reject it with a
      // message about array length rather than about this workflow.
      if (alternatives.length < 2) {
        refusals.push(
          refusal(
            'missing_branch_binding',
            `Step "${step.id}" resolves to ${String(alternatives.length)} branch(es), and a decision needs at least two.`,
            step.id,
          ),
        );
        continue;
      }

      if (step.resolution === 'judged') {
        // A judged decision reuses the very same demonstrated elements, read
        // rather than watched for visibility: what a person pointed at when
        // showing a branch is where that branch's evidence lives. So no new
        // binding shape is needed, and the recorder is untouched.
        const judged = compileJudgedDecision(step, alternatives);

        if ('refusals' in judged) {
          refusals.push(...judged.refusals);
          continue;
        }

        usesModel = true;
        steps.push(judged.step);
        continue;
      }

      actions.add('expect_one_of');
      steps.push({
        id: step.id,
        sourceSopStepIds: [step.id],
        type: 'browser.expect_one_of',
        alternatives,
        evidence: { captureScreenshot: true },
      });
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
    // A workflow that uses nothing new still declares 0.1, so republishing an
    // unchanged document produces an unchanged document. The version moves only
    // where the widened contract is actually used.
    schemaVersion: usesModel ? '0.2' : '0.1',
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
      // Emitted only when the workflow actually reaches a browser. A workflow
      // that only calls APIs is now a thing that can exist, and claiming a
      // browser grant it never uses would be a permission nobody meant to give
      // (ADR-037).
      ...(actions.size === 0
        ? {}
        : {
            browser: {
              allowedDomains: [...domains].sort(),
              allowedActions: [...actions].sort(),
            },
          }),
      ...(apiOperations.size === 0
        ? {}
        : {
            api: {
              allowedHosts: [...apiHosts].sort(),
              allowedOperations: [...apiOperations].sort(),
              allowedActions: ['request' as const],
            },
          }),
      ...(credentialRefs.size === 0
        ? {}
        : { credentials: { allowedRefs: [...credentialRefs].sort() } }),
      // Its own section rather than a browser action: a model call leaves the
      // machine and costs money, and smuggling it in under a browser grant
      // would mean an agent granted `click` had quietly been granted judgement.
      ...(usesModel ? { model: { allowed: true, maxCallsPerRun: countJudgedSteps(graph) } } : {}),
      // Its own section for the same reason, and a step up from Tier 0
      // `observe` to Tier 1 `recommend` under ADR-013: an agent that may
      // propose a repair is an agent that has opinions about its own mapping.
      // There is no `apply` to grant — nothing applies a proposal.
      ...(input.recoveryAllowed === true ? { recovery: { allowed: true } } : {}),
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
