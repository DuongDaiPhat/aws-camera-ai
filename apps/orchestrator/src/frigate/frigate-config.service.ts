import { Injectable, Logger } from '@nestjs/common';
import YAML from 'yaml';
import type { CameraAggregateRecord } from '../cameras/cameras.types';
import type { CameraFrigateSettingsRecord } from '../cameras/cameras.types';

export interface CameraFrigateData {
  camera: CameraAggregateRecord;
  mediamtxRtspBaseUrl?: string;
  settings?: Partial<CameraFrigateSettingsRecord> | null;
  zones?: Array<{
    slug: string;
    zoneType: string;
    polygon: number[][];
    minDwellSeconds?: number;
    isEnabled: boolean;
  }>;
}

@Injectable()
export class FrigateConfigService {
  private readonly logger = new Logger(FrigateConfigService.name);

  generateUpdatedConfig(rawYaml: string, data: CameraFrigateData): string {
    const { camera, settings, zones = [], mediamtxRtspBaseUrl = 'rtsp://mediamtx:8554' } = data;
    const slug = camera.slug;

    const parsedConfig = this.parseConfig(rawYaml);
    if (!parsedConfig.cameras || typeof parsedConfig.cameras !== 'object') {
      parsedConfig.cameras = {};
    }

    const cameras = parsedConfig.cameras as Record<string, Record<string, unknown>>;
    const existingCamera = cameras[slug] ?? {};
    const existingZones = {
      ...((existingCamera.zones as Record<string, unknown> | undefined) ?? {}),
    };
    for (const managedSlug of settings?.managed_zone_slugs ?? []) {
      delete existingZones[managedSlug];
    }
    for (const zone of zones.filter((candidate) => candidate.isEnabled)) {
      existingZones[zone.slug] = this.toFrigateZone(zone);
    }
    const streamUrl = this.resolveStreamUrl(camera, mediamtxRtspBaseUrl);
    const detect = {
      ...((existingCamera.detect as Record<string, unknown> | undefined) ?? {}),
      width: settings?.detect_width ?? camera.detect_width ?? 1280,
      height: settings?.detect_height ?? camera.detect_height ?? 720,
      fps: settings?.detect_fps ?? camera.fps ?? 5,
      enabled: camera.detection_enabled,
      min_initialized: Math.max(2, settings?.min_initialized_frames ?? 2),
      max_disappeared: settings?.max_disappeared_frames ?? 25,
    };
    const existingObjects = (existingCamera.objects as Record<string, unknown> | undefined) ?? {};
    const existingFilters = (existingObjects.filters as Record<string, unknown> | undefined) ?? {};
    const existingPerson = (existingFilters.person as Record<string, unknown> | undefined) ?? {};
    const snapshots = (existingCamera.snapshots as Record<string, unknown> | undefined) ?? {};
    const record = (existingCamera.record as Record<string, unknown> | undefined) ?? {};
    const recordOptions = { ...record };
    delete recordOptions.retain;
    const detections = (record.detections as Record<string, unknown> | undefined) ?? {};
    const detectionRetain = (detections.retain as Record<string, unknown> | undefined) ?? {};
    const alerts = (record.alerts as Record<string, unknown> | undefined) ?? {};
    const alertRetain = (alerts.retain as Record<string, unknown> | undefined) ?? {};
    const retentionDays = settings?.detection_retention_days ?? camera.retention_days;

    // 4. Sinh cấu hình mới cho camera mà không ghi đè zone
    cameras[slug] = {
      ...existingCamera,
      enabled: camera.is_enabled,
      ffmpeg: {
        inputs: [
          {
            path: streamUrl,
            input_args: 'preset-rtsp-restream-low-latency',
            roles: ['detect', 'record'],
          },
        ],
      },
      detect,
      objects: {
        ...existingObjects,
        track: Array.from(
          new Set([...((existingObjects.track as string[] | undefined) ?? []), 'person']),
        ),
        filters: {
          ...existingFilters,
          person: {
            ...existingPerson,
            min_score: settings?.person_min_score ?? existingPerson.min_score ?? 0.5,
            threshold: settings?.person_threshold ?? existingPerson.threshold ?? 0.7,
            min_area: settings?.person_min_area ?? existingPerson.min_area ?? 1500,
          },
        },
      },
      snapshots: {
        ...snapshots,
        enabled: settings?.snapshots_enabled ?? snapshots.enabled ?? true,
        bounding_box: settings?.snapshot_bounding_box ?? snapshots.bounding_box ?? true,
      },
      record: {
        ...recordOptions,
        enabled: settings?.recording_enabled ?? record.enabled ?? true,
        detections: {
          ...detections,
          retain: { ...detectionRetain, days: retentionDays },
        },
        alerts: {
          ...alerts,
          retain: { ...alertRetain, days: retentionDays },
        },
      },
      zones: existingZones,
    };

    return YAML.stringify(parsedConfig);
  }

  hasAppliedZones(
    rawYaml: string,
    cameraSlug: string,
    expectedSlugs: string[],
    removedSlugs: string[] = [],
  ): boolean {
    const parsed = this.parseConfig(rawYaml);
    const cameras = parsed.cameras as Record<string, Record<string, unknown>> | undefined;
    const zones = cameras?.[cameraSlug]?.zones as Record<string, unknown> | undefined;
    if (!zones) return expectedSlugs.length === 0;
    return (
      expectedSlugs.every((slug) => Object.hasOwn(zones, slug)) &&
      removedSlugs.every((slug) => !Object.hasOwn(zones, slug))
    );
  }

  hasAppliedSettings(runningConfig: string, expectedConfig: string, cameraSlug: string): boolean {
    const running = this.parseConfig(runningConfig);
    const expected = this.parseConfig(expectedConfig);
    const valueAt = (config: Record<string, unknown>, path: string): unknown =>
      ['cameras', cameraSlug, ...path.split('.')].reduce<unknown>(
        (value, key) =>
          value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
        config,
      );
    return [
      'enabled',
      'detect.enabled',
      'detect.width',
      'detect.height',
      'detect.fps',
      'detect.min_initialized',
      'detect.max_disappeared',
      'objects.filters.person.min_score',
      'objects.filters.person.threshold',
      'objects.filters.person.min_area',
      'snapshots.enabled',
      'snapshots.bounding_box',
      'record.enabled',
      'record.detections.retain.days',
      'record.alerts.retain.days',
    ].every((path) => {
      const target = valueAt(expected, path);
      const actual = valueAt(running, path);
      if (target === undefined) return true;
      if (typeof actual === 'number' || typeof target === 'number') {
        return actual !== undefined && Math.abs(Number(actual) - Number(target)) < 0.000001;
      }
      return actual === target;
    });
  }

  private toFrigateZone(
    zone: NonNullable<CameraFrigateData['zones']>[number],
  ): Record<string, unknown> {
    const coordinates = zone.polygon
      .flatMap(([x, y]) => [this.formatCoordinate(x), this.formatCoordinate(y)])
      .join(',');
    return {
      coordinates,
      objects: ['person'],
      ...(zone.zoneType === 'RESTRICTED' ? { loitering_time: zone.minDwellSeconds ?? 2 } : {}),
    };
  }

  private formatCoordinate(value: number): string {
    return Number(value.toFixed(6)).toString();
  }

  private parseConfig(rawYaml: string): Record<string, unknown> {
    try {
      const parsed = YAML.parse(rawYaml) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      this.logger.error('Lỗi khi phân tích cú pháp YAML cấu hình Frigate:', err);
      throw new Error('YAML cấu hình Frigate không hợp lệ');
    }
  }

  private resolveStreamUrl(camera: CameraAggregateRecord, mediamtxRtspBaseUrl: string): string {
    if (camera.source_type_val === 'RTSP') {
      const rtspUrl = camera.source_rtsp_url ?? camera.rtsp_url;
      if (rtspUrl) return rtspUrl;
    }
    return `${mediamtxRtspBaseUrl}/${camera.slug}`;
  }
}
