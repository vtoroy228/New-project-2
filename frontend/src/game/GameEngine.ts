import { tokens } from '../ui/theme/tokens';
import { triggerImpact } from '../services/telegram';
import type { LoadedSkin, SkinObstacle } from './SkinLoader';

interface GameEngineSettings {
  volume: number;
  vibration: boolean;
}

export interface GameTickSnapshot {
  score: number;
  playTime: number;
  obstaclesPassed: number;
  running: boolean;
}

export interface GameOverSnapshot {
  score: number;
  playTime: number;
  obstacles: number;
}

interface GameEngineOptions {
  canvas: HTMLCanvasElement;
  skin: LoadedSkin;
  settings: GameEngineSettings;
  onTick?: (snapshot: GameTickSnapshot) => void;
  onGameOver?: (snapshot: GameOverSnapshot) => void;
}

interface ObstacleInstance {
  type: SkinObstacle;
  image: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
  passed: boolean;
}

interface Actor {
  x: number;
  y: number;
  width: number;
  height: number;
  velocityY: number;
}

const STORAGE_VOLUME_KEY = 'dino-game-volume';

export const getDefaultSettings = (): GameEngineSettings => {
  const storedVolume = Number.parseInt(localStorage.getItem(STORAGE_VOLUME_KEY) ?? '70', 10);

  return {
    volume: Number.isFinite(storedVolume) ? Math.min(100, Math.max(0, storedVolume)) : 70,
    vibration: true
  };
};

export class GameEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly skin: LoadedSkin;
  private readonly onTick?: (snapshot: GameTickSnapshot) => void;
  private readonly onGameOver?: (snapshot: GameOverSnapshot) => void;

  private settings: GameEngineSettings;
  private dino: Actor;
  private obstacles: ObstacleInstance[] = [];
  private running = false;
  private speed: number;
  private score = 0;
  private obstaclesPassed = 0;
  private playTime = 0;
  private startTimestamp = 0;
  private lastTimestamp = 0;
  private nextSpawnDistance = 0;
  private rafId = 0;

  private readonly keydownHandler = (event: KeyboardEvent) => {
    if (event.code === 'Space' || event.code === 'ArrowUp') {
      event.preventDefault();
      this.jump();
    }
  };

  private readonly pointerHandler = () => {
    this.jump();
  };

  constructor(options: GameEngineOptions) {
    this.canvas = options.canvas;
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('2D canvas context is not available');
    }

    this.context = context;
    this.skin = options.skin;
    this.settings = options.settings;
    this.onTick = options.onTick;
    this.onGameOver = options.onGameOver;
    this.speed = this.skin.manifest.physics.initialSpeed;

    this.dino = {
      x: 38,
      y: 0,
      width: this.skin.manifest.dino.width,
      height: this.skin.manifest.dino.height,
      velocityY: 0
    };

    this.resetState();
    this.attachControls();
    this.render();
  }

  destroy(): void {
    this.stop();
    this.detachControls();
  }

  setSettings(nextSettings: GameEngineSettings): void {
    this.settings = nextSettings;
    localStorage.setItem(STORAGE_VOLUME_KEY, String(Math.round(nextSettings.volume)));
  }

  start(): void {
    this.resetState();
    this.running = true;
    this.startTimestamp = performance.now();
    this.lastTimestamp = this.startTimestamp;
    this.loop(this.startTimestamp);
  }

  restart(): void {
    this.start();
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private attachControls(): void {
    window.addEventListener('keydown', this.keydownHandler);
    this.canvas.addEventListener('pointerdown', this.pointerHandler);
  }

  private detachControls(): void {
    window.removeEventListener('keydown', this.keydownHandler);
    this.canvas.removeEventListener('pointerdown', this.pointerHandler);
  }

  private resetState(): void {
    this.speed = this.skin.manifest.physics.initialSpeed;
    this.score = 0;
    this.obstaclesPassed = 0;
    this.playTime = 0;
    this.obstacles = [];
    this.nextSpawnDistance = this.randomGap();
    this.dino.velocityY = 0;
    this.dino.y = this.groundY - this.dino.height;

    this.onTick?.({
      score: this.score,
      playTime: this.playTime,
      obstaclesPassed: this.obstaclesPassed,
      running: this.running
    });
  }

  private get groundY(): number {
    return this.canvas.height - this.skin.manifest.physics.groundOffset;
  }

  private jump(): void {
    if (!this.running) {
      return;
    }

    const isOnGround = this.dino.y >= this.groundY - this.dino.height - 2;
    if (!isOnGround) {
      return;
    }

    this.dino.velocityY = -this.skin.manifest.physics.jumpVelocity;
    triggerImpact(this.settings.vibration);
  }

  private loop = (timestamp: number): void => {
    if (!this.running) {
      return;
    }

    const deltaSeconds = Math.min((timestamp - this.lastTimestamp) / 1000, 0.034);
    this.lastTimestamp = timestamp;

    this.update(deltaSeconds);
    this.render();

    if (this.running) {
      this.rafId = requestAnimationFrame(this.loop);
    }
  };

  private update(deltaSeconds: number): void {
    const physics = this.skin.manifest.physics;

    this.playTime = (performance.now() - this.startTimestamp) / 1000;
    this.speed += physics.speedAcceleration * deltaSeconds;

    this.dino.velocityY += physics.gravity * deltaSeconds;
    this.dino.y += this.dino.velocityY * deltaSeconds;

    if (this.dino.y >= this.groundY - this.dino.height) {
      this.dino.y = this.groundY - this.dino.height;
      this.dino.velocityY = 0;
    }

    this.nextSpawnDistance -= this.speed * deltaSeconds;
    if (this.nextSpawnDistance <= 0) {
      this.spawnObstacle();
      this.nextSpawnDistance = this.randomGap();
    }

    this.obstacles = this.obstacles
      .map((obstacle) => ({
        ...obstacle,
        x: obstacle.x - this.speed * deltaSeconds
      }))
      .filter((obstacle) => obstacle.x + obstacle.width > -8);

    for (const obstacle of this.obstacles) {
      if (!obstacle.passed && obstacle.x + obstacle.width < this.dino.x) {
        obstacle.passed = true;
        this.obstaclesPassed += 1;
      }

      if (this.checkCollision(obstacle)) {
        this.finishGame();
        return;
      }
    }

    this.score = Math.floor(
      this.playTime * physics.scorePerSecond + this.obstaclesPassed * physics.scorePerObstacle
    );

    this.onTick?.({
      score: this.score,
      playTime: this.playTime,
      obstaclesPassed: this.obstaclesPassed,
      running: this.running
    });
  }

  private spawnObstacle(): void {
    const types = this.skin.manifest.obstacles;
    const randomType = types[Math.floor(Math.random() * types.length)] ?? types[0];
    const image = this.skin.obstacleImages[randomType.id];

    const obstacle: ObstacleInstance = {
      type: randomType,
      image,
      x: this.canvas.width + 20,
      y: this.groundY - randomType.height - (randomType.yOffset ?? 0),
      width: randomType.width,
      height: randomType.height,
      passed: false
    };

    this.obstacles.push(obstacle);
  }

  private randomGap(): number {
    const { minObstacleGap, maxObstacleGap } = this.skin.manifest.physics;
    const speedFactor = Math.min(1.35, this.speed / this.skin.manifest.physics.initialSpeed);
    const min = minObstacleGap / speedFactor;
    const max = maxObstacleGap / speedFactor;
    return min + Math.random() * (max - min);
  }

  private checkCollision(obstacle: ObstacleInstance): boolean {
    const dinoHitbox = this.skin.manifest.dino.hitbox;
    const obstacleHitbox = obstacle.type.hitbox;

    const dinoLeft = this.dino.x + dinoHitbox.x;
    const dinoTop = this.dino.y + dinoHitbox.y;
    const dinoRight = dinoLeft + dinoHitbox.width;
    const dinoBottom = dinoTop + dinoHitbox.height;

    const obstacleLeft = obstacle.x + obstacleHitbox.x;
    const obstacleTop = obstacle.y + obstacleHitbox.y;
    const obstacleRight = obstacleLeft + obstacleHitbox.width;
    const obstacleBottom = obstacleTop + obstacleHitbox.height;

    return (
      dinoLeft < obstacleRight &&
      dinoRight > obstacleLeft &&
      dinoTop < obstacleBottom &&
      dinoBottom > obstacleTop
    );
  }

  private finishGame(): void {
    this.running = false;
    this.render();

    this.onTick?.({
      score: this.score,
      playTime: this.playTime,
      obstaclesPassed: this.obstaclesPassed,
      running: this.running
    });

    this.onGameOver?.({
      score: this.score,
      playTime: Math.max(0, Math.round(this.playTime)),
      obstacles: this.obstaclesPassed
    });
  }

  private render(): void {
    const ctx = this.context;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = tokens.colors.canvasSky;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = tokens.colors.canvasGround;
    ctx.fillRect(0, this.groundY, this.canvas.width, this.canvas.height - this.groundY);

    for (const obstacle of this.obstacles) {
      if (obstacle.image.complete) {
        ctx.drawImage(obstacle.image, obstacle.x, obstacle.y, obstacle.width, obstacle.height);
      } else {
        ctx.fillStyle = tokens.colors.canvasObstacle;
        ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
      }
    }

    if (this.skin.dinoImage.complete) {
      ctx.drawImage(this.skin.dinoImage, this.dino.x, this.dino.y, this.dino.width, this.dino.height);
    } else {
      ctx.fillStyle = tokens.colors.canvasObstacle;
      ctx.fillRect(this.dino.x, this.dino.y, this.dino.width, this.dino.height);
    }
  }
}
