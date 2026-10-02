// End-to-end proof in real headless Chrome (no npm dependencies):
//   1. the document is fetched in exactly ONE http request (no sub-resources)
//   2. it renders a full 52-card deal that fits the viewport at 2 sizes
//   3. scripted taps drive the real UI: stock, undo, selection
//   4. a winning line computed by the same engine is replayed through the UI,
//      asserting DOM state matches the engine after every single move
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as K from '../src/game.js';
import { findWinSeed, moveCard } from './autoplay.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];

function check(cond, msg, extra) {
  if (cond) console.log('  PASS  ' + msg);
  else {
    console.error('  FAIL  ' + msg + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    fails.push(msg);
  }
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      } else if (m.method) this.events.push(m);
    };
  }
  open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; }); }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); });
  }
}

const server = spawn(process.execPath, ['serve.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
let port = 0;
const reqs = [], sents = [];
server.stdout.on('data', d => {
  for (const line of String(d).split('\n')) {
    if (line.startsWith('REQ ')) reqs.push(line.slice(4).trim());
    else if (line.startsWith('SENT ')) sents.push(line.slice(5).trim());
    else if (line.startsWith('LISTEN ')) port = +line.slice(7);
  }
});

let chrome, cdp;
const profile = mkdtempSync(join(tmpdir(), 'solitaire-chrome-'));
const finish = code => {
  try { cdp && cdp.ws.close(); } catch {}
  try { chrome && chrome.kill(); } catch {}
  try { server.kill(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(code);
};

try {
  for (let i = 0; i < 100 && !port; i++) await sleep(50);
  if (!port) throw new Error('serve.mjs never reported a port');
  const base = `http://127.0.0.1:${port}`;

  console.log('== engine: find a winnable deal to replay ==');
  const win = findWinSeed(40);
  if (!win) throw new Error('no winnable seed found');
  console.log(`  seed ${win.seed}, ${win.line.length} moves`);

  chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-breakpad', '--disable-crash-reporter',
    '--disable-sync', '--disable-component-update', '--mute-audio',
    '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = '', chromeErr = '';
  chrome.stderr.on('data', d => {
    chromeErr += String(d);
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(d));
    if (m) wsUrl = m[1];
  });
  for (let i = 0; i < 300 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) throw new Error('Chrome never reported a DevTools URL: ' + chromeErr.slice(-500));
  const devPort = new URL(wsUrl).port;
  const list = await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  const ev = async expr => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page eval failed: ' + expr + ' :: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const metrics = (w, h, mobile) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: !!mobile });
  const nav = async url => {
    await cdp.send('Page.navigate', { url });
    for (let i = 0; i < 200; i++) {
      if (await ev('document.readyState').catch(() => 'x') === 'complete') break;
      await sleep(25);
    }
  };
  // Wait until the animated (CSS-transitioned) positions stop moving.
  const settle = async (max = 60) => {
    let prev = '';
    for (let i = 0; i < max; i++) {
      const cur = await ev(`[...document.querySelectorAll('#b>.c')].map(e=>{const r=e.getBoundingClientRect();
        return (r.left|0)+','+(r.top|0)}).join(';')`);
      if (cur === prev) return i;
      prev = cur;
      await sleep(50);
    }
    return -1;
  };
  const click = async ([x, y]) => {
    const p = { x, y, button: 'left', clickCount: 1 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, buttons: 0 });
  };
  // A point that really hit-tests to this card (fan offsets can hide a card's middle).
  const cardBox = id => ev(`(()=>{const e=[...document.querySelectorAll('#b>.c')].find(x=>x._c===${id});
    if(!e)return null;const r=e.getBoundingClientRect();
    for(const fy of [0.15,0.06,0.5,0.9])for(const fx of [0.5,0.2,0.8]){
      const x=r.left+r.width*fx,y=r.top+r.height*fy;
      if(document.elementFromPoint(x,y)===e)return[x,y];
    }return null})()`);
  const slotBox = i => ev(`(()=>{const r=document.querySelectorAll('#b>.e')[${i}].getBoundingClientRect();
    return [r.left+r.width/2,r.top+r.height*0.25]})()`);
  const domState = () => ev(`[...document.querySelectorAll('#b>.c')].map(e=>[e._c,e._k,e._i,e._j])
    .sort((a,b)=>a[0]-b[0])`);
  const shot = async name => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(join(root, 'shots'), { recursive: true });
    writeFileSync(join(root, 'shots', name), Buffer.from(r.data, 'base64'));
    console.log('  shot  shots/' + name);
  };

  console.log('== 1. mobile: one request, staggered deal, full render, no overflow ==');
  await metrics(390, 844, true);
  await nav(`${base}/#${win.seed}`);
  check(reqs.length === 1 && reqs[0] === '/', 'first page load = exactly 1 HTTP request', reqs.slice());
  check(/^br \d+$/.test(sents[0] || ''), 'served with brotli', sents[0]);
  const dealing = await ev(`(()=>{const c=[...document.querySelectorAll('#b>.c')];
    const stock=c.find(e=>e._k===2).getBoundingClientRect();
    const flying=c.filter(e=>e._k===0&&Math.abs(e.getBoundingClientRect().left-stock.left)<2).length;
    return {flying, tr:getComputedStyle(c[0]).transitionDuration}})()`);
  check(dealing.flying > 0, 'the deal animation is in flight right after load', dealing);
  check(dealing.tr !== '0s', 'card moves are transitioned', dealing.tr);
  await shot('mobile-deal-anim.png');
  check(await settle() >= 0, 'the deal animation settles');
  await sleep(60);
  const geom = await ev(`(()=>{const c=[...document.querySelectorAll('#b>.c')];
    const bad=c.filter(e=>{const r=e.getBoundingClientRect();
      return r.left<-1||r.top<-1||r.right>innerWidth+1||r.bottom>innerHeight+1});
    return {cards:c.length,faces:c.filter(e=>e.textContent).length,bad:bad.length,
      glyphs:[...new Set(c.filter(e=>e.textContent).map(e=>e.textContent))].sort()}})()`);
  check(geom.cards === 52, 'DOM holds all 52 cards', geom);
  check(geom.faces === 7, 'exactly 7 cards face up at the deal', geom.faces);
  check(geom.bad === 0, 'no card is outside the 390x844 viewport', geom.bad);
  check(geom.glyphs.length === 7 && geom.glyphs.every(g => /^(10|[A2-9JQK])\n[\u2660\u2665\u2663\u2666]$/.test(g)),
    'faces are rank-over-suit text, one per dealt card', geom.glyphs);
  const font = await ev(`(()=>{const s=getComputedStyle(document.querySelector('#b>.c'));
    return {family:s.fontFamily,weight:s.fontWeight,size:parseFloat(s.fontSize)}})()`);
  check(/\bsystem-ui\b/.test(font.family) && font.weight === '600' && font.size > 10,
    'the var() font shorthand resolves (not dropped as invalid)', font);
  check(geom.glyphs.some(g => g.startsWith('10')), 'the ten is displayed as 10, not T', geom.glyphs);
  // rank over suit, horizontally centred, sitting inside the fan strip at the card top
  // (getClientRects() can split a line into fragments, so cluster rects by top).
  const lay = await ev(`(()=>{const e=[...document.querySelectorAll('#b>.c')].find(x=>x.textContent.startsWith('10'));
    const r=e.getBoundingClientRect(), rg=document.createRange(); rg.selectNodeContents(e);
    const lines=[];
    for(const q of [...rg.getClientRects()].filter(q=>q.width||q.height).sort((a,b)=>a.top-b.top)){
      const L=lines[lines.length-1];
      if(L&&Math.abs(L.top-q.top)<1){L.left=Math.min(L.left,q.left);L.right=Math.max(L.right,q.right);L.bottom=Math.max(L.bottom,q.bottom);}
      else lines.push({top:q.top,left:q.left,right:q.right,bottom:q.bottom});
    }
    return {c:[r.left+r.width/2,r.top,r.height],n:lines.length,text:e.textContent,
      cx:lines.map(L=>(L.left+L.right)/2),
      block:[lines[0].top,lines[lines.length-1].bottom]}})()`);
  const off = (a, b) => Math.abs(a - b);
  check(lay.n === 2 && lay.block[0] < lay.block[1], 'cards show two lines: rank above suit',
    { lines: lay.n, text: lay.text });
  check(Math.max(...lay.cx.map(x => off(x, lay.c[0]))) < 2, 'the rank and suit are horizontally centred',
    { dx: lay.cx.map(x => +off(x, lay.c[0]).toFixed(2)) });
  check(lay.block[1] <= lay.c[1] + lay.c[2] * 0.42,
    'the face fits inside the 42% fan strip (covered cards stay readable)',
    { blockBottom: +(lay.block[1] - lay.c[1]).toFixed(1), strip: +(lay.c[2] * 0.42).toFixed(1) });
  await shot('mobile-deal.png');

  console.log('== 2. real taps: select, stock draw, undo ==');
  await settle();
  const topCard = (await domState()).find(([, k, , j]) => k === 0 && j > 0) || (await domState()).find(([, k]) => k === 0);
  await click(await cardBox(topCard[0]));
  check(await ev(`document.querySelectorAll('#b>.s').length`) === 1, 'tapping a face-up tableau card selects its run');
  await click(await slotBox(11)); // stock
  check(await ev(`document.querySelectorAll('#b>.c').length`) === 52, 'still 52 card nodes after a draw');
  check((await domState()).filter(([, k]) => k === 3).length === 1, 'stock tap moved one card to the waste');
  const undoBox = await ev(`(()=>{const r=document.getElementById('u').getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2]})()`);
  await click(undoBox);
  check((await domState()).filter(([, k]) => k === 3).length === 0, 'undo button reverted the stock draw');

  console.log('== 3. desktop render ==');
  await metrics(1280, 800, false);
  check(await settle() >= 0, 'the 1280x800 re-layout settles');
  const wide = await ev(`(()=>{const c=[...document.querySelectorAll('#b>.c')];
    const bad=c.filter(e=>{const r=e.getBoundingClientRect();
      return r.left<-1||r.top<-1||r.right>innerWidth+1||r.bottom>innerHeight+1});
    return {bad:bad.length,w:innerWidth,h:innerHeight}})()`);
  check(wide.bad === 0, 'no card is outside the 1280x800 viewport', wide);
  await shot('desktop-deal.png');

  console.log('== 4. replay a winning game through the UI (reduced motion) ==');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await metrics(390, 844, true);
  await nav(`${base}/#${win.seed}`);
  check(await ev(`getComputedStyle(document.querySelector('#b>.c')).transitionDuration`) === '0s',
    'prefers-reduced-motion turns the animations off');
  const sim = K.deal(win.seed);
  const expected = () => {
    const e = {};
    sim.t.forEach((p, i) => p.forEach((v, j) => { e[v & 63] = [0, i, j]; }));
    for (let i = 0; i < 4; i++) for (let r = 0; r < sim.f[i]; r++) e[i * 13 + r] = [1, i, 0];
    sim.s.forEach((v, i) => { e[v] = [2, 0, i]; });
    sim.w.forEach((v, i) => { e[v] = [3, 0, i]; });
    return e;
  };
  let mismatch = 0, played = 0;
  const dbg = !!process.env.DEBUG_MOVES;
  const stop = +(process.env.DEBUG_STOP || 0);
  for (let n = 0; n < win.line.length; n++) {
    if (stop && n > stop) break;
    const mv = win.line[n];
    if (mv.stock) {
      await click(await slotBox(11));
      K.stock(sim);
    } else {
      const id = moveCard(sim, mv);
      const box = await cardBox(id);
      if (!box) { check(false, `move ${n}: card ${id} is not clickable`); break; }
      if (dbg) {
        const info = await ev(`(()=>{const e=[...document.querySelectorAll('#b>.c')].find(x=>x._c===${id});
          return {k:e._k,i:e._i,j:e._j,up:!!e.textContent};})()`);
        console.log(`  move ${n}: from ${JSON.stringify(mv.s)} to ${JSON.stringify(mv.t)} card ${id} dom ${JSON.stringify(info)} at ${JSON.stringify(box)}`);
      }
      await click(box);
      const selIds = await ev(`[...document.querySelectorAll('#b>.s')].map(e=>e._c)`);
      const simRun = mv.s.k === K.T ? sim.t[mv.s.i].slice(mv.s.j).map(v => v & 63) : [id];
      if (selIds.length !== simRun.length || !simRun.every(c => selIds.includes(c))) {
        check(false, `move ${n}: tapping card ${id} did not select its run`, { selIds, simRun });
        break;
      }
      await click(await slotBox(mv.t.k === K.F ? 7 + mv.t.i : mv.t.i));
      if (!K.tryMove(sim, mv.s, mv.t)) { check(false, `move ${n}: engine rejected its own move`); break; }
    }
    const want = expected(), dom = await domState();
    const bad = [];
    if (dom.length !== 52) bad.push(['count', dom.length, 52]);
    for (const [id, k, i, j] of dom) {
      const w = want[id];
      if (!w || w[0] !== k || w[1] !== i || w[2] !== j) bad.push([id, [k, i, j], w]);
    }
    if (bad.length) { mismatch++; check(false, `move ${n}: DOM differs from the engine`, bad.slice(0, 3)); break; }
    played++;
    if (n === 60) { // a board with real fanned runs on it
      await shot('mobile-midgame.png');
      const read = await ev(`(()=>{const pile={};
        for(const e of document.querySelectorAll('#b>.c')) if(e._k===0&&e.textContent)(pile[e._i]=pile[e._i]||[]).push(e);
        let worst=1e9,checked=0,bad=[];
        for(const k in pile){const p=pile[k].sort((a,b)=>a._j-b._j);
          for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1];
            const rg=document.createRange(); rg.selectNodeContents(a);
            const rs=[...rg.getClientRects()];
            if(!rs.length) continue;
            const m=b.getBoundingClientRect().top-Math.max(...rs.map(q=>q.bottom));
            checked++; worst=Math.min(worst,m);
            if(m<0) bad.push([a._c,+m.toFixed(1)]);}}
        return {checked,margin:+worst.toFixed(1),bad:bad.slice(0,4)}})()`);
      check(read.checked > 0 && read.margin > 0,
        'on a real board, every face-up card under a fan still shows its whole face', read);
    }
  }
  check(mismatch === 0 && played === win.line.length, `all ${win.line.length} scripted moves applied and matched the engine`, { played, mismatch });
  const final = await ev(`[...document.querySelectorAll('#b>.c')].filter(e=>e._k===1).length`);
  check(final === 52, 'all 52 cards are home in the DOM', final);
  check(await ev(`document.getElementById('w').classList.contains('on')`), 'win overlay is shown');
  await shot('mobile-win.png');
  // the overlay is the only way back to a new deal now: tapping anywhere must re-deal
  await ev(`document.getElementById('w').click()`);
  await sleep(250);
  const again = await ev(`({on:document.getElementById('w').classList.contains('on'),
    home:[...document.querySelectorAll('#b>.c')].filter(e=>e._k===1).length,
    cards:document.querySelectorAll('#b>.c').length})`);
  check(!again.on && again.home === 0 && again.cards === 52, 'tapping the win overlay deals a new game', again);

  console.log('== 5. no extra requests, no page errors ==');
  check(reqs.every(r => r === '/'), 'every HTTP request was for the page itself', reqs);
  const errs = cdp.events.filter(e =>
    e.method === 'Runtime.exceptionThrown' ||
    (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  check(errs.length === 0, 'no console errors or uncaught exceptions', errs.map(e => JSON.stringify(e.params).slice(0, 200)));
} catch (err) {
  console.error('  FAIL  harness error: ' + (err && err.stack || err));
  fails.push('harness');
}

console.log(fails.length ? `\nBROWSER TEST FAILED (${fails.length}): ${fails.join('; ')}` : '\nBROWSER TEST PASSED');
finish(fails.length ? 1 : 0);
