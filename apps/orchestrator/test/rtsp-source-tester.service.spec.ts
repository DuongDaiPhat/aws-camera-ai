import { ConfigService } from '@nestjs/config';
import {
  RtspSourceTesterService,
  type RtspProbeOutput,
} from '../src/camera-sources/rtsp-source-tester.service';

class TestRtspSourceTesterService extends RtspSourceTesterService {
  probeOutput: RtspProbeOutput = { success: true, stderr: '' };
  capturedArgs: string[] = [];

  protected override async executeProbe(args: string[]): Promise<RtspProbeOutput> {
    this.capturedArgs = args;
    return this.probeOutput;
  }
}

describe('RtspSourceTesterService', () => {
  const configService = {
    get: jest.fn((_key: string, fallback: unknown) => fallback),
  } as unknown as ConfigService;

  it('dung ffprobe voi mang argument va transport TCP', async () => {
    const service = new TestRtspSourceTesterService(configService);

    const result = await service.test('rtsp://user:secret@camera.local/live', 'TCP');

    expect(result.success).toBe(true);
    expect(service.capturedArgs).toContain('tcp');
    expect(service.capturedArgs.at(-1)).toBe('rtsp://user:secret@camera.local/live');
  });

  it('tu choi URL khong dung giao thuc RTSP', async () => {
    const service = new TestRtspSourceTesterService(configService);

    await expect(service.test('https://camera.local/live', 'TCP')).rejects.toMatchObject({
      response: { error: { code: 'SOURCE_UNAVAILABLE' } },
    });
  });

  it('tra ket qua that bai ma khong de lo credential', async () => {
    const service = new TestRtspSourceTesterService(configService);
    service.probeOutput = {
      success: false,
      stderr: 'rtsp://user:secret@camera.local/live: Connection refused',
    };

    const result = await service.test('rtsp://user:secret@camera.local/live', 'UDP');

    expect(result.success).toBe(false);
    expect(result.message).not.toContain('secret');
    expect(result.message).toContain('Không thể kết nối');
  });
});
