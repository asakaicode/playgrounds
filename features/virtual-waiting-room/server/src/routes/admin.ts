import { Router } from 'express';
import type { AdminStats, StartSaleResponse } from '../../../shared/types.js';
import { config } from '../config.js';
import { getRedisClient } from '../redis.js';
import { getAdminStats, resetAll, startSale } from '../queue.js';

export const adminRouter = Router();

adminRouter.get('/stats', async (_req, res) => {
  const redis = await getRedisClient();
  const stats = await getAdminStats(redis);
  const body: AdminStats = {
    ...stats,
    admitRatePerSec: config.admitRatePerSec,
    workerMode: config.workerMode,
  };
  res.json(body);
});

adminRouter.post('/start-sale', async (_req, res) => {
  const redis = await getRedisClient();
  const { assigned } = await startSale(redis);
  const body: StartSaleResponse = { assigned, startedAt: new Date().toISOString() };
  res.json(body);
});

adminRouter.post('/reset', async (_req, res) => {
  const redis = await getRedisClient();
  await resetAll(redis);
  const stats = await getAdminStats(redis);
  const body: AdminStats = {
    ...stats,
    admitRatePerSec: config.admitRatePerSec,
    workerMode: config.workerMode,
  };
  res.json(body);
});
