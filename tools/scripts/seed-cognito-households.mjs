import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SYSTEM_ADMIN_EMAIL = 'admin@camerai.local';
const ACCOUNT_ROLES = ['ADMIN', 'CAREGIVER', 'VIEWER'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBJECT_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function validate(config) {
  if (!/^[a-z]{2}(?:-[a-z0-9]+)+-\d_[A-Za-z0-9]+$/.test(config.poolId)) {
    throw new Error('Invalid Cognito household seed pool ID.');
  }
  if (!Array.isArray(config.households) || config.households.length !== 5) {
    throw new Error('The Cognito household seed requires five households.');
  }
  const emails = new Set();
  const subjects = new Set();
  const slugs = new Set();
  function checkAccount(account) {
    const email = account?.email?.toLowerCase();
    const sub = account?.sub?.toLowerCase();
    if (
      !EMAIL_PATTERN.test(email ?? '') ||
      !SUBJECT_PATTERN.test(sub ?? '') ||
      emails.has(email) ||
      subjects.has(sub)
    ) {
      throw new Error('Invalid or duplicate email or Cognito subject in household seed.');
    }
    emails.add(email);
    subjects.add(sub);
  }
  if (config.systemAdmin?.email?.toLowerCase() !== SYSTEM_ADMIN_EMAIL) {
    throw new Error('Invalid system administrator in Cognito household seed.');
  }
  checkAccount(config.systemAdmin);
  for (const household of config.households) {
    if (
      !/^cam_1_[a-z0-9_]{1,30}$/.test(household.slug) ||
      slugs.has(household.slug) ||
      typeof household.ownerName !== 'string' ||
      !household.ownerName.trim()
    ) {
      throw new Error('Invalid or duplicate household camera slug or owner name.');
    }
    slugs.add(household.slug);
    for (const role of ACCOUNT_ROLES) checkAccount(household.accounts?.[role]);
  }
}

async function upsertAccount(client, account, issuer, role, name, ownerId = null) {
  const { rows } = await client.query(
    `INSERT INTO users (id, email, full_name, role, cognito_issuer, cognito_sub, cognito_email, household_owner_id)
     VALUES (COALESCE($7::uuid, gen_random_uuid()), $1::citext, $2, $3, $4, $5, $1::text, $6)
     ON CONFLICT (email) DO UPDATE SET
       role = EXCLUDED.role, cognito_issuer = EXCLUDED.cognito_issuer,
       cognito_sub = EXCLUDED.cognito_sub, cognito_email = EXCLUDED.cognito_email,
       household_owner_id = EXCLUDED.household_owner_id
     WHERE (users.cognito_sub IS NULL OR users.cognito_sub = EXCLUDED.cognito_sub)
       AND (users.cognito_issuer IS NULL OR users.cognito_issuer = EXCLUDED.cognito_issuer)
     RETURNING id`,
    [
      account.email.toLowerCase(),
      name,
      role,
      issuer,
      account.sub.toLowerCase(),
      ownerId,
      account.email.toLowerCase() === SYSTEM_ADMIN_EMAIL
        ? '11111111-1111-4111-8111-111111111111'
        : null,
    ],
  );
  if (!rows[0]) throw new Error('An existing account is linked to a different Cognito identity.');
  return rows[0].id;
}

async function upsertCamera(client, household, ownerId) {
  const { slug, ownerName } = household;
  const rtsp = `rtsp://localhost:8554/${slug}`;
  const name = `Gateway Nha ${ownerName}`;
  const existing = await client.query(
    `SELECT d.id, d.owner_user_id FROM cameras c JOIN devices d ON d.id = c.device_id
     WHERE c.slug = $1 FOR UPDATE OF c, d`,
    [slug],
  );
  let deviceId = existing.rows[0]?.id;
  if (deviceId) {
    if (existing.rows[0].owner_user_id !== ownerId) {
      throw new Error(`Camera slug ${slug} belongs to a different household.`);
    }
    await client.query('UPDATE devices SET name = $2 WHERE id = $1', [deviceId, name]);
  } else {
    const { rows } = await client.query(
      `INSERT INTO devices (owner_user_id, name, serial_number)
       VALUES ($1, $2, $3) ON CONFLICT (serial_number) DO UPDATE SET name = EXCLUDED.name
       WHERE devices.owner_user_id = EXCLUDED.owner_user_id RETURNING id`,
      [ownerId, name, `camerai-household-${slug}`],
    );
    if (!rows[0]) throw new Error(`Gateway for ${slug} belongs to a different household.`);
    deviceId = rows[0].id;
  }
  const { rows } = await client.query(
    `INSERT INTO cameras (device_id, name, slug, rtsp_url)
     VALUES ($1, 'Camera 1', $2, $3)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, rtsp_url = EXCLUDED.rtsp_url
     WHERE cameras.device_id = EXCLUDED.device_id
     RETURNING id`,
    [deviceId, slug, rtsp],
  );
  if (!rows[0]) throw new Error(`Camera slug ${slug} is already assigned to a different gateway.`);
  await client.query(
    `INSERT INTO camera_sources (camera_id, source_type, rtsp_url, status)
     VALUES ($1, 'RTSP', $2, 'OFFLINE') ON CONFLICT (camera_id) DO NOTHING`,
    [rows[0].id, rtsp],
  );
  await client.query(
    `INSERT INTO camera_frigate_settings
       (camera_id, detect_width, detect_height, detect_fps, detection_retention_days,
        config_version, applied_version, sync_status)
     SELECT id, detect_width, detect_height, fps, retention_days, 1, 0, 'PENDING'
     FROM cameras WHERE id = $1 ON CONFLICT (camera_id) DO NOTHING`,
    [rows[0].id],
  );
}

export async function seedCognitoHouseholds(client, root) {
  const configuredFile = process.env.COGNITO_HOUSEHOLD_SEED_FILE;
  let raw;
  try {
    raw = await readFile(configuredFile || join(root, '.env.cognito-households.json'), 'utf8');
  } catch (error) {
    if (!configuredFile && error.code === 'ENOENT') return;
    throw error;
  }
  const config = JSON.parse(raw.replace(/^\uFEFF/, ''));
  validate(config);
  const region = config.poolId.split('_')[0];
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${config.poolId}`;
  if (process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_USER_POOL_ID !== config.poolId) {
    throw new Error('The Cognito household seed pool differs from COGNITO_USER_POOL_ID.');
  }

  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('camerai-cognito-household-seed'))");
    await upsertAccount(client, config.systemAdmin, issuer, 'ADMIN', 'Quản trị hệ thống');
    for (const { accounts, ownerName, slug } of config.households) {
      const ownerId = await upsertAccount(client, accounts.ADMIN, issuer, 'ADMIN', ownerName);
      await upsertAccount(
        client,
        accounts.CAREGIVER,
        issuer,
        'CAREGIVER',
        `Người chăm sóc - ${ownerName}`,
        ownerId,
      );
      await upsertAccount(
        client,
        accounts.VIEWER,
        issuer,
        'VIEWER',
        `Người xem - ${ownerName}`,
        ownerId,
      );
      await upsertCamera(client, { ownerName, slug }, ownerId);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  console.log('Da dong bo 16 tai khoan Cognito va 5 camera theo ho.');
}
