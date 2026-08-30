import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { USER_ID_COOKIE } from './token.js';

const USER_ID_COOKIE_TTL_MS = 60 * 60 * 2 * 1000; // 2 hours, matches wr:user:{id} TTL

/**
 * `wr_uid` Cookie からユーザー ID を読み取る。無ければ新規発行して
 * Set-Cookie する。リロードしても整理番号を失わないための仕組み。
 */
export function resolveUserId(req: Request, res: Response): string {
  const existing = req.cookies?.[USER_ID_COOKIE];
  if (typeof existing === 'string' && existing.length > 0) {
    return existing;
  }
  const userId = randomUUID();
  res.cookie(USER_ID_COOKIE, userId, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: USER_ID_COOKIE_TTL_MS,
  });
  return userId;
}
