-- Runs once, on first container start only.
--
-- The repository and API test suites (BACKEND.md §11) need a database they can
-- truncate freely without destroying the developer's demo data, so the dev
-- container carries two: healthcare_dev and healthcare_test.
CREATE DATABASE healthcare_test OWNER healthcare;
