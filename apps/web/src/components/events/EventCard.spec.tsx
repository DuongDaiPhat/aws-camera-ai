import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UIEventItem } from '@/types';
import { EventCard } from './EventCard';

const baseEvent: UIEventItem = {
  id: '0192f8a1-7c01-7000-8000-000000000011',
  eventType: 'RESTRICTED_ZONE',
  status: 'NOTIFIED',
  priority: 'P1',
  confidence: 0.92,
  isFalseAlarm: false,
  detectedAt: '2026-09-29T16:41:36.000Z',
  camera: { id: '11111111-1111-1111-1111-111111111102', name: 'Bep' },
  zone: { id: '22222222-2222-2222-2222-222222222202', name: 'Khu vuc bep' },
  cameraCode: 'CAM 02',
  aiTag: 'Khu vực cấm 92%',
  relativeTimeText: 'Vừa xong',
};

function renderCard(event: UIEventItem): string {
  return renderToStaticMarkup(<EventCard event={event} onViewDetail={() => {}} />);
}

describe('EventCard', () => {
  it.each([
    ['DETECTED', 'Mới phát hiện'],
    ['LOGGED_ONLY', 'Chỉ ghi nhận'],
    ['NOTIFIED', 'Đang chờ xác nhận'],
    ['ESCALATED', 'Đang leo thang khẩn cấp'],
    ['RESOLVED', 'Đã xác nhận an toàn'],
    ['CLOSED', 'Đã đóng sự kiện khẩn cấp'],
    ['AI_FAILED', 'AI không phân tích được'],
  ] as const)('hiển thị trạng thái %s tách khỏi mức ưu tiên', (status, label) => {
    const html = renderCard({ ...baseEvent, status });

    expect(html).toContain('P1 Quan trọng');
    expect(html).toContain(label);
    expect(html).toContain('Phát hiện: Vừa xong');
    expect(html).toContain('Thời điểm phát hiện:');
  });

  it('ưu tiên xử lý sự kiện đã leo thang, không gợi ý sự kiện đã hoàn tất', () => {
    const html = renderCard({ ...baseEvent, status: 'ESCALATED' });

    expect(html).toContain('Xử lý khẩn cấp');
    expect(html).not.toContain('Đã xác nhận an toàn');
  });

  it.each(['RESOLVED', 'CLOSED'] as const)('cho xem lại sự kiện %s', (status) => {
    const html = renderCard({ ...baseEvent, status });

    expect(html).toContain('Xem lại');
    expect(html).not.toContain('Xử lý khẩn cấp');
  });
});
