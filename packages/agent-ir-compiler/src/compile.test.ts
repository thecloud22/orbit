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
    outcomeMapping: overrides.outcomeMapping ?? { request_found: 'request_found' },
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
    expect(result.agentIr.permissions.browser.allowedActions).toEqual([
      'click',
      'dom_snapshot',
      'extract',
      'fill',
      'navigate',
      'screenshot',
    ]);
    expect(result.agentIr.permissions.browser.allowedDomains).toEqual(['localhost']);
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
  it('refuses a branching workflow, naming the decision step', () => {
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

    expect(refusalCodes(result)).toContain('branching_unsupported');
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

  it('refuses an outcome nobody has mapped to a business result', () => {
    const graph = findServiceRequestGraph();
    const result = compile({ graph, outcomeMapping: {} });

    expect(refusalCodes(result)).toEqual(['unmapped_outcome']);
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

  it('refuses to compile a workflow that would leave the sandbox', () => {
    // The allowlist is passed in rather than copied here — the one definition
    // is ALLOWED_HOSTS in @orbit/runtime, which a pure compiler must not import.
    const graph = findServiceRequestGraph();
    const steps = graph.steps.map((step) =>
      step.id === 'open_portal' && step.kind === 'navigate'
        ? { ...step, urlHint: 'https://service-portal.example.com/requests' }
        : step,
    );

    const result = compile({
      graph: { ...graph, steps },
      bindings: bindingsFor({ ...graph, steps }).filter(
        (binding) => binding.stepId !== 'open_portal',
      ),
    });

    expect(refusalCodes(result)).toEqual(['navigation_not_permitted']);
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
    const result = compile({ graph, bindings: [], outcomeMapping: {} });

    // Somebody fixing a recorded workflow wants the whole list, not to
    // rediscover the next problem after each edit.
    // Three, not four: a navigate names a destination rather than an element,
    // so it needs no mapping.
    expect(refusalCodes(result)).toEqual([
      'missing_binding',
      'missing_binding',
      'missing_binding',
      'unmapped_outcome',
    ]);
  });
});
