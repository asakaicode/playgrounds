import { createApp } from './app.js';
import { config } from './config.js';
import { getRedisClient } from './redis.js';

async function main(): Promise<void> {
  await getRedisClient();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`virtual-waiting-room server listening on :${config.port}`);
  });
}

main().catch((err: unknown) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
