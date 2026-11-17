import type { components } from '@cam/contracts';
import type { TokenClaims } from '../auth/auth.types';
export type PlaybackActor = Pick<TokenClaims, 'sub' | 'role'>;
export type PlaybackCamera = components['schemas']['PlaybackCamera'];
export type RecordingDay = components['schemas']['RecordingDay'];
export type RecordingSegment = components['schemas']['RecordingSegment'];
export interface ArchiveCamera extends PlaybackCamera {
  slug: string;
}
export interface ArchiveInterval {
  start: number;
  end: number;
  motion: boolean;
}
export const RECORDING_ARCHIVE = Symbol('RECORDING_ARCHIVE');
export interface RecordingArchive {
  receivingFrames?(slug: string): Promise<boolean>;
  list(slug: string, start: number, end: number): Promise<ArchiveInterval[]>;
  clip(slug: string, start: number, end: number): Promise<Buffer>;
}
