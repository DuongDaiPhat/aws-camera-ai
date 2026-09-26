import React from 'react';

interface CameraLiveStreamProps {
  streamUrl: string;
  title: string;
  className?: string;
}

export function CameraLiveStream({ streamUrl, title, className }: CameraLiveStreamProps) {
  return (
    <iframe
      src={streamUrl}
      title={`Luồng trực tiếp ${title}`}
      className={className}
      allow="autoplay; fullscreen; picture-in-picture"
      allowFullScreen
      referrerPolicy="no-referrer"
    />
  );
}
