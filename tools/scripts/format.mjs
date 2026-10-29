/** Format project files without traversing ignored datasets, models or caches. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const prettier = join(dirname(require.resolve('prettier/package.json')), 'bin/prettier.cjs');
const mode = process.argv[2];
const batchSize = 64; // Keep arguments below Windows command-line limits.

if (process.argv.length !== 3 || !['--check', '--write'].includes(mode)) {
  console.error('Usage: node tools/scripts/format.mjs <--check|--write>');
  process.exit(2);
}

// Git prunes ignored directories before enumeration. Prettier still applies
// .prettierignore to each explicit path, including generated code exclusions.
const listed = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' },
);
const files = [...new Set(listed.split('\0'))].filter(
  (file) => /\.(?:ts|tsx|js|json|md|yaml|yml)$/.test(file) && existsSync(join(root, file)),
);

let exitCode = 0;
for (let offset = 0; offset < files.length; offset += batchSize) {
  const result = spawnSync(
    process.execPath,
    [prettier, mode, ...files.slice(offset, offset + batchSize)],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  if (result.error) {
    console.error(`Could not run Prettier: ${result.error.message}`);
    process.exit(2);
  }
  exitCode = Math.max(exitCode, result.status ?? 2);
}
process.exitCode = exitCode;
