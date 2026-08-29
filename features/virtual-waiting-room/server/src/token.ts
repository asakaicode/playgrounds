import jwt from 'jsonwebtoken';
import type { EntryTokenPayload } from '../../shared/types.js';
import { config } from './config.js';

export const ENTRY_TOKEN_COOKIE = 'wr_token';
export const USER_ID_COOKIE = 'wr_uid';

export function issueEntryToken(userId: string, position: number): string {
  const payload: Pick<EntryTokenPayload, 'sub' | 'pos'> = { sub: userId, pos: position };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.entryTokenTtlSeconds });
}

function isEntryTokenPayload(value: unknown): value is EntryTokenPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sub === 'string' &&
    typeof candidate.pos === 'number' &&
    typeof candidate.iat === 'number' &&
    typeof candidate.exp === 'number'
  );
}

/**
 * トークンを検証する。期限切れ・改ざん・不正な形式のいずれでも null を返す
 * （呼び出し側は「入場資格なし」として一律に待合室へ戻す）。
 */
export function verifyEntryToken(token: string): EntryTokenPayload | null {
  try {
    const decoded: unknown = jwt.verify(token, config.jwtSecret);
    return isEntryTokenPayload(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
