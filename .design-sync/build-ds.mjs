#!/usr/bin/env node
// Builds a tiny, package-shaped copy of Checkly's shared UI so design-sync can
// bundle it (the app itself ships no library dist/). Output is regenerated and
// gitignored: .design-sync/.cache/ds-pkg/
//   index.js     ESM bundle of the exports below (react/react-dom external)
//   index.css    the app's real stylesheet (src/renderer/styles/index.css, bundled)
//   types/       .d.ts tree emitted by tsc + an index.d.ts barrel
// Run from the repo root: node .design-sync/build-ds.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esbuild = require(resolve('node_modules/esbuild'));

// Sync scope: the shared UI used by the scenario editor screen.
// { module (repo-relative, no ext): [exported names] }
const EXPORTS = {
  'src/renderer/shared/ui/Button': ['Button'],
  'src/renderer/shared/ui/Input': ['Input', 'PasswordInput'],
  'src/renderer/shared/ui/ActionTag': ['ActionTag'],
  'src/renderer/shared/ui/Icon': ['Icon'],
  'src/renderer/shared/ui/Modal': ['Modal'],
};

const OUT = resolve('.design-sync/.cache/ds-pkg');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'types'), { recursive: true });

const barrel = (prefix) =>
  Object.entries(EXPORTS)
    .map(([mod, names]) => `export { ${names.join(', ')} } from ${JSON.stringify(prefix + mod)};`)
    .join('\n') + '\n';

// 1. JS bundle (ESM, react external).
await esbuild.build({
  stdin: { contents: barrel(resolve('.') + '/'), resolveDir: resolve('.'), loader: 'ts', sourcefile: 'ds-entry.ts' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  outfile: join(OUT, 'index.js'),
  logLevel: 'warning',
});

// 2. CSS: the app's real stylesheet. Remote @import url(...) (Google Fonts) stay external.
await esbuild.build({
  entryPoints: [resolve('src/renderer/styles/index.css')],
  bundle: true,
  external: ['https://*', 'http://*'],
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff': 'file', '.woff2': 'file' },
  outfile: join(OUT, 'index.css'),
  logLevel: 'warning',
});

// 3. Types.
const files = Object.keys(EXPORTS).map((m) => `${m}.tsx`);
execFileSync(process.execPath, [
  resolve('node_modules/typescript/bin/tsc'),
  '--declaration', '--emitDeclarationOnly', '--skipLibCheck', '--jsx', 'react-jsx',
  '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022',
  '--esModuleInterop', '--strict', '--rootDir', '.', '--outDir', join(OUT, 'types'),
  ...files,
], { stdio: 'inherit' });
writeFileSync(join(OUT, 'types/index.d.ts'), barrel('./'));

writeFileSync(join(OUT, 'package.json'), JSON.stringify({
  name: 'checkly-ui',
  version: JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version,
  module: 'index.js',
  types: 'types/index.d.ts',
  style: 'index.css',
  peerDependencies: { react: '*', 'react-dom': '*' },
}, null, 2));
console.log(`built ${OUT}`);
