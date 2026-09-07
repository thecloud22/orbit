/**
 * Constants the end-to-end stack shares between its setup and its tests.
 *
 * Deliberately not the development ports: a developer running `pnpm dev` must be
 * able to run these tests without the two stacks fighting over a port, and the
 * test API must never be mistaken for the one pointed at `orbit_dev`.
 *
 * **3010 and 3102 are reserved. No app in this repository may listen on
 * either.** `apps/library-portal` was added on 3010, which made
 * `pnpm test:e2e:watchtower` unrunnable whenever `pnpm dev` was up — and worse,
 * before the stack learned to refuse an occupied port, Vite quietly relocated
 * and the whole suite drove the library portal while reporting itself ready.
 */
export const E2E_API_PORT = 3102;
export const E2E_WEB_PORT = 3010;

export const E2E_API_URL = `http://127.0.0.1:${E2E_API_PORT}`;
export const E2E_WATCHTOWER_URL = `http://localhost:${E2E_WEB_PORT}`;

/**
 * A document the stack seeds with one approved Execution Binding.
 *
 * Seeded rather than created through the UI: what the visibility tests need is
 * a document already in that state, not the act of getting there, which the
 * binding-session tests cover separately. The id is fixed so the setup and the
 * test agree on it without passing state between them.
 */
export const E2E_BOUND_DOCUMENT_ID = 'sopdoc_e2e_binding_visibility';

/** The one step of that document which has an approved binding. */
export const E2E_BOUND_STEP_ID = 'sign_in';

/**
 * A drafted document the stack seeds with no bindings at all.
 *
 * Its own document rather than the one above, so that binding a step in the
 * end-to-end test cannot change what the binding-visibility tests observe. It
 * is `generated`, because that is the workflow kind that reached the compiler
 * unbound and was refused — the gap binding sessions close (ADR-027).
 */
export const E2E_BINDABLE_DOCUMENT_ID = 'sopdoc_e2e_binding_session';

/** The step the end-to-end test binds: a non-sensitive fill. */
export const E2E_BINDABLE_STEP_ID = 'enter_request_number';
