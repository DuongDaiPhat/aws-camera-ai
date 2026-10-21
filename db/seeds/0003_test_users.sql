BEGIN;

-- Dedicated manual US-20 accounts. Development password: Admin@12345.
-- Do not fabricate known-face links, embeddings, or Telegram identities here.
INSERT INTO users (id, email, password_hash, full_name, role) VALUES
(
    '20200000-0000-4000-8000-000000000001',
    'caregiver@local',
    '$argon2id$v=19$m=65536,p=4,t=3$t/FGrLv6QCsVGRNKlgaoPA$VEX5Op2XTiAYQEvy1dUIbsuGGAqE98grgmHV3Y90gyo',
    'Người chăm sóc US-20',
    'CAREGIVER'
),
(
    '20200000-0000-4000-8000-000000000002',
    'viewer@local',
    '$argon2id$v=19$m=65536,p=4,t=3$t/FGrLv6QCsVGRNKlgaoPA$VEX5Op2XTiAYQEvy1dUIbsuGGAqE98grgmHV3Y90gyo',
    'Người được giám sát US-20',
    'VIEWER'
)
ON CONFLICT (email) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    is_active = TRUE,
    failed_login_count = 0,
    locked_until = NULL;

COMMIT;
