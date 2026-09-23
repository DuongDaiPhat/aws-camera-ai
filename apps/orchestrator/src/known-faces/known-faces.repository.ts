import { Injectable } from '@nestjs/common';
import type { components } from '@cam/contracts';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
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
  COALESCE(s.synced_version = s.version, FALSE) AS ready`;
const JOIN_SYNC = `LEFT JOIN face_collection_sync s ON s.owner_user_id = f.owner_user_id AND s.model_version = f.model_version`;

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
        // Chưa có household mapping: chỉ cho phép liên kết chính tài khoản đang đăng ký.
        if (dto.linkedUserId && dto.linkedUserId !== owner)
          throw faceError(403, 'FORBIDDEN', 'Tài khoản liên kết ngoài phạm vi.');
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
