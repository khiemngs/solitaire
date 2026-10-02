// Klondike rules engine.
// A card is an int 0..51 = suit*13 + rank (rank 0=A ... 12=K).
// Bit 6 (64) marks a face-down tableau card; strip it with `& 63`.
export const T = 0, F = 1, S = 2, W = 3;
export const DOWN = 64;
export const RANKS = 'A23456789TJQK';
export const SUITS = '\u2660\u2665\u2663\u2666'; // spade heart club diamond

export const rank = v => v % 13;
export const suit = v => (v / 13) | 0;
export const red = v => ((v / 13) | 0) % 2 > 0;
export const down = v => (v & DOWN) > 0;

// xorshift32 -> reproducible deals from a small integer seed
export function deal(seed) {
  const d = [...Array(52).keys()];
  let x = (seed >>> 0) || 1;
  const rnd = () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17; x >>>= 0;
    x ^= x << 5;  x >>>= 0;
    return x / 4294967296;
  };
  for (let i = 51; i > 0; i--) {
    // temp-variable swap, not destructuring: same bytes raw, 23 fewer brotli
    const j = (rnd() * (i + 1)) | 0, t = d[i];
    d[i] = d[j]; d[j] = t;
  }
  const t = [];
  let k = 0;
  for (let c = 0; c < 7; c++) {
    const p = [];
    for (let n = 0; n <= c; n++) p.push(d[k++] | (n < c ? DOWN : 0));
    t.push(p);
  }
  return { t, f: [0, 0, 0, 0], s: d.slice(k), w: [] };
}

// Card sitting on top of a source pile, or -1.
export function pick(g, a) {
  if (a.k === T) { const p = g.t[a.i]; return a.j < p.length ? p[a.j] : -1; }
  if (a.k === W) return g.w.length ? g.w[g.w.length - 1] : -1;
  if (a.k === F) return g.f[a.i] ? a.i * 13 + g.f[a.i] - 1 : -1;
  return -1;
}

// Tableau slice starting at j must be face-up, descending, alternating colors.
export function runOK(p, j) {
  for (let i = j; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1];
    if (down(a) || down(b) || rank(a) !== rank(b) + 1 || red(a) === red(b)) return false;
  }
  return !down(p[j]);
}

export const movable = (g, a) => {
  const v = pick(g, a);
  return v >= 0 && !down(v) && (a.k !== T || runOK(g.t[a.i], a.j));
};

export function canStack(g, v, i) {
  const p = g.t[i];
  if (!p.length) return rank(v) === 12;
  const t = p[p.length - 1];
  return !down(t) && rank(t) === rank(v) + 1 && red(t) !== red(v);
}

// Move from a = {k,i,j} to b = {k,i}. Returns true when the state changed.
export function tryMove(g, a, b) {
  if (!movable(g, a) || (a.k === b.k && a.i === b.i)) return false;
  const v = pick(g, a);
  if (b.k === F) {
    if (a.k === F) return false;
    if (a.k === T && a.j !== g.t[a.i].length - 1) return false;
    if (v !== b.i * 13 + g.f[b.i]) return false; // suit + next rank
    if (a.k === T) g.t[a.i].pop(); else g.w.pop();
    g.f[b.i]++;
  } else if (b.k === T) {
    if (!canStack(g, v, b.i)) return false;
    if (a.k === T) g.t[b.i].push(...g.t[a.i].splice(a.j));
    else if (a.k === W) g.t[b.i].push(g.w.pop());
    else { g.f[a.i]--; g.t[b.i].push(v); }
  } else return false;
  if (a.k === T) { // reveal the newly exposed tableau card
    const p = g.t[a.i];
    if (p.length && down(p[p.length - 1])) p[p.length - 1] ^= DOWN;
  }
  return true;
}

// Draw from stock, or recycle the waste. Returns true when something happened.
export function stock(g) {
  if (g.s.length) { g.w.push(g.s.pop()); return true; }
  if (g.w.length) { g.s = g.w.reverse(); g.w = []; return true; }
  return false;
}

export const won = g => g.f[0] + g.f[1] + g.f[2] + g.f[3] === 52;
export const snapshot = g => JSON.stringify(g);
export const restore = (g, s) => Object.assign(g, JSON.parse(s));
