BEGIN;

-- =====================================================================
-- Seed 0002: Cau hinh nguon phat va Frigate settings cho cac camera demo
-- Slice: CAM (Thanh vien A)
-- Trang thai khoi tao phan anh chua xac nhan runtime/config tren Frigate.
-- =====================================================================

-- 1. Tao nguon phat camera_sources cho 3 camera demo
INSERT INTO camera_sources (camera_id, source_type, rtsp_url, status)
SELECT id, 'RTSP', rtsp_url, 'OFFLINE'
FROM cameras
WHERE slug IN ('cam_living_room', 'cam_test', 'cam_kitchen')
ON CONFLICT (camera_id) DO NOTHING;

-- 2. Tao cau hinh camera_frigate_settings mac dinh cho 3 camera demo
INSERT INTO camera_frigate_settings (
    camera_id,
    detect_width,
    detect_height,
    detect_fps,
    detection_retention_days,
    config_version,
    applied_version,
    sync_status
)
SELECT
    id,
    detect_width,
    detect_height,
    fps,
    retention_days,
    1,
    0,
    'PENDING'
FROM cameras
WHERE slug IN ('cam_living_room', 'cam_test', 'cam_kitchen')
ON CONFLICT (camera_id) DO NOTHING;

COMMIT;
