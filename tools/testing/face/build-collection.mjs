import { writeFileSync } from 'node:fs';

const item = [];
function request(
  name,
  path,
  status,
  assertions = [],
  { auth = true, image = false, fields = [] } = {},
) {
  item.push({
    name,
    request: {
      method: 'POST',
      header: auth ? [{ key: 'X-Internal-Token', value: '{{token}}' }] : [],
      url: '{{baseUrl}}' + path,
      body: {
        mode: 'formdata',
        formdata: [
          ...(image ? [{ key: 'image', type: 'file', src: '{{imagePath}}' }] : []),
          ...fields.map(([key, value]) => ({ key, value, type: 'text' })),
        ],
      },
    },
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            `pm.test('status ${status}', () => pm.response.to.have.status(${status}));`,
            ...assertions.map(
              ([label, assertion]) => `pm.test(${JSON.stringify(label)}, () => { ${assertion} });`,
            ),
          ],
        },
      },
    ],
  });
}
for (const endpoint of ['assess', 'embed', 'match', 'collection/sync']) {
  request(
    `API-FACE-AUTH-${endpoint}: missing token`,
    '/face/' + endpoint,
    401,
    [['unauthorized body', "pm.expect(pm.response.json().detail).to.eql('UNAUTHORIZED');"]],
    { auth: false },
  );
}
request('API-FACE-001: assess requires image', '/face/assess', 422, [
  ['validation detail', 'pm.expect(pm.response.json().detail).to.be.an("array");'],
]);
const ready = [
  ['gate passes', 'pm.expect(pm.response.json().passed).to.eql(true);'],
  [
    'real R50 model',
    "pm.expect(pm.response.json().modelVersion).to.eql('yunet-2023mar-w600k-r50');",
  ],
  ['gate ready', "pm.expect(pm.response.json().gateStatus).to.eql('READY');"],
];
request(
  'API-FACE-002: real R50 assessment',
  '/face/assess',
  200,
  [
    ...ready,
    [
      'normalized 512D embedding',
      `const b=pm.response.json(); pm.expect(b.embeddingDim).to.eql(512);
    const bytes=Buffer.from(b.embeddingBase64,'base64'); pm.expect(bytes.length).to.eql(2048);
    let n=0; for(let i=0;i<512;i++){const x=bytes.readFloatLE(i*4); pm.expect(Number.isFinite(x)).to.eql(true); n+=x*x;}
    pm.expect(Math.abs(n-1)).to.be.below(0.0001);`,
    ],
  ],
  { image: true, fields: [['includeEmbedding', 'true']] },
);
request(
  'API-FACE-003: embedding opt-out',
  '/face/assess',
  200,
  [
    ...ready,
    [
      'no embedding',
      'pm.expect(pm.response.json().embeddingBase64).to.eql(null); pm.expect(pm.response.json().embeddingDim).to.eql(null);',
    ],
  ],
  { image: true, fields: [['includeEmbedding', 'false']] },
);
request(
  'API-FACE-004: SFace embed remains compatible',
  '/face/embed',
  200,
  [
    [
      '128D contract',
      'const b=pm.response.json(); pm.expect(b.error).to.eql(null); pm.expect(b.embeddingDim).to.eql(128); pm.expect(Buffer.from(b.embeddingBase64,"base64").length).to.eql(512);',
    ],
  ],
  { image: true },
);
for (const threshold of ['-0.01', '1.01']) {
  request(
    `API-FACE-BVA-${threshold}: threshold out of range`,
    '/face/match',
    422,
    [
      [
        'threshold rejected',
        "pm.expect(pm.response.json().detail.some(e=>e.loc.includes('threshold'))).to.eql(true);",
      ],
    ],
    {
      image: true,
      fields: [
        ['requestId', '00000000-0000-4000-8000-000000000001'],
        ['ownerScopeId', '00000000-0000-4000-8000-000000000002'],
        ['collectionVersion', '1'],
        ['threshold', threshold],
      ],
    },
  );
}
writeFileSync(
  new URL('./collection.json', import.meta.url),
  JSON.stringify(
    {
      info: {
        name: 'Face branch real HTTP regression',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      variable: [
        { key: 'baseUrl', value: 'http://127.0.0.1:18082' },
        { key: 'token', value: '' },
        { key: 'imagePath', value: '' },
      ],
      item,
    },
    null,
    2,
  ) + '\n',
);
