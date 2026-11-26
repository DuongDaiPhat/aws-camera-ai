import {
  apiFetch,
  getAccessToken,
  refreshSessionToken,
  subscribeAccessTokenChange,
  API_BASE_URL,
} from './api-client';
import { formatRelativeTime } from './format';
import type {
  EventSummary,
  UIEventItem,
  EventDetail,
  EventStats,
  Confirmation,
  operations,
} from '@/types';

/** Số sự kiện tải về mỗi lần mở dashboard (tối đa openapi cho phép là 100). */
export const DEFAULT_EVENTS_PAGE_SIZE = 50;

type ListEventsResponse = operations['listEvents']['responses'][200]['content']['application/json'];

/** Loại sự kiện được dán nhãn theo phần trăm tin cậy của mô hình AI. */
function formatConfidencePercent(confidence: number | null | undefined): string | null {
  if (typeof confidence !== 'number') return null;
  return `${Math.round(confidence * 100)}%`;
}

interface AiTagInfo {
  aiTag: string;
  aiTagColor: UIEventItem['aiTagColor'];
}

/**
 * Nhãn AI hiển thị trên ảnh snapshot của thẻ sự kiện.
 * Luồng 1 (US-03) đẩy lên PERSON_DETECTED và RESTRICTED_ZONE từ Frigate.
 */
function getAiTagInfo(event: EventSummary): AiTagInfo {
  const percent = formatConfidencePercent(event.confidence);

  switch (event.eventType) {
    case 'FIRE_SMOKE_DETECTED':
      return { aiTag: percent ? `${percent} lửa` : 'Lửa', aiTagColor: 'danger' };
    case 'FALL_DETECTED':
      return { aiTag: percent ? `Pose AI ${percent}` : 'Té ngã', aiTagColor: 'warning' };
    case 'UNKNOWN_PERSON':
      return { aiTag: 'Người lạ', aiTagColor: 'warning' };
    case 'RESTRICTED_ZONE':
      return { aiTag: percent ? `Khu vực cấm ${percent}` : 'Khu vực cấm', aiTagColor: 'warning' };
    case 'PERSON_DETECTED':
      return {
        aiTag: percent ? `Phát hiện người ${percent}` : 'Phát hiện người',
        aiTagColor: 'info',
      };
    case 'WELLNESS_TIMEOUT':
      return { aiTag: 'Cần kiểm tra', aiTagColor: 'warning' };
    default:
      return { aiTag: 'Chuyển động', aiTagColor: 'neutral' };
  }
}

/**
 * Mã camera ngắn in trên ảnh. Ưu tiên số thứ tự có sẵn trong tên camera do
 * người dùng đặt ("Camera 02" -> "CAM 02"), sau đó mới tới quy ước theo khu vực.
 */
function getCameraCode(cameraName: string): string {
  const digits = /(\d{1,2})/.exec(cameraName);
  if (digits) {
    return `CAM ${digits[1]!.padStart(2, '0')}`;
  }

  const normalized = cameraName.toLowerCase();
  return normalized.includes('bếp') ? 'CAM 02' : 'CAM 01';
}

export function toUIEventItem(event: EventSummary): UIEventItem {
  const isResolved = event.status === 'RESOLVED';
  const { aiTag, aiTagColor } = isResolved
    ? { aiTag: 'An toàn', aiTagColor: 'success' as const }
    : getAiTagInfo(event);

  return {
    ...event,
    cameraCode: getCameraCode(event.camera?.name ?? ''),
    aiTag,
    aiTagColor,
    relativeTimeText: formatRelativeTime(event.detectedAt),
  };
}

/**
 * Tải danh sách sự kiện mới nhất từ Orchestrator (US-06).
 * Lỗi được ném ra để dashboard hiển thị trạng thái lỗi kèm nút thử lại,
 * thay vì âm thầm thay bằng dữ liệu giả khiến không ai biết backend đang hỏng.
 */
export async function fetchEvents(
  pageSize: number = DEFAULT_EVENTS_PAGE_SIZE,
  includePendingPriority = false,
): Promise<{
  events: UIEventItem[];
  total: number;
}> {
  const response = await apiFetch<ListEventsResponse>(`/events?pageSize=${pageSize}`);
  const data = Array.isArray(response.data) ? response.data : [];

  const recent = data.map(toUIEventItem);
  const pending = includePendingPriority
    ? await fetchPriorityNotifications(['P0', 'P1', 'P2'])
    : [];
  const merged = Array.from(
    new Map([...recent, ...pending].map((event) => [event.id, event])).values(),
  );
  return {
    events: merged,
    total: response.meta?.total ?? data.length,
  };
}

/** Tải một trang lịch sử đã lọc trên Orchestrator. */
export async function fetchNotificationPage(query: string, signal: AbortSignal) {
  const response = await apiFetch<ListEventsResponse>(`/events?${query}`, {
    cache: 'no-store',
    signal,
  });
  return {
    events: response.data.map(toUIEventItem),
    total: response.meta?.total ?? response.data.length,
  };
}

/**
 * Chi tiết một sự kiện kèm media (ảnh snapshot đầy đủ), kết quả AI và lịch sử trạng thái.
 */
export function fetchEventDetail(eventId: string): Promise<EventDetail> {
  return apiFetch<EventDetail>(`/events/${eventId}`, { cache: 'no-store' });
}

/** Query current P0 alerts independently of the recent-event feed. */
export function fetchPendingCriticalEvents(): Promise<UIEventItem[]> {
  return fetchPriorityNotifications(['P0']);
}

async function fetchPriorityNotifications(
  priorities: ['P0'] | ['P0', 'P1', 'P2'],
): Promise<UIEventItem[]> {
  const query = new URLSearchParams({ notificationState: 'pending', pageSize: '100' });
  for (const priority of priorities) query.append('priority', priority);
  for (const status of ['DETECTED', 'NOTIFIED', 'ESCALATED']) query.append('status', status);
  const events: UIEventItem[] = [];
  let page = 1;
  for (;;) {
    query.set('page', String(page));
    const result = await apiFetch<ListEventsResponse>(`/events?${query}`, { cache: 'no-store' });
    events.push(...result.data.map(toUIEventItem));
    const pages = Math.ceil(
      (result.meta?.total ?? result.data.length) / (result.meta?.pageSize ?? 100),
    );
    if (!result.data.length || page >= pages) return events;
    page += 1;
  }
}

/**
 * Xác nhận ban đầu ("Tôi ổn" / "Cần giúp đỡ") - FR-ESC-03/04 (US-13).
 */
export function confirmEvent(
  eventId: string,
  response: 'IM_OK' | 'NEED_HELP',
  note?: string,
): Promise<Confirmation> {
  return apiFetch<Confirmation>(`/events/${eventId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ response, note }),
  });
}

/**
 * Đóng sự kiện khẩn cấp sau khi đã tiếp nhận xử lý - FR-ESC-04/09 (US-13 Phase EMERGENCY).
 */
export function closeEvent(eventId: string, note?: string): Promise<Confirmation> {
  return apiFetch<Confirmation>(`/events/${eventId}/close`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

/**
 * Số liệu tổng hợp cho các thẻ trên đầu dashboard (FR-DSH-01).
 */
export function fetchEventStats(windowHours?: number): Promise<EventStats> {
  const query = windowHours ? `?windowHours=${windowHours}` : '';
  return apiFetch<EventStats>(`/events/stats${query}`);
}

export interface EventsStreamHandlers {
  onCreated: (event: UIEventItem) => void;
  onUpdated: (event: UIEventItem) => void;
}

const SSE_RECONNECT_BASE_MS = 2000;
const SSE_RECONNECT_MAX_MS = 15000;

/**
 * Lắng nghe luồng SSE realtime từ backend (US-06, FR-DSH-02).
 * Tự kết nối lại khi token được làm mới hoặc kết nối SSE bị gián đoạn.
 */
export function subscribeEventsStream(handlers: EventsStreamHandlers): () => void {
  if (typeof window === 'undefined' || !window.EventSource) {
    return () => {};
  }

  let closed = false;
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;

  function forward(handle: (event: UIEventItem) => void) {
    return (message: MessageEvent) => {
      try {
        const summary = JSON.parse(message.data as string) as EventSummary;
        handle(toUIEventItem(summary));
      } catch {
        // bỏ qua message SSE không parse được
      }
    };
  }

  function closeCurrent(): void {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  function clearReconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    const delay = Math.min(SSE_RECONNECT_BASE_MS * 2 ** reconnectAttempts, SSE_RECONNECT_MAX_MS);
    reconnectAttempts = Math.min(reconnectAttempts + 1, 4);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void refreshSessionToken().then((freshToken) => {
        if (!closed && freshToken) connect(freshToken);
      });
    }, delay);
  }

  function connect(token: string): void {
    if (closed) return;
    closeCurrent();
    clearReconnect();
    const url = `${API_BASE_URL}/events/stream?token=${encodeURIComponent(token)}`;
    const next = new EventSource(url);
    next.addEventListener('event.created', forward(handlers.onCreated));
    next.addEventListener('event.updated', forward(handlers.onUpdated));
    next.addEventListener('open', () => {
      reconnectAttempts = 0;
    });
    next.addEventListener('error', () => {
      if (closed || eventSource !== next) return;
      closeCurrent();
      scheduleReconnect();
    });
    eventSource = next;
  }

  const initialToken = getAccessToken();
  if (initialToken) {
    connect(initialToken);
  }

  const unsubscribeToken = subscribeAccessTokenChange((nextToken) => {
    if (closed) return;
    if (!nextToken) {
      closeCurrent();
      clearReconnect();
      return;
    }
    reconnectAttempts = 0;
    connect(nextToken);
  });

  return () => {
    closed = true;
    unsubscribeToken();
    clearReconnect();
    closeCurrent();
  };
}

export async function triggerSosHelp(note?: string): Promise<UIEventItem> {
  const summary = await apiFetch<EventSummary>('/events/sos', {
    method: 'POST',
    body: JSON.stringify(note ? { note } : {}),
  });
  return toUIEventItem(summary);
}
