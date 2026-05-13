/* eslint-disable no-console */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const port = 4274;
const url = `http://127.0.0.1:${port}`;
const artifactsDir = 'artifacts';

async function waitForServer(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_error) {
      // Preview server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Preview server did not become ready');
}

async function snapshot(page) {
  return page.evaluate(() => window.falppyDebug.snapshot());
}

async function pilotFor(page, durationMs) {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const latest = await snapshot(page);
    if (latest.phase !== 'playing') return latest;
    const upcoming = latest.nextObstacle;
    const target = upcoming && upcoming.x < latest.player.x + 285 ? upcoming.gapY : 360;
    const predictedY = latest.player.y + latest.player.vy * 0.12;
    const margin = upcoming?.moving ? 34 : 42;
    if (!latest.player.gravityInverted && (predictedY > target + margin || latest.player.y > 585)) await page.keyboard.press('Space');
    if (latest.player.gravityInverted && (predictedY < target - margin || latest.player.y < 135)) await page.keyboard.press('Space');
    await page.waitForTimeout(35);
  }
  return snapshot(page);
}

async function waitForGameOver(page) {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    const state = await snapshot(page);
    if (state.phase === 'gameOver') return state;
    await page.waitForTimeout(250);
  }
  throw new Error('Expected a natural game over after pilot stopped');
}

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

const previewLogs = [];
preview.stdout.on('data', (chunk) => previewLogs.push(chunk.toString()));
preview.stderr.on('data', (chunk) => previewLogs.push(chunk.toString()));

try {
  await waitForServer();
  await mkdir(artifactsDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 960, height: 800 }, recordVideo: { dir: `${artifactsDir}/videos` } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  const runs = [];
  const allSeen = new Set();
  for (let run = 1; run <= 5; run += 1) {
    await page.goto(`${url}/?seed=actual-play-${run}`);
    await page.evaluate((seed) => window.falppyDebug.setSeed(seed), `actual-play-${run}`);
    await page.keyboard.press('Space');
    const piloted = await pilotFor(page, run === 1 ? 18_000 : 8_000);
    for (const gimmick of piloted.seenGimmicks) allSeen.add(gimmick);
    const scoreBeforeCrash = piloted.score;
    const seenBeforeCrash = [...piloted.seenGimmicks];
    const gameOver = await waitForGameOver(page);
    runs.push({
      run,
      scoreBeforeCrash,
      finalScore: gameOver.score,
      deathCause: gameOver.deathCause,
      seenGimmicks: seenBeforeCrash,
      restarts: gameOver.counters.restarts,
    });
    if (run < 5) await page.keyboard.press('Space');
  }

  await page.screenshot({ path: `${artifactsDir}/actual-play-final.png`, fullPage: true });
  await context.close();
  await browser.close();

  const required = ['gravityFlip', 'movingPipe', 'sizeShift', 'speedRing', 'riskCoin'];
  const missing = required.filter((gimmick) => !allSeen.has(gimmick));
  const report = {
    url,
    runs,
    allSeenGimmicks: [...allSeen].sort(),
    missingGimmicks: missing,
    consoleErrors,
    fairness: 'Observed deaths were produced by stopping real input after piloted play; no invisible debug shortcut was used.',
    restartReliability: runs.every((run) => run.restarts >= 1),
    screenshot: `${artifactsDir}/actual-play-final.png`,
  };
  await writeFile(`${artifactsDir}/actual-play-report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (missing.length > 0) throw new Error(`Missing gimmicks during actual play: ${missing.join(', ')}`);
  if (consoleErrors.length > 0) throw new Error(`Console errors during actual play: ${consoleErrors.join(' | ')}`);
  if (runs.some((run) => run.scoreBeforeCrash < 1)) throw new Error('A run failed to reach a playable score before crash');
  console.log(JSON.stringify(report, null, 2));
} finally {
  const exited = new Promise((resolve) => {
    if (preview.exitCode !== null || preview.signalCode !== null) {
      resolve(undefined);
    } else {
      preview.once('exit', resolve);
    }
  });
  preview.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (preview.exitCode === null && preview.signalCode === null) {
    preview.kill('SIGKILL');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))]);
  }
  if (previewLogs.length > 0) {
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(`${artifactsDir}/preview.log`, previewLogs.join(''), 'utf8');
  }
}
