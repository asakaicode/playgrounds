import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { gate } from './middleware/gate.js';
import { waitingRoomRouter } from './routes/waitingRoom.js';
import { purchaseRouter } from './routes/purchase.js';
import { adminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * public/ の位置は実行方法によって深さが変わる:
 * - 開発時（tsx で server/src/app.ts を直接実行）: server/src から見て 2つ上
 * - 本番ビルド後（dist/server/src/app.js を実行）: dist/ の分だけ 1段深いので 3つ上
 * ビルド構成の変更に引きずられないよう、実在するパスを探して解決する。
 */
function resolvePublicDir(): string {
  const candidates = ['../../public', '../../../public'];
  for (const candidate of candidates) {
    const resolved = path.resolve(__dirname, candidate);
    if (existsSync(path.join(resolved, 'index.html'))) {
      return resolved;
    }
  }
  throw new Error(
    `Could not locate the public/ directory from ${__dirname} (tried: ${candidates.join(', ')})`,
  );
}

const publicDir = resolvePublicDir();

export function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/dist', express.static(path.join(publicDir, 'dist')));
  app.use('/css', express.static(path.join(publicDir, 'css')));

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.get('/waiting-room', (_req, res) => {
    res.sendFile(path.join(publicDir, 'waiting-room.html'));
  });

  app.get('/admin', (_req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'));
  });

  app.use('/waiting-room', waitingRoomRouter);
  app.use('/admin', adminRouter);

  app.get('/purchase', gate, (_req, res) => {
    res.sendFile(path.join(publicDir, 'purchase.html'));
  });
  app.use('/purchase', purchaseRouter);

  return app;
}
