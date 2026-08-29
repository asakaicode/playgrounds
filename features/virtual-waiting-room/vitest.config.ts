import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/test/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    env: {
      JWT_SECRET: 'test-secret',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      ENTRY_TOKEN_TTL_SECONDS: '2',
      ADMIT_RATE_PER_SEC: '5',
    },
  },
});
