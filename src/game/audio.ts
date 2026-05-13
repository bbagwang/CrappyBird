export class AudioFeedback {
  private context: AudioContext | null = null;

  constructor(private muted: () => boolean) {}

  play(kind: 'flap' | 'score' | 'coin' | 'gimmick' | 'gameOver'): void {
    if (this.muted()) return;
    const context = this.getContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const frequencies: Record<typeof kind, number> = {
      flap: 440,
      score: 660,
      coin: 880,
      gimmick: 520,
      gameOver: 160,
    };
    oscillator.frequency.value = frequencies[kind];
    oscillator.type = kind === 'gameOver' ? 'sawtooth' : 'sine';
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === 'gameOver' ? 0.08 : 0.05, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'gameOver' ? 0.26 : 0.12));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + (kind === 'gameOver' ? 0.28 : 0.14));
  }

  private getContext(): AudioContext | null {
    if (this.context) return this.context;
    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    this.context = new AudioContextCtor();
    return this.context;
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
