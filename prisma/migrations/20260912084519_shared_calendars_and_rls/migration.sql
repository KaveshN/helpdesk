-- AlterTable
ALTER TABLE "Calendar" ALTER COLUMN "helpDeskGroupId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Holiday" ALTER COLUMN "helpDeskGroupId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WorkingHours" ALTER COLUMN "helpDeskGroupId" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Row-level security (OPEN-QUESTIONS Q7, answered 2026-09-12).
--
-- Two NOLOGIN roles carry the policy:
--   helpdesk_platform  sees every row. The runtime login user is a member of
--                      it, so the unscoped Prisma client (db()) keeps working
--                      for platform-level code: auth, Super Admin pages, audit.
--   helpdesk_app       sees only rows whose "helpDeskGroupId" equals the
--                      transaction-local setting app.current_group_id.
--                      scopedDb() / scopedTransaction() run `SET LOCAL ROLE
--                      helpdesk_app` plus set_config() at the start of every
--                      transaction, so raw SQL and nested writes inside a
--                      scoped path are filtered by Postgres, not by Prisma.
--
-- The migration runs as the schema owner, which is also the only role that
-- may run DDL. Table owners bypass RLS, which is why the app never connects
-- as the owner: see README "Database roles".
--
-- Idempotent on purpose: Prisma replays migrations into the shadow database,
-- and roles are cluster-wide, so a plain CREATE ROLE would fail there.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_platform') THEN
    CREATE ROLE helpdesk_platform NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_app') THEN
    CREATE ROLE helpdesk_app NOLOGIN;
  END IF;
END
$$;

-- Membership lets a platform session `SET LOCAL ROLE helpdesk_app`.
GRANT helpdesk_app TO helpdesk_platform;

GRANT USAGE ON SCHEMA public TO helpdesk_platform, helpdesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helpdesk_platform, helpdesk_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helpdesk_platform, helpdesk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO helpdesk_platform, helpdesk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO helpdesk_platform, helpdesk_app;

-- Strictly group-scoped tables: a row is visible only inside its own group.
ALTER TABLE "HelpDeskMembership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "HelpDeskMembership_platform" ON "HelpDeskMembership" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "HelpDeskMembership_group" ON "HelpDeskMembership" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "TicketType" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "TicketType_platform" ON "TicketType" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "TicketType_group" ON "TicketType" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "Priority" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Priority_platform" ON "Priority" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "Priority_group" ON "Priority" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "TicketStatus" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "TicketStatus_platform" ON "TicketStatus" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "TicketStatus_group" ON "TicketStatus" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Category_platform" ON "Category" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "Category_group" ON "Category" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "SubCategory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SubCategory_platform" ON "SubCategory" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "SubCategory_group" ON "SubCategory" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "SlaPolicy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SlaPolicy_platform" ON "SlaPolicy" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "SlaPolicy_group" ON "SlaPolicy" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "SlaTarget" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SlaTarget_platform" ON "SlaTarget" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "SlaTarget_group" ON "SlaTarget" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "AfterHoursConfig" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AfterHoursConfig_platform" ON "AfterHoursConfig" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "AfterHoursConfig_group" ON "AfterHoursConfig" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "AfterHoursContact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AfterHoursContact_platform" ON "AfterHoursContact" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "AfterHoursContact_group" ON "AfterHoursContact" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "Workflow" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workflow_platform" ON "Workflow" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "Workflow_group" ON "Workflow" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "WorkflowCondition" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "WorkflowCondition_platform" ON "WorkflowCondition" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "WorkflowCondition_group" ON "WorkflowCondition" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "WorkflowAction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "WorkflowAction_platform" ON "WorkflowAction" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "WorkflowAction_group" ON "WorkflowAction" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "NotificationTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "NotificationTemplate_platform" ON "NotificationTemplate" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "NotificationTemplate_group" ON "NotificationTemplate" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "NotificationLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "NotificationLog_platform" ON "NotificationLog" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "NotificationLog_group" ON "NotificationLog" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "Ticket" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ticket_platform" ON "Ticket" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "Ticket_group" ON "Ticket" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "TicketWatcher" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "TicketWatcher_platform" ON "TicketWatcher" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "TicketWatcher_group" ON "TicketWatcher" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "TicketComment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "TicketComment_platform" ON "TicketComment" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "TicketComment_group" ON "TicketComment" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "TicketAttachment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "TicketAttachment_platform" ON "TicketAttachment" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "TicketAttachment_group" ON "TicketAttachment" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "TicketEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "TicketEvent_platform" ON "TicketEvent" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "TicketEvent_group" ON "TicketEvent" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "ChangeType" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ChangeType_platform" ON "ChangeType" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "ChangeType_group" ON "ChangeType" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "ChangeCategory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ChangeCategory_platform" ON "ChangeCategory" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "ChangeCategory_group" ON "ChangeCategory" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "ChangeRiskLevel" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ChangeRiskLevel_platform" ON "ChangeRiskLevel" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "ChangeRiskLevel_group" ON "ChangeRiskLevel" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "ChangeRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ChangeRequest_platform" ON "ChangeRequest" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "ChangeRequest_group" ON "ChangeRequest" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "ChangeApproval" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ChangeApproval_platform" ON "ChangeApproval" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "ChangeApproval_group" ON "ChangeApproval" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "ChangeEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ChangeEvent_platform" ON "ChangeEvent" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "ChangeEvent_group" ON "ChangeEvent" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "Cab" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cab_platform" ON "Cab" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "Cab_group" ON "Cab" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "CabMember" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "CabMember_platform" ON "CabMember" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "CabMember_group" ON "CabMember" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "CabRiskLevel" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "CabRiskLevel_platform" ON "CabRiskLevel" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "CabRiskLevel_group" ON "CabRiskLevel" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "ArticleTicketLink" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ArticleTicketLink_platform" ON "ArticleTicketLink" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "ArticleTicketLink_group" ON "ArticleTicketLink" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "ReportDefinition" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ReportDefinition_platform" ON "ReportDefinition" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "ReportDefinition_group" ON "ReportDefinition" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "ScheduledReport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ScheduledReport_platform" ON "ScheduledReport" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "ScheduledReport_group" ON "ScheduledReport" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "ReportRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ReportRun_platform" ON "ReportRun" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "ReportRun_group" ON "ReportRun" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "InboundEmail" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "InboundEmail_platform" ON "InboundEmail" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "InboundEmail_group" ON "InboundEmail" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "OutboundEmail" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "OutboundEmail_platform" ON "OutboundEmail" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "OutboundEmail_group" ON "OutboundEmail" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Contact_platform" ON "Contact" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "Contact_group" ON "Contact" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "LeaderboardConfig" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "LeaderboardConfig_platform" ON "LeaderboardConfig" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "LeaderboardConfig_group" ON "LeaderboardConfig" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "AgentTarget" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AgentTarget_platform" ON "AgentTarget" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "AgentTarget_group" ON "AgentTarget" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "Achievement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Achievement_platform" ON "Achievement" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "Achievement_group" ON "Achievement" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "AgentAchievement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AgentAchievement_platform" ON "AgentAchievement" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "AgentAchievement_group" ON "AgentAchievement" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "CsatResponse" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "CsatResponse_platform" ON "CsatResponse" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "CsatResponse_group" ON "CsatResponse" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);

-- Global-or-group tables: a NULL group means "platform-wide", readable by
-- every group but writable only through the platform role.
ALTER TABLE "KnowledgeArticle" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "KnowledgeArticle_platform" ON "KnowledgeArticle" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "KnowledgeArticle_group" ON "KnowledgeArticle" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid OR "helpDeskGroupId" IS NULL)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "ArticleCategory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ArticleCategory_platform" ON "ArticleCategory" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "ArticleCategory_group" ON "ArticleCategory" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid OR "helpDeskGroupId" IS NULL)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "Calendar" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Calendar_platform" ON "Calendar" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "Calendar_group" ON "Calendar" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid OR "helpDeskGroupId" IS NULL)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "WorkingHours" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "WorkingHours_platform" ON "WorkingHours" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "WorkingHours_group" ON "WorkingHours" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid OR "helpDeskGroupId" IS NULL)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
ALTER TABLE "Holiday" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Holiday_platform" ON "Holiday" FOR ALL TO helpdesk_platform USING (true) WITH CHECK (true);
CREATE POLICY "Holiday_group" ON "Holiday" FOR ALL TO helpdesk_app
  USING ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid OR "helpDeskGroupId" IS NULL)
  WITH CHECK ("helpDeskGroupId" = current_setting('app.current_group_id', true)::uuid);
