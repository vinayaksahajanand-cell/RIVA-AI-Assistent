-- Executed once when the database volume is first created.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Separate database used by the automated test-suite so tests never touch your data.
SELECT 'CREATE DATABASE riva_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'riva_test')\gexec

\connect riva_test
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
