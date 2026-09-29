import type { AiComponents, AiOperations } from '@cam/contracts';

export const FACE_INFERENCE = Symbol('FACE_INFERENCE');
export type EmbeddingResult = AiComponents['schemas']['EmbedResponse'];
export type CollectionRequest =
  AiOperations['syncFaceCollection']['requestBody']['content']['application/json'];
export interface IFaceInference {
  embed(image: Buffer, selectedFaceIndex: number | null): Promise<EmbeddingResult>;
  sync(snapshot: CollectionRequest): Promise<void>;
}
export interface FaceUpload {
  buffer: Buffer;
  size: number;
}
