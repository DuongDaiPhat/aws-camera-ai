-- =====================================================================
-- Migration 0005: Quan ly nguon phat camera va cau hinh dong bo Frigate
-- Slice: CAM (Thanh vien A)
-- Tham chieu: docs/Plan Giao dien Camera.md & docs/PLAN_CAM_CAMERA_MANAGEMENT_EXECUTION.md
-- =====================================================================

BEGIN;

CREATE TYPE camera_source_type_enum AS ENUM ('RTSP', 'BROWSER_WEBCAM', 'VIDEO_FILE');
CREATE TYPE camera_source_status_enum AS ENUM ('NOT_CONFIGURED', 'STARTING', 'ONLINE', 'OFFLINE', 'FAILED', 'STOPPED');
CREATE TYPE camera_transport_enum AS ENUM ('TCP', 'UDP');
CREATE TYPE frigate_sync_status_enum AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- 1. Tao bang camera_sources
CREATE TABLE camera_sources (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id             UUID NOT NULL UNIQUE REFERENCES cameras (id) ON DELETE CASCADE,
    source_type           camera_source_type_enum NOT NULL DEFAULT 'RTSP',
    rtsp_url              TEXT NULL,
    video_object_key      TEXT NULL,
    video_original_name   TEXT NULL,
    video_loop            BOOLEAN NOT NULL DEFAULT TRUE,
    transport             camera_transport_enum NOT NULL DEFAULT 'TCP',
    input_format          TEXT NULL,
    webcam_device_label   TEXT NULL,
    status                camera_source_status_enum NOT NULL DEFAULT 'NOT_CONFIGURED',
    last_error_code       TEXT NULL,
    last_error_message    TEXT NULL,
    process_id            TEXT NULL,
    started_at            TIMESTAMPTZ NULL,
    stopped_at            TIMESTAMPTZ NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_camera_sources_updated_at BEFORE UPDATE ON camera_sources
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE camera_sources IS
    'Chi tiet nguon phat (RTSP camera that, browser webcam hoac video test luan phien) cua tung camera.';
COMMENT ON COLUMN camera_sources.rtsp_url IS
    'Chua credential RTSP. Khong tra URL day du trong response/log; ADMIN chi nhan gia tri da che khi doc (NFR-09).';


-- 2. Tao bang camera_frigate_settings
CREATE TABLE camera_frigate_settings (
    camera_id                UUID PRIMARY KEY REFERENCES cameras (id) ON DELETE CASCADE,
    detect_width             INTEGER NOT NULL DEFAULT 1280 CHECK (detect_width > 0),
    detect_height            INTEGER NOT NULL DEFAULT 720 CHECK (detect_height > 0),
    detect_fps               SMALLINT NOT NULL DEFAULT 5 CHECK (detect_fps BETWEEN 1 AND 30),
    min_initialized_frames   INTEGER NOT NULL DEFAULT 5 CHECK (min_initialized_frames > 0),
    max_disappeared_frames   INTEGER NOT NULL DEFAULT 25 CHECK (max_disappeared_frames > 0),
    person_min_score         NUMERIC(4,3) NOT NULL DEFAULT 0.500 CHECK (person_min_score BETWEEN 0 AND 1),
    person_threshold         NUMERIC(4,3) NOT NULL DEFAULT 0.700 CHECK (person_threshold BETWEEN 0 AND 1),
    person_min_area          INTEGER NOT NULL DEFAULT 1500 CHECK (person_min_area >= 0),
    snapshots_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    snapshot_bounding_box    BOOLEAN NOT NULL DEFAULT TRUE,
    recording_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    detection_retention_days SMALLINT NOT NULL DEFAULT 7 CHECK (detection_retention_days >= 0),
    config_version           INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1),
    applied_version          INTEGER NOT NULL DEFAULT 0 CHECK (applied_version BETWEEN 0 AND config_version),
    sync_status              frigate_sync_status_enum NOT NULL DEFAULT 'PENDING',
    sync_error_code          TEXT NULL,
    sync_error_message       TEXT NULL,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT camera_frigate_settings_synced_version_khop_trang_thai
        CHECK (sync_status <> 'SYNCED' OR applied_version = config_version)
);

CREATE TRIGGER trg_camera_frigate_settings_updated_at BEFORE UPDATE ON camera_frigate_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE camera_frigate_settings IS
    'Cau hinh chi tiet detect, snapshot va trang thai dong bo xuong Frigate cua tung camera.';


-- 3. Khoi tao du lieu ban dau tu bang cameras hien co (idempotent)
INSERT INTO camera_sources (camera_id, source_type, rtsp_url, status)
SELECT 
    id, 
    'RTSP', 
    rtsp_url, 
    'OFFLINE'
FROM cameras
ON CONFLICT (camera_id) DO NOTHING;

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
ON CONFLICT (camera_id) DO NOTHING;

COMMIT;
