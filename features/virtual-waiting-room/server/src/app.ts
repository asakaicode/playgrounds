import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { gate } from './middleware/gate.js';
import { waitingRoomRouter } from './routes/waitingRoom.js';
import { purchaseRouter } from './routes/purchase.js';
import { adminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');

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
