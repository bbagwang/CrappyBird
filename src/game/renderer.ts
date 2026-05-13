import { FIELD_HEIGHT, FIELD_WIDTH, type GameSnapshot, type GimmickType } from './types';

const BACKGROUND = ['#14213d', '#1f3b69', '#0d1729'];
const GIMMICK_COLORS: Record<GimmickType, string> = {
  gravityFlip: '#a78bfa',
  movingPipe: '#67e8f9',
  sizeShift: '#f9a8d4',
  speedRing: '#fde047',
  riskCoin: '#fb923c',
  slowMo: '#93c5fd',
  shieldBubble: '#86efac',
  windGust: '#f0abfc',
};

export class CanvasRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly playerImage = new Image();
  private playerImageReady = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    playerImageUrl = '/player-character.jpg',
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    this.context = context;
    this.loadPlayerImage(playerImageUrl);
    this.resize();
  }

  resize(): void {
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    this.canvas.width = Math.round(FIELD_WIDTH * ratio);
    this.canvas.height = Math.round(FIELD_HEIGHT * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  render(snapshot: GameSnapshot): void {
    const ctx = this.context;
    this.drawBackground(ctx, snapshot);
    this.drawZones(ctx, snapshot);
    this.drawCoins(ctx, snapshot);
    this.drawObstacles(ctx, snapshot);
    this.drawPlayer(ctx, snapshot);
    this.drawTelegraphs(ctx, snapshot);
  }

  private loadPlayerImage(primaryUrl: string): void {
    this.playerImageReady = false;
    this.playerImage.onload = () => {
      this.playerImageReady = true;
    };
    this.playerImage.onerror = () => {
      this.playerImageReady = false;
    };
    this.playerImage.src = primaryUrl;
  }

  private drawBackground(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, FIELD_HEIGHT);
    gradient.addColorStop(0, BACKGROUND[0]);
    gradient.addColorStop(0.55, BACKGROUND[1]);
    gradient.addColorStop(1, BACKGROUND[2]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    const offset = -(snapshot.counters.elapsedMs / 40) % 48;
    for (let x = offset; x < FIELD_WIDTH; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 120, FIELD_HEIGHT);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawZones(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    for (const zone of snapshot.zones) {
      if (zone.used) continue;
      const color = GIMMICK_COLORS[zone.type];
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = color;
      ctx.fillRect(zone.x, zone.y - zone.height / 2, zone.width, zone.height);
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.strokeRect(zone.x, zone.y - zone.height / 2, zone.width, zone.height);
      ctx.setLineDash([]);
      ctx.fillStyle = '#08101d';
      ctx.font = '700 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labelFor(zone.type), zone.x + zone.width / 2, Math.max(24, zone.y - zone.height / 2 + 22));
      ctx.restore();
    }
  }

  private drawCoins(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    for (const coin of snapshot.coins) {
      if (coin.collected) continue;
      ctx.save();
      ctx.fillStyle = GIMMICK_COLORS.riskCoin;
      ctx.strokeStyle = '#fff7ad';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(coin.x, coin.y, coin.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#7c2d12';
      ctx.font = '900 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+3', coin.x, coin.y + 0.5);
      ctx.restore();
    }
  }

  private drawObstacles(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    for (const obstacle of snapshot.obstacles) {
      const gapTop = obstacle.gapY - obstacle.gapHeight / 2;
      const gapBottom = obstacle.gapY + obstacle.gapHeight / 2;
      const color = obstacle.moving ? GIMMICK_COLORS.movingPipe : '#34d399';
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = obstacle.telegraph ? '#ffffff' : '#064e3b';
      ctx.lineWidth = obstacle.telegraph ? 4 : 2;
      ctx.fillRect(obstacle.x, 0, obstacle.width, gapTop);
      ctx.fillRect(obstacle.x, gapBottom, obstacle.width, FIELD_HEIGHT - gapBottom);
      ctx.strokeRect(obstacle.x, 0, obstacle.width, gapTop);
      ctx.strokeRect(obstacle.x, gapBottom, obstacle.width, FIELD_HEIGHT - gapBottom);
      if (obstacle.moving) {
        ctx.fillStyle = '#082f49';
        ctx.font = '800 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('이동', obstacle.x + obstacle.width / 2, Math.max(18, gapTop - 10));
      }
      ctx.restore();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    const player = snapshot.player;
    const radius = player.radius;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(Math.max(-0.55, Math.min(0.55, player.vy / 650)) * (player.gravityInverted ? -1 : 1));
    if (this.playerImageReady) {
      const size = radius * 2.8;
      ctx.drawImage(this.playerImage, -size / 2, -size / 2, size, size);
    }
    ctx.restore();
  }

  private drawTelegraphs(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    ctx.save();
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'left';
    let y = FIELD_HEIGHT - 78;
    for (const gimmick of snapshot.activeGimmicks) {
      ctx.fillStyle = GIMMICK_COLORS[gimmick];
      ctx.fillRect(18, y - 14, 12, 12);
      ctx.fillStyle = '#f7fbff';
      ctx.fillText(`${labelFor(gimmick)} 작동 중`, 38, y - 4);
      y += 20;
    }
    ctx.restore();
  }
}

function labelFor(type: GimmickType | 'sizeShift' | 'speedRing' | 'gravityFlip'): string {
  const labels: Record<string, string> = {
    gravityFlip: '중력 반전',
    movingPipe: '이동 파이프',
    sizeShift: '크기 변화',
    speedRing: '가속',
    riskCoin: '위험 코인',
    slowMo: '슬로우',
    shieldBubble: '보호막',
    windGust: '돌풍',
  };
  return labels[type];
}
