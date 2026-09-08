import { classifyInterpolation, type AgentIr } from '@orbit/agent-ir';

/**
 * Deciding whether a candidate can be validated in a sandbox at all.
 *
 * This is a **precondition**, checked before anything launches a browser — not
 * a guard reached part-way through a run. The distinction is the whole point.
 *
 * A recorded sign-in compiles to a `browser.fill` whose value is
 * `${inputs.password}` against an input the SOP Graph declared as `secret`.
 * Phase 1 has no runtime secret resolution, so there is nothing to put in that
 * field. A per-step guard would mean a browser is already open on a real page
 * with a real password box when the problem is discovered, and the tempting
 * repair at that moment is to type something — an empty string, a placeholder —
 * into a live credential field.
 *
 * So the question is answered before the browser exists. If any step needs a
 * secret, validation reports that it cannot run and no browser is launched.
 * There is no path on which a password field is reached with nothing to give
 * it, because no field is reached.
 *
 * **ADR-038 narrows this rather than removing it.** A `${credentials.name}`
 * value *is* resolvable -- the validator has already proved the name is in the
 * version's `permissions.credentials.allowedRefs` -- so it no longer trips the
 * gate. What still trips it is a secret *input*, which Orbit has no way to
 * supply. The fail-closed property is unchanged; only its trigger is narrower.
 *
 * Agent IR has no secret type — a secret input compiles to an ordinary string
 * declaration — so secret-ness is not recoverable from the compiled document.
 * The compiler returns the secret input ids separately and this reads those.
 */

export type SandboxReadiness =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'secret_unresolvable';
      /** The inputs that cannot be supplied, named so the report can say which. */
      readonly inputIds: readonly string[];
      readonly message: string;
    };

export function assessSandboxReadiness(
  agentIr: AgentIr,
  secretInputIds: readonly string[],
): SandboxReadiness {
  if (secretInputIds.length === 0) {
    return { ok: true };
  }

  const secrets = new Set(secretInputIds);
  const required = new Set<string>();

  for (const step of agentIr.steps) {
    if (step.type !== 'browser.fill') {
      continue;
    }

    const classified = classifyInterpolation(step.value);

    if (classified.kind !== 'reference') {
      continue;
    }

    // A credential reference is the resolvable form. The validator has already
    // proved it is in `permissions.credentials.allowedRefs`, so reaching this
    // field means the deployment is asked for a name the version declared --
    // which is exactly the case this gate was built to keep out and now lets
    // through (ADR-038 narrowing ADR-021).
    if (classified.reference.namespace === 'credentials') {
      continue;
    }

    if (classified.reference.namespace === 'inputs' && secrets.has(classified.reference.name)) {
      required.add(classified.reference.name);
    }
  }

  if (required.size === 0) {
    // Declared but never used. Nothing would be typed into a credential field,
    // so there is nothing to fail closed about.
    return { ok: true };
  }

  const named = [...required].sort();

  return {
    ok: false,
    reason: 'secret_unresolvable',
    inputIds: named,
    message:
      `This workflow needs ${named.map((id) => `"${id}"`).join(', ')}, which Orbit cannot supply yet. ` +
      'It was not tried against a real page, because doing so would mean opening a browser on a ' +
      'sign-in form with nothing to enter.',
  };
}
