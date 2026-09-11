-- Entra-backed identities, Exchange Online mailboxes, and the leaderboard.
--
-- Ticket.requesterId becomes nullable so an external correspondent (Contact)
-- can raise a ticket. Existing rows all have a requesterId and default to
-- requesterKind = 'USER', so the backfill is a no-op — but the CHECK at the
-- bottom is what stops the pair drifting apart from here on.

-- CreateEnum
CREATE TYPE "LeaderboardPeriod" AS ENUM ('WEEK', 'MONTH', 'QUARTER');

-- CreateEnum
CREATE TYPE "OutboundEmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "RequesterKind" AS ENUM ('USER', 'CONTACT');

-- DropForeignKey
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_requesterId_fkey";

-- AlterTable
ALTER TABLE "HelpDeskGroup" ADD COLUMN     "mailboxDeltaLink" TEXT,
ADD COLUMN     "mailboxLastError" TEXT,
ADD COLUMN     "mailboxLastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "mailboxSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mailboxSyncFrom" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InboundEmail" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "graphMessageId" TEXT;

-- AlterTable
ALTER TABLE "Priority" ADD COLUMN     "leaderboardWeight" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "contactId" UUID,
ADD COLUMN     "requesterKind" "RequesterKind" NOT NULL DEFAULT 'USER',
ALTER COLUMN "requesterId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "department" TEXT,
ADD COLUMN     "entraSyncedAt" TIMESTAMP(3),
ADD COLUMN     "entraUpn" TEXT;

-- CreateTable
CREATE TABLE "Contact" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "organisation" TEXT,
    "linkedUserId" UUID,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundEmail" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "ticketId" UUID,
    "commentId" UUID,
    "fromAddress" TEXT NOT NULL,
    "toAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ccAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "graphMessageId" TEXT,
    "internetMessageId" TEXT,
    "conversationId" TEXT,
    "inReplyToGraphId" TEXT,
    "status" "OutboundEmailStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "sentById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardConfig" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "visibleToAgents" BOOLEAN NOT NULL DEFAULT true,
    "period" "LeaderboardPeriod" NOT NULL DEFAULT 'MONTH',
    "weightResolved" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "weightResponseSla" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "weightResolutionSla" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "weightCsat" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "weightReopen" DOUBLE PRECISION NOT NULL DEFAULT -15,
    "minimumTicketsToRank" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_helpDeskGroupId_lastSeenAt_idx" ON "Contact"("helpDeskGroupId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_helpDeskGroupId_email_key" ON "Contact"("helpDeskGroupId", "email");

-- CreateIndex
CREATE INDEX "OutboundEmail_helpDeskGroupId_status_idx" ON "OutboundEmail"("helpDeskGroupId", "status");

-- CreateIndex
CREATE INDEX "OutboundEmail_ticketId_idx" ON "OutboundEmail"("ticketId");

-- CreateIndex
CREATE INDEX "OutboundEmail_status_createdAt_idx" ON "OutboundEmail"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardConfig_helpDeskGroupId_key" ON "LeaderboardConfig"("helpDeskGroupId");

-- CreateIndex
CREATE INDEX "InboundEmail_conversationId_idx" ON "InboundEmail"("conversationId");

-- CreateIndex
CREATE INDEX "Ticket_helpDeskGroupId_contactId_idx" ON "Ticket"("helpDeskGroupId", "contactId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TicketComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardConfig" ADD CONSTRAINT "LeaderboardConfig_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exactly one requester, and requesterKind must agree with which column is set.
-- Without this, "requester" becomes two half-populated columns that every query
-- has to second-guess.
ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_requester_exactly_one_check"
  CHECK (
    ("requesterKind" = 'USER'    AND "requesterId" IS NOT NULL AND "contactId" IS NULL)
    OR
    ("requesterKind" = 'CONTACT' AND "contactId"  IS NOT NULL AND "requesterId" IS NULL)
  );

-- A Contact is an email identity; two rows differing only by case would split
-- one person's history across two records.
CREATE UNIQUE INDEX "Contact_group_email_lower_key"
  ON "Contact" ("helpDeskGroupId", lower("email"));

-- The outbound mail worker claims work from here on every tick, so keep the
-- index to just the rows it cares about.
CREATE INDEX "OutboundEmail_pending_idx"
  ON "OutboundEmail" ("helpDeskGroupId", "createdAt")
  WHERE "status" = 'QUEUED';

-- Leaderboard weights are multipliers; a negative resolved-weight or a zero
-- priority weight would silently invert or erase an agent's score.
ALTER TABLE "LeaderboardConfig"
  ADD CONSTRAINT "LeaderboardConfig_weights_check"
  CHECK ("weightResolved" >= 0 AND "weightResponseSla" >= 0
     AND "weightResolutionSla" >= 0 AND "weightCsat" >= 0
     AND "minimumTicketsToRank" >= 0);

ALTER TABLE "Priority"
  ADD CONSTRAINT "Priority_leaderboard_weight_check"
  CHECK ("leaderboardWeight" > 0);
