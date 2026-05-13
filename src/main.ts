import './style.css';
import { AudioFeedback } from './game/audio';
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
const overlay = requireElement<HTMLElement>('#overlay');
const overlayMessage = requireElement<HTMLElement>('#overlay-message');
const startButton = requireElement<HTMLButtonElement>('#start');

const urlSeed = new URLSearchParams(location.search).get('seed') ?? 'falppy-default';
const engine = new GameEngine({ storage: new BrowserStorage(), seed: urlSeed });
const assetBase = import.meta.env.BASE_URL;
const renderer = new CanvasRenderer(canvas, `${assetBase}player-character.png`, `${assetBase}player-character.svg`);
const audio = new AudioFeedback(() => engine.getSnapshot().muted);
let lastTime = performance.now();
let lastSnapshot = engine.getSnapshot();

function frame(now: number): void {
  const delta = (now - lastTime) / 1000;
  lastTime = now;
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
  muteButton.textContent = snapshot.muted ? 'Muted' : 'Sound On';
  muteButton.setAttribute('aria-pressed', String(snapshot.muted));

  if (snapshot.phase === 'playing') {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');
  if (snapshot.phase === 'start') {
    startButton.textContent = 'Start Run';
    overlayMessage.textContent = 'Flap through fair chaos. Watch the warnings, chase the score.';
  } else {
    startButton.textContent = 'Restart';
    overlayMessage.textContent = `Game over (${snapshot.deathCause}). Score ${snapshot.score}. High ${snapshot.highScore}. Space/click to retry instantly.`;
  }
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
});
canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  flap();
});
startButton.addEventListener('click', () => flap());
muteButton.addEventListener('click', () => toggleMute());

window.falppyDebug = Object.freeze({
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
    falppyDebug: Readonly<{
      setSeed(seed: string): boolean;
      snapshot(): GameSnapshot;
    }>;
  }
}
