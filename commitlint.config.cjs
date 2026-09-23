/**
 * Quy uoc commit: xem docs/conventions/GIT_WORKFLOW.md
 * Vi du hop le: feat(orchestrator): them escalation timer recovery (US-13)
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'orchestrator',
        'web',
        'ai',
        'contracts',
        'db',
        'infra',
        'api',
        'ci',
        'docs',
        'deps',
        'repo',
      ],
    ],
    'scope-empty': [2, 'never'],
    'subject-case': [0],
    'header-max-length': [2, 'always', 200],
    'body-max-line-length': [0],
  },
};
