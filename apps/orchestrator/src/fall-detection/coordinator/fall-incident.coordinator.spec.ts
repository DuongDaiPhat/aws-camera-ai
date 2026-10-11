import { ConfigService } from '@nestjs/config';
import type { AiResultsService } from '../../ai-results/ai-results.service';
import type { PoseInferenceAdapter, FallResponse } from '../adapter/pose-inference.adapter';
import { FallIncidentCoordinator, ProcessFrameContext } from './fall-incident.coordinator';
import type { RestAreaEvaluator } from '../evaluator/rest-area.evaluator';
import type { FallIncidentRepository } from '../repository/fall-incident.repository';

describe('FallIncidentCoordinator', () => {
  let coordinator: FallIncidentCoordinator;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockRestAreaEvaluator: jest.Mocked<RestAreaEvaluator>;
  let mockPoseInferenceAdapter: jest.Mocked<PoseInferenceAdapter>;
  let mockFallIncidentRepository: jest.Mocked<FallIncidentRepository>;
  let mockAiResultsService: jest.Mocked<AiResultsService>;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultVal: unknown) => {
        if (key === 'FALL_IMMOBILITY_SECONDS') return 15;
        return defaultVal;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    mockRestAreaEvaluator = {
      isPersonInRestArea: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<RestAreaEvaluator>;

    mockPoseInferenceAdapter = {
      evaluateFall: jest.fn(),
    } as unknown as jest.Mocked<PoseInferenceAdapter>;

    mockFallIncidentRepository = {
      createConfirmedIncident: jest.fn(),
      markApplied: jest.fn(),
    } as unknown as jest.Mocked<FallIncidentRepository>;

    mockAiResultsService = {
      submit: jest.fn().mockResolvedValue({} as never),
    } as unknown as jest.Mocked<AiResultsService>;

    coordinator = new FallIncidentCoordinator(
      mockConfigService,
      mockRestAreaEvaluator,
      mockPoseInferenceAdapter,
      mockFallIncidentRepository,
      mockAiResultsService,
    );
  });

  const createContext = (): ProcessFrameContext => ({
    cameraId: 'cam-uuid-1',
    cameraSlug: 'cam-livingroom',
    sourceSessionId: 'sess-abc',
    frameId: 'frame-100',
    frameTimestamp: new Date('2026-10-11T10:00:00.000Z'),
    imageBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    persons: [
      {
        trackId: 'track-1',
        boundingBox: { x: 0.2, y: 0.3, width: 0.4, height: 0.5 },
        observedAt: 1791710000,
      },
    ],
  });

  it('creates incident and submits P1 alert when fall candidate is confirmed (AC17-1)', async () => {
    // Arrange
    const context = createContext();
    const confirmedFallResponse: FallResponse = {
      trackId: 'track-1',
      state: 'CONFIRMED',
      reason: 'IMMOBILITY_THRESHOLD_EXCEEDED',
      episodeId: 'episode-uuid-999',
      candidateStartedAt: '2026-10-11T09:59:44.000Z',
      confirmedAt: '2026-10-11T10:00:00.000Z',
      immobileSeconds: 16.0,
      thresholdSeconds: 15.0,
      torsoAngleDeg: 82.5,
      aspectRatio: 1.8,
      centerHeight: 0.25,
      centerDropRatio: 0.65,
      motionScore: 0.008,
      confidence: 0.98,
      confidencePolicyVersion: 'fall-rule-evidence-v1',
      modelVersion: 'mediapipe-pose-v1',
      processedAt: '2026-10-11T10:00:00.100Z',
      error: null,
    };

    mockPoseInferenceAdapter.evaluateFall.mockResolvedValue(confirmedFallResponse);
    mockFallIncidentRepository.createConfirmedIncident.mockResolvedValue({
      eventId: 'evt-111',
      fallIncidentId: 'inc-222',
      resultId: 'res-333',
      isNew: true,
    });

    // Act
    await coordinator.processFrame(context);

    // Assert
    expect(mockRestAreaEvaluator.isPersonInRestArea).toHaveBeenCalledWith(
      'cam-uuid-1',
      context.persons[0].boundingBox,
    );
    expect(mockFallIncidentRepository.createConfirmedIncident).toHaveBeenCalledTimes(1);
    expect(mockAiResultsService.submit).toHaveBeenCalledWith(
      'evt-111',
      expect.objectContaining({
        module: 'M2A_FALL',
        results: [
          expect.objectContaining({
            module: 'M2A_FALL',
            label: 'FALL_DETECTED',
            confidence: 0.98,
          }),
        ],
      }),
    );
    expect(mockFallIncidentRepository.markApplied).toHaveBeenCalledWith('inc-222');
  });

  it('cancels candidate and does NOT trigger alert when person recovers (AC17-2)', async () => {
    // Arrange
    const context = createContext();
    const cancelledResponse: FallResponse = {
      trackId: 'track-1',
      state: 'CANCELLED',
      reason: 'RECOVERED',
      episodeId: 'episode-uuid-999',
      candidateStartedAt: '2026-10-11T09:59:50.000Z',
      confirmedAt: null,
      immobileSeconds: 4.5,
      thresholdSeconds: 15.0,
      torsoAngleDeg: 25.0,
      aspectRatio: 0.6,
      centerHeight: 0.7,
      centerDropRatio: 0.1,
      motionScore: 0.12,
      confidence: null,
      modelVersion: 'mediapipe-pose-v1',
      processedAt: '2026-10-11T09:59:55.000Z',
      error: null,
    };

    mockPoseInferenceAdapter.evaluateFall.mockResolvedValue(cancelledResponse);

    // Act
    await coordinator.processFrame(context);

    // Assert
    expect(mockFallIncidentRepository.createConfirmedIncident).not.toHaveBeenCalled();
    expect(mockAiResultsService.submit).not.toHaveBeenCalled();
    expect(mockFallIncidentRepository.markApplied).not.toHaveBeenCalled();
  });

  it('does NOT create fall incident or alert when person is inside REST_AREA (AC17-3)', async () => {
    // Arrange
    const context = createContext();
    mockRestAreaEvaluator.isPersonInRestArea.mockResolvedValue(true);

    const confirmedFallResponse: FallResponse = {
      trackId: 'track-1',
      state: 'CONFIRMED',
      reason: 'IMMOBILITY_THRESHOLD_EXCEEDED',
      episodeId: 'episode-uuid-999',
      candidateStartedAt: '2026-10-11T09:59:44.000Z',
      confirmedAt: '2026-10-11T10:00:00.000Z',
      immobileSeconds: 16.0,
      thresholdSeconds: 15.0,
      torsoAngleDeg: 85.0,
      aspectRatio: 1.9,
      centerHeight: 0.2,
      centerDropRatio: 0.7,
      motionScore: 0.005,
      confidence: 0.99,
      confidencePolicyVersion: 'fall-rule-evidence-v1',
      modelVersion: 'mediapipe-pose-v1',
      processedAt: '2026-10-11T10:00:00.100Z',
      error: null,
    };

    mockPoseInferenceAdapter.evaluateFall.mockResolvedValue(confirmedFallResponse);

    // Act
    await coordinator.processFrame(context);

    // Assert
    expect(mockFallIncidentRepository.createConfirmedIncident).not.toHaveBeenCalled();
    expect(mockAiResultsService.submit).not.toHaveBeenCalled();
  });

  it('deduplicates and skips AI result submission when incident is already recorded', async () => {
    // Arrange
    const context = createContext();
    const confirmedFallResponse: FallResponse = {
      trackId: 'track-1',
      state: 'CONFIRMED',
      reason: 'IMMOBILITY_THRESHOLD_EXCEEDED',
      episodeId: 'episode-uuid-999',
      candidateStartedAt: '2026-10-11T09:59:44.000Z',
      confirmedAt: '2026-10-11T10:00:00.000Z',
      immobileSeconds: 16.0,
      thresholdSeconds: 15.0,
      torsoAngleDeg: 80.0,
      aspectRatio: 1.7,
      centerHeight: 0.25,
      centerDropRatio: 0.6,
      motionScore: 0.008,
      confidence: 0.95,
      confidencePolicyVersion: 'fall-rule-evidence-v1',
      modelVersion: 'mediapipe-pose-v1',
      processedAt: '2026-10-11T10:00:00.100Z',
      error: null,
    };

    mockPoseInferenceAdapter.evaluateFall.mockResolvedValue(confirmedFallResponse);
    mockFallIncidentRepository.createConfirmedIncident.mockResolvedValue({
      eventId: 'evt-111',
      fallIncidentId: 'inc-222',
      resultId: 'res-333',
      isNew: false, // Already processed
    });

    // Act
    await coordinator.processFrame(context);

    // Assert
    expect(mockFallIncidentRepository.createConfirmedIncident).toHaveBeenCalledTimes(1);
    expect(mockAiResultsService.submit).not.toHaveBeenCalled();
  });
});
