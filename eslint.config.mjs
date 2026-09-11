import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'src/generated/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  {
    rules: {
      // Real code uses the pino logger (src/lib/logger.ts), never console.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Seed + scripts are CLI entry points; stdout is their interface.
    files: ['prisma/seed.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];

export default config;
