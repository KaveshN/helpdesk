-- Constraints Prisma's schema language cannot express, but that the tenancy and
-- identity model depends on.

-- 1. A knowledge article is either owned by exactly one help desk group, or it
--    is platform-global. `isGlobal` exists so the flag is explicit in queries
--    and indexes; this constraint is what stops the two representations from
--    ever disagreeing.
ALTER TABLE "KnowledgeArticle"
  ADD CONSTRAINT "KnowledgeArticle_global_scope_check"
  CHECK (("isGlobal" = true AND "helpDeskGroupId" IS NULL)
      OR ("isGlobal" = false AND "helpDeskGroupId" IS NOT NULL));

-- 2. Article categories use NULL group to mean platform-global, with no boolean
--    flag, so there is no pairing to check. What is worth guarding is that two
--    global categories cannot differ only by letter case.
CREATE UNIQUE INDEX "ArticleCategory_global_name_key"
  ON "ArticleCategory" (lower("name"))
  WHERE "helpDeskGroupId" IS NULL;

-- 3. Email addresses are lowercased by the application on every write. This
--    index makes that an invariant rather than a convention, so two rows can
--    never differ only by case and split one person into two accounts.
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));

-- 4. Ratings are a small fixed range; a bad integer here silently skews every
--    CSAT report.
ALTER TABLE "CsatResponse"
  ADD CONSTRAINT "CsatResponse_rating_range_check" CHECK ("rating" BETWEEN 1 AND 5);

-- 5. Working hours are minutes from midnight in the calendar's own time zone.
ALTER TABLE "WorkingHours"
  ADD CONSTRAINT "WorkingHours_minute_range_check"
  CHECK ("startMinute" BETWEEN 0 AND 1440
     AND "endMinute" BETWEEN 0 AND 1440
     AND "endMinute" >= "startMinute"),
  ADD CONSTRAINT "WorkingHours_day_range_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6);

-- 6. Hot path for the agent dashboard and the SLA breach sweep: only unresolved
--    tickets matter, so a partial index stays small as history grows.
CREATE INDEX "Ticket_open_by_group_due_idx"
  ON "Ticket" ("helpDeskGroupId", "resolutionDueAt")
  WHERE "resolvedAt" IS NULL;
