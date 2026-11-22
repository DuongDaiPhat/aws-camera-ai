/** Coverage gate for notification business logic and the shared SQS transport. */
module.exports = {
  ...require('./jest.config'),
  testRegex:
    'notification-cloud\\.integration\\.spec\\.ts$|^(?!.*\\.integration\\.spec\\.ts$).*(cloud-.*|notification-cloud.*)\\.spec\\.ts$',
  collectCoverage: true,
  collectCoverageFrom: [
    'src/notification-cloud/**/*.ts',
    '!src/notification-cloud/**/*.module.ts',
    '!src/notification-cloud/**/*.types.ts',
    'src/cloud-queue/cloud-config.ts',
    'src/cloud-queue/cloud-queue.service.ts',
  ],
  coverageDirectory: './coverage/notification',
  coverageReporters: ['text', 'json', 'json-summary', 'lcov'],
  coverageThreshold: {
    global: { branches: 91, lines: 91, functions: 91, statements: 91 },
    './src/notification-cloud/': { branches: 91, lines: 91 },
    './src/cloud-queue/cloud-config.ts': { branches: 91, lines: 91 },
    './src/cloud-queue/cloud-queue.service.ts': { branches: 91, lines: 91 },
  },
};
