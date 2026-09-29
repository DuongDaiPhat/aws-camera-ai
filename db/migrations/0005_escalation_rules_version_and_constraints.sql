-- =====================================================================
-- Migration 0005 — Bo sung version va rang buoc cho escalation_rules
--
-- US-15: Cau hinh nguong tin cay va thoi gian cho theo loai su kien
--   - version: ho tro optimistic concurrency control khi 2 admin cung sua
--   - Rang buoc cap nguong: (t_low IS NULL) = (t_high IS NULL)
--   - Rang buoc thoi gian cho: 0 <= t_wait_seconds <= 3600
-- =====================================================================

BEGIN;

-- 1. Cot version cho optimistic locking
ALTER TABLE escalation_rules
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'escalation_rules_version_duong'
    ) THEN
        ALTER TABLE escalation_rules
            ADD CONSTRAINT escalation_rules_version_duong
                CHECK (version > 0);
    END IF;
END $$;

-- 2. Cap nguong phai cung NULL hoac cung NOT NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'escalation_rules_cap_nguong_dong_nhat'
    ) THEN
        ALTER TABLE escalation_rules
            ADD CONSTRAINT escalation_rules_cap_nguong_dong_nhat
                CHECK ((t_low IS NULL) = (t_high IS NULL));
    END IF;
END $$;

-- 3. Cap nhat gioi han thoi gian cho toi da 3600 giay (1 gio)
ALTER TABLE escalation_rules
    DROP CONSTRAINT IF EXISTS escalation_rules_t_wait_duong;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'escalation_rules_t_wait_seconds_hop_le'
    ) THEN
        ALTER TABLE escalation_rules
            ADD CONSTRAINT escalation_rules_t_wait_seconds_hop_le
                CHECK (t_wait_seconds >= 0 AND t_wait_seconds <= 3600);
    END IF;
END $$;

COMMIT;
