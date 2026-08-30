import type { NextFunction, Request, Response } from 'express';
import { ENTRY_TOKEN_COOKIE, verifyEntryToken } from '../token.js';

/**
 * CDN / エッジワーカー相当のインターセプト。
 * `/purchase` の手前でこれを通し、有効な入場トークンを持たないリクエストは
 * 待合室へ 302 で戻す。オリジン（購入ページ本体）には一切到達させない。
 */
export function gate(req: Request, res: Response, next: NextFunction): void {
  const token: unknown = req.cookies?.[ENTRY_TOKEN_COOKIE];
  if (typeof token !== 'string' || verifyEntryToken(token) === null) {
    res.redirect(302, '/waiting-room');
    return;
  }
  next();
}
