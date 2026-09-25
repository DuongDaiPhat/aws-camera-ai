import { Injectable, Logger } from '@nestjs/common';
import YAML from 'yaml';
import type { CameraAggregateRecord } from '../cameras/cameras.types';
import type { CameraFrigateSettingsRecord } from '../cameras/cameras.types';

export interface CameraFrigateData {
  camera: CameraAggregateRecord;
  mediamtxRtspBaseUrl?: string;
  settings?: CameraFrigateSettingsRecord | null;
}

@Injectable()
export class FrigateConfigService {
  private readonly logger = new Logger(FrigateConfigService.name);

  generateUpdatedConfig(rawYaml: string, data: CameraFrigateData): string {
    const { camera, settings, mediamtxRtspBaseUrl = 'rtsp://mediamtx:8554' } = data;
    const slug = camera.slug;

    const parsedConfig = this.parseConfig(rawYaml);
    if (!parsedConfig.cameras || typeof parsedConfig.cameras !== 'object') {
      parsedConfig.cameras = {};
    }

    const cameras = parsedConfig.cameras as Record<string, Record<string, unknown>>;
    const existingCamera = cameras[slug] ?? {};
    const preservedZones = existingCamera.zones ?? {};
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
      zones: preservedZones, // Bảo toàn 100% zones của Thành viên C
    };

    return YAML.stringify(parsedConfig);
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
