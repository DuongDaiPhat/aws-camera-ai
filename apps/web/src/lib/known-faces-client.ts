import type { components, operations } from '@cam/contracts';
import { apiFetch, ApiError } from './api-client';

export type KnownFace = components['schemas']['KnownFace'];
export type SelectionDetails = components['schemas']['FaceSelectionDetails'];
export const listKnownFaces = (signal?: AbortSignal) =>
  apiFetch<{ data: KnownFace[] }>('/known-faces', { signal });
export const deleteKnownFace = (id: string) =>
  apiFetch<
    operations['deleteKnownFace']['responses'][202]['content']['application/json'] | undefined
  >(`/known-faces/${id}`, { method: 'DELETE' });

export function registerKnownFace(
  name: string,
  relationship: string,
  files: File[],
  selected: (number | null)[],
  signal?: AbortSignal,
): Promise<KnownFace> {
  const body = new FormData();
  body.append('personName', name.trim());
  if (relationship.trim()) body.append('relationship', relationship.trim());
  body.append('faceSelections', JSON.stringify(selected));
  for (const file of files) body.append('images', file);
  return apiFetch<KnownFace>('/known-faces', { method: 'POST', body, signal });
}

export function selectionDetails(error: unknown): SelectionDetails | null {
  if (
    !(error instanceof ApiError) ||
    !error.details ||
    typeof error.details !== 'object' ||
    !('images' in error.details)
  )
    return null;
  const images = error.details.images;
  if (!Array.isArray(images)) return null;
  // Payload bên ngoài được kiểm tra trước khi dùng tọa độ trên UI.
  const checked: SelectionDetails['images'] = [];
  for (const image of images) {
    if (
      !image ||
      typeof image !== 'object' ||
      !Number.isInteger(image.imageIndex) ||
      !Array.isArray(image.faces)
    )
      return null;
    const faces: SelectionDetails['images'][number]['faces'] = [];
    for (const face of image.faces) {
      const box = face?.boundingBox;
      if (
        !Number.isInteger(face?.faceIndex) ||
        !box ||
        ![box.x, box.y, box.width, box.height].every(
          (value) => typeof value === 'number' && value >= 0 && value <= 1,
        )
      )
        return null;
      faces.push({
        faceIndex: face.faceIndex,
        boundingBox: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
    }
    checked.push({
      imageIndex: image.imageIndex,
      code: typeof image.code === 'string' ? image.code : undefined,
      faces,
    });
  }
  return { images: checked };
}
