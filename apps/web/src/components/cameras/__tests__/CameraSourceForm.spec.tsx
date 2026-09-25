import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraSourceForm } from '../CameraSourceForm';

describe('CameraSourceForm component (Slice CAM)', () => {
  it('hien thi day du 3 tab nguon va form RTSP mac dinh', () => {
    const html = renderToStaticMarkup(
      <CameraSourceForm
        cameraId="c1"
        slug="cam_cong_chinh"
        initialSourceType="RTSP"
        initialRtspUrl="rtsp://admin:***@192.168.1.100:554/stream1"
        isAdmin={true}
        onSourceUpdated={vi.fn()}
      />,
    );

    expect(html).toContain('Nguồn RTSP Trực tiếp');
    expect(html).toContain('Webcam Trình duyệt (WHIP)');
    expect(html).toContain('Phát lặp từ File Video');
    expect(html).toContain('RTSP Stream URL');
    expect(html).toContain('TCP (Độ tin cậy cao, khuyên dùng)');
    expect(html).toContain('Lưu cấu hình RTSP');
  });

  it('an nut luu khi khong phai ADMIN', () => {
    const html = renderToStaticMarkup(
      <CameraSourceForm
        cameraId="c1"
        slug="cam_cong_chinh"
        initialSourceType="RTSP"
        isAdmin={false}
        onSourceUpdated={vi.fn()}
      />,
    );

    expect(html).not.toContain('Lưu cấu hình RTSP');
  });

  it('hien thi WebcamPublisher khi initialSourceType la BROWSER_WEBCAM', () => {
    const html = renderToStaticMarkup(
      <CameraSourceForm
        cameraId="c1"
        slug="cam_cong_chinh"
        initialSourceType="BROWSER_WEBCAM"
        isAdmin={true}
        onSourceUpdated={vi.fn()}
      />,
    );

    expect(html).toContain('Chọn thiết bị Webcam');
    expect(html).toContain('Bật xem trước Webcam');
  });

  it('hien thi VideoSourceUploader khi initialSourceType la VIDEO_FILE', () => {
    const html = renderToStaticMarkup(
      <CameraSourceForm
        cameraId="c1"
        slug="cam_cong_chinh"
        initialSourceType="VIDEO_FILE"
        isAdmin={true}
        onSourceUpdated={vi.fn()}
      />,
    );

    expect(html).toContain('Chọn file video mẫu');
    expect(html).toContain('Tự động phát lặp lại liên tục');
    expect(html).toContain('Lưu và kích hoạt nguồn Video');
  });
});
