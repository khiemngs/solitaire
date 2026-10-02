import * as K from './game.js';

const b = document.getElementById('b'),
  win = document.getElementById('w'),
  bar = document.getElementById('h'),
  R = K.RANKS,
  S = K.SUITS;

const cards = [], slots = [];
// one parse beats 65 createElement/append pairs; order is 13 slots then 52 cards
b.innerHTML = '<div></div>'.repeat(65);
for (let i = 0; i < 13; i++) { const e = slots[i] = b.children[i]; e.className = 'e'; }
for (let i = 0; i < 52; i++) { const e = cards[i] = b.children[i + 13]; e.className = 'c'; e._c = i; }

let g, hist = [], sel = 0, dn = 0, drag = 0, dl = [], px = 0, py = 0, sx = 0, sy = 0;
let cw = 0, ch = 0, pad = 0, row2 = 0, dealt = 99, pop = -1;
const rm = matchMedia('(prefers-reduced-motion:reduce)').matches;

const cx = i => pad + i * (cw + pad);

function size() {
  cw = Math.min(innerWidth * 0.904 / 7, innerHeight * 0.16);
  pad = (innerWidth - 7 * cw) / 8;
  ch = cw * 1.4;
  row2 = pad + ch + pad * 1.5;
  b.style.setProperty('--w', cw + 'px');
  b.style.setProperty('--h', ch + 'px');
  b.style.fontSize = cw * 0.2 + 'px';
  const st = bar.style;
  st.left = cx(2) + 'px';
  st.top = pad + 'px';
  st.width = cw + 'px';
  st.height = ch + 'px';
  st.fontSize = cw * 0.3 + 'px';
}

function place(e, x, y, z) {
  e.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  e.style.zIndex = z;
  e._x = x; e._y = y;
}

function face(e, c, x, y, z, s) {
  const su = K.suit(c), r = c % 13;
  e.className = 'c' + (su % 2 ? ' r' : '') + (s ? ' s' : '') + (c === pop ? ' p' : '');
  e.textContent = (r === 9 ? '10' : R[r]) + '\n' + S[su]; // rank over suit, centred by CSS
  place(e, x, y, z);
}

function back(e, x, y, z) { e.className = 'c k'; e.textContent = ''; place(e, x, y, z); }

function draw() {
  for (let i = 0; i < 7; i++) place(slots[i], cx(i), row2, 0);
  for (let i = 0; i < 4; i++) place(slots[7 + i], cx(3 + i), pad, 0);
  place(slots[11], cx(0), pad, 0);
  place(slots[12], cx(1), pad, 0);

  const avail = innerHeight - row2 - ch;
  for (let i = 0; i < 7; i++) {
    const p = g.t[i], ys = [];
    let y = 0;
    for (let j = 0; j < p.length; j++) { ys.push(y); y += K.down(p[j]) ? ch * 0.16 : ch * 0.42; }
    const f = y > avail ? avail / y : 1;
    const anim = dealt < 99; // dealing: cards take off from the stock, face down
    for (let j = 0; j < p.length; j++) {
      const e = cards[p[j] & 63];
      let x = cx(i), y2 = row2 + ys[j] * f, z = j + 1, up = !K.down(p[j]) && !anim;
      if (anim && j * 7 + i >= dealt) { x = cx(0); y2 = pad; z = 40 + j; up = 0; }
      if (up) face(e, p[j], x, y2, z, sel && sel.k === 0 && sel.i === i && j >= sel.j);
      else back(e, x, y2, z);
      e._k = 0; e._i = i; e._j = j;
    }
  }
  for (let i = 0; i < 4; i++) if (g.f[i]) {
    const c = i * 13 + g.f[i] - 1, e = cards[c];
    face(e, c, cx(3 + i), pad, 1, 0);
    e._k = 1; e._i = i; e._j = 0;
  }
  for (let i = 0; i < g.s.length; i++) { const e = cards[g.s[i]]; back(e, cx(0), pad, i + 1); e._k = 2; e._i = 0; e._j = i; }
  for (let i = 0; i < g.w.length; i++) {
    const c = g.w[i], e = cards[c];
    face(e, c, cx(1) + Math.min(g.w.length - 1 - i, 3) * cw * 0.14, pad, i + 1, sel && sel.k === 3 && i === g.w.length - 1);
    e._k = 3; e._i = 0; e._j = i;
  }
  if (drag) for (const d of dl) place(cards[d.v], px + d.x, py + d.y, 99);
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
  if (K.won(g)) win.classList.add('on');
  return 1;
}

function tap(d, h) {
  if (h && h.k === 2) { // stock: draw or recycle
    const s = K.snapshot(g);
    if (K.stock(g)) hist.push(s);
    sel = 0; draw(); return;
  }
  if (!d) {
    if (sel && h) { go(sel, h); sel = 0; draw(); }
    return;
  }
  if (sel && sel.k === d.k && sel.i === d.i && sel.j === d.j) { // tap again: send to foundation
    const v = K.pick(g, sel);
    if (v >= 0) go(sel, { k: 1, i: K.suit(v) });
    sel = 0; draw(); return;
  }
  if (sel && h && go(sel, h)) { sel = 0; draw(); return; }
  sel = K.movable(g, d) ? { k: d.k, i: d.i, j: d.j } : 0;
  draw();
}

b.addEventListener('pointerdown', e => {
  const t = e.target;
  dn = t._c != null ? { k: t._k, i: t._i, j: t._j } : 0;
  sx = px = e.clientX; sy = py = e.clientY; drag = 0;
});

addEventListener('pointermove', e => {
  if (!dn) return;
  px = e.clientX; py = e.clientY;
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
  const d = dn;
  dn = 0;
  if (drag) {
    drag = 0;
    b.classList.remove('d');
    if (!go(sel, hit(e.clientX, e.clientY))) sel = 0;
    draw();
    return;
  }
  tap(d, hit(e.clientX, e.clientY));
});

addEventListener('pointercancel', () => { dn = 0; drag = 0; b.classList.remove('d'); draw(); });

function undo() {
  if (!hist.length) return;
  K.restore(g, hist.pop());
  sel = 0; drag = 0; dn = 0; win.classList.remove('on');
  draw();
}

function fresh(seed) {
  g = K.deal(seed);
  hist = []; sel = 0; drag = 0; dn = 0; pop = -1;
  win.classList.remove('on');
  size(); draw();
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

document.getElementById('u').onclick = undo;
document.getElementById('n').onclick = () => fresh(Date.now());
win.onclick = () => fresh(Date.now()); // tap anywhere on the win overlay to replay
addEventListener('resize', () => { size(); draw(); });

fresh(+location.hash.slice(1) || Date.now());
