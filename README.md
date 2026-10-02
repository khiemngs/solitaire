# Solitaire — one file, one request

**Play: <https://khiemngs.github.io/solitaire/>** (source: <https://github.com/khiemngs/solitaire>)

A complete Klondike (draw-1 or draw-3) solitaire that fits in **one self-contained HTML document**:
no external images, fonts or scripts — no requests of any kind beyond the page itself.

```
dist/index.html       10,061 B raw        4,756 B gzip -9       4,127 B brotli -q11
```

That is the whole game — HTML, CSS, 52-card deck, rules engine, renderer, input
handling and its animations — fetched in **exactly 1 HTTP request** (verified, see below).

## Play

| Action | Gesture |
|---|---|
| Draw / recycle the stock | tap the top-left pile (recycles the waste when empty) |
| Move a card or a run | one tap: home if it can go, else onto a built column, else an empty one; if nothing fits it shakes (and buzzes on Android) |
| Pick the destination yourself | drag it; the run lifts while you drag and drops where the finger leaves the screen |
| New deal / Draw 1↔3 / Hint / Undo | the thumb bar at the bottom (right edge on a phone held sideways), with moves and a clock in the middle; after a win, tap anywhere |
| Keyboard | `N` new deal, `Z` or Ctrl/⌘+Z undo, `H` hint, `D` or Space draw |
| Hint | highlights a card worth moving (foundation moves first, then reveals), or the stock when only drawing helps |
| Auto-finish | once the stock and waste are empty and every card is face up, the rest fly home on their own |
| Resume | the game, undo history, draw mode and win stats are saved to `localStorage` when the tab is hidden; reloading without a `#seed` resumes |

Tableau builds down in alternating colors, only a King opens an empty column, runs move
as a unit, foundations build up by suit, revealed tableau cards flip themselves.
`#<number>` in the URL picks the deal: `dist/index.html#21` is always the same
reproducible shuffle (the built-in xorshift32 PRNG), and it is also the test entry point.

## Why it is this small

| Technique | Effect |
|---|---|
| One document, everything inline; favicon replaced by `href="data:,"` | 1 request, no `/favicon.ico` hit |
| Cards are text: rank over suit, e.g. `10` / `♣` | zero image/font bytes; `T` is shown as `10` |
| Card face = one text node (`10♠` index) plus `::after { content: attr(data-s) }` for the big centre suit | no wrapper elements; the big suit starts below the fan strip |
| Face-up fan at 42% of the card height, sized so the index fits the visible strip | every card in a fanned run stays readable — verified on a real mid-game board |
| `padding-top: .12em`, never `%` | a percentage padding resolves against the *board* width, which pushed the face out of the strip |
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
fails (`--check`) if the file grows past 13 KB gzip (13,312 B) or gains an external
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
| `tests/logic.test.mjs` | 16 `node --test` cases |
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
  *every* move that the DOM's pile assignment for all 52 cards equals the engine's state.
  Once every card is face up the replay stops and auto-finish must play the last 7
  cards home by itself; then the win overlay appears with 52 cards home, and tapping it
  deals a fresh game.
* **Touch** — every replayed move is a real press-drag-release, checking mid-drag that
  exactly the run lifts. One tap on the hinted card moves it, `Z` undoes that, and
  tapping a face-down card moves nothing.
* **QoL** — the hint button highlights something, the `D` key draws, a reload without a
  seed resumes the identical board, undo history survives that reload (`Z` key), and the
  mode button switches to draw-3, where one draw moves three cards (`shots/mobile-draw3.png`).
* **Hint and draw-3 rules** — engine tests: draw-3 draws three, fewer at the end, recycles
  in order; hint prefers foundation moves, never shuffles a lone king between empty
  columns, finds reveals, leaves the state untouched and only suggests legal moves.
* **Rendering** — 52 cards, exactly 7 faces at the deal, rank+suit glyphs are real text
  (no tofu/emoji), the ten renders as `10` rather than `T`, the index is one centred line
  that fits inside the fan strip, every face-up card's big centre suit matches its index,
  and on a real mid-game board every face-up card under a fan still shows its whole
  index. Nothing overflows at 390×844 or 1280×800, and at 844×390 the cards stay left of
  the right-edge thumb bar. The `var()` font shorthand resolves rather than being dropped. Screenshots land in
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

Six effects, none of them a keyframe timeline the renderer has to maintain:

| Effect | How |
|---|---|
| Every move, stock draw, recycle, undo, drop | one `transition: transform .18s ease-out` — the renderer only writes `transform`, so free |
| Staggered deal on New deal / page load | tableau cards are first parked on the stock (`dealt = 0`), then a rAF loop raises `dealt` and re-runs the same `draw()`; cards fly out face down row by row and flip when the deal ends |
| Foundation flash | the landing card gets class `.p` for 300 ms (`@keyframes` animating `background` — never `transform`, which would fight the inline translate) |
| Win overlay | `#w.on` fades in |
| Dragged cards | `#b.d` disables transitions while the pointer drives them, so the cards track the finger, and lifts the run (`scale` + shadow, which compose with the inline `transform`); the class is dropped on release, so the drop animates |
| Nowhere to go | `element.animate()` on the `translate` property shakes the card, so it never fights the inline `transform` or the class rewrites in `draw()` |

`prefers-reduced-motion: reduce` skips the staggered deal in JS and disables the
transition and both animations in CSS.

Screenshots: `shots/mobile-deal-anim.png` (mid-deal), `shots/anim-inflight.png` and
`shots/anim-flash.png` (a card on its way to a foundation and its landing flash),
`shots/mobile-deal.png`, `shots/desktop-deal.png`, `shots/mobile-midgame.png` (fanned runs
with every index readable), `shots/mobile-landscape.png`, `shots/mobile-draw3.png`,
`shots/mobile-win.png`, `shots/live-github-pages.png`.

## Phone layout

| Piece | How |
|---|---|
| Thumb bar | `body` is a flex column: the board (`#b`, `flex: 1`) above a 5-cell grid bar. Below 500 px tall in landscape the body flips to a row and the bar becomes a right-edge column |
| Safe areas | `viewport-fit=cover`; body padding uses `env(safe-area-inset-*)`, the bar adds the home-indicator inset below its buttons |
| Card size | width-limited in portrait (95% of the board over 7 columns), height-limited in landscape (18% of the board); vertical gaps are capped at 12% of a card so a wide board doesn't waste height |
| Touch hygiene | no long-press callout or context menu, no tap highlight, no overscroll or pull-to-refresh, no text selection |
| Home screen | `theme-color` and the `*-web-app-capable` metas open it full screen |

## Deployment

**GitHub Pages** — <https://khiemngs.github.io/solitaire/> is live from
`.github/workflows/deploy.yml`, which mirrors the standard Actions → Pages flow
(`configure-pages` → `upload-pages-artifact` from `dist` → `deploy-pages`). Every push to
`main` rebuilds from source, so the published file is always generated, never hand-edited.
The pipeline refuses to deploy if:

* the document exceeds **13 KB gzip (13,312 B)**, or gains any non-`data:` external
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
* No timer or score; the win screen shows the move count and won/played stats.
* Keyboard covers the toolbar actions only; moving cards still needs a pointer. No ARIA labels on cards.
* Unlimited redeals in both draw modes; no Vegas scoring, no other variants.

Adding any of these is a local change in `src/`, then `node build.mjs` — the size table
tells you exactly what each one costs.

## Browser support

Modern evergreen browsers (Chrome/Edge 111+, Safari 16.4+, Firefox 113+) — the shipped
code is ES2020 with Pointer Events and CSS custom properties; `font-variant-emoji: text`
keeps the suit glyphs from turning into color emoji. Verified interactively in Chrome
113+ (headless, via the test above); not yet exercised in Safari/Firefox.
