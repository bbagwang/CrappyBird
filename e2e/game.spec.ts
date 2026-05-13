import { expect, test, type Page } from '@playwright/test';
import type { GameSnapshot } from '../src/game/types';

declare global {
  interface Window {
    falppyDebug: Readonly<{
      setSeed(seed: string): boolean;
      snapshot(): GameSnapshot;
    }>;
  }
}

async function snapshot(page: Page): Promise<GameSnapshot> {
  return page.evaluate(() => window.falppyDebug.snapshot());
}

async function startSeededRun(page: Page, seed: string): Promise<void> {
  await page.goto(`/?seed=${encodeURIComponent(seed)}`);
  await page.evaluate((value) => window.falppyDebug.setSeed(value), seed);
  await page.keyboard.press('Space');
  expect((await snapshot(page)).phase).toBe('playing');
}

async function pilotFor(page: Page, durationMs: number): Promise<GameSnapshot> {
  return pilotUntil(page, () => false, durationMs);
}

async function pilotUntil(page: Page, accept: (snapshot: GameSnapshot) => boolean, timeoutMs: number): Promise<GameSnapshot> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const latest = await snapshot(page);
    if (accept(latest) || latest.phase !== 'playing') return latest;
    const upcoming = latest.nextObstacle;
    const target = upcoming && upcoming.x < latest.player.x + 285 ? upcoming.gapY : 360;
    const predictedY = latest.player.y + latest.player.vy * 0.12;
    const margin = upcoming?.moving ? 34 : 42;
    if (!latest.player.gravityInverted && (predictedY > target + margin || latest.player.y > 585)) {
      await page.keyboard.press('Space');
    }
    if (latest.player.gravityInverted && (predictedY < target - margin || latest.player.y < 135)) {
      await page.keyboard.press('Space');
    }
    await page.waitForTimeout(35);
  }
  return snapshot(page);
}

function reachedAllGimmicks(snapshot: GameSnapshot): boolean {
  return (
    snapshot.score >= 5 &&
    snapshot.counters.obstaclesPassed >= 5 &&
    ['gravityFlip', 'movingPipe', 'sizeShift', 'speedRing', 'riskCoin'].every((gimmick) =>
      snapshot.seenGimmicks.includes(gimmick as GameSnapshot['seenGimmicks'][number]),
    )
  );
}

function attachConsoleGuards(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('startup, layout, mute, and debug surface are safe', async ({ page }) => {
  const errors = attachConsoleGuards(page);
  await page.addInitScript(() => localStorage.setItem('falppy.highScore', '9'));
  await page.goto('/?seed=startup');
  await expect(page.getByRole('heading', { name: 'Falppy Bird' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Run' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle mute' })).toBeVisible();
  await expect(page.locator('#high-score')).toHaveText('9');
  await page.getByRole('button', { name: 'Toggle mute' }).click();
  await expect(page.getByRole('button', { name: 'Toggle mute' })).toContainText('Muted');

  const debugKeys = await page.evaluate(() => Object.keys(window.falppyDebug).sort());
  expect(debugKeys).toEqual(['setSeed', 'snapshot']);
  const forbidden = ['grantScore', 'skipHazards', 'forceSurvival', 'disableCollision', 'autoPassPipes', 'teleportPlayer'];
  for (const key of forbidden) expect(debugKeys).not.toContain(key);

  const canvasBox = await page.locator('#game').boundingBox();
  expect(canvasBox?.width).toBeGreaterThan(240);
  expect(canvasBox?.height).toBeGreaterThan(360);
  expect(errors).toEqual([]);
});

test('mouse pointer and touch taps flap through the same active-play command path', async ({ page }, testInfo) => {
  const errors = attachConsoleGuards(page);
  await page.goto('/?seed=pointer-touch');
  await page.getByRole('button', { name: 'Start Run' }).click();
  await expect.poll(async () => (await snapshot(page)).phase).toBe('playing');

  const before = await snapshot(page);
  const box = await page.locator('#game').boundingBox();
  expect(box).not.toBeNull();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  if (testInfo.project.name === 'mobile-chrome') {
    await page.locator('#game').tap({ position: { x: x - (box?.x ?? 0), y: y - (box?.y ?? 0) } });
  } else {
    await page.locator('#game').click({ position: { x: x - (box?.x ?? 0), y: y - (box?.y ?? 0) } });
  }

  await expect.poll(async () => (await snapshot(page)).counters.inputEvents).toBeGreaterThan(before.counters.inputEvents);
  expect(errors).toEqual([]);
});

test('play loop reaches all five gimmicks, game over, and restart with real inputs', async ({ page }) => {
  const errors = attachConsoleGuards(page);
  await startSeededRun(page, 'e2e-all-gimmicks');
  const reached = await pilotUntil(page, reachedAllGimmicks, 18_000);
  expect(reached.score).toBeGreaterThanOrEqual(5);
  expect(reached.seenGimmicks).toEqual(expect.arrayContaining(['gravityFlip', 'movingPipe', 'sizeShift', 'speedRing', 'riskCoin']));
  expect(reached.counters.obstaclesPassed).toBeGreaterThanOrEqual(5);

  let gameOver = reached;
  if (reached.phase === 'playing') {
    await page.waitForTimeout(250);
    // Stop piloting to produce a real collision/game-over without debug shortcuts.
    await expect.poll(async () => {
      const state = await snapshot(page);
      if (state.phase === 'playing') await page.waitForTimeout(250);
      return state.phase;
    }, { timeout: 10_000 }).toBe('gameOver');
    gameOver = await snapshot(page);
  } else {
    expect(reached.phase).toBe('gameOver');
  }
  expect(['pipe', 'bounds']).toContain(gameOver.deathCause);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('playing');
  const restarted = await snapshot(page);
  expect(restarted.score).toBe(0);
  expect(restarted.counters.restarts).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('responsive mobile viewport remains playable and persistence works', async ({ page }) => {
  const errors = attachConsoleGuards(page);
  await page.setViewportSize({ width: 390, height: 720 });
  await startSeededRun(page, 'mobile');
  await pilotFor(page, 4_000);
  const duringPlay = await snapshot(page);
  expect(duringPlay.phase).toBe('playing');
  expect(duringPlay.counters.inputEvents).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Toggle mute' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Toggle mute' })).toContainText('Muted');
  await page.setViewportSize({ width: 812, height: 420 });
  const canvasBox = await page.locator('#game').boundingBox();
  expect(canvasBox?.width).toBeGreaterThan(240);
  expect(canvasBox?.height).toBeGreaterThan(300);
  expect(errors).toEqual([]);
});
