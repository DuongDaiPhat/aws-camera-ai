-- =====================================================================
-- Migration 0024 — AWS Step Functions Deadline Escalation (US-13 / AWS-06)
--
-- 1. Bo sung cot `deadline_version` (>= 1) vao bang `events`, tach biet
--    hoan toan voi `events.version` va `events.aggregate_version` (G0 §4).
-- 2. Tao bang `deadline_command_receipts` luu ket qua ben vung theo
--    `command_id` cho idempotency va phat hien `COMMAND_CONFLICT`.
-- 3. Tao bang `deadline_workflow_dispatches` lam outbox/trang thai dieu
--    phoi Step Functions Standard (`execution_name = 'deadline-' || command_id`)
--    va doi soat (`reconcile`) doc lap voi local poller.
-- =====================================================================

BEGIN;

-- 1. Separate deadline version on events (G0 §4)
ALTER TABLE events
    ADD COLUMN IF NOT EXISTS deadline_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'events_deadline_version_duong'
    ) THEN
        ALTER TABLE events
            ADD CONSTRAINT events_deadline_version_duong
                CHECK (deadline_version >= 1);
    END IF;
END$$;

COMMENT ON COLUMN events.deadline_version IS
    'Tang doc lap moi khi lich/huy escalation_deadline_at; khong dung aggregate version lam deadlineVersion (G0 §4).';

-- 2. Durable idempotency receipts for POST /api/v1/internal/events/{eventId}/deadline
CREATE TABLE deadline_command_receipts (
    command_id           UUID        PRIMARY KEY,
    event_id             UUID        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    deadline_version     INTEGER     NOT NULL CHECK (deadline_version >= 1),
    expected_deadline_at TIMESTAMPTZ NOT NULL,
    payload_hash         CHAR(64)    NOT NULL,
    payload              JSONB       NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    disposition          TEXT        NOT NULL CHECK (disposition IN ('APPLIED', 'NO_OP')),
    reason               TEXT        NOT NULL CHECK (
        (disposition = 'APPLIED' AND reason = 'ESCALATED') OR
        (disposition = 'NO_OP' AND reason IN ('ACKNOWLEDGED', 'RESOLVED', 'STALE_DEADLINE', 'ALREADY_APPLIED'))
    ),
    aggregate_version    INTEGER     NOT NULL CHECK (aggregate_version >= 1),
    notification_id      UUID        REFERENCES notifications (id) ON DELETE SET NULL,
    processed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deadline_command_receipts_event
    ON deadline_command_receipts (event_id, processed_at DESC);

COMMENT ON TABLE deadline_command_receipts IS
    'US-13 / AWS-06 durable receipt theo command_id cho endpoint deadline noi bo; replay tra ket qua da luu, khac payload tra 409 COMMAND_CONFLICT.';

-- 3. Durable workflow dispatch outbox and reconciliation ledger for Step Functions
CREATE TABLE deadline_workflow_dispatches (
    command_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id             UUID        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    deadline_version     INTEGER     NOT NULL CHECK (deadline_version >= 1),
    expected_deadline_at TIMESTAMPTZ NOT NULL,
    execution_name       TEXT        NOT NULL UNIQUE,
    state_machine_arn    TEXT        NOT NULL,
    execution_arn        TEXT,
    status               TEXT        NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'STARTED', 'COMPLETED', 'FAILED', 'CANCELLED')),
    attempts             INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error           TEXT,
    started_at           TIMESTAMPTZ,
    reconciled_at        TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_deadline_workflow_dispatches_event_version
        UNIQUE (event_id, deadline_version),
    CONSTRAINT ck_deadline_workflow_dispatches_execution_name
        CHECK (execution_name = 'deadline-' || command_id::text)
);

CREATE INDEX idx_deadline_workflow_dispatches_pending
    ON deadline_workflow_dispatches (available_at, created_at)
    WHERE status = 'PENDING';

CREATE INDEX idx_deadline_workflow_dispatches_started
    ON deadline_workflow_dispatches (expected_deadline_at)
    WHERE status = 'STARTED';

CREATE INDEX idx_deadline_workflow_dispatches_event
    ON deadline_workflow_dispatches (event_id, deadline_version DESC);

CREATE TRIGGER trg_deadline_workflow_dispatches_updated_at
    BEFORE UPDATE ON deadline_workflow_dispatches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE deadline_workflow_dispatches IS
    'US-13 / AWS-06 outbox ben vung cho Step Functions StartExecution (name=deadline-<commandId>) va doi soat DescribeExecution.';

COMMIT;
