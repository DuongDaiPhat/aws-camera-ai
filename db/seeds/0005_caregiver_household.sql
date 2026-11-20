-- Local demo: the Caregiver manages the same household as the four demo cameras.
UPDATE users SET household_owner_id=(SELECT id FROM users WHERE email='admin@camerai.local')
WHERE email='caregiver@camerai.local' AND role='CAREGIVER';

-- Only the existing local demo Viewer; never grant new household members automatically.
INSERT INTO camera_access_grants(user_id,camera_id,can_live,can_playback)
SELECT u.id,c.id,TRUE,TRUE FROM users u CROSS JOIN cameras c JOIN devices d ON d.id=c.device_id
WHERE u.email='viewer@camerai.local' AND u.role='VIEWER' AND shares_camera_household(u.id,d.owner_user_id)
ON CONFLICT(user_id,camera_id) DO NOTHING;
