import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Native replacement for vite-tsconfig-paths: resolves the "@/*" alias
  // from tsconfig.json.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    globals: false,
  },
});
