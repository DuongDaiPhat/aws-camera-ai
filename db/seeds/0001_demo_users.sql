INSERT INTO users (id, email, password_hash, full_name, role)
VALUES (
    '11111111-1111-4111-8111-111111111111',
    'admin@camerai.local',
    '$argon2id$v=19$m=65536,p=4,t=3$t/FGrLv6QCsVGRNKlgaoPA$VEX5Op2XTiAYQEvy1dUIbsuGGAqE98grgmHV3Y90gyo',
    'Quản trị CameraAI',
    'ADMIN'
)
ON CONFLICT (email) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    is_active = TRUE,
    failed_login_count = 0,
    locked_until = NULL;
