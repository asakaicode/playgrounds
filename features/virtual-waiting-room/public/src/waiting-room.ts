import type { StatusResponse } from '../../shared/types.js';
import { getStatus, join } from './api.js';

const HIDDEN_TAB_POLL_MULTIPLIER = 4;
const MAX_BACKOFF_MS = 30000;

const el = {
  prequeueSection: document.querySelector<HTMLElement>('#prequeue-section'),
  waitingSection: document.querySelector<HTMLElement>('#waiting-section'),
  reconnecting: document.querySelector<HTMLElement>('#reconnecting'),
  position: document.querySelector<HTMLElement>('#position'),
  peopleAhead: document.querySelector<HTMLElement>('#people-ahead'),
  serving: document.querySelector<HTMLElement>('#serving'),
  eta: document.querySelector<HTMLElement>('#eta'),
  progressBar: document.querySelector<HTMLElement>('#progress-bar'),
};

let pollTimer: ReturnType<typeof setTimeout> | undefined;
let backoffMs = 0;

function render(status: StatusResponse): void {
  const isPrequeue = status.state === 'prequeue';
  el.prequeueSection?.toggleAttribute('hidden', !isPrequeue);
  el.waitingSection?.toggleAttribute('hidden', isPrequeue);

  if (el.position) el.position.textContent = status.position !== null ? String(status.position) : '-';
  if (el.peopleAhead) {
    el.peopleAhead.textContent = status.peopleAhead !== null ? String(status.peopleAhead) : '-';
  }
  if (el.serving) el.serving.textContent = String(status.serving);
  if (el.eta) {
    el.eta.textContent = status.etaSeconds !== null ? `約 ${String(status.etaSeconds)} 秒` : '-';
  }
  if (el.progressBar && status.position !== null && status.position > 0) {
    const ratio = Math.min(status.serving / status.position, 1);
    el.progressBar.style.width = `${String(Math.round(ratio * 100))}%`;
  }
}

function schedulePoll(delayMs: number): void {
  if (pollTimer !== undefined) {
    clearTimeout(pollTimer);
  }
  const effectiveDelay =
    document.visibilityState === 'hidden' ? delayMs * HIDDEN_TAB_POLL_MULTIPLIER : delayMs;
  pollTimer = setTimeout(() => {
    void poll();
  }, effectiveDelay);
}

async function poll(): Promise<void> {
  try {
    const status = await getStatus();
    el.reconnecting?.setAttribute('hidden', '');
    backoffMs = 0;

    if (status.state === 'admitted') {
      window.location.href = '/purchase';
      return;
    }

    render(status);
    schedulePoll(status.pollAfterMs);
  } catch (err) {
    console.error('status polling failed', err);
    el.reconnecting?.removeAttribute('hidden');
    backoffMs = backoffMs === 0 ? 1000 : Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    const jitter = Math.random() * backoffMs * 0.3;
    schedulePoll(backoffMs + jitter);
  }
}

async function start(): Promise<void> {
  try {
    const joined = await join();
    if (joined.state === 'admitted') {
      window.location.href = '/purchase';
      return;
    }
    void poll();
  } catch (err) {
    console.error('failed to join waiting room', err);
    el.reconnecting?.removeAttribute('hidden');
    schedulePoll(2000);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && pollTimer !== undefined) {
    void poll();
  }
});

void start();
