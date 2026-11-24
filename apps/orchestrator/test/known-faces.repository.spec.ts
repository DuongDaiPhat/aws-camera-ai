import type { PoolClient } from 'pg';
import type { DatabaseService } from '../src/database/database.service';
import { KnownFacesRepository } from '../src/known-faces/known-faces.repository';

const OWNER = '11111111-1111-4111-8111-111111111111';
const FACE_ID = '22222222-2222-4222-8222-222222222222';
const VIEWER_ID = '33333333-3333-4333-8333-333333333333';

function makeDb() {
  const clientQuery = jest.fn();
  const dbQuery = jest.fn();
  const db = {
    query: dbQuery,
    transaction: jest.fn(async (work: (c: PoolClient) => Promise<unknown>) =>
      work({ query: clientQuery } as unknown as PoolClient),
    ),
  } as unknown as DatabaseService;
  return { db, dbQuery, clientQuery };
}

describe('KnownFacesRepository', () => {
  it('resolves householdOwner and lists faces with recognitionStatus', async () => {
    const { db, dbQuery } = makeDb();
    const repo = new KnownFacesRepository(db);

    dbQuery
      .mockResolvedValueOnce({ rows: [{ owner: OWNER }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: FACE_ID,
            person_name: 'Alice',
            relationship: 'Mom',
            linked_user_id: VIEWER_ID,
            provider: 'REKOGNITION',
            model_version: 'rekognition-7.0',
            source_image_count: 2,
            is_active: true,
            created_at: new Date('2026-11-20T00:00:00Z'),
            ready: true,
          },
          {
            id: 'f2',
            person_name: 'Bob',
            relationship: null,
            linked_user_id: null,
            provider: 'LOCAL',
            model_version: 'local-1',
            source_image_count: 1,
            is_active: false,
            created_at: new Date('2026-11-20T00:00:00Z'),
            ready: false,
          },
        ],
      });

    await expect(repo.householdOwner('actor')).resolves.toBe(OWNER);
    await expect(repo.householdOwner('missing')).rejects.toMatchObject({ status: 401 });
    const faces = await repo.list(OWNER);
    expect(faces[0]?.recognitionStatus).toBe('READY');
    expect(faces[1]?.recognitionStatus).toBe('SYNC_PENDING');
  });

  it('handles update branches for REKOGNITION, LOCAL, linkedUserId, and not found', async () => {
    const { db, clientQuery } = makeDb();
    const repo = new KnownFacesRepository(db);

    // Forbidden linkedUserId
    clientQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      repo.update(OWNER, FACE_ID, { personName: 'Alice', linkedUserId: VIEWER_ID }),
    ).rejects.toMatchObject({ status: 403 });

    // Not found
    clientQuery
      .mockResolvedValueOnce({ rows: [{ id: VIEWER_ID }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      repo.update(OWNER, FACE_ID, { personName: 'Alice', linkedUserId: VIEWER_ID }),
    ).rejects.toMatchObject({ status: 404 });

    // REKOGNITION bumpCloudCollectionVersion
    clientQuery
      .mockResolvedValueOnce({
        rows: [{ provider: 'REKOGNITION', model_version: 'rekognition-7.0', embedding_dim: null }],
      })
      .mockResolvedValue({ rows: [] });
    await repo.update(OWNER, FACE_ID, { personName: ' Alice ', relationship: '  ' });

    // LOCAL bump
    clientQuery
      .mockResolvedValueOnce({
        rows: [{ provider: 'LOCAL', model_version: 'm1', embedding_dim: 512 }],
      })
      .mockResolvedValue({ rows: [] });
    await repo.update(OWNER, FACE_ID, { personName: 'Bob' });
  });

  it('handles local create and remove branches', async () => {
    const { db, clientQuery } = makeDb();
    const repo = new KnownFacesRepository(db);
    const emb = Buffer.from([1, 2, 3, 4]);

    // Limit reached
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '1000' }] });
    await expect(repo.create(OWNER, { personName: 'A' }, emb, 1, 'm1', 1)).rejects.toMatchObject({
      status: 409,
    });

    // Forbidden linkedUserId
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ allowed: false }] });
    await expect(
      repo.create(OWNER, { personName: 'A', linkedUserId: VIEWER_ID }, emb, 1, 'm1', 1),
    ).rejects.toMatchObject({ status: 403 });

    // Missing returned ID
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(repo.create(OWNER, { personName: 'A' }, emb, 1, 'm1', 1)).rejects.toThrow(
      'Insert did not return ID',
    );

    // Duplicate 23505 -> 409, other error -> rethrow
    clientQuery.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(repo.create(OWNER, { personName: 'A' }, emb, 1, 'm1', 1)).rejects.toMatchObject({
      status: 409,
    });
    clientQuery.mockRejectedValueOnce(new Error('db err'));
    await expect(repo.create(OWNER, { personName: 'A' }, emb, 1, 'm1', 1)).rejects.toThrow(
      'db err',
    );

    // Success
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ id: FACE_ID }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      repo.create(
        OWNER,
        { personName: 'A', relationship: 'Son', linkedUserId: VIEWER_ID },
        emb,
        1,
        'm1',
        1,
      ),
    ).resolves.toBe(FACE_ID);

    // Local remove: 404, non-LOCAL 503, success
    clientQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await expect(repo.remove(OWNER, FACE_ID, null, null)).rejects.toMatchObject({ status: 404 });

    clientQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ model_version: 'r', embedding_dim: 0, provider: 'REKOGNITION' }],
    });
    await expect(repo.remove(OWNER, FACE_ID, null, null)).rejects.toMatchObject({ status: 503 });

    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ model_version: 'm1', embedding_dim: 1, provider: 'LOCAL' }],
      })
      .mockResolvedValue({ rows: [] });
    await repo.remove(OWNER, FACE_ID, '127.0.0.1', 'agent');
  });

  it('handles precheckCreate, createRekognition, findRekognitionTarget, removeRekognition, deactivateRekognition, and replaceRekognitionFaces', async () => {
    const { db, dbQuery, clientQuery } = makeDb();
    const repo = new KnownFacesRepository(db);

    // precheckCreate: limit, duplicate, forbidden linkedUserId, pass
    dbQuery.mockResolvedValueOnce({ rows: [{ count: '1000' }] });
    await expect(repo.precheckCreate(OWNER, { personName: 'A' })).rejects.toMatchObject({
      status: 409,
    });

    dbQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: FACE_ID }] });
    await expect(repo.precheckCreate(OWNER, { personName: 'A' })).rejects.toMatchObject({
      status: 409,
    });

    dbQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ allowed: false }] });
    await expect(
      repo.precheckCreate(OWNER, { personName: 'A', linkedUserId: VIEWER_ID }),
    ).rejects.toMatchObject({ status: 403 });

    dbQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ allowed: true }] });
    await repo.precheckCreate(OWNER, { personName: 'A', linkedUserId: VIEWER_ID });

    // createRekognition: empty faceIds, limit, forbidden, missing ID, 23505, success
    await expect(
      repo.createRekognition(
        OWNER,
        { personName: 'A' },
        {
          collectionId: 'c1',
          faceIds: [],
          modelVersion: 'r7',
          sourceImageCount: 1,
        },
      ),
    ).rejects.toThrow('At least one Rekognition FaceId is required');

    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '1000' }] });
    await expect(
      repo.createRekognition(
        OWNER,
        { personName: 'A' },
        {
          collectionId: 'c1',
          faceIds: ['rf1'],
          modelVersion: 'r7',
          sourceImageCount: 1,
        },
      ),
    ).rejects.toMatchObject({ status: 409 });

    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ allowed: false }] });
    await expect(
      repo.createRekognition(
        OWNER,
        { personName: 'A', linkedUserId: VIEWER_ID },
        {
          collectionId: 'c1',
          faceIds: ['rf1'],
          modelVersion: 'r7',
          sourceImageCount: 1,
        },
      ),
    ).rejects.toMatchObject({ status: 403 });

    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      repo.createRekognition(
        OWNER,
        { personName: 'A' },
        {
          collectionId: 'c1',
          faceIds: ['rf1'],
          modelVersion: 'r7',
          sourceImageCount: 1,
        },
      ),
    ).rejects.toThrow('Insert did not return ID');

    clientQuery.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(
      repo.createRekognition(
        OWNER,
        { personName: 'A' },
        {
          collectionId: 'c1',
          faceIds: ['rf1'],
          modelVersion: 'r7',
          sourceImageCount: 1,
        },
      ),
    ).rejects.toMatchObject({ status: 409 });

    clientQuery.mockRejectedValueOnce(new Error('other'));
    await expect(
      repo.createRekognition(
        OWNER,
        { personName: 'A' },
        {
          collectionId: 'c1',
          faceIds: ['rf1'],
          modelVersion: 'r7',
          sourceImageCount: 1,
        },
      ),
    ).rejects.toThrow('other');

    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ id: FACE_ID }] })
      .mockResolvedValue({ rows: [] });
    await expect(
      repo.createRekognition(
        OWNER,
        { personName: 'A', linkedUserId: VIEWER_ID },
        {
          collectionId: 'c1',
          faceIds: ['rf1', 'rf2'],
          modelVersion: 'r7',
          sourceImageCount: 2,
        },
      ),
    ).resolves.toBe(FACE_ID);

    // findRekognitionTarget
    dbQuery.mockResolvedValueOnce({ rows: [] });
    await expect(repo.findRekognitionTarget(OWNER, FACE_ID)).resolves.toBeNull();

    dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: FACE_ID,
            provider: 'REKOGNITION',
            rekognition_face_id: 'rf-primary',
            rekognition_collection_id: null,
            collection_id: 'c-col',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ face_id: 'rf1' }, { face_id: 'rf-primary' }] });
    await expect(repo.findRekognitionTarget(OWNER, FACE_ID)).resolves.toEqual({
      id: FACE_ID,
      provider: 'REKOGNITION',
      collectionId: 'c-col',
      faceIds: ['rf1', 'rf-primary'],
    });

    // removeRekognition: 404, non-REKOGNITION 503, success
    clientQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await expect(repo.removeRekognition(OWNER, FACE_ID, 'c1', null, null)).rejects.toMatchObject({
      status: 404,
    });
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: FACE_ID, provider: 'LOCAL' }] });
    await expect(repo.removeRekognition(OWNER, FACE_ID, 'c1', null, null)).rejects.toMatchObject({
      status: 503,
    });
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: FACE_ID, provider: 'REKOGNITION' }] })
      .mockResolvedValue({ rows: [] });
    await repo.removeRekognition(OWNER, FACE_ID, 'c1', '1.1.1.1', 'ua');

    // deactivateRekognition: 404, non-REKOGNITION 503, success
    clientQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await expect(repo.deactivateRekognition(OWNER, FACE_ID, 'c1')).rejects.toMatchObject({
      status: 404,
    });
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: FACE_ID, provider: 'LOCAL' }] });
    await expect(repo.deactivateRekognition(OWNER, FACE_ID, 'c1')).rejects.toMatchObject({
      status: 503,
    });
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: FACE_ID, provider: 'REKOGNITION' }] })
      .mockResolvedValue({ rows: [] });
    await repo.deactivateRekognition(OWNER, FACE_ID, 'c1', 'actor-1');

    // replaceRekognitionFaces: empty faceIds, 404, non-REKOGNITION 503, success
    await expect(
      repo.replaceRekognitionFaces(OWNER, FACE_ID, {
        collectionId: 'c1',
        faceIds: [],
        modelVersion: 'r7',
        sourceImageCount: 1,
      }),
    ).rejects.toThrow('At least one Rekognition FaceId is required');
    clientQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await expect(
      repo.replaceRekognitionFaces(OWNER, FACE_ID, {
        collectionId: 'c1',
        faceIds: ['new-1'],
        modelVersion: 'r7',
        sourceImageCount: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ provider: 'LOCAL' }] });
    await expect(
      repo.replaceRekognitionFaces(OWNER, FACE_ID, {
        collectionId: 'c1',
        faceIds: ['new-1'],
        modelVersion: 'r7',
        sourceImageCount: 1,
      }),
    ).rejects.toMatchObject({ status: 503 });

    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            provider: 'REKOGNITION',
            rekognition_face_id: 'old-primary',
            rekognition_collection_id: 'old-col',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ face_id: 'old-1' }, { face_id: 'new-1' }] })
      .mockResolvedValue({ rows: [] });
    await expect(
      repo.replaceRekognitionFaces(OWNER, FACE_ID, {
        collectionId: 'c1',
        faceIds: ['new-1'],
        modelVersion: 'r7',
        sourceImageCount: 1,
        actorId: 'actor-1',
      }),
    ).resolves.toEqual({
      previousCollectionId: 'old-col',
      previousFaceIds: ['old-1', 'old-primary'],
    });
  });

  it('handles snapshots, markSynced, and isReady', async () => {
    const { db, dbQuery, clientQuery } = makeDb();
    const repo = new KnownFacesRepository(db);

    const emb = Buffer.from([1, 2, 3, 4]);
    clientQuery
      .mockResolvedValueOnce({ rows: [] }) // SET TRANSACTION
      .mockResolvedValueOnce({
        rows: [{ owner_user_id: OWNER, model_version: 'm1', embedding_dim: 1, version: 2 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: FACE_ID, person_name: 'Alice', embedding: emb, embedding_dim: 1 }],
      });
    const snaps = await repo.snapshots(OWNER);
    expect(snaps).toEqual([
      {
        ownerScopeId: OWNER,
        modelVersion: 'm1',
        embeddingDim: 1,
        version: 2,
        faces: [
          { knownFaceId: FACE_ID, personName: 'Alice', embeddingBase64: emb.toString('base64') },
        ],
      },
    ]);

    // Invalid collection when embedding_dim mismatches
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ owner_user_id: OWNER, model_version: 'm1', embedding_dim: 512, version: 1 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: FACE_ID, person_name: 'Alice', embedding: emb, embedding_dim: 1 }],
      });
    await expect(repo.snapshots()).rejects.toThrow('Invalid collection');

    dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ pending: false }] });
    await repo.markSynced(snaps[0]!);
    await expect(repo.isReady(OWNER)).resolves.toBe(true);
  });
});
