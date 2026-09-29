import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraLiveStream } from '../CameraLiveStream';

describe('CameraLiveStream', () => {
  it('nhung WebRTC player voi URL doc co token ngan han', () => {
    const html = renderToStaticMarkup(
      <CameraLiveStream
        streamUrl="http://localhost:8889/cam_test/?token=viewer-token"
        title="Camera thu nghiem"
      />,
    );

    expect(html).toContain('<iframe');
    expect(html).toContain('cam_test/?token=viewer-token');
    expect(html).toContain('allow="autoplay; fullscreen; picture-in-picture"');
  });
});
