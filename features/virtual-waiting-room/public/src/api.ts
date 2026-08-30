import type {
  AdminStats,
  ApiError,
  JoinResponse,
  StartSaleResponse,
  StatusResponse,
} from '../../shared/types.js';

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `Request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function join(): Promise<JoinResponse> {
  return request<JoinResponse>('/waiting-room/join', { method: 'POST' });
}

export function getStatus(): Promise<StatusResponse> {
  return request<StatusResponse>('/waiting-room/status', { method: 'GET' });
}

export function getAdminStats(): Promise<AdminStats> {
  return request<AdminStats>('/admin/stats', { method: 'GET' });
}

export function startSale(): Promise<StartSaleResponse> {
  return request<StartSaleResponse>('/admin/start-sale', { method: 'POST' });
}

export function resetAll(): Promise<AdminStats> {
  return request<AdminStats>('/admin/reset', { method: 'POST' });
}
