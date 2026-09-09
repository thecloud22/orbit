import { stepChecksum } from '@orbit/db/checksum';
import type { ExecutionBinding } from '@orbit/execution-mapping';
import { clickBinding, extractBinding, fillBinding } from '@orbit/execution-mapping/testing';
import { SOP_GRAPH_SCHEMA_VERSION, type SopGraph, type SopStep } from '@orbit/sop-graph';
import { describe, expect, it } from 'vitest';

import { compileCandidate, type CompileInput, type CompileResult } from './compile';

/**
 * The compiler, against the Phase 1 workflow it has to be able to produce.
 *
 * `Find Service Request` is the one procedure Orbit already executes, and its
 * seeded Agent IR is the reference for what correct output looks like. If a
 * reviewed graph plus its bindings cannot produce that shape, the compiler is
 * wrong regardless of what it does produce.
 */

const FINGERPRINT = {
  role: 'textbox',
  accessibleName: 'Service request number',
  text: '',
  boundingBox: null,
} as const;

const IDS = {
  allowedHosts: ['localhost', '127.0.0.1'],
  agentId: 'agent_findservicerequest',
  version: '0.1.0',
  sopId: 'sop_find_service_request',
  sopVersion: '1',
} as const;

function findServiceRequestGraph(overrides: Partial<SopGraph> = {}): SopGraph {
  return {
    schemaVersion: SOP_GRAPH_SCHEMA_VERSION,
    title: 'Find Service Request',
    entryStepId: 'open_portal',
    inputs: [
      {
        id: 'requestNumber',
        label: 'Service request number',
        type: 'string',
        required: true,
      },
    ],
    outputs: [{ name: 'requestStatus', label: 'Status' }],
    steps: [
      {
        id: 'open_portal',
        kind: 'navigate',
        purpose: 'Open the portal',
        urlHint: 'http://localhost:3001/requests',
      },
      {
        id: 'enter_request_number',
        kind: 'fill',
        purpose: 'Enter the request number',
        fieldHint: 'Service request number',
        value: '${inputs.requestNumber}',
      },
      { id: 'search_request', kind: 'click', purpose: 'Search', targetHint: 'Search' },
      {
        id: 'extract_request_details',
        kind: 'extract',
        purpose: 'Read the status',
        fields: [{ name: 'requestStatus', labelHint: 'Status', required: true }],
      },
      {
        id: 'found',
        kind: 'outcome',
        outcome: 'request_found',
        message: 'The request was found.',
        returns: [{ name: 'requestStatus' }],
      },
    ],
    assumptions: [],
    clarificationQuestions: [],
    risks: [],
    ...overrides,
  };
}

/** Bindings whose checksums match the graph they are compiled against. */
function bindingsFor(graph: SopGraph): ExecutionBinding[] {
  const checksumOf = (id: string): string => {
    const step = graph.steps.find((candidate) => candidate.id === id);
    if (step === undefined) {
      throw new Error(`No step "${id}" in the fixture graph.`);
    }
    return stepChecksum(step);
  };

  return [
    {
      schemaVersion: '0.1',
      stepId: 'open_portal',
      body: {
        kind: 'navigate',
        url: 'http://localhost:3001/requests',
        target: {
          selectors: [{ strategy: 'test_id', value: 'request-number-input' }],
          fingerprint: FINGERPRINT,
        },
      },
      capturedAgainstRevisionId: 'soprev_fixture',
      stepSha256: checksumOf('open_portal'),
    },
    fillBinding({ stepSha256: checksumOf('enter_request_number') }),
    clickBinding({ stepSha256: checksumOf('search_request') }),
    extractBinding({ stepSha256: checksumOf('extract_request_details') }),
  ];
}

function compile(overrides: Partial<CompileInput> = {}): CompileResult {
  const graph = overrides.graph ?? findServiceRequestGraph();

  return compileCandidate({
    graph,
    bindings: overrides.bindings ?? bindingsFor(graph),
    ...IDS,
    ...overrides,
  });
}

function refusalCodes(result: CompileResult): readonly string[] {
  return result.ok ? [] : result.refusals.map((entry) => entry.code);
}

describe('compiling the Phase 1 workflow', () => {
  it('produces valid Agent IR with the steps the SOP describes, in order', () => {
    const result = compile();

    expect(refusalCodes(result)).toEqual([]);
    if (!result.ok) return;

    expect(result.agentIr.steps.map((step) => step.type)).toEqual([
      'browser.navigate',
      'browser.fill',
      'browser.click',
      'browser.extract',
      'complete',
    ]);
  });

  it('carries the SOP step each IR step came from, so evidence can be traced back', () => {
    const result = compile();
    if (!result.ok) throw new Error('expected a candidate');

    for (const step of result.agentIr.steps) {
      expect(step.sourceSopStepIds).toEqual([step.id]);
    }
  });

  it('grants exactly the browser capabilities its steps use, and no others', () => {
    const result = compile();
    if (!result.ok) throw new Error('expected a candidate');

    // Over-granting is the failure that matters here: an agent permitted to
    // click when it only reads is an agent whose declaration stops being a
    // limit on what it can do.
    expect(result.agentIr.permissions.browser?.allowedActions).toEqual([
      'click',
      'dom_snapshot',
      'extract',
      'fill',
      'navigate',
      'screenshot',
    ]);
    expect(result.agentIr.permissions.browser?.allowedDomains).toEqual(['localhost']);
  });

  it('resolves a declared input into an interpolation the runtime accepts', () => {
    const result = compile();
    if (!result.ok) throw new Error('expected a candidate');

    const fill = result.agentIr.steps.find((step) => step.type === 'browser.fill');
    expect(fill?.type === 'browser.fill' ? fill.value : null).toBe('${inputs.requestNumber}');
  });

  it('starts as a draft at the lowest trust tier, never as something runnable', () => {
    const result = compile();
    if (!result.ok) throw new Error('expected a candidate');

    // A candidate is a proposal. Compiling one must not be a way to obtain a
    // published agent, or the separate technical approval means nothing.
    expect(result.agentIr.lifecycle).toEqual({ status: 'draft', trustTier: 'observe' });
  });
});

describe('refusals', () => {
  it('refuses an unbound decision, naming the step', () => {
    const graph = findServiceRequestGraph();
    const steps: SopStep[] = [
      ...graph.steps.slice(0, 3),
      {
        id: 'how_many',
        kind: 'decision',
        question: 'How many results came back?',
        branches: [
          { when: 'exactly one', nextStepId: 'extract_request_details' },
          { when: 'none', nextStepId: 'found' },
        ],
      },
      ...graph.steps.slice(3),
    ];

    const result = compile({ graph: { ...graph, steps } });

    // A decision now compiles — but only once somebody has demonstrated what
    // each branch looks like. This one has no binding at all.
    expect(refusalCodes(result)).toContain('missing_binding');
    expect(result.ok ? [] : result.refusals.map((entry) => entry.stepId)).toContain('how_many');
  });

  it('refuses a workflow that routes to a person', () => {
    const graph = findServiceRequestGraph();
    const steps: SopStep[] = [
      ...graph.steps,
      {
        id: 'send_to_a_human',
        kind: 'manual_review',
        reason: 'unmapped_team',
        message: 'A person needs to look at this.',
      },
    ];

    const result = compile({ graph: { ...graph, steps } });

    expect(refusalCodes(result)).toEqual(['manual_review_unsupported']);
  });

  it('refuses a step nobody has mapped yet', () => {
    const graph = findServiceRequestGraph();
    const result = compile({
      graph,
      bindings: bindingsFor(graph).filter((binding) => binding.stepId !== 'search_request'),
    });

    expect(refusalCodes(result)).toEqual(['missing_binding']);
  });

  it('refuses a mapping recorded against a step that has since been edited', () => {
    const graph = findServiceRequestGraph();
    const bindings = bindingsFor(graph);

    // The graph changes; the mapping does not. This is the case the checksum
    // exists for, and the compiler must not trust the mapping through it.
    const edited: SopGraph = {
      ...graph,
      steps: graph.steps.map((step) =>
        step.id === 'search_request' ? { ...step, targetHint: 'Find' } : step,
      ),
    };

    const result = compile({ graph: edited, bindings });

    expect(refusalCodes(result)).toEqual(['stale_binding']);
  });

  it('refuses an outcome name that cannot be a business outcome', () => {
    // An outcome is now the workflow's own declared name (ADR-030), so there is
    // nothing left to map — but `none` is reserved for a run that reached no
    // conclusion, and a graph may declare an outcome name longer than the run
    // contract allows. Both are refused here, naming the step, rather than
    // reaching a CHECK constraint violation at run time.
    const graph = findServiceRequestGraph();

    for (const name of ['none', 'a'.repeat(65)]) {
      const steps = graph.steps.map((step) =>
        step.kind === 'outcome' ? { ...step, outcome: name } : step,
      );

      expect(refusalCodes(compile({ graph: { ...graph, steps } }))).toEqual([
        'unusable_outcome_name',
      ]);
    }
  });

  it("carries the outcome step's own name through to the compiled agent", () => {
    const graph = findServiceRequestGraph();
    const result = compile({ graph });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const complete = result.agentIr.steps.find((step) => step.type === 'complete');
    const outcomeStep = graph.steps.find((step) => step.kind === 'outcome');

    expect(complete?.type === 'complete' ? complete.outcome : null).toBe(
      outcomeStep?.kind === 'outcome' ? outcomeStep.outcome : null,
    );
  });

  it('refuses to compile half of a multi-value read', () => {
    const graph = findServiceRequestGraph();
    const steps = graph.steps.map((step) =>
      step.id === 'extract_request_details' && step.kind === 'extract'
        ? {
            ...step,
            fields: [
              { name: 'requestStatus', labelHint: 'Status', required: true },
              { name: 'assignedTeam', labelHint: 'Assigned team', required: true },
            ],
          }
        : step,
    );

    const result = compile({ graph: { ...graph, steps } });

    expect(refusalCodes(result)).toEqual(['extract_coverage_gap']);
    // The point of the refusal is that it says what is missing.
    expect(result.ok ? '' : result.refusals[0]?.message).toContain('assignedTeam');
  });

  it('opens the page the graph names when nothing mapped the navigation', () => {
    // A navigation names a destination, not an element, so the recorder emits
    // no binding for one. Requiring a mapping here would mean no recorded
    // workflow could ever compile.
    const graph = findServiceRequestGraph();
    const result = compile({
      graph,
      bindings: bindingsFor(graph).filter((binding) => binding.stepId !== 'open_portal'),
    });

    expect(refusalCodes(result)).toEqual([]);
    if (!result.ok) return;

    const navigate = result.agentIr.steps[0];
    expect(navigate?.type === 'browser.navigate' ? navigate.url : null).toBe(
      'http://localhost:3001/requests',
    );
  });

  it('refuses a navigation with no destination at all', () => {
    const graph = findServiceRequestGraph();
    const steps = graph.steps.map((step) =>
      step.id === 'open_portal' && step.kind === 'navigate'
        ? { id: step.id, kind: 'navigate' as const, purpose: step.purpose }
        : step,
    );

    const result = compile({
      graph: { ...graph, steps },
      bindings: bindingsFor({ ...graph, steps }).filter(
        (binding) => binding.stepId !== 'open_portal',
      ),
    });

    expect(refusalCodes(result)).toEqual(['missing_destination']);
  });

  it('grants an external workflow exactly the domain it visits, and no other', () => {
    // This is the containment, now that there is no blanket host list: the
    // compiled agent declares the hosts its recording actually opened, the
    // semantic validator checks that at publish, and the runtime re-checks it
    // before every navigation. An agent recorded on one site cannot reach a
    // second one, even if a later edit puts another URL in a step.
    const graph = findServiceRequestGraph();
    const steps = graph.steps.map((step) =>
      step.id === 'open_portal' && step.kind === 'navigate'
        ? { ...step, urlHint: 'https://www.plano.gov/1391/Service-Requests' }
        : step,
    );

    const result = compile({
      graph: { ...graph, steps },
      bindings: bindingsFor({ ...graph, steps }).filter(
        (binding) => binding.stepId !== 'open_portal',
      ),
    });

    expect(refusalCodes(result)).toEqual([]);
    if (!result.ok) return;

    expect(result.agentIr.permissions.browser?.allowedDomains).toEqual(['www.plano.gov']);
  });

  it('refuses an input type an agent cannot yet carry', () => {
    const graph = findServiceRequestGraph({
      inputs: [
        { id: 'requestNumber', label: 'Number', type: 'string', required: true },
        { id: 'openedAfter', label: 'Opened after', type: 'date', required: false },
      ],
    });

    const result = compile({ graph });

    expect(refusalCodes(result)).toEqual(['unsupported_input_type']);
  });

  it('collects every problem at once rather than stopping at the first', () => {
    const graph = findServiceRequestGraph();
    const result = compile({ graph, bindings: [] });

    // Somebody fixing a recorded workflow wants the whole list, not to
    // rediscover the next problem after each edit.
    // Three, not four: a navigate names a destination rather than an element,
    // so it needs no mapping.
    expect(refusalCodes(result)).toEqual(['missing_binding', 'missing_binding', 'missing_binding']);
  });
});

describe('an unbound call step', () => {
  it('refuses as a missing mapping, not as a mapping failure of some other kind', () => {
    // Falling through to the extract branch would report that the step "reads a
    // value but its mapping does not" — true of an extract and meaningless
    // here. A refusal that describes the wrong problem sends the reader
    // somewhere real and wrong.
    const graph = findServiceRequestGraph();
    const steps: SopStep[] = [
      {
        id: 'lookup_customer',
        kind: 'call',
        purpose: 'Find the customer record before deciding',
        requestHint: 'the customer record for this request',
        systemHint: 'Salesforce',
      },
      ...graph.steps,
    ];

    const result = compile({
      graph: { ...graph, entryStepId: 'lookup_customer', steps },
    });

    const codes = refusalCodes(result);
    // `missing_binding` rather than `call_binding_unsupported`: binding a call
    // is supported now, and this one simply has none. `call_binding_unsupported`
    // moved to the case it actually describes -- an operation this deployment
    // does not hold.
    expect(codes).toContain('missing_binding');
    expect(codes).not.toContain('extract_coverage_gap');
  });
});

describe('compiling a bound call step', () => {
  const CATALOG = {
    id: 'service-desk',
    title: 'Service Desk',
    hosts: ['api.example.gov'],
    baseUrl: 'https://api.example.gov',
    operations: [
      {
        operationId: 'getRequest',
        method: 'get' as const,
        path: '/requests/{id}',
        parameters: [
          { name: 'id', location: 'path' as const, required: true, type: 'string' as const },
        ],
        idempotent: true,
      },
    ],
  };

  function graphWithCall() {
    const graph = findServiceRequestGraph();
    return {
      ...graph,
      entryStepId: 'lookup',
      steps: [
        {
          id: 'lookup',
          kind: 'call' as const,
          purpose: 'Find the request before opening the portal',
          requestHint: 'the service request record',
          systemHint: 'Service Desk',
        },
        ...graph.steps,
      ],
    };
  }

  const callBinding = {
    kind: 'call' as const,
    catalogId: 'service-desk',
    operationId: 'getRequest',
    arguments: { id: { kind: 'input' as const, inputId: 'requestNumber' } },
    reads: { requestStatus: '/status' },
    auth: { scheme: 'bearer' as const, credentialRef: 'serviceDeskToken' },
  };

  function compileWithCall(
    body: unknown = callBinding,
    catalogs: unknown = { 'service-desk': CATALOG },
  ) {
    const graph = graphWithCall();
    return compile({
      graph,
      bindings: [
        ...bindingsFor(graph),
        {
          id: 'binding_call',
          documentId: IDS.sopId,
          stepId: 'lookup',
          status: 'approved',
          stepSha256: stepChecksum(graph.steps[0] as SopStep),
          body,
        } as unknown as ExecutionBinding,
      ],
      catalogs,
    } as unknown as Partial<CompileInput>);
  }

  it('compiles to an api.request naming the operation, never a URL', () => {
    const result = compileWithCall();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const step = result.agentIr.steps.find((one) => one.type === 'api.request');
    expect(step).toMatchObject({
      catalogId: 'service-desk',
      operationId: 'getRequest',
      // The argument became a reference, not a baked-in value.
      arguments: { id: '${inputs.requestNumber}' },
      assign: { requestStatus: '/status' },
    });
  });

  it('grants only the operation and host this workflow actually reaches', () => {
    const result = compileWithCall();
    if (!result.ok) throw new Error('expected a candidate');

    // Derived from what compiled, never from what the catalog offers — the
    // pattern ADR-022 set for allowedDomains.
    expect(result.agentIr.permissions.api).toEqual({
      allowedHosts: ['api.example.gov'],
      allowedOperations: ['getRequest'],
      allowedActions: ['request'],
    });
    expect(result.agentIr.permissions.credentials).toEqual({ allowedRefs: ['serviceDeskToken'] });
  });

  it('refuses an operation this deployment does not hold, rather than compiling it', () => {
    const result = compileWithCall(callBinding, {});
    expect(refusalCodes(result)).toContain('call_binding_unsupported');
  });

  it('refuses a required parameter with nowhere to come from', () => {
    const result = compileWithCall({ ...callBinding, arguments: {} });
    expect(refusalCodes(result)).toContain('unusable_value_source');
  });
});

/**
 * Computed decisions (ADR-040).
 *
 * Built on the Phase 1 graph by inserting a decision that compares the status
 * the workflow already extracts against a literal, and routing its two branches
 * at the two outcome steps. Nothing is bound for it, deliberately: a computed
 * decision needs no binding, and a test that supplied one would not prove that.
 */
describe('a decision resolved by comparing values', () => {
  function graphWithComparison(
    comparison: {
      left: string;
      operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
      right: string;
    },
    branchOverrides?: { when: string; nextStepId: string; otherwise?: boolean }[],
  ): SopGraph {
    const base = findServiceRequestGraph();
    const steps: SopStep[] = [
      ...base.steps.slice(0, 4),
      {
        id: 'is_in_progress',
        kind: 'decision',
        question: 'Is the request still in progress?',
        resolution: 'computed',
        ruleText: 'A request still in progress is reported as open.',
        comparison,
        branches: branchOverrides ?? [
          { when: 'still in progress', nextStepId: 'found' },
          { when: 'anything else', nextStepId: 'closed', otherwise: true },
        ],
      },
      base.steps[4]!,
      {
        id: 'closed',
        kind: 'outcome',
        outcome: 'request_found',
        message: 'The request was found and is not in progress.',
      },
    ];

    return { ...base, steps };
  }

  it('compiles to a value.compare that touches no surface and needs no binding', () => {
    const graph = graphWithComparison({
      left: '${variables.requestStatus}',
      operator: 'eq',
      right: 'In Progress',
    });
    const result = compile({ graph, bindings: bindingsFor(graph) });

    expect(refusalCodes(result)).toEqual([]);
    if (!result.ok) return;

    const compiled = result.agentIr.steps.find((step) => step.id === 'is_in_progress');

    expect(compiled).toEqual({
      id: 'is_in_progress',
      sourceSopStepIds: ['is_in_progress'],
      type: 'value.compare',
      left: '${variables.requestStatus}',
      operator: 'eq',
      right: 'In Progress',
      // The branch that is *not* marked `otherwise`, so reordering the two in
      // the graph cannot swap them here.
      whenTrue: 'found',
      whenFalse: 'closed',
      describedAs: 'Request Status is In Progress',
    });
  });

  it('grants no model permission, because no model is asked anything', () => {
    const graph = graphWithComparison({
      left: '${variables.requestStatus}',
      operator: 'eq',
      right: 'In Progress',
    });
    const result = compile({ graph, bindings: bindingsFor(graph) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agentIr.permissions.model).toBeUndefined();
  });

  it('refuses a comparison against a value no step in the workflow reads', () => {
    // The load-bearing refusal: the alternative is Orbit deriving the figure
    // itself, becoming a second calculator beside the system of record.
    const graph = graphWithComparison({
      left: '${variables.loanToValue}',
      operator: 'gt',
      right: '80',
    });
    const result = compile({ graph, bindings: bindingsFor(graph) });

    expect(refusalCodes(result)).toContain('uncompilable_comparison');
    if (result.ok) return;

    const refusal = result.refusals.find((entry) => entry.code === 'uncompilable_comparison');
    expect(refusal?.message).toContain('Loan To Value');
    expect(refusal?.message).toContain('will not work it out for itself');
  });

  it('refuses two branches where neither says what happens when it does not hold', () => {
    const graph = graphWithComparison(
      { left: '${variables.requestStatus}', operator: 'eq', right: 'In Progress' },
      [
        { when: 'still in progress', nextStepId: 'found' },
        { when: 'anything else', nextStepId: 'closed' },
      ],
    );
    const result = compile({ graph, bindings: bindingsFor(graph) });

    expect(refusalCodes(result)).toContain('uncompilable_comparison');
  });

  it('refuses a branch pointing at a step this workflow does not have', () => {
    const graph = graphWithComparison(
      { left: '${variables.requestStatus}', operator: 'eq', right: 'In Progress' },
      [
        { when: 'still in progress', nextStepId: 'no_such_step' },
        { when: 'anything else', nextStepId: 'closed', otherwise: true },
      ],
    );
    const result = compile({ graph, bindings: bindingsFor(graph) });

    expect(refusalCodes(result)).toContain('unresolved_branch_target');
  });
});
