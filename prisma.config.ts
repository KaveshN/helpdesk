// Prisma 7 moved the connection URL out of schema.prisma and into this file.
// The CLI no longer auto-loads .env, hence the explicit dotenv import.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
    // Prisma Migrate replays migrations here to diff schema changes. Created by
    // docker/postgres-init/01-shadow-db.sql at first cluster init.
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
});
