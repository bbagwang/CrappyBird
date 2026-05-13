export const FIELD_WIDTH = 480;
export const FIELD_HEIGHT = 720;

export type Phase = 'start' | 'playing' | 'gameOver';
export type GimmickType =
  | 'gravityFlip'
  | 'movingPipe'
  | 'sizeShift'
  | 'speedRing'
  | 'riskCoin'
  | 'slowMo'
  | 'shieldBubble'
  | 'windGust';
export type DeathCause = 'pipe' | 'bounds' | 'none';

export interface PlayerState {
  x: number;
  y: number;
  vy: number;
  radius: number;
  gravityInverted: boolean;
  sizeScale: number;
}

export interface ObstacleState {
  id: number;
  x: number;
  width: number;
  gapY: number;
  baseGapY: number;
  gapHeight: number;
  passed: boolean;
  moving: boolean;
  amplitude: number;
  frequency: number;
  telegraph: boolean;
}

export interface ZoneState {
  id: number;
  type: Exclude<GimmickType, 'movingPipe' | 'riskCoin'>;
  x: number;
  y: number;
  width: number;
  height: number;
  used: boolean;
  warning: boolean;
}

export interface CoinState {
  id: number;
  x: number;
  y: number;
  radius: number;
  value: number;
  collected: boolean;
}

export interface ActiveEffect {
  type: Exclude<GimmickType, 'movingPipe' | 'riskCoin'>;
  remaining: number;
}

export interface Counters {
  frames: number;
  elapsedMs: number;
  obstaclesSpawned: number;
  obstaclesPassed: number;
  coinsSpawned: number;
  coinsCollected: number;
  restarts: number;
  inputEvents: number;
  gravityFlipSeen: number;
  movingPipeSeen: number;
  sizeShiftSeen: number;
  speedRingSeen: number;
  riskCoinSeen: number;
  slowMoSeen: number;
  shieldBubbleSeen: number;
  windGustSeen: number;
}

export interface GameSnapshot {
  phase: Phase;
  seed: string;
  score: number;
  highScore: number;
  muted: boolean;
  deathCause: DeathCause;
  player: PlayerState;
  activeGimmick: GimmickType | null;
  activeGimmicks: GimmickType[];
  seenGimmicks: GimmickType[];
  counters: Counters;
  difficulty: {
    speed: number;
    spawnEvery: number;
    gapHeight: number;
    telegraphMinSeconds: number;
  };
  nextObstacle: Pick<ObstacleState, 'id' | 'x' | 'gapY' | 'gapHeight' | 'width' | 'moving'> | null;
  obstacles: ObstacleState[];
  zones: ZoneState[];
  coins: CoinState[];
}

export type EngineCommand = 'flap' | 'start' | 'restart' | 'toggleMute';

export interface StoragePort {
  readNumber(key: string, fallback: number): number;
  writeNumber(key: string, value: number): void;
  readBoolean(key: string, fallback: boolean): boolean;
  writeBoolean(key: string, value: boolean): void;
}
