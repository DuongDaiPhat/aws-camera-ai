-- US-14: lưu callback, nguồn xác nhận và công việc sửa tin để phục hồi sau restart.
BEGIN;

ALTER TABLE confirmations ADD COLUMN source_update_id TEXT;
CREATE UNIQUE INDEX uq_confirmations_channel_update
    ON confirmations (channel, source_update_id) WHERE source_update_id IS NOT NULL;

ALTER TABLE notifications
    ADD COLUMN telegram_message_kind TEXT CHECK (telegram_message_kind IN ('PHOTO', 'TEXT')),
    ADD COLUMN telegram_message_text TEXT;

ALTER TABLE telegram_webhook_inbox
    DROP CONSTRAINT telegram_webhook_inbox_status,
    ADD CONSTRAINT telegram_webhook_inbox_status CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED')),
    ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN lease_token UUID,
    ADD COLUMN lease_until TIMESTAMPTZ,
    ADD COLUMN outcome TEXT,
    ADD COLUMN last_error TEXT;

CREATE TABLE telegram_message_edits (
    notification_id UUID PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_token UUID,
    lease_until TIMESTAMPTZ,
    last_error TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_telegram_edits_pending ON telegram_message_edits(available_at)
    WHERE status = 'PENDING';

COMMENT ON COLUMN confirmations.source_update_id IS
    'Telegram update_id: replay sau commit không tạo thêm xác nhận hoặc audit.';
COMMENT ON TABLE telegram_message_edits IS
    'Reconcile từ xác nhận INITIAL đã commit, gồm cả dashboard. Retry edit không gửi lại alert.';
COMMIT;
