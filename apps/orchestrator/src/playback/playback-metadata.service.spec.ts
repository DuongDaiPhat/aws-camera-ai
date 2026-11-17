import { ConfigService } from '@nestjs/config';
import { incidentMetadata, PlaybackMetadataService } from './playback-metadata.service';
import { PlaybackService } from './playback.service';
import { PlaybackFramesRepository } from './playback-frames.repository';
describe('Incident geometry in recordings', () => {
  const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
  const at = new Date('2026-11-17T10:00:00Z');
  it.each([
    ['FALL_DETECTED', 'fall'],
    ['FIRE_SMOKE_DETECTED', 'fire'],
  ])('uses the confirmed historical timestamp for %s', (type, label) => {
    const result = incidentMetadata([
      {
        id: 'event',
        event_type: type,
        detected_at: at,
        ai_results: [
          {
            status: 'SUCCESS',
            label: type,
            confidence: 0.95,
            boundingBox: box,
            metadata: { confirmedAt: at.toISOString() },
          },
        ],
      },
    ]);
    expect(result.frames).toEqual([
      { at: at.toISOString(), boxes: [{ ...box, label, confidence: 0.95 }] },
    ]);
  });
  it('keeps an event marker without inventing a missing box', () => {
    const result = incidentMetadata([
      { id: 'event', event_type: 'FALL_DETECTED', detected_at: at, ai_results: [] },
    ]);
    expect(result.events).toHaveLength(1);
    expect(result.frames).toEqual([]);
  });
  it('checks camera authorization before reading geometry', async () => {
    const playback = { authorizedCamera: jest.fn().mockRejectedValue(new Error('Forbidden')) },
      repo = { frames: jest.fn(), events: jest.fn() };
    const service = new PlaybackMetadataService(
      playback as unknown as PlaybackService,
      repo as unknown as PlaybackFramesRepository,
      new ConfigService(),
    );
    await expect(
      service.interval(
        { sub: 'viewer', role: 'VIEWER' },
        'camera',
        at.toISOString(),
        new Date(at.getTime() + 10000).toISOString(),
      ),
    ).rejects.toThrow('Forbidden');
    expect(repo.frames).not.toHaveBeenCalled();
  });
});
