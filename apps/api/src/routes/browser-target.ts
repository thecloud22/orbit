import { badRequest } from '../errors';

/**
 * What the API will open a browser at, for a person to work in.
 *
 * Any `http` or `https` URL, and nothing else. `file:`, `data:` and
 * `javascript:` are refused everywhere (ADR-022). There is no host allowlist
 * here on purpose: a recording or a binding session is somebody doing their
 * job, and what an *agent* may later open unattended is constrained per agent
 * by the `allowedDomains` its version declares — the agent is the thing that
 * needs containing.
 *
 * One function, called by both the recording routes and the binding-session
 * routes, so the two cannot come to disagree about which protocols are
 * acceptable.
 */
export function assertOpenableTarget(candidate: string): string {
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw badRequest(`"${candidate}" is not a URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest(`${url.protocol} is not a protocol Orbit will open.`);
  }

  return url.toString();
}
