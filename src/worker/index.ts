// Next loads .env itself; a standalone process must do it explicitly. Harmless
// under compose, where the variables arrive through env_file.
import 'dotenv/config';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { disconnectDb } from '@/lib/db/client';
import { assertRuntimeRole } from '@/lib/db/role-check';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { JOB, QUEUE_NAME, runJob } from '@/worker/jobs';

/**
 * The background worker: one process, one BullMQ queue on the existing Redis.
 *
 * Schedules are "job schedulers" (BullMQ's repeatable jobs): upserting them
 * on every start is idempotent, so a second replica or a restart never
 * doubles the cadence. Concurrency is 1 because the jobs are per-tenant
 * sweeps that already loop internally; parallelism belongs inside a job.
 *
 * Run with `npm run worker` (or `worker:watch` in development); in compose it
 * is the `worker` service.
 */
async function main(): Promise<void> {
  const config = env();
  await assertRuntimeRole();

  // BullMQ needs its own connection: it sets maxRetriesPerRequest to null so
  // blocking commands (BRPOPLPUSH) are never cut short by the client.
  const connection = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
  });
  connection.on('error', (error) => logger.error({ err: error }, 'worker redis error'));

  const queue = new Queue(QUEUE_NAME, { connection });
  const jobOptions = { removeOnComplete: 200, removeOnFail: 500 };

  await queue.upsertJobScheduler(
    'mail-sync',
    { every: config.EMAIL_POLL_INTERVAL_SECONDS * 1000 },
    { name: JOB.mailSync, opts: jobOptions },
  );
  await queue.upsertJobScheduler(
    'mail-flush',
    { every: 60_000 },
    { name: JOB.mailFlush, opts: jobOptions },
  );

  const worker = new Worker(QUEUE_NAME, (job) => runJob(job.name), {
    connection,
    concurrency: 1,
  });

  worker.on('completed', (job, result) => {
    logger.info({ job: job.name, id: job.id, result }, 'job completed');
  });
  worker.on('failed', (job, error) => {
    logger.error({ job: job?.name, id: job?.id, err: error }, 'job failed');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    await worker.close();
    await queue.close();
    await connection.quit();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.info(
    { queue: QUEUE_NAME, mailSyncEverySeconds: config.EMAIL_POLL_INTERVAL_SECONDS },
    'worker started',
  );
}

main().catch((error) => {
  logger.fatal({ err: error }, 'worker failed to start');
  process.exit(1);
});
