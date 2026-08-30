import { config } from './config.js';
import { getRedisClient } from './redis.js';
import { REDIS_KEYS, getServingNumber } from './queue.js';

/**
 * 案内番号（wr:counter:serving）を進めるバックグラウンドワーカー。
 * docker-compose では別プロセスとして起動する（本番の Cron Triggers /
 * EventBridge Scheduler + Lambda に相当）。
 */

async function tickRate(redis: Awaited<ReturnType<typeof getRedisClient>>): Promise<void> {
  const incrementPerTick = Math.max(
    1,
    Math.round((config.admitRatePerSec * config.workerTickMs) / 1000),
  );
  const issuedRaw = await redis.get(REDIS_KEYS.counterIssued);
  const issued = issuedRaw ? Number(issuedRaw) : 0;
  const serving = await getServingNumber(redis);
  if (serving >= issued) {
    return;
  }
  const next = Math.min(serving + incrementPerTick, issued);
  await redis.set(REDIS_KEYS.counterServing, String(next));
}

async function tickCapacity(redis: Awaited<ReturnType<typeof getRedisClient>>): Promise<void> {
  const issuedRaw = await redis.get(REDIS_KEYS.counterIssued);
  const issued = issuedRaw ? Number(issuedRaw) : 0;
  const serving = await getServingNumber(redis);
  if (serving >= issued) {
    return;
  }
  const activeSessions = await redis.zCard(REDIS_KEYS.active);
  const capacity = Math.max(config.maxActiveSessions - activeSessions, 0);
  if (capacity <= 0) {
    return;
  }
  const next = Math.min(serving + capacity, issued);
  await redis.set(REDIS_KEYS.counterServing, String(next));
}

async function reapExpiredSessions(redis: Awaited<ReturnType<typeof getRedisClient>>): Promise<void> {
  await redis.zRemRangeByScore(REDIS_KEYS.active, 0, Date.now());
}

async function tick(redis: Awaited<ReturnType<typeof getRedisClient>>): Promise<void> {
  await reapExpiredSessions(redis);
  if (config.workerMode === 'CAPACITY') {
    await tickCapacity(redis);
  } else {
    await tickRate(redis);
  }
}

async function main(): Promise<void> {
  const redis = await getRedisClient();
  console.log(
    `virtual-waiting-room worker started (mode=${config.workerMode}, tick=${config.workerTickMs}ms)`,
  );
  setInterval(() => {
    tick(redis).catch((err: unknown) => {
      console.error('worker tick failed', err);
    });
  }, config.workerTickMs);
}

main().catch((err: unknown) => {
  console.error('Failed to start worker', err);
  process.exit(1);
});
