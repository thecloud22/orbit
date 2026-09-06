import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Orbit lint configuration.
 *
 * Beyond ordinary correctness rules, this config mechanically enforces the
 * architecture boundaries described in CLAUDE.md, so a violation fails
 * `pnpm lint` rather than relying on reviewer discipline.
 */

const noFrameworksInDomainPackages = [
  {
    group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
    message: 'Domain packages must not depend on React. See CLAUDE.md > Architecture rules.',
  },
  {
    group: ['fastify', '@fastify/*'],
    message: 'Domain packages must not depend on Fastify. See CLAUDE.md > Architecture rules.',
  },
  {
    group: ['drizzle-orm', 'drizzle-orm/*', 'drizzle-kit', 'pg', 'postgres'],
    message:
      'Domain packages must not depend on the database layer. See CLAUDE.md > Architecture rules.',
  },
  {
    group: ['playwright', 'playwright-core', '@playwright/*', '@playwright/test'],
    message: 'Domain packages must not depend on Playwright. See CLAUDE.md > Architecture rules.',
  },
];

/**
 * The SOP Graph is a non-executable description of intent, so it must not be
 * able to reach a network or any package that can execute something. Kept
 * separate from the filesystem rule below because a *test* legitimately reads
 * the source tree — the static safety scan is precisely a test that opens every
 * file — while none of these bans are ever lifted.
 */
const noExecutionInSopGraph = [
  {
    group: ['net', 'http', 'https', 'dns', 'node:net', 'node:http', 'node:https', 'node:dns'],
    message:
      'The SOP Graph never contacts a network. A URL in a graph is an untrusted draft reference.',
  },
  {
    group: [
      '@orbit/agent-ir',
      '@orbit/agent-ir/*',
      '@orbit/runtime',
      '@orbit/runtime/*',
      '@orbit/executor-playwright',
      '@orbit/db',
      '@orbit/db/*',
    ],
    message:
      'The SOP Graph is not executable and must not depend on Agent IR, the runtime, or persistence. See ADR-002.',
  },
];

/**
 * SOP generation is not persistence and not an application. It may reach the
 * model provider it is configured with, and nothing else.
 */
const noPersistenceOrApplicationsInSopGeneration = [
  {
    group: ['@orbit/db', '@orbit/db/*'],
    message:
      'SOP generation must not depend on persistence. Composition belongs to @orbit/sop-service.',
  },
  {
    group: ['@orbit/api', '@orbit/web', '@orbit/browser-worker', '@orbit/demo-portal'],
    message:
      'SOP generation must not depend on an application; applications depend on it. See CLAUDE.md > Architecture rules.',
  },
  {
    group: ['net', 'http', 'https', 'dns', 'node:net', 'node:http', 'node:https', 'node:dns'],
    message:
      'Reach the model provider through its client library. A URL inside a graph is an untrusted draft reference and is never contacted.',
  },
];

/**
 * A deterministic test double must not be reachable from production code.
 *
 * The fake model provider lives behind a `/testing` subpath so there is no
 * import path to it from a shipped entry point; this rule is the mechanical
 * enforcement of that, and a transitive source scan proves it independently.
 */
const noTestDoublesInProductionCode = [
  {
    group: ['@orbit/sop-generation/testing', '@orbit/sop-graph/testing', '@orbit/db/testing'],
    message:
      'Test doubles and destructive test helpers must not be reachable from production code. See apps/api/src/testing/e2e-server.ts.',
  },
];

/**
 * Domain packages never touch the filesystem: parsing functions take text, not
 * paths, so callers own reading bytes. Tests are exempt — reading the seeded
 * fixture from disk is exactly what they are for — but they keep every
 * framework restriction above.
 */
const noFilesystemInDomainPackages = [
  {
    group: ['fs', 'path', 'node:fs', 'node:fs/*', 'node:path'],
    message:
      'Domain packages must not touch the filesystem. Parsing functions take text, not paths; callers own reading bytes.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'data/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Repository maintenance scripts are plain Node ESM, so TypeScript is not
  // resolving their identifiers. The globals they use are declared explicitly
  // rather than disabling the rule wholesale.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // TypeScript already resolves identifiers; the core rule misfires on globals.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // Agent IR and shared contracts are the executable workflow contract.
  // They must stay free of every framework so they remain portable and testable.
  {
    files: ['packages/contracts/**/*.ts', 'packages/agent-ir/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...noFrameworksInDomainPackages, ...noFilesystemInDomainPackages] },
      ],
    },
  },

  // Domain package tests may read fixtures from disk, but stay framework-free.
  {
    files: ['packages/contracts/**/*.test.ts', 'packages/agent-ir/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: noFrameworksInDomainPackages }],
    },
  },

  // The SOP Graph is a non-executable description of intent, and this rule is
  // the enforcement of that claim rather than a comment asserting it.
  {
    files: ['packages/sop-graph/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...noFrameworksInDomainPackages,
            ...noFilesystemInDomainPackages,
            ...noExecutionInSopGraph,
          ],
        },
      ],
    },
  },

  // SOP Graph tests may read the source tree — the static safety scan has to
  // open every file to prove what is not in it. Every ban that constitutes the
  // non-executable boundary still applies; only the filesystem rule is lifted,
  // matching the carve-out the other domain packages already have.
  {
    files: ['packages/sop-graph/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...noFrameworksInDomainPackages, ...noExecutionInSopGraph] },
      ],
    },
  },

  // SOP generation reaches the network — to the configured model provider, and
  // only from `anthropic-provider.ts`. What must still hold is that it never
  // touches a URL that came out of a graph, and that it stays clear of
  // persistence: composing generation with the database is @orbit/sop-service's
  // job, exactly as @orbit/artifact-service composes bytes with metadata.
  {
    files: ['packages/sop-generation/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...noFrameworksInDomainPackages,
            ...noFilesystemInDomainPackages,
            ...noPersistenceOrApplicationsInSopGeneration,
          ],
        },
      ],
    },
  },

  // Its tests may read the source tree — the network-boundary scan has to open
  // every file to prove what is not in it. Only the filesystem rule is lifted.
  {
    files: ['packages/sop-generation/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...noFrameworksInDomainPackages,
            ...noPersistenceOrApplicationsInSopGeneration,
          ],
        },
      ],
    },
  },

  // The composition root is permitted to import both @orbit/sop-generation and
  // @orbit/db — that is its purpose — but it stays out of the applications, and
  // it must never reach the deterministic fake provider.
  {
    files: ['packages/sop-service/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message:
                'The SOP service must not depend on React. See CLAUDE.md > Architecture rules.',
            },
            {
              group: ['fastify', '@fastify/*'],
              message:
                'The SOP service must not depend on Fastify. See CLAUDE.md > Architecture rules.',
            },
            {
              group: ['playwright', 'playwright-core', '@playwright/*', '@playwright/test'],
              message:
                'The SOP service must not depend on Playwright. See CLAUDE.md > Architecture rules.',
            },
            {
              group: ['@orbit/api', '@orbit/web', '@orbit/browser-worker', '@orbit/demo-portal'],
              message:
                'The SOP service must not depend on an application; applications depend on it. See CLAUDE.md > Architecture rules.',
            },
            ...noTestDoublesInProductionCode,
          ],
        },
      ],
    },
  },

  // Its tests are exactly what the fake provider and the database harness are
  // for. Only the test-double rule is lifted; every boundary that keeps the SOP
  // service out of the applications still applies.
  {
    files: ['packages/sop-service/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message:
                'The SOP service must not depend on React. See CLAUDE.md > Architecture rules.',
            },
            {
              group: ['fastify', '@fastify/*'],
              message:
                'The SOP service must not depend on Fastify. See CLAUDE.md > Architecture rules.',
            },
            {
              group: ['playwright', 'playwright-core', '@playwright/*', '@playwright/test'],
              message:
                'The SOP service must not depend on Playwright. See CLAUDE.md > Architecture rules.',
            },
            {
              group: ['@orbit/api', '@orbit/web', '@orbit/browser-worker', '@orbit/demo-portal'],
              message:
                'The SOP service must not depend on an application; applications depend on it. See CLAUDE.md > Architecture rules.',
            },
          ],
        },
      ],
    },
  },

  // The deterministic fake provider must not be reachable from the API's
  // production code. The shipped entry point selects the real provider and has
  // no switch that could choose otherwise; the end-to-end stack uses a separate
  // entry point under `src/testing/`.
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: noTestDoublesInProductionCode }],
    },
  },

  // Test code and the test-only entry point are exactly what the fake is for.
  {
    files: ['apps/api/src/testing/**/*.ts', 'apps/api/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // The runtime is executor-neutral: it depends on executor interfaces, never on
  // a concrete executor implementation. The browser worker composes the two.
  {
    files: ['packages/runtime/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...noFrameworksInDomainPackages,
            {
              group: ['@orbit/executor-playwright', '@orbit/executor-playwright/*'],
              message:
                'Runtime must depend on executor interfaces, not a concrete executor. See CLAUDE.md > Architecture rules.',
            },
          ],
        },
      ],
    },
  },

  // Artifact storage owns bytes and nothing else. It must stay free of the
  // database so that the storage interface remains replaceable on its own
  // (ADR-010); composing bytes with metadata is @orbit/artifact-service's job.
  {
    files: ['packages/artifacts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...noFrameworksInDomainPackages,
            {
              group: ['@orbit/db', '@orbit/db/*'],
              message:
                'Artifact storage must not depend on the database layer. Composition belongs to @orbit/artifact-service. See CLAUDE.md > Architecture rules.',
            },
          ],
        },
      ],
    },
  },

  // The composition root is permitted to import both @orbit/artifacts and
  // @orbit/db — that is its purpose — but it stays out of the applications.
  {
    files: ['packages/artifact-service/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message:
                'The artifact service must not depend on React. See CLAUDE.md > Architecture rules.',
            },
            {
              group: ['fastify', '@fastify/*'],
              message:
                'The artifact service must not depend on Fastify. See CLAUDE.md > Architecture rules.',
            },
            {
              group: ['playwright', 'playwright-core', '@playwright/*', '@playwright/test'],
              message:
                'The artifact service must not depend on Playwright. See CLAUDE.md > Architecture rules.',
            },
            {
              group: ['@orbit/api', '@orbit/web', '@orbit/browser-worker', '@orbit/demo-portal'],
              message:
                'The artifact service must not depend on an application; applications depend on it. See CLAUDE.md > Architecture rules.',
            },
          ],
        },
      ],
    },
  },

  // The database layer is the only package that talks to PostgreSQL, and it
  // stays underneath the applications: nothing here may reach up into the API,
  // the UI, or the browser executor.
  {
    files: ['packages/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message:
                'The database layer must not depend on React. See CLAUDE.md > Architecture rules.',
            },
            {
              group: ['fastify', '@fastify/*'],
              message:
                'The database layer must not depend on Fastify. See CLAUDE.md > Architecture rules.',
            },
            {
              group: ['playwright', 'playwright-core', '@playwright/*', '@playwright/test'],
              message:
                'The database layer must not depend on Playwright. See CLAUDE.md > Architecture rules.',
            },
            {
              group: ['@orbit/api', '@orbit/web', '@orbit/browser-worker', '@orbit/demo-portal'],
              message:
                'The database layer must not depend on an application; applications depend on it. See CLAUDE.md > Architecture rules.',
            },
          ],
        },
      ],
    },
  },

  // The web application must never reach the database directly.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@orbit/db', '@orbit/db/*', 'drizzle-orm', 'drizzle-orm/*', 'pg', 'postgres'],
              message:
                'The UI must not access PostgreSQL directly; it goes through the API. See CLAUDE.md > Architecture rules.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
