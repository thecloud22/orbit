/**
 * Ports the end-to-end stack uses.
 *
 * Deliberately not the development ports: a developer running `pnpm dev` must be
 * able to run these tests without the two stacks fighting over a port, and the
 * test API must never be mistaken for the one pointed at `orbit_dev`.
 */
export const E2E_API_PORT = 3102;
export const E2E_WEB_PORT = 3010;

export const E2E_API_URL = `http://127.0.0.1:${E2E_API_PORT}`;
export const E2E_WATCHTOWER_URL = `http://localhost:${E2E_WEB_PORT}`;
