import { ConfigService } from '@nestjs/config';
import { PoseInferenceAdapter, EvaluateFallRequest } from './pose-inference.adapter';

describe('PoseInferenceAdapter', () => {
  let adapter: PoseInferenceAdapter;
  let mockConfigService: jest.Mocked<ConfigService>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultVal: unknown) => {
        if (key === 'AI_SERVICE_URL') return 'http://ai-service:8000';
        if (key === 'AI_INTERNAL_TOKEN') return 'secret-token';
        if (key === 'POSE_REQUEST_TIMEOUT_MS') return 2000;
        return defaultVal;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    adapter = new PoseInferenceAdapter(mockConfigService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const createRequest = (): EvaluateFallRequest => ({
    imageBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    trackId: 'track-1',
    cameraSlug: 'cam-livingroom',
    frameTimestamp: '2026-10-11T10:00:00.000Z',
    frameId: 'frame-1',
    sourceSessionId: 'sess-1',
    personBoundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    inRestArea: false,
  });

  it('sends multipart request with token header and returns fall response', async () => {
    // Arrange
    const mockFallResponse = {
      trackId: 'track-1',
      state: 'MONITORING',
      cameraSlug: 'cam-livingroom',
      sourceSessionId: 'sess-1',
      frameId: 'frame-1',
      observedAt: '2026-10-11T10:00:00.000Z',
      poseAvailable: true,
      reason: 'UPRIGHT_POSE',
      episodeId: null,
      immobileSeconds: 0,
      thresholdSeconds: 3,
      modelVersion: 'mediapipe-pose-v1',
      processedAt: '2026-10-11T10:00:00.100Z',
      error: null,
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(mockFallResponse),
    } as unknown as Response);

    // Act
    const result = await adapter.evaluateFall(createRequest());

    // Assert
    expect(result).toEqual(mockFallResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://ai-service:8000/pose/fall',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Internal-Token': 'secret-token',
        }),
      }),
    );
  });

  it('returns null when AI Service returns HTTP error code', async () => {
    // Arrange
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('Internal Server Error'),
    } as unknown as Response);

    // Act
    const result = await adapter.evaluateFall(createRequest());

    // Assert
    expect(result).toBeNull();
  });

  it('returns null and logs warning on network or timeout error', async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new Error('Network connection refused'));

    // Act
    const result = await adapter.evaluateFall(createRequest());

    // Assert
    expect(result).toBeNull();
  });
});
