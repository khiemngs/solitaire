import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../src/game.js';
import { sources, greedyLine, findWinSeed } from './autoplay.mjs';

const C = (rank, suit) => suit * 13 + rank; // rank 0=A .. 12=K
const st = o => ({ t: [[], [], [], [], [], [], []], f: [0, 0, 0, 0], s: [], w: [], ...o });

// Structural rules. `full` also demands the whole 52-card deck be accounted for
// (synthetic test positions only carry the cards they need).
function invariants(g, full = true) {
  const seen = new Array(52).fill(0);
  const mark = v => { const c = v & 63; assert.ok(c >= 0 && c < 52, 'card id in range'); seen[c]++; };
  g.t.forEach(p => p.forEach(mark));
  g.s.forEach(mark);
  g.w.forEach(mark);
  for (let i = 0; i < 4; i++) {
    assert.ok(g.f[i] >= 0 && g.f[i] <= 13);
    for (let r = 0; r < g.f[i]; r++) seen[i * 13 + r]++;
  }
  if (full) assert.deepEqual(seen, new Array(52).fill(1), 'all 52 cards present exactly once');
  else seen.forEach((n, i) => assert.ok(n <= 1, 'no duplicated card ' + i));
  g.t.forEach(p => { // face-down cards form a prefix
    let down = true;
    for (const v of p) { if (K.down(v)) assert.ok(down, 'face-down prefix'); else down = false; }
  });
  g.s.concat(g.w).forEach(v => assert.ok(v < 52, 'stock/waste carry no face-down bit'));
  g.w.forEach(v => assert.ok(!K.down(v)));
}

const clone = g => JSON.parse(K.snapshot(g));

function legalTargets(g) {
  const out = [];
  for (const s of sources(g)) {
    const v = K.pick(g, s);
    for (let i = 0; i < 4; i++) {
      if (s.k === K.T && s.j !== g.t[s.i].length - 1) continue; // only a pile's top card goes home
      if (v === i * 13 + g.f[i]) out.push([s, { k: K.F, i }]);
    }
    for (let i = 0; i < 7; i++) if (!(s.k === K.T && s.i === i) && K.canStack(g, v, i)) out.push([s, { k: K.T, i }]);
  }
  return out;
}

test('deal: 28 tableau cards (1..7), 24 stock, 7 face up, all unique', () => {
  const g = K.deal(1);
  assert.deepEqual(g.t.map(p => p.length), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(g.s.length, 24);
  assert.equal(g.w.length, 0);
  assert.deepEqual(g.f, [0, 0, 0, 0]);
  g.t.forEach(p => {
    assert.ok(!K.down(p[p.length - 1]), 'top card is face up');
    p.slice(0, -1).forEach(v => assert.ok(K.down(v), 'the rest are face down'));
  });
  invariants(g);
});

test('deal: deterministic per seed, different across seeds', () => {
  assert.deepEqual(K.deal(7), K.deal(7));
  assert.notDeepEqual(K.deal(7).t, K.deal(8).t);
});

test('tableau: builds down in alternating colors, runs move as a unit', () => {
  const g = st({ t: [[C(5, 0)], [C(4, 1), C(3, 0), C(2, 1)], [], [], [], [], []] }); // S6 | H5 S4 H3
  assert.ok(K.tryMove(g, { k: K.T, i: 1, j: 0 }, { k: K.T, i: 0 }));
  assert.deepEqual(g.t[0], [C(5, 0), C(4, 1), C(3, 0), C(2, 1)]);
  assert.deepEqual(g.t[1], []);
  invariants(g, false);
});

test('tableau: same color, wrong rank and mid-run picks are refused', () => {
  const ok = st({ t: [[C(5, 0)], [C(4, 1)], [], [], [], [], []] }); // H5 onto S6
  assert.ok(K.tryMove(ok, { k: K.T, i: 1, j: 0 }, { k: K.T, i: 0 }));

  const sameColor = st({ t: [[C(5, 3)], [C(4, 3)], [], [], [], [], []] }); // D5 onto D6 (both red)
  assert.equal(K.tryMove(sameColor, { k: K.T, i: 1, j: 0 }, { k: K.T, i: 0 }), false);

  const ascending = st({ t: [[C(5, 0)], [C(7, 1)], [], [], [], [], []] }); // H8 onto S6
  assert.equal(K.tryMove(ascending, { k: K.T, i: 1, j: 0 }, { k: K.T, i: 0 }), false);

  const nonTop = st({ t: [[C(5, 0)], [C(4, 1), C(3, 0)], [], [], [], [], []] }); // S6 | H5 S4
  assert.equal(K.tryMove(nonTop, { k: K.T, i: 1, j: 1 }, { k: K.T, i: 0 }), false, 'S4 cannot go on S6');
  assert.ok(K.tryMove(nonTop, { k: K.T, i: 1, j: 0 }, { k: K.T, i: 0 }), 'but the whole run can');
});

test('tableau: only a king fills an empty column', () => {
  const g = st({ t: [[], [C(12, 1)], [C(11, 0)], [], [], [], []] });
  assert.equal(K.tryMove(g, { k: K.T, i: 2, j: 0 }, { k: K.T, i: 0 }), false);
  assert.ok(K.tryMove(g, { k: K.T, i: 1, j: 0 }, { k: K.T, i: 0 }));
  assert.deepEqual(g.t[0], [C(12, 1)]);
  invariants(g, false);
});

test('tableau: moving a run reveals and flips the card underneath', () => {
  const g = st({ t: [[C(2, 0)], [C(0, 0) | K.DOWN, C(1, 1)], [], [], [], [], []] }); // S3 | [Adown H2]
  assert.ok(K.tryMove(g, { k: K.T, i: 1, j: 1 }, { k: K.T, i: 0 }));
  assert.deepEqual(g.t[1], [C(0, 0)], 'exposed card flipped face up');
  assert.equal(K.down(g.t[1][0]), false);
  invariants(g, false);
});

test('foundation: accepts only the next card of its own suit', () => {
  const g = st({ t: [[C(0, 0), C(1, 0)], [], [], [], [], [], []] }); // SA under S2
  assert.equal(K.tryMove(g, { k: K.T, i: 0, j: 0 }, { k: K.F, i: 0 }), false, 'SA is not the top card');
  assert.equal(K.tryMove(g, { k: K.T, i: 0, j: 1 }, { k: K.F, i: 0 }), false, 'S2 cannot go home before SA');
  assert.equal(g.f[0], 0);

  const h = st({ t: [[C(0, 0)], [], [], [], [], [], []] }); // SA alone
  assert.ok(K.tryMove(h, { k: K.T, i: 0, j: 0 }, { k: K.F, i: 0 }));
  assert.equal(h.f[0], 1);
  assert.equal(K.tryMove(h, { k: K.T, i: 0, j: 0 }, { k: K.F, i: 0 }), false, 'pile is empty now');

  const k = st({ t: [[C(1, 0)], [], [], [], [], [], []], f: [1, 0, 0, 0] }); // S2 with SA home
  assert.ok(K.tryMove(k, { k: K.T, i: 0, j: 0 }, { k: K.F, i: 0 }));
  assert.equal(k.f[0], 2);

  const w = st({ w: [C(0, 1)] }); // HA into the spade foundation
  assert.equal(K.tryMove(w, { k: K.W, i: 0, j: 0 }, { k: K.F, i: 0 }), false);
  assert.ok(K.tryMove(w, { k: K.W, i: 0, j: 0 }, { k: K.F, i: 1 }));
});

test('foundation cards can come back out to the tableau', () => {
  const g = st({ f: [1, 0, 0, 0], t: [[C(1, 1)], [], [], [], [], [], []] }); // SA home, H2 on the table
  assert.ok(K.tryMove(g, { k: K.F, i: 0 }, { k: K.T, i: 0 }));
  assert.deepEqual(g.t[0], [C(1, 1), C(0, 0)]);
  assert.equal(g.f[0], 0);
  invariants(g, false);
});

test('illegal moves leave the state untouched', () => {
  const g = K.deal(3);
  const before = K.snapshot(g);
  const bad = [
    [{ k: K.T, i: 0, j: 0 }, { k: K.T, i: 0 }],
    [{ k: K.T, i: 6, j: 0 }, { k: K.T, i: 5 }],
    [{ k: K.W, i: 0, j: 0 }, { k: K.F, i: 0 }],
    [{ k: K.F, i: 0 }, { k: K.T, i: 0 }],
    [{ k: K.S, i: 0, j: 0 }, { k: K.T, i: 0 }],
  ];
  for (const [a, b] of bad) assert.equal(K.tryMove(g, a, b), false);
  assert.equal(K.snapshot(g), before);
});

test('stock draws then recycles the waste', () => {
  const g = st({ s: [1, 2, 3], w: [] });
  assert.ok(K.stock(g));
  assert.deepEqual([g.s, g.w], [[1, 2], [3]]);
  assert.ok(K.stock(g));
  assert.ok(K.stock(g));
  assert.deepEqual([g.s, g.w], [[], [3, 2, 1]]);
  assert.ok(K.stock(g), 'recycle');
  assert.deepEqual([g.s, g.w], [[1, 2, 3], []]);
  assert.equal(K.stock(st({})), false);
});

test('a waste card cannot move to an empty column unless it is a king', () => {
  const g = st({ w: [C(5, 0)] });
  assert.equal(K.tryMove(g, { k: K.W, i: 0, j: 0 }, { k: K.T, i: 0 }), false);
  const h = st({ w: [C(12, 3)] });
  assert.ok(K.tryMove(h, { k: K.W, i: 0, j: 0 }, { k: K.T, i: 0 }));
  assert.deepEqual(h.t[0], [C(12, 3)]);
});

test('undo snapshots round-trip every played move', () => {
  const g = K.deal(11);
  const hist = [];
  for (let n = 0; n < 60; n++) {
    hist.push(K.snapshot(g));
    const targets = legalTargets(g);
    if (targets.length && n % 3) {
      const [s, t] = targets[n % targets.length];
      K.tryMove(g, s, t);
    } else if (!K.stock(g)) break;
  }
  while (hist.length) {
    const s = hist.pop();
    const want = JSON.parse(s);
    K.restore(g, s);
    assert.deepEqual(g, want);
    invariants(g);
  }
});

test('fuzz: random legal play never breaks an invariant', () => {
  let x = 12345;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x >>>= 0; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  for (let seed = 1; seed <= 30; seed++) {
    const g = K.deal(seed);
    invariants(g);
    for (let n = 0; n < 600; n++) {
      const targets = legalTargets(g);
      if (targets.length && rnd() < 0.85) {
        const [s, t] = targets[(rnd() * targets.length) | 0];
        assert.ok(K.tryMove(g, s, t));
      } else K.stock(g);
      invariants(g);
    }
  }
});

test('win: a full game can be played to 52 cards home through the engine', () => {
  const found = findWinSeed(40);
  assert.ok(found, 'greedy player found a winnable seed');
  const g = K.deal(found.seed);
  for (const mv of found.line) {
    if (mv.stock) K.stock(g);
    else assert.ok(K.tryMove(g, mv.s, mv.t), 'replayed move is legal');
    invariants(g);
  }
  assert.ok(K.won(g), `seed ${found.seed} wins in ${found.line.length} moves`);
  assert.ok(g.f.every(n => n === 13));
  assert.deepEqual(greedyLine(found.seed).length, found.line.length, 'greedy line is deterministic');
});

test('draw-3: draws three, fewer at the end, then recycles in order', () => {
  const g = st({ s: [1, 2, 3, 4, 5], n: 3 });
  assert.ok(K.stock(g));
  assert.deepEqual([g.s, g.w], [[1, 2], [5, 4, 3]]);
  assert.ok(K.stock(g));
  assert.deepEqual([g.s, g.w], [[], [5, 4, 3, 2, 1]]);
  assert.ok(K.stock(g), 'recycle');
  assert.deepEqual([g.s, g.w], [[1, 2, 3, 4, 5], []]);
  assert.equal(K.deal(5, 3).n, 3);
  assert.equal(K.deal(5).n, 1);
});

test('hint: foundation first, skips king shuffles, null when stuck', () => {
  const home = st({ t: [[C(0, 0)], [C(5, 0)], [C(4, 1)], [], [], [], []] }); // SA, S6, H5
  assert.deepEqual(K.hint(home), { a: { k: K.T, i: 0, j: 0 }, b: { k: K.F, i: 0 } });

  const king = st({ t: [[C(12, 0)], [], [], [], [], [], []] });
  assert.equal(K.hint(king), null, 'a lone king never hops between empty columns');

  const reveal = st({ t: [[C(5, 0)], [C(9, 2) | K.DOWN, C(4, 1)], [], [], [], [], []] });
  assert.deepEqual(K.hint(reveal), { a: { k: K.T, i: 1, j: 1 }, b: { k: K.T, i: 0 } });

  const g = K.deal(9);
  const before = K.snapshot(g), h = K.hint(g);
  assert.equal(K.snapshot(g), before, 'hint does not touch the state');
  if (h) assert.ok(K.tryMove(g, h.a, h.b), 'the hinted move is legal');
});
