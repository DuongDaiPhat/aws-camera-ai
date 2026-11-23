import type { NormalizedBBox } from '../fall-detection/dto/pose-frame.dto';

export interface PersonCropContext {
  capturedAt: number;
  trackId: string;
  cropRegion: NormalizedBBox;
  persons: Array<{ trackId: string; boundingBox: NormalizedBBox }>;
}

/** A visible face must belong unambiguously to this person's head region. */
export function faceBelongsToPerson(context: PersonCropContext, face: NormalizedBBox): boolean {
  const region = context.cropRegion;
  const x = region.x + (face.x + face.width / 2) * region.width;
  const y = region.y + (face.y + face.height / 2) * region.height;
  const cost = (box: NormalizedBBox): number => {
    const rx = (x - box.x) / box.width;
    const ry = (y - box.y) / box.height;
    if (rx < -0.05 || rx > 1.05 || ry < -0.05 || ry > 0.45) return Infinity;
    return ((rx - 0.5) / 0.5) ** 2 + ((ry - 0.13) / 0.35) ** 2;
  };
  const own = context.persons.find((person) => person.trackId === context.trackId);
  if (!own) return false;
  const ownCost = cost(own.boundingBox);
  if (!Number.isFinite(ownCost)) return false;
  return context.persons.every(
    (person) => person.trackId === context.trackId || cost(person.boundingBox) > ownCost + 0.15,
  );
}
