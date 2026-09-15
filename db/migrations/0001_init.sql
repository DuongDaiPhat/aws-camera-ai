-- =====================================================================
-- Migration 0001 — Schema khoi tao
-- Tai lieu giai thich tung bang: docs/database/ERD.md
--
-- QUY TAC: moi thay doi schema = MOT file migration moi (0002_..., 0003_...).
-- KHONG BAO GIO sua file migration da merge vao main.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- email khong phan biet hoa/thuong

-- ---------------------------------------------------------------------
-- ENUM types
-- Phai khop 1-1 voi packages/contracts/src/enums.ts va api/openapi.yaml
-- ---------------------------------------------------------------------
CREATE TYPE user_role             AS ENUM ('ADMIN', 'CAREGIVER', 'VIEWER');
CREATE TYPE device_type           AS ENUM ('EDGE_GATEWAY', 'NVR', 'STANDALONE_CAM');
CREATE TYPE device_status         AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'DISABLED');
CREATE TYPE zone_type             AS ENUM ('RESTRICTED', 'REST_AREA', 'NORMAL');
CREATE TYPE face_provider         AS ENUM ('LOCAL', 'REKOGNITION');
CREATE TYPE event_type            AS ENUM (
    'PERSON_DETECTED', 'UNKNOWN_PERSON', 'RESTRICTED_ZONE',
    'FALL_DETECTED', 'FIRE_SMOKE_DETECTED', 'WELLNESS_TIMEOUT'
);
CREATE TYPE event_status          AS ENUM (
    'DETECTED', 'LOGGED_ONLY', 'NOTIFIED', 'ESCALATED',
    'RESOLVED', 'CLOSED', 'AI_FAILED'
);
CREATE TYPE priority_level        AS ENUM ('P0', 'P1', 'P2', 'P3');
CREATE TYPE event_source          AS ENUM ('FRIGATE', 'AI_SERVICE', 'SCHEDULER', 'MANUAL');
CREATE TYPE person_status         AS ENUM ('KNOWN', 'UNKNOWN', 'UNDETERMINED');
CREATE TYPE media_type            AS ENUM ('SNAPSHOT', 'CLIP', 'THUMBNAIL');
CREATE TYPE storage_provider      AS ENUM ('MINIO', 'S3');
CREATE TYPE notification_channel  AS ENUM (
    'TELEGRAM', 'SNS_EMAIL', 'SNS_SMS', 'CONNECT_CALL', 'DASHBOARD', 'WEBHOOK'
);
CREATE TYPE notification_status   AS ENUM ('PENDING', 'SENT', 'FAILED', 'CONFIRMED', 'SKIPPED');
CREATE TYPE confirmation_response AS ENUM ('IM_OK', 'NEED_HELP', 'ACKNOWLEDGED');
CREATE TYPE actor_type            AS ENUM ('SYSTEM', 'USER', 'SCHEDULER', 'EMERGENCY_CONTACT');

-- ---------------------------------------------------------------------
-- Trigger dung chung: tu cap nhat updated_at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $fn$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;


-- =====================================================================
-- 1. users — FR-AUT-01..07
-- =====================================================================
CREATE TABLE users (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email              CITEXT      NOT NULL UNIQUE,
    password_hash      TEXT,                    -- NULL khi dung Cognito (US-25)
    cognito_sub        TEXT UNIQUE,             -- anh xa sang Cognito User Pool
    full_name          TEXT        NOT NULL,
    role               user_role   NOT NULL DEFAULT 'VIEWER',
    phone_e164         TEXT,
    telegram_chat_id   TEXT,
    is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
    failed_login_count SMALLINT    NOT NULL DEFAULT 0,
    locked_until       TIMESTAMPTZ,             -- FR-AUT-03: khoa 15 phut sau 5 lan sai
    last_login_at      TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT users_phone_e164_format
        CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT users_co_it_nhat_mot_cach_dang_nhap
        CHECK (password_hash IS NOT NULL OR cognito_sub IS NOT NULL)
);
CREATE INDEX idx_users_role ON users (role) WHERE is_active;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN users.password_hash    IS 'bcrypt/argon2. FR-AUT-04: tuyet doi khong luu plaintext.';
COMMENT ON COLUMN users.telegram_chat_id IS 'Chat ID de bot gui canh bao (US-14).';


-- =====================================================================
-- 2. devices — thiet bi vat ly chua camera (edge box / NVR)
-- =====================================================================
CREATE TABLE devices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id     UUID          NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    name              TEXT          NOT NULL,
    device_type       device_type   NOT NULL DEFAULT 'EDGE_GATEWAY',
    serial_number     TEXT UNIQUE,
    location_label    TEXT,                     -- 'Nha bac Hoa - tang 1'
    status            device_status NOT NULL DEFAULT 'OFFLINE',
    agent_version     TEXT,
    last_heartbeat_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_devices_owner  ON devices (owner_user_id);
CREATE INDEX idx_devices_status ON devices (status);
CREATE TRIGGER trg_devices_updated_at BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 3. cameras — FR-DEV-01
-- =====================================================================
CREATE TABLE cameras (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id         UUID        NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    name              TEXT        NOT NULL,              -- 'Phong khach'
    slug              TEXT        NOT NULL UNIQUE,       -- 'cam_living_room' = camera key trong Frigate
    rtsp_url          TEXT        NOT NULL,
    detect_width      INTEGER     NOT NULL DEFAULT 1280,
    detect_height     INTEGER     NOT NULL DEFAULT 720,
    fps               SMALLINT    NOT NULL DEFAULT 5,
    timezone          TEXT        NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    is_enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    detection_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
    retention_days    SMALLINT    NOT NULL DEFAULT 7,    -- FR-DAT-01
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT cameras_slug_format CHECK (slug ~ '^[a-z][a-z0-9_]{2,63}$'),
    CONSTRAINT cameras_fps_hop_le  CHECK (fps BETWEEN 1 AND 30)
);
CREATE INDEX idx_cameras_device ON cameras (device_id);
CREATE TRIGGER trg_cameras_updated_at BEFORE UPDATE ON cameras
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN cameras.slug IS
    'Khoa noi giua DB va Frigate. MQTT payload tra ve slug nay o truong "camera".';
COMMENT ON COLUMN cameras.rtsp_url IS
    'Chua credential — KHONG bao gio tra ve qua API cho role khac ADMIN (NFR-09).';


-- =====================================================================
-- 4. zones — FR-DEV-02..04
-- =====================================================================
CREATE TABLE zones (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id         UUID        NOT NULL REFERENCES cameras (id) ON DELETE CASCADE,
    name              TEXT        NOT NULL,      -- 'Bep'
    slug              TEXT        NOT NULL,      -- 'restricted_stove' = zone key trong Frigate
    zone_type         zone_type   NOT NULL DEFAULT 'NORMAL',
    polygon           JSONB       NOT NULL,      -- [[x,y],...] toa do CHUAN HOA 0..1
    min_dwell_seconds SMALLINT    NOT NULL DEFAULT 2,  -- FR-DET-M4-02: bo qua di luot qua
    active_from       TIME,                            -- NULL = 24/7
    active_to         TIME,
    is_enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT zones_ten_duy_nhat_trong_camera  UNIQUE (camera_id, name),
    CONSTRAINT zones_slug_duy_nhat_trong_camera UNIQUE (camera_id, slug),
    -- jsonb_array_length() NEM LOI neu polygon khong phai mang, nen phai kiem tra
    -- jsonb_typeof TRUOC — de thong diep loi la "vi pham rang buoc" thay vi loi ham.
    CONSTRAINT zones_polygon_it_nhat_3_dinh
        CHECK (jsonb_typeof(polygon) = 'array' AND jsonb_array_length(polygon) >= 3),
    CONSTRAINT zones_lich_day_du CHECK (
        (active_from IS NULL     AND active_to IS NULL) OR
        (active_from IS NOT NULL AND active_to IS NOT NULL)
    )
);
CREATE INDEX idx_zones_camera ON zones (camera_id);
CREATE INDEX idx_zones_type   ON zones (zone_type) WHERE is_enabled;
CREATE TRIGGER trg_zones_updated_at BEFORE UPDATE ON zones
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN zones.polygon IS
    'Toa do chuan hoa 0..1 de doc lap do phan giai. Orchestrator quy doi sang pixel khi sinh config Frigate (US-12).';
COMMENT ON COLUMN zones.zone_type IS
    'REST_AREA = giuong/sofa: KHONG sinh canh bao te nga trong vung nay (FR-DET-M2-05).';


-- =====================================================================
-- 5. known_faces — FR-DEV-05..08
-- =====================================================================
CREATE TABLE known_faces (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id             UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    linked_user_id            UUID          REFERENCES users (id) ON DELETE SET NULL,
    person_name               TEXT          NOT NULL,
    relationship              TEXT,                         -- 'Me', 'Con trai'
    provider                  face_provider NOT NULL DEFAULT 'LOCAL',
    embedding                 BYTEA,                        -- float32[N] packed — provider = LOCAL
    embedding_dim             SMALLINT,
    rekognition_face_id       TEXT,                         -- provider = REKOGNITION (US-24)
    rekognition_collection_id TEXT,
    model_version             TEXT          NOT NULL DEFAULT 'unknown',
    source_image_count        SMALLINT      NOT NULL DEFAULT 1,
    is_active                 BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT known_faces_ten_duy_nhat   UNIQUE (owner_user_id, person_name),
    CONSTRAINT known_faces_so_anh_hop_le  CHECK (source_image_count BETWEEN 1 AND 5),
    CONSTRAINT known_faces_co_du_lieu_sinh_trac CHECK (
        (provider = 'LOCAL'       AND embedding IS NOT NULL AND embedding_dim IS NOT NULL) OR
        (provider = 'REKOGNITION' AND rekognition_face_id IS NOT NULL)
    )
);
CREATE INDEX idx_known_faces_owner ON known_faces (owner_user_id) WHERE is_active;
CREATE INDEX idx_known_faces_rek   ON known_faces (rekognition_face_id)
    WHERE rekognition_face_id IS NOT NULL;
CREATE TRIGGER trg_known_faces_updated_at BEFORE UPDATE ON known_faces
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE known_faces IS
    'FR-DEV-08: chi luu embedding, KHONG luu anh goc. FR-DEV-07: xoa la DELETE that, khong soft-delete.';


-- =====================================================================
-- 6. escalation_rules — FR-ESC-05, US-15
--    Tao TRUOC events: day la nguon cua priority va deadline cho su kien.
-- =====================================================================
CREATE TABLE escalation_rules (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type           event_type     NOT NULL UNIQUE,
    priority             priority_level NOT NULL,
    t_low                NUMERIC(4, 3),          -- duoi nguong nay -> LOGGED_ONLY
    t_high               NUMERIC(4, 3),          -- tu nguong nay -> NOTIFIED + hen gio ngan
    t_wait_seconds       INTEGER        NOT NULL,
    skip_logged_only     BOOLEAN        NOT NULL DEFAULT FALSE,  -- US-19: chay/khoi vao thang NOTIFIED
    notify_channels      JSONB          NOT NULL DEFAULT '["TELEGRAM"]'::jsonb,
    escalate_channels    JSONB          NOT NULL DEFAULT '["CONNECT_CALL"]'::jsonb,
    max_escalation_level SMALLINT       NOT NULL DEFAULT 3,      -- FR-NOT-09: toi da 3 lien he
    is_enabled           BOOLEAN        NOT NULL DEFAULT TRUE,
    updated_by_user_id   UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),

    -- FR-ADM-03: chan cau hinh vo nghia ngay o tang DB, khong doi API validate
    CONSTRAINT escalation_rules_t_low_khong_lon_hon_t_high
        CHECK (t_low IS NULL OR t_high IS NULL OR t_low <= t_high),
    CONSTRAINT escalation_rules_nguong_trong_khoang_0_1 CHECK (
        (t_low  IS NULL OR t_low  BETWEEN 0 AND 1) AND
        (t_high IS NULL OR t_high BETWEEN 0 AND 1)
    ),
    CONSTRAINT escalation_rules_t_wait_duong CHECK (t_wait_seconds >= 0)
);
CREATE TRIGGER trg_escalation_rules_updated_at BEFORE UPDATE ON escalation_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 7. events — FR-EVT-01..07. Trai tim cua he thong.
-- =====================================================================
CREATE TABLE events (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id              UUID           REFERENCES cameras (id) ON DELETE SET NULL,
    zone_id                UUID           REFERENCES zones (id)   ON DELETE SET NULL,
    event_type             event_type     NOT NULL,
    status                 event_status   NOT NULL DEFAULT 'DETECTED',
    priority               priority_level NOT NULL DEFAULT 'P3',
    source                 event_source   NOT NULL DEFAULT 'FRIGATE',

    -- Khu trung lap (FR-ING-07). App tinh:
    --   dedup_key = '<camera_slug>:<track_id>:<event_type>:<floor(epoch_seconds / 10)>'
    track_id               TEXT,
    dedup_key              TEXT,

    -- Ket qua AI (FR-EVT-02/03/04)
    confidence             NUMERIC(4, 3),
    ai_label               TEXT,
    ai_model_version       TEXT,
    ai_results             JSONB          NOT NULL DEFAULT '[]'::jsonb,
    person_status          person_status,
    matched_known_face_id  UUID           REFERENCES known_faces (id) ON DELETE SET NULL,

    is_false_alarm         BOOLEAN        NOT NULL DEFAULT FALSE,  -- FR-EVT-06, nguon do FAR (US-22)
    retain                 BOOLEAN        NOT NULL DEFAULT FALSE,  -- FR-DAT-02
    correlation_id         UUID           NOT NULL DEFAULT gen_random_uuid(),  -- FR-LOG-02

    detected_at            TIMESTAMPTZ    NOT NULL,
    ai_processed_at        TIMESTAMPTZ,
    notified_at            TIMESTAMPTZ,
    escalation_deadline_at TIMESTAMPTZ,   -- FR-ESC-07: khoi phuc hen gio sau restart
    escalated_at           TIMESTAMPTZ,
    resolved_at            TIMESTAMPTZ,
    closed_at              TIMESTAMPTZ,
    created_at             TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ    NOT NULL DEFAULT now(),

    CONSTRAINT events_confidence_trong_khoang_0_1
        CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    CONSTRAINT events_ai_results_la_mang CHECK (jsonb_typeof(ai_results) = 'array')
);

-- FR-ING-07: chi mot su kien cho moi dedup_key
CREATE UNIQUE INDEX uq_events_dedup_key ON events (dedup_key) WHERE dedup_key IS NOT NULL;

-- Truy van nong cua dashboard (US-06, US-21)
CREATE INDEX idx_events_detected_at_desc ON events (detected_at DESC);
CREATE INDEX idx_events_camera_detected  ON events (camera_id, detected_at DESC);
CREATE INDEX idx_events_type_detected    ON events (event_type, detected_at DESC);
CREATE INDEX idx_events_status           ON events (status);
CREATE INDEX idx_events_correlation      ON events (correlation_id);
CREATE INDEX idx_events_ai_results_gin   ON events USING GIN (ai_results);

-- FR-ESC-07: query khoi phuc timer sau restart chi quet dung cac su kien dang cho
CREATE INDEX idx_events_dang_cho_escalate ON events (escalation_deadline_at)
    WHERE status = 'NOTIFIED' AND escalation_deadline_at IS NOT NULL;

CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN events.ai_results IS
    'FR-EVT-04: giu DU chi tiet tung nhan, vi du [{"module":"M1","label":"UNKNOWN","confidence":0.82}]. Cot priority chi giu muc cao nhat.';
COMMENT ON COLUMN events.detected_at IS
    'Thoi diem su kien XAY RA (tu Frigate), khong phai luc ghi DB. Dung de do NFR-01/NFR-02.';


-- =====================================================================
-- 8. event_media — FR-ING-05/06, FR-EVT-07, FR-DAT-01
-- =====================================================================
CREATE TABLE event_media (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id         UUID             NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    media_type       media_type       NOT NULL,
    storage_provider storage_provider NOT NULL DEFAULT 'MINIO',
    bucket           TEXT             NOT NULL,
    object_key       TEXT             NOT NULL,  -- events/{yyyy}/{mm}/{dd}/{event_id}/{type}.{ext}
    content_type     TEXT             NOT NULL,
    size_bytes       BIGINT,
    width            INTEGER,
    height           INTEGER,
    duration_ms      INTEGER,
    checksum_sha256  TEXT,
    expires_at       TIMESTAMPTZ,               -- NULL khi events.retain = TRUE
    created_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),

    CONSTRAINT event_media_object_duy_nhat UNIQUE (storage_provider, bucket, object_key),
    CONSTRAINT event_media_clip_co_thoi_luong
        CHECK (media_type <> 'CLIP' OR duration_ms IS NOT NULL)
);
CREATE INDEX idx_event_media_event   ON event_media (event_id);
CREATE INDEX idx_event_media_het_han ON event_media (expires_at) WHERE expires_at IS NOT NULL;

COMMENT ON TABLE event_media IS
    'Chi luu METADATA. File that nam o MinIO (dev) hoac S3 (Sprint 4). FR-EVT-07: API tra presigned URL 15 phut, khong bao gio tra credential bucket.';


-- =====================================================================
-- 9. emergency_contacts — FR-NOT-09/10
-- =====================================================================
CREATE TABLE emergency_contacts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id  UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name           TEXT        NOT NULL,
    phone_e164     TEXT        NOT NULL,
    email          CITEXT,
    priority_order SMALLINT    NOT NULL DEFAULT 1,     -- 1 = goi truoc tien
    is_verified    BOOLEAN     NOT NULL DEFAULT FALSE, -- SNS/Connect sandbox yeu cau verify
    is_enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT emergency_contacts_thu_tu_duy_nhat UNIQUE (owner_user_id, priority_order),
    CONSTRAINT emergency_contacts_toi_da_3        CHECK (priority_order BETWEEN 1 AND 3),
    CONSTRAINT emergency_contacts_phone_format    CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
CREATE TRIGGER trg_emergency_contacts_updated_at BEFORE UPDATE ON emergency_contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 10. notifications — FR-NOT-01..05
-- =====================================================================
CREATE TABLE notifications (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id             UUID                 NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    recipient_user_id    UUID                 REFERENCES users (id) ON DELETE SET NULL,
    emergency_contact_id UUID                 REFERENCES emergency_contacts (id) ON DELETE SET NULL,
    channel              notification_channel NOT NULL,
    status               notification_status  NOT NULL DEFAULT 'PENDING',
    escalation_level     SMALLINT             NOT NULL DEFAULT 0,  -- 0 = caregiver, 1..3 = lien he khan
    attempt_count        SMALLINT             NOT NULL DEFAULT 0,
    max_attempts         SMALLINT             NOT NULL DEFAULT 3,  -- FR-NOT-03
    next_retry_at        TIMESTAMPTZ,
    provider_message_id  TEXT,                                     -- telegram message_id / SNS MessageId
    error_code           TEXT,
    error_message        TEXT,
    payload              JSONB                NOT NULL DEFAULT '{}'::jsonb,
    sent_at              TIMESTAMPTZ,
    failed_at            TIMESTAMPTZ,
    confirmed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ          NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ          NOT NULL DEFAULT now(),

    CONSTRAINT notifications_co_nguoi_nhan
        CHECK (recipient_user_id IS NOT NULL OR emergency_contact_id IS NOT NULL),
    CONSTRAINT notifications_so_lan_thu_hop_le CHECK (attempt_count <= max_attempts)
);
CREATE INDEX idx_notifications_event ON notifications (event_id);
CREATE INDEX idx_notifications_can_retry ON notifications (next_retry_at)
    WHERE status = 'FAILED' AND next_retry_at IS NOT NULL;
CREATE INDEX idx_notifications_provider_msg ON notifications (provider_message_id)
    WHERE provider_message_id IS NOT NULL;
CREATE TRIGGER trg_notifications_updated_at BEFORE UPDATE ON notifications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN notifications.provider_message_id IS
    'Can de anh xa callback tu Telegram/Connect ve dung notification (US-14).';


-- =====================================================================
-- 11. confirmations — FR-ESC-03/04/09
-- =====================================================================
CREATE TABLE confirmations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id             UUID                  NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    notification_id      UUID                  REFERENCES notifications (id) ON DELETE SET NULL,
    user_id              UUID                  REFERENCES users (id) ON DELETE SET NULL,
    emergency_contact_id UUID                  REFERENCES emergency_contacts (id) ON DELETE SET NULL,
    channel              notification_channel  NOT NULL,
    response             confirmation_response NOT NULL,
    is_authoritative     BOOLEAN               NOT NULL DEFAULT TRUE,
    note                 TEXT,
    source_message_id    TEXT,
    responded_at         TIMESTAMPTZ           NOT NULL DEFAULT now(),
    created_at           TIMESTAMPTZ           NOT NULL DEFAULT now(),

    CONSTRAINT confirmations_co_nguoi_xac_nhan
        CHECK (user_id IS NOT NULL OR emergency_contact_id IS NOT NULL)
);

-- US-14: "Su kien da duoc xu ly" — chi lan xac nhan DAU TIEN quyet dinh trang thai.
-- Cac lan bam sau van duoc ghi lai (is_authoritative = FALSE) de kiem toan.
CREATE UNIQUE INDEX uq_confirmations_lan_dau_tien ON confirmations (event_id)
    WHERE is_authoritative;
CREATE INDEX idx_confirmations_event ON confirmations (event_id);
CREATE INDEX idx_confirmations_user  ON confirmations (user_id);


-- =====================================================================
-- 12. event_status_history — FR-EVT-05, FR-ESC-09
-- =====================================================================
CREATE TABLE event_status_history (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id      UUID         NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    from_status   event_status,
    to_status     event_status NOT NULL,
    reason        TEXT,                        -- 'TIMEOUT' | 'USER_CONFIRMED' | 'AI_RESULT'
    actor_type    actor_type   NOT NULL DEFAULT 'SYSTEM',
    actor_user_id UUID         REFERENCES users (id) ON DELETE SET NULL,
    channel       notification_channel,
    metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_status_history_event ON event_status_history (event_id, created_at);


-- =====================================================================
-- 13. wellness_schedules — FR-DET-M5-01, US-20
-- =====================================================================
CREATE TABLE wellness_schedules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_user_id UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name             TEXT        NOT NULL DEFAULT 'Kiem tra hang ngay',
    check_at         TIME        NOT NULL,                  -- 09:00, 18:00
    days_of_week     SMALLINT[]  NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
    lookback_hours   SMALLINT    NOT NULL DEFAULT 6,        -- xet hoat dong trong X gio qua
    grace_seconds    INTEGER     NOT NULL DEFAULT 300,      -- 5 phut cho xac nhan
    camera_ids       UUID[]      NOT NULL DEFAULT '{}',     -- rong = moi camera cua ho
    timezone         TEXT        NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    is_enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
    last_checked_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT wellness_lich_duy_nhat     UNIQUE (resident_user_id, check_at),
    CONSTRAINT wellness_lookback_hop_le   CHECK (lookback_hours BETWEEN 1 AND 24)
);
CREATE TRIGGER trg_wellness_schedules_updated_at BEFORE UPDATE ON wellness_schedules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 14. audit_logs — FR-LOG-01
-- =====================================================================
CREATE TABLE audit_logs (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id UUID        REFERENCES users (id) ON DELETE SET NULL,
    action        TEXT        NOT NULL,  -- 'LOGIN_SUCCESS' | 'KNOWN_FACE_DELETED' | 'RULE_UPDATED'
    entity_type   TEXT,
    entity_id     UUID,
    ip_address    INET,
    user_agent    TEXT,
    metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_actor  ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs (action, created_at DESC);

COMMIT;
