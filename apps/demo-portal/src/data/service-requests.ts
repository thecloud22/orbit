export interface ServiceRequest {
  readonly requestNumber: string;
  readonly status: string;
  readonly assignedTeam: string;
}

/**
 * Seeded service requests for the controlled Phase 1 demo portal.
 *
 * This is the portal's entire data source: in-memory, read-only, and never
 * mutated. There is deliberately no database, API, or network dependency —
 * the portal exists to be a deterministic automation target.
 */
export const SERVICE_REQUESTS: readonly ServiceRequest[] = Object.freeze([
  Object.freeze({
    requestNumber: 'SR-1001',
    status: 'In Progress',
    assignedTeam: 'Infrastructure Operations',
  }),
]);

/**
 * Looks up a service request by its number.
 *
 * Surrounding whitespace is trimmed, but matching is case-sensitive. The SOP's
 * completion criterion requires the displayed request number to match the
 * requested one exactly; case-folding here would let an input of 'sr-1001'
 * render 'SR-1001' and break that assertion in the Agent IR.
 *
 * A blank input is not an unknown request number — it is simply nothing to
 * look up — so it returns undefined and the caller stays in its initial state.
 */
export function findServiceRequest(requestNumber: string): ServiceRequest | undefined {
  const normalized = requestNumber.trim();

  if (normalized.length === 0) {
    return undefined;
  }

  return SERVICE_REQUESTS.find((request) => request.requestNumber === normalized);
}
