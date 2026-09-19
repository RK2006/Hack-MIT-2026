import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/node_modules/**', '**/.next/**'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
