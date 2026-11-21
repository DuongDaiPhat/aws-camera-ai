import { describe, it, expect } from 'vitest';
import { INITIAL_MOCK_EVENTS, getMockEventDetail, generateSimulatedLiveEvent } from './mock-events';

describe('mock-events', () => {
  it('cung cấp ít nhất 6 sự kiện mẫu theo giao diện Image 2', () => {
    expect(INITIAL_MOCK_EVENTS.length).toBeGreaterThanOrEqual(6);
  });

  it('chứa các loại sự kiện quan trọng P0, P1, P2, P3', () => {
    const priorities = new Set(INITIAL_MOCK_EVENTS.map((e) => e.priority));
    expect(priorities.has('P0')).toBe(true);
    expect(priorities.has('P1')).toBe(true);
    expect(priorities.has('P2')).toBe(true);
    expect(priorities.has('P3')).toBe(true);
  });

  it('tạo sự kiện mô phỏng thời gian thực đúng định dạng', () => {
    const simulated = generateSimulatedLiveEvent();
    expect(simulated).toHaveProperty('id');
    expect(simulated).toHaveProperty('eventType');
    expect(simulated).toHaveProperty('cameraCode');
    expect(simulated).toHaveProperty('aiTag');
    expect(simulated.status).toBe('NOTIFIED');
    expect(simulated.relativeTimeText).toBe('Vừa xong');
  });

  it('sinh EventDetail chi tiết có lịch sử trạng thái và kết quả AI', () => {
    const event = INITIAL_MOCK_EVENTS[0]!;
    const detail = getMockEventDetail(event);

    expect(detail.id).toBe(event.id);
    expect(detail.aiResults?.length).toBeGreaterThan(0);
    expect(detail.statusHistory?.length).toBeGreaterThanOrEqual(2);
    expect(detail.statusHistory?.[0]?.toStatus).toBe('DETECTED');
    expect(detail.statusHistory?.[0]?.actorType).toBe('SYSTEM');
  });

  it.each(['NOTIFIED', 'ESCALATED', 'RESOLVED', 'CLOSED'] as const)(
    'preserves status-specific timestamps in mock detail %s',
    (status) => {
      const event = {
        ...INITIAL_MOCK_EVENTS[0]!,
        eventType: 'WELLNESS_TIMEOUT' as const,
        status,
        confidence: undefined,
        zone: null,
      };
      const detail = getMockEventDetail(event);
      expect(detail.source).toBe('SCHEDULER');
      expect(detail.notifiedAt).toBe(status === 'NOTIFIED' ? event.detectedAt : null);
      expect(detail.escalationDeadlineAt).toBe(
        status === 'NOTIFIED'
          ? new Date(Date.parse(event.detectedAt) + 120000).toISOString()
          : null,
      );
      expect(detail.escalatedAt).toBe(status === 'ESCALATED' ? event.detectedAt : null);
      expect(detail.resolvedAt).toBe(status === 'RESOLVED' ? event.detectedAt : null);
      expect(detail.closedAt).toBe(status === 'CLOSED' ? event.detectedAt : null);
      expect(detail.aiResults?.[0].confidence).toBe(0.85);
      expect(detail.aiResults?.[1].label).toBe('Khu vực chính');
      expect(detail.statusHistory?.[1].actorType).toBe(status === 'RESOLVED' ? 'USER' : 'SYSTEM');
    },
  );

  it('uses the fire model result for fire mock details', () => {
    const event = { ...INITIAL_MOCK_EVENTS[0]!, eventType: 'FIRE_SMOKE_DETECTED' as const };
    expect(getMockEventDetail(event).aiResults?.[0].module).toBe('M3_FIRE');
    expect(getMockEventDetail(event).source).toBe('FRIGATE');
  });
});
