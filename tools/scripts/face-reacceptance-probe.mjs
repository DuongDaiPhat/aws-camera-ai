/** Diagnostic AWS probes of exact rejected crops; never counted as E2E jobs. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const req = createRequire(resolve('apps/orchestrator/package.json'));
const { RekognitionClient, SearchFacesByImageCommand } = req('@aws-sdk/client-rekognition');
const fixture = JSON.parse(readFileSync('artifacts/face-reacceptance-2026-11-23/fixture.json'));
const trace = readFileSync('docs/test/FACE_REACCEPTANCE_2026-11-23/evidence/pipeline.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map(JSON.parse);
const client = new RekognitionClient({ region: process.env.AWS_REGION, maxAttempts: 1 });
const results = [];
try {
  for (const [label, suffix] of [
    ['TC08-extra-no-glasses-candidate', '3ikvsi'],
    ['TC08-extra-glasses-candidate', '8z06hl'],
  ]) {
    const samples = trace
      .filter(
        (row) =>
          row.type === 'assess' &&
          row.case === label &&
          row.trackId?.endsWith(suffix) &&
          row.metrics,
      )
      .sort((a, b) => b.metrics.detectionScore - a.metrics.detectionScore)
      .slice(0, 3);
    for (const sample of samples) {
      const index = trace.indexOf(sample);
      const crop = trace
        .slice(index + 1)
        .find((row) => row.type === 'crop' && row.trackId === sample.trackId);
      if (!crop) continue;
      let response;
      try {
        response = await client.send(
          new SearchFacesByImageCommand({
            CollectionId: process.env.REKOGNITION_COLLECTION_PREFIX + fixture.owner,
            Image: { Bytes: readFileSync(crop.path) },
            FaceMatchThreshold: 0,
            MaxFaces: 1,
            QualityFilter: 'NONE',
          }),
        );
        results.push({
          case: label,
          path: crop.path,
          metrics: sample.metrics,
          requestId: response.$metadata.requestId,
          faceConfidence: response.SearchedFaceConfidence,
          faceBox: response.SearchedFaceBoundingBox,
          similarity: response.FaceMatches?.[0]?.Similarity ?? null,
        });
      } catch (error) {
        results.push({
          case: label,
          path: crop.path,
          metrics: sample.metrics,
          error: error.name,
          requestId: error.$metadata?.requestId,
        });
      }
    }
  }
} finally {
  client.destroy();
}
writeFileSync(
  'docs/test/FACE_REACCEPTANCE_2026-11-23/data/rejected-crop-probes.json',
  JSON.stringify({ method: 'Direct SDK diagnostic, not E2E', results }, null, 2),
);
console.log(JSON.stringify(results.map(({ path, metrics, ...row }) => row)));
