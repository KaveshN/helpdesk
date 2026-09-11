import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Prisma 7 has no Rust query engine: the client talks to Postgres through a
 * driver adapter (`pg`), and the connection string lives here rather than in
 * schema.prisma.
 *
 * Construction is lazy for the same reason env parsing is -- `next build` must
 * not need a reachable database. In dev the instance is parked on globalThis so
 * hot reload doesn't open a new pool on every edit (the classic Next + Prisma
 * connection leak).
 */
const globalForPrisma = globalThis as unknown as { helpdeskPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const config = env();
  const adapter = new PrismaPg({
    connectionString: config.DATABASE_URL,
    max: config.NODE_ENV === 'production' ? 10 : 5,
  });

  const client = new PrismaClient({
    adapter,
    log:
      config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace'
        ? [{ emit: 'event', level: 'query' }]
        : [],
  });

  if (config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace') {
    client.$on('query', (event: { query: string; duration: number }) => {
      logger.debug({ query: event.query, durationMs: event.duration }, 'prisma query');
    });
  }

  return client;
}

/** The unscoped client. Use for platform-level tables only (User, HelpDeskGroup, AuditLog). */
export function db(): PrismaClient {
  if (!globalForPrisma.helpdeskPrisma) {
    globalForPrisma.helpdeskPrisma = createClient();
  }
  return globalForPrisma.helpdeskPrisma;
}

/** Test-only: dispose the pool between suites. */
export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.helpdeskPrisma) {
    await globalForPrisma.helpdeskPrisma.$disconnect();
    globalForPrisma.helpdeskPrisma = undefined;
  }
}
