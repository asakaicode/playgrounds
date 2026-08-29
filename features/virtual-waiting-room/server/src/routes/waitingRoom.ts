import { Router } from 'express';
import type { JoinResponse, StatusResponse } from '../../../shared/types.js';
import { config } from '../config.js';
import { getRedisClient } from '../redis.js';
import { admitIfReady, getStatus, isSaleStarted, joinQueue } from '../queue.js';
import { ENTRY_TOKEN_COOKIE, issueEntryToken } from '../token.js';
import { resolveUserId } from '../userId.js';

export const waitingRoomRouter = Router();

/**
 * 待ち人数が多いほどポーリング間隔を延ばす。オリジン（このサーバ）への
 * リクエスト量が待合室の混雑度に比例して膨らむのを防ぐため。
 */
function computePollAfterMs(peopleAhead: number | null): number {
  if (peopleAhead === null) {
    return config.pollIntervalMs;
  }
  const extra = Math.min(peopleAhead * 20, 15000);
  return config.pollIntervalMs + extra;
}

waitingRoomRouter.post('/join', async (req, res) => {
  const redis = await getRedisClient();
  const userId = resolveUserId(req, res);
  const { state, position } = await joinQueue(redis, userId);
  const saleStarted = await isSaleStarted(redis);

  if (state === 'prequeue') {
    const prequeueSize = await redis.sCard('wr:prequeue');
    if (prequeueSize > config.prequeueMax) {
      console.warn(`prequeue size ${prequeueSize} exceeds PREQUEUE_MAX=${config.prequeueMax}`);
    }
  }

  const body: JoinResponse = { state, userId, position, saleStarted };
  res.json(body);
});

waitingRoomRouter.get('/status', async (req, res) => {
  const redis = await getRedisClient();
  const userId = resolveUserId(req, res);

  const status = await getStatus(redis, userId);
  if (!status) {
    res.status(404).json({ error: 'not_found', message: 'No waiting-room session for this user.' });
    return;
  }

  const { position, serving, peopleAhead } = status;
  let { state } = status;

  if (state === 'waiting') {
    const admitted = await admitIfReady(redis, userId);
    if (admitted) {
      state = 'admitted';
      const token = issueEntryToken(userId, position ?? 0);
      res.cookie(ENTRY_TOKEN_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: config.entryTokenTtlSeconds * 1000,
      });
    }
  }

  const etaSeconds =
    state === 'waiting' && peopleAhead !== null
      ? Math.ceil(peopleAhead / config.admitRatePerSec)
      : null;

  const body: StatusResponse = {
    state,
    position,
    serving,
    peopleAhead,
    etaSeconds,
    pollAfterMs: computePollAfterMs(peopleAhead),
  };
  res.json(body);
});
