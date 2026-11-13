// Builds the two third-party files the app loads at runtime, so the app itself
// needs no build step. Re-run after bumping versions: npm run vendor
import { build } from 'esbuild';
import { copyFileSync, writeFileSync, statSync, readFileSync } from 'node:fs';

const pkg = (name) => JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url)));

// 1. Preact + hooks + htm in one ES module (already self-contained upstream).
copyFileSync(
  new URL('../node_modules/htm/preact/standalone.module.js', import.meta.url),
  new URL('../vendor/preact-htm.js', import.meta.url),
);

// 2. The official Anthropic SDK, bundled for the browser.
await build({
  stdin: { contents: `export { default } from '@anthropic-ai/sdk';`, resolveDir: new URL('..', import.meta.url).pathname },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  outfile: new URL('../vendor/anthropic-sdk.js', import.meta.url).pathname,
});

writeFileSync(
  new URL('../vendor/VERSIONS.txt', import.meta.url),
  [
    `preact-htm.js   htm ${pkg('htm').version} standalone build, which bundles Preact 10 and its hooks (Apache-2.0 / MIT)`,
    `anthropic-sdk.js   @anthropic-ai/sdk ${pkg('@anthropic-ai/sdk').version} (MIT)`,
    '',
  ].join('\n'),
);
for (const f of ['preact-htm.js', 'anthropic-sdk.js']) {
  console.log(f, Math.round(statSync(new URL(`../vendor/${f}`, import.meta.url)).size / 1024) + ' KB');
}
