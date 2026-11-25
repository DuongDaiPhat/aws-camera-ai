-- =====================================================================
-- Migration 0027 — Cấu hình bật/tắt các module AI theo hộ gia đình
-- Caregiver quản lý bật/tắt M1, M2a, M3, M4, M5 cho hộ của mình.
-- =====================================================================

BEGIN;

CREATE TABLE household_ai_module_settings (
  owner_user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  m1_face_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  m2a_fall_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  m3_fire_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  m4_zone_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  m5_wellness_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE household_ai_module_settings IS
  'Cài đặt bật/tắt từng module AI (M1..M5) cấp hộ gia đình do Caregiver quản lý.';

COMMIT;
