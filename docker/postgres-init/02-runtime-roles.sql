-- Runtime roles for row-level security. Runs once at first cluster init.
--
-- The migrations also create helpdesk_platform / helpdesk_app (idempotently)
-- and grant table privileges; this file exists so the LOGIN user the app
-- connects as is ready before the first migration runs. On an existing
-- cluster, run the same statements by hand -- see README "Database roles".
--
-- Development password only. Production sets its own.
CREATE ROLE helpdesk_platform NOLOGIN;
CREATE ROLE helpdesk_app NOLOGIN;
GRANT helpdesk_app TO helpdesk_platform;
CREATE ROLE helpdesk_runtime LOGIN PASSWORD 'helpdesk';
GRANT helpdesk_platform TO helpdesk_runtime;
