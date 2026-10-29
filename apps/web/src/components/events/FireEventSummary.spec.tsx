import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { toUIEventItem } from '@/lib/events-client';
import { FireEventSummary } from './FireEventSummary';

describe('essential fire event information', () => {
  it('keeps absolute detection time, location, state and confidence visible without media', () => {
    const event = toUIEventItem({
      id: 'fire',
      eventType: 'FIRE_SMOKE_DETECTED',
      status: 'ESCALATED',
      priority: 'P0',
      detectedAt: '2026-10-27T09:06:43Z',
      confidence: 0.73,
      camera: { id: 'kitchen', name: 'Bếp' },
      zone: { id: 'zone', name: 'Khu vực bếp' },
    });
    const html = renderToStaticMarkup(
      <FireEventSummary event={event} detail={null} statusLabel="Đang leo thang khẩn cấp" />,
    );
    expect(html).toContain('dateTime="2026-10-27T09:06:43Z"');
    expect(html).toContain('27/10/2026');
    for (const value of [
      'Thời điểm phát hiện',
      'Bếp',
      'Khu vực bếp',
      'Đang leo thang khẩn cấp',
      '73%',
    ])
      expect(html).toContain(value);
  });
});
