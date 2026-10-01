// Shared helper for tests: a deterministic greedy player used to build a real
// winning line of moves from a given seed.
import * as K from '../src/game.js';

export function sources(g) {
  const out = [];
  if (g.w.length) out.push({ k: K.W, i: 0, j: g.w.length - 1 });
  for (let i = 0; i < 4; i++) if (g.f[i]) out.push({ k: K.F, i, j: 0 });
  for (let i = 0; i < 7; i++) {
    const p = g.t[i];
    for (let j = 0; j < p.length; j++) if (K.runOK(p, j)) out.push({ k: K.T, i, j });
  }
  return out;
}

// Returns the list of moves that wins `seed`, or null.
// Greedy by score, but it refuses to walk into a position it has already seen,
// which stops the "shuffle the same run back and forth" trap.
export function greedyLine(seed, limit = 3000) {
  const g = K.deal(seed);
  const moves = [];
  const seen = new Set([K.snapshot(g)]);
  for (let n = 0; n < limit; n++) {
    if (K.won(g)) return moves;
    const cands = [];
    for (const s of sources(g)) {
      for (let i = 0; i < 4; i++) cands.push({ s, t: { k: K.F, i }, sc: 9 });
      if (s.k === K.F) continue; // never take a card back off a foundation
      const v = K.pick(g, s);
      for (let i = 0; i < 7; i++) {
        if (s.k === K.T && s.i === i) continue;
        if (!K.canStack(g, v, i)) continue;
        const reveals = s.k === K.T && s.j > 0 && K.down(g.t[s.i][s.j - 1]);
        cands.push({ s, t: { k: K.T, i }, sc: reveals ? 5 : s.k === K.W ? 4 : g.t[i].length ? 2 : 1 });
      }
    }
    cands.sort((a, b) => b.sc - a.sc);

    let done = false;
    for (const c of cands) {
      const snap = K.snapshot(g);
      if (!K.tryMove(g, c.s, c.t)) continue;
      const hash = K.snapshot(g);
      if (seen.has(hash)) { K.restore(g, snap); continue; }
      seen.add(hash);
      moves.push({ s: c.s, t: c.t });
      done = true;
      break;
    }

    if (!done) { // stock: draw, or recycle the waste
      const snap = K.snapshot(g);
      if (!K.stock(g)) return null;
      const hash = K.snapshot(g);
      if (seen.has(hash)) { K.restore(g, snap); return null; }
      seen.add(hash);
      moves.push({ stock: true });
    }
  }
  return null;
}

// Shortest winning line found among the first `max` seeds (keeps UI replay quick).
export function findWinSeed(max = 40) {
  let best = null;
  for (let s = 1; s <= max; s++) {
    const line = greedyLine(s);
    if (line && (!best || line.length < best.line.length)) best = { seed: s, line };
  }
  return best;
}

// Card a move acts on (used to replay the line through the UI).
export function moveCard(g, mv) {
  return mv.stock ? null : K.pick(g, mv.s) & 63;
}
