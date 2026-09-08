import type { ApiSystemId } from '@orbit/contracts';
import { check, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, inValues, opaqueId, updatedAt } from './columns';

/** How a registered system authenticates. Bearer and Basic are one header each. */
export const API_AUTH_SCHEMES = ['none', 'bearer', 'basic'] as const;

/**
 * An API contract this deployment holds, registered by a person.
 *
 * Deliberately not part of any published Agent Version. A contract is a
 * re-importable fact about a service; what a version carries is the *grant*
 * derived from it — which operations and which hosts — because that is what a
 * reviewer approved and it must not change under a running agent (ADR-005,
 * ADR-037).
 *
 * **No column here holds a secret, and that is structural rather than a
 * convention.** `credentialRef` is a *name*: `serviceDeskToken` resolves to
 * `ORBIT_CREDENTIAL_SERVICE_DESK_TOKEN` at the moment a header is built
 * (ADR-038). Orbit has no authentication, so anyone who can reach Watchtower
 * can edit this table — which is exactly why the value is not in it. Admin can
 * say whether the variable is set; it can never show or set what is in it.
 */
export const apiSystems = pgTable(
  'api_systems',
  {
    id: opaqueId<ApiSystemId>('id').primaryKey(),
    /** The catalog id a `call` binding names. Stable, lowercase, unique. */
    catalogId: text('catalog_id').notNull().unique(),
    /** What a person calls this system, e.g. "Service Desk". */
    name: text('name').notNull(),
    /** The OpenAPI document as registered, parsed on read. Never fetched. */
    specText: text('spec_text').notNull(),
    authScheme: text('auth_scheme').notNull().default('none'),
    /** For `basic` and `bearer`: the credential *name*, never a value. */
    credentialRef: text('credential_ref'),
    /** Header name when a service wants something other than Authorization. */
    authHeaderName: text('auth_header_name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [check('api_systems_auth_scheme_check', inValues(table.authScheme, API_AUTH_SCHEMES))],
);

export type ApiSystemRow = typeof apiSystems.$inferSelect;
export type NewApiSystemRow = typeof apiSystems.$inferInsert;
