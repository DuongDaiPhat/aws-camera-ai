import { apiFetch, getAccessToken, API_BASE_URL } from './api-client';
import { formatRelativeTime } from './format';
import type { EventSummary, UIEventItem, EventDetail } from '@/types';
import { INITIAL_MOCK_EVENTS, getMockEventDetail } from './mock-events';

interface ListEventsResponse {
  data: EventSummary[];
  meta?: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export function toUIEventItem(e: EventSummary): UIEventItem {
  let aiTag = 'Chuyển động';
  let aiTagColor: UIEventItem['aiTagColor'] = 'neutral';

  if (e.eventType === 'FIRE_SMOKE_DETECTED') {
    aiTag = e.confidence ? `${Math.round(e.confidence * 100)}% khói` : 'Khói / Lửa';
    aiTagColor = 'danger';
  } else if (e.eventType === 'FALL_DETECTED') {
    aiTag = e.confidence ? `Pose AI ${Math.round(e.confidence * 100)}%` : 'Té ngã';
    aiTagColor = 'warning';
  } else if (e.eventType === 'UNKNOWN_PERSON') {
    aiTag = 'Người lạ';
    aiTagColor = 'warning';
  } else if (e.status === 'RESOLVED') {
    aiTag = 'An toàn';
    aiTagColor = 'success';
  }

  const cameraName = e.camera?.name?.toLowerCase() || '';
  const cameraCode = cameraName.includes('02') || cameraName.includes('bếp') ? 'CAM 02' : 'CAM 01';

  return {
    ...e,
    cameraCode,
    aiTag,
    aiTagColor,
    relativeTimeText: formatRelativeTime(e.detectedAt),
  };
}

export async function fetchEvents(): Promise<UIEventItem[]> {
  try {
    const res = await apiFetch<ListEventsResponse>('/events?pageSize=20');
    if (res && Array.isArray(res.data) && res.data.length > 0) {
      return res.data.map(toUIEventItem);
    }
  } catch {
    // Khi backend chưa có dữ liệu hoặc offline, fallback về mock data
  }
  return INITIAL_MOCK_EVENTS;
}

export async function fetchEventDetail(eventId: string): Promise<EventDetail> {
  try {
    const detail = await apiFetch<EventDetail>(`/events/${eventId}`);
    if (detail && detail.id) {
      return detail;
    }
  } catch {
    // Fallback sang mock data
  }

  const found = INITIAL_MOCK_EVENTS.find((e) => e.id === eventId);
  if (found) {
    return getMockEventDetail(found);
  }

  return getMockEventDetail(INITIAL_MOCK_EVENTS[0]!);
}

/**
 * Lắng nghe luồng SSE realtime từ backend (US-06, FR-DSH-02).
 */
export function subscribeEventsStream(onEvent: (event: UIEventItem) => void): () => void {
  if (typeof window === 'undefined' || !window.EventSource) {
    return () => {};
  }

  const token = getAccessToken();
  if (!token) {
    return () => {};
  }

  const url = `${API_BASE_URL}/events/stream?token=${encodeURIComponent(token)}`;
  const eventSource = new EventSource(url);

  eventSource.addEventListener('event.created', (event: MessageEvent) => {
    try {
      const summary = JSON.parse(event.data) as EventSummary;
      onEvent(toUIEventItem(summary));
    } catch {
      // bỏ qua lỗi parse SSE message
    }
  });

  return () => {
    eventSource.close();
  };
}
