-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('HD_ADMIN', 'AGENT', 'OBSERVER');

-- CreateEnum
CREATE TYPE "ObserverScope" AS ENUM ('WATCHED_ONLY', 'ALL_TICKETS');

-- CreateEnum
CREATE TYPE "StatusCategory" AS ENUM ('NEW', 'OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketTypeKind" AS ENUM ('INCIDENT', 'SERVICE_REQUEST', 'PROBLEM', 'CHANGE', 'QUERY');

-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('WEB', 'EMAIL', 'PHONE', 'CHAT', 'API', 'WORKFLOW');

-- CreateEnum
CREATE TYPE "TicketEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'TYPE_CHANGED', 'ASSIGNED', 'UNASSIGNED', 'CATEGORY_CHANGED', 'COMMENT_ADDED', 'ATTACHMENT_ADDED', 'WATCHER_ADDED', 'WATCHER_REMOVED', 'SLA_APPLIED', 'SLA_WARNED', 'SLA_BREACHED', 'REOPENED', 'RESOLVED', 'CLOSED', 'ARTICLE_LINKED', 'WORKFLOW_APPLIED', 'ESCALATED', 'MERGED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ABSTAINED');

-- CreateEnum
CREATE TYPE "CabApprovalMode" AS ENUM ('ALL_MEMBERS', 'QUORUM', 'ANY_MEMBER', 'CHAIR_ONLY');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_STATUS_CHANGED', 'TICKET_COMMENT_ADDED', 'TICKET_RESOLVED', 'TICKET_CLOSED', 'TICKET_REOPENED', 'SLA_RESPONSE_WARNING', 'SLA_RESPONSE_BREACH', 'SLA_RESOLUTION_WARNING', 'SLA_RESOLUTION_BREACH', 'AFTER_HOURS_AUTO_REPLY', 'EMAIL_ACKNOWLEDGEMENT', 'CHANGE_SUBMITTED', 'CHANGE_APPROVAL_REQUESTED', 'CHANGE_APPROVED', 'CHANGE_REJECTED', 'SCHEDULED_REPORT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'IN_APP', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "WorkflowTrigger" AS ENUM ('TICKET_CREATED', 'TICKET_UPDATED', 'TICKET_STATUS_CHANGED', 'TICKET_ASSIGNED', 'TICKET_COMMENT_ADDED', 'SLA_WARNING', 'SLA_BREACH', 'CHANGE_SUBMITTED');

-- CreateEnum
CREATE TYPE "ConditionOperator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'CONTAINS', 'NOT_CONTAINS', 'IN', 'NOT_IN', 'GREATER_THAN', 'LESS_THAN', 'IS_EMPTY', 'IS_NOT_EMPTY');

-- CreateEnum
CREATE TYPE "WorkflowActionType" AS ENUM ('ASSIGN_TO_USER', 'ASSIGN_ROUND_ROBIN', 'SET_PRIORITY', 'SET_STATUS', 'SET_CATEGORY', 'SET_SLA_POLICY', 'ADD_WATCHER', 'SEND_NOTIFICATION', 'ESCALATE_TO_USER', 'REQUIRE_APPROVAL', 'ADD_INTERNAL_NOTE');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('TICKET_VOLUME', 'SLA_PERFORMANCE', 'AGENT_PERFORMANCE', 'TICKET_AGEING', 'TREND_ANALYSIS', 'CSAT', 'CHANGE_SUMMARY');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('CSV', 'XLSX', 'PDF', 'HTML');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "InboundEmailStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "TargetMetric" AS ENUM ('TICKETS_RESOLVED', 'FIRST_RESPONSE_SLA', 'RESOLUTION_SLA', 'CSAT_AVERAGE', 'REOPEN_RATE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "entraObjectId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT,
    "phone" TEXT,
    "platformRole" "PlatformRole",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpDeskGroup" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "inboundEmailAddress" TEXT,
    "outboundEmailAddress" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
    "ticketSequence" INTEGER NOT NULL DEFAULT 0,
    "observerScope" "ObserverScope" NOT NULL DEFAULT 'WATCHED_ONLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpDeskGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpDeskMembership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "role" "GroupRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpDeskMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "actorUserId" UUID,
    "actorEmail" TEXT NOT NULL,
    "helpDeskGroupId" UUID,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketType" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TicketTypeKind" NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Priority" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "colour" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Priority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketStatus" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "StatusCategory" NOT NULL,
    "pausesSla" BOOLEAN NOT NULL DEFAULT false,
    "colour" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubCategory" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ticketTypeId" UUID,
    "categoryId" UUID,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT true,
    "calendarId" UUID,
    "matchOrder" INTEGER NOT NULL DEFAULT 100,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaTarget" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "slaPolicyId" UUID NOT NULL,
    "priorityId" UUID NOT NULL,
    "responseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "warningThresholdPct" INTEGER NOT NULL DEFAULT 80,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calendar" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "region" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkingHours" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "calendarId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "isWorkingDay" BOOLEAN NOT NULL DEFAULT true,
    "startMinute" INTEGER NOT NULL DEFAULT 480,
    "endMinute" INTEGER NOT NULL DEFAULT 1020,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkingHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "calendarId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AfterHoursConfig" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "calendarId" UUID,
    "autoReplyMessage" TEXT,
    "escalationDelayMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AfterHoursConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AfterHoursContact" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "afterHoursConfigId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "escalationOrder" INTEGER NOT NULL DEFAULT 1,
    "isEmergencyContact" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AfterHoursContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" "WorkflowTrigger" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "stopOnMatch" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowCondition" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "workflowId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "operator" "ConditionOperator" NOT NULL,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowAction" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "workflowId" UUID NOT NULL,
    "type" "WorkflowActionType" NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "templateId" UUID,
    "ticketId" UUID,
    "event" "NotificationEvent" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "typeId" UUID NOT NULL,
    "priorityId" UUID NOT NULL,
    "statusId" UUID NOT NULL,
    "categoryId" UUID,
    "subCategoryId" UUID,
    "requesterId" UUID NOT NULL,
    "assigneeId" UUID,
    "createdById" UUID NOT NULL,
    "source" "TicketSource" NOT NULL DEFAULT 'WEB',
    "slaPolicyId" UUID,
    "firstResponseDueAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "responseBreached" BOOLEAN NOT NULL DEFAULT false,
    "resolutionBreached" BOOLEAN NOT NULL DEFAULT false,
    "slaPausedMinutes" INTEGER NOT NULL DEFAULT 0,
    "slaPausedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "emailMessageId" TEXT,
    "emailThreadId" TEXT,
    "changeRequestId" UUID,
    "parentTicketId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketWatcher" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "addedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketWatcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "source" "TicketSource" NOT NULL DEFAULT 'WEB',
    "emailMessageId" TEXT,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketAttachment" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "commentId" UUID,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "actorId" UUID,
    "type" "TicketEventType" NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeType" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPreApproved" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "changeTypeId" UUID NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "status" "ChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "requesterId" UUID NOT NULL,
    "ownerId" UUID,
    "cabId" UUID,
    "impactAssessment" TEXT,
    "implementationPlan" TEXT,
    "rollbackPlan" TEXT,
    "testPlan" TEXT,
    "plannedStartAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "actualStartAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeApproval" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "changeRequestId" UUID NOT NULL,
    "approverId" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cab" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "approvalMode" "CabApprovalMode" NOT NULL DEFAULT 'QUORUM',
    "quorum" INTEGER NOT NULL DEFAULT 2,
    "riskLevels" "RiskLevel"[] DEFAULT ARRAY['HIGH', 'CRITICAL']::"RiskLevel"[],
    "workflowId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CabMember" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "cabId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "isChair" BOOLEAN NOT NULL DEFAULT false,
    "isVoting" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CabMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleCategory" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID,
    "isGlobal" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "contentJson" JSONB,
    "excerpt" TEXT,
    "articleCategoryId" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeArticleVersion" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "contentJson" JSONB,
    "changeNote" TEXT,
    "editedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeArticleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleTicketLink" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "linkedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleTicketLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDefinition" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ReportType" NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "createdById" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReport" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "reportDefinitionId" UUID NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "format" "ReportFormat" NOT NULL DEFAULT 'CSV',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "reportDefinitionId" UUID NOT NULL,
    "scheduledReportId" UUID,
    "status" "ReportRunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "rowCount" INTEGER,
    "artifactKey" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID,
    "messageId" TEXT NOT NULL,
    "inReplyTo" TEXT,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "status" "InboundEmailStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "ticketId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTarget" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "metric" "TargetMetric" NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "points" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAchievement" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "achievementId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsatResponse" (
    "id" UUID NOT NULL,
    "helpDeskGroupId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "respondentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsatResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_entraObjectId_key" ON "User"("entraObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "HelpDeskGroup_key_key" ON "HelpDeskGroup"("key");

-- CreateIndex
CREATE UNIQUE INDEX "HelpDeskGroup_name_key" ON "HelpDeskGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "HelpDeskGroup_inboundEmailAddress_key" ON "HelpDeskGroup"("inboundEmailAddress");

-- CreateIndex
CREATE INDEX "HelpDeskGroup_isActive_idx" ON "HelpDeskGroup"("isActive");

-- CreateIndex
CREATE INDEX "HelpDeskMembership_helpDeskGroupId_role_idx" ON "HelpDeskMembership"("helpDeskGroupId", "role");

-- CreateIndex
CREATE INDEX "HelpDeskMembership_userId_isActive_idx" ON "HelpDeskMembership"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "HelpDeskMembership_userId_helpDeskGroupId_key" ON "HelpDeskMembership"("userId", "helpDeskGroupId");

-- CreateIndex
CREATE INDEX "AuditLog_helpDeskGroupId_createdAt_idx" ON "AuditLog"("helpDeskGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "TicketType_helpDeskGroupId_isActive_idx" ON "TicketType"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TicketType_helpDeskGroupId_name_key" ON "TicketType"("helpDeskGroupId", "name");

-- CreateIndex
CREATE INDEX "Priority_helpDeskGroupId_isActive_idx" ON "Priority"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Priority_helpDeskGroupId_name_key" ON "Priority"("helpDeskGroupId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Priority_helpDeskGroupId_level_key" ON "Priority"("helpDeskGroupId", "level");

-- CreateIndex
CREATE INDEX "TicketStatus_helpDeskGroupId_isActive_idx" ON "TicketStatus"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TicketStatus_helpDeskGroupId_name_key" ON "TicketStatus"("helpDeskGroupId", "name");

-- CreateIndex
CREATE INDEX "Category_helpDeskGroupId_isActive_idx" ON "Category"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Category_helpDeskGroupId_name_key" ON "Category"("helpDeskGroupId", "name");

-- CreateIndex
CREATE INDEX "SubCategory_helpDeskGroupId_isActive_idx" ON "SubCategory"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SubCategory_categoryId_name_key" ON "SubCategory"("categoryId", "name");

-- CreateIndex
CREATE INDEX "SlaPolicy_helpDeskGroupId_isActive_matchOrder_idx" ON "SlaPolicy"("helpDeskGroupId", "isActive", "matchOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_helpDeskGroupId_name_key" ON "SlaPolicy"("helpDeskGroupId", "name");

-- CreateIndex
CREATE INDEX "SlaTarget_helpDeskGroupId_idx" ON "SlaTarget"("helpDeskGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "SlaTarget_slaPolicyId_priorityId_key" ON "SlaTarget"("slaPolicyId", "priorityId");

-- CreateIndex
CREATE INDEX "Calendar_helpDeskGroupId_isActive_idx" ON "Calendar"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Calendar_helpDeskGroupId_name_key" ON "Calendar"("helpDeskGroupId", "name");

-- CreateIndex
CREATE INDEX "WorkingHours_helpDeskGroupId_idx" ON "WorkingHours"("helpDeskGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkingHours_calendarId_dayOfWeek_key" ON "WorkingHours"("calendarId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "Holiday_helpDeskGroupId_date_idx" ON "Holiday"("helpDeskGroupId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_calendarId_date_key" ON "Holiday"("calendarId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AfterHoursConfig_helpDeskGroupId_key" ON "AfterHoursConfig"("helpDeskGroupId");

-- CreateIndex
CREATE INDEX "AfterHoursContact_helpDeskGroupId_escalationOrder_idx" ON "AfterHoursContact"("helpDeskGroupId", "escalationOrder");

-- CreateIndex
CREATE INDEX "Workflow_helpDeskGroupId_trigger_isActive_sortOrder_idx" ON "Workflow"("helpDeskGroupId", "trigger", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_helpDeskGroupId_name_key" ON "Workflow"("helpDeskGroupId", "name");

-- CreateIndex
CREATE INDEX "WorkflowCondition_workflowId_idx" ON "WorkflowCondition"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowCondition_helpDeskGroupId_idx" ON "WorkflowCondition"("helpDeskGroupId");

-- CreateIndex
CREATE INDEX "WorkflowAction_workflowId_sortOrder_idx" ON "WorkflowAction"("workflowId", "sortOrder");

-- CreateIndex
CREATE INDEX "WorkflowAction_helpDeskGroupId_idx" ON "WorkflowAction"("helpDeskGroupId");

-- CreateIndex
CREATE INDEX "NotificationTemplate_helpDeskGroupId_isActive_idx" ON "NotificationTemplate"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_helpDeskGroupId_event_channel_key" ON "NotificationTemplate"("helpDeskGroupId", "event", "channel");

-- CreateIndex
CREATE INDEX "NotificationLog_helpDeskGroupId_createdAt_idx" ON "NotificationLog"("helpDeskGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_ticketId_idx" ON "NotificationLog"("ticketId");

-- CreateIndex
CREATE INDEX "NotificationLog_status_idx" ON "NotificationLog"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_reference_key" ON "Ticket"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_changeRequestId_key" ON "Ticket"("changeRequestId");

-- CreateIndex
CREATE INDEX "Ticket_helpDeskGroupId_statusId_idx" ON "Ticket"("helpDeskGroupId", "statusId");

-- CreateIndex
CREATE INDEX "Ticket_helpDeskGroupId_assigneeId_statusId_idx" ON "Ticket"("helpDeskGroupId", "assigneeId", "statusId");

-- CreateIndex
CREATE INDEX "Ticket_helpDeskGroupId_requesterId_idx" ON "Ticket"("helpDeskGroupId", "requesterId");

-- CreateIndex
CREATE INDEX "Ticket_helpDeskGroupId_createdAt_idx" ON "Ticket"("helpDeskGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_helpDeskGroupId_resolutionDueAt_idx" ON "Ticket"("helpDeskGroupId", "resolutionDueAt");

-- CreateIndex
CREATE INDEX "Ticket_emailThreadId_idx" ON "Ticket"("emailThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_helpDeskGroupId_sequence_key" ON "Ticket"("helpDeskGroupId", "sequence");

-- CreateIndex
CREATE INDEX "TicketWatcher_helpDeskGroupId_userId_idx" ON "TicketWatcher"("helpDeskGroupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketWatcher_ticketId_userId_key" ON "TicketWatcher"("ticketId", "userId");

-- CreateIndex
CREATE INDEX "TicketComment_ticketId_createdAt_idx" ON "TicketComment"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketComment_helpDeskGroupId_idx" ON "TicketComment"("helpDeskGroupId");

-- CreateIndex
CREATE INDEX "TicketAttachment_ticketId_idx" ON "TicketAttachment"("ticketId");

-- CreateIndex
CREATE INDEX "TicketAttachment_helpDeskGroupId_idx" ON "TicketAttachment"("helpDeskGroupId");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketEvent_helpDeskGroupId_createdAt_idx" ON "TicketEvent"("helpDeskGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "ChangeType_helpDeskGroupId_isActive_idx" ON "ChangeType"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeType_helpDeskGroupId_name_key" ON "ChangeType"("helpDeskGroupId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeRequest_reference_key" ON "ChangeRequest"("reference");

-- CreateIndex
CREATE INDEX "ChangeRequest_helpDeskGroupId_status_idx" ON "ChangeRequest"("helpDeskGroupId", "status");

-- CreateIndex
CREATE INDEX "ChangeRequest_helpDeskGroupId_plannedStartAt_idx" ON "ChangeRequest"("helpDeskGroupId", "plannedStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeRequest_helpDeskGroupId_sequence_key" ON "ChangeRequest"("helpDeskGroupId", "sequence");

-- CreateIndex
CREATE INDEX "ChangeApproval_helpDeskGroupId_decision_idx" ON "ChangeApproval"("helpDeskGroupId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeApproval_changeRequestId_approverId_key" ON "ChangeApproval"("changeRequestId", "approverId");

-- CreateIndex
CREATE INDEX "Cab_helpDeskGroupId_isActive_idx" ON "Cab"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Cab_helpDeskGroupId_name_key" ON "Cab"("helpDeskGroupId", "name");

-- CreateIndex
CREATE INDEX "CabMember_helpDeskGroupId_idx" ON "CabMember"("helpDeskGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "CabMember_cabId_userId_key" ON "CabMember"("cabId", "userId");

-- CreateIndex
CREATE INDEX "ArticleCategory_helpDeskGroupId_isActive_idx" ON "ArticleCategory"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleCategory_helpDeskGroupId_name_key" ON "ArticleCategory"("helpDeskGroupId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticle_slug_key" ON "KnowledgeArticle"("slug");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_helpDeskGroupId_status_idx" ON "KnowledgeArticle"("helpDeskGroupId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_isGlobal_status_idx" ON "KnowledgeArticle"("isGlobal", "status");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_tags_idx" ON "KnowledgeArticle"("tags");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticleVersion_articleId_version_key" ON "KnowledgeArticleVersion"("articleId", "version");

-- CreateIndex
CREATE INDEX "ArticleTicketLink_helpDeskGroupId_idx" ON "ArticleTicketLink"("helpDeskGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleTicketLink_articleId_ticketId_key" ON "ArticleTicketLink"("articleId", "ticketId");

-- CreateIndex
CREATE INDEX "ReportDefinition_helpDeskGroupId_isActive_idx" ON "ReportDefinition"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ReportDefinition_helpDeskGroupId_name_key" ON "ReportDefinition"("helpDeskGroupId", "name");

-- CreateIndex
CREATE INDEX "ScheduledReport_helpDeskGroupId_isActive_idx" ON "ScheduledReport"("helpDeskGroupId", "isActive");

-- CreateIndex
CREATE INDEX "ScheduledReport_isActive_nextRunAt_idx" ON "ScheduledReport"("isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "ReportRun_helpDeskGroupId_createdAt_idx" ON "ReportRun"("helpDeskGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportRun_status_idx" ON "ReportRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmail_messageId_key" ON "InboundEmail"("messageId");

-- CreateIndex
CREATE INDEX "InboundEmail_status_receivedAt_idx" ON "InboundEmail"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "InboundEmail_helpDeskGroupId_receivedAt_idx" ON "InboundEmail"("helpDeskGroupId", "receivedAt");

-- CreateIndex
CREATE INDEX "InboundEmail_inReplyTo_idx" ON "InboundEmail"("inReplyTo");

-- CreateIndex
CREATE INDEX "AgentTarget_helpDeskGroupId_periodStart_idx" ON "AgentTarget"("helpDeskGroupId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTarget_helpDeskGroupId_userId_metric_periodStart_key" ON "AgentTarget"("helpDeskGroupId", "userId", "metric", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_helpDeskGroupId_name_key" ON "Achievement"("helpDeskGroupId", "name");

-- CreateIndex
CREATE INDEX "AgentAchievement_helpDeskGroupId_userId_idx" ON "AgentAchievement"("helpDeskGroupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentAchievement_achievementId_userId_key" ON "AgentAchievement"("achievementId", "userId");

-- CreateIndex
CREATE INDEX "CsatResponse_helpDeskGroupId_createdAt_idx" ON "CsatResponse"("helpDeskGroupId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CsatResponse_ticketId_respondentId_key" ON "CsatResponse"("ticketId", "respondentId");

-- AddForeignKey
ALTER TABLE "HelpDeskMembership" ADD CONSTRAINT "HelpDeskMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpDeskMembership" ADD CONSTRAINT "HelpDeskMembership_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Priority" ADD CONSTRAINT "Priority_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatus" ADD CONSTRAINT "TicketStatus_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubCategory" ADD CONSTRAINT "SubCategory_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubCategory" ADD CONSTRAINT "SubCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaTarget" ADD CONSTRAINT "SlaTarget_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaTarget" ADD CONSTRAINT "SlaTarget_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaTarget" ADD CONSTRAINT "SlaTarget_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "Priority"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHours" ADD CONSTRAINT "WorkingHours_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHours" ADD CONSTRAINT "WorkingHours_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AfterHoursConfig" ADD CONSTRAINT "AfterHoursConfig_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AfterHoursConfig" ADD CONSTRAINT "AfterHoursConfig_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AfterHoursContact" ADD CONSTRAINT "AfterHoursContact_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AfterHoursContact" ADD CONSTRAINT "AfterHoursContact_afterHoursConfigId_fkey" FOREIGN KEY ("afterHoursConfigId") REFERENCES "AfterHoursConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowCondition" ADD CONSTRAINT "WorkflowCondition_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowCondition" ADD CONSTRAINT "WorkflowCondition_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAction" ADD CONSTRAINT "WorkflowAction_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAction" ADD CONSTRAINT "WorkflowAction_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "Priority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "TicketStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_parentTicketId_fkey" FOREIGN KEY ("parentTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWatcher" ADD CONSTRAINT "TicketWatcher_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWatcher" ADD CONSTRAINT "TicketWatcher_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWatcher" ADD CONSTRAINT "TicketWatcher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWatcher" ADD CONSTRAINT "TicketWatcher_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TicketComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeType" ADD CONSTRAINT "ChangeType_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_changeTypeId_fkey" FOREIGN KEY ("changeTypeId") REFERENCES "ChangeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_cabId_fkey" FOREIGN KEY ("cabId") REFERENCES "Cab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeApproval" ADD CONSTRAINT "ChangeApproval_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeApproval" ADD CONSTRAINT "ChangeApproval_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeApproval" ADD CONSTRAINT "ChangeApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cab" ADD CONSTRAINT "Cab_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cab" ADD CONSTRAINT "Cab_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CabMember" ADD CONSTRAINT "CabMember_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CabMember" ADD CONSTRAINT "CabMember_cabId_fkey" FOREIGN KEY ("cabId") REFERENCES "Cab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CabMember" ADD CONSTRAINT "CabMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleCategory" ADD CONSTRAINT "ArticleCategory_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_articleCategoryId_fkey" FOREIGN KEY ("articleCategoryId") REFERENCES "ArticleCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticleVersion" ADD CONSTRAINT "KnowledgeArticleVersion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticleVersion" ADD CONSTRAINT "KnowledgeArticleVersion_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTicketLink" ADD CONSTRAINT "ArticleTicketLink_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTicketLink" ADD CONSTRAINT "ArticleTicketLink_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTicketLink" ADD CONSTRAINT "ArticleTicketLink_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTicketLink" ADD CONSTRAINT "ArticleTicketLink_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDefinition" ADD CONSTRAINT "ReportDefinition_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDefinition" ADD CONSTRAINT "ReportDefinition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReport" ADD CONSTRAINT "ScheduledReport_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReport" ADD CONSTRAINT "ScheduledReport_reportDefinitionId_fkey" FOREIGN KEY ("reportDefinitionId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_reportDefinitionId_fkey" FOREIGN KEY ("reportDefinitionId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_scheduledReportId_fkey" FOREIGN KEY ("scheduledReportId") REFERENCES "ScheduledReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTarget" ADD CONSTRAINT "AgentTarget_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTarget" ADD CONSTRAINT "AgentTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAchievement" ADD CONSTRAINT "AgentAchievement_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAchievement" ADD CONSTRAINT "AgentAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAchievement" ADD CONSTRAINT "AgentAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsatResponse" ADD CONSTRAINT "CsatResponse_helpDeskGroupId_fkey" FOREIGN KEY ("helpDeskGroupId") REFERENCES "HelpDeskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsatResponse" ADD CONSTRAINT "CsatResponse_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsatResponse" ADD CONSTRAINT "CsatResponse_respondentId_fkey" FOREIGN KEY ("respondentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

