import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.spec.ts', 'packages/*/src/**/*.spec.ts'],
    environment: 'node',
    maxWorkers: 4,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
