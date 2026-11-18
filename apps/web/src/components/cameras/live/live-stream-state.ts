import type { Camera } from '@/types';

/** A stream URL grants access; it does not prove a publisher is ready. */
export function hasLiveSource(
  camera: Pick<Camera, 'isEnabled' | 'runtimeStatus'>,
  localPublishing = false,
): boolean {
  return camera.isEnabled && (camera.runtimeStatus === 'ONLINE' || localPublishing);
}
