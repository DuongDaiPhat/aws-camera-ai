import {
  createBrowserPublishSession,
  updateCameraSource,
  updateCameraState,
} from '@/lib/cameras-client';

const ICE_GATHERING_TIMEOUT_MS = 10_000;

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', checkState);
      reject(new Error('Hết thời gian thiết lập kết nối webcam'));
    }, ICE_GATHERING_TIMEOUT_MS);
    const checkState = () => {
      if (pc.iceGatheringState !== 'complete') return;
      window.clearTimeout(timeout);
      pc.removeEventListener('icegatheringstatechange', checkState);
      resolve();
    };
    pc.addEventListener('icegatheringstatechange', checkState);
    checkState();
  });
}

export async function publishWebcam(
  cameraId: string,
  stream: MediaStream,
): Promise<RTCPeerConnection> {
  await updateCameraSource(cameraId, {
    sourceType: 'BROWSER_WEBCAM',
    videoLoop: true,
    transport: 'TCP',
  });
  const camera = await updateCameraState(cameraId, true);
  if (camera.frigateSync.status !== 'SYNCED') {
    throw new Error(camera.frigateSync.errorMessage ?? 'Không thể đồng bộ camera với Frigate');
  }

  const session = await createBrowserPublishSession(cameraId);
  const pc = new RTCPeerConnection();

  try {
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    // Ưu tiên codec H.264 để MediaMTX và Frigate xử lý trực tiếp không cần transcode
    if (typeof pc.getTransceivers === 'function') {
      const transceivers = pc.getTransceivers();
      for (const t of transceivers) {
        if (
          t.sender?.track?.kind === 'video' &&
          'setCodecPreferences' in t &&
          typeof RTCRtpSender.getCapabilities === 'function'
        ) {
          const capabilities = RTCRtpSender.getCapabilities('video');
          if (capabilities) {
            const h264Codecs = capabilities.codecs.filter(
              (c) => c.mimeType.toLowerCase() === 'video/h264',
            );
            const otherCodecs = capabilities.codecs.filter(
              (c) => c.mimeType.toLowerCase() !== 'video/h264',
            );
            if (h264Codecs.length > 0) {
              t.setCodecPreferences([...h264Codecs, ...otherCodecs]);
            }
          }
        }
      }
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    const response = await fetch(session.publishUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        Authorization: `Bearer ${session.token}`,
      },
      body: pc.localDescription?.sdp,
    });
    if (!response.ok) {
      throw new Error(`MediaMTX từ chối truyền phát webcam (${response.status})`);
    }

    const answerSdp = await response.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    return pc;
  } catch (error) {
    pc.close();
    throw error;
  }
}
