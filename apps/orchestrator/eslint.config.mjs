import base from '@cam/eslint-config/node.mjs';

export default [
  ...base,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'warn',

      // TAT co chu dich: NestJS dung emitDecoratorMetadata de tiem phu thuoc.
      // Doi `import { X }` thanh `import type { X }` se xoa metadata luc bien dich
      // va lam DI gay o runtime — mot loi rat kho tim.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
