-- Run once as the database owner after `npm run db:push`.
-- Creates the least-privilege role the application connects as, and makes the
-- audit log append-only at the database layer rather than by convention.
--
--   psql "$OWNER_DATABASE_URL" -v app_password="'<strong password>'" -f scripts/grants.sql
--
-- Then set DATABASE_URL to connect as `app`, never as the owner.

create role app login password :app_password;

grant usage on schema public to app;
grant select, insert, update, delete on all tables in schema public to app;
grant usage, select on all sequences in schema public to app;

-- The one exception: nobody, including the app, rewrites history.
revoke update, delete on table audit_logs from app;
revoke update, delete on table webhook_events from app;
grant update (status, processed_at, error_message) on table webhook_events to app;

alter default privileges in schema public grant select, insert, update, delete on tables to app;
