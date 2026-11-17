-- Additional development camera for the four-camera dashboard.
-- No stream is started until an administrator configures a source.
BEGIN;
INSERT INTO cameras (id, device_id, name, slug, rtsp_url, is_enabled)
SELECT '22222222-2222-2222-2222-222222222224', id, 'Phòng làm việc', 'cam_study_room', '', FALSE
FROM devices WHERE id = '11111111-1111-1111-1111-111111111111'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO camera_sources (camera_id, source_type, status)
SELECT id, 'BROWSER_WEBCAM', 'NOT_CONFIGURED' FROM cameras
WHERE id = '22222222-2222-2222-2222-222222222224' AND slug = 'cam_study_room'
ON CONFLICT (camera_id) DO NOTHING;

INSERT INTO camera_frigate_settings (camera_id)
SELECT id FROM cameras WHERE id = '22222222-2222-2222-2222-222222222224' AND slug = 'cam_study_room'
ON CONFLICT (camera_id) DO NOTHING;
COMMIT;
