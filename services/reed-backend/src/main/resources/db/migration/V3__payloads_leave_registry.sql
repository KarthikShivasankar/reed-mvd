-- Confidential payloads now live with each company's own data service; the REED registry keeps
-- only metadata.
ALTER TABLE reed_asset DROP COLUMN IF EXISTS payload;
