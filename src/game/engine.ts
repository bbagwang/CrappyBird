import { circleIntersectsCircle, circleIntersectsRect, clamp } from './collision';
import { SeededRng } from './rng';
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  type ActiveEffect,
  type CoinState,
  type Counters,
  type DeathCause,
  type GameSnapshot,
  type GimmickType,
  type ObstacleState,
  type Phase,
  type PlayerState,
  type StoragePort,
  type ZoneState,
} from './types';

const HIGH_SCORE_KEY = 'crappy.highScore';
const MUTED_KEY = 'crappy.muted';
const BASE_RADIUS = 14;
const PLAYER_X = 118;
const BASE_GRAVITY = 1380;
const GRAVITY_FLIP_DURATION = 2.35;
const GRAVITY_FLIP_STRENGTH_SCALE = 0.7;
const FLAP_VELOCITY = -410;
const MAX_FALL_SPEED = 560;
const BASE_SPEED = 132;
const SPEED_CAP = 220;
const BASE_GAP = 280;
const MIN_GAP = 220;
const PIPE_WIDTH = 68;
const TELEGRAPH_MIN_SECONDS = 1.2;
type PatternType = 'normal' | GimmickType;
const GIMMICK_SEQUENCE: readonly PatternType[] = [
  'normal',
  'movingPipe',
  'sizeShift',
  'gravityFlip',
  'slowMo',
  'shieldBubble',
  'speedRing',
  'windGust',
  'riskCoin',
  'movingPipe',
  'riskCoin',
];

export interface EngineOptions {
  storage: StoragePort;
  seed?: string;
}

export class GameEngine {
  private rng: SeededRng;
  private seed: string;
  private phase: Phase = 'start';
  private score = 0;
  private highScore = 0;
  private muted = false;
  private deathCause: DeathCause = 'none';
  private player: PlayerState = this.createPlayer();
  private obstacles: ObstacleState[] = [];
  private zones: ZoneState[] = [];
  private coins: CoinState[] = [];
  private activeEffects: ActiveEffect[] = [];
  private counters: Counters = this.createCounters();
  private spawnTimer = 0.75;
  private obstacleIndex = 0;
  private nextId = 1;
  private elapsedSeconds = 0;

  constructor(private readonly options: EngineOptions) {
    this.seed = options.seed ?? 'crappy-default';
    this.rng = new SeededRng(this.seed);
    this.highScore = this.options.storage.readNumber(HIGH_SCORE_KEY, 0);
    this.muted = this.options.storage.readBoolean(MUTED_KEY, false);
  }

  setSeed(seed: string): boolean {
    if (this.phase === 'playing') return false;
    this.seed = seed.trim() || 'crappy-default';
    this.rng = new SeededRng(this.seed);
    return true;
  }

  startRun(): void {
    this.phase = 'playing';
    this.score = 0;
    this.deathCause = 'none';
    this.player = this.createPlayer();
    this.obstacles = [];
    this.zones = [];
    this.coins = [];
    this.activeEffects = [];
    this.counters = this.createCounters(this.counters.restarts + 1);
    this.spawnTimer = 0.45;
    this.obstacleIndex = 0;
    this.nextId = 1;
    this.elapsedSeconds = 0;
    this.rng = new SeededRng(this.seed);
  }

  restart(): void {
    this.startRun();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.options.storage.writeBoolean(MUTED_KEY, this.muted);
    return this.muted;
  }

  flap(): void {
    if (this.phase === 'start') {
      this.startRun();
      return;
    }
    if (this.phase === 'gameOver') {
      this.restart();
      return;
    }
    this.counters.inputEvents += 1;
    const inverted = this.isGravityInverted();
    this.player.vy = inverted ? Math.abs(FLAP_VELOCITY) * GRAVITY_FLIP_STRENGTH_SCALE : FLAP_VELOCITY;
  }

  update(deltaSeconds: number): void {
    if (this.phase !== 'playing') return;
    const dt = clamp(deltaSeconds, 0, 0.05);
    this.elapsedSeconds += dt;
    this.counters.frames += 1;
    this.counters.elapsedMs = Math.round(this.elapsedSeconds * 1000);

    this.updateEffects(dt);
    this.updatePlayer(dt);
    this.updateSpawning(dt);
    this.updateObjects(dt);
    this.applyZoneInteractions();
    this.applyCoinInteractions();
    this.applyScoring();
    this.applyCollisions();
  }

  getSnapshot(): GameSnapshot {
    const activeGimmicks = this.activeEffects.map((effect) => effect.type);
    const seenGimmicks = this.getSeenGimmicks();
    const nextObstacle = this.obstacles.find((obstacle) => obstacle.x + obstacle.width >= this.player.x - 10) ?? null;
    const snapshot: GameSnapshot = {
      phase: this.phase,
      seed: this.seed,
      score: this.score,
      highScore: this.highScore,
      muted: this.muted,
      deathCause: this.deathCause,
      player: { ...this.player },
      activeGimmick: activeGimmicks[0] ?? null,
      activeGimmicks,
      seenGimmicks,
      counters: { ...this.counters },
      difficulty: {
        speed: this.currentSpeed(),
        spawnEvery: this.spawnEvery(),
        gapHeight: this.currentGapHeight(),
        telegraphMinSeconds: TELEGRAPH_MIN_SECONDS,
      },
      nextObstacle: nextObstacle
        ? {
            id: nextObstacle.id,
            x: nextObstacle.x,
            gapY: nextObstacle.gapY,
            gapHeight: nextObstacle.gapHeight,
            width: nextObstacle.width,
            moving: nextObstacle.moving,
          }
        : null,
      obstacles: this.obstacles.map((obstacle) => ({ ...obstacle })),
      zones: this.zones.map((zone) => ({ ...zone })),
      coins: this.coins.map((coin) => ({ ...coin })),
    };
    return deepFreeze(snapshot);
  }

  private createPlayer(): PlayerState {
    return {
      x: PLAYER_X,
      y: FIELD_HEIGHT / 2,
      vy: 0,
      radius: BASE_RADIUS,
      gravityInverted: false,
      sizeScale: 1,
    };
  }

  private createCounters(restarts = 0): Counters {
    return {
      frames: 0,
      elapsedMs: 0,
      obstaclesSpawned: 0,
      obstaclesPassed: 0,
      coinsSpawned: 0,
      coinsCollected: 0,
      restarts,
      inputEvents: 0,
      gravityFlipSeen: 0,
      movingPipeSeen: 0,
      sizeShiftSeen: 0,
      speedRingSeen: 0,
      riskCoinSeen: 0,
      slowMoSeen: 0,
      shieldBubbleSeen: 0,
      windGustSeen: 0,
    };
  }

  private updateEffects(dt: number): void {
    for (const effect of this.activeEffects) {
      effect.remaining -= dt;
    }
    this.activeEffects = this.activeEffects.filter((effect) => effect.remaining > 0);
    this.player.gravityInverted = this.isGravityInverted();
    this.player.sizeScale = this.hasEffect('sizeShift') ? 0.72 : 1;
    this.player.radius = BASE_RADIUS * this.player.sizeScale;
  }

  private updatePlayer(dt: number): void {
    const gravityDirection = this.isGravityInverted() ? -1 : 1;
    const gravityScale = this.isGravityInverted() ? GRAVITY_FLIP_STRENGTH_SCALE : 1;
    this.player.vy += BASE_GRAVITY * gravityScale * gravityDirection * dt;
    if (this.hasEffect('windGust')) {
      this.player.vy += Math.sin(this.elapsedSeconds * 9.2) * 300 * dt;
    }
    this.player.vy = clamp(this.player.vy, -MAX_FALL_SPEED, MAX_FALL_SPEED);
    this.player.y += this.player.vy * dt;
  }

  private updateSpawning(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnPattern();
      this.spawnTimer += this.spawnEvery();
    }
  }

  private updateObjects(dt: number): void {
    const speed = this.currentSpeed();
    for (const obstacle of this.obstacles) {
      obstacle.x -= speed * dt;
      if (obstacle.moving) {
        obstacle.gapY = clamp(
          obstacle.baseGapY + Math.sin(this.elapsedSeconds * obstacle.frequency + obstacle.id) * obstacle.amplitude,
          145,
          FIELD_HEIGHT - 145,
        );
      }
    }
    for (const zone of this.zones) {
      zone.x -= speed * dt;
    }
    for (const coin of this.coins) {
      coin.x -= speed * dt;
    }

    this.obstacles = this.obstacles.filter((obstacle) => obstacle.x + obstacle.width > -40);
    this.zones = this.zones.filter((zone) => zone.x + zone.width > -40);
    this.coins = this.coins.filter((coin) => coin.x + coin.radius > -40);
  }

  private spawnPattern(): void {
    const pattern = GIMMICK_SEQUENCE[this.obstacleIndex % GIMMICK_SEQUENCE.length];
    const gapHeight = this.currentGapHeight();
    const safeGapEdge = Math.max(190, gapHeight / 2 + 58);
    const gapY = this.rng.range(safeGapEdge, FIELD_HEIGHT - safeGapEdge);
    const obstacle: ObstacleState = {
      id: this.nextId++,
      x: FIELD_WIDTH + 60,
      width: PIPE_WIDTH,
      gapY,
      baseGapY: gapY,
      gapHeight,
      passed: false,
      moving: pattern === 'movingPipe',
      amplitude: pattern === 'movingPipe' ? 24 : 0,
      frequency: pattern === 'movingPipe' ? 1.25 : 0,
      telegraph: pattern !== 'normal',
    };
    this.obstacles.push(obstacle);
    this.counters.obstaclesSpawned += 1;

    if (pattern === 'movingPipe') this.counters.movingPipeSeen += 1;
    if (pattern === 'gravityFlip') this.spawnZone('gravityFlip', obstacle.x - 96, FIELD_HEIGHT / 2, 54, FIELD_HEIGHT);
    if (pattern === 'sizeShift') this.spawnZone('sizeShift', obstacle.x - 92, gapY, 58, gapHeight + 42);
    if (pattern === 'speedRing') this.spawnZone('speedRing', obstacle.x - 92, gapY, 62, gapHeight + 18);
    if (pattern === 'riskCoin') this.spawnRiskCoin(obstacle.x + obstacle.width / 2, this.riskCoinY(gapY, gapHeight));
    if (pattern === 'slowMo') this.spawnZone('slowMo', obstacle.x - 92, gapY, 64, gapHeight + 60);
    if (pattern === 'shieldBubble') this.spawnZone('shieldBubble', obstacle.x - 98, gapY, 62, 112);
    if (pattern === 'windGust') this.spawnZone('windGust', obstacle.x - 92, FIELD_HEIGHT / 2, 58, FIELD_HEIGHT);

    this.obstacleIndex += 1;
  }

  private spawnZone(type: ZoneState['type'], x: number, y: number, width: number, height: number): void {
    this.zones.push({
      id: this.nextId++,
      type,
      x,
      y,
      width,
      height,
      used: false,
      warning: true,
    });
  }

  private spawnRiskCoin(x: number, y: number): void {
    this.coins.push({ id: this.nextId++, x, y, radius: 13, value: 3, collected: false });
    this.counters.coinsSpawned += 1;
    this.counters.riskCoinSeen += 1;
  }

  private riskCoinY(gapY: number, gapHeight: number): number {
    const offset = this.rng.pick([-1, 1]) * Math.max(42, gapHeight * 0.28);
    return clamp(gapY + offset, 70, FIELD_HEIGHT - 70);
  }

  private applyZoneInteractions(): void {
    for (const zone of this.zones) {
      if (zone.used) continue;
      const overlapsX = this.player.x + this.player.radius >= zone.x && this.player.x - this.player.radius <= zone.x + zone.width;
      const overlapsY = this.player.y + this.player.radius >= zone.y - zone.height / 2 && this.player.y - this.player.radius <= zone.y + zone.height / 2;
      if (!overlapsX || !overlapsY) continue;
      zone.used = true;
      if (zone.type === 'gravityFlip') {
        this.addOrRefreshEffect('gravityFlip', GRAVITY_FLIP_DURATION);
        this.counters.gravityFlipSeen += 1;
      }
      if (zone.type === 'sizeShift') {
        this.addOrRefreshEffect('sizeShift', 3.8);
        this.counters.sizeShiftSeen += 1;
      }
      if (zone.type === 'speedRing') {
        this.addOrRefreshEffect('speedRing', 2.4);
        this.counters.speedRingSeen += 1;
      }
      if (zone.type === 'slowMo') {
        this.addOrRefreshEffect('slowMo', 3.2);
        this.counters.slowMoSeen += 1;
      }
      if (zone.type === 'shieldBubble') {
        this.addOrRefreshEffect('shieldBubble', 5.5);
        this.counters.shieldBubbleSeen += 1;
      }
      if (zone.type === 'windGust') {
        this.addOrRefreshEffect('windGust', 3.0);
        this.counters.windGustSeen += 1;
      }
    }
  }

  private applyCoinInteractions(): void {
    for (const coin of this.coins) {
      if (coin.collected) continue;
      if (circleIntersectsCircle({ x: this.player.x, y: this.player.y, radius: this.player.radius }, coin)) {
        coin.collected = true;
        this.score += coin.value;
        this.counters.coinsCollected += 1;
      }
    }
  }

  private applyScoring(): void {
    for (const obstacle of this.obstacles) {
      if (!obstacle.passed && obstacle.x + obstacle.width < this.player.x - this.player.radius) {
        obstacle.passed = true;
        this.score += 1;
        this.counters.obstaclesPassed += 1;
      }
    }
  }

  private applyCollisions(): void {
    if (this.player.y - this.player.radius < 0 || this.player.y + this.player.radius > FIELD_HEIGHT) {
      if (this.consumeShield()) {
        this.player.y = clamp(this.player.y, this.player.radius + 2, FIELD_HEIGHT - this.player.radius - 2);
        this.player.vy = this.player.y < FIELD_HEIGHT / 2 ? Math.abs(this.player.vy) * 0.25 : -Math.abs(this.player.vy) * 0.25;
        return;
      }
      this.endRun('bounds');
      return;
    }

    const playerCircle = { x: this.player.x, y: this.player.y, radius: this.player.radius };
    for (const obstacle of this.obstacles) {
      if (obstacle.passed) continue;
      const gapTop = obstacle.gapY - obstacle.gapHeight / 2;
      const gapBottom = obstacle.gapY + obstacle.gapHeight / 2;
      const topRect = { x: obstacle.x, y: 0, width: obstacle.width, height: gapTop };
      const bottomRect = { x: obstacle.x, y: gapBottom, width: obstacle.width, height: FIELD_HEIGHT - gapBottom };
      if (circleIntersectsRect(playerCircle, topRect) || circleIntersectsRect(playerCircle, bottomRect)) {
        if (this.consumeShield()) {
          obstacle.passed = true;
          this.score += 1;
          this.counters.obstaclesPassed += 1;
          return;
        }
        this.endRun('pipe');
        return;
      }
    }
  }

  private endRun(cause: DeathCause): void {
    this.phase = 'gameOver';
    this.deathCause = cause;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.options.storage.writeNumber(HIGH_SCORE_KEY, this.highScore);
    }
  }

  private addOrRefreshEffect(type: ActiveEffect['type'], remaining: number): void {
    const existing = this.activeEffects.find((effect) => effect.type === type);
    if (existing) {
      existing.remaining = Math.max(existing.remaining, remaining);
    } else {
      this.activeEffects.push({ type, remaining });
    }
  }

  private isGravityInverted(): boolean {
    return this.hasEffect('gravityFlip');
  }

  private hasEffect(type: ActiveEffect['type']): boolean {
    return this.activeEffects.some((effect) => effect.type === type && effect.remaining > 0);
  }

  private consumeShield(): boolean {
    const shieldIndex = this.activeEffects.findIndex((effect) => effect.type === 'shieldBubble' && effect.remaining > 0);
    if (shieldIndex < 0) return false;
    this.activeEffects.splice(shieldIndex, 1);
    return true;
  }

  private currentSpeed(): number {
    const ramp = BASE_SPEED + this.score * 4.5 + this.elapsedSeconds * 1.6;
    let speed = Math.min(SPEED_CAP, ramp);
    if (this.hasEffect('speedRing')) speed = Math.min(SPEED_CAP + 16, speed * 1.08);
    if (this.hasEffect('slowMo')) speed *= 0.68;
    return speed;
  }

  private spawnEvery(): number {
    return clamp(1.5 - this.score * 0.008 - this.elapsedSeconds * 0.0015, 1.12, 1.5);
  }

  private currentGapHeight(): number {
    return Math.max(MIN_GAP, BASE_GAP - this.score * 2.2 - this.elapsedSeconds * 0.45);
  }

  private getSeenGimmicks(): GimmickType[] {
    const seen: GimmickType[] = [];
    if (this.counters.gravityFlipSeen > 0) seen.push('gravityFlip');
    if (this.counters.movingPipeSeen > 0) seen.push('movingPipe');
    if (this.counters.sizeShiftSeen > 0) seen.push('sizeShift');
    if (this.counters.speedRingSeen > 0) seen.push('speedRing');
    if (this.counters.riskCoinSeen > 0) seen.push('riskCoin');
    if (this.counters.slowMoSeen > 0) seen.push('slowMo');
    if (this.counters.shieldBubbleSeen > 0) seen.push('shieldBubble');
    if (this.counters.windGustSeen > 0) seen.push('windGust');
    return seen;
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (nested && typeof nested === 'object') {
        deepFreeze(nested);
      }
    }
  }
  return value;
}
