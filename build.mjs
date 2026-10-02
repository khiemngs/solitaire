// Build: minify JS + CSS with bun, inline both into the HTML shell, minify the
// shell, then report raw / gzip / brotli transfer sizes.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const at = f => join(root, f);
const bun = args => execFileSync('bun', ['build', ...args], { cwd: root, encoding: 'utf8' });

const js = bun(['src/ui.js', '--minify', '--format=iife', '--target=browser']).trim();
const tmp = at('.css.tmp');
bun(['src/style.css', '--minify', '--outfile', tmp]);
const css = readFileSync(tmp, 'utf8').trim();
rmSync(tmp);

// The shell is our own template: no inline text or attribute needs kept whitespace.
const shell = readFileSync(at('src/index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\s*\n\s*/g, '')
  // HTML5 does not need quotes here: -2 bytes per attribute (values with `=` keep theirs).
  .replace(/ ([\w-]+)="([^"'=<>\s`]+)"/g, ' $1=$2')
  .trim();

// Replacement functions: minified output contains `$`, which would be special in a string replacement.
const html = shell.replace('/*!CSS*/', () => css).replace('/*!JS*/', () => js);

mkdirSync(at('dist'), { recursive: true });
writeFileSync(at('dist/index.html'), html);

const raw = Buffer.byteLength(html);
const gzBuf = gzipSync(Buffer.from(html), { level: 9 });
const brBuf = brotliCompressSync(Buffer.from(html), {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 22 },
});
// Pre-compressed siblings so nginx `brotli_static`/`gzip_static`, Caddy `precompressed`
// or any CDN serves the smallest bytes with no runtime compression.
writeFileSync(at('dist/index.html.br'), brBuf);
writeFileSync(at('dist/index.html.gz'), gzBuf);
const gz = gzBuf.length, br = brBuf.length;

// Any non-data src/href would cost the browser an extra HTTP request.
const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']?([^"'\s>]*)/g)].map(m => m[1]);
const external = refs.filter(u => !u.startsWith('data:'));

const targets = { raw: 7000, br: 3000 };
const kb = n => (n / 1024).toFixed(2) + ' KB';
const table = [
  ['css', Buffer.byteLength(css)],
  ['js', Buffer.byteLength(js)],
  ['html', raw],
  ['gzip -9', gz],
  ['brotli -q11', br],
];
console.log('--- parts ---');
console.log(`  css        ${String(Buffer.byteLength(css)).padStart(7)} B`);
console.log(`  js         ${String(Buffer.byteLength(js)).padStart(7)} B`);
console.log('--- dist/index.html ---');
console.log(`  raw        ${String(raw).padStart(7)} B  ${kb(raw)}  (target <= ${kb(targets.raw)})`);
console.log(`  gzip -9    ${String(gz).padStart(7)} B  ${kb(gz)}`);
console.log(`  brotli q11 ${String(br).padStart(7)} B  ${kb(br)}  (target <= ${kb(targets.br)})`);
console.log('  wrote dist/index.html, dist/index.html.br, dist/index.html.gz');
console.log(`  http requests: 1 (external refs: ${external.length})` + (external.length ? ' -> ' + external.join(', ') : ''));

if (process.argv.includes('--check')) {
  const fail = [];
  if (raw > targets.raw) fail.push(`raw ${raw} > ${targets.raw}`);
  if (br > targets.br) fail.push(`brotli ${br} > ${targets.br}`);
  if (external.length) fail.push(`${external.length} external ref(s)`);
  if (fail.length) {
    console.error('CHECK FAILED: ' + fail.join('; '));
    process.exit(1);
  }
  console.log('CHECK OK');
}
