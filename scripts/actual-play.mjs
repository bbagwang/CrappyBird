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
      // 미리보기 서버가 아직 준비되지 않았습니다.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('미리보기 서버가 준비되지 않았습니다');
}

async function snapshot(page) {
  return page.evaluate(() => window.crappyDebug.snapshot());
}

async function pilotFor(page, durationMs) {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const latest = await snapshot(page);
    if (latest.phase !== 'playing') return latest;
    const upcoming = latest.nextObstacle;
    const target = upcoming && upcoming.x < latest.player.x + 340 ? upcoming.gapY : 360;
    const predictedY = latest.player.y + latest.player.vy * 0.15;
    const margin = upcoming?.moving ? 40 : 48;
    if (!latest.player.gravityInverted && (predictedY > target + margin || latest.player.y > 585)) await page.keyboard.press('Space');
    if (latest.player.gravityInverted && (predictedY < target - margin || latest.player.y < 135)) await page.keyboard.press('Space');
    await page.waitForTimeout(35);
  }
  return snapshot(page);
}

async function waitForGameOver(page) {
  const start = Date.now();
  while (Date.now() - start < 15_000) {
    const state = await snapshot(page);
    if (state.phase === 'gameOver') return state;
    await page.waitForTimeout(250);
  }
  throw new Error('조종을 멈춘 뒤 자연스러운 게임 오버가 필요합니다');
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
    await page.evaluate((seed) => window.crappyDebug.setSeed(seed), `actual-play-${run}`);
    await page.keyboard.press('Space');
    const piloted = await pilotFor(page, run === 1 ? 30_000 : 12_000);
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

  const required = ['gravityFlip', 'movingPipe', 'sizeShift', 'speedRing', 'riskCoin', 'slowMo', 'shieldBubble', 'windGust'];
  const missing = required.filter((gimmick) => !allSeen.has(gimmick));
  const report = {
    url,
    runs,
    allSeenGimmicks: [...allSeen].sort(),
    missingGimmicks: missing,
    consoleErrors,
    fairness: '플레이 조종을 멈춘 뒤 실제 입력만으로 사망을 확인했습니다. 보이지 않는 디버그 지름길은 사용하지 않았습니다.',
    restartReliability: runs.every((run) => run.restarts >= 1),
    screenshot: `${artifactsDir}/actual-play-final.png`,
  };
  await writeFile(`${artifactsDir}/actual-play-report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (missing.length > 0) throw new Error(`실제 플레이 중 관측하지 못한 기믹: ${missing.join(', ')}`);
  if (consoleErrors.length > 0) throw new Error(`실제 플레이 중 콘솔 오류: ${consoleErrors.join(' | ')}`);
  if (runs.some((run) => run.scoreBeforeCrash < 1)) throw new Error('충돌 전 플레이 가능한 점수에 도달하지 못한 회차가 있습니다');
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
