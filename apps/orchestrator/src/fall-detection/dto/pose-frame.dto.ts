/**
 * DTO và Type definitions cho Pose Frame Streaming & Binary Envelope (M2a - US-16 / US-17).
 * Tuân thủ quy chuẩn CODING_CONVENTION.md và PLAN_US-16_US-17_POSE_FALL_E2E.md.
 */

export interface NormalizedBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PosePersonDto {
  trackId: string;
  boundingBox: NormalizedBBox;
  observedAt: number;
}

export interface PoseFrameHeaderDto {
  schemaVersion: number;
  sourceSessionId: string;
  frameId: string;
  cameraSlug: string;
  frameTimestamp: number;
  frameWidth: number;
  frameHeight: number;
  persons: PosePersonDto[];
}

export interface UnpackedPoseFrame {
  header: PoseFrameHeaderDto;
  imageBytes: Buffer;
}
