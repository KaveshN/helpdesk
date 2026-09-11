import Redis from 'ioredis';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Redis holds session-adjacent state that must not live in a JWT:
 *  - the per-user auth epoch, which is how a session is revoked immediately
 *    when a role changes or an account is disabled (see revokeUserSessions);
 *  - later phases: scheduled-job locks and SLA-check leader election.
 *
 * Lazy singleton, parked on globalThis so Next's dev hot reload doesn't leak a
 * connection per edit.
 */
const globalForRedis = globalThis as unknown as { helpdeskRedis?: Redis };

export function redis(): Redis {
  if (!globalForRedis.helpdeskRedis) {
    const client = new Redis(env().REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    });
    client.on('error', (error) => logger.error({ err: error }, 'redis error'));
    globalForRedis.helpdeskRedis = client;
  }
  return globalForRedis.helpdeskRedis;
}

const epochKey = (userId: string) => `auth:epoch:${userId}`;

/**
 * The current auth epoch for a user. Tokens issued before this value are
 * treated as invalid. Missing key == epoch 0, so a user who has never had a
 * session revoked needs no Redis write.
 */
export async function currentAuthEpoch(userId: string): Promise<number> {
  const value = await redis().get(epochKey(userId));
  return value ? Number.parseInt(value, 10) : 0;
}

/**
 * Invalidate every existing session for a user. Call this whenever their
 * permissions shrink -- role change, membership removal, deactivation --
 * because JWT sessions are otherwise valid until they expire.
 */
export async function revokeUserSessions(userId: string): Promise<number> {
  const epoch = await redis().incr(epochKey(userId));
  logger.info({ userId, epoch }, 'revoked user sessions');
  return epoch;
}

export async function disconnectRedis(): Promise<void> {
  if (globalForRedis.helpdeskRedis) {
    await globalForRedis.helpdeskRedis.quit();
    globalForRedis.helpdeskRedis = undefined;
  }
}
