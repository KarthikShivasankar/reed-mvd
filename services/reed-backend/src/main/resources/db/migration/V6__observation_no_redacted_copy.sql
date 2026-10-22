-- Viewers outside the company now get no free text at all (it may name colleagues the redactor does not know),
-- so the redacted copy of V5 is not needed.
ALTER TABLE reed_observation DROP COLUMN redacted_text;
