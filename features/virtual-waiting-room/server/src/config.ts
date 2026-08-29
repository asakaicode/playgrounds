import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  ENTRY_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  ADMIT_RATE_PER_SEC: z.coerce.number().int().positive().default(5),
  MAX_ACTIVE_SESSIONS: z.coerce.number().int().positive().default(200),
  WORKER_MODE: z.enum(['RATE', 'CAPACITY']).default('RATE'),
  WORKER_TICK_MS: z.coerce.number().int().positive().default(1000),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  PREQUEUE_MAX: z.coerce.number().int().positive().default(100000),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    throw new Error('Failed to load configuration from environment variables');
  }
  return parsed.data;
}

const env = loadConfig();

export const config = {
  port: env.PORT,
  redisUrl: env.REDIS_URL,
  jwtSecret: env.JWT_SECRET,
  entryTokenTtlSeconds: env.ENTRY_TOKEN_TTL_SECONDS,
  admitRatePerSec: env.ADMIT_RATE_PER_SEC,
  maxActiveSessions: env.MAX_ACTIVE_SESSIONS,
  workerMode: env.WORKER_MODE,
  workerTickMs: env.WORKER_TICK_MS,
  pollIntervalMs: env.POLL_INTERVAL_MS,
  prequeueMax: env.PREQUEUE_MAX,
} as const;

export type Config = typeof config;
