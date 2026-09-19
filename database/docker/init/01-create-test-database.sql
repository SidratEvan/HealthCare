-- Runs once, on first container start only.
--
-- The dev container carries three databases:
--
--   healthcare_dev        the developer's own demo data
--   healthcare_test       the schema suite (database/tests)
--   healthcare_api_test   the API suite (backend/api/src/__tests__)
--
-- The two test databases are separate on purpose. Both suites run against
-- seeded demo data (CLAUDE.md §6), but the API suite *mutates* it: it creates
-- sessions, appends to the append-only log, and drives queues. The schema
-- suite meanwhile asserts things like "exactly six facilities". Sharing one
-- database makes each suite's result depend on whether the other ran first,
-- which is a flake rather than a failure and therefore worse.
CREATE DATABASE healthcare_test OWNER healthcare;
CREATE DATABASE healthcare_api_test OWNER healthcare;
