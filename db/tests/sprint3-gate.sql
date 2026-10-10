-- Run only against the disposable database created by sprint3-db-gate.mjs.
BEGIN;
CREATE FUNCTION pg_temp.expect_rejected(statement TEXT, expected_state TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> expected_state THEN RAISE; END IF;
        rejected := TRUE;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Expected SQLSTATE %: %', expected_state, statement; END IF;
END;
$$;

INSERT INTO users (id, email, full_name, password_hash) VALUES
('10000000-0000-0000-0000-000000000001', 'gate-owner@example.test', 'Gate owner', 'test-only-hash'),
('10000000-0000-0000-0000-000000000002', 'gate-resident@example.test', 'Gate resident', 'test-only-hash');
INSERT INTO devices (id, owner_user_id, name) VALUES
('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Gate device');
INSERT INTO cameras (id, device_id, name, slug, rtsp_url) VALUES
('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Gate camera', 'gate_camera', 'rtsp://example.test/test');
INSERT INTO events (id, camera_id, event_type, priority, detected_at) VALUES
('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'FALL_DETECTED', 'P1', now()),
('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'FALL_DETECTED', 'P1', now()),
('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'FIRE_SMOKE_DETECTED', 'P0', now()),
('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', 'FIRE_SMOKE_DETECTED', 'P0', now());

INSERT INTO fall_incidents (camera_id, source_session_id, track_id, episode_id, event_id,
candidate_started_at, confirmed_at, model_version, rule_snapshot, result_id, pending_payload)
VALUES ('30000000-0000-0000-0000-000000000001', 'gate-session', 'track-1',
'50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
now() - interval '16 seconds', now(), 'gate-pose', '{}',
'60000000-0000-0000-0000-000000000001', '{}');
SELECT pg_temp.expect_rejected($q$
INSERT INTO fall_incidents (camera_id, source_session_id, track_id, episode_id, event_id,
candidate_started_at, confirmed_at, model_version, rule_snapshot, result_id, pending_payload)
VALUES ('30000000-0000-0000-0000-000000000001', 'gate-session', 'track-1',
'50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002',
now() - interval '16 seconds', now(), 'gate-pose', '{}',
'60000000-0000-0000-0000-000000000002', '{}') $q$, '23505');
SELECT pg_temp.expect_rejected('UPDATE fall_incidents SET pending_payload = ''{"changed":true}''', 'P0001');
SELECT pg_temp.expect_rejected('UPDATE fall_incidents SET delivery_status = ''PROCESSING''', '23514');

INSERT INTO fire_incidents (camera_id, source_session_id, episode_id, event_id,
first_qualified_at, confirmed_at, model_version, rule_snapshot, result_id, pending_payload)
VALUES ('30000000-0000-0000-0000-000000000001', 'gate-session',
'50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003',
now() - interval '2 seconds', now(), 'gate-fire', '{}',
'60000000-0000-0000-0000-000000000003', '{}');
UPDATE events SET status = 'RESOLVED' WHERE id = '40000000-0000-0000-0000-000000000003';
-- User resolution must not clear the detector's active latch.
SELECT pg_temp.expect_rejected($q$
INSERT INTO fire_incidents (camera_id, source_session_id, episode_id, event_id,
first_qualified_at, confirmed_at, model_version, rule_snapshot, result_id, pending_payload)
VALUES ('30000000-0000-0000-0000-000000000001', 'restarted-session',
'50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004',
now() - interval '2 seconds', now(), 'gate-fire', '{}',
'60000000-0000-0000-0000-000000000004', '{}') $q$, '23505');
SELECT pg_temp.expect_rejected('UPDATE fire_incidents SET pending_payload = ''{"changed":true}''', 'P0001');

INSERT INTO wellness_schedules (id, resident_user_id, owner_user_id, check_at)
VALUES ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
'10000000-0000-0000-0000-000000000001', '09:00');
INSERT INTO wellness_check_runs (id, schedule_id, owner_user_id, resident_user_id, local_date,
scheduled_for, schedule_version, schedule_snapshot, lookback_started_at, lookback_ended_at, grace_seconds)
VALUES ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
'10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '2026-10-10',
'2026-10-10T02:00:00Z', 1, '{}', '2026-10-09T20:00:00Z', '2026-10-10T02:00:00Z', 300);
SELECT pg_temp.expect_rejected($q$
INSERT INTO wellness_check_runs (schedule_id, owner_user_id, resident_user_id, local_date,
scheduled_for, schedule_version, schedule_snapshot, lookback_started_at, lookback_ended_at, grace_seconds)
VALUES ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
'10000000-0000-0000-0000-000000000002', '2026-10-10', '2026-10-10T02:00:00Z', 1, '{}',
'2026-10-09T20:00:00Z', '2026-10-10T02:00:00Z', 300) $q$, '23505');
SELECT pg_temp.expect_rejected('UPDATE wellness_check_runs SET grace_seconds = 600', 'P0001');
SELECT pg_temp.expect_rejected('UPDATE wellness_check_runs SET status = ''PROCESSING''', '23514');
INSERT INTO events (id, event_type, source, priority, detected_at, wellness_owner_user_id, wellness_resident_user_id)
VALUES ('40000000-0000-0000-0000-000000000005', 'WELLNESS_TIMEOUT', 'SCHEDULER', 'P2', now(),
'10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');
UPDATE wellness_check_runs SET status = 'ALERT_CREATED', evaluated_at = now(),
event_id = '40000000-0000-0000-0000-000000000005', request_sent_at = now(),
confirmation_deadline_at = now() + interval '300 seconds';
SELECT pg_temp.expect_rejected($q$ UPDATE wellness_check_runs SET
request_sent_at = request_sent_at + interval '1 second',
confirmation_deadline_at = confirmation_deadline_at + interval '1 second' $q$, 'P0001');
SELECT pg_temp.expect_rejected($q$ INSERT INTO events (event_type, source, detected_at,
wellness_owner_user_id, wellness_resident_user_id) VALUES ('WELLNESS_TIMEOUT', 'SCHEDULER', now(),
'10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002') $q$, '23505');
ROLLBACK;
