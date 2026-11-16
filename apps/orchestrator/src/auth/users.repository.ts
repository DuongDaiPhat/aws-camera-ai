import { Injectable } from '@nestjs/common';
import type { components, operations } from '@cam/contracts';
import { DatabaseService } from '../database/database.service';
import { isSystemAdmin, SYSTEM_ADMIN_EMAIL } from './system-admin';

type User = components['schemas']['User'];
type CreateUserRequest = components['schemas']['CreateUserRequest'];
type UsersPage = operations['listUsers']['responses'][200]['content']['application/json'];

const USER_FIELDS = 'id, email, "fullName", role, "isActive", "createdAt"';
const USER_COLUMNS = `id, email, full_name AS "fullName", role, is_active AS "isActive",
  created_at AS "createdAt"`;

@Injectable()
export class UsersRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(
    actorId: string,
    page: number,
    pageSize: number,
    role: User['role'] | undefined,
    issuer: string | null,
  ): Promise<UsersPage> {
    const offset = (page - 1) * pageSize;
    const { rows } = await this.database.query<{ data: User[]; total: number }>(
      `WITH filtered AS (
         SELECT ${USER_COLUMNS},
                COALESCE(cognito_issuer = $2, FALSE) AND cognito_sub IS NOT NULL AS "isCognitoLinked",
                CASE WHEN cognito_issuer = $2 AND cognito_sub IS NOT NULL
                     THEN cognito_email END AS "cognitoEmail"
         FROM users
         WHERE ($1::user_role IS NULL OR role = $1)
           AND EXISTS (
             SELECT 1 FROM users actor WHERE actor.id = $5 AND actor.is_active
               AND actor.role = 'ADMIN'
               AND (actor.email = $6 OR (users.email <> $6 AND shares_camera_household(actor.id, users.id)))
           )
       )
       SELECT (SELECT count(*)::int FROM filtered) AS total,
              COALESCE((SELECT json_agg(page_user ORDER BY email, id) FROM (
                SELECT ${USER_FIELDS}, "isCognitoLinked", "cognitoEmail"
                FROM filtered ORDER BY email, id LIMIT $3 OFFSET $4
              ) page_user), '[]'::json) AS data`,
      [role ?? null, issuer, pageSize, offset, actorId, SYSTEM_ADMIN_EMAIL],
    );
    const { data, total } = rows[0];
    return { data, meta: { page, pageSize, total } };
  }

  async changeRole(
    actorId: string,
    targetId: string,
    role: User['role'],
  ): Promise<{ actorIsAdmin: boolean; user?: User }> {
    return this.database.transaction(async (client) => {
      const { rows } = await client.query<User & { householdOwnerId: string | null }>(
        `SELECT ${USER_COLUMNS}, household_owner_id AS "householdOwnerId"
         FROM users WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`,
        [actorId, targetId],
      );
      const actor = rows.find((user) => user.id === actorId);
      if (!actor?.isActive || actor.role !== 'ADMIN') return { actorIsAdmin: false };
      const target = rows.find((user) => user.id === targetId);
      if (
        !isSystemAdmin(actor) &&
        (target?.email.toLowerCase() === SYSTEM_ADMIN_EMAIL ||
          (actor.householdOwnerId ?? actor.id) !== (target?.householdOwnerId ?? target?.id))
      )
        return { actorIsAdmin: true };
      if (!target || target.role === role) return { actorIsAdmin: true, user: target };

      const updated = await client.query<User>(
        `WITH updated_user AS (
           UPDATE users SET role = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}
         ), recorded_action AS (
           INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
           SELECT $3, 'USER_ROLE_UPDATED', 'user', id,
                  jsonb_build_object('previousRole', $4::user_role, 'role', role)
           FROM updated_user
         )
         SELECT ${USER_FIELDS} FROM updated_user`,
        [targetId, role, actorId, target.role],
      );
      return { actorIsAdmin: true, user: updated.rows[0] };
    });
  }

  async create(
    input: CreateUserRequest,
    actorId: string,
    issuer: string,
  ): Promise<User | undefined> {
    const { rows } = await this.database.query<User>(
      `WITH actor AS (
         SELECT id, email, household_owner_id FROM users
         WHERE id = $6 AND is_active AND role = 'ADMIN' FOR UPDATE
       ), created_user AS (
         INSERT INTO users
           (email, full_name, role, cognito_issuer, cognito_sub, cognito_email, household_owner_id)
         SELECT $1::citext, $2, $3::user_role, $4, $5, $1::text,
                CASE WHEN actor.email = $7 THEN NULL ELSE COALESCE(actor.household_owner_id, actor.id) END
         FROM actor WHERE $1::citext <> $7
         ON CONFLICT DO NOTHING
         RETURNING ${USER_COLUMNS}
       ), recorded_action AS (
         INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
         SELECT $6, 'USER_CREATED', 'user', id, jsonb_build_object('role', role)
         FROM created_user
       )
       SELECT ${USER_FIELDS} FROM created_user`,
      [
        input.email,
        input.fullName,
        input.role,
        issuer,
        input.cognitoSub,
        actorId,
        SYSTEM_ADMIN_EMAIL,
      ],
    );
    return rows[0];
  }
}
