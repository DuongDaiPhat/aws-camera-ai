-- =====================================================================
-- Migration 0009 - US-11: durable AI result inbox and aggregate outbox
-- =====================================================================

BEGIN;

ALTER TABLE events
    ADD COLUMN detection_confidence NUMERIC(4, 3),
    ADD COLUMN aggregate_version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE events
    ADD CONSTRAINT events_detection_confidence_trong_khoang_0_1
        CHECK (detection_confidence IS NULL OR detection_confidence BETWEEN 0 AND 1),
    ADD CONSTRAINT events_aggregate_version_khong_am
        CHECK (aggregate_version >= 0);

-- Truoc US-11, `confidence` dang chua score phat hien cua Frigate. Tach score nay
-- ra khoi projection AI de khong ghep score cua hai nguon khac nghia.
UPDATE events
SET detection_confidence = confidence,
    confidence = NULL
WHERE ai_label IS NULL;

CREATE TABLE event_ai_result_receipts (
    result_id       UUID PRIMARY KEY,
    event_id        UUID        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    request_id      UUID,
    module          TEXT        NOT NULL,
    observation_id  TEXT        NOT NULL,
    revision        INTEGER     NOT NULL,
    payload_hash    CHAR(64)    NOT NULL,
    payload         JSONB       NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'PENDING',
    ignored_reason  TEXT,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,

    CONSTRAINT event_ai_receipts_revision_duong CHECK (revision >= 1),
    CONSTRAINT event_ai_receipts_payload_la_object CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT event_ai_receipts_status_hop_le
        CHECK (status IN ('PENDING', 'PROCESSED', 'IGNORED')),
    CONSTRAINT event_ai_receipts_ignored_co_ly_do CHECK (
        (status = 'IGNORED' AND ignored_reason IS NOT NULL) OR
        (status <> 'IGNORED' AND ignored_reason IS NULL)
    )
);

CREATE INDEX idx_event_ai_receipts_event_received
    ON event_ai_result_receipts (event_id, received_at DESC);
CREATE INDEX idx_event_ai_receipts_latest_revision
    ON event_ai_result_receipts (event_id, module, observation_id, revision DESC);

CREATE TABLE outbox_messages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id          UUID        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    aggregate_version BIGINT      NOT NULL,
    message_type      TEXT        NOT NULL,
    payload           JSONB       NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'PENDING',
    attempt_count     INTEGER     NOT NULL DEFAULT 0,
    available_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    leased_until      TIMESTAMPTZ,
    processed_at      TIMESTAMPTZ,
    last_error        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT outbox_messages_version_khong_am CHECK (aggregate_version >= 0),
    CONSTRAINT outbox_messages_payload_la_object CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT outbox_messages_attempt_khong_am CHECK (attempt_count >= 0),
    CONSTRAINT outbox_messages_status_hop_le
        CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED')),
    CONSTRAINT outbox_messages_mot_lan UNIQUE (event_id, aggregate_version, message_type)
);

CREATE INDEX idx_outbox_messages_pending
    ON outbox_messages (available_at, created_at)
    WHERE status = 'PENDING';

COMMENT ON TABLE event_ai_result_receipts IS
    'US-11 durable inbox. Giu payload da validate de dedup, audit va replay; retention di theo event.';
COMMENT ON COLUMN events.detection_confidence IS
    'Score quan sat nguoi tu Frigate; khong duoc dung thay confidence cua nhan AI dai dien.';
COMMENT ON COLUMN events.aggregate_version IS
    'Tang sau moi AI result duoc ap dung; dung dedup SSE va handoff escalation.';
COMMENT ON TABLE outbox_messages IS
    'Shared transactional outbox cho event.updated va evaluate-escalation; US-13 tai su dung.';

COMMIT;
