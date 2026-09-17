BEGIN;

CREATE TABLE auth_refresh_tokens (
    id                   UUID PRIMARY KEY,
    user_id              UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash           CHAR(64)    NOT NULL UNIQUE,
    expires_at           TIMESTAMPTZ NOT NULL,
    revoked_at           TIMESTAMPTZ,
    replaced_by_token_id UUID        REFERENCES auth_refresh_tokens (id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_refresh_tokens_active
    ON auth_refresh_tokens (user_id, expires_at)
    WHERE revoked_at IS NULL;

COMMENT ON TABLE auth_refresh_tokens IS
    'Chi luu SHA-256 cua refresh token de co the thu hoi va xoay token an toan.';

COMMIT;
