import { z } from 'zod';

import { fieldsInBufferOrder, type Screen, type ScreenField } from './screen';

/**
 * How a step names a field on a screen. A closed vocabulary, by construction.
 *
 * This is the terminal surface's answer to ADR-018's locator strategies, and it
 * is closed for the same reason. A raw buffer offset or a regex over screen text
 * would each be a small program for finding a field, and a small program is
 * exactly what a reviewer cannot check and what drift detection cannot reason
 * about. Three strategies, none of which can express arbitrary search:
 *
 * - `field_at` — the field starting at a position. Exact and brittle in the
 *   honest way: if the screen moves, the binding fails rather than guessing.
 * - `field_after_label` — the first input field following a piece of protected
 *   text. This is how green screens are actually laid out (`USERID ===> ____`),
 *   and it survives a screen shifting by a row.
 * - `named_field` — a field the recording gave a stable name. The name comes
 *   from the binding, never from the host.
 *
 * `Locator` from @orbit/agent-ir is deliberately not reused or widened: a DOM
 * element and a buffer field have nothing in common to unify, and one type
 * serving both would collapse into a string (ADR-037).
 */
export const screenAddressStrategySchema = z.enum(['field_at', 'field_after_label', 'named_field']);
export type ScreenAddressStrategy = z.infer<typeof screenAddressStrategySchema>;

export const screenAddressSchema = z.discriminatedUnion('strategy', [
  z.strictObject({
    strategy: z.literal('field_at'),
    row: z.number().int().min(0),
    column: z.number().int().min(0),
  }),
  z.strictObject({
    strategy: z.literal('field_after_label'),
    /** Matched against protected field text, whitespace-normalised. */
    label: z.string().min(1),
  }),
  z.strictObject({
    strategy: z.literal('named_field'),
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  }),
]);
export type ScreenAddress = z.infer<typeof screenAddressSchema>;

/** Trailing `===>`, colons and whitespace are noise on a green screen label. */
function normalizeLabel(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[\s:=>._-]+$/, '')
    .trim()
    .toLowerCase();
}

export type ScreenResolution =
  | { readonly resolved: true; readonly field: ScreenField }
  | { readonly resolved: false; readonly reason: 'not_found' | 'ambiguous' };

/**
 * Finds the field an address names, or says why it could not.
 *
 * Total and deterministic: no scanning for lookalikes, no nearest match, no
 * partial credit. `ambiguous` is reported rather than resolved, because choosing
 * between two candidates is the judgement this layer refuses to make — the same
 * stance ADR-033 takes for drift recovery.
 *
 * `named_field` resolves nothing here on purpose. A name is an artifact of the
 * binding, not of the screen, so only something holding the binding can turn one
 * into a position; this layer is given screens, never bindings.
 */
export function resolveAddress(screen: Screen, address: ScreenAddress): ScreenResolution {
  const ordered = fieldsInBufferOrder(screen);

  if (address.strategy === 'field_at') {
    const matches = ordered.filter(
      (field) => field.start.row === address.row && field.start.column === address.column,
    );
    return single(matches);
  }

  if (address.strategy === 'field_after_label') {
    const wanted = normalizeLabel(address.label);
    const matches: ScreenField[] = [];

    ordered.forEach((field, index) => {
      if (!field.attributes.protected || normalizeLabel(field.text) !== wanted) {
        return;
      }

      // The first field after the label that can actually be typed into. A
      // label is followed by its input; anything protected in between is more
      // caption, not the target.
      const target = ordered.slice(index + 1).find((next) => !next.attributes.protected);
      if (target !== undefined) {
        matches.push(target);
      }
    });

    return single(matches);
  }

  return { resolved: false, reason: 'not_found' };
}

function single(matches: readonly ScreenField[]): ScreenResolution {
  if (matches.length === 1 && matches[0] !== undefined) {
    return { resolved: true, field: matches[0] };
  }
  return { resolved: false, reason: matches.length === 0 ? 'not_found' : 'ambiguous' };
}
