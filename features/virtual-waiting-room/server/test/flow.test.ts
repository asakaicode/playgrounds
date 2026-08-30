import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createClient } from 'redis';
import { createApp } from '../src/app.js';
import { resetAll } from '../src/queue.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redis = createClient({ url: redisUrl });
await redis.connect();

const app = createApp();

beforeEach(async () => {
  await resetAll(redis);
});

afterAll(async () => {
  await resetAll(redis);
  await redis.quit();
});

describe('gate', () => {
  it('redirects /purchase to /waiting-room without a valid token', async () => {
    const res = await request(app).get('/purchase');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/waiting-room');
  });
});

describe('FIFO after sale start', () => {
  it('assigns sequential position numbers 1, 2, 3 in join order', async () => {
    await redis.set('wr:sale:started', '1');

    const agents = [request.agent(app), request.agent(app), request.agent(app)];
    const positions: (number | null)[] = [];
    for (const agent of agents) {
      const res = await agent.post('/waiting-room/join');
      expect(res.status).toBe(200);
      positions.push(res.body.position);
    }

    expect(positions).toEqual([1, 2, 3]);
  });
});

describe('admission', () => {
  it('admits users in position order and unlocks /purchase once serving catches up', async () => {
    await redis.set('wr:sale:started', '1');

    const first = request.agent(app);
    const second = request.agent(app);

    await first.post('/waiting-room/join');
    await second.post('/waiting-room/join');

    // Simulate the worker advancing the serving counter to 1.
    await redis.set('wr:counter:serving', '1');

    const firstStatus = await first.get('/waiting-room/status');
    expect(firstStatus.body.state).toBe('admitted');
    const secondStatusBeforeAdvance = await second.get('/waiting-room/status');
    expect(secondStatusBeforeAdvance.body.state).toBe('waiting');

    const firstPurchase = await first.get('/purchase');
    expect(firstPurchase.status).toBe(200);

    const secondPurchase = await second.get('/purchase');
    expect(secondPurchase.status).toBe(302);
  });
});

describe('prequeue', () => {
  it('sends everyone to prequeue with no position before the sale starts', async () => {
    const agents = Array.from({ length: 100 }, () => request.agent(app));
    for (const agent of agents) {
      const res = await agent.post('/waiting-room/join');
      expect(res.body.state).toBe('prequeue');
      expect(res.body.position).toBeNull();
      expect(res.body.saleStarted).toBe(false);
    }
  });
});

describe('start-sale shuffle', () => {
  it('assigns 1..N without duplicates and continues FIFO for late joiners', async () => {
    const prequeueAgents = Array.from({ length: 100 }, () => request.agent(app));
    for (const agent of prequeueAgents) {
      await agent.post('/waiting-room/join');
    }

    const startSaleRes = await request(app).post('/admin/start-sale');
    expect(startSaleRes.body.assigned).toBe(100);

    const positions = new Set<number>();
    for (const agent of prequeueAgents) {
      const status = await agent.get('/waiting-room/status');
      expect(status.body.state).toBe('waiting');
      positions.add(status.body.position);
    }
    expect(positions.size).toBe(100);
    expect(Math.min(...positions)).toBe(1);
    expect(Math.max(...positions)).toBe(100);

    const lateAgents = Array.from({ length: 5 }, () => request.agent(app));
    const latePositions: number[] = [];
    for (const agent of lateAgents) {
      const res = await agent.post('/waiting-room/join');
      latePositions.push(res.body.position);
    }
    expect(latePositions).toEqual([101, 102, 103, 104, 105]);
  });
});

describe('entry token expiry', () => {
  it('sends an expired-token holder back to the waiting room', async () => {
    await redis.set('wr:sale:started', '1');
    const agent = request.agent(app);
    await agent.post('/waiting-room/join');
    await redis.set('wr:counter:serving', '1');
    await agent.get('/waiting-room/status'); // triggers admission + cookie issuance

    const immediately = await agent.get('/purchase');
    expect(immediately.status).toBe(200);

    // ENTRY_TOKEN_TTL_SECONDS=2 in the test environment.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const afterExpiry = await agent.get('/purchase');
    expect(afterExpiry.status).toBe(302);
    expect(afterExpiry.headers.location).toBe('/waiting-room');
  });
});

describe('admin reset', () => {
  it('returns all counters to their initial state', async () => {
    await redis.set('wr:sale:started', '1');
    await request.agent(app).post('/waiting-room/join');

    const resetRes = await request(app).post('/admin/reset');
    expect(resetRes.body).toMatchObject({
      saleStarted: false,
      prequeueSize: 0,
      issued: 0,
      serving: 0,
      activeSessions: 0,
    });
  });
});
