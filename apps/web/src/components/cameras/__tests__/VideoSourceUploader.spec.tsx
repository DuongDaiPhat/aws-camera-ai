import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatVideoDuration,
  validateVideoFile,
  VideoSourceUploader,
} from '../VideoSourceUploader';

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
    expect(html).toContain('Tiến độ tải lên');
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

  it('tu choi dinh dang video khong duoc backend ho tro', () => {
    const file = new File(['not-video'], 'sample.avi', { type: 'video/x-msvideo' });
    expect(validateVideoFile(file)).toContain('MP4 hoặc MKV');
  });

  it('tu choi video vuot qua 500MB', () => {
    const file = { name: 'large.mp4', size: 500 * 1024 * 1024 + 1, type: 'video/mp4' } as File;
    expect(validateVideoFile(file)).toContain('500MB');
  });

  it('dinh dang duration theo phut va giay', () => {
    expect(formatVideoDuration(125)).toBe('02:05');
  });
});
