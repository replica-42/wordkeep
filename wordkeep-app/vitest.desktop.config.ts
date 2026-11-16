import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.desktop.ts'],
    hookTimeout: 90000,
    testTimeout: 30000,
    fileParallelism: false,
  },
});
