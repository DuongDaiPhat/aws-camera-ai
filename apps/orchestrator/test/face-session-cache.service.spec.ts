import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import {
  computeAppearanceSignature,
  computeBoxProximity,
  cosineSimilarity,
  decodeEmbeddingBase64,
  FaceSessionCacheService,
} from '../src/face-recognition/face-session-cache.service';

function encodeVector(values: number[]): string {
  const buf = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    buf.writeFloatLE(values[i]!, i * 4);
  }
  return buf.toString('base64');
}

async function solidColorJpeg(
  top: { r: number; g: number; b: number },
  bottom: { r: number; g: number; b: number },
): Promise<Buffer> {
  const width = 24;
  const height = 24;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const c = y < height / 2 ? top : bottom;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      raw[idx] = c.r;
      raw[idx + 1] = c.g;
      raw[idx + 2] = c.b;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

describe('FaceSessionCacheService (Layer 4 Tailgating-Safe Cache & Re-ID)', () => {
  const scopeV1 = {
    ownerScopeId: '11111111-1111-4111-8111-111111111111',
    cameraSlug: 'cam_front',
    collectionVersion: 1,
  };

  it('decodes little-endian float32 embeddings and matches by cosine similarity threshold', () => {
    const cache = new FaceSessionCacheService(
      new ConfigService({
        FACE_SESSION_CACHE_SIMILARITY_THRESHOLD: '0.72',
      }),
    );

    const embA = decodeEmbeddingBase64(encodeVector([1, 0, 0, 0]), 4);
    const embANear = decodeEmbeddingBase64(encodeVector([0.95, 0.25, 0, 0]), 4);
    const embStranger = decodeEmbeddingBase64(encodeVector([0, 1, 0, 0]), 4);
    expect(embA).not.toBeNull();

    cache.upsertKnown(
      scopeV1,
      {
        knownFaceId: 'face-alice',
        personName: 'Alice',
        trackId: 't-1',
        embedding: embA,
      },
      1_000,
    );

    const hit = cache.matchByEmbedding(scopeV1, embANear, 2_000);
    expect(hit).not.toBeNull();
    expect(hit?.entry.knownFaceId).toBe('face-alice');
    expect(hit!.similarity).toBeGreaterThanOrEqual(0.72);

    const miss = cache.matchByEmbedding(scopeV1, embStranger, 2_000);
    expect(miss).toBeNull();
  });

  it('strictly scopes by (ownerScopeId, cameraSlug, collectionVersion) and invalidates prior versions', () => {
    const cache = new FaceSessionCacheService(new ConfigService({}));
    const emb = decodeEmbeddingBase64(encodeVector([1, 0, 0, 0]), 4)!;

    cache.upsertKnown(
      scopeV1,
      {
        knownFaceId: 'face-alice',
        personName: 'Alice',
        trackId: 't-1',
        embedding: emb,
      },
      1_000,
    );

    // Different cameraSlug -> miss
    expect(cache.matchByEmbedding({ ...scopeV1, cameraSlug: 'cam_back' }, emb, 2_000)).toBeNull();

    // Different ownerScopeId -> miss
    expect(
      cache.matchByEmbedding(
        { ...scopeV1, ownerScopeId: '99999999-9999-4999-8999-999999999999' },
        emb,
        2_000,
      ),
    ).toBeNull();

    // Changing collectionVersion invalidates prior cached entries!
    expect(cache.matchByEmbedding({ ...scopeV1, collectionVersion: 2 }, emb, 2_000)).toBeNull();
    expect(cache.matchByEmbedding(scopeV1, emb, 2_500)).toBeNull();
  });

  it('matches spatial+appearance Re-ID ONLY after track ended, within gap, and blocks tailgating strangers', async () => {
    const cache = new FaceSessionCacheService(
      new ConfigService({
        FACE_SPATIAL_REID_MAX_GAP_MS: '20000',
        FACE_SPATIAL_REID_MIN_PROXIMITY_SCORE: '0.35',
        FACE_SPATIAL_REID_MIN_APPEARANCE_SIMILARITY: '0.78',
      }),
    );

    const aliceCrop1 = await solidColorJpeg({ r: 20, g: 40, b: 220 }, { r: 30, g: 30, b: 30 });
    const aliceCrop2 = await solidColorJpeg({ r: 25, g: 45, b: 215 }, { r: 35, g: 35, b: 35 });
    const strangerCrop = await solidColorJpeg({ r: 230, g: 20, b: 20 }, { r: 230, g: 230, b: 230 });

    const aliceSig1 = await computeAppearanceSignature(aliceCrop1);
    const aliceSig2 = await computeAppearanceSignature(aliceCrop2);
    const strangerSig = await computeAppearanceSignature(strangerCrop);
    expect(aliceSig1).not.toBeNull();
    expect(cosineSimilarity(aliceSig1!, aliceSig2!)).toBeGreaterThanOrEqual(0.78);
    expect(cosineSimilarity(aliceSig1!, strangerSig!)).toBeLessThan(0.5);

    cache.upsertKnown(
      scopeV1,
      {
        knownFaceId: 'face-alice',
        personName: 'Alice',
        trackId: 'track-alice-1',
        appearanceSignature: aliceSig1,
        lastBox: [100, 100, 220, 340],
        endedAt: null,
      },
      1_000,
    );

    // While track-alice-1 is STILL ACTIVE (endedAt === null), spatial Re-ID must NOT match.
    expect(
      cache.matchBySpatialAppearance(scopeV1, [110, 105, 230, 345], aliceSig2, 2_000),
    ).toBeNull();

    // End Alice's track at t=3000.
    cache.markTrackEnded(scopeV1, 'track-alice-1', 3_000, [105, 100, 225, 340]);

    // Tailgating stranger at exact same box but different appearance -> MUST NOT match.
    expect(
      cache.matchBySpatialAppearance(scopeV1, [108, 102, 228, 342], strangerSig, 4_000),
    ).toBeNull();

    // Same appearance far across room -> MUST NOT match.
    expect(
      cache.matchBySpatialAppearance(scopeV1, [900, 100, 1020, 340], aliceSig2, 4_000),
    ).toBeNull();

    // Alice's dropped track resumes nearby with same appearance within 20s -> MATCH!
    const reidHit = cache.matchBySpatialAppearance(scopeV1, [115, 104, 235, 344], aliceSig2, 5_000);
    expect(reidHit).not.toBeNull();
    expect(reidHit?.entry.knownFaceId).toBe('face-alice');

    // Beyond 20s max gap -> MUST NOT match.
    expect(
      cache.matchBySpatialAppearance(scopeV1, [115, 104, 235, 344], aliceSig2, 24_000),
    ).toBeNull();
  });

  it('expires entries after sessionCacheTtlMs and computes scale-invariant box proximity', () => {
    const cache = new FaceSessionCacheService(
      new ConfigService({ FACE_SESSION_CACHE_TTL_MS: '10000' }),
    );
    const emb = decodeEmbeddingBase64(encodeVector([1, 0]), 2)!;
    cache.upsertKnown(
      scopeV1,
      { knownFaceId: 'face-1', personName: 'Bob', trackId: 't-1', embedding: emb },
      1_000,
    );
    expect(cache.matchByEmbedding(scopeV1, emb, 10_999)).not.toBeNull();
    expect(cache.matchByEmbedding(scopeV1, emb, 11_001)).toBeNull();

    expect(computeBoxProximity([0.1, 0.1, 0.3, 0.5], [0.11, 0.1, 0.31, 0.5])).toBeGreaterThan(0.8);
    expect(computeBoxProximity([0, 0, 100, 200], [500, 500, 600, 700])).toBe(0);
  });
});
