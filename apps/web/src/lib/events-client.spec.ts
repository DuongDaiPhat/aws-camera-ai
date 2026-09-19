import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from './api-client';
import { fetchEvents, subscribeEventsStream, toUIEventItem } from './events-client';
import type { EventSummary } from '@/types';

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: mockEvents }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchEvents();
    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe('ev-api-1');
    expect(result[0]?.aiTag).toBe('Người lạ');
  });

  it('fallback về mock data khi API gặp lỗi', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('Network error'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchEvents();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.id).toBeDefined();
  });
});

describe('subscribeEventsStream', () => {
  it('đăng ký lắng nghe SSE và gọi callback khi có message', () => {
    setAccessToken('valid-token-123');

    let capturedListener: ((event: MessageEvent) => void) | null = null;
    const mockClose = vi.fn();

    class MockEventSource {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
      addEventListener(event: string, listener: (event: MessageEvent) => void): void {
        if (event === 'event.created') {
          capturedListener = listener;
        }
      }
      close(): void {
        mockClose();
      }
    }

    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('window', { EventSource: MockEventSource });

    const onEvent = vi.fn();
    const unsubscribe = subscribeEventsStream(onEvent);

    expect(capturedListener).not.toBeNull();

    const incoming: EventSummary = {
      id: 'ev-stream-1',
      eventType: 'FIRE_SMOKE_DETECTED',
      priority: 'P0',
      status: 'DETECTED',
      detectedAt: new Date().toISOString(),
    };

    capturedListener!({ data: JSON.stringify(incoming) } as MessageEvent);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'ev-stream-1' }));

    unsubscribe();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
