import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { getStatus, joinQueue, resetAll, startSale } from '../src/queue.js';

/**
 * 疑似ユーザーを大量投入し、シャッフル後の整理番号が参加順と相関しない
 * （= 早く並んでも得をしない）ことを検証するスクリプト。
 *
 * 使い方: REDIS_URL=redis://localhost:6379 LOAD_TEST_USERS=500 npm run load-test
 */

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const USER_COUNT = Number(process.env.LOAD_TEST_USERS ?? 200);

function pearsonCorrelation(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] ?? 0) - meanX;
    const dy = (ys[i] ?? 0) - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denominator = Math.sqrt(denomX * denomY);
  return denominator === 0 ? 0 : numerator / denominator;
}

async function main(): Promise<void> {
  const redis = createClient({ url: REDIS_URL });
  await redis.connect();
  await resetAll(redis);

  console.log(`Joining ${String(USER_COUNT)} pseudo-users to the prequeue...`);
  const userIds: string[] = [];
  for (let i = 0; i < USER_COUNT; i += 1) {
    const userId = randomUUID();
    const result = await joinQueue(redis, userId);
    if (result.state !== 'prequeue') {
      throw new Error(`Expected prequeue state for user ${i}, got "${result.state}"`);
    }
    userIds.push(userId);
  }

  console.log('Starting sale (Fisher-Yates shuffle + bulk numbering)...');
  const { assigned } = await startSale(redis);
  console.log(`Assigned ${String(assigned)} numbers.`);

  const joinOrder: number[] = [];
  const positions: number[] = [];
  for (let i = 0; i < userIds.length; i += 1) {
    const userId = userIds[i];
    if (userId === undefined) continue;
    const status = await getStatus(redis, userId);
    if (!status || status.position === null) {
      throw new Error(`User ${userId} has no position after start-sale`);
    }
    joinOrder.push(i + 1);
    positions.push(status.position);
  }

  const correlation = pearsonCorrelation(joinOrder, positions);
  const uniquePositions = new Set(positions);

  console.log('--- Results ---');
  console.log(`Users:                ${String(userIds.length)}`);
  console.log(`Unique positions:     ${String(uniquePositions.size)} / ${String(positions.length)}`);
  console.log(`Min / max position:   ${String(Math.min(...positions))} / ${String(Math.max(...positions))}`);
  console.log(`Join-order vs. position correlation: ${correlation.toFixed(4)} (0 に近いほど公平)`);

  await redis.quit();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
