-- Change management becomes its own module (separate from tickets).
--
-- Hand-written preamble, then Prisma's generated diff. Two notes for anyone
-- replaying this against a database that already holds data:
--
--  1. The `kind = 'CHANGE'` ticket types below are the conflation being
--     removed. Types still referenced by a ticket are reassigned to
--     SERVICE_REQUEST rather than deleted, so no ticket is orphaned; unused
--     ones are dropped. Without this, the TicketTypeKind enum recreation
--     further down fails with "invalid input value for enum".
--
--  2. `ChangeRequest.riskLevelId` is added NOT NULL with no default. That is
--     safe here because the change module had no rows yet. If you have
--     existing change requests, insert the ChangeRiskLevel rows first and
--     backfill riskLevelId before this migration's ALTER TABLE.

-- Preserve tickets that reference a "Change" ticket type.
UPDATE "TicketType"
   SET "kind" = 'SERVICE_REQUEST'
 WHERE "kind" = 'CHANGE'
   AND EXISTS (SELECT 1 FROM "Ticket" WHERE "Ticket"."typeId" = "TicketType"."id");

-- Drop the unreferenced ones outright.
DELETE FROM "TicketType" WHERE "kind" = 'CHANGE';

-- CreateEnum
CREATE TYPE "ChangeEventType" AS ENUM ('CREATED', 'UPDATED', 'SUBMITTED', 'APPROVAL_REQUESTED', 'APPROVED', 'REJECTED', 'SCHEDULED', 'IMPLEMENTATION_STARTED', 'IMPLEMENTATION_COMPLETED', 'IMPLEMENTATION_FAILED', 'ROLLED_BACK', 'CANCELLED', 'CAB_ASSIGNED', 'RISK_CHANGED', 'TICKET_LINKED', 'WORKFLOW_APPLIED');

-- AlterEnum
BEGIN;
CREATE TYPE "TicketTypeKind_new" AS ENUM ('INCIDENT', 'SERVICE_REQUEST', 'PROBLEM', 'QUERY');
ALTER TABLE "TicketType" ALTER COLUMN "kind" TYPE "TicketTypeKind_new" USING ("kind"::text::"TicketTypeKind_new");
ALTER TYPE "TicketTypeKind" RENAME TO "TicketTypeKind_old";
ALTER TYPE "TicketTypeKind_new" RENAME TO "TicketTypeKind";
DROP TYPE "public"."TicketTypeKind_old";
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkflowTrigger" ADD VALUE 'CHANGE_APPROVED';
ALTER TYPE "WorkflowTrigger" ADD VALUE 'CHANGE_REJECTED';
ALTER TYPE "WorkflowTrigger" ADD VALUE 'CHANGE_SCHEDULED';

-- DropIndex
DROP INDEX "Ticket_changeRequestId_key";

-- AlterTable
ALTER TABLE "Cab" DROP COLUMN "riskLevels",
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rejectionIsFinal" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ChangeApproval" ADD COLUMN     "isChair" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isVoting" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ChangeRequest" DROP COLUMN "riskLevel",
ADD COLUMN     "changeCategoryId" UUID,
ADD COLUMN     "outcomeNotes" TEXT,
ADD COLUMN     "riskLevelId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "ChangeType" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "HelpDeskGroup" ADD COLUMN     "changeSequence" INTEGER NOT NULL DEFAULT 0;

-- DropEnum
DROP TYPE "RiskLevel";

-- CreateTable
CREATE TABLE "ChangeCategory" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRiskLevel" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "description" TEXT,
    "colour" TEXT,
    "requiresCab" BOOLEAN NOT NULL DEFAULT true,
    "minimumNoticeHours" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeRiskLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeEvent" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "changeRequestId" UUID NOT NULL,
    "actorId" UUID,
    "type" "ChangeEventType" NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CabRiskLevel" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "cabId" UUID NOT NULL,
    "riskLevelId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CabRiskLevel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeCategory_helpDeskGroupId_isActive_idx" ON "ChangeCategory"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeCategory_helpDeskGroupId_name_key" ON "ChangeCategory"("helpDeskGroupId", "name");

-- CreateIndex
CREATE INDEX "ChangeRiskLevel_helpDeskGroupId_isActive_idx" ON "ChangeRiskLevel"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeRiskLevel_helpDeskGroupId_name_key" ON "ChangeRiskLevel"("helpDeskGroupId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeRiskLevel_helpDeskGroupId_level_key" ON "ChangeRiskLevel"("helpDeskGroupId", "level");

-- CreateIndex
CREATE INDEX "ChangeEvent_changeRequestId_createdAt_idx" ON "ChangeEvent"("changeRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "ChangeEvent_helpDeskGroupId_createdAt_idx" ON "ChangeEvent"("helpDeskGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "CabRiskLevel_helpDeskGroupId_idx" ON "CabRiskLevel"("helpDeskGroupId");

-- CreateIndex
CREATE INDEX "CabRiskLevel_riskLevelId_idx" ON "CabRiskLevel"("riskLevelId");

-- CreateIndex
CREATE UNIQUE INDEX "CabRiskLevel_cabId_riskLevelId_key" ON "CabRiskLevel"("cabId", "riskLevelId");

-- CreateIndex
CREATE INDEX "ChangeApproval_approverId_decision_idx" ON "ChangeApproval"("approverId", "decision");

-- CreateIndex
CREATE INDEX "ChangeRequest_helpDeskGroupId_riskLevelId_idx" ON "ChangeRequest"("helpDeskGroupId", "riskLevelId");

-- CreateIndex
CREATE INDEX "Ticket_changeRequestId_idx" ON "Ticket"("changeRequestId");

-- AddForeignKey
ALTER TABLE "ChangeCategory" ADD CONSTRAINT "ChangeCategory_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRiskLevel" ADD CONSTRAINT "ChangeRiskLevel_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_changeCategoryId_fkey" FOREIGN KEY ("changeCategoryId") REFERENCES "ChangeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_riskLevelId_fkey" FOREIGN KEY ("riskLevelId") REFERENCES "ChangeRiskLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CabRiskLevel" ADD CONSTRAINT "CabRiskLevel_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CabRiskLevel" ADD CONSTRAINT "CabRiskLevel_cabId_fkey" FOREIGN KEY ("cabId") REFERENCES "Cab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CabRiskLevel" ADD CONSTRAINT "CabRiskLevel_riskLevelId_fkey" FOREIGN KEY ("riskLevelId") REFERENCES "ChangeRiskLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

