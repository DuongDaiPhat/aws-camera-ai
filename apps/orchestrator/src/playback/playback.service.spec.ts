import { ConfigService } from '@nestjs/config';
import { PlaybackService, recordingSegments } from './playback.service';
import { PlaybackRepository } from './playback.repository';
import type { RecordingArchive, ArchiveCamera, PlaybackActor } from './playback.types';
describe('Recording archive policy and gaps', () => {
  const camera: ArchiveCamera = {
    id: 'camera',
    slug: 'private-slug',
    name: 'Home',
    timeZone: 'Asia/Ho_Chi_Minh',
    isEnabled: false,
    recordingEnabled: false,
    retentionDays: 7,
  };
  const actor: PlaybackActor = { sub: 'viewer', role: 'VIEWER' };
  const repo = { cameras: jest.fn() };
  const archive: jest.Mocked<RecordingArchive> = { list: jest.fn(), clip: jest.fn() };
  const service = new PlaybackService(
    repo as unknown as PlaybackRepository,
    archive,
    new ConfigService(),
  );
  beforeEach(() => {
    jest.clearAllMocks();
    repo.cameras.mockResolvedValue([camera]);
  });
  it('hides inaccessible cameras and never reads the archive', async () => {
    repo.cameras.mockResolvedValue([]);
    await expect(service.day(actor, 'other', '2026-11-16')).rejects.toThrow('Không tìm thấy');
    expect(archive.list).not.toHaveBeenCalled();
    expect(repo.cameras).toHaveBeenCalledWith(actor, 'other');
  });
  it('keeps retained recordings accessible when recording is now disabled', async () => {
    archive.list.mockResolvedValue([{ start: 1794841670, end: 1794841680, motion: true }]);
    const day = await service.day(actor, 'camera', '2026-11-16');
    expect(day.segments).toHaveLength(1);
    expect(day.dayStartAt).toBe('2026-11-15T17:00:00.000Z');
  });
  it('does not send internal archive names to the browser', async () => {
    expect((await service.cameras(actor)).data[0]).not.toHaveProperty('slug');
  });
  it('does not invent footage in a future day', async () => {
    const day = await service.day(actor, 'camera', '2099-01-01');
    expect(day.segments).toEqual([]);
    expect(archive.list).not.toHaveBeenCalled();
  });
  it('rejects a clip crossing a real recording gap', async () => {
    archive.list.mockResolvedValue([
      { start: 100, end: 110, motion: false },
      { start: 113, end: 120, motion: false },
    ]);
    await expect(
      service.clip(actor, 'camera', new Date(100000).toISOString(), new Date(120000).toISOString()),
    ).rejects.toThrow('không có đủ');
    expect(archive.clip).not.toHaveBeenCalled();
  });
  it('rejects unbounded clips before calling Frigate', async () => {
    await expect(
      service.clip(actor, 'camera', new Date(100000).toISOString(), new Date(400000).toISOString()),
    ).rejects.toThrow('không hợp lệ');
    expect(archive.list).not.toHaveBeenCalled();
  });
  it('passes only an authorized fully retained interval to the video adapter', async () => {
    archive.list.mockResolvedValue([{ start: 100, end: 110, motion: false }]);
    archive.clip.mockResolvedValue(Buffer.from('mp4'));
    await expect(
      service.clip(actor, 'camera', new Date(100000).toISOString(), new Date(110000).toISOString()),
    ).resolves.toEqual(Buffer.from('mp4'));
    expect(archive.clip).toHaveBeenCalledWith('private-slug', 100, 110);
  });
  it('splits large records but preserves gaps and trims day boundaries', () => {
    const result = recordingSegments(
      [
        { start: 0, end: 300, motion: true },
        { start: 303, end: 320, motion: false },
      ],
      10,
      310,
      120,
    );
    expect(result.map((s) => s.durationSeconds)).toEqual([120, 120, 50, 7]);
    expect(result[3]?.startAt).toBe(new Date(303000).toISOString());
  });
});
