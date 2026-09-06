/**
 * Constants the end-to-end stack shares between its setup and its tests.
 *
 * Deliberately not the development ports: a developer running `pnpm dev` must be
 * able to run these tests without the two stacks fighting over a port, and the
 * test API must never be mistaken for the one pointed at `orbit_dev`.
 */
export const E2E_API_PORT = 3102;
export const E2E_WEB_PORT = 3010;

export const E2E_API_URL = `http://127.0.0.1:${E2E_API_PORT}`;
export const E2E_WATCHTOWER_URL = `http://localhost:${E2E_WEB_PORT}`;

/**
 * A document the stack seeds with one approved Execution Binding.
 *
 * Seeded rather than created through the UI because there is no way to create a
 * binding from a web page — recording one means a person demonstrating a step in
 * a browser, which happens in the recorder CLI (ADR-019). The id is fixed so the
 * setup and the test agree on it without passing state between them.
 */
export const E2E_BOUND_DOCUMENT_ID = 'sopdoc_e2e_binding_visibility';

/** The one step of that document which has an approved binding. */
export const E2E_BOUND_STEP_ID = 'sign_in';
