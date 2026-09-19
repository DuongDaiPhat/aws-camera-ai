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
      confidence: 0.9,
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
