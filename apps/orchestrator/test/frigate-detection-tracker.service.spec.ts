import { ConfigService } from '@nestjs/config';
import { FrigateDetectionTrackerService } from '../src/frigate/frigate-detection-tracker.service';

describe('FrigateDetectionTrackerService', () => {
  let service: FrigateDetectionTrackerService;

  beforeEach(() => {
    const configService = {
      get: jest.fn((_key: string, fallback: number) => fallback),
    } as unknown as ConfigService;
    service = new FrigateDetectionTrackerService(configService);
  });

  it('tracks new and update messages then removes a detection on end', () => {
    service.track('new', {
      id: 'track-1',
      camera: 'cam_test',
      label: 'person',
      score: 0.81,
      frame_time: 100,
      box: [100, 50, 200, 300],
      current_zones: ['living_room'],
    });
    service.track('update', {
      id: 'track-1',
      camera: 'cam_test',
      label: 'person',
      score: 0.93,
      frame_time: 101,
      box: [120, 60, 220, 320],
      current_zones: ['living_room', 'door'],
    });

    expect(service.getActiveDetections('cam_test')).toEqual([
      expect.objectContaining({ id: 'track-1', confidence: 0.93, box: [120, 60, 220, 320] }),
    ]);
    expect(service.getActiveZones('cam_test')).toEqual(['living_room', 'door']);

    service.track('end', {
      id: 'track-1',
      camera: 'cam_test',
      label: 'person',
      score: 0.93,
      frame_time: 102,
      box: [120, 60, 220, 320],
    });

    expect(service.getActiveDetections('cam_test')).toEqual([]);
  });

  it('ignores non-person and malformed bounding boxes', () => {
    service.track('new', {
      id: 'track-car',
      camera: 'cam_test',
      label: 'car',
      score: 0.9,
      frame_time: 100,
      box: [1, 2, 3, 4],
    });
    service.track('new', {
      id: 'track-person',
      camera: 'cam_test',
      label: 'person',
      score: 0.9,
      frame_time: 100,
      box: [1, 2],
    });

    expect(service.getActiveDetections('cam_test')).toEqual([]);
  });

  it('retains stationary detections beyond short intervals and only expires after full TTL', () => {
    jest.useFakeTimers();
    try {
      service.track('new', {
        id: 'track-stationary',
        camera: 'cam_test',
        label: 'person',
        score: 0.88,
        frame_time: 100,
        box: [50, 50, 200, 200],
        current_zones: [],
      });

      // Advance by 4s (person is stationary, within TTL)
      jest.advanceTimersByTime(4_000);
      expect(service.getActiveDetections('cam_test')).toHaveLength(1);

      // Advance beyond 8s TTL fallback
      jest.advanceTimersByTime(5_000);
      expect(service.getActiveDetections('cam_test')).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears camera detections immediately when clearCamera is called', () => {
    service.track('new', {
      id: 'track-test',
      camera: 'cam_test',
      label: 'person',
      score: 0.9,
      frame_time: 100,
      box: [10, 10, 100, 100],
    });
    expect(service.getActiveDetections('cam_test')).toHaveLength(1);
    service.clearCamera('cam_test');
    expect(service.getActiveDetections('cam_test')).toEqual([]);
  });
});
