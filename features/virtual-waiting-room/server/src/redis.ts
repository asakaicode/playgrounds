import { createClient } from 'redis';
import { config } from './config.js';

export type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | undefined;

export async function getRedisClient(): Promise<RedisClient> {
  if (client) {
    return client;
  }
  const newClient = createClient({ url: config.redisUrl });
  newClient.on('error', (err: unknown) => {
    console.error('Redis client error', err);
  });
  await newClient.connect();
  client = newClient;
  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
