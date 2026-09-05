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
