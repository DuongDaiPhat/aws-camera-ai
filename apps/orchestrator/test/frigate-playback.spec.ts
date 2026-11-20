import YAML from 'yaml';
import { ConfigService } from '@nestjs/config';
import { FrigateConfigService } from '../src/frigate/frigate-config.service';
import type { CameraAggregateRecord } from '../src/cameras/cameras.types';
describe('Continuous recording for playback', () => {
  const camera = {
    slug: 'cam_test',
    source_type_val: 'RTSP',
    source_rtsp_url: 'rtsp://mediamtx:8554/cam_test',
    is_enabled: true,
    detection_enabled: true,
    retention_days: 7,
  } as CameraAggregateRecord;
  it('records continuously with fire disabled and authenticates internal RTSP reads', () => {
    const service = new FrigateConfigService(
      new ConfigService({
        M3_ENABLED: 'false',
        MEDIAMTX_PUBLISH_USERNAME: 'test-internal',
        MEDIAMTX_PUBLISH_PASSWORD: 'test-secret',
      }),
    );
    const value = YAML.parse(service.generateUpdatedConfig('', { camera })).cameras.cam_test;
    expect(value.record.continuous.days).toBeGreaterThan(0);
    const source = new URL(value.ffmpeg.inputs[0].path);
    expect(source.username).toBe('test-internal');
    expect(source.password).toBe('test-secret');
  });
});
