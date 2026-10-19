-- Real companies included only as illustrative participants (invented scenarios, no claims about them).
ALTER TABLE reed_participant ADD COLUMN IF NOT EXISTS illustrative boolean NOT NULL DEFAULT false;
