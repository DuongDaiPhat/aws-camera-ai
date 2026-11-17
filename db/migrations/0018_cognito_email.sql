BEGIN;

-- Display metadata for the linked identity. Authentication still uses issuer and subject.
ALTER TABLE users ADD COLUMN cognito_email TEXT;

COMMIT;
