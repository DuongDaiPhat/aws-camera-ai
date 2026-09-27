-- =====================================================================
-- Migration 0002 — Gia tri mac dinh cho escalation_rules
--
-- FR-ADM-04: "He thong phai co gia tri mac dinh cho moi tham so cau hinh".
-- Day la DU LIEU HE THONG (khong phai seed demo) nen nam trong migration,
-- de moi moi truong — dev, CI, AWS — deu co san khi khoi tao.
--
-- Nguon so lieu: bang mac dinh trong US-15 cua
-- docs/Roadmap_Backlog_UserStory_FR_CameraAI.md
-- =====================================================================

BEGIN;

INSERT INTO escalation_rules
    (event_type, priority, t_low, t_high, t_wait_seconds, skip_logged_only, notify_channels, escalate_channels)
VALUES
    -- US-19: chay/khoi bo qua bac LOGGED_ONLY, vao thang NOTIFIED bat ke confidence
    ('FIRE_SMOKE_DETECTED', 'P0', 0.500, 0.700,  30, TRUE,
     '["TELEGRAM", "SNS_SMS"]'::jsonb, '["CONNECT_CALL", "SNS_SMS"]'::jsonb),

    ('FALL_DETECTED',       'P1', 0.550, 0.750,  60, FALSE,
     '["TELEGRAM"]'::jsonb,            '["CONNECT_CALL"]'::jsonb),

    ('RESTRICTED_ZONE',     'P1', 0.600, 0.800,  60, FALSE,
     '["TELEGRAM"]'::jsonb,            '["CONNECT_CALL"]'::jsonb),

    ('UNKNOWN_PERSON',      'P2', 0.600, 0.800, 120, FALSE,
     '["TELEGRAM"]'::jsonb,            '["CONNECT_CALL"]'::jsonb),

    -- Wellness khong co confidence (thuan logic scheduler) -> t_low/t_high NULL
    ('WELLNESS_TIMEOUT',    'P2', NULL,  NULL,  300, TRUE,
     '["TELEGRAM"]'::jsonb,            '["TELEGRAM"]'::jsonb),

    -- Person detected cua Sprint 1: chi ghi log, khong bao gio lam phien ai
    ('PERSON_DETECTED',     'P3', NULL,  NULL,    0, FALSE,
     '[]'::jsonb,                      '[]'::jsonb)
ON CONFLICT (event_type) DO NOTHING;

COMMIT;
