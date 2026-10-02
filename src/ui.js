import * as K from './game.js';

const b = document.getElementById('b'),
  win = document.getElementById('w'),
  md = document.getElementById('m'),
  hud = document.getElementById('t'),
  R = K.RANKS,
  S = K.SUITS;

const cards = [], slots = [];
// one parse beats 65 createElement/append pairs; order is 13 slots then 52 cards
b.innerHTML = '<div></div>'.repeat(65);
for (let i = 0; i < 13; i++) { const e = slots[i] = b.children[i]; e.className = 'e'; }
for (let i = 0; i < 52; i++) { const e = cards[i] = b.children[i + 13]; e.className = 'c'; e._c = i; }

let g, hist = [], sel = 0, dn = 0, drag = 0, dl = [], px = 0, py = 0, sx = 0, sy = 0;
let cw = 0, ch = 0, pad = 0, vg = 0, row2 = 0, bh = 0, ox = 0, oy = 0, dealt = 99, pop = -1;
let mode = 1, stats = [0, 0], done = 0, at = 0, time = 0, saved; // stats = [won, played], time in seconds
try { saved = JSON.parse(localStorage.sol); mode = saved.m; stats = saved.a; } catch { saved = 0; }
const rm = matchMedia('(prefers-reduced-motion:reduce)').matches;

const cx = i => pad + i * (cw + pad);

// the board is the flex area left over by the safe-area padding and the thumb bar
function size() {
  const r = b.getBoundingClientRect();
  ox = r.left; oy = r.top; bh = r.height;
  cw = Math.min(r.width * 0.95 / 7, bh * 0.18);
  pad = (r.width - 7 * cw) / 8;
  vg = Math.min(pad, cw * 0.12); // vertical gap: a wide landscape board must not spend its height on spacing
  ch = cw * 1.4;
  row2 = vg + ch + Math.max(vg, 6) * 1.5;
  b.style.setProperty('--w', cw + 'px');
  b.style.setProperty('--h', ch + 'px');
  b.style.fontSize = cw * 0.34 + 'px';
}

const clock = () => (time / 60 | 0) + ':' + String(time % 60).padStart(2, '0'),
  tick = () => { hud.textContent = hist.length + (hist.length == 1 ? ' move\n' : ' moves\n') + clock(); };

function place(e, x, y, z) {
  e.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  e.style.zIndex = z;
  e._x = x; e._y = y;
}

function face(e, c, x, y, z, s) {
  const su = K.suit(c), r = c % 13;
  e.className = 'c' + (su % 2 ? ' r' : '') + (s ? ' s' : '') + (c === pop ? ' p' : '');
  e.textContent = (r === 9 ? '10' : R[r]) + S[su]; // index strip; CSS draws the big suit from data-s
  e.dataset.s = S[su];
  place(e, x, y, z);
}

function back(e, x, y, z, s) { e.className = 'c k' + (s ? ' s' : ''); e.textContent = ''; place(e, x, y, z); }

function draw() {
  for (let i = 0; i < 7; i++) place(slots[i], cx(i), row2, 0);
  for (let i = 0; i < 4; i++) place(slots[7 + i], cx(3 + i), vg, 0);
  place(slots[11], cx(0), vg, 0);
  const hs = sel.k === 2; // hint: draw from the stock
  slots[11].className = hs ? 'e s' : 'e';
  place(slots[12], cx(1), vg, 0);

  const avail = bh - row2 - ch - vg;
  for (let i = 0; i < 7; i++) {
    const p = g.t[i], ys = [];
    let y = 0;
    for (let j = 0; j < p.length; j++) { ys.push(y); y += K.down(p[j]) ? ch * 0.16 : ch * 0.42; }
    const f = y > avail ? avail / y : 1;
    const anim = dealt < 99; // dealing: cards take off from the stock, face down
    for (let j = 0; j < p.length; j++) {
      const e = cards[p[j] & 63];
      let x = cx(i), y2 = row2 + ys[j] * f, z = j + 1, up = !K.down(p[j]) && !anim;
      if (anim && j * 7 + i >= dealt) { x = cx(0); y2 = vg; z = 40 + j; up = 0; }
      if (up) face(e, p[j], x, y2, z, sel && sel.k === 0 && sel.i === i && j >= sel.j);
      else back(e, x, y2, z);
      e._k = 0; e._i = i; e._j = j;
    }
  }
  for (let i = 0; i < 4; i++) if (g.f[i]) {
    const c = i * 13 + g.f[i] - 1, e = cards[c];
    face(e, c, cx(3 + i), vg, 1, 0);
    e._k = 1; e._i = i; e._j = 0;
  }
  for (let i = 0; i < g.s.length; i++) { const e = cards[g.s[i]]; back(e, cx(0), vg, i + 1, hs); e._k = 2; e._i = 0; e._j = i; }
  for (let i = 0; i < g.w.length; i++) {
    const c = g.w[i], e = cards[c];
    face(e, c, cx(1) + Math.max(0, i - g.w.length + 3) * cw * 0.25, vg, i + 1, sel && sel.k === 3 && i === g.w.length - 1);
    e._k = 3; e._i = 0; e._j = i;
  }
  if (drag) for (const d of dl) place(cards[d.v], px + d.x, py + d.y, 99);
  tick();
}

function hit(x, y) {
  const i = Math.max(0, Math.min(6, (x - pad) / (cw + pad) | 0));
  if (y < row2) return i === 0 ? { k: 2 } : i === 1 ? { k: 3 } : i > 2 ? { k: 1, i: i - 3 } : 0;
  return { k: 0, i };
}

const run = a => a.k === 0
  ? g.t[a.i].slice(a.j).map(v => v & 63)
  : [K.pick(g, a) & 63];

function go(a, t) {
  const s = K.snapshot(g), v = K.pick(g, a) & 63;
  if (!K.tryMove(g, a, t)) return 0;
  hist.push(s);
  if (t.k === 1) { // flash the card as it lands on its foundation
    pop = v;
    setTimeout(() => { pop = -1; draw(); }, 300);
  }
  if (K.won(g)) {
    if (!done) done = 1, stats[0]++;
    win.textContent = `You win!\n${hist.length} moves in ${clock()}\nWon ${stats[0]} of ${stats[1]}\nTap to play again`;
    win.classList.add('on');
  }
  clearTimeout(at);
  at = setTimeout(auto, 90);
  return 1;
}

// once every card is face up and the stock is spent, play the rest home one card per tick
function auto() {
  if (g.s.length + g.w.length || g.t.some(p => p.some(K.down))) return;
  if (dn) { at = setTimeout(auto, 90); return; }
  for (let i = 0; i < 7; i++) {
    const p = g.t[i], j = p.length - 1;
    if (j >= 0 && go({ k: 0, i, j }, { k: 1, i: K.suit(p[j]) })) { sel = 0; draw(); return; }
  }
}

function hint() {
  const m = K.hint(g);
  sel = m ? m.a : g.s.length + g.w.length ? { k: 2 } : 0;
  draw();
}

// one tap moves a card: home if it can go, else onto a built column, else into an empty one
function best(a) {
  if (go(a, { k: 1, i: K.suit(K.pick(g, a)) })) return 1;
  const cols = [0, 1, 2, 3, 4, 5, 6].sort((x, y) => !g.t[x].length - !g.t[y].length);
  for (const i of cols) if ((a.k || a.j || g.t[i].length) && go(a, { k: 0, i })) return 1; // no king hops between empty columns
  return 0;
}

// nothing to do with this card: shake it and buzz
function shake(a) {
  navigator.vibrate?.(30);
  if (!rm) for (const v of run(a)) cards[v].animate([{ translate: '-5px' }, { translate: '5px' }, { translate: '0' }], 150);
}

function tap(d, h) {
  if (h && h.k === 2) { // stock: draw or recycle
    const s = K.snapshot(g);
    if (K.stock(g)) hist.push(s);
  } else if (d && !best(d)) shake(d);
  sel = 0; draw();
}

b.addEventListener('pointerdown', e => {
  const t = e.target;
  dn = t._c != null ? { k: t._k, i: t._i, j: t._j } : 0;
  sx = px = e.clientX - ox; sy = py = e.clientY - oy; drag = 0;
});

addEventListener('pointermove', e => {
  if (!dn) return;
  px = e.clientX - ox; py = e.clientY - oy;
  if (!drag) {
    if (Math.abs(px - sx) + Math.abs(py - sy) < 9 || !K.movable(g, dn)) return;
    sel = { k: dn.k, i: dn.i, j: dn.j };
    dl = run(sel).map(v => ({ v, x: cards[v]._x - sx, y: cards[v]._y - sy }));
    drag = 1;
    b.classList.add('d'); // no transition while the pointer drives the cards
  }
  draw();
});

addEventListener('pointerup', e => {
  const d = dn, h = hit(e.clientX - ox, e.clientY - oy); // the lift point: the last move may not have arrived yet
  dn = 0;
  if (drag) {
    drag = 0;
    b.classList.remove('d');
    go(sel, h);
    sel = 0; draw();
    return;
  }
  tap(d, h);
});

addEventListener('pointercancel', () => { dn = 0; drag = 0; b.classList.remove('d'); draw(); });

function show() {
  sel = 0; drag = 0; dn = 0; pop = -1;
  clearTimeout(at);
  win.classList.remove('on');
  md.textContent = 'Draw ' + mode;
  size(); draw();
}

function undo() {
  if (hist.length) K.restore(g, hist.pop()), show();
}

function fresh(seed) {
  g = K.deal(seed, mode);
  hist = []; done = 0; time = 0; stats[1]++;
  show();
  if (rm) return;
  // deal: park the tableau on the stock, then hand the cards out one row at a time
  dealt = 0; draw();
  void b.offsetHeight; // flush, so the first flight starts from the stock
  const step = () => {
    dealt += 2;
    if (dealt < 50) { draw(); requestAnimationFrame(step); }
    else { dealt = 99; draw(); }
  };
  requestAnimationFrame(step);
}

const deal = () => fresh(Date.now()), pull = () => tap(0, { k: 2 });
document.getElementById('u').onclick = undo;
document.getElementById('n').onclick = deal;
document.getElementById('i').onclick = hint;
md.onclick = () => { mode = 4 - mode; deal(); }; // 1 <-> 3, starts a new deal
win.onclick = deal; // tap anywhere on the win overlay to replay
addEventListener('resize', () => { size(); draw(); });
addEventListener('contextmenu', e => e.preventDefault()); // no long-press menu on cards

// the clock runs once the first move is made, and stops while hidden or won
setInterval(() => { if (!document.hidden && hist.length && !done) time++, tick(); }, 1000);

addEventListener('keydown', e => {
  const f = e.ctrlKey || e.metaKey ? e.key == 'z' && undo : { z: undo, n: deal, h: hint, d: pull, ' ': pull }[e.key];
  if (f && !e.altKey) e.preventDefault(), f();
});

document.addEventListener('visibilitychange', () => {
  try { localStorage.sol = JSON.stringify({ g, h: hist, m: mode, a: stats, d: done, c: time }); } catch {}
});

// #<seed> always deals that seed; otherwise resume the saved game unless it was won
const seed = +location.hash.slice(1);
if (!seed && saved && !saved.d) g = saved.g, hist = saved.h, time = saved.c || 0, show();
else fresh(seed || Date.now());
