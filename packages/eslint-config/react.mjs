import base from './node.mjs';

/** Base config cho Next.js / React. */
export default [
  ...base,
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
    },
  },
];
