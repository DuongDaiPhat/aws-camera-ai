import sharp from 'sharp';
import type { BoundingBox } from '@aws-sdk/client-rekognition';
import { faceError } from './face-error';

export async function normalizeFaceImage(buffer: Buffer, maxPixels: number): Promise<Buffer> {
  try {
    return await sharp(buffer, { limitInputPixels: maxPixels })
      .rotate()
      .jpeg({ quality: 95 })
      .toBuffer();
  } catch {
    throw faceError(400, 'INVALID_IMAGE', 'Không đọc được ảnh hoặc ảnh vượt giới hạn số pixel.');
  }
}

/** Coordinates refer to the upright image used by DetectFaces and the browser preview. */
export async function cropSelectedFace(buffer: Buffer, box: BoundingBox): Promise<Buffer> {
  const { width, height } = await sharp(buffer).metadata();
  if (
    !width ||
    !height ||
    !box.Width ||
    !box.Height ||
    box.Left === undefined ||
    box.Top === undefined
  ) {
    throw faceError(422, 'FACE_SELECTION_INVALID', 'Tọa độ khuôn mặt không hợp lệ.');
  }
  const left = Math.max(0, Math.floor((box.Left - box.Width * 0.25) * width));
  const top = Math.max(0, Math.floor((box.Top - box.Height * 0.25) * height));
  const right = Math.min(width, Math.ceil((box.Left + box.Width * 1.25) * width));
  const bottom = Math.min(height, Math.ceil((box.Top + box.Height * 1.25) * height));
  if (right <= left || bottom <= top) {
    throw faceError(422, 'FACE_SELECTION_INVALID', 'Tọa độ khuôn mặt nằm ngoài ảnh.');
  }
  return sharp(buffer)
    .extract({ left, top, width: right - left, height: bottom - top })
    .jpeg({ quality: 95 })
    .toBuffer();
}
