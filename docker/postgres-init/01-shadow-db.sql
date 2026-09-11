-- Prisma Migrate needs a scratch database to diff schema changes against.
-- Created once at first cluster init so `prisma migrate dev` works in-container.
CREATE DATABASE helpdesk_shadow;
