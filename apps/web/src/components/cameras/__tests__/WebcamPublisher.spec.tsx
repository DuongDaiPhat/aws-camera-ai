import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WebcamPublisher } from '../WebcamPublisher';

describe('WebcamPublisher component', () => {
  it('hien thi dung cac thanh phan preview webcam va nut bam', () => {
    const html = renderToStaticMarkup(
      <WebcamPublisher cameraId="c1" slug="cam_webcam" isAdmin={true} onSourceUpdated={vi.fn()} />,
    );

    expect(html).toContain('Chọn thiết bị Webcam máy tính');
    expect(html).toContain('Bật xem trước Webcam');
    expect(html).toContain(
      'Luồng phát webcam trực tiếp từ trình duyệt sử dụng giao thức WebRTC (WHIP)',
    );
  });
});
