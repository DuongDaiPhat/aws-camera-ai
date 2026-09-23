import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CollectionRequest,
  EmbeddingResult,
  IFaceInference,
} from './face-inference.interface';
import { faceError } from './face-error';
import { isEmbeddingResult, isSyncAcknowledgement } from './face-response';

@Injectable()
export class AiFaceInferenceService implements IFaceInference {
  constructor(private readonly config: ConfigService) {}

  async embed(image: Buffer, selected: number | null): Promise<EmbeddingResult> {
    const body = new FormData();
    body.append('image', new Blob([new Uint8Array(image)]), 'image');
    if (selected !== null) body.append('selectedFaceIndex', String(selected));
    const response = await this.request('/face/embed', body);
    const result: unknown = await response.json();
    if (!isEmbeddingResult(result)) {
      throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Phản hồi AI không hợp lệ.');
    }
    return result;
  }

  async sync(snapshot: CollectionRequest): Promise<void> {
    const response = await this.request('/face/collection/sync', JSON.stringify(snapshot));
    const result: unknown = await response.json();
    if (
      !isSyncAcknowledgement(result, snapshot.ownerScopeId, snapshot.version, snapshot.faces.length)
    ) {
      throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Collection chưa được đồng bộ.');
    }
  }

  private async request(path: string, body: FormData | string): Promise<Response> {
    const token = this.config.get<string>('AI_INTERNAL_TOKEN', '');
    if (!token) throw faceError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Chưa cấu hình kết nối AI.');
    try {
      const response = await fetch(
        `${this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000')}${path}`,
        {
          method: 'POST',
          body,
          headers: {
            'X-Internal-Token': token,
            ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
          },
          signal: AbortSignal.timeout(Number(this.config.get('AI_SERVICE_TIMEOUT_MS', 5000))),
        },
      );
      if (!response.ok) throw new Error('AI response failed');
      return response;
    } catch {
      throw faceError(
        503,
        'FACE_PROVIDER_UNAVAILABLE',
        'Dịch vụ nhận diện chưa sẵn sàng. Hãy thử lại.',
      );
    }
  }
}
