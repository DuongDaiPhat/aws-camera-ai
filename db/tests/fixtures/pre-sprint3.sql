-- Frozen upgrade fixture for migrations before 0013.
-- This file must remain compatible with that schema as demo seeds evolve.
BEGIN;

INSERT INTO users (id, email, full_name, password_hash, role) VALUES
('91000000-0000-4000-8000-000000000001', 'upgrade-owner@example.test', 'Upgrade owner', 'test-only-hash', 'CAREGIVER'),
('91000000-0000-4000-8000-000000000002', 'upgrade-viewer@example.test', 'Upgrade viewer', 'test-only-hash', 'VIEWER');

INSERT INTO devices (id, owner_user_id, name) VALUES
('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Upgrade device');

INSERT INTO cameras (id, device_id, name, slug, rtsp_url) VALUES
('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Upgrade camera', 'upgrade_camera', 'rtsp://example.test/upgrade');

INSERT INTO camera_sources (camera_id, source_type, status) VALUES
('93000000-0000-4000-8000-000000000001', 'RTSP', 'OFFLINE');

INSERT INTO camera_frigate_settings (camera_id) VALUES
('93000000-0000-4000-8000-000000000001');

INSERT INTO events (id, camera_id, event_type, status, priority, source, detected_at)
SELECT
    ('94000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
    '93000000-0000-4000-8000-000000000001'::uuid,
    (ARRAY['FIRE_SMOKE_DETECTED', 'FALL_DETECTED', 'UNKNOWN_PERSON', 'RESTRICTED_ZONE', 'PERSON_DETECTED'])[(i - 1) % 5 + 1]::event_type,
    (ARRAY['DETECTED', 'NOTIFIED', 'ESCALATED', 'RESOLVED'])[(i - 1) / 5 + 1]::event_status,
    (ARRAY['P0', 'P1', 'P2', 'P2', 'P3'])[(i - 1) % 5 + 1]::priority_level,
    'FRIGATE',
    '2026-09-18T08:00:00Z'::timestamptz - i * interval '1 minute'
FROM generate_series(1, 20) AS series(i);

INSERT INTO event_media (event_id, media_type, storage_provider, bucket, object_key, content_type)
SELECT id, 'SNAPSHOT', 'MINIO', 'upgrade-test', 'events/' || id || '/snapshot.jpg', 'image/jpeg'
FROM events WHERE camera_id = '93000000-0000-4000-8000-000000000001';

COMMIT;
