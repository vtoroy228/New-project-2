import { soundManager } from './SoundManager';
import { triggerJumpHaptic } from '../services/telegram';
import { tokens } from '../ui/theme/tokens';
import { ChromeDinoRuntime } from './ChromeDinoRuntime';
import type { RuntimeSpawnDecision } from './ChromeDinoRuntime';
import type { LoadedSkin, SkinObstacle } from './SkinLoader';

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
  sprite: CanvasImageSource;
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
const VISUAL_CLUSTER_GAP = 3;
const MAX_VISUAL_TO_HITBOX_RATIO = 1.5;
const WORLD_STRETCH_COMPENSATION_STRENGTH = 0.95;
const MAX_WORLD_STRETCH_COMPENSATION_X = 2.8;
const TELEGRAM_REFERENCE_WIDTH = 412;
const MIN_TELEGRAM_WIDTH_TUNING = 0.9;
const MAX_TELEGRAM_WIDTH_TUNING = 1.05;
const MODEL_SCALE_REFERENCE_WIDTH = 420;
const MIN_MODEL_WIDTH_SCALE = 0.9;
const MAX_MODEL_WIDTH_SCALE = 1.12;
const PHONE_MODEL_WIDTH_BOOST = 1.03;

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
  private readonly runtime: ChromeDinoRuntime;
  private readonly onTick?: (snapshot: GameTickSnapshot) => void;
  private readonly onGameOver?: (snapshot: GameOverSnapshot) => void;

  private readonly dinoSprite: CanvasImageSource;
  private readonly obstacleSprites: Record<string, CanvasImageSource>;
  private readonly dinoRenderScaleX: number;
  private readonly dinoRenderScaleY: number;

  private settings: GameEngineSettings;
  private dino: Actor;
  private obstacles: ObstacleInstance[] = [];
  private obstaclePool: ObstacleInstance[] = [];
  private running = false;
  private speed = 0;
  private score = 0;
  private obstaclesPassed = 0;
  private playTime = 0;
  private viewportWidth = WORLD_WIDTH;
  private telegramViewportWidth = TELEGRAM_REFERENCE_WIDTH;
  private startTimestamp = 0;
  private lastTimestamp = 0;
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
    this.runtime = new ChromeDinoRuntime(this.skin.manifest.obstacles);
    this.settings = options.settings;
    this.onTick = options.onTick;
    this.onGameOver = options.onGameOver;

    this.dinoSprite = this.createCachedSprite(
      this.skin.dinoImage,
      this.skin.manifest.dino.width,
      this.skin.manifest.dino.height
    );

    this.obstacleSprites = Object.fromEntries(
      this.skin.manifest.obstacles.map((obstacle) => {
        const image = this.skin.obstacleImages[obstacle.id];
        return [obstacle.id, this.createCachedSprite(image, obstacle.width, obstacle.height)] as const;
      })
    );

    const rawDinoRenderScaleX = this.skin.manifest.dino.renderScaleX ?? 1;
    const rawDinoRenderScaleY = this.skin.manifest.dino.renderScaleY ?? 1;
    this.dinoRenderScaleX = Number.isFinite(rawDinoRenderScaleX)
      ? Math.max(0.5, rawDinoRenderScaleX)
      : 1;
    this.dinoRenderScaleY = Number.isFinite(rawDinoRenderScaleY)
      ? Math.max(0.5, rawDinoRenderScaleY)
      : 1;

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
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;

    this.viewportWidth = safeWidth;
    this.telegramViewportWidth =
      typeof viewportWidth === 'number' && Number.isFinite(viewportWidth) && viewportWidth > 0
        ? viewportWidth
        : safeWidth;

    const targetWidth = Math.floor(safeWidth * ratio);
    const targetHeight = Math.floor(safeHeight * ratio);

    if (this.canvas.width === targetWidth && this.canvas.height === targetHeight) {
      return;
    }

    this.canvas.width = targetWidth;
    this.canvas.height = targetHeight;

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

  private createCachedSprite(
    source: HTMLImageElement,
    targetWidth: number,
    targetHeight: number
  ): CanvasImageSource {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(targetWidth));
    canvas.height = Math.max(1, Math.round(targetHeight));

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return source;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
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
    this.runtime.reset();
    this.speed = this.runtime.getWorldSpeed();
    this.score = 0;
    this.obstaclesPassed = 0;
    this.playTime = 0;

    for (const obstacle of this.obstacles) {
      this.obstaclePool.push(obstacle);
    }
    this.obstacles.length = 0;

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

    const runtimeTick = this.runtime.tick(deltaSeconds);
    this.speed = runtimeTick.worldSpeed;

    this.dino.velocityY += physics.gravity * deltaSeconds;
    this.dino.y += this.dino.velocityY * deltaSeconds;

    if (this.dino.y >= this.groundY - this.dino.height) {
      this.dino.y = this.groundY - this.dino.height;
      this.dino.velocityY = 0;
    }

    const moveBy = this.speed * deltaSeconds;
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < this.obstacles.length; readIndex += 1) {
      const obstacle = this.obstacles[readIndex]!;
      obstacle.x -= moveBy;

      if (obstacle.x + obstacle.width <= -30) {
        this.obstaclePool.push(obstacle);
        continue;
      }

      if (!obstacle.passed && obstacle.x + obstacle.width < this.dino.x) {
        obstacle.passed = true;
        this.obstaclesPassed += 1;
      }

      if (this.checkCollision(obstacle)) {
        this.finishGame();
        return;
      }

      this.obstacles[writeIndex] = obstacle;
      writeIndex += 1;
    }

    this.obstacles.length = writeIndex;

    for (const decision of runtimeTick.spawns) {
      this.spawnObstacleGroup(decision);
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

  private spawnObstacleGroup(decision: RuntimeSpawnDecision): void {
    const sprite = this.obstacleSprites[decision.type.id] ?? this.skin.obstacleImages[decision.type.id];
    const worldCompensationX = this.getWorldStretchCompensationX();
    const obstacleScale = this.getObstacleVisualScale(decision.type);
    const baseClusterStep = decision.type.width + decision.clusterSpacing;
    const visualClusterStep = decision.type.width * obstacleScale * worldCompensationX + VISUAL_CLUSTER_GAP;
    const clusterStep = Math.max(baseClusterStep, visualClusterStep);

    for (let index = 0; index < decision.clusterCount; index += 1) {
      const x = WORLD_WIDTH + 20 + index * clusterStep;
      const yOffset = decision.flyingYOffset ?? decision.type.yOffset ?? 0;

      const obstacle = this.obstaclePool.pop();
      if (obstacle) {
        obstacle.type = decision.type;
        obstacle.sprite = sprite;
        obstacle.x = x;
        obstacle.y = this.groundY - decision.type.height - yOffset;
        obstacle.width = decision.type.width;
        obstacle.height = decision.type.height;
        obstacle.passed = false;
        this.obstacles.push(obstacle);
        continue;
      }

      this.obstacles.push({
        type: decision.type,
        sprite,
        x,
        y: this.groundY - decision.type.height - yOffset,
        width: decision.type.width,
        height: decision.type.height,
        passed: false
      });
    }
  }

  private checkCollision(obstacle: ObstacleInstance): boolean {
    const worldCompensationX = this.getWorldStretchCompensationX();
    const dinoScale = this.getDinoVisualScale();
    const obstacleScale = this.getObstacleVisualScale(obstacle.type);

    const dinoScaleX = dinoScale.x * worldCompensationX;
    const dinoScaleY = dinoScale.y;
    const obstacleScaleX = obstacleScale * worldCompensationX;
    const obstacleScaleY = obstacleScale;

    const dinoHitbox = this.skin.manifest.dino.hitbox;
    const obstacleHitbox = obstacle.type.hitbox;

    const dinoRenderWidth = this.dino.width * dinoScaleX;
    const dinoRenderHeight = this.dino.height * dinoScaleY;
    const dinoRenderX = this.dino.x - (dinoRenderWidth - this.dino.width) / 2;
    const dinoRenderY = this.dino.y - (dinoRenderHeight - this.dino.height);

    const obstacleRenderWidth = obstacle.width * obstacleScaleX;
    const obstacleRenderHeight = obstacle.height * obstacleScaleY;
    const obstacleRenderX = obstacle.x - (obstacleRenderWidth - obstacle.width) / 2;
    const obstacleRenderY = obstacle.y + (obstacle.height - obstacleRenderHeight);

    const dinoLeft = dinoRenderX + dinoHitbox.x * dinoScaleX;
    const dinoTop = dinoRenderY + dinoHitbox.y * dinoScaleY;
    const dinoRight = dinoLeft + dinoHitbox.width * dinoScaleX;
    const dinoBottom = dinoTop + dinoHitbox.height * dinoScaleY;

    const obstacleLeft = obstacleRenderX + obstacleHitbox.x * obstacleScaleX;
    const obstacleTop = obstacleRenderY + obstacleHitbox.y * obstacleScaleY;
    const obstacleRight = obstacleLeft + obstacleHitbox.width * obstacleScaleX;
    const obstacleBottom = obstacleTop + obstacleHitbox.height * obstacleScaleY;

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

  private getBaseModelVisualScale(): number {
    const desktopScale = window.innerWidth >= 1024 ? 0.95 : 1;
    const phoneBoost = window.innerWidth <= 768 ? PHONE_MODEL_WIDTH_BOOST : 1;
    return desktopScale * phoneBoost * this.getViewportWidthModelScale();
  }

  private getViewportWidthModelScale(): number {
    const widthRatio = this.viewportWidth / MODEL_SCALE_REFERENCE_WIDTH;
    if (!Number.isFinite(widthRatio) || widthRatio <= 0) {
      return 1;
    }

    // Sqrt keeps scaling responsive to width without dramatic jumps between devices.
    const smoothedRatio = Math.sqrt(widthRatio);
    return Math.min(MAX_MODEL_WIDTH_SCALE, Math.max(MIN_MODEL_WIDTH_SCALE, smoothedRatio));
  }

  private getWorldStretchCompensationX(): number {
    const scaleX = this.canvas.width / WORLD_WIDTH;
    const scaleY = this.canvas.height / WORLD_HEIGHT;
    if (scaleX <= 0 || scaleY <= 0) {
      return 1;
    }

    const worldStretchX = scaleY / scaleX;
    if (worldStretchX <= 1) {
      return 1;
    }

    // Follow real stretch ratio much closer on tall viewports (e.g. Pixel line)
    // so sprite proportions stay natural across devices.
    const targetCompensation = Math.min(MAX_WORLD_STRETCH_COMPENSATION_X, worldStretchX);
    const stretchedCompensation = 1 + (targetCompensation - 1) * WORLD_STRETCH_COMPENSATION_STRENGTH;
    return stretchedCompensation * this.getTelegramWidthTuning();
  }

  private getTelegramWidthTuning(): number {
    const widthRatio = this.telegramViewportWidth / TELEGRAM_REFERENCE_WIDTH;
    if (!Number.isFinite(widthRatio) || widthRatio <= 0) {
      return 1;
    }

    const smoothedRatio = Math.sqrt(widthRatio);
    return Math.min(
      MAX_TELEGRAM_WIDTH_TUNING,
      Math.max(MIN_TELEGRAM_WIDTH_TUNING, smoothedRatio)
    );
  }

  private getHitboxAlignmentScale(
    entityWidth: number,
    entityHeight: number,
    hitboxWidth: number,
    hitboxHeight: number
  ): number {
    const safeHitboxWidth = Math.max(1, hitboxWidth);
    const safeHitboxHeight = Math.max(1, hitboxHeight);
    const widthRatio = entityWidth / safeHitboxWidth;
    const heightRatio = entityHeight / safeHitboxHeight;
    const maxRatio = Math.max(widthRatio, heightRatio);

    if (!Number.isFinite(maxRatio) || maxRatio <= 0) {
      return 1;
    }

    if (maxRatio <= MAX_VISUAL_TO_HITBOX_RATIO) {
      return 1;
    }

    return MAX_VISUAL_TO_HITBOX_RATIO / maxRatio;
  }

  private getDinoVisualScale(): { x: number; y: number } {
    const baseScale = this.getBaseModelVisualScale();
    const dinoHitbox = this.skin.manifest.dino.hitbox;
    const alignmentScale = this.getHitboxAlignmentScale(
      this.dino.width * this.dinoRenderScaleX,
      this.dino.height * this.dinoRenderScaleY,
      dinoHitbox.width,
      dinoHitbox.height
    );

    return {
      x: this.dinoRenderScaleX * baseScale * alignmentScale,
      y: this.dinoRenderScaleY * baseScale * alignmentScale
    };
  }

  private getObstacleVisualScale(type: SkinObstacle): number {
    const baseScale = this.getBaseModelVisualScale();
    const alignmentScale = this.getHitboxAlignmentScale(
      type.width,
      type.height,
      type.hitbox.width,
      type.hitbox.height
    );

    return baseScale * alignmentScale;
  }

  private render(): void {
    const ctx = this.context;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const scaleX = this.canvas.width / WORLD_WIDTH;
    const scaleY = this.canvas.height / WORLD_HEIGHT;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

    const worldCompensationX = this.getWorldStretchCompensationX();

    // Draw only the ground so upper background remains visible through transparent canvas.
    ctx.fillStyle = tokens.colors.canvasGround;
    ctx.fillRect(0, this.groundY, WORLD_WIDTH, WORLD_HEIGHT - this.groundY);

    for (let i = 0; i < this.obstacles.length; i += 1) {
      const obstacle = this.obstacles[i]!;
      const obstacleScale = this.getObstacleVisualScale(obstacle.type);
      const obstacleRenderWidth = obstacle.width * obstacleScale * worldCompensationX;
      const obstacleRenderHeight = obstacle.height * obstacleScale;
      const obstacleRenderX = obstacle.x - (obstacleRenderWidth - obstacle.width) / 2;
      const obstacleRenderY = obstacle.y + (obstacle.height - obstacleRenderHeight);
      ctx.drawImage(
        obstacle.sprite,
        obstacleRenderX,
        obstacleRenderY,
        obstacleRenderWidth,
        obstacleRenderHeight
      );
    }

    const dinoScale = this.getDinoVisualScale();
    const renderWidth = this.dino.width * dinoScale.x * worldCompensationX;
    const renderHeight = this.dino.height * dinoScale.y;
    const renderX = this.dino.x - (renderWidth - this.dino.width) / 2;
    const renderY = this.dino.y - (renderHeight - this.dino.height);

    ctx.drawImage(this.dinoSprite, renderX, renderY, renderWidth, renderHeight);
  }
}
