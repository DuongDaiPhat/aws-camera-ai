import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { components } from '@cam/contracts';
import {
  FACE_INFERENCE,
  type IFaceInference,
  type FaceUpload,
  type EmbeddingResult,
} from './face-inference.interface';
import { KnownFacesRepository, type KnownFace } from './known-faces.repository';
import { FaceCollectionSyncService } from './face-collection-sync.service';
import { CreateKnownFaceDto } from './dto/create-known-face.dto';
import { aggregate, selections, validateImages } from './embedding';
import { faceError } from './face-error';

@Injectable()
export class KnownFacesService {
  constructor(
    private readonly repository: KnownFacesRepository,
    @Inject(FACE_INFERENCE) private readonly inference: IFaceInference,
    private readonly sync: FaceCollectionSyncService,
    private readonly config: ConfigService,
  ) {}

  async list(owner: string): Promise<{ data: KnownFace[] }> {
    return { data: await this.repository.list(owner) };
  }

  async create(owner: string, dto: CreateKnownFaceDto, files: FaceUpload[]): Promise<KnownFace> {
    try {
      validateImages(
        files,
        Number(this.config.get('FACE_MAX_IMAGE_BYTES', 5242880)),
        Number(this.config.get('FACE_MAX_REQUEST_BYTES', 26214400)),
      );
      console.log(`[KnownFacesService] Received ${files.length} images for registration`);
      const indexes = selections(dto.faceSelections, files.length);
      const results: EmbeddingResult[] = [];
      for (const [index, file] of files.entries())
        results.push(await this.inference.embed(file.buffer, indexes[index] ?? null));
      this.checkResults(results);
      const combined = aggregate(
        results,
        Number(this.config.get('FACE_REGISTRATION_SIMILARITY', 0.6)),
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
    await this.repository.remove(owner, id, ip, agent);
    return this.sync.sync(owner);
  }
}
