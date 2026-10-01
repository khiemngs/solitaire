// Static server for dist/index.html: logs every request (for the single-request
// proof) and pre-compresses with brotli/gzip the way a real host would.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const body = readFileSync(join(root, 'dist/index.html'));
const br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
const gz = gzipSync(body, { level: 9 });

const server = createServer((req, res) => {
  const path = (req.url || '/').split('#')[0].split('?')[0];
  console.log('REQ ' + path);
  if (path !== '/' && path !== '/index.html') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  const ae = String(req.headers['accept-encoding'] || '');
  const head = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=31536000, immutable',
    'vary': 'accept-encoding',
  };
  const enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : 'identity';
  const payload = enc === 'br' ? br : enc === 'gzip' ? gz : body;
  console.log('SENT ' + enc + ' ' + payload.length);
  res.writeHead(200, { ...head, 'content-length': payload.length, ...(enc === 'identity' ? {} : { 'content-encoding': enc }) });
  res.end(payload);
});

server.listen(+(process.env.PORT || 0), '127.0.0.1', () => {
  console.log('LISTEN ' + server.address().port);
});
