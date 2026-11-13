// Packs the whole app into one HTML file for hosting as a claude.ai Artifact:
// styles and script inline, no outside files. Run: npm run build:artifact
//
// The Anthropic and OpenAI SDKs are left out on purpose. Inside claude.ai the
// page cannot call an API directly; it uses the viewer's own Claude instead.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(`${root}${p}`, 'utf8');

const out = await build({
  entryPoints: [`${root}js/app.js`],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  write: false,
  plugins: [{
    name: 'no-sdk',
    setup(b) {
      b.onResolve({ filter: /(anthropic|openai)-sdk\.js$/ }, () => ({ path: 'sdk-stub', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default null;', loader: 'js' }));
    },
  }],
});

const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = read('css/app.css');
const page = `<title>Seria</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}</style>
<div id="app"></div>
<script>
${js}</script>
`;

mkdirSync(`${root}dist`, { recursive: true });
writeFileSync(`${root}dist/seria-artifact.html`, page);
// The same page inside the skeleton claude.ai wraps it in, for local checks.
writeFileSync(`${root}dist/preview.html`, `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${page}</body></html>\n`);
console.log(`dist/seria-artifact.html  ${Math.round(page.length / 1024)} KB`);
