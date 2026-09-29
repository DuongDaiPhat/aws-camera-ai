import { ConfigService } from '@nestjs/config';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { AiResultsService } from '../src/ai-results/ai-results.service';
import { AiResultValidator } from '../src/ai-results/ai-result.validator';
import { SubmitAiResultDto } from '../src/ai-results/dto/submit-ai-result.dto';
import type { EventRecord } from '../src/events/events.repository';
import {
  ZoneResultProducerService,
  ZoneResultContext,
} from '../src/ingestion/zone-result-producer.service';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const observedSeconds = 1_790_485_202.1;

function context(): ZoneResultContext {
  return {
    camera: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Bếp',
      slug: 'cam_kitchen',
      zone_config_applied: true,
      zone_config_version: 7,
    },
    zones: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        camera_id: '22222222-2222-4222-8222-222222222222',
        name: 'Vùng bếp',
        slug: 'restricted_stove',
        zone_type: 'RESTRICTED',
        min_dwell_seconds: 2,
      },
    ],
  };
}

describe('ZoneResultProducerService (US-12 → US-11)', () => {
  let submit: jest.Mock;
  let service: ZoneResultProducerService;
  let received: SubmitAiResultDto[];
  const event: EventRecord = {
    id: EVENT_ID,
    camera_id: context().camera.id,
    zone_id: context().zones[0].id,
    event_type: 'RESTRICTED_ZONE',
    status: 'DETECTED',
    priority: 'P1',
    source: 'FRIGATE',
    track_id: 'track-zone',
    dedup_key: 'frigate:cam_kitchen:track-zone',
    confidence: null,
    ai_results: [],
    correlation_id: EVENT_ID,
    detected_at: new Date((observedSeconds - 2.1) * 1_000),
    created_at: new Date(),
    updated_at: new Date(),
  };
  const after = {
    id: 'track-zone',
    camera: 'cam_kitchen',
    frame_time: observedSeconds,
    label: 'person',
    score: 0.94,
    current_zones: ['restricted_stove'],
  };

  beforeEach(() => {
    received = [];
    const validator = new AiResultValidator(
      new ConfigService({
        AI_RESULT_MAX_ITEMS: '20',
        AI_RESULT_MAX_METADATA_BYTES: '16384',
        AI_RESULT_MAX_METADATA_DEPTH: '5',
        AI_RESULT_MAX_FUTURE_SECONDS: '300',
      }),
    );
    submit = jest.fn(async (eventId: string, dto: SubmitAiResultDto) => {
      expect(await validate(plainToInstance(SubmitAiResultDto, dto))).toEqual([]);
      validator.validate(eventId, dto);
      received.push(dto);
    });
    service = new ZoneResultProducerService({ submit } as unknown as AiResultsService);
  });

  it('gửi score thật và bằng chứng loitering, không dựng thời điểm vào vùng hoặc dwell', async () => {
    await service.submit(event, after, context());
    expect(received[0]).toMatchObject({
      module: 'M4_ZONE',
      revision: 2101,
      modelVersion: 'frigate-loitering-v1:config-7',
      results: [
        {
          confidence: 0.94,
          metadata: {
            enteredAt: null,
            dwellSeconds: null,
            minDwellSeconds: 2,
            dwellEvidence: 'FRIGATE_CURRENT_ZONE_LOITERING',
            zoneConfigVersion: 7,
          },
        },
      ],
    });
  });

  it('replay cùng observation giữ nguyên receipt, frame mới tăng revision cùng zone', async () => {
    await service.submit(event, after, context());
    await service.submit(event, after, context());
    await service.submit(event, { ...after, frame_time: observedSeconds + 1 }, context());
    expect(received[1]).toEqual(received[0]);
    expect(received[2].resultId).not.toBe(received[0].resultId);
    expect(received[2].observationId).toBe(received[0].observationId);
    expect(received[2].revision).toBe(received[0].revision + 1000);
  });

  it('giữ mỗi vùng cấm đồng thời thành receipt riêng', async () => {
    const zones = context();
    zones.zones.push({ ...zones.zones[0], id: '44444444-4444-4444-8444-444444444444' });
    await service.submit(event, after, zones);
    expect(received).toHaveLength(2);
    expect(received[0].resultId).not.toBe(received[1].resultId);
    expect(received[0].observationId).not.toBe(received[1].observationId);
  });

  it('không gửi M4 khi không có vùng hợp lệ hoặc chưa có version đã đồng bộ', async () => {
    await service.submit(event, after, null);
    await service.submit(event, after, { ...context(), zones: [] });
    const pending = context();
    pending.camera.zone_config_applied = false;
    await expect(service.submit(event, after, pending)).rejects.toThrow('Chưa xác minh');
    expect(submit).not.toHaveBeenCalled();
  });

  it('từ chối score không hợp lệ và observation cũ hơn lúc tạo track', async () => {
    await expect(service.submit(event, { ...after, score: 1.1 }, context())).rejects.toThrow();
    await expect(
      service.submit(event, { ...after, frame_time: observedSeconds - 10 }, context()),
    ).rejects.toThrow('revision');
    expect(received).toHaveLength(0);
  });
});
