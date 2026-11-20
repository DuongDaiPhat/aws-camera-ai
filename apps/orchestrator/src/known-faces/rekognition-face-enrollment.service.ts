import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateCollectionCommand,
  DeleteFacesCommand,
  DetectFacesCommand,
  IndexFacesCommand,
  RekognitionClient,
  type BoundingBox as RekognitionBoundingBox,
} from '@aws-sdk/client-rekognition';
import type { components } from '@cam/contracts';
import type { FaceUpload } from './face-inference.interface';
import {
  buildRekognitionCollectionId,
  readFaceConfig,
  type RekognitionCollectionPrefix,
} from './face-config';
import { faceError } from './face-error';

export const FACE_ENROLLMENT = Symbol('FACE_ENROLLMENT');

export interface RekognitionIndexResult {
  collectionId: string;
  faceIds: string[];
  modelVersion: string;
}

export interface IRekognitionFaceEnrollment {
  readonly collectionPrefix: RekognitionCollectionPrefix;
  collectionIdForOwner(ownerUserId: string): string;
  ensureCollection(ownerUserId: string): Promise<string>;
  validateSingleFaces(files: FaceUpload[]): Promise<void>;
  indexFaces(
    ownerUserId: string,
    files: FaceUpload[],
    externalImageIdPrefix?: string,
  ): Promise<RekognitionIndexResult>;
  deleteFaces(collectionId: string, faceIds: string[]): Promise<string[]>;
}

function clamp01(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function toBoundingBox(box: RekognitionBoundingBox | undefined) {
  return {
    x: clamp01(box?.Left),
    y: clamp01(box?.Top),
    width: clamp01(box?.Width),
    height: clamp01(box?.Height),
  };
}

function awsErrorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }
  return 'UnknownError';
}

function sanitizeExternalImageId(prefix: string, imageIndex: number): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_.\-:]/g, '_').slice(0, 240);
  return `${safePrefix}:${imageIndex}`;
}

@Injectable()
export class RekognitionFaceEnrollmentService
  implements IRekognitionFaceEnrollment, OnModuleDestroy
{
  private readonly logger = new Logger(RekognitionFaceEnrollmentService.name);
  private readonly client: RekognitionClient;
  private readonly ownsClient: boolean;
  readonly collectionPrefix: RekognitionCollectionPrefix;

  constructor(config: ConfigService, client?: RekognitionClient) {
    const settings = readFaceConfig(config);
    if (settings.provider !== 'rekognition') {
      throw new Error('RekognitionFaceEnrollmentService requires FACE_PROVIDER=rekognition');
    }
    this.collectionPrefix = settings.collectionPrefix;
    this.ownsClient = !client;
    this.client = client ?? new RekognitionClient({ region: settings.region, maxAttempts: 3 });
  }

  onModuleDestroy(): void {
    if (this.ownsClient) {
      this.client.destroy();
    }
  }

  collectionIdForOwner(ownerUserId: string): string {
    return buildRekognitionCollectionId(this.collectionPrefix, ownerUserId);
  }

  async ensureCollection(ownerUserId: string): Promise<string> {
    const collectionId = this.collectionIdForOwner(ownerUserId);
    try {
      await this.client.send(new CreateCollectionCommand({ CollectionId: collectionId }));
      this.logger.log({ collectionId, ownerUserId }, 'Created Rekognition face collection');
      return collectionId;
    } catch (error: unknown) {
      const code = awsErrorName(error);
      if (code === 'ResourceAlreadyExistsException') {
        return collectionId;
      }
      this.logger.error(
        { action: 'rekognition_create_collection_failed', collectionId, errorCode: code },
        'Failed to ensure Rekognition collection',
      );
      throw faceError(
        503,
        'FACE_PROVIDER_UNAVAILABLE',
        'Dịch vụ nhận diện Rekognition chưa sẵn sàng.',
      );
    }
  }

  async validateSingleFaces(files: FaceUpload[]): Promise<void> {
    const images: components['schemas']['FaceSelectionDetails']['images'] = [];
    for (const [imageIndex, file] of files.entries()) {
      let faceDetails;
      try {
        const response = await this.client.send(
          new DetectFacesCommand({
            Image: { Bytes: file.buffer },
            Attributes: ['DEFAULT'],
          }),
        );
        faceDetails = response.FaceDetails ?? [];
      } catch (error: unknown) {
        this.throwMappedAwsImageError('rekognition_detect_faces_failed', error);
      }
      if (faceDetails.length === 0) {
        images.push({ imageIndex, code: 'NO_FACE_DETECTED', faces: [] });
      } else if (faceDetails.length > 1) {
        images.push({
          imageIndex,
          code: 'MULTIPLE_FACES',
          faces: faceDetails.map((face, faceIndex) => ({
            faceIndex,
            boundingBox: toBoundingBox(face.BoundingBox),
          })),
        });
      }
    }
    if (images.length > 0) {
      const code = images.some((item) => item.code === 'NO_FACE_DETECTED')
        ? 'NO_FACE_DETECTED'
        : 'MULTIPLE_FACES';
      throw faceError(422, code, 'Mỗi ảnh đăng ký phải chứa đúng một khuôn mặt.', { images });
    }
  }

  async indexFaces(
    ownerUserId: string,
    files: FaceUpload[],
    externalImageIdPrefix = ownerUserId,
  ): Promise<RekognitionIndexResult> {
    const collectionId = await this.ensureCollection(ownerUserId);
    const indexedFaceIds: string[] = [];
    let modelVersion = 'rekognition';

    try {
      for (const [imageIndex, file] of files.entries()) {
        const response = await this.client.send(
          new IndexFacesCommand({
            CollectionId: collectionId,
            Image: { Bytes: file.buffer },
            ExternalImageId: sanitizeExternalImageId(externalImageIdPrefix, imageIndex),
            MaxFaces: 2,
            QualityFilter: 'AUTO',
            DetectionAttributes: ['DEFAULT'],
          }),
        );
        const records = response.FaceRecords ?? [];
        const newlyIndexedIds = records
          .map((record) => record.Face?.FaceId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        if (records.length !== 1 || newlyIndexedIds.length !== 1) {
          indexedFaceIds.push(...newlyIndexedIds);
          await this.bestEffortCleanup(collectionId, indexedFaceIds, 'index_validation_rollback');
          if (records.length === 0) {
            throw faceError(
              422,
              'NO_FACE_DETECTED',
              'Không phát hiện khuôn mặt đạt chất lượng để đăng ký.',
              { images: [{ imageIndex, code: 'NO_FACE_DETECTED', faces: [] }] },
            );
          }
          if (records.length > 1) {
            throw faceError(422, 'MULTIPLE_FACES', 'Mỗi ảnh đăng ký chỉ được chứa một khuôn mặt.', {
              images: [
                {
                  imageIndex,
                  code: 'MULTIPLE_FACES',
                  faces: records.map((record, faceIndex) => ({
                    faceIndex,
                    boundingBox: toBoundingBox(record.Face?.BoundingBox),
                  })),
                },
              ],
            });
          }
          throw faceError(
            503,
            'FACE_PROVIDER_UNAVAILABLE',
            'Rekognition không trả về mã khuôn mặt hợp lệ.',
          );
        }
        indexedFaceIds.push(newlyIndexedIds[0]!);
        if (response.FaceModelVersion) {
          modelVersion = `rekognition-${response.FaceModelVersion}`;
        }
      }
      return {
        collectionId,
        faceIds: indexedFaceIds,
        modelVersion,
      };
    } catch (error: unknown) {
      if (indexedFaceIds.length > 0 && !(error instanceof Error && 'getStatus' in error)) {
        await this.bestEffortCleanup(collectionId, indexedFaceIds, 'index_batch_failure');
      }
      if (error instanceof Error && 'getStatus' in error) {
        throw error;
      }
      this.throwMappedAwsImageError('rekognition_index_faces_failed', error);
    }
  }

  async deleteFaces(collectionId: string, faceIds: string[]): Promise<string[]> {
    const uniqueFaceIds = [...new Set(faceIds.filter((id) => id.trim().length > 0))];
    if (uniqueFaceIds.length === 0) return [];
    try {
      const response = await this.client.send(
        new DeleteFacesCommand({
          CollectionId: collectionId,
          FaceIds: uniqueFaceIds,
        }),
      );
      return response.DeletedFaces ?? [];
    } catch (error: unknown) {
      const code = awsErrorName(error);
      if (code === 'ResourceNotFoundException') {
        return [];
      }
      this.logger.error(
        {
          action: 'rekognition_delete_faces_failed',
          collectionId,
          faceCount: uniqueFaceIds.length,
          errorCode: code,
        },
        'Failed to delete faces from Rekognition collection',
      );
      throw faceError(
        503,
        'FACE_PROVIDER_UNAVAILABLE',
        'Không thể xóa khuôn mặt trên dịch vụ Rekognition.',
      );
    }
  }

  private async bestEffortCleanup(
    collectionId: string,
    faceIds: string[],
    reason: string,
  ): Promise<void> {
    if (faceIds.length === 0) return;
    try {
      await this.deleteFaces(collectionId, faceIds);
    } catch (cleanupError: unknown) {
      this.logger.error(
        {
          action: 'rekognition_compensating_cleanup_failed',
          reason,
          collectionId,
          faceCount: faceIds.length,
          errorCode: awsErrorName(cleanupError),
        },
        'Compensating DeleteFaces cleanup failed; manual reconciliation required',
      );
    }
  }

  private throwMappedAwsImageError(action: string, error: unknown): never {
    const code = awsErrorName(error);
    if (code === 'InvalidImageFormatException') {
      throw faceError(
        400,
        'INVALID_IMAGE',
        'Ảnh không hợp lệ cho Rekognition (chỉ hỗ trợ JPEG/PNG).',
      );
    }
    if (code === 'ImageTooLargeException') {
      throw faceError(413, 'IMAGE_TOO_LARGE', 'Ảnh vượt giới hạn dung lượng.');
    }
    this.logger.error({ action, errorCode: code }, 'AWS Rekognition enrollment call failed');
    throw faceError(
      503,
      'FACE_PROVIDER_UNAVAILABLE',
      'Dịch vụ nhận diện Rekognition chưa sẵn sàng.',
    );
  }
}
