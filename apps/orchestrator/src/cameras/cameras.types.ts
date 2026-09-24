import type { components } from '@cam/contracts';

export type Schema = components['schemas'];
export type CameraSourceType = Schema['CameraSourceType'];
export type CameraRuntimeStatus = Schema['CameraRuntimeStatus'];
export type CameraSourceDetail = Schema['CameraSourceDetail'];
export type CameraDto = Schema['Camera'];

export interface CameraRecord {
  id: string;
  device_id: string;
  name: string;
  slug: string;
  rtsp_url: string;
  detect_width: number;
  detect_height: number;
  fps: number;
  timezone: string;
  is_enabled: boolean;
  detection_enabled: boolean;
  retention_days: number;
  created_at: Date;
  updated_at: Date;
}

export interface CameraSourceRecord {
  id: string;
  camera_id: string;
  source_type: CameraSourceType;
  rtsp_url: string | null;
  video_object_key: string | null;
  video_original_name: string | null;
  video_loop: boolean;
  transport: 'TCP' | 'UDP';
  input_format: string | null;
  webcam_device_label: string | null;
  status: CameraRuntimeStatus;
  last_error_code: string | null;
  last_error_message: string | null;
  process_id: string | null;
  started_at: Date | null;
  stopped_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CameraFrigateSettingsRecord {
  camera_id: string;
  detect_width: number;
  detect_height: number;
  detect_fps: number;
  min_initialized_frames: number;
  max_disappeared_frames: number;
  person_min_score: string | number;
  person_threshold: string | number;
  person_min_area: number;
  snapshots_enabled: boolean;
  snapshot_bounding_box: boolean;
  recording_enabled: boolean;
  detection_retention_days: number;
  config_version: number;
  applied_version: number;
  sync_status: 'PENDING' | 'SYNCED' | 'FAILED';
  sync_error_code: string | null;
  sync_error_message: string | null;
  updated_at: Date;
}

export interface CameraAggregateRecord extends CameraRecord {
  source_id: string | null;
  source_type_val: CameraSourceType | null;
  source_rtsp_url: string | null;
  source_video_key: string | null;
  source_video_name: string | null;
  source_video_loop: boolean | null;
  source_transport: 'TCP' | 'UDP' | null;
  source_status: CameraRuntimeStatus | null;
  source_error_code: string | null;
  source_error_msg: string | null;
  config_version: number | null;
  sync_status: 'PENDING' | 'SYNCED' | 'FAILED' | null;
  zone_count: string | number;
}
