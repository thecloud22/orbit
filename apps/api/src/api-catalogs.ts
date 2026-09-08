import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { importOpenApi, type ApiCatalog, type ImportRefusal } from '@orbit/api-catalog';
import { parse as parseYaml } from 'yaml';

/**
 * Loading the API contracts a deployment holds.
 *
 * File reading lives here rather than in @orbit/api-catalog, which stays pure:
 * importing a contract and finding one on disk are different capabilities, and a
 * package that only parses can never be the thing that reads an arbitrary path.
 *
 * Catalogs are deployment configuration, not part of a published version. A
 * contract is a re-importable fact about a service; what the version carries is
 * the grant derived from it -- which operations, which hosts -- because that is
 * what a reviewer approved and it must not change under a running agent
 * (ADR-005, ADR-037).
 *
 * The catalog id is the file's base name, so `service-desk.yaml` is
 * `service-desk`. Derived rather than read from inside the document: two
 * contracts declaring the same id would otherwise silently shadow each other.
 */

export const CATALOG_DIRECTORY_ENV = 'ORBIT_API_CATALOG_DIR';

export interface LoadedCatalogs {
  readonly catalogs: Readonly<Record<string, ApiCatalog>>;
  /** Operations that could not be imported, so a reviewer can see what was skipped. */
  readonly refusals: readonly (ImportRefusal & { readonly catalogId: string })[];
  /** Files that could not be read or parsed at all. */
  readonly failures: readonly { readonly file: string; readonly message: string }[];
}

const SUPPORTED = ['.yaml', '.yml', '.json'];

export function loadApiCatalogs(directory: string | undefined): LoadedCatalogs {
  const catalogs: Record<string, ApiCatalog> = {};
  const refusals: (ImportRefusal & { catalogId: string })[] = [];
  const failures: { file: string; message: string }[] = [];

  if (directory === undefined || directory.trim() === '') {
    return { catalogs, refusals, failures };
  }

  let entries: readonly string[];

  try {
    entries = readdirSync(directory);
  } catch {
    // A configured directory that does not exist is a deployment mistake worth
    // reporting, not a crash: an Orbit with no catalogs still runs every
    // browser workflow it has.
    return {
      catalogs,
      refusals,
      failures: [
        { file: directory, message: 'the configured catalog directory could not be read' },
      ],
    };
  }

  for (const entry of entries) {
    if (!SUPPORTED.includes(extname(entry).toLowerCase())) {
      continue;
    }

    const id = entry.slice(0, entry.length - extname(entry).length).toLowerCase();

    try {
      const text = readFileSync(join(directory, entry), 'utf8');
      const result = importOpenApi(id, parseYaml(text));

      if (!result.ok) {
        failures.push({ file: entry, message: result.message });
        refusals.push(...result.refusals.map((one) => ({ ...one, catalogId: id })));
        continue;
      }

      catalogs[result.catalog.id] = result.catalog;
      refusals.push(...result.refusals.map((one) => ({ ...one, catalogId: id })));
    } catch (error) {
      failures.push({
        file: entry,
        message: error instanceof Error ? error.message : 'could not be parsed',
      });
    }
  }

  return { catalogs, refusals, failures };
}
