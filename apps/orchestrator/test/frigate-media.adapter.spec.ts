import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { FrigateMediaAdapter } from '../src/media/frigate-media.adapter';

describe('FrigateMediaAdapter current person sampling', () => {
  afterEach(() => jest.restoreAllMocks());

  it('extracts a native head region without resampling the pixels', async () => {
    const bytes = Buffer.alloc(240 * 720 * 3);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const full = await sharp(bytes, { raw: { width: 240, height: 720, channels: 3 } })
      .png()
      .toBuffer();
    const media = new FrigateMediaAdapter(new ConfigService());
    const head = await media.getRecognitionHead(full);
    const { data, info } = await sharp(head.imageBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(240);
    expect(info.height).toBe(252);
    expect(head.heightFraction).toBe(0.35);
    expect(data).toEqual(bytes.subarray(0, 240 * 252 * 3));
  });

  it('crops each track from its matching JPEG and expires stale paired frames', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    const blue = await sharp({
      create: { width: 40, height: 40, channels: 3, background: '#0000ff' },
    })
      .png()
      .toBuffer();
    const jpeg = await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#ff0000' },
    })
      .composite([{ input: blue, left: 40, top: 0 }])
      .jpeg({ quality: 100 })
      .toBuffer();
    const header = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        sourceSessionId: 'source-1',
        frameId: 'frame-10',
        cameraSlug: 'cam_front',
        frameTimestamp: 10,
        frameWidth: 80,
        frameHeight: 40,
        persons: [
          {
            trackId: 'left-person',
            observedAt: 10,
            boundingBox: { x: 0, y: 0, width: 0.5, height: 1 },
          },
          {
            trackId: 'right-person',
            observedAt: 10,
            boundingBox: { x: 0.5, y: 0, width: 0.5, height: 1 },
          },
        ],
      }),
    );
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(header.length);
    const media = new FrigateMediaAdapter(new ConfigService());
    media.acceptTimestampedFrame(Buffer.concat([prefix, header, jpeg]), 10_000);
    const crop = await media.getTimestampedPersonCrop('cam_front', 'right-person', 10_000);
    expect((await sharp(crop!).metadata()).format).toBe('png');
    expect(media.getTimestampedFrameTime('cam_front')).toBe(10_000);
    await expect(
      media.getTimestampedPersonCrop('cam_front', 'right-person', 10_000, 10_000),
    ).resolves.toBeNull();
    const { data, info } = await sharp(crop!).raw().toBuffer({ resolveWithObject: true });
    const center =
      (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(data[center + 2]).toBeGreaterThan(240);
    expect(data[center]).toBeLessThan(15);
    await expect(
      media.getTimestampedPersonCrop('cam_front', 'missing-person', 10_000),
    ).resolves.toBeNull();
    await expect(
      media.getTimestampedPersonCrop('cam_front', 'right-person', 13_000),
    ).resolves.toBeNull();
  });

  it('returns timestamped full frames while fresh, prunes expired frames, and returns null when missing', async () => {
    const jpeg = await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#ff0000' },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const header = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        sourceSessionId: 'source-1',
        frameId: 'frame-10',
        cameraSlug: 'cam_front',
        frameTimestamp: 10,
        frameWidth: 80,
        frameHeight: 40,
        persons: [],
      }),
    );
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(header.length);
    const media = new FrigateMediaAdapter(new ConfigService());

    expect(media.getTimestampedFullFrame('cam_missing', 10_000)).toBeNull();

    media.acceptTimestampedFrame(Buffer.concat([prefix, header, jpeg]), 10_000);
    expect(media.getTimestampedFullFrame('cam_front', 11_000)).toEqual({
      imageBytes: jpeg,
      frameWidth: 80,
      frameHeight: 40,
      capturedAt: 10_000,
    });

    // After the 2000ms freshness window, the frame is pruned and returns null.
    expect(media.getTimestampedFullFrame('cam_front', 12_500)).toBeNull();
    expect(media.getTimestampedFullFrame('cam_front', 11_000)).toBeNull();
  });

  it('reads the latest frame and scales the person box to the returned image', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    const blue = await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#0000ff' },
    })
      .png()
      .toBuffer();
    const frame = await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#ff0000' },
    })
      .composite([{ input: blue, left: 20, top: 10 }])
      .png()
      .toBuffer();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array(frame)));
    const media = new FrigateMediaAdapter(
      new ConfigService({ FRIGATE_URL: 'http://frigate:5000' }),
    );
    const crop = await media.getCurrentPersonCrop('cam_front', [40, 20, 120, 60], 160, 80, 10);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/cam_front/latest.jpg?height=80'),
      expect.any(Object),
    );
    const { data, info } = await sharp(crop!).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBeLessThan(50);
    expect(info.height).toBeLessThan(30);
    const center =
      (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(data[center + 2]).toBeGreaterThan(240);
    expect(data[center]).toBeLessThan(15);
  });

  it('rejects stale or invalid boxes before reading a camera frame', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    const fetchMock = jest.spyOn(global, 'fetch');
    const media = new FrigateMediaAdapter(new ConfigService());
    await expect(
      media.getCurrentPersonCrop('cam_front', [1, 2, 20, 30], 1280, 720, 1),
    ).resolves.toBeNull();
    await expect(
      media.getCurrentPersonCrop('cam_front', [20, 2, 1, 30], 1280, 720, 10),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects offline preview images even if an object message is recent', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    const preview = await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#0000ff' },
    })
      .jpeg()
      .toBuffer();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(new Uint8Array(preview), { headers: { 'X-Frigate-Offline': 'true' } }),
      );
    const media = new FrigateMediaAdapter(new ConfigService());
    await expect(
      media.getCurrentPersonCrop('cam_front', [1, 2, 20, 30], 1280, 720, 10),
    ).resolves.toBeNull();
  });
});
