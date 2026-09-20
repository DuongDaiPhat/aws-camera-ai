BEGIN;

-- 1. Thêm Users (Mật khẩu dev là Admin@12345, hash bằng Argon2id theo 0001_demo_users.sql)
INSERT INTO users (id, email, password_hash, full_name, role) VALUES 
(
    '11111111-1111-4111-8111-111111111111',
    'admin@camerai.local',
    '$argon2id$v=19$m=65536,p=4,t=3$t/FGrLv6QCsVGRNKlgaoPA$VEX5Op2XTiAYQEvy1dUIbsuGGAqE98grgmHV3Y90gyo',
    'Quản trị CameraAI',
    'ADMIN'
),
(
    '00000000-0000-0000-0000-000000000002',
    'caregiver@camerai.local',
    '$argon2id$v=19$m=65536,p=4,t=3$t/FGrLv6QCsVGRNKlgaoPA$VEX5Op2XTiAYQEvy1dUIbsuGGAqE98grgmHV3Y90gyo',
    'Caregiver User',
    'CAREGIVER'
)
ON CONFLICT (email) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    is_active = TRUE,
    failed_login_count = 0,
    locked_until = NULL;


-- 2. Thêm Devices
INSERT INTO devices (id, owner_user_id, name, device_type, status) VALUES 
('11111111-1111-1111-1111-111111111111', '11111111-1111-4111-8111-111111111111', 'Gateway Nha', 'EDGE_GATEWAY', 'ONLINE')
ON CONFLICT (id) DO NOTHING;

-- 3. Thêm Cameras
INSERT INTO cameras (id, device_id, name, slug, rtsp_url, detect_width, detect_height, fps) VALUES 
('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111', 'Phong khach', 'cam_living_room', 'rtsp://localhost:8554/cam_living_room', 1280, 720, 5),
('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Bep', 'cam_kitchen', 'rtsp://localhost:8554/cam_kitchen', 1280, 720, 5),
('22222222-2222-2222-2222-222222222223', '11111111-1111-1111-1111-111111111111', 'test', 'cam_video', 'rtsp://localhost:8554/test_cam', 1280, 720, 5)
ON CONFLICT (slug) DO NOTHING;

-- 4. Thêm Zones
INSERT INTO zones (camera_id, name, slug, zone_type, polygon) VALUES 
('22222222-2222-2222-2222-222222222222', 'Khu vuc bep', 'restricted_stove', 'RESTRICTED', '[[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]'::jsonb),
('22222222-2222-2222-2222-222222222221', 'Sofa', 'rest_sofa', 'REST_AREA', '[[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]'::jsonb),
('22222222-2222-2222-2222-222222222221', 'Cua ra vao', 'door_normal', 'NORMAL', '[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]'::jsonb)
ON CONFLICT (camera_id, slug) DO NOTHING;

-- 5. Thêm Known Faces
INSERT INTO known_faces (owner_user_id, person_name, relationship, provider, embedding, embedding_dim) VALUES 
('11111111-1111-4111-8111-111111111111', 'Ong Noi', 'Ong', 'LOCAL', decode('00', 'hex'), 128),
('11111111-1111-4111-8111-111111111111', 'Ba Ngoai', 'Ba', 'LOCAL', decode('00', 'hex'), 128),
('11111111-1111-4111-8111-111111111111', 'Con Trai', 'Con', 'LOCAL', decode('00', 'hex'), 128),
('11111111-1111-4111-8111-111111111111', 'Con Gai', 'Con', 'LOCAL', decode('00', 'hex'), 128),
('11111111-1111-4111-8111-111111111111', 'Nguoi Giup Viec', 'Giup Viec', 'LOCAL', decode('00', 'hex'), 128)
ON CONFLICT (owner_user_id, person_name) DO NOTHING;

-- 6. Thêm Escalation Rules
INSERT INTO escalation_rules (event_type, priority, t_low, t_high, t_wait_seconds, skip_logged_only) VALUES
('FIRE_SMOKE_DETECTED', 'P0', NULL, 0.5, 30, TRUE),
('FALL_DETECTED', 'P1', 0.4, 0.8, 60, FALSE),
('UNKNOWN_PERSON', 'P2', 0.6, 0.85, 120, FALSE),
('RESTRICTED_ZONE', 'P2', NULL, NULL, 60, FALSE),
('PERSON_DETECTED', 'P3', NULL, NULL, 300, FALSE)
ON CONFLICT (event_type) DO NOTHING;

-- 7. Sinh 20 Sự kiện ngẫu nhiên (events)
DO $$
DECLARE
    i INT;
    v_event_id UUID;
    v_camera_id UUID;
    v_event_type event_type;
    v_status event_status;
    v_priority priority_level;
BEGIN
    FOR i IN 1..20 LOOP
        v_event_id := gen_random_uuid();
        
        -- Chọn camera ngẫu nhiên (chỉ có 2 camera)
        IF (i % 2 = 0) THEN
            v_camera_id := '22222222-2222-2222-2222-222222222221';
        ELSE
            v_camera_id := '22222222-2222-2222-2222-222222222222';
        END IF;

        -- Chọn event_type và priority tương ứng
        IF (i % 5 = 1) THEN
            v_event_type := 'FIRE_SMOKE_DETECTED';
            v_priority := 'P0';
        ELSIF (i % 5 = 2) THEN
            v_event_type := 'FALL_DETECTED';
            v_priority := 'P1';
        ELSIF (i % 5 = 3) THEN
            v_event_type := 'UNKNOWN_PERSON';
            v_priority := 'P2';
        ELSIF (i % 5 = 4) THEN
            v_event_type := 'RESTRICTED_ZONE';
            v_priority := 'P2';
        ELSE
            v_event_type := 'PERSON_DETECTED';
            v_priority := 'P3';
        END IF;

        -- Chọn status
        IF (i <= 5) THEN
            v_status := 'DETECTED';
        ELSIF (i <= 10) THEN
            v_status := 'NOTIFIED';
        ELSIF (i <= 15) THEN
            v_status := 'ESCALATED';
        ELSE
            v_status := 'RESOLVED';
        END IF;

        -- Insert Event
        INSERT INTO events (
            id, camera_id, event_type, status, priority, source, 
            confidence, ai_results, detected_at, created_at, updated_at
        ) VALUES (
            v_event_id, v_camera_id, v_event_type, v_status, v_priority, 'FRIGATE',
            0.95, '[{"module":"M1","label":"UNKNOWN","confidence":0.95}]'::jsonb, 
            now() - (i || ' minutes')::interval, now(), now()
        );

        -- Insert Event Media (Snapshot)
        INSERT INTO event_media (
            event_id, media_type, storage_provider, bucket, object_key, content_type
        ) VALUES (
            v_event_id, 'SNAPSHOT', 'MINIO', 'camerai-media', 'events/2026/09/18/' || v_event_id || '/snapshot.jpg', 'image/jpeg'
        );
    END LOOP;
END $$;

COMMIT;
