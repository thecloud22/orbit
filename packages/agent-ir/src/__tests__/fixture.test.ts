import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { buildStepGraph, reachableStepIds, topologicalOrder } from '../graph';
import { parseAgentIrDocument, parseAgentIrYaml } from '../parse';
import type { AgentIrIssueCode } from '../validate';

/**
 * Reading the fixture from disk happens here, in a test, never in the package
 * itself: @orbit/agent-ir parses text and knows nothing about the filesystem.
 */
const FIXTURE_PATH = fileURLToPath(
  new URL('../../../../fixtures/find-service-request.agent.yaml', import.meta.url),
);

const fixtureYaml = readFileSync(FIXTURE_PATH, 'utf8');

/** A mutable view of the fixture document, for building deliberately invalid variants. */
type MutableDocument = Record<string, unknown> & {
  steps: Record<string, unknown>[];
  permissions: { browser: { allowedActions: string[]; allowedDomains: string[] } };
  variables: Record<string, unknown>;
  outputs: Record<string, unknown>;
  source: { sourceSopStepIds: string[] };
};

function document(): MutableDocument {
  return structuredClone(parseYaml(fixtureYaml)) as MutableDocument;
}

function stepNamed(doc: MutableDocument, id: string): Record<string, unknown> {
  const found = doc.steps.find((candidate) => candidate['id'] === id);
  if (found === undefined) {
    throw new Error(`fixture has no step "${id}"`);
  }
  return found;
}

function codesFrom(doc: MutableDocument): readonly AgentIrIssueCode[] {
  const result = parseAgentIrDocument(doc);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe('seeded Find Service Request fixture', () => {
  it('parses and validates with no issues', () => {
    const result = parseAgentIrYaml(fixtureYaml);

    if (!result.ok) {
      throw new Error(
        `expected the seeded fixture to be valid, got: ${JSON.stringify(result.issues, null, 2)}`,
      );
    }

    expect(result.agentIr.id).toBe('agent_find_service_request');
    expect(result.agentIr.version).toBe('0.1.0');
    expect(result.agentIr.lifecycle.trustTier).toBe('observe');
    expect(result.agentIr.steps).toHaveLength(8);
  });

  it('exposes typed inputs, variables, and outputs', () => {
    const result = parseAgentIrYaml(fixtureYaml);
    if (!result.ok) throw new Error('fixture invalid');

    expect(result.agentIr.inputs['requestNumber']?.required).toBe(true);
    expect(result.agentIr.inputs['requestNumber']?.validation?.maxLength).toBe(100);
    expect(Object.keys(result.agentIr.variables)).toEqual(['requestStatus', 'assignedTeam']);
    expect(Object.keys(result.agentIr.outputs)).toEqual([
      'requestNumber',
      'requestStatus',
      'assignedTeam',
    ]);
  });

  it('models the documented control flow', () => {
    const result = parseAgentIrYaml(fixtureYaml);
    if (!result.ok) throw new Error('fixture invalid');

    const graph = buildStepGraph(result.agentIr);

    expect(graph.entryStepId).toBe('open_request_portal');
    // The branch transfers control explicitly and never falls through.
    expect(graph.successors.get('detect_request_result')).toEqual([
      'verify_request_number',
      'complete_not_found',
    ]);
    // Ordinary steps fall through in array order.
    expect(graph.successors.get('verify_request_number')).toEqual(['extract_request_data']);
    // complete is terminal, which is what stops the found path running into the not-found step.
    expect(graph.successors.get('complete_found')).toEqual([]);

    expect(reachableStepIds(graph).size).toBe(8);
    expect(topologicalOrder(graph)).toBeDefined();
  });

  it('maps every step back to a declared SOP step', () => {
    const result = parseAgentIrYaml(fixtureYaml);
    if (!result.ok) throw new Error('fixture invalid');

    const declared = new Set(result.agentIr.source.sourceSopStepIds);
    for (const step of result.agentIr.steps) {
      expect(step.sourceSopStepIds.length).toBeGreaterThan(0);
      for (const sopStepId of step.sourceSopStepIds) {
        expect(declared.has(sopStepId)).toBe(true);
      }
    }
  });
});

describe('invalid fixtures', () => {
  it('rejects malformed YAML', () => {
    const result = parseAgentIrYaml('steps: [\n  - id: "unterminated');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe('YAML_PARSE_ERROR');
  });

  it('rejects a duplicate step id', () => {
    const doc = document();
    stepNamed(doc, 'complete_not_found')['id'] = 'complete_found';
    expect(codesFrom(doc)).toContain('DUPLICATE_STEP_ID');
  });

  it('rejects an unknown step type', () => {
    const doc = document();
    stepNamed(doc, 'submit_request_search')['type'] = 'browser.hover';
    expect(codesFrom(doc)).toContain('SCHEMA_ERROR');
  });

  it('rejects an unsupported locator strategy', () => {
    const doc = document();
    stepNamed(doc, 'enter_request_number')['locator'] = { strategy: 'css', value: '#request' };
    expect(codesFrom(doc)).toContain('SCHEMA_ERROR');
  });

  it('rejects an unsupported assertion type', () => {
    const doc = document();
    stepNamed(doc, 'verify_request_number')['assertion'] = {
      type: 'locator_has_class',
      locator: { strategy: 'test_id', value: 'request-number-result' },
      expected: 'x',
    };
    expect(codesFrom(doc)).toContain('SCHEMA_ERROR');
  });

  it('rejects a branch target that does not exist', () => {
    const doc = document();
    const step = stepNamed(doc, 'detect_request_result');
    const alternatives = step['alternatives'] as Record<string, unknown>[];
    alternatives[0]!['next'] = 'no_such_step';
    expect(codesFrom(doc)).toContain('UNKNOWN_BRANCH_TARGET');
  });

  it('rejects a branch that creates a loop', () => {
    const doc = document();
    const step = stepNamed(doc, 'detect_request_result');
    const alternatives = step['alternatives'] as Record<string, unknown>[];
    alternatives[0]!['next'] = 'open_request_portal';
    expect(codesFrom(doc)).toContain('CYCLE_NOT_SUPPORTED');
  });

  it('rejects a step with no source SOP step ids', () => {
    const doc = document();
    stepNamed(doc, 'submit_request_search')['sourceSopStepIds'] = [];
    expect(codesFrom(doc)).toContain('SCHEMA_ERROR');
  });

  it('rejects a SOP step id that is not declared in the source registry', () => {
    const doc = document();
    stepNamed(doc, 'submit_request_search')['sourceSopStepIds'] = ['sop_step_invented'];
    expect(codesFrom(doc)).toContain('SOP_STEP_NOT_DECLARED');
  });

  it('rejects a reference to an undeclared input', () => {
    const doc = document();
    stepNamed(doc, 'enter_request_number')['value'] = '${inputs.missingInput}';
    expect(codesFrom(doc)).toContain('UNDECLARED_INPUT_REFERENCE');
  });

  it('rejects a reference to an undeclared variable', () => {
    const doc = document();
    const step = stepNamed(doc, 'complete_found');
    (step['outputs'] as Record<string, unknown>)['requestStatus'] = '${variables.missingVariable}';
    expect(codesFrom(doc)).toContain('UNDECLARED_VARIABLE_REFERENCE');
  });

  it('rejects a result reference that names no extracted field', () => {
    const doc = document();
    const step = stepNamed(doc, 'extract_request_data');
    (step['assign'] as Record<string, unknown>)['requestStatus'] = '${result.notAField}';
    expect(codesFrom(doc)).toContain('UNKNOWN_EXTRACT_FIELD');
  });

  it('rejects a result reference used outside an extract step', () => {
    const doc = document();
    stepNamed(doc, 'enter_request_number')['value'] = '${result.requestStatus}';
    expect(codesFrom(doc)).toContain('REFERENCE_NOT_ALLOWED_HERE');
  });

  it('rejects an input reference used as an extract assignment', () => {
    const doc = document();
    const step = stepNamed(doc, 'extract_request_data');
    (step['assign'] as Record<string, unknown>)['requestStatus'] = '${inputs.requestNumber}';
    expect(codesFrom(doc)).toContain('REFERENCE_NOT_ALLOWED_HERE');
  });

  it('rejects a malformed reference instead of treating it as a literal', () => {
    const doc = document();
    stepNamed(doc, 'enter_request_number')['value'] = '${inputs.requestNumber';
    expect(codesFrom(doc)).toContain('MALFORMED_REFERENCE');
  });

  it('rejects assigning to an undeclared variable', () => {
    const doc = document();
    const step = stepNamed(doc, 'extract_request_data');
    (step['assign'] as Record<string, unknown>)['undeclaredVariable'] = '${result.requestStatus}';
    expect(codesFrom(doc)).toContain('UNDECLARED_ASSIGN_TARGET');
  });

  it('rejects an output that is not declared', () => {
    const doc = document();
    const step = stepNamed(doc, 'complete_found');
    (step['outputs'] as Record<string, unknown>)['undeclaredOutput'] = '${inputs.requestNumber}';
    expect(codesFrom(doc)).toContain('UNDECLARED_OUTPUT');
  });

  it('rejects navigation to a domain that is not permitted', () => {
    const doc = document();
    stepNamed(doc, 'open_request_portal')['url'] = 'https://example.com/requests';
    expect(codesFrom(doc)).toContain('DOMAIN_NOT_PERMITTED');
  });

  it('rejects a non-http protocol', () => {
    const doc = document();
    stepNamed(doc, 'open_request_portal')['url'] = 'file:///etc/passwd';
    expect(codesFrom(doc)).toContain('UNSUPPORTED_URL_PROTOCOL');
  });

  it('rejects a URL that cannot be parsed', () => {
    const doc = document();
    stepNamed(doc, 'open_request_portal')['url'] = 'not a url';
    expect(codesFrom(doc)).toContain('INVALID_URL');
  });

  it('rejects a step whose browser action is not granted', () => {
    const doc = document();
    doc.permissions.browser.allowedActions = doc.permissions.browser.allowedActions.filter(
      (action) => action !== 'expect_one_of',
    );
    expect(codesFrom(doc)).toContain('ACTION_NOT_PERMITTED');
  });

  it('rejects evidence capture that is not granted', () => {
    const doc = document();
    doc.permissions.browser.allowedActions = doc.permissions.browser.allowedActions.filter(
      (action) => action !== 'screenshot',
    );
    expect(codesFrom(doc)).toContain('EVIDENCE_NOT_PERMITTED');
  });

  it('rejects reading a variable that is not assigned on every path', () => {
    const doc = document();
    // Drop the extraction that assigns the variables the found path reports.
    doc.steps = doc.steps.filter((step) => step['id'] !== 'extract_request_data');
    expect(codesFrom(doc)).toContain('VARIABLE_NOT_ASSIGNED_ON_ALL_PATHS');
  });

  it('rejects an unreachable step', () => {
    const doc = document();
    doc.steps.push({
      id: 'orphan_step',
      type: 'browser.click',
      sourceSopStepIds: ['sop_step_search_and_verify'],
      locator: { strategy: 'test_id', value: 'search-request-button' },
    });
    expect(codesFrom(doc)).toContain('UNREACHABLE_STEP');
  });

  it('rejects a workflow whose last step is not terminal', () => {
    const doc = document();
    doc.steps = doc.steps.filter((step) => step['type'] !== 'complete');
    const codes = codesFrom(doc);
    expect(codes).toContain('FALLS_OFF_END');
    expect(codes).toContain('NO_TERMINAL_PATH');
  });

  it('rejects none as a completion outcome', () => {
    const doc = document();
    stepNamed(doc, 'complete_found')['outcome'] = 'none';
    expect(codesFrom(doc)).toContain('SCHEMA_ERROR');
  });

  it('rejects a fail step whose error code is outside the taxonomy', () => {
    const doc = document();
    doc.steps = [
      ...doc.steps,
      {
        id: 'fail_step',
        type: 'fail',
        sourceSopStepIds: ['sop_step_search_and_verify'],
        errorCode: 'SOMETHING_ELSE',
        message: 'nope',
      },
    ];
    expect(codesFrom(doc)).toContain('SCHEMA_ERROR');
  });

  it('rejects an empty step list', () => {
    const doc = document();
    doc.steps = [];
    expect(codesFrom(doc)).toContain('SCHEMA_ERROR');
  });

  it('rejects unknown top-level keys so typos cannot pass silently', () => {
    const doc = document();
    (doc as Record<string, unknown>)['permisssions'] = {};
    expect(codesFrom(doc)).toContain('SCHEMA_ERROR');
  });

  it('rejects an expect_one_of with a single alternative', () => {
    const doc = document();
    const step = stepNamed(doc, 'detect_request_result');
    step['alternatives'] = [(step['alternatives'] as unknown[])[0]];
    expect(codesFrom(doc)).toContain('SCHEMA_ERROR');
  });
});
