import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RedisClient } from './redis.js';
import type { WaitingState, WorkerMode } from '../../shared/types.js';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const joinScript = readFileSync(path.join(__dirname, 'lua/join.lua'), 'utf8');
const startSaleScript = readFileSync(path.join(__dirname, 'lua/startSale.lua'), 'utf8');

const USER_RECORD_TTL_SECONDS = 60 * 60 * 2; // 2 hours
const START_SALE_CHUNK_SIZE = 1000;

export const REDIS_KEYS = {
  saleStarted: 'wr:sale:started',
  prequeue: 'wr:prequeue',
  counterIssued: 'wr:counter:issued',
  counterServing: 'wr:counter:serving',
  active: 'wr:active',
  user: (userId: string): string => `wr:user:${userId}`,
} as const;

export interface UserRecord {
  userId: string;
  state: WaitingState;
  position: number | null;
  joinedAt: number | null;
  admittedAt: number | null;
}

function isWaitingState(value: string | undefined): value is WaitingState {
  return value === 'prequeue' || value === 'waiting' || value === 'admitted';
}

function parseUserRecord(userId: string, raw: Record<string, string>): UserRecord {
  if (!isWaitingState(raw.state)) {
    throw new Error(`Unexpected user state for ${userId}: ${String(raw.state)}`);
  }
  return {
    userId,
    state: raw.state,
    position: raw.position !== undefined ? Number(raw.position) : null,
    joinedAt: raw.joinedAt !== undefined ? Number(raw.joinedAt) : null,
    admittedAt: raw.admittedAt !== undefined ? Number(raw.admittedAt) : null,
  };
}

export interface JoinResult {
  state: WaitingState;
  position: number | null;
}

function isJoinScriptResult(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'string'
  );
}

export async function joinQueue(redis: RedisClient, userId: string): Promise<JoinResult> {
  const now = Date.now();
  const result: unknown = await redis.eval(joinScript, {
    keys: [REDIS_KEYS.user(userId), REDIS_KEYS.saleStarted, REDIS_KEYS.prequeue, REDIS_KEYS.counterIssued],
    arguments: [userId, String(now), String(USER_RECORD_TTL_SECONDS)],
  });

  if (!isJoinScriptResult(result)) {
    throw new Error(`join.lua returned an unexpected shape: ${JSON.stringify(result)}`);
  }
  const [state, positionStr] = result;
  if (!isWaitingState(state)) {
    throw new Error(`join.lua returned an unexpected state: ${state}`);
  }
  return { state, position: positionStr === '' ? null : Number(positionStr) };
}

export async function getUserRecord(redis: RedisClient, userId: string): Promise<UserRecord | null> {
  const raw = await redis.hGetAll(REDIS_KEYS.user(userId));
  if (Object.keys(raw).length === 0) {
    return null;
  }
  return parseUserRecord(userId, raw);
}

export async function getServingNumber(redis: RedisClient): Promise<number> {
  const raw = await redis.get(REDIS_KEYS.counterServing);
  return raw ? Number(raw) : 0;
}

export interface StatusResult {
  state: WaitingState;
  position: number | null;
  serving: number;
  peopleAhead: number | null;
}

export async function getStatus(redis: RedisClient, userId: string): Promise<StatusResult | null> {
  const record = await getUserRecord(redis, userId);
  if (!record) {
    return null;
  }
  const serving = await getServingNumber(redis);
  const peopleAhead =
    record.position !== null ? Math.max(record.position - serving - 1, 0) : null;
  return { state: record.state, position: record.position, serving, peopleAhead };
}

/**
 * position <= serving になっていれば admitted へ遷移させ、wr:active に登録する。
 * 既に admitted の場合は true を返すだけの冪等操作。
 */
export async function admitIfReady(redis: RedisClient, userId: string): Promise<boolean> {
  const record = await getUserRecord(redis, userId);
  if (!record) {
    return false;
  }
  if (record.state === 'admitted') {
    return true;
  }
  if (record.state !== 'waiting' || record.position === null) {
    return false;
  }
  const serving = await getServingNumber(redis);
  if (record.position > serving) {
    return false;
  }
  const now = Date.now();
  const expiresAt = now + config.entryTokenTtlSeconds * 1000;
  await redis.hSet(REDIS_KEYS.user(userId), { state: 'admitted', admittedAt: String(now) });
  await redis.zAdd(REDIS_KEYS.active, { score: expiresAt, value: userId });
  return true;
}

/**
 * 購入中のハートビートで wr:active の有効期限を延長する。
 * JWT 自体は延長しない（Cookie の再発行はしない）ので、Cookie の TTL 切れ
 * とは独立に「オリジン側は入場中とみなしている」状態を保てる。
 */
export async function extendActiveSession(redis: RedisClient, userId: string): Promise<boolean> {
  const score = await redis.zScore(REDIS_KEYS.active, userId);
  if (score === null) {
    return false;
  }
  const expiresAt = Date.now() + config.entryTokenTtlSeconds * 1000;
  await redis.zAdd(REDIS_KEYS.active, { score: expiresAt, value: userId });
  return true;
}

export async function isSaleStarted(redis: RedisClient): Promise<boolean> {
  const raw = await redis.get(REDIS_KEYS.saleStarted);
  return raw === '1';
}

export interface AdminStatsResult {
  saleStarted: boolean;
  prequeueSize: number;
  issued: number;
  serving: number;
  activeSessions: number;
}

export async function getAdminStats(redis: RedisClient): Promise<AdminStatsResult> {
  const [saleStartedRaw, prequeueSize, issuedRaw, serving, activeSessions] = await Promise.all([
    redis.get(REDIS_KEYS.saleStarted),
    redis.sCard(REDIS_KEYS.prequeue),
    redis.get(REDIS_KEYS.counterIssued),
    getServingNumber(redis),
    redis.zCard(REDIS_KEYS.active),
  ]);
  return {
    saleStarted: saleStartedRaw === '1',
    prequeueSize,
    issued: issuedRaw ? Number(issuedRaw) : 0,
    serving,
    activeSessions,
  };
}

export interface StartSaleResult {
  assigned: number;
}

function isStartSaleScriptResult(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * プレキューの全ユーザーを Fisher-Yates でシャッフルし、1..N の整理番号を
 * 一括採番する。startSale.lua がシャッフル済みの ID 配列を返し、TS 側で
 * チャンク単位に HSET を回す。
 */
export async function startSale(redis: RedisClient): Promise<StartSaleResult> {
  const assignedRaw: unknown = await redis.eval(startSaleScript, {
    keys: [REDIS_KEYS.prequeue, REDIS_KEYS.saleStarted, REDIS_KEYS.counterIssued],
    arguments: [],
  });
  if (!isStartSaleScriptResult(assignedRaw)) {
    throw new Error(`startSale.lua returned an unexpected shape: ${JSON.stringify(assignedRaw)}`);
  }
  const userIds = assignedRaw;

  const now = Date.now();
  for (let i = 0; i < userIds.length; i += START_SALE_CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + START_SALE_CHUNK_SIZE);
    const multi = redis.multi();
    chunk.forEach((userId, offset) => {
      const position = i + offset + 1;
      multi.hSet(REDIS_KEYS.user(userId), { state: 'waiting', position: String(position), joinedAt: String(now) });
      multi.expire(REDIS_KEYS.user(userId), USER_RECORD_TTL_SECONDS);
    });
    await multi.exec();
  }

  return { assigned: userIds.length };
}

export async function resetAll(redis: RedisClient): Promise<void> {
  const keysToScan = ['wr:user:*'];
  for (const pattern of keysToScan) {
    for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: 500 })) {
      await redis.del(key);
    }
  }
  await redis.del([
    REDIS_KEYS.saleStarted,
    REDIS_KEYS.prequeue,
    REDIS_KEYS.counterIssued,
    REDIS_KEYS.counterServing,
    REDIS_KEYS.active,
  ]);
}

export function resolveWorkerMode(): WorkerMode {
  return config.workerMode;
}
