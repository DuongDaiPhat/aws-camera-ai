import { Injectable } from '@nestjs/common';
import type { components } from '@cam/contracts';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { UpdateKnownFaceDto } from './dto/update-known-face.dto';
import type { CreateKnownFaceDto } from './dto/create-known-face.dto';
import type { CollectionRequest } from './face-inference.interface';
import { faceError } from './face-error';

export type KnownFace = components['schemas']['KnownFace'];
interface FaceRow {
  id: string;
  person_name: string;
  relationship: string | null;
  linked_user_id: string | null;
  provider: 'LOCAL' | 'REKOGNITION';
  model_version: string;
  source_image_count: number;
  is_active: boolean;
  created_at: Date;
  ready: boolean;
}
interface SyncRow {
  owner_user_id: string;
  model_version: string;
  embedding_dim: number;
  version: number;
}
const PUBLIC_COLUMNS = `f.id, f.person_name, f.relationship, f.linked_user_id, f.provider,
  f.model_version, f.source_image_count, f.is_active, f.created_at,
  CASE
    WHEN f.provider = 'REKOGNITION' THEN EXISTS (
      SELECT 1 FROM cloud_face_mappings m
      JOIN cloud_face_collections c ON c.owner_user_id = m.owner_user_id
      WHERE m.owner_user_id = f.owner_user_id AND m.known_face_id = f.id
    )
    ELSE COALESCE(s.synced_version = s.version, FALSE)
  END AS ready`;
const JOIN_SYNC = `LEFT JOIN face_collection_sync s ON s.owner_user_id = f.owner_user_id AND s.model_version = f.model_version`;

export interface RekognitionFaceTarget {
  id: string;
  provider: 'LOCAL' | 'REKOGNITION';
  collectionId: string | null;
  faceIds: string[];
}

function publicFace(row: FaceRow): KnownFace {
  return {
    id: row.id,
    personName: row.person_name,
    relationship: row.relationship,
    linkedUserId: row.linked_user_id,
    provider: row.provider,
    modelVersion: row.model_version,
    sourceImageCount: row.source_image_count,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    recognitionStatus: row.ready ? 'READY' : 'SYNC_PENDING',
  };
}

@Injectable()
export class KnownFacesRepository {
  constructor(private readonly db: DatabaseService) {}

  async householdOwner(actorId: string): Promise<string> {
    const result = await this.db.query<{ owner: string }>(
      `SELECT COALESCE(household_owner_id,id) AS owner FROM users WHERE id=$1 AND is_active`,
      [actorId],
    );
    if (!result.rows[0]) throw faceError(401, 'UNAUTHORIZED', 'Bạn cần đăng nhập.');
    return result.rows[0].owner;
  }

  async isFaceModuleEnabled(ownerUserId: string): Promise<boolean> {
    const result = await this.db.query<{ enabled: boolean }>(
      `SELECT COALESCE(ai.m1_face_enabled, TRUE) AS enabled
       FROM users u
       LEFT JOIN household_ai_module_settings ai
         ON ai.owner_user_id = COALESCE(u.household_owner_id, u.id)
       WHERE u.id = $1`,
      [ownerUserId],
    );
    return result.rows[0]?.enabled ?? true;
  }
  async update(
    owner: string,
    id: string,
    input: UpdateKnownFaceDto,
    actorId = owner,
  ): Promise<void> {
    await this.db.transaction(async (client) => {
      if (input.linkedUserId) {
        const linked = await client.query(
          `SELECT id FROM users WHERE id=$1 AND is_active AND role='VIEWER' AND shares_camera_household($2,id)`,
          [input.linkedUserId, owner],
        );
        if (!linked.rows[0])
          throw faceError(403, 'FORBIDDEN', 'Chỉ được liên kết Viewer đang hoạt động trong hộ.');
      }
      const result = await client.query<{
        provider: 'LOCAL' | 'REKOGNITION';
        model_version: string;
        embedding_dim: number | null;
      }>(
        `UPDATE known_faces SET person_name=$3,relationship=CASE WHEN $6 THEN $4 ELSE relationship END,linked_user_id=CASE WHEN $7 THEN $5 ELSE linked_user_id END WHERE id=$1 AND owner_user_id=$2 RETURNING provider,model_version,embedding_dim`,
        [
          id,
          owner,
          input.personName.trim(),
          input.relationship?.trim() || null,
          input.linkedUserId ?? null,
          input.relationship !== undefined,
          input.linkedUserId !== undefined,
        ],
      );
      const updated = result.rows[0];
      if (!updated) throw faceError(404, 'NOT_FOUND', 'Không tìm thấy người quen trong hộ.');
      if (updated.provider === 'REKOGNITION') {
        await this.bumpCloudCollectionVersion(client, owner);
      } else if (updated.embedding_dim !== null) {
        await this.bump(client, owner, updated.model_version, updated.embedding_dim);
      }
      await client.query(
        "INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'KNOWN_FACE_UPDATED','KNOWN_FACE',$2)",
        [actorId, id],
      );
    });
  }

  async list(owner: string): Promise<KnownFace[]> {
    const result = await this.db.query<FaceRow>(
      `SELECT ${PUBLIC_COLUMNS} FROM known_faces f ${JOIN_SYNC}
      WHERE f.owner_user_id = $1 ORDER BY f.created_at DESC LIMIT 1000`,
      [owner],
    );
    return result.rows.map(publicFace);
  }

  async create(
    owner: string,
    dto: CreateKnownFaceDto,
    embedding: Buffer,
    dimension: number,
    model: string,
    count: number,
  ): Promise<string> {
    try {
      return await this.db.transaction(async (client) => {
        // Cùng owner được tuần tự hóa để giới hạn và version không đua nhau.
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [owner]);
        const total = await client.query<{ count: string }>(
          'SELECT COUNT(*) FROM known_faces WHERE owner_user_id = $1',
          [owner],
        );
        if (Number(total.rows[0]?.count) >= 1000)
          throw faceError(409, 'KNOWN_FACE_LIMIT', 'Đã đạt giới hạn 1000 người quen.');
        if (dto.linkedUserId) {
          const linked = await client.query<{ allowed: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM users WHERE id=$2 AND is_active AND role='VIEWER' AND shares_camera_household($1,id)) AS allowed",
            [owner, dto.linkedUserId],
          );
          if (!linked.rows[0]?.allowed) {
            throw faceError(403, 'FORBIDDEN', 'Tài khoản liên kết ngoài phạm vi.');
          }
        }
        const result = await client.query<{ id: string }>(
          `INSERT INTO known_faces
          (owner_user_id, person_name, relationship, linked_user_id, embedding, embedding_dim, model_version, source_image_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            owner,
            dto.personName,
            dto.relationship ?? null,
            dto.linkedUserId ?? null,
            embedding,
            dimension,
            model,
            count,
          ],
        );
        await this.bump(client, owner, model, dimension);
        const id = result.rows[0]?.id;
        if (!id) throw new Error('Insert did not return ID');
        return id;
      });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw faceError(409, 'KNOWN_FACE_NAME_EXISTS', 'Tên người quen đã tồn tại.');
      }
      throw error;
    }
  }

  async remove(owner: string, id: string, ip: string | null, agent: string | null): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [owner]);
      const result = await client.query<{
        model_version: string;
        embedding_dim: number;
        provider: string;
      }>(
        'SELECT model_version, embedding_dim, provider FROM known_faces WHERE id = $1 AND owner_user_id = $2 FOR UPDATE',
        [id, owner],
      );
      const face = result.rows[0];
      if (!face) throw faceError(404, 'NOT_FOUND', 'Không tìm thấy người quen.');
      if (face.provider !== 'LOCAL')
        throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Provider này chưa hỗ trợ xóa.');
      await client.query('DELETE FROM known_faces WHERE id = $1 AND owner_user_id = $2', [
        id,
        owner,
      ]);
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, ip_address, user_agent)
        VALUES ($1, 'KNOWN_FACE_DELETED', 'KNOWN_FACE', $2, $3, $4)`,
        [owner, id, ip, agent?.slice(0, 512) ?? null],
      );
      await this.bump(client, owner, face.model_version, face.embedding_dim);
    });
  }

  async precheckCreate(owner: string, dto: CreateKnownFaceDto): Promise<void> {
    const total = await this.db.query<{ count: string }>(
      'SELECT COUNT(*) FROM known_faces WHERE owner_user_id = $1',
      [owner],
    );
    if (Number(total.rows[0]?.count) >= 1000) {
      throw faceError(409, 'KNOWN_FACE_LIMIT', 'Đã đạt giới hạn 1000 người quen.');
    }
    const duplicate = await this.db.query<{ id: string }>(
      'SELECT id FROM known_faces WHERE owner_user_id = $1 AND person_name = $2 LIMIT 1',
      [owner, dto.personName],
    );
    if (duplicate.rows[0]) {
      throw faceError(409, 'KNOWN_FACE_NAME_EXISTS', 'Tên người quen đã tồn tại.');
    }
    if (dto.linkedUserId) {
      const linked = await this.db.query<{ allowed: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id=$2 AND is_active AND role='VIEWER' AND shares_camera_household($1,id)) AS allowed",
        [owner, dto.linkedUserId],
      );
      if (!linked.rows[0]?.allowed) {
        throw faceError(403, 'FORBIDDEN', 'Tài khoản liên kết ngoài phạm vi.');
      }
    }
  }

  async createRekognition(
    owner: string,
    dto: CreateKnownFaceDto,
    input: {
      collectionId: string;
      faceIds: string[];
      modelVersion: string;
      sourceImageCount: number;
    },
  ): Promise<string> {
    const primaryFaceId = input.faceIds[0];
    if (!primaryFaceId) {
      throw new Error('At least one Rekognition FaceId is required');
    }
    try {
      return await this.db.transaction(async (client) => {
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [owner]);
        const total = await client.query<{ count: string }>(
          'SELECT COUNT(*) FROM known_faces WHERE owner_user_id = $1',
          [owner],
        );
        if (Number(total.rows[0]?.count) >= 1000) {
          throw faceError(409, 'KNOWN_FACE_LIMIT', 'Đã đạt giới hạn 1000 người quen.');
        }
        if (dto.linkedUserId) {
          const linked = await client.query<{ allowed: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM users WHERE id=$2 AND is_active AND role='VIEWER' AND shares_camera_household($1,id)) AS allowed",
            [owner, dto.linkedUserId],
          );
          if (!linked.rows[0]?.allowed) {
            throw faceError(403, 'FORBIDDEN', 'Tài khoản liên kết ngoài phạm vi.');
          }
        }
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO known_faces
          (owner_user_id, person_name, relationship, linked_user_id, provider, rekognition_face_id, rekognition_collection_id, model_version, source_image_count)
          VALUES ($1,$2,$3,$4,'REKOGNITION',$5,$6,$7,$8) RETURNING id`,
          [
            owner,
            dto.personName,
            dto.relationship ?? null,
            dto.linkedUserId ?? null,
            primaryFaceId,
            input.collectionId,
            input.modelVersion,
            input.sourceImageCount,
          ],
        );
        const id = inserted.rows[0]?.id;
        if (!id) throw new Error('Insert did not return ID');

        await this.upsertCloudCollection(client, owner, input.collectionId);
        for (const faceId of input.faceIds) {
          await client.query(
            `INSERT INTO cloud_face_mappings (owner_user_id, face_id, known_face_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (owner_user_id, face_id) DO UPDATE SET known_face_id = EXCLUDED.known_face_id`,
            [owner, faceId, id],
          );
        }
        return id;
      });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw faceError(409, 'KNOWN_FACE_NAME_EXISTS', 'Tên người quen đã tồn tại.');
      }
      throw error;
    }
  }

  async findRekognitionTarget(owner: string, id: string): Promise<RekognitionFaceTarget | null> {
    const faceResult = await this.db.query<{
      id: string;
      provider: 'LOCAL' | 'REKOGNITION';
      rekognition_face_id: string | null;
      rekognition_collection_id: string | null;
      collection_id: string | null;
    }>(
      `SELECT f.id, f.provider, f.rekognition_face_id, f.rekognition_collection_id, c.collection_id
      FROM known_faces f
      LEFT JOIN cloud_face_collections c ON c.owner_user_id = f.owner_user_id
      WHERE f.id = $1 AND f.owner_user_id = $2`,
      [id, owner],
    );
    const face = faceResult.rows[0];
    if (!face) return null;
    const mappingResult = await this.db.query<{ face_id: string }>(
      `SELECT face_id FROM cloud_face_mappings WHERE owner_user_id = $1 AND known_face_id = $2`,
      [owner, id],
    );
    const faceIds = new Set<string>(mappingResult.rows.map((row) => row.face_id));
    if (face.rekognition_face_id) {
      faceIds.add(face.rekognition_face_id);
    }
    return {
      id: face.id,
      provider: face.provider,
      collectionId: face.rekognition_collection_id ?? face.collection_id ?? null,
      faceIds: [...faceIds],
    };
  }

  async removeRekognition(
    owner: string,
    id: string,
    collectionId: string,
    ip: string | null,
    agent: string | null,
  ): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [owner]);
      const result = await client.query<{ id: string; provider: string }>(
        'SELECT id, provider FROM known_faces WHERE id = $1 AND owner_user_id = $2 FOR UPDATE',
        [id, owner],
      );
      const face = result.rows[0];
      if (!face) throw faceError(404, 'NOT_FOUND', 'Không tìm thấy người quen.');
      if (face.provider !== 'REKOGNITION') {
        throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Provider này không khớp Rekognition.');
      }
      await client.query(
        'DELETE FROM cloud_face_mappings WHERE owner_user_id = $1 AND known_face_id = $2',
        [owner, id],
      );
      await client.query('DELETE FROM known_faces WHERE id = $1 AND owner_user_id = $2', [
        id,
        owner,
      ]);
      await this.upsertCloudCollection(client, owner, collectionId);
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, ip_address, user_agent)
        VALUES ($1, 'KNOWN_FACE_DELETED', 'KNOWN_FACE', $2, $3, $4)`,
        [owner, id, ip, agent?.slice(0, 512) ?? null],
      );
    });
  }

  async deactivateRekognition(
    owner: string,
    id: string,
    collectionId: string,
    actorId = owner,
  ): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [owner]);
      const result = await client.query<{ id: string; provider: string }>(
        'SELECT id, provider FROM known_faces WHERE id = $1 AND owner_user_id = $2 FOR UPDATE',
        [id, owner],
      );
      const face = result.rows[0];
      if (!face) throw faceError(404, 'NOT_FOUND', 'Không tìm thấy người quen.');
      if (face.provider !== 'REKOGNITION') {
        throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Provider này không khớp Rekognition.');
      }
      await client.query(
        'DELETE FROM cloud_face_mappings WHERE owner_user_id = $1 AND known_face_id = $2',
        [owner, id],
      );
      await client.query(
        'UPDATE known_faces SET is_active = FALSE WHERE id = $1 AND owner_user_id = $2',
        [id, owner],
      );
      await this.upsertCloudCollection(client, owner, collectionId);
      await client.query(
        "INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'KNOWN_FACE_DEACTIVATED','KNOWN_FACE',$2)",
        [actorId, id],
      );
    });
  }

  async replaceRekognitionFaces(
    owner: string,
    id: string,
    input: {
      collectionId: string;
      faceIds: string[];
      modelVersion: string;
      sourceImageCount: number;
      actorId?: string;
    },
  ): Promise<{ previousCollectionId: string; previousFaceIds: string[] }> {
    const primaryFaceId = input.faceIds[0];
    if (!primaryFaceId) {
      throw new Error('At least one Rekognition FaceId is required');
    }
    return this.db.transaction(async (client) => {
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [owner]);
      const existing = await client.query<{
        provider: string;
        rekognition_face_id: string | null;
        rekognition_collection_id: string | null;
      }>(
        'SELECT provider, rekognition_face_id, rekognition_collection_id FROM known_faces WHERE id = $1 AND owner_user_id = $2 FOR UPDATE',
        [id, owner],
      );
      const row = existing.rows[0];
      if (!row) throw faceError(404, 'NOT_FOUND', 'Không tìm thấy người quen.');
      if (row.provider !== 'REKOGNITION') {
        throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Provider này không khớp Rekognition.');
      }
      const existingMappings = await client.query<{ face_id: string }>(
        'SELECT face_id FROM cloud_face_mappings WHERE owner_user_id = $1 AND known_face_id = $2',
        [owner, id],
      );
      const previousFaceIds = new Set<string>(existingMappings.rows.map((item) => item.face_id));
      if (row.rekognition_face_id) {
        previousFaceIds.add(row.rekognition_face_id);
      }

      await client.query(
        'DELETE FROM cloud_face_mappings WHERE owner_user_id = $1 AND known_face_id = $2',
        [owner, id],
      );
      await client.query(
        `UPDATE known_faces
        SET rekognition_face_id = $3,
            rekognition_collection_id = $4,
            model_version = $5,
            source_image_count = $6,
            is_active = TRUE
        WHERE id = $1 AND owner_user_id = $2`,
        [id, owner, primaryFaceId, input.collectionId, input.modelVersion, input.sourceImageCount],
      );
      await this.upsertCloudCollection(client, owner, input.collectionId);
      for (const faceId of input.faceIds) {
        await client.query(
          `INSERT INTO cloud_face_mappings (owner_user_id, face_id, known_face_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (owner_user_id, face_id) DO UPDATE SET known_face_id = EXCLUDED.known_face_id`,
          [owner, faceId, id],
        );
      }
      await client.query(
        "INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'KNOWN_FACE_UPDATED','KNOWN_FACE',$2)",
        [input.actorId ?? owner, id],
      );
      const newFaceSet = new Set(input.faceIds);
      return {
        previousCollectionId: row.rekognition_collection_id ?? input.collectionId,
        previousFaceIds: [...previousFaceIds].filter((faceId) => !newFaceSet.has(faceId)),
      };
    });
  }

  private async upsertCloudCollection(
    client: PoolClient,
    owner: string,
    collectionId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO cloud_face_collections (owner_user_id, collection_id, version)
      VALUES ($1, $2, 1)
      ON CONFLICT (owner_user_id)
      DO UPDATE SET
        collection_id = EXCLUDED.collection_id,
        version = cloud_face_collections.version + 1`,
      [owner, collectionId],
    );
  }

  private async bumpCloudCollectionVersion(client: PoolClient, owner: string): Promise<void> {
    await client.query(
      `UPDATE cloud_face_collections SET version = version + 1 WHERE owner_user_id = $1`,
      [owner],
    );
  }

  private async bump(
    client: PoolClient,
    owner: string,
    model: string,
    dimension: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO face_collection_sync (owner_user_id, model_version, embedding_dim)
      VALUES ($1,$2,$3) ON CONFLICT (owner_user_id, model_version)
      DO UPDATE SET version = face_collection_sync.version + 1`,
      [owner, model, dimension],
    );
  }

  async snapshots(owner?: string): Promise<CollectionRequest[]> {
    return this.db.transaction(async (client) => {
      // Một snapshot nhất quán dù đăng ký/xóa chạy đồng thời.
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const states = await client.query<SyncRow>(
        `SELECT owner_user_id, model_version, embedding_dim, version
        FROM face_collection_sync ${owner ? 'WHERE owner_user_id = $1' : ''}
        ORDER BY last_synced_at NULLS FIRST, owner_user_id LIMIT 100`,
        owner ? [owner] : [],
      );
      const snapshots: CollectionRequest[] = [];
      for (const state of states.rows) {
        const faces = await client.query<{
          id: string;
          person_name: string;
          embedding: Buffer;
          embedding_dim: number;
        }>(
          `SELECT id, person_name, embedding, embedding_dim FROM known_faces
           WHERE owner_user_id = $1 AND model_version = $2 AND provider = 'LOCAL' AND is_active ORDER BY id LIMIT 1001`,
          [state.owner_user_id, state.model_version],
        );
        if (
          faces.rows.length > 1000 ||
          faces.rows.some((face) => face.embedding_dim !== state.embedding_dim)
        )
          throw new Error('Invalid collection');
        snapshots.push({
          ownerScopeId: state.owner_user_id,
          modelVersion: state.model_version,
          embeddingDim: state.embedding_dim,
          version: state.version,
          faces: faces.rows.map((face) => ({
            knownFaceId: face.id,
            personName: face.person_name,
            embeddingBase64: face.embedding.toString('base64'),
          })),
        });
      }
      return snapshots;
    });
  }

  async markSynced(snapshot: CollectionRequest): Promise<void> {
    await this.db.query(
      `UPDATE face_collection_sync SET synced_version = $3, last_synced_at = NOW()
      WHERE owner_user_id = $1 AND model_version = $2 AND version = $3`,
      [snapshot.ownerScopeId, snapshot.modelVersion, snapshot.version],
    );
  }

  async isReady(owner: string): Promise<boolean> {
    const result = await this.db.query<{ pending: boolean }>(
      `SELECT EXISTS (
      SELECT 1 FROM face_collection_sync WHERE owner_user_id = $1 AND synced_version <> version) AS pending`,
      [owner],
    );
    return result.rows[0]?.pending === false;
  }
}
