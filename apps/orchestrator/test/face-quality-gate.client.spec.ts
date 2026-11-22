import { ConfigService } from '@nestjs/config';
import { FaceQualityGateClient } from '../src/face-recognition/face-quality-gate.client';

describe('FaceQualityGateClient (Layer 2 Client)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls POST /face/assess with X-Internal-Token and returns parsed gate payload', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        passed: true,
        qualityScore: 0.91,
        faceCount: 1,
        rejectionReason: null,
        metrics: {
          faceWidthPx: 120,
          faceHeightPx: 140,
          detectionScore: 0.96,
          sharpness: 110.5,
          poseYawRatio: 0.12,
          posePitchRatio: 0.08,
        },
        boundingBox: { x: 0.2, y: 0.1, width: 0.3, height: 0.4 },
        embeddingBase64: 'AAAA',
        embeddingDim: 1,
        modelVersion: 'yunet-2023mar-sface-2021dec',
        gateStatus: 'READY',
      }),
    } as Response);

    const client = new FaceQualityGateClient(
      new ConfigService({
        AI_SERVICE_URL: 'http://ai-service:8000/',
        AI_INTERNAL_TOKEN: 'secret-token',
      }),
    );

    const result = await client.assess(Buffer.from('jpeg-bytes'));
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://ai-service:8000/face/assess',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-Internal-Token': 'secret-token' },
      }),
    );
    expect(result).toMatchObject({
      passed: true,
      qualityScore: 0.91,
      faceCount: 1,
      gateStatus: 'READY',
      embeddingBase64: 'AAAA',
      failOpenApplied: false,
    });
  });

  it('handles UNAVAILABLE and network/timeout errors using FACE_QUALITY_GATE_FAIL_OPEN=true vs false', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        passed: false,
        qualityScore: 0,
        faceCount: 0,
        rejectionReason: 'MODEL_UNAVAILABLE',
        metrics: null,
        boundingBox: null,
        embeddingBase64: null,
        embeddingDim: null,
        modelVersion: 'unavailable',
        gateStatus: 'UNAVAILABLE',
      }),
    } as Response);

    const failOpenClient = new FaceQualityGateClient(
      new ConfigService({ FACE_QUALITY_GATE_FAIL_OPEN: 'true' }),
    );
    expect(await failOpenClient.assess(Buffer.from('jpg'))).toMatchObject({
      passed: true,
      qualityScore: 0,
      gateStatus: 'UNAVAILABLE',
      failOpenApplied: true,
    });

    const failClosedClient = new FaceQualityGateClient(
      new ConfigService({ FACE_QUALITY_GATE_FAIL_OPEN: 'false' }),
    );
    expect(await failClosedClient.assess(Buffer.from('jpg'))).toMatchObject({
      passed: false,
      gateStatus: 'UNAVAILABLE',
      rejectionReason: 'MODEL_UNAVAILABLE',
      failOpenApplied: false,
    });

    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    expect(await failOpenClient.assess(Buffer.from('jpg'))).toMatchObject({
      passed: true,
      rejectionReason: 'QUALITY_GATE_TIMEOUT',
      failOpenApplied: true,
    });
    expect(await failClosedClient.assess(Buffer.from('jpg'))).toMatchObject({
      passed: false,
      rejectionReason: 'QUALITY_GATE_TIMEOUT',
      failOpenApplied: false,
    });
  });

  it('short-circuits without HTTP when FACE_QUALITY_GATE_ENABLED=false', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const client = new FaceQualityGateClient(
      new ConfigService({ FACE_QUALITY_GATE_ENABLED: 'false' }),
    );
    const result = await client.assess(Buffer.from('jpg'));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      passed: true,
      qualityScore: 1,
      gateStatus: 'DISABLED',
      failOpenApplied: false,
    });
  });
});
