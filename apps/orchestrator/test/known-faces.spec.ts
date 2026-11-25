import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { HttpException, type ExecutionContext } from '@nestjs/common';
import { aggregate, selections, validateImages } from '../src/known-faces/embedding';
import { readPositiveFaceNumber } from '../src/known-faces/face-config';
import type { EmbeddingResult } from '../src/known-faces/face-inference.interface';
import { KnownFacesGuard } from '../src/known-faces/known-faces.guard';
import { KnownFacesService } from '../src/known-faces/known-faces.service';
import { KnownFacesRepository } from '../src/known-faces/known-faces.repository';
import { FaceCollectionSyncService } from '../src/known-faces/face-collection-sync.service';
import { DatabaseService } from '../src/database/database.service';
import { Pool } from 'pg';

function embedded(values = [1, 0]): EmbeddingResult {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return {
    embeddingBase64: bytes.toString('base64'),
    embeddingDim: values.length,
    modelVersion: 'test',
    provider: 'local',
    selectedFaceIndex: 0,
    faces: [{ x: 0, y: 0, width: 1, height: 1 }],
    error: null,
  };
}
function upload() {
  const buffer = Buffer.from([255, 216, 255, 0]);
  return { buffer, size: buffer.length };
}

describe('US-09 validation', () => {
  it('không chấp nhận 0/6 ảnh, MIME giả và dung lượng vượt giới hạn', () => {
    expect(() => validateImages([], 10, 20)).toThrow(HttpException);
    expect(() => validateImages(Array.from({ length: 6 }, upload), 10, 100)).toThrow();
    expect(() => validateImages([{ buffer: Buffer.from('not png'), size: 7 }], 10, 20)).toThrow();
    expect(() => validateImages([upload()], 3, 20)).toThrow();
    expect(() => validateImages([upload(), upload()], 10, 7)).toThrow();
    validateImages(Array.from({ length: 5 }, upload), 10, 100);
  });
  it('giữ index theo thứ tự ảnh và từ chối selection sai', () => {
    expect(selections('[1,null]', 2)).toEqual([1, null]);
    expect(selections(undefined, 2)).toEqual([null, null]);
    for (const value of ['{}', '[1,2,3]', '[-1]', '[1.2]', 'bad'])
      expect(() => selections(value, 2)).toThrow();
  });
  it('chuẩn hóa centroid, từ chối khác người/model/dimension và NaN', () => {
    const result = aggregate([embedded([3, 4]), embedded([3, 4])], 0.6);
    expect(result.embedding.readFloatLE(0)).toBeCloseTo(0.6);
    expect(result.embedding.readFloatLE(4)).toBeCloseTo(0.8);
    expect(() => aggregate([embedded(), embedded([0, 1])], 0.6)).toThrow();
    expect(() => aggregate([embedded(), { ...embedded(), modelVersion: 'other' }], 0.6)).toThrow();
    expect(() => aggregate([embedded([NaN, 1])], 0.6)).toThrow();
    expect(() => aggregate([embedded([0, 0])], 0.6)).toThrow();
    expect(() => aggregate([{ ...embedded(), embeddingDim: 3 }], 0.6)).toThrow();
  });
});

describe('US-09 orchestration', () => {
  const pool = new Pool();
  const repository = new KnownFacesRepository(new DatabaseService(pool));
  const inference = { embed: jest.fn(), sync: jest.fn() };
  const sync = new FaceCollectionSyncService(repository, inference, new ConfigService());
  const service = new KnownFacesService(repository, inference, sync, new ConfigService());
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(repository, 'householdOwner').mockResolvedValue('owner');
  });
  afterAll(async () => pool.end());

  it('thu thập lỗi nhiều ảnh, không ghi DB và dọn buffer', async () => {
    const create = jest.spyOn(repository, 'create');
    inference.embed.mockResolvedValue({
      ...embedded(),
      embeddingBase64: null,
      error: { code: 'MULTIPLE_FACES', message: 'Chọn mặt' },
    });
    const files = [upload(), upload()];
    await expect(service.create('owner', { personName: 'Test' }, files)).rejects.toMatchObject({
      response: {
        error: {
          code: 'MULTIPLE_FACES',
          details: {
            images: [
              expect.objectContaining({ imageIndex: 0 }),
              expect.objectContaining({ imageIndex: 1 }),
            ],
          },
        },
      },
    });
    expect(create).not.toHaveBeenCalled();
    expect(files.every((file) => file.buffer.every((byte) => byte === 0))).toBe(true);
  });
  it('không báo READY khi sync thất bại', async () => {
    inference.embed.mockResolvedValue(embedded());
    jest.spyOn(repository, 'create').mockResolvedValue('id');
    jest.spyOn(sync, 'sync').mockResolvedValue(false);
    jest.spyOn(repository, 'list').mockResolvedValue([
      {
        id: 'id',
        personName: 'Test',
        provider: 'LOCAL',
        isActive: true,
        createdAt: new Date().toISOString(),
        recognitionStatus: 'SYNC_PENDING',
      },
    ]);
    const result = await service.create('owner', { personName: 'Test' }, [upload()]);
    expect(result.recognitionStatus).toBe('SYNC_PENDING');
    expect(result).not.toHaveProperty('embedding');
  });
  it('timeout không ghi record và không giữ buffer', async () => {
    const create = jest.spyOn(repository, 'create');
    inference.embed.mockRejectedValueOnce(new Error('timeout'));
    const file = upload();
    await expect(service.create('owner', { personName: 'Test' }, [file])).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    expect(file.buffer.every((byte) => byte === 0)).toBe(true);
  });

  it('không ép chuỗi rỗng thành 0 khi FACE_MAX_REQUEST_BYTES để trống', async () => {
    const emptyCfg = new ConfigService({
      FACE_MAX_IMAGE_BYTES: '',
      FACE_MAX_REQUEST_BYTES: '',
      FACE_REGISTRATION_SIMILARITY: '',
    });
    const svc = new KnownFacesService(repository, inference, sync, emptyCfg);
    inference.embed.mockResolvedValue(embedded());
    jest.spyOn(repository, 'create').mockResolvedValue('id-empty');
    jest.spyOn(sync, 'sync').mockResolvedValue(true);
    jest.spyOn(repository, 'list').mockResolvedValue([
      {
        id: 'id-empty',
        personName: 'Test',
        provider: 'LOCAL',
        isActive: true,
        createdAt: new Date().toISOString(),
        recognitionStatus: 'READY',
      },
    ]);
    await expect(svc.create('owner', { personName: 'Test' }, [upload()])).resolves.toMatchObject({
      id: 'id-empty',
    });
  });
});

describe('KnownFacesGuard and numeric config fallback', () => {
  function mockContext(
    method: string,
    sub = 'user-1',
    role = 'ADMIN',
  ): { context: ExecutionContext; response: EventEmitter } {
    const response = new EventEmitter();
    const context = {
      switchToHttp: (): {
        getRequest: () => { method: string; auth: { sub: string; role: string } };
        getResponse: () => EventEmitter;
      } => ({
        getRequest: (): { method: string; auth: { sub: string; role: string } } => ({
          method,
          auth: { sub, role },
        }),
        getResponse: (): EventEmitter => response,
      }),
    } as unknown as ExecutionContext;
    return { context, response };
  }

  it('falls back to defaults when env values are empty strings or non-positive', () => {
    const cfg = new ConfigService({
      EMPTY: '',
      BLANK: '   ',
      ZERO: '0',
      NEG: '-2',
      BAD: 'abc',
      VALID: '15',
    });
    expect(readPositiveFaceNumber(cfg, 'MISSING', 10)).toBe(10);
    expect(readPositiveFaceNumber(cfg, 'EMPTY', 10)).toBe(10);
    expect(readPositiveFaceNumber(cfg, 'BLANK', 10)).toBe(10);
    expect(readPositiveFaceNumber(cfg, 'ZERO', 10)).toBe(10);
    expect(readPositiveFaceNumber(cfg, 'NEG', 10)).toBe(10);
    expect(readPositiveFaceNumber(cfg, 'BAD', 10)).toBe(10);
    expect(readPositiveFaceNumber(cfg, 'VALID', 10)).toBe(15);
  });

  it('does not rate limit first POST when FACE_REQUESTS_PER_MINUTE is empty', () => {
    const guard = new KnownFacesGuard(
      new ConfigService({
        FACE_REQUESTS_PER_MINUTE: '',
        FACE_MAX_CONCURRENT: '',
      }),
    );
    const first = mockContext('POST');
    expect(guard.canActivate(first.context)).toBe(true);
    first.response.emit('finish');
  });

  it('enforces FACE_REQUESTS_PER_MINUTE once configured limit is reached', () => {
    const guard = new KnownFacesGuard(
      new ConfigService({
        FACE_REQUESTS_PER_MINUTE: '2',
        FACE_MAX_CONCURRENT: '2',
      }),
    );
    for (let i = 0; i < 2; i++) {
      const req = mockContext('POST');
      expect(guard.canActivate(req.context)).toBe(true);
      req.response.emit('finish');
    }
    const third = mockContext('POST');
    expect(() => guard.canActivate(third.context)).toThrow(HttpException);
    try {
      guard.canActivate(third.context);
    } catch (err) {
      expect(err).toMatchObject({ status: 429, response: { error: { code: 'RATE_LIMITED' } } });
    }
  });
});
