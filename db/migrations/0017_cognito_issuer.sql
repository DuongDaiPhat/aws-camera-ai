BEGIN;

-- Existing local users and ownership IDs remain unchanged.
ALTER TABLE users ADD COLUMN cognito_issuer TEXT;
CREATE UNIQUE INDEX idx_users_cognito_identity
    ON users (cognito_issuer, cognito_sub)
    WHERE cognito_issuer IS NOT NULL AND cognito_sub IS NOT NULL;

COMMIT;
