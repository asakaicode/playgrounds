export type WaitingState = 'prequeue' | 'waiting' | 'admitted';
export type WorkerMode = 'RATE' | 'CAPACITY';

export interface JoinResponse {
  state: WaitingState;
  userId: string;
  position: number | null; // prequeue のときは null
  saleStarted: boolean;
}

export interface StatusResponse {
  state: WaitingState;
  position: number | null;
  serving: number;
  peopleAhead: number | null;
  etaSeconds: number | null;
  pollAfterMs: number; // 次のポーリングまでの待ち時間をサーバが指示
}

export interface AdminStats {
  saleStarted: boolean;
  prequeueSize: number;
  issued: number;
  serving: number;
  activeSessions: number;
  admitRatePerSec: number;
  workerMode: WorkerMode;
}

export interface StartSaleResponse {
  assigned: number;
  startedAt: string;
}

export interface EntryTokenPayload {
  sub: string;
  pos: number;
  iat: number;
  exp: number;
}

export interface ApiError {
  error: string;
  message: string;
}
