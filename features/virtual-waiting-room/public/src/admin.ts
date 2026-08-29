import type { AdminStats } from '../../shared/types.js';
import { getAdminStats, resetAll, startSale } from './api.js';

const STATS_POLL_MS = 2000;

const el = {
  saleStarted: document.querySelector<HTMLElement>('#stat-sale-started'),
  prequeueSize: document.querySelector<HTMLElement>('#stat-prequeue-size'),
  issued: document.querySelector<HTMLElement>('#stat-issued'),
  serving: document.querySelector<HTMLElement>('#stat-serving'),
  activeSessions: document.querySelector<HTMLElement>('#stat-active-sessions'),
  workerMode: document.querySelector<HTMLElement>('#stat-worker-mode'),
  admitRate: document.querySelector<HTMLElement>('#stat-admit-rate'),
  startSaleButton: document.querySelector<HTMLButtonElement>('#start-sale'),
  resetButton: document.querySelector<HTMLButtonElement>('#reset'),
  message: document.querySelector<HTMLElement>('#admin-message'),
};

function render(stats: AdminStats): void {
  if (el.saleStarted) el.saleStarted.textContent = stats.saleStarted ? '開始済み' : '未開始';
  if (el.prequeueSize) el.prequeueSize.textContent = String(stats.prequeueSize);
  if (el.issued) el.issued.textContent = String(stats.issued);
  if (el.serving) el.serving.textContent = String(stats.serving);
  if (el.activeSessions) el.activeSessions.textContent = String(stats.activeSessions);
  if (el.workerMode) el.workerMode.textContent = stats.workerMode;
  if (el.admitRate) el.admitRate.textContent = `${String(stats.admitRatePerSec)} 人/秒`;
}

async function refresh(): Promise<void> {
  try {
    const stats = await getAdminStats();
    render(stats);
  } catch (err) {
    console.error('failed to fetch admin stats', err);
  }
}

el.startSaleButton?.addEventListener('click', () => {
  void (async () => {
    if (el.startSaleButton) el.startSaleButton.disabled = true;
    try {
      const result = await startSale();
      if (el.message) {
        el.message.textContent = `発売開始: ${String(result.assigned)} 人に整理番号を採番しました`;
      }
      await refresh();
    } catch (err) {
      if (el.message) el.message.textContent = `エラー: ${String(err)}`;
    } finally {
      if (el.startSaleButton) el.startSaleButton.disabled = false;
    }
  })();
});

el.resetButton?.addEventListener('click', () => {
  void (async () => {
    if (el.resetButton) el.resetButton.disabled = true;
    try {
      await resetAll();
      if (el.message) el.message.textContent = 'リセットしました';
      await refresh();
    } catch (err) {
      if (el.message) el.message.textContent = `エラー: ${String(err)}`;
    } finally {
      if (el.resetButton) el.resetButton.disabled = false;
    }
  })();
});

void refresh();
setInterval(() => {
  void refresh();
}, STATS_POLL_MS);
