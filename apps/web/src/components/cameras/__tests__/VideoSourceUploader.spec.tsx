import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VideoSourceUploader } from '../VideoSourceUploader';

describe('VideoSourceUploader component', () => {
  it('hien thi hop chon file, tuy chon phat lap va nut luu cho ADMIN', () => {
    const html = renderToStaticMarkup(
      <VideoSourceUploader
        cameraId="c1"
        initialLoop={true}
        initialFileName="test_traffic.mp4"
        isAdmin={true}
        onSourceUpdated={vi.fn()}
      />,
    );

    expect(html).toContain('Chọn file video mẫu');
    expect(html).toContain('test_traffic.mp4');
    expect(html).toContain('Tự động phát lặp lại liên tục (Infinite Loop)');
    expect(html).toContain('Lưu và kích hoạt nguồn Video');
  });

  it('an nut luu khi nguoi dung khong phai ADMIN', () => {
    const html = renderToStaticMarkup(
      <VideoSourceUploader
        cameraId="c1"
        initialLoop={true}
        isAdmin={false}
        onSourceUpdated={vi.fn()}
      />,
    );

    expect(html).toContain('Chọn file video mẫu');
    expect(html).not.toContain('Lưu và kích hoạt nguồn Video');
  });
});
