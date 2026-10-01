-- US-14: durable Telegram delivery without changing the defaults of other channels.
BEGIN;

ALTER TABLE users
    ADD COLUMN telegram_user_id TEXT,
    ADD COLUMN telegram_linked_at TIMESTAMPTZ,
    ADD CONSTRAINT users_telegram_link_verified
        CHECK ((telegram_user_id IS NULL AND telegram_linked_at IS NULL) OR
               (telegram_user_id IS NOT NULL AND telegram_chat_id IS NOT NULL AND telegram_linked_at IS NOT NULL));

CREATE UNIQUE INDEX uq_users_telegram_user_id
    ON users (telegram_user_id) WHERE telegram_user_id IS NOT NULL;

CREATE TABLE telegram_link_requests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_telegram_link_requests_user ON telegram_link_requests (user_id, created_at DESC);

CREATE TABLE telegram_webhook_inbox (
    update_id     BIGINT PRIMARY KEY,
    update_body   JSONB NOT NULL,
    status        TEXT NOT NULL DEFAULT 'PENDING',
    processed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT telegram_webhook_inbox_status CHECK (status IN ('PENDING', 'PROCESSED'))
);
CREATE INDEX idx_telegram_webhook_inbox_pending ON telegram_webhook_inbox (created_at)
    WHERE status = 'PENDING';
CREATE UNIQUE INDEX uq_telegram_webhook_callback_id
    ON telegram_webhook_inbox ((update_body ->> 'callbackId'))
    WHERE update_body ? 'callbackId';

ALTER TABLE notifications
    ADD COLUMN provider_chat_id TEXT,
    ADD COLUMN lease_token UUID,
    ADD COLUMN lease_until TIMESTAMPTZ;

CREATE INDEX idx_notifications_telegram_ready
    ON notifications (next_retry_at, created_at)
    WHERE channel = 'TELEGRAM' AND status IN ('PENDING', 'FAILED');

COMMENT ON COLUMN users.telegram_user_id IS
    'Telegram from.id of a server-verified link; username and chat ID do not prove actor identity.';
COMMENT ON COLUMN users.telegram_linked_at IS
    'Set only after verified one-time account linking.';
COMMENT ON TABLE telegram_webhook_inbox IS
    'Telegram update_id dedup before ACK; callback processing waits for US-13 confirmation port.';
COMMENT ON COLUMN notifications.provider_chat_id IS
    'Telegram chat ID paired with provider_message_id; message IDs are only unique within a chat.';
COMMENT ON COLUMN notifications.lease_until IS
    'Expired leases are reclaimed after worker restart; HTTP calls never hold a DB lock.';

COMMIT;
