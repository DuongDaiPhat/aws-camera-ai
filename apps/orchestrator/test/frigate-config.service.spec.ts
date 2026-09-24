import YAML from 'yaml';
import { FrigateConfigService } from '../src/frigate/frigate-config.service';
import type { CameraAggregateRecord } from '../src/cameras/cameras.types';

describe('FrigateConfigService', () => {
  let service: FrigateConfigService;

  const mockCamera: CameraAggregateRecord = {
    id: 'c1111111-1111-1111-1111-111111111111',
    device_id: 'd1111111-1111-1111-1111-111111111111',
    name: 'Camera Cổng Chính',
    slug: 'camera_cong_chinh',
    rtsp_url: 'rtsp://admin:secret@192.168.1.100:554/stream1',
    detect_width: 1280,
    detect_height: 720,
    fps: 5,
    timezone: 'Asia/Ho_Chi_Minh',
    is_enabled: true,
    detection_enabled: true,
    retention_days: 7,
    created_at: new Date(),
    updated_at: new Date(),
    source_id: 's111',
    source_type_val: 'RTSP',
    source_rtsp_url: 'rtsp://admin:secret@192.168.1.100:554/stream1',
    source_video_key: null,
    source_video_name: null,
    source_video_loop: null,
    source_transport: 'TCP',
    source_status: 'ONLINE',
    source_error_code: null,
    source_error_msg: null,
    config_version: 1,
    sync_status: 'SYNCED',
    zone_count: 1,
  };

  beforeEach(() => {
    service = new FrigateConfigService();
  });

  it('sinh cau hinh Frigate YAML hop le tu chuoi rong', () => {
    const yamlResult = service.generateUpdatedConfig('', {
      camera: mockCamera,
      mediamtxRtspBaseUrl: 'rtsp://mediamtx:8554',
    });

    const parsed = YAML.parse(yamlResult);
    expect(parsed.cameras).toBeDefined();
    expect(parsed.cameras.camera_cong_chinh).toBeDefined();
    expect(parsed.cameras.camera_cong_chinh.enabled).toBe(true);
    expect(parsed.cameras.camera_cong_chinh.ffmpeg.inputs[0].path).toBe(mockCamera.rtsp_url);
    expect(parsed.cameras.camera_cong_chinh.detect.fps).toBe(5);
  });

  it('BAO TOAN 100% polygon zones cua Thanh vien C (US-12)', () => {
    const initialYaml = YAML.stringify({
      mqtt: { host: 'mosquitto' },
      cameras: {
        camera_cong_chinh: {
          ffmpeg: { inputs: [{ path: 'rtsp://old-url', roles: ['detect'] }] },
          zones: {
            zone_cong_truoc: {
              coordinates: '0.1,0.2,0.3,0.4,0.5,0.6',
              objects: ['person'],
            },
            zone_san_vuon: {
              coordinates: '0.6,0.7,0.8,0.9',
              objects: ['person', 'car'],
            },
          },
        },
      },
    });

    const updatedYaml = service.generateUpdatedConfig(initialYaml, {
      camera: {
        ...mockCamera,
        detect_width: 1920,
        detect_height: 1080,
        fps: 10,
      },
      mediamtxRtspBaseUrl: 'rtsp://mediamtx:8554',
    });

    const parsed = YAML.parse(updatedYaml);
    expect(parsed.mqtt.host).toBe('mosquitto');
    expect(parsed.cameras.camera_cong_chinh.detect.width).toBe(1920);
    expect(parsed.cameras.camera_cong_chinh.detect.fps).toBe(10);

    // Xac nhan vung giam sat cua Thanh vien C van nguyen ven
    expect(parsed.cameras.camera_cong_chinh.zones).toBeDefined();
    expect(parsed.cameras.camera_cong_chinh.zones.zone_cong_truoc).toEqual({
      coordinates: '0.1,0.2,0.3,0.4,0.5,0.6',
      objects: ['person'],
    });
    expect(parsed.cameras.camera_cong_chinh.zones.zone_san_vuon).toEqual({
      coordinates: '0.6,0.7,0.8,0.9',
      objects: ['person', 'car'],
    });
  });

  it('su dung dia chi trung chuyen MediaMTX cho nguon VIDEO_FILE hoac BROWSER_WEBCAM', () => {
    const videoCamera: CameraAggregateRecord = {
      ...mockCamera,
      slug: 'camera_hanh_lang',
      source_type_val: 'VIDEO_FILE',
      rtsp_url: '',
    };

    const yamlResult = service.generateUpdatedConfig('', {
      camera: videoCamera,
      mediamtxRtspBaseUrl: 'rtsp://mediamtx:8554',
    });

    const parsed = YAML.parse(yamlResult);
    expect(parsed.cameras.camera_hanh_lang.ffmpeg.inputs[0].path).toBe(
      'rtsp://mediamtx:8554/camera_hanh_lang',
    );
  });

  it('nem loi khi cu phap YAML khong hop le', () => {
    const invalidYaml = 'invalid: [yaml: broken';

    expect(() =>
      service.generateUpdatedConfig(invalidYaml, {
        camera: mockCamera,
      }),
    ).toThrow('YAML cấu hình Frigate không hợp lệ');
  });
});
