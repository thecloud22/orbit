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
