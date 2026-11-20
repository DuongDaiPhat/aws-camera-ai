import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  CreateCollectionCommand,
  DeleteFacesCommand,
  DetectFacesCommand,
  IndexFacesCommand,
  type RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import {
  ALLOWED_REKOGNITION_COLLECTION_PREFIXES,
  buildRekognitionCollectionId,
  readFaceConfig,
  validateRekognitionCollectionPrefix,
} from '../src/known-faces/face-config';
import {
  FACE_ENROLLMENT,
  RekognitionFaceEnrollmentService,
  type IRekognitionFaceEnrollment,
} from '../src/known-faces/rekognition-face-enrollment.service';
import { FACE_INFERENCE } from '../src/known-faces/face-inference.interface';
import { FaceCollectionSyncService } from '../src/known-faces/face-collection-sync.service';
import { KnownFacesModule } from '../src/known-faces/known-faces.module';
import { KnownFacesRepository } from '../src/known-faces/known-faces.repository';
import { KnownFacesService } from '../src/known-faces/known-faces.service';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const FACE_ROW_ID = '22222222-2222-4222-8222-222222222222';
const STAGING_PREFIX = 'argusai-staging-owner-';

function jpegUpload() {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  return { buffer, size: buffer.length };
}

function rekognitionConfig(overrides: Record<string, string | undefined> = {}) {
  return new ConfigService({
    FACE_PROVIDER: 'rekognition',
    AWS_REGION: 'ap-southeast-1',
    REKOGNITION_COLLECTION_PREFIX: STAGING_PREFIX,
    ...overrides,
  });
}

describe('US-24 face config validation', () => {
  it('defaults to local provider without requiring AWS settings', () => {
    expect(readFaceConfig(new ConfigService({}))).toEqual({ provider: 'local' });
    expect(readFaceConfig(new ConfigService({ FACE_PROVIDER: 'local' }))).toEqual({
      provider: 'local',
    });
  });

  it('validates all allowed environment prefixes and fails fast on missing or invalid cloud config', () => {
    for (const prefix of ALLOWED_REKOGNITION_COLLECTION_PREFIXES) {
      const cfg = readFaceConfig(rekognitionConfig({ REKOGNITION_COLLECTION_PREFIX: prefix }));
      expect(cfg).toEqual({
        provider: 'rekognition',
        region: 'ap-southeast-1',
        collectionPrefix: prefix,
      });
      expect(buildRekognitionCollectionId(prefix, OWNER_ID)).toBe(`${prefix}${OWNER_ID}`);
    }

    expect(() => readFaceConfig(new ConfigService({ FACE_PROVIDER: 'azure' }))).toThrow(
      'FACE_PROVIDER must be local or rekognition',
    );
    expect(() =>
      readFaceConfig(
        new ConfigService({
          FACE_PROVIDER: 'rekognition',
          REKOGNITION_COLLECTION_PREFIX: STAGING_PREFIX,
        }),
      ),
    ).toThrow('Missing cloud configuration: AWS_REGION');
    expect(() =>
      readFaceConfig(
        new ConfigService({
          FACE_PROVIDER: 'rekognition',
          AWS_REGION: 'ap-southeast-1',
        }),
      ),
    ).toThrow('Missing cloud configuration: REKOGNITION_COLLECTION_PREFIX');
    expect(() =>
      readFaceConfig(rekognitionConfig({ REKOGNITION_COLLECTION_PREFIX: 'custom-owner-' })),
    ).toThrow('Invalid REKOGNITION_COLLECTION_PREFIX');
    expect(() => validateRekognitionCollectionPrefix('', { allowDefault: true })).toThrow(
      'Missing cloud configuration: REKOGNITION_COLLECTION_PREFIX',
    );
  });
});

describe('US-24 RekognitionFaceEnrollmentService', () => {
  it('creates collections idempotently when ResourceAlreadyExistsException is thrown', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        Object.assign(new Error('already exists'), { name: 'ResourceAlreadyExistsException' }),
      );
    const service = new RekognitionFaceEnrollmentService(rekognitionConfig(), {
      send,
    } as unknown as RekognitionClient);

    await expect(service.ensureCollection(OWNER_ID)).resolves.toBe(`${STAGING_PREFIX}${OWNER_ID}`);
    await expect(service.ensureCollection(OWNER_ID)).resolves.toBe(`${STAGING_PREFIX}${OWNER_ID}`);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(CreateCollectionCommand);
  });

  it('enforces single-face validation during enrollment and rejects 0 or >1 faces cleanly', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ FaceDetails: [] })
      .mockResolvedValueOnce({
        FaceDetails: [
          { BoundingBox: { Left: -0.05, Top: 0.1, Width: 0.4, Height: 0.4 } },
          { BoundingBox: { Left: 0.5, Top: 0.2, Width: 0.3, Height: 1.2 } },
        ],
      });
    const service = new RekognitionFaceEnrollmentService(rekognitionConfig(), {
      send,
    } as unknown as RekognitionClient);

    await expect(service.validateSingleFaces([jpegUpload(), jpegUpload()])).rejects.toMatchObject({
      status: 422,
      response: {
        error: {
          code: 'NO_FACE_DETECTED',
          details: {
            images: [
              { imageIndex: 0, code: 'NO_FACE_DETECTED', faces: [] },
              {
                imageIndex: 1,
                code: 'MULTIPLE_FACES',
                faces: [
                  { faceIndex: 0, boundingBox: { x: 0, y: 0.1, width: 0.4, height: 0.4 } },
                  { faceIndex: 1, boundingBox: { x: 0.5, y: 0.2, width: 0.3, height: 1 } },
                ],
              },
            ],
          },
        },
      },
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DetectFacesCommand);
  });

  it('indexes multiple single-face images and compensates via DeleteFaces if a later image fails', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({}) // CreateCollection
      .mockResolvedValueOnce({
        FaceModelVersion: '7.0',
        FaceRecords: [{ Face: { FaceId: 'face-1' } }],
      })
      .mockResolvedValueOnce({
        FaceModelVersion: '7.0',
        FaceRecords: [
          {
            Face: {
              FaceId: 'face-2a',
              BoundingBox: { Left: 0.1, Top: 0.1, Width: 0.2, Height: 0.2 },
            },
          },
          {
            Face: {
              FaceId: 'face-2b',
              BoundingBox: { Left: 0.5, Top: 0.1, Width: 0.2, Height: 0.2 },
            },
          },
        ],
      })
      .mockResolvedValueOnce({ DeletedFaces: ['face-1', 'face-2a', 'face-2b'] }); // compensating DeleteFaces

    const service = new RekognitionFaceEnrollmentService(rekognitionConfig(), {
      send,
    } as unknown as RekognitionClient);

    await expect(service.indexFaces(OWNER_ID, [jpegUpload(), jpegUpload()])).rejects.toMatchObject({
      status: 422,
      response: { error: { code: 'MULTIPLE_FACES' } },
    });

    const deleteCommand = send.mock.calls[3]?.[0];
    expect(deleteCommand).toBeInstanceOf(DeleteFacesCommand);
    expect((deleteCommand as DeleteFacesCommand).input).toEqual({
      CollectionId: `${STAGING_PREFIX}${OWNER_ID}`,
      FaceIds: ['face-1', 'face-2a', 'face-2b'],
    });
  });

  it('returns indexed faceIds and treats ResourceNotFoundException on DeleteFaces as idempotent', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({}) // CreateCollection
      .mockResolvedValueOnce({
        FaceModelVersion: '7.0',
        FaceRecords: [{ Face: { FaceId: 'face-a' } }],
      })
      .mockResolvedValueOnce({
        FaceModelVersion: '7.0',
        FaceRecords: [{ Face: { FaceId: 'face-b' } }],
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }),
      );

    const service = new RekognitionFaceEnrollmentService(rekognitionConfig(), {
      send,
    } as unknown as RekognitionClient);

    const indexed = await service.indexFaces(OWNER_ID, [jpegUpload(), jpegUpload()]);
    expect(indexed).toEqual({
      collectionId: `${STAGING_PREFIX}${OWNER_ID}`,
      faceIds: ['face-a', 'face-b'],
      modelVersion: 'rekognition-7.0',
    });
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(IndexFacesCommand);
    await expect(service.deleteFaces(indexed.collectionId, ['face-a'])).resolves.toEqual([]);
  });
});

describe('US-24 KnownFacesService Rekognition orchestration & reconciliation', () => {
  let pool: Pool;
  let repository: KnownFacesRepository;
  let inference: { embed: jest.Mock; sync: jest.Mock };
  let rekognition: jest.Mocked<IRekognitionFaceEnrollment>;
  let sync: FaceCollectionSyncService;
  let service: KnownFacesService;

  beforeEach(() => {
    pool = new Pool();
    repository = new KnownFacesRepository(new DatabaseService(pool));
    inference = { embed: jest.fn(), sync: jest.fn() };
    rekognition = {
      collectionPrefix: STAGING_PREFIX,
      collectionIdForOwner: jest.fn((owner: string) => `${STAGING_PREFIX}${owner}`),
      ensureCollection: jest.fn().mockResolvedValue(`${STAGING_PREFIX}${OWNER_ID}`),
      validateSingleFaces: jest.fn().mockResolvedValue(undefined),
      indexFaces: jest.fn().mockResolvedValue({
        collectionId: `${STAGING_PREFIX}${OWNER_ID}`,
        faceIds: ['rek-face-1', 'rek-face-2'],
        modelVersion: 'rekognition-7.0',
      }),
      deleteFaces: jest.fn().mockResolvedValue(['rek-face-1', 'rek-face-2']),
    };
    const cfg = rekognitionConfig();
    sync = new FaceCollectionSyncService(repository, inference, cfg);
    service = new KnownFacesService(repository, inference, sync, cfg, rekognition);
    jest.spyOn(repository, 'householdOwner').mockResolvedValue(OWNER_ID);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await pool.end();
  });

  it('enrolls faces via Rekognition without calling local AI inference and zeroes image buffers', async () => {
    jest.spyOn(repository, 'precheckCreate').mockResolvedValue(undefined);
    const createRek = jest.spyOn(repository, 'createRekognition').mockResolvedValue(FACE_ROW_ID);
    jest.spyOn(repository, 'list').mockResolvedValue([
      {
        id: FACE_ROW_ID,
        personName: 'Ba Noi',
        provider: 'REKOGNITION',
        modelVersion: 'rekognition-7.0',
        sourceImageCount: 2,
        isActive: true,
        createdAt: new Date().toISOString(),
        recognitionStatus: 'READY',
      },
    ]);

    const files = [jpegUpload(), jpegUpload()];
    const created = await service.create(OWNER_ID, { personName: 'Ba Noi' }, files);

    expect(created.provider).toBe('REKOGNITION');
    expect(created.recognitionStatus).toBe('READY');
    expect(inference.embed).not.toHaveBeenCalled();
    expect(inference.sync).not.toHaveBeenCalled();
    expect(rekognition.validateSingleFaces).toHaveBeenCalledWith(files);
    expect(rekognition.indexFaces).toHaveBeenCalledWith(OWNER_ID, files);
    expect(createRek).toHaveBeenCalledWith(
      OWNER_ID,
      { personName: 'Ba Noi' },
      {
        collectionId: `${STAGING_PREFIX}${OWNER_ID}`,
        faceIds: ['rek-face-1', 'rek-face-2'],
        modelVersion: 'rekognition-7.0',
        sourceImageCount: 2,
      },
    );
    expect(files.every((file) => file.buffer.every((byte) => byte === 0))).toBe(true);
  });

  it('runs compensating DeleteFaces cleanup when DB persistence fails after IndexFaces', async () => {
    jest.spyOn(repository, 'precheckCreate').mockResolvedValue(undefined);
    jest
      .spyOn(repository, 'createRekognition')
      .mockRejectedValue(new Error('DB connection terminated'));

    const files = [jpegUpload()];
    await expect(service.create(OWNER_ID, { personName: 'Ong Ngoai' }, files)).rejects.toThrow(
      'DB connection terminated',
    );

    expect(rekognition.deleteFaces).toHaveBeenCalledWith(`${STAGING_PREFIX}${OWNER_ID}`, [
      'rek-face-1',
      'rek-face-2',
    ]);
    expect(files[0]?.buffer.every((byte) => byte === 0)).toBe(true);
  });

  it('deletes Rekognition faces and removes DB mapping/row while bumping collection version', async () => {
    jest.spyOn(repository, 'findRekognitionTarget').mockResolvedValue({
      id: FACE_ROW_ID,
      provider: 'REKOGNITION',
      collectionId: `${STAGING_PREFIX}${OWNER_ID}`,
      faceIds: ['rek-face-1', 'rek-face-2'],
    });
    const removeRek = jest.spyOn(repository, 'removeRekognition').mockResolvedValue(undefined);

    const ready = await service.remove(OWNER_ID, FACE_ROW_ID, '127.0.0.1', 'jest');

    expect(ready).toBe(true);
    expect(rekognition.deleteFaces).toHaveBeenCalledWith(`${STAGING_PREFIX}${OWNER_ID}`, [
      'rek-face-1',
      'rek-face-2',
    ]);
    expect(removeRek).toHaveBeenCalledWith(
      OWNER_ID,
      FACE_ROW_ID,
      `${STAGING_PREFIX}${OWNER_ID}`,
      '127.0.0.1',
      'jest',
    );
  });

  it('replaces photos safely: indexes new, swaps DB, then deletes old (and compensates on DB error)', async () => {
    jest.spyOn(repository, 'findRekognitionTarget').mockResolvedValue({
      id: FACE_ROW_ID,
      provider: 'REKOGNITION',
      collectionId: `${STAGING_PREFIX}${OWNER_ID}`,
      faceIds: ['old-face-1'],
    });
    jest.spyOn(repository, 'replaceRekognitionFaces').mockResolvedValueOnce({
      previousCollectionId: `${STAGING_PREFIX}${OWNER_ID}`,
      previousFaceIds: ['old-face-1'],
    });
    jest.spyOn(repository, 'list').mockResolvedValue([
      {
        id: FACE_ROW_ID,
        personName: 'Ba Noi',
        provider: 'REKOGNITION',
        isActive: true,
        createdAt: new Date().toISOString(),
        recognitionStatus: 'READY',
      },
    ]);

    const updated = await service.replacePhotos(OWNER_ID, FACE_ROW_ID, [jpegUpload()]);
    expect(updated.id).toBe(FACE_ROW_ID);
    expect(rekognition.deleteFaces).toHaveBeenCalledWith(`${STAGING_PREFIX}${OWNER_ID}`, [
      'old-face-1',
    ]);

    rekognition.deleteFaces.mockClear();
    jest
      .spyOn(repository, 'replaceRekognitionFaces')
      .mockRejectedValueOnce(new Error('DB write failed'));
    await expect(service.replacePhotos(OWNER_ID, FACE_ROW_ID, [jpegUpload()])).rejects.toThrow(
      'DB write failed',
    );
    expect(rekognition.deleteFaces).toHaveBeenCalledWith(`${STAGING_PREFIX}${OWNER_ID}`, [
      'rek-face-1',
      'rek-face-2',
    ]);
  });

  it('deletes Rekognition faces when deactivating a known face', async () => {
    jest.spyOn(repository, 'findRekognitionTarget').mockResolvedValue({
      id: FACE_ROW_ID,
      provider: 'REKOGNITION',
      collectionId: `${STAGING_PREFIX}${OWNER_ID}`,
      faceIds: ['rek-face-1'],
    });
    const deactivateRek = jest
      .spyOn(repository, 'deactivateRekognition')
      .mockResolvedValue(undefined);
    jest.spyOn(repository, 'list').mockResolvedValue([
      {
        id: FACE_ROW_ID,
        personName: 'Ba Noi',
        provider: 'REKOGNITION',
        isActive: false,
        createdAt: new Date().toISOString(),
        recognitionStatus: 'SYNC_PENDING',
      },
    ]);

    const result = await service.deactivate(OWNER_ID, FACE_ROW_ID);
    expect(result.isActive).toBe(false);
    expect(rekognition.deleteFaces).toHaveBeenCalledWith(`${STAGING_PREFIX}${OWNER_ID}`, [
      'rek-face-1',
    ]);
    expect(deactivateRek).toHaveBeenCalledWith(
      OWNER_ID,
      FACE_ROW_ID,
      `${STAGING_PREFIX}${OWNER_ID}`,
      OWNER_ID,
    );
  });

  it('disables local AI sync loop when FACE_PROVIDER=rekognition', async () => {
    const snapshotsSpy = jest.spyOn(repository, 'snapshots');
    sync.onModuleInit();
    await expect(sync.sync(OWNER_ID)).resolves.toBe(true);
    expect(snapshotsSpy).not.toHaveBeenCalled();
    sync.onModuleDestroy();
  });
});

@Global()
@Module({
  providers: [
    {
      provide: DatabaseService,
      useValue: { query: jest.fn(), transaction: jest.fn() },
    },
  ],
  exports: [DatabaseService],
})
class MockDatabaseModule {}

describe('US-24 KnownFacesModule DI & fail-fast startup', () => {
  it('wires RekognitionFaceEnrollmentService and disables local inference in rekognition mode', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MockDatabaseModule,
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              FACE_PROVIDER: 'rekognition',
              AWS_REGION: 'ap-southeast-1',
              REKOGNITION_COLLECTION_PREFIX: STAGING_PREFIX,
            }),
          ],
        }),
        KnownFacesModule,
      ],
    }).compile();

    try {
      const enrollment = moduleRef.get<IRekognitionFaceEnrollment>(FACE_ENROLLMENT);
      const localInference = moduleRef.get(FACE_INFERENCE);
      expect(enrollment).toBeInstanceOf(RekognitionFaceEnrollmentService);
      expect(enrollment.collectionPrefix).toBe(STAGING_PREFIX);
      await expect(localInference.embed(Buffer.alloc(0), null)).rejects.toThrow('disabled');
    } finally {
      await moduleRef.close();
    }
  });

  it('fails startup fast when FACE_PROVIDER=rekognition is missing REKOGNITION_COLLECTION_PREFIX', async () => {
    await expect(
      Test.createTestingModule({
        imports: [
          MockDatabaseModule,
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => ({
                FACE_PROVIDER: 'rekognition',
                AWS_REGION: 'ap-southeast-1',
              }),
            ],
          }),
          KnownFacesModule,
        ],
      }).compile(),
    ).rejects.toThrow('Missing cloud configuration: REKOGNITION_COLLECTION_PREFIX');
  });
});
