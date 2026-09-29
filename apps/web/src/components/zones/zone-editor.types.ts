import type { ZonePoint } from '@/lib/zone-geometry';
import type { ZoneType } from '@/types';

export interface ZoneDraft {
  id: string | null;
  name: string;
  slug: string;
  zoneType: ZoneType;
  polygon: ZonePoint[];
  minDwellSeconds: number;
  activeFrom: string | null;
  activeTo: string | null;
  isEnabled: boolean;
}
