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

  it('matches against a multi-prototype bank while preserving rejection of unrelated faces', () => {
    const cache = new FaceSessionCacheService(
      new ConfigService({
        FACE_SESSION_CACHE_SIMILARITY_THRESHOLD: '0.52',
        FACE_SESSION_CACHE_MAX_PROTOTYPES: '5',
      }),
    );

    const frontal = decodeEmbeddingBase64(encodeVector([1, 0, 0, 0]), 4)!;
    const angled = decodeEmbeddingBase64(encodeVector([0.4, 0.9165, 0, 0]), 4)!;
    const returnPose = decodeEmbeddingBase64(encodeVector([0.35, 0.9367, 0, 0]), 4)!;
    const stranger = decodeEmbeddingBase64(encodeVector([0, 0, 1, 0]), 4)!;

    cache.upsertKnown(
      scopeV1,
      {
        knownFaceId: 'face-alice',
        personName: 'Alice',
        trackId: 't-1',
        embedding: frontal,
        embeddings: [frontal, angled],
      },
      1_000,
    );

    // Frontal-only cosine would be 0.35 (< 0.52), but angled prototype matches ~0.998!
    const hit = cache.matchByEmbedding(scopeV1, returnPose, 2_000);
    expect(hit).not.toBeNull();
    expect(hit?.entry.knownFaceId).toBe('face-alice');
    expect(hit!.similarity).toBeGreaterThan(0.95);

    // Subsequent upsert without embeddings preserves the stored prototype bank.
    cache.upsertKnown(
      scopeV1,
      {
        knownFaceId: 'face-alice',
        personName: 'Alice',
        trackId: 't-2',
        embedding: frontal,
      },
      3_000,
    );
    expect(cache.matchByEmbedding(scopeV1, returnPose, 4_000)?.entry.embeddings).toHaveLength(2);
    expect(cache.matchByEmbedding(scopeV1, stranger, 4_000)).toBeNull();
  });

  it('enforces cosine boundary, exact TTL and collection invalidation for R50 banks', () => {
    const cache = new FaceSessionCacheService(
      new ConfigService({ FACE_SESSION_CACHE_SIMILARITY_THRESHOLD: 0.52 }),
    );
    const vector = (cosine: number): Float32Array =>
      new Float32Array([cosine, Math.sqrt(1 - cosine * cosine)]);
    cache.upsertKnown(
      scopeV1,
      {
        knownFaceId: 'face-boundary',
        personName: 'Boundary',
        trackId: 'boundary',
        embeddings: [new Float32Array([1, 0])],
      },
      1000,
    );
    expect(cache.matchByEmbedding(scopeV1, vector(0.5199), 1001)).toBeNull();
    expect(cache.matchByEmbedding(scopeV1, vector(0.5201), 1001)?.entry.knownFaceId).toBe(
      'face-boundary',
    );
    expect(cache.matchByEmbedding(scopeV1, vector(1), 300999)).not.toBeNull();
    expect(cache.matchByEmbedding(scopeV1, vector(1), 301000)).toBeNull();
    cache.upsertKnown(
      scopeV1,
      {
        knownFaceId: 'face-boundary',
        personName: 'Boundary',
        trackId: 'next',
        embeddings: [new Float32Array([1, 0])],
      },
      302000,
    );
    expect(
      cache.matchByEmbedding(
        { ...scopeV1, collectionVersion: scopeV1.collectionVersion + 1 },
        vector(1),
        302001,
      ),
    ).toBeNull();
  });

  it('evicts oldest identities at camera and global limits without crossing owner scopes', () => {
    const cache = new FaceSessionCacheService();
    const embedding = new Float32Array([1, 0]);
    for (let i = 0; i < 65; i++) {
      cache.upsertKnown(
        scopeV1,
        {
          knownFaceId: `face-${i}`,
          personName: null,
          trackId: `track-${i}`,
          embedding,
        },
        1000 + i,
      );
    }
    expect(cache.matchByEmbedding(scopeV1, embedding, 2000)?.entry.knownFaceId).toBe('face-1');
    cache.clear();
    for (let i = 0; i < 2001; i++) {
      cache.upsertKnown(
        { ...scopeV1, cameraSlug: `camera-${i}` },
        {
          knownFaceId: `face-${i}`,
          personName: null,
          trackId: `track-${i}`,
          embedding,
        },
        1000 + i,
      );
    }
    expect(
      cache.matchByEmbedding({ ...scopeV1, cameraSlug: 'camera-0' }, embedding, 4000),
    ).toBeNull();
    expect(
      cache.matchByEmbedding({ ...scopeV1, cameraSlug: 'camera-1' }, embedding, 4000),
    ).not.toBeNull();
    cache.invalidateOwner('different-owner');
    expect(
      cache.matchByEmbedding({ ...scopeV1, cameraSlug: 'camera-1' }, embedding, 4000),
    ).not.toBeNull();
    cache.invalidateOwner(scopeV1.ownerScopeId);
    expect(
      cache.matchByEmbedding({ ...scopeV1, cameraSlug: 'camera-1' }, embedding, 4000),
    ).toBeNull();
  });

  it('allows absent active tracks via allowAbsentTrackIds while ignoring non-absent active tracks', async () => {
    const cache = new FaceSessionCacheService(
      new ConfigService({
        FACE_SESSION_CACHE_TTL_MS: '300000',
        FACE_SPATIAL_REID_MAX_GAP_MS: '20000',
        FACE_SPATIAL_REID_MIN_PROXIMITY_SCORE: '0.35',
        FACE_SPATIAL_REID_MIN_APPEARANCE_SIMILARITY: '0.78',
      }),
    );

    const aliceCrop1 = await solidColorJpeg({ r: 20, g: 40, b: 220 }, { r: 30, g: 30, b: 30 });
    const aliceCrop2 = await solidColorJpeg({ r: 24, g: 44, b: 215 }, { r: 34, g: 34, b: 34 });
    const strangerCrop = await solidColorJpeg({ r: 230, g: 20, b: 20 }, { r: 230, g: 230, b: 230 });
    const aliceSig1 = await computeAppearanceSignature(aliceCrop1);
    const aliceSig2 = await computeAppearanceSignature(aliceCrop2);
    const strangerSig = await computeAppearanceSignature(strangerCrop);

    cache.upsertKnown(
      scopeV1,
      {
        knownFaceId: 'face-alice',
        personName: 'Alice',
        trackId: 'track-alice-active',
        appearanceSignature: aliceSig1,
        lastBox: [100, 100, 220, 340],
        confirmedAt: 1_000,
        endedAt: null,
      },
      1_000,
    );

    // Without allowAbsentTrackIds, active track (endedAt === null) is ignored.
    expect(cache.hasRecentlyEndedKnownTrack(scopeV1, 25_000)).toBe(false);
    expect(
      cache.matchBySpatialAppearance(scopeV1, [110, 105, 230, 345], aliceSig2, 25_000),
    ).toBeNull();

    // Non-absent active track (different ID in allowAbsentTrackIds) is still ignored.
    const otherAbsent = new Set(['track-someone-else']);
    expect(
      cache.hasRecentlyEndedKnownTrack(scopeV1, 25_000, { allowAbsentTrackIds: otherAbsent }),
    ).toBe(false);
    expect(
      cache.matchBySpatialAppearance(scopeV1, [110, 105, 230, 345], aliceSig2, 25_000, {
        allowAbsentTrackIds: otherAbsent,
      }),
    ).toBeNull();

    // When track-alice-active is in allowAbsentTrackIds, spatial Re-ID matches within sessionCacheTtlMs
    // (even after 20s spatialReidMaxGapMs when MQTT end was delayed), while rejecting strangers.
    const absentAlice = new Set(['track-alice-active']);
    expect(
      cache.hasRecentlyEndedKnownTrack(scopeV1, 25_000, { allowAbsentTrackIds: absentAlice }),
    ).toBe(true);
    expect(
      cache.matchBySpatialAppearance(scopeV1, [110, 105, 230, 345], strangerSig, 25_000, {
        allowAbsentTrackIds: absentAlice,
      }),
    ).toBeNull();
    const hit = cache.matchBySpatialAppearance(scopeV1, [110, 105, 230, 345], aliceSig2, 25_000, {
      allowAbsentTrackIds: absentAlice,
    });
    expect(hit?.entry.knownFaceId).toBe('face-alice');

    // Beyond sessionCacheTtlMs (1_000 + 300_000 = 301_000), entry expires.
    expect(
      cache.matchBySpatialAppearance(scopeV1, [110, 105, 230, 345], aliceSig2, 301_001, {
        allowAbsentTrackIds: absentAlice,
      }),
    ).toBeNull();
  });
});
