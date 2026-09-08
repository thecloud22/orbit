/**
 * Reading a structured response, independently of who produced it.
 *
 * `usageOf` used to live here beside this, with a second copy in
 * @orbit/decision-judge. It now lives in @orbit/model-provider and is
 * re-exported below, because every call site in Orbit must read token usage
 * *identically* — a provider read slightly differently would make a budget mean
 * two things depending on which one was configured.
 *
 * What stays here is the part that is drafting's own: recovering the model's
 * unvalidated arguments so the repair loop can tell it exactly what was wrong.
 *
 * Nothing here imports LangChain. The shape is read defensively and
 * structurally, which is also what keeps the package's "one file may reach the
 * network" boundary honest — this is not that file.
 */

/**
 * Pulls the model's own output back out of the response.
 *
 * `includeRaw` is set by every provider so LangChain returns the tool call
 * rather than throwing when the arguments do not satisfy the bound schema. That
 * matters: an invalid proposal has to arrive at the validator as data, so the
 * repair loop can tell the model exactly what was wrong. If it surfaced as a
 * thrown provider error instead, every schema slip would look like an outage
 * and no repair would ever be attempted.
 */
export function unvalidatedArguments(response: {
  readonly raw: unknown;
  readonly parsed: unknown;
}): unknown {
  const raw = response.raw;

  if (typeof raw === 'object' && raw !== null && 'tool_calls' in raw) {
    const toolCalls = (raw as { readonly tool_calls?: unknown }).tool_calls;

    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const first: unknown = toolCalls[0];

      if (typeof first === 'object' && first !== null && 'args' in first) {
        return (first as { readonly args: unknown }).args;
      }
    }
  }

  // No tool call to read: fall back to whatever LangChain parsed, which may be
  // undefined when the model answered in prose. The validator decides.
  return response.parsed;
}

export { usageOf } from '@orbit/model-provider';
