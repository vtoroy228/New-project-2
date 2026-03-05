import { soundManager } from './SoundManager';
import { triggerJumpHaptic } from '../services/telegram';
import { tokens } from '../ui/theme/tokens';
import type { LoadedSkin, ObstacleCategory, SkinObstacle } from './SkinLoader';

interface GameEngineSettings {
  volume: number;
  vibrationEnabled: boolean;
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

const WORLD_WIDTH = 500;
const WORLD_HEIGHT = 300;
const SPEED_LIMIT_FACTOR = 1.85;

export const getDefaultSettings = (): GameEngineSettings => {
  return {
    volume: 0.7,
    vibrationEnabled: true
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
  private lastSpawnCategory: ObstacleCategory | null = null;
  private lastGapWasTight = false;
  private spawnCooldown = 0;
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

    this.setSettings(this.settings);
    this.resize(this.canvas.clientWidth || WORLD_WIDTH, this.canvas.clientHeight || WORLD_HEIGHT);
    this.resetState();
    this.attachControls();
    this.render();
  }

  resize(width: number, height: number): void {
    const safeWidth = Math.max(280, Math.floor(width));
    const safeHeight = Math.max(180, Math.floor(height));
    const ratio = window.devicePixelRatio || 1;

    const targetWidth = Math.floor(safeWidth * ratio);
    const targetHeight = Math.floor(safeHeight * ratio);

    if (this.canvas.width === targetWidth && this.canvas.height === targetHeight) {
      return;
    }

    this.canvas.width = targetWidth;
    this.canvas.height = targetHeight;
    this.canvas.style.width = `${safeWidth}px`;
    this.canvas.style.height = `${safeHeight}px`;

    this.render();
  }

  destroy(): void {
    this.stop();
    this.detachControls();
  }

  setSettings(nextSettings: GameEngineSettings): void {
    this.settings = {
      volume: Math.min(1, Math.max(0, nextSettings.volume)),
      vibrationEnabled: nextSettings.vibrationEnabled
    };

    soundManager.setVolume(this.settings.volume);
  }

  restart(): void {
    this.start();
  }

  private start(): void {
    this.resetState();
    this.running = true;
    this.startTimestamp = performance.now();
    this.lastTimestamp = this.startTimestamp;
    this.loop(this.startTimestamp);
  }

  private stop(): void {
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
    this.lastSpawnCategory = null;
    this.lastGapWasTight = false;
    this.spawnCooldown = 0;
    this.nextSpawnDistance = this.randomGap('low');
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
    return WORLD_HEIGHT - this.skin.manifest.physics.groundOffset;
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
    soundManager.play('jump', { throttleMs: 120 });
    triggerJumpHaptic(this.settings.vibrationEnabled);
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
    const speedLimit = physics.initialSpeed * SPEED_LIMIT_FACTOR;
    this.speed = Math.min(speedLimit, this.speed + physics.speedAcceleration * deltaSeconds);

    this.dino.velocityY += physics.gravity * deltaSeconds;
    this.dino.y += this.dino.velocityY * deltaSeconds;

    if (this.dino.y >= this.groundY - this.dino.height) {
      this.dino.y = this.groundY - this.dino.height;
      this.dino.velocityY = 0;
    }

    this.nextSpawnDistance -= this.speed * deltaSeconds;
    if (this.nextSpawnDistance <= 0) {
      const type = this.pickObstacleType();
      this.spawnObstacle(type);
      this.nextSpawnDistance = this.randomGap(type.category);
    }

    this.obstacles = this.obstacles
      .map((obstacle) => ({
        ...obstacle,
        x: obstacle.x - this.speed * deltaSeconds
      }))
      .filter((obstacle) => obstacle.x + obstacle.width > -30);

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

  private randomGap(category: ObstacleCategory): number {
    const { minObstacleGap, maxObstacleGap, initialSpeed } = this.skin.manifest.physics;

    const speedFactor = Math.max(0, this.speed / initialSpeed - 1);
    const reactionGap = this.speed * (0.72 + speedFactor * 0.12);
    let min = Math.max(minObstacleGap, reactionGap);
    let max = Math.max(maxObstacleGap, min + 180 + speedFactor * 80);

    if (category === 'flying') {
      min += 120;
      max += 180;
    }

    if (this.spawnCooldown > 0) {
      min += 110;
      max += 130;
    }

    if (this.lastGapWasTight) {
      min += 90;
    }

    if (max < min + 60) {
      max = min + 60;
    }

    const gap = min + Math.random() * (max - min);
    this.lastGapWasTight = gap < min + 48;
    return gap;
  }

  private pickObstacleType(): SkinObstacle {
    const obstacles = this.skin.manifest.obstacles;
    const initialSpeed = this.skin.manifest.physics.initialSpeed;
    const isFast = this.speed > initialSpeed * 1.15;

    let candidates = obstacles.filter((obstacle) => {
      if (obstacle.category === 'flying' && (obstacle.yOffset ?? 0) < 56) {
        return false;
      }

      if (this.spawnCooldown > 0 && obstacle.category === 'flying') {
        return false;
      }

      if (isFast && this.lastSpawnCategory === 'flying' && obstacle.category === 'flying') {
        return false;
      }

      return true;
    });

    if (candidates.length === 0) {
      candidates = obstacles;
    }

    const weighted = candidates.flatMap((obstacle) => {
      if (obstacle.category === 'low') {
        return [obstacle, obstacle];
      }

      if (obstacle.category === 'flying') {
        return this.speed > initialSpeed * 1.05 ? [obstacle] : [];
      }

      return [obstacle];
    });

    const pool = weighted.length > 0 ? weighted : candidates;
    const selected = pool[Math.floor(Math.random() * pool.length)] ?? pool[0];

    if (selected.category === 'flying' || selected.category === 'high') {
      this.spawnCooldown = 2;
    } else if (this.spawnCooldown > 0) {
      this.spawnCooldown -= 1;
    }

    this.lastSpawnCategory = selected.category;

    return selected;
  }

  private spawnObstacle(type: SkinObstacle): void {
    const image = this.skin.obstacleImages[type.id];

    const obstacle: ObstacleInstance = {
      type,
      image,
      x: WORLD_WIDTH + 20,
      y: this.groundY - type.height - (type.yOffset ?? 0),
      width: type.width,
      height: type.height,
      passed: false
    };

    this.obstacles.push(obstacle);
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

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const scaleX = this.canvas.width / WORLD_WIDTH;
    const scaleY = this.canvas.height / WORLD_HEIGHT;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

    ctx.fillStyle = tokens.colors.canvasSky;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.fillStyle = tokens.colors.canvasGround;
    ctx.fillRect(0, this.groundY, WORLD_WIDTH, WORLD_HEIGHT - this.groundY);

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
