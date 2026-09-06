import { escalationReviewGraph } from '@orbit/sop-graph/testing';
import { describe, expect, it } from 'vitest';

import {
  captureModeForStep,
  declaredNames,
  decideStartUrl,
  readMethodFor,
  resolveValueSource,
  stepChoices,
  suggestedStartUrl,
} from './flow';

const GRAPH = escalationReviewGraph();

function step(id: string) {
  const found = GRAPH.steps.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`The fixture has no step "${id}".`);
  }
  return found;
}

describe('stepChoices', () => {
  it('labels steps the way the review view does', () => {
    const choices = stepChoices(GRAPH, new Set());
    expect(choices.map((choice) => choice.label)).toContain(
      'Open the service request portal sign-in page',
    );
  });

  it('lists a manual_review step rather than hiding it, and says why it cannot be recorded', () => {
    // Hiding it would leave someone hunting for a step they can see in the
    // review view; saying why answers the question before it is asked.
    const choices = stepChoices(GRAPH, new Set());
    const manual = choices.find((choice) => choice.step.kind === 'manual_review');

    expect(manual).toBeDefined();
    expect(manual?.bindable).toBe(false);
    expect(manual?.reason).toContain('routes to a person');
  });

  it('marks every other kind bindable', () => {
    for (const choice of stepChoices(GRAPH, new Set())) {
      expect(choice.bindable).toBe(choice.step.kind !== 'manual_review');
    }
  });

  it('reports which steps already have a binding', () => {
    const choices = stepChoices(GRAPH, new Set(['open_portal']));
    expect(choices.find((choice) => choice.step.id === 'open_portal')?.hasBinding).toBe(true);
    expect(choices.find((choice) => choice.step.id === 'sign_in')?.hasBinding).toBe(false);
  });
});

describe('decideStartUrl', () => {
  it('accepts a localhost sandbox', () => {
    expect(decideStartUrl('http://localhost:3001/requests')).toEqual({
      ok: true,
      url: 'http://localhost:3001/requests',
    });
    expect(decideStartUrl('http://127.0.0.1:3001/').ok).toBe(true);
  });

  it('refuses anything that is not the sandbox, because recording is a real action', () => {
    const decision = decideStartUrl('https://service-portal.example.com/login');

    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.reason).toContain('real actions');
    expect(!decision.ok && decision.reason).toContain('local sandbox');
  });

  it('refuses a protocol Orbit will not open', () => {
    expect(decideStartUrl('file:///etc/passwd').ok).toBe(false);
    expect(decideStartUrl('javascript:alert(1)').ok).toBe(false);
  });

  it('refuses something that is not a URL at all', () => {
    expect(decideStartUrl('the portal').ok).toBe(false);
  });
});

describe('suggestedStartUrl', () => {
  it('offers a navigate step’s urlHint as a starting point', () => {
    expect(suggestedStartUrl(step('open_portal'))).toBe('https://service-portal.example.com/login');
  });

  it('offers nothing for a step that names no address', () => {
    expect(suggestedStartUrl(step('sign_in'))).toBeUndefined();
  });

  it('is only a suggestion — it still has to pass the sandbox check', () => {
    // The fixture's hint is an example.com URL, which must not open.
    const hint = suggestedStartUrl(step('open_portal'));
    expect(hint).toBeDefined();
    expect(decideStartUrl(hint!).ok).toBe(false);
  });
});

describe('captureModeForStep', () => {
  it('demonstrates an action for navigate, fill and click', () => {
    expect(captureModeForStep(step('sign_in'))).toBe('action');
    expect(captureModeForStep(step('enter_login_id'))).toBe('action');
  });

  it('picks without acting for a step that only reads', () => {
    // An extract step must never fire the page's handlers just because someone
    // pointed at a value.
    expect(captureModeForStep(step('extract_request_details'))).toBe('pick');
    expect(captureModeForStep(step('check_closed'))).toBe('pick');
  });
});

describe('resolveValueSource', () => {
  it('references a value the workflow declares', () => {
    expect(resolveValueSource({ kind: 'variable', name: 'requestNumber' }, 'SR-1001')).toEqual({
      kind: 'sop_variable',
      name: 'requestNumber',
    });
  });

  it('discards the typed value unless it is explicitly kept', () => {
    // The typed value exists to prove the right field was hit. A durable
    // artifact that quietly retains whatever someone entered is not one this
    // phase is built to protect.
    const source = resolveValueSource({ kind: 'variable', name: 'password' }, 'hunter2');

    expect(source).toEqual({ kind: 'sop_variable', name: 'password' });
    expect(JSON.stringify(source)).not.toContain('hunter2');
  });

  it('keeps the typed value only when asked to', () => {
    expect(resolveValueSource({ kind: 'keep_typed_value' }, 'SR-1001')).toEqual({
      kind: 'literal',
      value: 'SR-1001',
    });
  });

  it('accepts a literal entered deliberately', () => {
    expect(resolveValueSource({ kind: 'literal', value: 'SR-2002' }, 'SR-1001')).toEqual({
      kind: 'literal',
      value: 'SR-2002',
    });
  });
});

describe('declaredNames', () => {
  it('collects inputs, extracted fields and derived values', () => {
    const names = declaredNames(GRAPH);

    expect(names).toContain('requestNumber');
    expect(names).toContain('assignedTeam');
    expect(names).toContain('isStaleEscalation');
  });

  it('is sorted and free of duplicates', () => {
    const names = declaredNames(GRAPH);
    expect([...names]).toEqual([...new Set(names)].sort());
  });
});

describe('readMethodFor', () => {
  it('covers every read method the schema allows', () => {
    expect(readMethodFor('text')).toEqual({ kind: 'text' });
    expect(readMethodFor('checked')).toEqual({ kind: 'checked' });
    expect(readMethodFor('attribute', 'href')).toEqual({ kind: 'attribute', attribute: 'href' });
  });

  it('defaults an attribute read rather than producing an invalid one', () => {
    expect(readMethodFor('attribute')).toEqual({ kind: 'attribute', attribute: 'value' });
  });
});
