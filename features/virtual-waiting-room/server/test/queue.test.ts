import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from 'redis';
import {
  REDIS_KEYS,
  admitIfReady,
  getAdminStats,
  getStatus,
  joinQueue,
  resetAll,
  startSale,
} from '../src/queue.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redis = createClient({ url: redisUrl });
await redis.connect();

beforeEach(async () => {
  await resetAll(redis);
});

afterAll(async () => {
  await resetAll(redis);
  await redis.quit();
});

describe('joinQueue', () => {
  it('sends users to the prequeue before the sale starts', async () => {
    const userId = randomUUID();
    const result = await joinQueue(redis, userId);
    expect(result).toEqual({ state: 'prequeue', position: null });

    const isMember = await redis.sIsMember(REDIS_KEYS.prequeue, userId);
    expect(isMember).toBe(true);
  });

  it('is idempotent: re-joining returns the same state/position', async () => {
    const userId = randomUUID();
    const first = await joinQueue(redis, userId);
    const second = await joinQueue(redis, userId);
    expect(second).toEqual(first);
  });

  it('assigns sequential FIFO positions once the sale has started', async () => {
    await redis.set(REDIS_KEYS.saleStarted, '1');

    const first = await joinQueue(redis, randomUUID());
    const second = await joinQueue(redis, randomUUID());
    const third = await joinQueue(redis, randomUUID());

    expect(first.position).toBe(1);
    expect(second.position).toBe(2);
    expect(third.position).toBe(3);
    expect([first.state, second.state, third.state]).toEqual(['waiting', 'waiting', 'waiting']);
  });
});

describe('getStatus / admitIfReady', () => {
  it('reports peopleAhead relative to the serving counter', async () => {
    await redis.set(REDIS_KEYS.saleStarted, '1');
    const userId = randomUUID();
    await joinQueue(redis, userId); // position 1
    await joinQueue(redis, randomUUID()); // position 2, ahead of nobody relevant here

    const status = await getStatus(redis, userId);
    expect(status?.position).toBe(1);
    expect(status?.peopleAhead).toBe(0);
  });

  it('admits a user once serving has caught up to their position', async () => {
    await redis.set(REDIS_KEYS.saleStarted, '1');
    const userId = randomUUID();
    const { position } = await joinQueue(redis, userId);
    expect(position).toBe(1);

    expect(await admitIfReady(redis, userId)).toBe(false);

    await redis.set(REDIS_KEYS.counterServing, String(position));
    expect(await admitIfReady(redis, userId)).toBe(true);

    const status = await getStatus(redis, userId);
    expect(status?.state).toBe('admitted');

    const activeScore = await redis.zScore(REDIS_KEYS.active, userId);
    expect(activeScore).not.toBeNull();
  });
});

describe('startSale', () => {
  it('assigns 1..N without duplicates, decorrelated from join order', async () => {
    const userIds = Array.from({ length: 50 }, () => randomUUID());
    for (const userId of userIds) {
      await joinQueue(redis, userId);
    }

    const { assigned } = await startSale(redis);
    expect(assigned).toBe(50);

    const positions = new Set<number>();
    for (const userId of userIds) {
      const status = await getStatus(redis, userId);
      expect(status?.state).toBe('waiting');
      expect(status?.position).not.toBeNull();
      positions.add(status!.position as number);
    }
    expect(positions.size).toBe(50);
    expect(Math.min(...positions)).toBe(1);
    expect(Math.max(...positions)).toBe(50);
  });

  it('is a no-op when the sale has already started', async () => {
    await redis.set(REDIS_KEYS.saleStarted, '1');
    await redis.set(REDIS_KEYS.counterIssued, '3');

    const { assigned } = await startSale(redis);
    expect(assigned).toBe(0);

    const issued = await redis.get(REDIS_KEYS.counterIssued);
    expect(issued).toBe('3');
  });

  it('continues FIFO numbering from N+1 for post-sale joins', async () => {
    const userIds = Array.from({ length: 10 }, () => randomUUID());
    for (const userId of userIds) {
      await joinQueue(redis, userId);
    }
    await startSale(redis);

    const late = await joinQueue(redis, randomUUID());
    expect(late.position).toBe(11);
  });
});

describe('getAdminStats', () => {
  it('reflects prequeue and counters', async () => {
    await joinQueue(redis, randomUUID());
    await joinQueue(redis, randomUUID());

    const stats = await getAdminStats(redis);
    expect(stats.saleStarted).toBe(false);
    expect(stats.prequeueSize).toBe(2);
    expect(stats.issued).toBe(0);
  });
});
