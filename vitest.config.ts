import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright owns e2e/; vitest owns the unit tests next to the source.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
