# Solitaire — one file, one request

**Play: <https://khiemngs.github.io/solitaire/>** (source: <https://github.com/khiemngs/solitaire>)

A complete Klondike (draw-1) solitaire that fits in **one self-contained HTML document**:
no external images, fonts or scripts — no requests of any kind beyond the page itself.

```
dist/index.html        6,946 B raw        3,349 B gzip -9       2,895 B brotli -q11
```

That is the whole game — HTML, CSS, 52-card deck, rules engine, renderer, input
handling and its animations — fetched in **exactly 1 HTTP request** (verified, see below).

## Play

| Action | Gesture |
|---|---|
| Draw / recycle the stock | tap the top-left pile (recycles the waste when empty) |
| Move a card or a run | tap it, then tap the destination column (empty slot or a top card) |
| Send a card home | tap it twice (second tap tries its foundation) |
| Drag and drop | press and move — tap-to-move is just the no-drag path |
| Undo / New deal | the New and Undo buttons in the third column; after a win, tap anywhere |

Tableau builds down in alternating colors, only a King opens an empty column, runs move
as a unit, foundations build up by suit, revealed tableau cards flip themselves.
`#<number>` in the URL picks the deal: `dist/index.html#21` is always the same
reproducible shuffle (the built-in xorshift32 PRNG), and it is also the test entry point.

## Why it is this small

| Technique | Effect |
|---|---|
| One document, everything inline; favicon replaced by `href="data:,"` | 1 request, no `/favicon.ico` hit |
| Cards are text: rank over suit, e.g. `10` / `♣` | zero image/font bytes; `T` is shown as `10` |
| Two-line face from one text node (`\n` + `white-space:pre` + `display:grid;justify-items:center;align-content:start`) | no wrapper elements, and the face sits in the card's top strip |
| Face-up fan at 42% of the card height, sized so the face fits the visible strip | every card in a fanned run stays readable — verified on a real mid-game board |
| `padding-top: .15em`, never `%` | a percentage padding resolves against the *board* width, which pushed the face out of the strip |
| Card = int `0..51` (`suit*13+rank`); rank/suit by arithmetic | no deck data, no markup per card |
| Bit 6 of a card int = face-down tableau card | face-up state costs 0 extra bytes |
| 52 DOM nodes created once, moved with `transform:translate()` only | no diffing, no templates, no framework |
| Face-down / face-up tableau rendering branches at draw time | (this was the one real bug the browser test caught) |
| Single delegated `pointerdown` on the board, `pointermove/up` on window | tap-to-move and drag from ~25 lines |
| Undo = `JSON.stringify` state snapshots (~180 B each) | no inverse-move logic, no bugs |
| One CSS `transition: transform` on `.c` | every move, draw, recycle, undo and drag-drop is animated for free — the renderer only ever writes `transform` |
| `#b.d > div { transition: none }` only while dragging | the pointer never lags, add one class instead of per-card styles |
| Deal animation reuses the same `draw()` (cards parked on the stock, `dealt` counter stepped by rAF) | staggered deal from ~10 lines, no keyframes, no per-card delays |
| `font: 600 1em/1 var(--f, system-ui)` | dodges the CSS minifier's 130-byte `system-ui` stack expansion (measured: −90 B raw, −61 B brotli) |
| 1–2 character ids/classes (`#b`, `.c`, `.k`, `.r`, `.s`, `.p`), seeded deal | fewer bytes in both CSS and HTML |
| 65 board nodes built by one `innerHTML` parse + `String.repeat` | beats 65 `createElement`/`append` pairs |
| `bun build --minify` (esbuild) for JS + CSS, whitespace/comment HTML minify, HTML attribute quotes removed | JS 5,314 B, CSS 1,280 B, shell 352 B |
| Pre-compressed `dist/index.html.br` / `.gz` written by the build | brotli 2.84 KB over the wire where the host supports it |

### What actually shrinks the file (measured, and counter-intuitive)

The served bytes are already compressed, so removing *repetition* is worthless and can be
counter-productive:

| change | raw | gzip | brotli |
|---|---|---|---|
| CSS: drop `will-change`, card/selection shadows, `-webkit-user-select`, the redundant win-button rules, 4-digit hex, shorter gradient stops | −173 | −79 | −77 |
| shell + JS: drop the Again button, unquote HTML attributes, build all 65 nodes with one `innerHTML` parse, reuse `place()` for the drag, hoist `bar.style`, `\|0` instead of `Math.floor` | −187 | −15 | +18 |
| *rejected:* alias `getElementById`/`addEventListener`/`Math`, `classList`→`hidden`, `transform`→`translate` (measured against the 7,310 B file) | −165 | **+37** | **+54** |
| *rejected:* destructuring swap instead of a temp variable | 0 | 0 | **+23** |

**Total: 7,310 → 6,946 raw (−364 B, −5.0 %), 3,527 → 3,349 gzip (−178 B, −5.0 %),
2,966 → 2,895 brotli (−71 B, −2.4 %)**, of which every byte came from deleting content
rather than renaming it. The last two rows are deliberately *not* in the file: the
temp-variable swap is kept because it is the same size raw but 23 bytes cheaper brotli.
| Pre-compressed `dist/index.html.br` / `.gz` written by the build | brotli 2.83 KB over the wire, no runtime compression |

Measured step by step with `node build.mjs`, which prints the raw/gzip/brotli table and
fails (`--check`) if the file grows past 12 KB raw / 5 KB brotli or gains an external
reference.

## Files

| Path | Purpose |
|---|---|
| `dist/index.html` | **the deliverable** — minified, self-contained |
| `dist/index.html.br`, `.gz` | pre-compressed siblings for `brotli_static` / `gzip_static` |
| `src/game.js` | rules engine (pure, importable, tested) |
| `src/ui.js` | layout, rendering, pointer input, undo stack, animations |
| `src/style.css`, `src/index.html` | styling and the HTML shell with `/*!CSS*/` `/*!JS*/` slots |
| `build.mjs` | minify → inline → minify → size report / `--check` |
| `serve.mjs` | logs every request, serves pre-compressed bytes (used by the tests) |
| `tests/logic.test.mjs` | 14 `node --test` cases |
| `tests/autoplay.mjs` | deterministic greedy player that finds a genuinely winnable deal |
| `tests/browser.mjs` | real headless-Chrome end-to-end proof |

## Build, run, verify

```sh
node build.mjs --check        # rebuild dist/, print sizes, fail if over target
node --test tests/logic.test.mjs
node tests/browser.mjs        # needs Google Chrome (set $CHROME to override the path)
node serve.mjs                # PORT=8080 node serve.mjs -> http://127.0.0.1:8080
```

### What is actually proven

* **One request** — `serve.mjs` logs every hit; the test asserts the first page load
  produced exactly one (`/`), that nothing else was ever requested, and that Chrome
  received it brotli-encoded.
* **Rules** — deal shape (1..7, 24 stock, 7 face up), every move type legal *and*
  illegal case by case, run moves, reveal-and-flip, foundation order, stock recycling,
  illegal moves leaving state untouched, undo round-trips, plus a 30 × 600-move random
  fuzz run asserting "all 52 cards exist exactly once, face-down cards form a prefix".
* **It can be won** — a greedy player finds a winnable seed, the line is replayed through
  the engine and ends at `won()`.
* **The UI is the engine** — that same winning line (seed 21, 332 moves) is replayed in
  real Chrome by dispatching actual mouse events at computed coordinates, asserting after
  *every* move that the DOM's pile assignment for all 52 cards equals the engine's state,
  then that the win overlay appears with 52 cards home, and that tapping the overlay
  (its only control — there is no button any more) deals a fresh game.
* **Rendering** — 52 cards, exactly 7 faces at the deal, rank+suit glyphs are real text
  (no tofu/emoji), the ten renders as `10` rather than `T`, each face is measured to be
  two lines with the rank above the suit and both horizontally centred, the face is
  proven to fit inside the fan strip, and on a real mid-game board every face-up card
  under a fan still shows its whole face. Nothing overflows at 390×844 or 1280×800, and
  the `var()` font shorthand resolves rather than being dropped. Screenshots land in
  `shots/`.
* **Animation** — the test samples the board *during* the deal and asserts cards are
  still in flight, that `.c` really has a transition, that the board settles afterwards,
  and that emulated `prefers-reduced-motion: reduce` turns both off (the 332-move replay
  then runs against the static path, which also keeps it deterministic).
* **On the live site** — the deployed document is built by CI from this source and is
  **behaviourally identical** to the committed `dist/index.html`; bun's minifier emits
  equivalent output that differs slightly by platform (6,950 B on the Linux runner vs
  6,946 B locally — different short names and one CSS shorthand in a different order).
  Loading <https://khiemngs.github.io/solitaire/> in real Chrome produces **exactly one
  network request** (the document — no favicon, no sub-resources), a correct 52-card deal,
  working stock/undo taps and zero console errors. See `shots/live-github-pages.png`.

## Animation

Five effects, ~690 B raw / ~280 B brotli in total, none of them a keyframe timeline the
renderer has to maintain:

| Effect | How |
|---|---|
| Every move, stock draw, recycle, undo, drop | one `transition: transform .18s ease-out` — the renderer only writes `transform`, so free |
| Staggered deal on New deal / page load | tableau cards are first parked on the stock (`dealt = 0`), then a rAF loop raises `dealt` and re-runs the same `draw()`; cards fly out face down row by row and flip when the deal ends |
| Foundation flash | the landing card gets class `.p` for 300 ms (`@keyframes` animating `background` — never `transform`, which would fight the inline translate) |
| Win overlay | `#w.on` fades in |
| Dragged cards | `#b.d` disables transitions while the pointer drives them, so the cards track the finger; the class is dropped on release, so the drop animates |

`prefers-reduced-motion: reduce` skips the staggered deal in JS and disables the
transition and both animations in CSS.

Screenshots: `shots/mobile-deal-anim.png` (mid-deal), `shots/anim-inflight.png` and
`shots/anim-flash.png` (a card on its way to a foundation and its landing flash),
`shots/mobile-deal.png`, `shots/desktop-deal.png`, `shots/mobile-midgame.png` (fanned runs
with every face readable), `shots/mobile-win.png`, `shots/live-github-pages.png`.

## Deployment

**GitHub Pages** — <https://khiemngs.github.io/solitaire/> is live from
`.github/workflows/deploy.yml`, which mirrors the standard Actions → Pages flow
(`configure-pages` → `upload-pages-artifact` from `dist` → `deploy-pages`). Every push to
`main` rebuilds from source, so the published file is always generated, never hand-edited.
The pipeline refuses to deploy if:

* the document exceeds **7,000 B raw / 3,000 B brotli**, or gains any non-`data:` external
  reference (that would mean a second HTTP request),
* a rules test fails.

Bun is pinned (`1.3.14`) in the workflow because the minifier's identifier naming is
version-specific. It is not platform-independent though: the same source minifies to
6,946 B locally (macOS) and 6,950 B on the Linux runner, with the same behaviour. So the
workflow reports the drift against the committed `dist/` (`git diff --stat`) instead of
failing on it, and the artifact it publishes is always the one it just built.

Two things to know about GitHub Pages specifically: it serves the document **gzip-encoded
(3,352 B measured on the live site)** — it does not pick up the pre-compressed `.br`/`.gz`
siblings — and it sends `Cache-Control: max-age=600`. Both are fine here (one request,
~3.35 KB), but a host with `brotli_static` gets 2,895 B and immutable caching:

```nginx
brotli_static on;      # serves index.html.br (2,895 B) when the client accepts br
gzip_static on;        # falls back to index.html.gz (3,349 B)
location = / { add_header Cache-Control "public, max-age=31536000, immutable"; }
```

```caddy
encode zstd br gzip
header Cache-Control "public, max-age=31536000, immutable"
```

`serve.mjs` does the same thing in 40 lines if you want a demo host without nginx.
Because the document is immutable and has zero sub-resources, repeat visits are served
entirely from cache — 0 network requests.

## Deliberate omissions (they cost bytes)

* No particles, sound, confetti or cascading win animation — the win state is a fade.
* No timer, score, statistics or persistence (`localStorage` was left out).
* No keyboard play and no ARIA labels; the tap targets are the cards themselves.
* Draw-1 with unlimited redeals only; no draw-3, no Vegas scoring, no variants.
* No hint/auto-complete: finishing the last cards home is manual.

Adding any of these is a local change in `src/`, then `node build.mjs` — the size table
tells you exactly what each one costs.

## Browser support

Modern evergreen browsers (Chrome/Edge 111+, Safari 16.4+, Firefox 113+) — the shipped
code is ES2020 with Pointer Events and CSS custom properties; `font-variant-emoji: text`
keeps the suit glyphs from turning into color emoji. Verified interactively in Chrome
113+ (headless, via the test above); not yet exercised in Safari/Firefox.
