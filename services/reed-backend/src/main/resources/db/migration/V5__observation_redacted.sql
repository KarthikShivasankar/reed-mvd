-- What viewers outside the company (the dataspace operator) see of an observation: personal data removed.
ALTER TABLE reed_observation ADD COLUMN redacted_text varchar(2000);
