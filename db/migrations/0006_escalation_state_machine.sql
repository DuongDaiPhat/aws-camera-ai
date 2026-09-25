-- =====================================================================
-- Migration 0006 — Escalation state machine (US-13)
--
-- 1. Tao ENUM confirmation_phase ('INITIAL', 'EMERGENCY')
-- 2. Bo sung cot 'phase' vao bang confirmations va cap nhat unique index
--    cho phep 2 pha doc lap (INITIAL cho IM_OK/NEED_HELP, EMERGENCY cho ACKNOWLEDGED/CLOSE)
-- 3. Bo sung cot 'version', 'rule_snapshot', 'triggering_results' vao bang events
-- 4. Bo sung partial index cho worker quet deadline va phuc hoi sau restart
-- =====================================================================

BEGIN;

-- 1. Confirmation phase enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'confirmation_phase') THEN
        CREATE TYPE confirmation_phase AS ENUM ('INITIAL', 'EMERGENCY');
    END IF;
END$$;

-- 2. Bo sung cot phase vao bang confirmations
ALTER TABLE confirmations
    ADD COLUMN IF NOT EXISTS phase confirmation_phase NOT NULL DEFAULT 'INITIAL';

-- Cap nhat unique index de phan biet lan authoritative dau tien theo tung phase
DROP INDEX IF EXISTS uq_confirmations_lan_dau_tien;
CREATE UNIQUE INDEX IF NOT EXISTS uq_confirmations_event_phase_authoritative
    ON confirmations (event_id, phase)
    WHERE is_authoritative = TRUE;

-- 3. Bo sung version va metadata vao bang events
ALTER TABLE events
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS rule_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS triggering_results JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 4. Partial index cho worker phuc hoi deadline sau restart (FR-ESC-07)
CREATE INDEX IF NOT EXISTS idx_events_dang_cho_escalate_recovery
    ON events (escalation_deadline_at, priority)
    WHERE status = 'NOTIFIED' AND escalation_deadline_at IS NOT NULL;

COMMIT;
