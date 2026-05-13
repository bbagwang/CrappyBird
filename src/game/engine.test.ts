import { describe, expect, it } from 'vitest';
import { circleIntersectsRect } from './collision';
import { GameEngine } from './engine';
import { MemoryStorage } from './storage';
import type { GameSnapshot } from './types';

function makeEngine(seed = 'unit-seed'): GameEngine {
  return new GameEngine({ storage: new MemoryStorage(), seed });
}

function step(engine: GameEngine, seconds: number, pilot = false): GameSnapshot {
  const dt = 1 / 60;
  const iterations = Math.ceil(seconds / dt);
  for (let index = 0; index < iterations; index += 1) {
    if (pilot) pilotInput(engine);
    engine.update(dt);
    if (engine.getSnapshot().phase === 'gameOver') break;
  }
  return engine.getSnapshot();
}

function stepUntil(engine: GameEngine, accept: (snapshot: GameSnapshot) => boolean, maxSeconds: number): GameSnapshot {
  const dt = 1 / 60;
  const iterations = Math.ceil(maxSeconds / dt);
  for (let index = 0; index < iterations; index += 1) {
    pilotInput(engine);
    engine.update(dt);
    const snapshot = engine.getSnapshot();
    if (accept(snapshot) || snapshot.phase === 'gameOver') return snapshot;
  }
  return engine.getSnapshot();
}

function reachedAllGimmicks(snapshot: GameSnapshot): boolean {
  return ['gravityFlip', 'movingPipe', 'sizeShift', 'speedRing', 'riskCoin', 'slowMo', 'shieldBubble', 'windGust'].every((gimmick) =>
    snapshot.seenGimmicks.includes(gimmick as GameSnapshot['seenGimmicks'][number]),
  );
}

function includesActive(snapshot: GameSnapshot, gimmick: GameSnapshot['activeGimmicks'][number]): boolean {
  return snapshot.activeGimmicks.includes(gimmick);
}

function pilotInput(engine: GameEngine): void {
  const snapshot = engine.getSnapshot();
  if (snapshot.phase !== 'playing') return;
  const upcoming = snapshot.nextObstacle;
  const target = upcoming && upcoming.x < snapshot.player.x + 340 ? upcoming.gapY : 360;
  const predictedY = snapshot.player.y + snapshot.player.vy * 0.15;
  const margin = upcoming?.moving ? 40 : 48;
  if (!snapshot.player.gravityInverted && (predictedY > target + margin || snapshot.player.y > 585)) engine.flap();
  if (snapshot.player.gravityInverted && (predictedY < target - margin || snapshot.player.y < 135)) engine.flap();
}

describe('GameEngine core state', () => {
  it('starts on the start screen and loads stored high score and mute', () => {
    const storage = new MemoryStorage();
    storage.writeNumber('crappy.highScore', 12);
    storage.writeBoolean('crappy.muted', true);
    const engine = new GameEngine({ storage, seed: 'initial' });
    const snapshot = engine.getSnapshot();
    expect(snapshot.phase).toBe('start');
    expect(snapshot.score).toBe(0);
    expect(snapshot.highScore).toBe(12);
    expect(snapshot.muted).toBe(true);
    expect(snapshot.deathCause).toBe('none');
  });

  it('starts, game-overs, and restarts into clean run-local state', () => {
    const engine = makeEngine('restart');
    engine.startRun();
    step(engine, 1.2, true);
    expect(engine.getSnapshot().phase).toBe('playing');
    step(engine, 6, false);
    expect(engine.getSnapshot().phase).toBe('gameOver');
    engine.restart();
    const restarted = engine.getSnapshot();
    expect(restarted.phase).toBe('playing');
    expect(restarted.score).toBe(0);
    expect(restarted.deathCause).toBe('none');
    expect(restarted.obstacles.length).toBe(0);
    expect(restarted.counters.restarts).toBe(2);
  });

  it('handles storage failures without crashing gameplay', () => {
    const engine = new GameEngine({ storage: new MemoryStorage(true), seed: 'storage-fails' });
    engine.startRun();
    step(engine, 0.5, true);
    expect(engine.getSnapshot().phase).toBe('playing');
    expect(() => engine.toggleMute()).not.toThrow();
    step(engine, 7, false);
    expect(engine.getSnapshot().phase).toBe('gameOver');
  });
});

describe('physics, collision, and scoring', () => {
  it('flap impulse moves upward under normal gravity and downward under inverted gravity', () => {
    const engine = makeEngine('flap');
    engine.startRun();
    engine.flap();
    expect(engine.getSnapshot().player.vy).toBeLessThan(0);
    step(engine, 7.2, true);
    expect(engine.getSnapshot().seenGimmicks).toContain('gravityFlip');
    engine.flap();
    expect(engine.getSnapshot().player.vy).toBeGreaterThan(0);
    expect(engine.getSnapshot().player.vy).toBeLessThan(300);
  });

  it('gravity flip keeps its duration but reduces inverted force by 30%', () => {
    const engine = makeEngine('gravity-readable');
    engine.startRun();
    const flipped = step(engine, 7.1, true);
    expect(flipped.phase).toBe('playing');
    expect(flipped.activeGimmicks).toContain('gravityFlip');
    expect(Math.abs(flipped.player.vy)).toBeLessThan(300);

    engine.flap();
    const afterInvertedFlap = engine.getSnapshot();
    expect(afterInvertedFlap.player.vy).toBeCloseTo(287, 0);

    const stillFlipped = step(engine, 1.4, true);
    expect(stillFlipped.activeGimmicks).toContain('gravityFlip');
  });

  it('circle/rect collision covers hit, near-miss, and edge contact deterministically', () => {
    expect(circleIntersectsRect({ x: 10, y: 10, radius: 5 }, { x: 12, y: 8, width: 20, height: 10 })).toBe(true);
    expect(circleIntersectsRect({ x: 0, y: 0, radius: 4 }, { x: 10, y: 10, width: 6, height: 6 })).toBe(false);
    expect(circleIntersectsRect({ x: 5, y: 5, radius: 5 }, { x: 10, y: 5, width: 8, height: 8 })).toBe(true);
  });

  it('scores obstacle passes and risk coins exactly once', () => {
    const engine = makeEngine('score-risk');
    engine.startRun();
    const snapshot = step(engine, 11.5, true);
    expect(snapshot.score).toBeGreaterThanOrEqual(5);
    expect(snapshot.counters.obstaclesPassed).toBeGreaterThanOrEqual(4);
    expect(snapshot.counters.coinsCollected).toBeLessThanOrEqual(snapshot.counters.coinsSpawned);
  });

  it('persists high score after a scored game over and reloads it', () => {
    const storage = new MemoryStorage();
    const engine = new GameEngine({ storage, seed: 'persist-high-score' });
    engine.startRun();
    const piloted = step(engine, 9, true);
    expect(piloted.score).toBeGreaterThan(0);
    const gameOver = step(engine, 7, false);
    expect(gameOver.phase).toBe('gameOver');
    expect(gameOver.highScore).toBe(gameOver.score);
    const reloaded = new GameEngine({ storage, seed: 'reload-high-score' });
    expect(reloaded.getSnapshot().highScore).toBe(gameOver.score);
  });
});

describe('deterministic seed, observability, and gimmicks', () => {
  it('same seed and same input policy produce the same schedule and outcome', () => {
    const a = makeEngine('same-seed');
    const b = makeEngine('same-seed');
    a.startRun();
    b.startRun();
    const aSnapshot = step(a, 9, true);
    const bSnapshot = step(b, 9, true);
    expect(aSnapshot.score).toBe(bSnapshot.score);
    expect(aSnapshot.seenGimmicks).toEqual(bSnapshot.seenGimmicks);
    expect(aSnapshot.counters.obstaclesSpawned).toBe(bSnapshot.counters.obstaclesSpawned);
    expect(aSnapshot.deathCause).toBe(bSnapshot.deathCause);
  });

  it('allows seed selection before a run but rejects active-run seed changes', () => {
    const engine = makeEngine('seed-before');
    expect(engine.setSeed('seed-after')).toBe(true);
    engine.startRun();
    expect(engine.getSnapshot().seed).toBe('seed-after');
    expect(engine.setSeed('forbidden-active-change')).toBe(false);
    expect(engine.getSnapshot().seed).toBe('seed-after');
    const snapshot = step(engine, 2, true);
    expect(snapshot.seed).toBe('seed-after');
    expect(snapshot.phase).toBe('playing');
  });

  it('different seeds can change schedules without changing collision or scoring rules', () => {
    const a = makeEngine('seed-a');
    const b = makeEngine('seed-b');
    a.startRun();
    b.startRun();
    const aSnapshot = step(a, 3.2, true);
    const bSnapshot = step(b, 3.2, true);
    expect(aSnapshot.difficulty.telegraphMinSeconds).toBe(bSnapshot.difficulty.telegraphMinSeconds);
    expect(aSnapshot.obstacles[0]?.width).toBe(bSnapshot.obstacles[0]?.width);
    expect(aSnapshot.nextObstacle?.gapY).not.toBe(bSnapshot.nextObstacle?.gapY);
  });

  it('reaches all eight selected gimmicks under a deterministic playable run', () => {
    const engine = makeEngine('e2e-all-gimmicks');
    engine.startRun();
    const snapshot = stepUntil(engine, reachedAllGimmicks, 28);
    expect(snapshot.phase).toBe('playing');
    expect(snapshot.seenGimmicks).toEqual(expect.arrayContaining(['gravityFlip', 'movingPipe', 'sizeShift', 'speedRing', 'riskCoin', 'slowMo', 'shieldBubble', 'windGust']));
    expect(snapshot.counters.gravityFlipSeen).toBeGreaterThan(0);
    expect(snapshot.counters.movingPipeSeen).toBeGreaterThan(0);
    expect(snapshot.counters.sizeShiftSeen).toBeGreaterThan(0);
    expect(snapshot.counters.speedRingSeen).toBeGreaterThan(0);
    expect(snapshot.counters.riskCoinSeen).toBeGreaterThan(0);
    expect(snapshot.counters.slowMoSeen).toBeGreaterThan(0);
    expect(snapshot.counters.shieldBubbleSeen).toBeGreaterThan(0);
    expect(snapshot.counters.windGustSeen).toBeGreaterThan(0);
  });

  it('new support gimmicks activate through normal play and expose readable effects', () => {
    const slowEngine = makeEngine('e2e-all-gimmicks');
    slowEngine.startRun();
    const slowed = stepUntil(slowEngine, (snapshot) => includesActive(snapshot, 'slowMo'), 20);
    expect(slowed.phase).toBe('playing');
    expect(slowed.activeGimmicks).toContain('slowMo');
    expect(slowed.difficulty.speed).toBeLessThan(150);

    const shieldEngine = makeEngine('e2e-all-gimmicks');
    shieldEngine.startRun();
    const shielded = stepUntil(shieldEngine, (snapshot) => includesActive(snapshot, 'shieldBubble'), 22);
    expect(shielded.phase).toBe('playing');
    expect(shielded.activeGimmicks).toContain('shieldBubble');
    expect(shielded.counters.shieldBubbleSeen).toBeGreaterThan(0);

    const windEngine = makeEngine('e2e-all-gimmicks');
    windEngine.startRun();
    const gusting = stepUntil(windEngine, (snapshot) => includesActive(snapshot, 'windGust'), 24);
    expect(gusting.phase).toBe('playing');
    expect(gusting.activeGimmicks).toContain('windGust');
    expect(Math.abs(gusting.player.vy)).toBeLessThanOrEqual(560);
  });

  it('observability snapshot contains required fields and is read-only', () => {
    const engine = makeEngine('snapshot');
    engine.startRun();
    step(engine, 1, true);
    const snapshot = engine.getSnapshot();
    expect(snapshot).toHaveProperty('phase');
    expect(snapshot).toHaveProperty('score');
    expect(snapshot).toHaveProperty('activeGimmick');
    expect(snapshot).toHaveProperty('activeGimmicks');
    expect(snapshot).toHaveProperty('deathCause');
    expect(snapshot.counters).toHaveProperty('obstaclesSpawned');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.counters)).toBe(true);
    expect(() => {
      (snapshot as unknown as { score: number }).score = 999;
    }).toThrow(TypeError);
    expect(engine.getSnapshot().score).not.toBe(999);
  });

  it('debug-like engine surface does not expose gameplay shortcut commands', () => {
    const publicMethods = Object.getOwnPropertyNames(GameEngine.prototype);
    expect(publicMethods).not.toEqual(expect.arrayContaining(['grantScore', 'skipHazards', 'forceSurvival', 'disableCollision', 'autoPassPipes', 'teleportPlayer']));
  });
});
