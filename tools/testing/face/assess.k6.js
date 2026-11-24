import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const image = open(__ENV.FACE_IMAGE, 'b');
const valid = new Rate('valid_assessments');
// Local HTTP gate, not a claim about end-to-end camera latency or cloud capacity.
export const options = {
  scenarios: {
    assess: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 2,
      maxVUs: 4,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate==0'],
    valid_assessments: ['rate==1'],
    dropped_iterations: ['count==0'],
    http_reqs: ['count>=120'],
  },
};

export function setup() {
  // Warm model before the measured scenario; also reject unavailable models.
  const response = assess();
  if (response.status !== 200 || response.json('embeddingDim') !== 512) {
    throw new Error('Warm-up must produce a real 512-dimensional embedding');
  }
}

function assess() {
  return http.post(
    `${__ENV.BASE_URL || 'http://127.0.0.1:18082'}/face/assess`,
    {
      image: http.file(image, 'face.png', 'image/png'),
      includeEmbedding: 'true',
    },
    { headers: { 'X-Internal-Token': __ENV.AI_INTERNAL_TOKEN }, timeout: '5s' },
  );
}

export default function () {
  const response = assess();
  const ok = check(response, {
    'real face passes gate with R50 embedding': (r) =>
      r.status === 200 &&
      r.json('passed') === true &&
      r.json('gateStatus') === 'READY' &&
      r.json('embeddingDim') === 512 &&
      r.json('modelVersion') === 'yunet-2023mar-w600k-r50',
  });
  valid.add(ok);
}
