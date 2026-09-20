import type { components } from '@cam/contracts';

export type EventSummary = components['schemas']['EventSummary'];
export type EventDetail = components['schemas']['EventDetail'];
export type EventType = components['schemas']['EventType'];
export type EventStatus = components['schemas']['EventStatus'];
export type PriorityLevel = components['schemas']['PriorityLevel'];

export interface UIEventItem extends EventSummary {
  cameraCode: string; // e.g. "CAM 01", "CAM 02"
  aiTag: string; // e.g. "98% khói", "Pose AI 91%", "Nhận diện", "An toàn", "Chuyển động"
  aiTagColor?: 'danger' | 'warning' | 'info' | 'success' | 'neutral';
  note?: string; // Ghi chú bổ sung (vd: "Bà nội vào chuẩn bị bữa trà chiều")
  relativeTimeText: string;
}

export const INITIAL_MOCK_EVENTS: UIEventItem[] = [
  {
    id: '0192f8a1-7c01-7000-8000-000000000001',
    eventType: 'FIRE_SMOKE_DETECTED',
    status: 'NOTIFIED',
    priority: 'P0',
    confidence: 0.98,
    isFalseAlarm: false,
    detectedAt: new Date(Date.now() - 45 * 1000).toISOString(),
    camera: {
      id: '11111111-1111-1111-1111-111111111102',
      name: 'Camera bếp',
    },
    zone: {
      id: '22222222-2222-2222-2222-222222222202',
      name: 'Khu vực bếp nấu',
    },
    cameraCode: 'CAM 02',
    aiTag: '98% khói',
    aiTagColor: 'danger',
    relativeTimeText: 'Vừa xong',
  },
  {
    id: '0192f8a1-7c01-7000-8000-000000000002',
    eventType: 'FALL_DETECTED',
    status: 'NOTIFIED',
    priority: 'P1',
    confidence: 0.91,
    isFalseAlarm: false,
    detectedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    camera: {
      id: '11111111-1111-1111-1111-111111111101',
      name: 'Camera phòng khách',
    },
    zone: {
      id: '22222222-2222-2222-2222-222222222201',
      name: 'Khu vực ghế sofa',
    },
    cameraCode: 'CAM 01',
    aiTag: 'Pose AI 91%',
    aiTagColor: 'warning',
    relativeTimeText: '2 phút trước',
  },
  {
    id: '0192f8a1-7c01-7000-8000-000000000003',
    eventType: 'UNKNOWN_PERSON',
    status: 'NOTIFIED',
    priority: 'P2',
    confidence: 0.85,
    personStatus: 'UNKNOWN',
    isFalseAlarm: false,
    detectedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    camera: {
      id: '11111111-1111-1111-1111-111111111103',
      name: 'Camera cửa chính',
    },
    zone: {
      id: '22222222-2222-2222-2222-222222222203',
      name: 'Lối vào sảnh',
    },
    cameraCode: 'CAM 03',
    aiTag: 'Nhận diện',
    aiTagColor: 'info',
    relativeTimeText: '5 phút trước',
  },
  {
    id: '0192f8a1-7c01-7000-8000-000000000004',
    eventType: 'RESTRICTED_ZONE',
    status: 'RESOLVED',
    priority: 'P1',
    confidence: 0.88,
    isFalseAlarm: false,
    detectedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    camera: {
      id: '11111111-1111-1111-1111-111111111102',
      name: 'Camera bếp',
    },
    zone: {
      id: '22222222-2222-2222-2222-222222222202',
      name: 'Khu vực bếp nấu',
    },
    note: 'Bà nội vào chuẩn bị bữa trà chiều',
    cameraCode: 'CAM 02',
    aiTag: 'An toàn',
    aiTagColor: 'success',
    relativeTimeText: '12 phút trước',
  },
  {
    id: '0192f8a1-7c01-7000-8000-000000000005',
    eventType: 'PERSON_DETECTED',
    status: 'LOGGED_ONLY',
    priority: 'P3',
    confidence: 0.79,
    personStatus: 'KNOWN',
    matchedPersonName: 'Đức Anh',
    isFalseAlarm: false,
    detectedAt: new Date(Date.now() - 24 * 60 * 1000).toISOString(),
    camera: {
      id: '11111111-1111-1111-1111-111111111104',
      name: 'Camera hành lang',
    },
    zone: {
      id: '22222222-2222-2222-2222-222222222204',
      name: 'Tầng 1',
    },
    cameraCode: 'CAM 04',
    aiTag: 'Chuyển động',
    aiTagColor: 'neutral',
    relativeTimeText: '24 phút trước',
  },
  {
    id: '0192f8a1-7c01-7000-8000-000000000006',
    eventType: 'WELLNESS_TIMEOUT',
    status: 'NOTIFIED',
    priority: 'P2',
    confidence: null,
    isFalseAlarm: false,
    detectedAt: new Date(Date.now() - 48 * 60 * 1000).toISOString(),
    camera: {
      id: '11111111-1111-1111-1111-111111111105',
      name: 'Cảm biến phòng ngủ',
    },
    zone: {
      id: '22222222-2222-2222-2222-222222222205',
      name: 'Chưa thấy mở cửa hơn 2 giờ',
    },
    cameraCode: 'SENSOR',
    aiTag: 'Cần kiểm tra',
    aiTagColor: 'warning',
    relativeTimeText: '48 phút trước',
  },
];

function getEventAiResults(summary: UIEventItem) {
  const isFire = summary.eventType === 'FIRE_SMOKE_DETECTED';
  return [
    {
      module: isFire ? ('M3_FIRE' as const) : ('M1_FACE' as const),
      label: summary.eventType,
      confidence: summary.confidence ?? 0.85,
      modelVersion: 'v1.0.0',
    },
    {
      module: 'M4_ZONE' as const,
      label: summary.zone?.name ?? 'Khu vực chính',
      confidence: 1.0,
    },
  ];
}

function getEventStatusHistory(summary: UIEventItem) {
  const isResolved = summary.status === 'RESOLVED';
  return [
    {
      toStatus: 'DETECTED' as const,
      createdAt: summary.detectedAt,
      reason: 'Phát hiện sự kiện từ luồng camera',
      actorType: 'SYSTEM' as const,
    },
    {
      fromStatus: 'DETECTED' as const,
      toStatus: summary.status,
      createdAt: summary.detectedAt,
      reason: isResolved ? 'Người dùng đã xác nhận an toàn' : 'Đã gửi cảnh báo tới Telegram',
      actorType: isResolved ? ('USER' as const) : ('SYSTEM' as const),
    },
  ];
}

export function getMockEventDetail(summary: UIEventItem): EventDetail {
  const isNotified = summary.status === 'NOTIFIED';
  const detectedTime = new Date(summary.detectedAt).getTime();

  return {
    ...summary,
    source: summary.eventType === 'WELLNESS_TIMEOUT' ? 'SCHEDULER' : 'FRIGATE',
    trackId: `track_${summary.id.slice(0, 8)}`,
    aiLabel: summary.eventType,
    aiModelVersion: 'yolo-v8s-camai-2026.1',
    retain: false,
    correlationId: `corr_${summary.id}`,
    notifiedAt: isNotified ? summary.detectedAt : null,
    escalationDeadlineAt: isNotified ? new Date(detectedTime + 120 * 1000).toISOString() : null,
    escalatedAt: summary.status === 'ESCALATED' ? summary.detectedAt : null,
    resolvedAt: summary.status === 'RESOLVED' ? summary.detectedAt : null,
    closedAt: summary.status === 'CLOSED' ? summary.detectedAt : null,
    aiResults: getEventAiResults(summary),
    statusHistory: getEventStatusHistory(summary),
  };
}

interface SimulatedTemplate {
  type: EventType;
  priority: PriorityLevel;
  title: string;
  cam: string;
  camCode: string;
  zone: string;
  tag: string;
  tagColor: UIEventItem['aiTagColor'];
}

const SIMULATED_TEMPLATES: SimulatedTemplate[] = [
  {
    type: 'UNKNOWN_PERSON',
    priority: 'P2',
    title: 'Phát hiện người chưa xác định',
    cam: 'Camera sân trước',
    camCode: 'CAM 01',
    zone: 'Cổng chính',
    tag: 'Nhận diện 84%',
    tagColor: 'info',
  },
  {
    type: 'RESTRICTED_ZONE',
    priority: 'P1',
    title: 'Phát hiện đối tượng vào khu vực giới hạn',
    cam: 'Camera ban công',
    camCode: 'CAM 03',
    zone: 'Khu vực lan can',
    tag: 'Khu vực cấm',
    tagColor: 'warning',
  },
  {
    type: 'FALL_DETECTED',
    priority: 'P1',
    title: 'Cảnh báo nguy cơ té ngã',
    cam: 'Camera phòng tắm',
    camCode: 'CAM 05',
    zone: 'Khu vực cửa ướt',
    tag: 'Pose AI 94%',
    tagColor: 'warning',
  },
  {
    type: 'FIRE_SMOKE_DETECTED',
    priority: 'P0',
    title: 'Phát hiện dấu hiệu khói bất thường',
    cam: 'Camera phòng khách',
    camCode: 'CAM 01',
    zone: 'Khu vực bàn ăn',
    tag: '92% khói',
    tagColor: 'danger',
  },
];

export function generateSimulatedLiveEvent(): UIEventItem {
  const choice = SIMULATED_TEMPLATES[Math.floor(Math.random() * SIMULATED_TEMPLATES.length)]!;
  const randomSuffix = Math.random().toString(16).slice(2, 6);
  const randomId = `0192f8a1-${randomSuffix}-7000-8000-${Date.now().toString(16).slice(-12)}`;

  return {
    id: randomId,
    eventType: choice.type,
    status: 'NOTIFIED',
    priority: choice.priority,
    confidence: 0.88,
    isFalseAlarm: false,
    detectedAt: new Date().toISOString(),
    camera: { id: `cam-${choice.camCode.toLowerCase()}`, name: choice.cam },
    zone: { id: `zone-${choice.zone.toLowerCase()}`, name: choice.zone },
    cameraCode: choice.camCode,
    aiTag: choice.tag,
    aiTagColor: choice.tagColor,
    relativeTimeText: 'Vừa xong',
  };
}
