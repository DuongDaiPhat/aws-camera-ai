import { EventsRepository } from '../src/events/events.repository';
import type { Pool } from 'pg';

describe('EventsRepository (US-03, US-06)', () => {
  let repository: EventsRepository;
  let mockPool: { query: jest.Mock };

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    };
    repository = new EventsRepository(mockPool as unknown as Pool);
  });

  describe('findCameraBySlug', () => {
    it('tra ve camera neu tim thay', async () => {
      const mockCam = { id: 'cam-1', name: 'Camera 1', slug: 'camera_1' };
      mockPool.query.mockResolvedValueOnce({ rows: [mockCam] });

      const res = await repository.findCameraBySlug('camera_1');
      expect(res).toEqual(mockCam);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE slug = $1'), [
        'camera_1',
      ]);
    });

    it('tra ve null neu khong tim thay', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await repository.findCameraBySlug('not_found');
      expect(res).toBeNull();
    });
  });

  describe('findZoneByCameraAndSlug', () => {
    it('tra ve zone neu tim thay', async () => {
      const mockZone = { id: 'z-1', camera_id: 'c-1', name: 'Zone 1', slug: 'zone_1' };
      mockPool.query.mockResolvedValueOnce({ rows: [mockZone] });

      const res = await repository.findZoneByCameraAndSlug('c-1', 'zone_1');
      expect(res).toEqual(mockZone);
    });

    it('tra ve null neu khong tim thay', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await repository.findZoneByCameraAndSlug('c-1', 'z-none');
      expect(res).toBeNull();
    });
  });

  describe('createEvent', () => {
    const input = {
      cameraId: 'c-1',
      zoneId: 'z-1',
      eventType: 'FALL_DETECTED' as const,
      source: 'FRIGATE',
      trackId: 'track-1',
      dedupKey: 'dedup-1',
      detectionConfidence: 0.9,
      detectedAt: new Date(),
    };

    it('ghi thanh cong su kien moi', async () => {
      const createdRecord = { id: 'evt-1', ...input };
      mockPool.query.mockResolvedValueOnce({ rows: [createdRecord] });

      const res = await repository.createEvent(input);
      expect(res).toEqual(createdRecord);
    });

    it('tra ve null khi bi trung lap (conflict)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await repository.createEvent(input);
      expect(res).toBeNull();
    });

    it('nem loi khi query that bai', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB Error'));
      await expect(repository.createEvent(input)).rejects.toThrow('DB Error');
    });
  });

  describe('listEvents', () => {
    it('loc theo cac tieu chi day du va phan trang chinh xac', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 10 }] }) // Count query
        .mockResolvedValueOnce({ rows: [{ id: 'evt-1' }, { id: 'evt-2' }] }); // Data query

      const result = await repository.listEvents({
        page: 2,
        pageSize: 5,
        eventType: ['FALL_DETECTED'],
        status: ['NOTIFIED'],
        priority: ['P0'],
        cameraId: 'cam-1',
        zoneId: 'z-1',
        from: '2026-09-01T00:00:00Z',
        to: '2026-09-19T23:59:59Z',
        isFalseAlarm: false,
      });

      expect(result.total).toBe(10);
      expect(result.events).toHaveLength(2);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('hoat dong mac dinh khi khong truyen filter', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await repository.listEvents({
        page: 1,
        pageSize: 20,
      });

      expect(result.total).toBe(0);
      expect(result.events).toHaveLength(0);
    });
  });

  describe('findEventDetailById', () => {
    it('lay du cot chi tiet cua su kien', async () => {
      const record = { id: 'evt-123', source: 'FRIGATE', ai_results: [] };
      mockPool.query.mockResolvedValueOnce({ rows: [record] });

      const res = await repository.findEventDetailById('evt-123');

      expect(res).toEqual(record);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('e.correlation_id'), [
        'evt-123',
      ]);
    });

    it('tra ve null khi khong tim thay', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      expect(await repository.findEventDetailById('none')).toBeNull();
    });
  });

  describe('listStatusHistoryByEventId', () => {
    it('gioi han so ban ghi lich su tra ve', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await repository.listStatusHistoryByEventId('evt-1', 50);

      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $2'), [
        'evt-1',
        50,
      ]);
    });
  });

  describe('getEventStats', () => {
    it('gop ket qua cua nam truy van thanh mot ban ghi thong ke', async () => {
      const aggregate = {
        total_events: 5,
        person_detected_count: 4,
        pending_count: 2,
        resolved_count: 3,
        false_alarm_count: 0,
        latest_event_at: new Date('2026-09-19T10:00:00Z'),
      };
      const byType = [{ event_type: 'PERSON_DETECTED', count: 4 }];
      const byPriority = [{ priority: 'P3', count: 4 }];
      const cameras = { online_count: 2, total_count: 3 };
      const latestPending = {
        id: 'evt-1',
        event_type: 'PERSON_DETECTED',
        priority: 'P3',
        camera_name: 'Camera bep',
        zone_name: null,
        detected_at: new Date('2026-09-19T09:00:00Z'),
      };

      // getEventStats chay 5 truy van song song nen thu tu tra ve phai khop theo query
      mockPool.query.mockImplementation((sql: string) => {
        if (sql.includes('person_detected_count')) return Promise.resolve({ rows: [aggregate] });
        if (sql.includes('GROUP BY event_type')) return Promise.resolve({ rows: byType });
        if (sql.includes('GROUP BY priority')) return Promise.resolve({ rows: byPriority });
        if (sql.includes('FROM cameras c')) return Promise.resolve({ rows: [cameras] });
        return Promise.resolve({ rows: [latestPending] });
      });

      const stats = await repository.getEventStats(new Date('2026-09-18T10:00:00Z'), 20);

      expect(stats.aggregate).toEqual(aggregate);
      expect(stats.byType).toEqual(byType);
      expect(stats.byPriority).toEqual(byPriority);
      expect(stats.cameras).toEqual(cameras);
      expect(stats.latestPendingEvent).toEqual(latestPending);
    });

    it('tra ve gia tri 0 khi chua co du lieu nao', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const stats = await repository.getEventStats(new Date('2026-09-18T10:00:00Z'), 20);

      expect(stats.aggregate.total_events).toBe(0);
      expect(stats.cameras).toEqual({ online_count: 0, total_count: 0 });
      expect(stats.latestPendingEvent).toBeNull();
    });
  });

  describe('findEventSummaryById', () => {
    it('tra ve event record khi tim thay', async () => {
      const record = { id: 'evt-123' };
      mockPool.query.mockResolvedValueOnce({ rows: [record] });

      const res = await repository.findEventSummaryById('evt-123');
      expect(res).toEqual(record);
    });

    it('tra ve null khi khong tim thay', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await repository.findEventSummaryById('none');
      expect(res).toBeNull();
    });
  });
});
