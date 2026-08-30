import { Router } from 'express';
import { gate } from '../middleware/gate.js';
import { getRedisClient } from '../redis.js';
import { extendActiveSession } from '../queue.js';
import { resolveUserId } from '../userId.js';

export const purchaseRouter = Router();

/**
 * 購入ページ滞在中に叩くハートビート。wr:active の有効期限を延長し、
 * 購入操作中に JWT の有効期限だけで弾かれないようにする。
 */
purchaseRouter.post('/heartbeat', gate, async (req, res) => {
  const redis = await getRedisClient();
  const userId = resolveUserId(req, res);
  const extended = await extendActiveSession(redis, userId);
  res.json({ extended });
});
