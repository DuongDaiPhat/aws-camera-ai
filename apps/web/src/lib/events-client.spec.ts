import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from './api-client';
import {
  fetchEventDetail,
  fetchEvents,
  fetchEventStats,
  subscribeEventsStream,
  toUIEventItem,
} from './events-client';
import type { EventStats, EventSummary } from '@/types';

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('toUIEventItem', () => {
  it('chuyển đổi sự kiện khói/lửa chính xác với aiTag và nhãn nguy hiểm', () => {
    const summary: EventSummary = {
      id: 'ev-1',
      eventType: 'FIRE_SMOKE_DETECTED',
      priority: 'P0',
      status: 'DETECTED',
      confidence: 0.92,
      detectedAt: new Date(Date.now() - 60000).toISOString(),
      camera: { id: 'cam-1', name: 'Camera Bếp' },
    };

    const uiItem = toUIEventItem(summary);
    expect(uiItem.aiTag).toBe('92% khói');
    expect(uiItem.aiTagColor).toBe('danger');
    expect(uiItem.cameraCode).toBe('CAM 02');
  });

  it('chuyển đổi sự kiện té ngã chính xác', () => {
    const summary: EventSummary = {
      id: 'ev-2',
      eventType: 'FALL_DETECTED',
      priority: 'P1',
      status: 'DETECTED',
      confidence: 0.88,
      detectedAt: new Date().toISOString(),
      camera: { id: 'cam-2', name: 'Phòng khách' },
    };

    const uiItem = toUIEventItem(summary);
    expect(uiItem.aiTag).toBe('Pose AI 88%');
    expect(uiItem.aiTagColor).toBe('warning');
    expect(uiItem.cameraCode).toBe('CAM 01');
  });

  it('gắn nhãn "Phát hiện người" kèm độ tin cậy cho sự kiện từ Frigate (US-03)', () => {
    const summary: EventSummary = {
      id: 'ev-person',
      eventType: 'PERSON_DETECTED',
      priority: 'P3',
      status: 'DETECTED',
      confidence: 0.84,
      detectedAt: new Date().toISOString(),
      camera: { id: 'cam-3', name: 'Camera 03' },
      thumbnailUrl: 'https://minio.local/snapshot.jpg',
    };

    const uiItem = toUIEventItem(summary);
    expect(uiItem.aiTag).toBe('Phát hiện người 84%');
    expect(uiItem.aiTagColor).toBe('info');
    expect(uiItem.cameraCode).toBe('CAM 03');
    expect(uiItem.thumbnailUrl).toBe('https://minio.local/snapshot.jpg');
  });

  it('bỏ phần trăm khi backend chưa có confidence', () => {
    const summary: EventSummary = {
      id: 'ev-person-2',
      eventType: 'PERSON_DETECTED',
      priority: 'P3',
      status: 'DETECTED',
      confidence: null,
      detectedAt: new Date().toISOString(),
    };

    expect(toUIEventItem(summary).aiTag).toBe('Phát hiện người');
  });

  it('chuyển đổi sự kiện đã giải quyết thành nhãn An toàn', () => {
    const summary: EventSummary = {
      id: 'ev-3',
      eventType: 'PERSON_DETECTED',
      priority: 'P3',
      status: 'RESOLVED',
      detectedAt: new Date().toISOString(),
    };

    const uiItem = toUIEventItem(summary);
    expect(uiItem.aiTag).toBe('An toàn');
    expect(uiItem.aiTagColor).toBe('success');
  });
});

describe('fetchEvents', () => {
  it('trả về danh sách sự kiện từ API khi request thành công', async () => {
    const mockEvents: EventSummary[] = [
      {
        id: 'ev-api-1',
        eventType: 'UNKNOWN_PERSON',
        priority: 'P1',
        status: 'DETECTED',
        detectedAt: new Date().toISOString(),
        camera: { id: 'c1', name: 'Sảnh chính' },
      },
    ];

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: mockEvents, meta: { total: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchEvents();
    expect(result.events.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.events[0]?.id).toBe('ev-api-1');
    expect(result.events[0]?.aiTag).toBe('Người lạ');
  });

  it('ném lỗi khi API hỏng để dashboard hiện trạng thái lỗi thay vì dữ liệu giả', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('Network error'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchEvents()).rejects.toThrow('Network error');
  });
});

describe('fetchEventDetail', () => {
  it('gọi đúng endpoint chi tiết sự kiện', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'ev-1', media: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const detail = await fetchEventDetail('ev-1');

    expect(detail.id).toBe('ev-1');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/events/ev-1');
  });
});

describe('fetchEventStats', () => {
  it('trả về số liệu tổng hợp cho các thẻ dashboard', async () => {
    const stats: EventStats = {
      windowHours: 24,
      totalEvents: 7,
      personDetectedCount: 5,
      pendingCount: 2,
      resolvedCount: 4,
      falseAlarmCount: 1,
      cameraOnlineCount: 3,
      cameraTotalCount: 4,
      byType: [{ eventType: 'PERSON_DETECTED', count: 5 }],
      byPriority: [{ priority: 'P3', count: 5 }],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(stats));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchEventStats();

    expect(result.personDetectedCount).toBe(5);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/events/stats');
  });
});

describe('subscribeEventsStream', () => {
  function stubEventSource() {
    const listeners = new Map<string, (event: MessageEvent) => void>();
    const mockClose = vi.fn();

    class MockEventSource {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
      addEventListener(event: string, listener: (event: MessageEvent) => void): void {
        listeners.set(event, listener);
      }
      close(): void {
        mockClose();
      }
    }

    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('window', { EventSource: MockEventSource });

    return { listeners, mockClose };
  }

  const incoming: EventSummary = {
    id: 'ev-stream-1',
    eventType: 'PERSON_DETECTED',
    priority: 'P3',
    status: 'DETECTED',
    detectedAt: new Date().toISOString(),
  };

  it('gọi onCreated khi nhận message event.created', () => {
    setAccessToken('valid-token-123');
    const { listeners, mockClose } = stubEventSource();

    const onCreated = vi.fn();
    const onUpdated = vi.fn();
    const unsubscribe = subscribeEventsStream({ onCreated, onUpdated });

    listeners.get('event.created')!({ data: JSON.stringify(incoming) } as MessageEvent);

    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'ev-stream-1' }));
    expect(onUpdated).not.toHaveBeenCalled();

    unsubscribe();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('gọi onUpdated khi snapshot về muộn và backend phát event.updated', () => {
    setAccessToken('valid-token-123');
    const { listeners } = stubEventSource();

    const onCreated = vi.fn();
    const onUpdated = vi.fn();
    subscribeEventsStream({ onCreated, onUpdated });

    listeners.get('event.updated')!({
      data: JSON.stringify({ ...incoming, thumbnailUrl: 'https://minio.local/snapshot.jpg' }),
    } as MessageEvent);

    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ thumbnailUrl: 'https://minio.local/snapshot.jpg' }),
    );
    expect(onCreated).not.toHaveBeenCalled();
  });
});
