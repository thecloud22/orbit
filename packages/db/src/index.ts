/**
 * @orbit/db
 *
 * Drizzle schema, migrations, and repositories for agents, agent versions,
 * runs, run steps, run events, and artifact metadata.
 *
 * Boundary: the only package permitted to talk to PostgreSQL. Applications
 * depend on its repositories rather than issuing queries themselves, and the
 * web application never depends on it at all.
 *
 * Task 1 scaffold: no schema, no migrations, and no driver dependency yet.
 * Implemented in Task 4, which also selects the PostgreSQL driver.
 */
export const PACKAGE_NAME = '@orbit/db' as const;
