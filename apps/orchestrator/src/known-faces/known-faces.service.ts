import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { components } from '@cam/contracts';
import {
  FACE_INFERENCE,
  type IFaceInference,
  type FaceUpload,
  type EmbeddingResult,
} from './face-inference.interface';
import {
  FACE_ENROLLMENT,
  type IRekognitionFaceEnrollment,
} from './rekognition-face-enrollment.service';
import { readFaceConfig, readPositiveFaceNumber, type FaceConfig } from './face-config';
import { KnownFacesRepository, type KnownFace } from './known-faces.repository';
import { FaceCollectionSyncService } from './face-collection-sync.service';
import type { UpdateKnownFaceDto } from './dto/update-known-face.dto';
import { CreateKnownFaceDto } from './dto/create-known-face.dto';
import { aggregate, selections, validateImages } from './embedding';
import { faceError } from './face-error';

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    if (
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Za-z0-9_.-]{1,80}$/.test(error.code)
    ) {
      return error.code;
    }
    if (
      'name' in error &&
      typeof error.name === 'string' &&
      /^[A-Za-z0-9_.-]{1,80}$/.test(error.name)
    ) {
      return error.name;
    }
  }
  return 'unknown';
}

@Injectable()
export class KnownFacesService {
  private readonly logger = new Logger(KnownFacesService.name);
  private readonly faceConfig: FaceConfig;

  constructor(
    private readonly repository: KnownFacesRepository,
    @Inject(FACE_INFERENCE) private readonly inference: IFaceInference,
    private readonly sync: FaceCollectionSyncService,
    private readonly config: ConfigService,
    @Optional()
    @Inject(FACE_ENROLLMENT)
    private readonly rekognitionEnrollment?: IRekognitionFaceEnrollment,
  ) {
    this.faceConfig = readFaceConfig(this.config);
    if (this.faceConfig.provider === 'rekognition' && !this.rekognitionEnrollment) {
      throw new Error('Rekognition enrollment service is required when FACE_PROVIDER=rekognition');
    }
  }

  async list(owner: string): Promise<{ data: KnownFace[] }> {
    return { data: await this.repository.list(await this.repository.householdOwner(owner)) };
  }

  private async requireFaceModuleEnabled(owner: string): Promise<void> {
    const enabled = (await this.repository.isFaceModuleEnabled?.(owner)) ?? true;
    if (!enabled) {
      throw faceError(
        403,
        'MODULE_DISABLED',
        'Module Nhận diện khuôn mặt (M1) đang tắt. Caregiver cần bật lại trong Cài đặt để sử dụng.',
      );
    }
  }

  async create(actor: string, dto: CreateKnownFaceDto, files: FaceUpload[]): Promise<KnownFace> {
    try {
      const owner = await this.repository.householdOwner(actor);
      await this.requireFaceModuleEnabled(owner);
      validateImages(
        files,
        readPositiveFaceNumber(this.config, 'FACE_MAX_IMAGE_BYTES', 5242880),
        readPositiveFaceNumber(this.config, 'FACE_MAX_REQUEST_BYTES', 26214400),
      );
      this.logger.log(`Received ${files.length} images for registration`);

      if (this.faceConfig.provider === 'rekognition') {
        return await this.createWithRekognition(owner, dto, files);
      }

      const indexes = selections(dto.faceSelections, files.length);
      const results: EmbeddingResult[] = [];
      for (const [index, file] of files.entries())
        results.push(await this.inference.embed(file.buffer, indexes[index] ?? null));
      this.checkResults(results);
      const combined = aggregate(
        results,
        readPositiveFaceNumber(this.config, 'FACE_REGISTRATION_SIMILARITY', 0.6),
      );
      const id = await this.repository.create(
        owner,
        dto,
        combined.embedding,
        combined.dimension,
        combined.model,
        files.length,
      );
      await this.sync.sync(owner);
      const record = (await this.repository.list(owner)).find((face) => face.id === id);
      if (!record)
        throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Không đọc được kết quả đăng ký.');
      return record;
    } finally {
      // FR-DEV-08: buffer chỉ tồn tại trong thời gian xử lý đăng ký.
      for (const file of files) file.buffer.fill(0);
    }
  }

  private async createWithRekognition(
    owner: string,
    dto: CreateKnownFaceDto,
    files: FaceUpload[],
  ): Promise<KnownFace> {
    const rekognition = this.requireRekognition();
    await this.repository.precheckCreate(owner, dto);
    const indexes = selections(dto.faceSelections, files.length);
    if (indexes.some((index) => index !== null)) {
      await rekognition.validateSingleFaces(files, indexes);
    } else {
      await rekognition.validateSingleFaces(files);
    }
    // Rekognition deduplicates identical bytes + ExternalImageId. Keep each operation
    // distinct so compensating cleanup can never delete an older person's vectors.
    const indexed = await rekognition.indexFaces(owner, files, `${owner}:${randomUUID()}`);
    let id: string;
    try {
      id = await this.repository.createRekognition(owner, dto, {
        collectionId: indexed.collectionId,
        faceIds: indexed.faceIds,
        modelVersion: indexed.modelVersion,
        sourceImageCount: files.length,
      });
    } catch (dbError: unknown) {
      await this.compensateDeleteFaces(
        owner,
        indexed.collectionId,
        indexed.faceIds,
        'create_db_persistence_failed',
      );
      throw dbError;
    }
    const record = (await this.repository.list(owner)).find((face) => face.id === id);
    if (!record) {
      throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Không đọc được kết quả đăng ký.');
    }
    return record;
  }

  async update(actor: string, id: string, input: UpdateKnownFaceDto): Promise<KnownFace> {
    const owner = await this.repository.householdOwner(actor);
    await this.requireFaceModuleEnabled(owner);
    try {
      await this.repository.update(owner, id, input, actor);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw faceError(409, 'KNOWN_FACE_NAME_EXISTS', 'Tên người quen đã tồn tại.');
      throw error;
    }
    if (this.faceConfig.provider === 'local') {
      await this.sync.sync(owner);
    }
    const face = (await this.repository.list(owner)).find((item) => item.id === id);
    if (!face) throw faceError(404, 'NOT_FOUND', 'Không tìm thấy người quen.');
    return face;
  }

  async replacePhotos(actor: string, id: string, files: FaceUpload[]): Promise<KnownFace> {
    try {
      const owner = await this.repository.householdOwner(actor);
      await this.requireFaceModuleEnabled(owner);
      validateImages(
        files,
        readPositiveFaceNumber(this.config, 'FACE_MAX_IMAGE_BYTES', 5242880),
        readPositiveFaceNumber(this.config, 'FACE_MAX_REQUEST_BYTES', 26214400),
      );
      if (this.faceConfig.provider !== 'rekognition') {
        throw faceError(
          503,
          'FACE_PROVIDER_UNAVAILABLE',
          'Cập nhật ảnh trực tiếp chỉ hỗ trợ khi bật Rekognition.',
        );
      }
      const rekognition = this.requireRekognition();
      const target = await this.repository.findRekognitionTarget(owner, id);
      if (!target) throw faceError(404, 'NOT_FOUND', 'Không tìm thấy người quen.');
      if (target.provider !== 'REKOGNITION') {
        throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Provider này không khớp Rekognition.');
      }
      await rekognition.validateSingleFaces(files);
      const indexed = await rekognition.indexFaces(owner, files, `${owner}:${id}:${randomUUID()}`);
      let previous: { previousCollectionId: string; previousFaceIds: string[] };
      try {
        previous = await this.repository.replaceRekognitionFaces(owner, id, {
          collectionId: indexed.collectionId,
          faceIds: indexed.faceIds,
          modelVersion: indexed.modelVersion,
          sourceImageCount: files.length,
          actorId: actor,
        });
      } catch (dbError: unknown) {
        await this.compensateDeleteFaces(
          owner,
          indexed.collectionId,
          indexed.faceIds,
          'replace_photos_db_persistence_failed',
        );
        throw dbError;
      }
      if (previous.previousFaceIds.length > 0) {
        await this.compensateDeleteFaces(
          owner,
          previous.previousCollectionId,
          previous.previousFaceIds,
          'replace_photos_prune_previous_faces',
        );
      }
      const face = (await this.repository.list(owner)).find((item) => item.id === id);
      if (!face) throw faceError(404, 'NOT_FOUND', 'Không tìm thấy người quen.');
      return face;
    } finally {
      for (const file of files) file.buffer.fill(0);
    }
  }

  async deactivate(actor: string, id: string): Promise<KnownFace> {
    const owner = await this.repository.householdOwner(actor);
    await this.requireFaceModuleEnabled(owner);
    if (this.faceConfig.provider !== 'rekognition') {
      throw faceError(
        503,
        'FACE_PROVIDER_UNAVAILABLE',
        'Vô hiệu hóa trên collection chỉ hỗ trợ khi bật Rekognition.',
      );
    }
    const rekognition = this.requireRekognition();
    const target = await this.repository.findRekognitionTarget(owner, id);
    if (!target) throw faceError(404, 'NOT_FOUND', 'Không tìm thấy người quen.');
    if (target.provider !== 'REKOGNITION') {
      throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Provider này không khớp Rekognition.');
    }
    const collectionId = target.collectionId ?? rekognition.collectionIdForOwner(owner);
    await rekognition.deleteFaces(collectionId, target.faceIds);
    try {
      await this.repository.deactivateRekognition(owner, id, collectionId, actor);
    } catch (dbError: unknown) {
      this.logger.error(
        {
          action: 'rekognition_deactivate_db_reconciliation_required',
          ownerUserId: owner,
          knownFaceId: id,
          collectionId,
          deletedFaceCount: target.faceIds.length,
          errorCode: safeErrorCode(dbError),
        },
        'Rekognition DeleteFaces succeeded but DB deactivation failed; retry deactivate to reconcile',
      );
      throw dbError;
    }
    const face = (await this.repository.list(owner)).find((item) => item.id === id);
    if (!face) throw faceError(404, 'NOT_FOUND', 'Không tìm thấy người quen.');
    return face;
  }

  private checkResults(results: EmbeddingResult[]): void {
    const images: components['schemas']['FaceSelectionDetails']['images'] = [];
    for (const [imageIndex, result] of results.entries()) {
      if (!result.error) continue;
      const code =
        result.error.code === 'INVALID_FACE_SELECTION'
          ? 'FACE_SELECTION_INVALID'
          : result.error.code;
      if (['MODEL_NOT_LOADED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT'].includes(code))
        throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Dịch vụ nhận diện chưa sẵn sàng.');
      if (code === 'IMAGE_DECODE_FAILED')
        throw faceError(400, 'INVALID_IMAGE', 'Ảnh hỏng hoặc vượt giới hạn pixel.');
      images.push({
        imageIndex,
        code,
        faces: result.faces.map((boundingBox, faceIndex) => ({ faceIndex, boundingBox })),
      });
    }
    if (images.length) {
      const code = images.some((image) => image.code === 'NO_FACE_DETECTED')
        ? 'NO_FACE_DETECTED'
        : (images[0]?.code ?? 'FACE_SELECTION_INVALID');
      throw faceError(422, code, 'Hãy kiểm tra các ảnh và chọn đúng khuôn mặt.', { images });
    }
  }

  async remove(
    owner: string,
    id: string,
    ip: string | null,
    agent: string | null,
  ): Promise<boolean> {
    owner = await this.repository.householdOwner(owner);
    await this.requireFaceModuleEnabled(owner);
    if (this.faceConfig.provider === 'local') {
      await this.repository.remove(owner, id, ip, agent);
      return this.sync.sync(owner);
    }

    const rekognition = this.requireRekognition();
    const target = await this.repository.findRekognitionTarget(owner, id);
    if (!target) throw faceError(404, 'NOT_FOUND', 'Không tìm thấy người quen.');
    if (target.provider === 'LOCAL') {
      await this.repository.remove(owner, id, ip, agent);
      return true;
    }

    const collectionId = target.collectionId ?? rekognition.collectionIdForOwner(owner);
    await rekognition.deleteFaces(collectionId, target.faceIds);
    try {
      await this.repository.removeRekognition(owner, id, collectionId, ip, agent);
    } catch (dbError: unknown) {
      this.logger.error(
        {
          action: 'rekognition_delete_db_reconciliation_required',
          ownerUserId: owner,
          knownFaceId: id,
          collectionId,
          deletedFaceCount: target.faceIds.length,
          errorCode: safeErrorCode(dbError),
        },
        'Rekognition DeleteFaces succeeded but DB deletion failed; retry delete to reconcile',
      );
      throw dbError;
    }
    return true;
  }

  private requireRekognition(): IRekognitionFaceEnrollment {
    if (!this.rekognitionEnrollment) {
      throw new Error('Rekognition enrollment service is required when FACE_PROVIDER=rekognition');
    }
    return this.rekognitionEnrollment;
  }

  private async compensateDeleteFaces(
    ownerUserId: string,
    collectionId: string,
    faceIds: string[],
    reason: string,
  ): Promise<void> {
    if (faceIds.length === 0 || !this.rekognitionEnrollment) return;
    try {
      await this.rekognitionEnrollment.deleteFaces(collectionId, faceIds);
      this.logger.warn(
        {
          action: 'rekognition_compensating_delete_completed',
          reason,
          ownerUserId,
          collectionId,
          faceCount: faceIds.length,
        },
        'Compensating Rekognition DeleteFaces succeeded after persistence failure',
      );
    } catch (cleanupError: unknown) {
      this.logger.error(
        {
          action: 'rekognition_compensating_delete_failed',
          reason,
          ownerUserId,
          collectionId,
          faceCount: faceIds.length,
          errorCode: safeErrorCode(cleanupError),
        },
        'Compensating Rekognition DeleteFaces failed; reconciliation required',
      );
    }
  }
}
