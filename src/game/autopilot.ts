import { clamp } from './collision';
import { FIELD_HEIGHT, type GameSnapshot } from './types';

export type AutopilotAction = 'flap' | 'none';

export interface AutopilotOptions {
  minFlapIntervalMs?: number;
  predictionSeconds?: number;
}

const DEFAULT_MIN_FLAP_INTERVAL_MS = 48;
const DEFAULT_PREDICTION_SECONDS = 0.2;
const BASE_GRAVITY = 1380;
const GRAVITY_FLIP_STRENGTH_SCALE = 0.7;
const FLAP_VELOCITY = -410;
const MAX_FALL_SPEED = 560;
const FIELD_CENTER_Y = FIELD_HEIGHT / 2;
const MIN_OBSTACLE_HORIZON_SECONDS = 0.08;
const MAX_OBSTACLE_HORIZON_SECONDS = 0.72;
const CURRENT_EXIT_LOOKAHEAD_SECONDS = 0.16;
const NEXT_GAP_PREPARE_DISTANCE = 300;
const LOWER_NEXT_GAP_THRESHOLD = 120;
const GAP_CLEARANCE = 14;
const MOVING_PIPE_CLEARANCE = 10;
const CENTER_TRACKING_MARGIN = 42;
const EDGE_PANIC_MARGIN = 110;
const CORRIDOR_EDGE_GUARD = 36;
const NORMAL_CORRECTION_VELOCITY_LIMIT = 240;
const INVERTED_CORRECTION_VELOCITY_LIMIT = 520;
const TRAJECTORY_STEP_SECONDS = 1 / 60;
const WIND_ACCELERATION = 300;

export class AutopilotController {
  private lastFlapAtMs = Number.NEGATIVE_INFINITY;
  private readonly minFlapIntervalMs: number;
  private readonly predictionSeconds: number;

  constructor(options: AutopilotOptions = {}) {
    this.minFlapIntervalMs = options.minFlapIntervalMs ?? DEFAULT_MIN_FLAP_INTERVAL_MS;
    this.predictionSeconds = options.predictionSeconds ?? DEFAULT_PREDICTION_SECONDS;
  }

  reset(): void {
    this.lastFlapAtMs = Number.NEGATIVE_INFINITY;
  }

  nextAction(snapshot: GameSnapshot): AutopilotAction {
    if (snapshot.phase === 'start' || snapshot.phase === 'gameOver') {
      this.reset();
      return 'flap';
    }

    if (snapshot.phase !== 'playing') return 'none';
    if (snapshot.counters.elapsedMs - this.lastFlapAtMs < this.minFlapIntervalMs) return 'none';
    if (!shouldAutopilotFlap(snapshot, this.predictionSeconds)) return 'none';

    this.lastFlapAtMs = snapshot.counters.elapsedMs;
    return 'flap';
  }
}

export function shouldAutopilotFlap(snapshot: GameSnapshot, predictionSeconds = DEFAULT_PREDICTION_SECONDS): boolean {
  if (snapshot.phase !== 'playing') return false;

  const obstacle = findControlObstacle(snapshot);
  if (!obstacle) return shouldFlapTowardCenter(snapshot, predictionSeconds);

  return shouldFlapThroughObstacle(snapshot, obstacle);
}

type SnapshotObstacle = GameSnapshot['obstacles'][number];

function findControlObstacle(snapshot: GameSnapshot): SnapshotObstacle | null {
  const player = snapshot.player;
  const collisionTailX = player.x - player.radius;
  const futureObstacles = snapshot.obstacles
    .filter((obstacle) => !obstacle.passed && obstacle.x + obstacle.width >= collisionTailX)
    .sort((a, b) => a.x - b.x);

  if (futureObstacles.length === 0) return null;

  const current = futureObstacles[0];
  const next = futureObstacles[1];
  if (next && current.x + current.width < player.x && staysInsideCurrentGap(snapshot, current)) {
    return next;
  }

  return futureObstacles[0];
}

function staysInsideCurrentGap(snapshot: GameSnapshot, obstacle: SnapshotObstacle): boolean {
  const safeRange = getSafeRange(snapshot, obstacle);
  const projectedY = projectY(snapshot, CURRENT_EXIT_LOOKAHEAD_SECONDS, false);
  return projectedY > safeRange.top + CORRIDOR_EDGE_GUARD && projectedY < safeRange.bottom - CORRIDOR_EDGE_GUARD;
}

function shouldFlapTowardCenter(snapshot: GameSnapshot, predictionSeconds: number): boolean {
  const projectedY = projectY(snapshot, predictionSeconds, false);
  const tooLow = projectedY > FIELD_CENTER_Y + CENTER_TRACKING_MARGIN || snapshot.player.y > FIELD_HEIGHT - EDGE_PANIC_MARGIN;
  const tooHigh = projectedY < FIELD_CENTER_Y - CENTER_TRACKING_MARGIN || snapshot.player.y < EDGE_PANIC_MARGIN;
  return snapshot.player.gravityInverted
    ? tooHigh && snapshot.player.vy < NORMAL_CORRECTION_VELOCITY_LIMIT
    : tooLow && snapshot.player.vy > -NORMAL_CORRECTION_VELOCITY_LIMIT;
}

function shouldFlapThroughObstacle(snapshot: GameSnapshot, obstacle: SnapshotObstacle): boolean {
  const safeRange = getSafeRange(snapshot, obstacle);
  const horizonSeconds = getObstacleHorizonSeconds(snapshot, obstacle);
  const entrySeconds = getObstacleEntrySeconds(snapshot, obstacle);
  const soonSeconds = Math.min(horizonSeconds, 0.3);
  const noFlapY = projectY(snapshot, horizonSeconds, false);
  const flapY = projectY(snapshot, horizonSeconds, true);
  const noFlapEntryY = projectY(snapshot, entrySeconds, false);
  const flapEntryY = projectY(snapshot, entrySeconds, true);
  const noFlapSoonY = projectY(snapshot, soonSeconds, false);

  if (snapshot.player.gravityInverted) {
    if (snapshot.player.y > safeRange.bottom - CORRIDOR_EDGE_GUARD) return false;
    if (noFlapEntryY > safeRange.bottom) return false;

    const topPanic = snapshot.player.y < EDGE_PANIC_MARGIN || noFlapSoonY < snapshot.player.radius + GAP_CLEARANCE;
    const missedTop = noFlapY < safeRange.top;
    const flapStillSafe = flapY < safeRange.bottom - GAP_CLEARANCE && flapEntryY < safeRange.bottom - GAP_CLEARANCE;
    const needsDownwardCorrection = snapshot.player.y < obstacle.gapY - CENTER_TRACKING_MARGIN;
    return topPanic || (needsDownwardCorrection && snapshot.player.vy < INVERTED_CORRECTION_VELOCITY_LIMIT && missedTop && flapStillSafe);
  }

  if (snapshot.player.y < safeRange.top + CORRIDOR_EDGE_GUARD) return false;
  if (noFlapEntryY < safeRange.top) return false;

  const bottomPanic = snapshot.player.y > FIELD_HEIGHT - EDGE_PANIC_MARGIN || noFlapSoonY > FIELD_HEIGHT - snapshot.player.radius - GAP_CLEARANCE;
  const missedBottom = noFlapY > safeRange.bottom;
  const flapStillSafe = flapY > safeRange.top + GAP_CLEARANCE && flapEntryY > safeRange.top + GAP_CLEARANCE;
  const needsUpwardCorrection = snapshot.player.y > obstacle.gapY - CENTER_TRACKING_MARGIN;
  if (!bottomPanic && shouldPreserveDescentForNextObstacle(snapshot, obstacle, safeRange)) return false;

  return bottomPanic || (needsUpwardCorrection && snapshot.player.vy > -NORMAL_CORRECTION_VELOCITY_LIMIT && missedBottom && flapStillSafe);
}

function shouldPreserveDescentForNextObstacle(snapshot: GameSnapshot, obstacle: SnapshotObstacle, safeRange: { top: number; bottom: number }): boolean {
  if (snapshot.player.gravityInverted) return false;
  if (snapshot.player.y <= safeRange.top + CORRIDOR_EDGE_GUARD || snapshot.player.y >= safeRange.bottom - CORRIDOR_EDGE_GUARD) return false;
  if (obstacle.x + obstacle.width > snapshot.player.x + snapshot.player.radius + NEXT_GAP_PREPARE_DISTANCE) return false;

  const nextObstacle = snapshot.obstacles
    .filter((candidate) => !candidate.passed && candidate.id !== obstacle.id && candidate.x > obstacle.x)
    .sort((a, b) => a.x - b.x)[0];
  if (!nextObstacle) return false;

  const nextGapIsLower = nextObstacle.gapY > obstacle.gapY + LOWER_NEXT_GAP_THRESHOLD;
  const gravityFlipAhead = snapshot.zones.some((zone) => zone.type === 'gravityFlip' && zone.x < nextObstacle.x && zone.x + zone.width > snapshot.player.x - snapshot.player.radius);
  return nextGapIsLower || gravityFlipAhead;
}

function getSafeRange(snapshot: GameSnapshot, obstacle: SnapshotObstacle): { top: number; bottom: number } {
  const clearance = GAP_CLEARANCE + (obstacle.moving ? MOVING_PIPE_CLEARANCE : 0);
  const top = obstacle.gapY - obstacle.gapHeight / 2 + snapshot.player.radius + clearance;
  const bottom = obstacle.gapY + obstacle.gapHeight / 2 - snapshot.player.radius - clearance;

  if (top > bottom) {
    return { top: obstacle.gapY, bottom: obstacle.gapY };
  }

  return { top, bottom };
}

function getObstacleHorizonSeconds(snapshot: GameSnapshot, obstacle: SnapshotObstacle): number {
  const speed = Math.max(snapshot.difficulty.speed, 1);
  const obstacleCenterX = obstacle.x + obstacle.width * 0.5;
  const distance = obstacleCenterX - snapshot.player.x;
  return clamp(distance / speed, MIN_OBSTACLE_HORIZON_SECONDS, MAX_OBSTACLE_HORIZON_SECONDS);
}

function getObstacleEntrySeconds(snapshot: GameSnapshot, obstacle: SnapshotObstacle): number {
  const speed = Math.max(snapshot.difficulty.speed, 1);
  const distance = obstacle.x - (snapshot.player.x + snapshot.player.radius);
  return clamp(distance / speed, 0, MAX_OBSTACLE_HORIZON_SECONDS);
}

function projectY(snapshot: GameSnapshot, seconds: number, withImmediateFlap: boolean): number {
  let y = snapshot.player.y;
  let vy = withImmediateFlap ? getFlapVelocity(snapshot) : snapshot.player.vy;
  let elapsedSeconds = snapshot.counters.elapsedMs / 1000;
  let remainingSeconds = Math.max(0, seconds);

  while (remainingSeconds > 0) {
    const dt = Math.min(TRAJECTORY_STEP_SECONDS, remainingSeconds);
    const windAcceleration = snapshot.activeGimmicks.includes('windGust') ? Math.sin(elapsedSeconds * 9.2) * WIND_ACCELERATION : 0;
    vy = clamp(vy + (getGravityAcceleration(snapshot) + windAcceleration) * dt, -MAX_FALL_SPEED, MAX_FALL_SPEED);
    y += vy * dt;
    elapsedSeconds += dt;
    remainingSeconds -= dt;
  }

  return y;
}

function getGravityAcceleration(snapshot: GameSnapshot): number {
  return snapshot.player.gravityInverted ? -BASE_GRAVITY * GRAVITY_FLIP_STRENGTH_SCALE : BASE_GRAVITY;
}

function getFlapVelocity(snapshot: GameSnapshot): number {
  return snapshot.player.gravityInverted ? Math.abs(FLAP_VELOCITY) * GRAVITY_FLIP_STRENGTH_SCALE : FLAP_VELOCITY;
}
