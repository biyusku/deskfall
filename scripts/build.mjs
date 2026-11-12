import { build } from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const isProduction = process.argv.includes('--production');

const shared = { bundle: true, sourcemap: !isProduction, minify: isProduction, logLevel: 'warning' };

await Promise.all([
  build({
    ...shared,
    entryPoints: [join(root, 'src/main/main.ts')],
    outfile: join(dist, 'main.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src/preload/preload.ts')],
    outfile: join(dist, 'preload.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src/renderer/renderer.ts')],
    outfile: join(dist, 'renderer/renderer.js'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  }),
  build({
    ...shared,
    sourcemap: false,
    entryPoints: [join(root, 'src/shared/icon.ts')],
    outfile: join(root, 'build/icon-tool.cjs'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
  }),
]);

mkdirSync(join(dist, 'helper'), { recursive: true });
copyFileSync(join(root, 'src/helper/winlist.ps1'), join(dist, 'helper/winlist.ps1'));
copyFileSync(join(root, 'src/renderer/index.html'), join(dist, 'renderer/index.html'));

const require = createRequire(import.meta.url);
const icon = require(join(root, 'build/icon-tool.cjs'));
writeFileSync(join(root, 'build/icon.png'), icon.encodePng(icon.renderAppIcon(512)));

process.stdout.write(`built ${isProduction ? 'production' : 'development'} bundle into dist/\n`);
