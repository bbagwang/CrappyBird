# Falppy Bird

A lightweight TypeScript + Vite + Canvas browser game inspired by Flappy Bird. The MVP focuses on score chasing with five fair, telegraphed, skill-first gimmicks:

1. Gravity flip zones
2. Moving pipes
3. Size shift gates
4. Speed rings
5. Risk coins

## Controls

- `Space` / `ArrowUp`: flap
- Click / tap canvas: flap
- `M`: toggle mute
- `Space` on game over: restart

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal.

## Verification gates

The game is not considered complete unless every gate passes and actual browser play validation succeeds:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
npm run actual-play
```

Or run the automated non-manual sequence:

```bash
npm run verify
```

`npm run actual-play` launches a production preview, drives a real browser session with keyboard input, plays five runs, records observed gimmicks, checks console errors, and writes evidence to `artifacts/actual-play-report.json` plus a screenshot.

On this Ubuntu 26.04 WSL environment, Playwright Chromium currently needs the project wrapper in `scripts/run-with-playwright-env.mjs`. The wrapper applies the Playwright Ubuntu 24.04 host fallback and prepends the locally extracted NSS/NSPR libraries under `.omx/browser-libs` when present, so the normal `npm run test:e2e`, `npm run verify`, and `npm run actual-play` scripts remain the commands to use.

## Testing and observability contract

The app exposes `window.falppyDebug.snapshot()` and `window.falppyDebug.setSeed(seed)` for reproducible testing only. The debug surface is read-only except seed selection before a run. It does not include commands to grant score, skip hazards, force survival, disable collision, teleport, bypass game-over, or auto-pass obstacles.

## GitHub Pages

This repository deploys from `main` through `.github/workflows/pages.yml`.

The workflow validates lint, typecheck, and unit tests, then builds with:

```bash
VITE_BASE_PATH=/CrappyBird/ npm run build
```

Expected public URL after the Pages workflow finishes:

```text
https://bbagwang.github.io/CrappyBird/
```

## Character image

The renderer first tries to load `public/player-character.png`. If that file is absent, it falls back to the included `public/player-character.svg` face sprite.

To use a specific face image, save a square-ish PNG at:

```text
public/player-character.png
```

Then rebuild or push to `main` so GitHub Pages redeploys.
