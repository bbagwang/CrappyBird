import './style.css';
import { AudioFeedback } from './game/audio';
import { AutopilotController } from './game/autopilot';
import { GameEngine } from './game/engine';
import { CanvasRenderer } from './game/renderer';
import { BrowserStorage } from './game/storage';
import type { GameSnapshot } from './game/types';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required DOM node is missing: ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>('#game');
const scoreElement = requireElement<HTMLElement>('#score');
const highScoreElement = requireElement<HTMLElement>('#high-score');
const muteButton = requireElement<HTMLButtonElement>('#mute');
const pizzaModeButton = requireElement<HTMLButtonElement>('#pizza-mode');
const overlay = requireElement<HTMLElement>('#overlay');
const overlayMessage = requireElement<HTMLElement>('#overlay-message');
const startButton = requireElement<HTMLButtonElement>('#start');

const urlSeed = new URLSearchParams(location.search).get('seed') ?? 'crappy-default';
const engine = new GameEngine({ storage: new BrowserStorage(), seed: urlSeed });
const assetBase = import.meta.env.BASE_URL;
const playerImageUrl = `${assetBase}player-character.jpg`;
const renderer = new CanvasRenderer(canvas, playerImageUrl);
const audio = new AudioFeedback(() => engine.getSnapshot().muted);
const autopilot = new AutopilotController();
let pizzaModeEnabled = false;
let lastTime = performance.now();
let lastSnapshot = engine.getSnapshot();

function frame(now: number): void {
  const delta = (now - lastTime) / 1000;
  lastTime = now;
  runPizzaMode(engine.getSnapshot());
  engine.update(delta);
  const snapshot = engine.getSnapshot();
  playTransitionSounds(lastSnapshot, snapshot);
  renderer.render(snapshot);
  updateHud(snapshot);
  lastSnapshot = snapshot;
  requestAnimationFrame(frame);
}

function updateHud(snapshot: GameSnapshot): void {
  scoreElement.textContent = String(snapshot.score);
  highScoreElement.textContent = String(snapshot.highScore);
  muteButton.textContent = snapshot.muted ? '음소거' : '소리 켜짐';
  muteButton.setAttribute('aria-pressed', String(snapshot.muted));
  pizzaModeButton.textContent = pizzaModeEnabled ? '피자 모드 중' : '피자 모드';
  pizzaModeButton.setAttribute('aria-pressed', String(pizzaModeEnabled));
  pizzaModeButton.classList.toggle('active', pizzaModeEnabled);

  if (snapshot.phase === 'playing') {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');
  if (snapshot.phase === 'start') {
    startButton.textContent = '시작하기';
    overlayMessage.textContent = pizzaModeEnabled
      ? '피자 모드가 켜졌습니다. 입력 없이도 스스로 출발합니다.'
      : '공정한 혼돈을 통과하세요. 경고를 보고 점수를 노리세요.';
  } else {
    startButton.textContent = '다시 시작';
    overlayMessage.textContent = pizzaModeEnabled
      ? `게임 오버 (${deathCauseLabel(snapshot.deathCause)}). 피자 모드가 곧 다시 시작합니다.`
      : `게임 오버 (${deathCauseLabel(snapshot.deathCause)}). 점수 ${snapshot.score}. 최고점 ${snapshot.highScore}. 스페이스 또는 클릭으로 바로 재시작하세요.`;
  }
}

function deathCauseLabel(cause: GameSnapshot['deathCause']): string {
  if (cause === 'pipe') return '파이프 충돌';
  if (cause === 'bounds') return '경계 이탈';
  return '없음';
}

function playTransitionSounds(previous: GameSnapshot, next: GameSnapshot): void {
  if (next.phase === 'gameOver' && previous.phase !== 'gameOver') audio.play('gameOver');
  if (next.score > previous.score) audio.play(next.counters.coinsCollected > previous.counters.coinsCollected ? 'coin' : 'score');
  if (next.activeGimmicks.length > previous.activeGimmicks.length) audio.play('gimmick');
}

function flap(): void {
  const before = engine.getSnapshot();
  engine.flap();
  const after = engine.getSnapshot();
  if (after.phase === 'playing' && before.phase === 'playing') audio.play('flap');
}

function toggleMute(): void {
  engine.toggleMute();
  updateHud(engine.getSnapshot());
}

function togglePizzaMode(): void {
  pizzaModeEnabled = !pizzaModeEnabled;
  if (!pizzaModeEnabled) autopilot.reset();
  runPizzaMode(engine.getSnapshot());
  updateHud(engine.getSnapshot());
}

function runPizzaMode(snapshot: GameSnapshot): void {
  if (!pizzaModeEnabled) return;
  if (autopilot.nextAction(snapshot) === 'flap') flap();
}

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' || event.code === 'ArrowUp') {
    event.preventDefault();
    flap();
  }
  if (event.code === 'KeyM') {
    event.preventDefault();
    toggleMute();
  }
  if (event.code === 'KeyA') {
    event.preventDefault();
    togglePizzaMode();
  }
});
canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  flap();
});
startButton.addEventListener('click', () => flap());
muteButton.addEventListener('click', () => toggleMute());
pizzaModeButton.addEventListener('click', () => togglePizzaMode());

window.crappyDebug = Object.freeze({
  setSeed(seed: string): boolean {
    return engine.setSeed(seed);
  },
  snapshot(): GameSnapshot {
    return engine.getSnapshot();
  },
});

renderer.render(engine.getSnapshot());
updateHud(engine.getSnapshot());
requestAnimationFrame(frame);

declare global {
  interface Window {
    crappyDebug: Readonly<{
      setSeed(seed: string): boolean;
      snapshot(): GameSnapshot;
    }>;
  }
}
