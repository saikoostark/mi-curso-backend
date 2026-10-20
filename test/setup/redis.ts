import { createClient } from 'redis';
import { getTestRedisUrl } from './env.js';

/**
 * Removes every `auth:*` and `audit:rl:*` key from the dedicated test Redis
 * database.
 *
 * Uses `KEYS` on purpose: this is test code, the test database holds a
 * handful of keys, and it only runs between specs — never in production code.
 */
export async function clearAuthKeys(): Promise<void> {
  const client = createClient({ url: getTestRedisUrl() });
  client.on('error', () => undefined);
  await client.connect();

  try {
    const keys = [
      ...(await client.keys('auth:*')),
      ...(await client.keys('audit:rl:*')),
    ];
    if (keys.length > 0) {
      await client.del(keys);
    }
  } finally {
    await client.quit();
  }
}
