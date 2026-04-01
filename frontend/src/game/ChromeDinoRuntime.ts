import {
  ACCELERATION,
  CLUSTER_SPACING,
  FLYING_MIN_SPEED,
  GAP_DENSITY_FACTOR,
  GROUND_CLUSTER_CHANCE,
  INITIAL_SPEED,
  INITIAL_SPAWN_DELAY_MS,
  MAX_GROUND_CLUSTER,
  MAX_OBSTACLE_DUPLICATION,
  MAX_SPEED,
  MIN_SPAWN_DELAY_MS,
  NO_CROUCH_FLYING_HEIGHTS,
  SPAWN_INTERVAL_MAX_MS,
  SPAWN_INTERVAL_MIN_MS,
  WORLD_SPEED_SCALE
} from './constants';
import type { ObstacleCategory, SkinObstacle } from './SkinLoader';

export interface RuntimeSpawnDecision {
  type: SkinObstacle;
  clusterCount: number;
  clusterSpacing: number;
  flyingHeightIndex: number | null;
  flyingYOffset: number | null;
}

export interface RuntimeTickSnapshot {
  chromeSpeed: number;
  worldSpeed: number;
  distanceRan: number;
  spawns: RuntimeSpawnDecision[];
}

type ObstacleKey = 'smallCactus' | 'largeCactus' | 'pterodactyl';

interface ObstacleMeta {
  key: ObstacleKey;
  obstacle: SkinObstacle;
  category: ObstacleCategory;
  minSpeed: number;
}

const randomInt = (min: number, max: number): number => {
  const safeMin = Math.floor(min);
  const safeMax = Math.floor(max);

  if (safeMax <= safeMin) {
    return safeMin;
  }

  return safeMin + Math.floor(Math.random() * (safeMax - safeMin + 1));
};

const randomFrom = <T>(items: readonly T[]): T => {
  return items[Math.floor(Math.random() * items.length)]!;
};

const CLUSTER_UNLOCK_SCORE = 1000;

export class ChromeDinoRuntime {
  private readonly obstacleMetas: ObstacleMeta[];

  private chromeSpeed = INITIAL_SPEED;
  private distanceRan = 0;
  private nextSpawnTimerMs = INITIAL_SPAWN_DELAY_MS;

  private lastTypeKey: ObstacleKey | null = null;
  private lastTypeDuplication = 0;
  private lastWasFlying = false;
  private lastWasCluster = false;

  constructor(obstacles: SkinObstacle[]) {
    this.obstacleMetas = this.buildObstacleMetas(obstacles);
    this.reset();
  }

  reset(): void {
    this.chromeSpeed = INITIAL_SPEED;
    this.distanceRan = 0;
    this.nextSpawnTimerMs = INITIAL_SPAWN_DELAY_MS;

    this.lastTypeKey = null;
    this.lastTypeDuplication = 0;
    this.lastWasFlying = false;
    this.lastWasCluster = false;
  }

  getChromeSpeed(): number {
    return this.chromeSpeed;
  }

  getWorldSpeed(): number {
    return this.chromeSpeed * WORLD_SPEED_SCALE;
  }

  tick(deltaSeconds: number, currentScore = 0): RuntimeTickSnapshot {
    const deltaMs = deltaSeconds * 1000;

    this.chromeSpeed = Math.min(MAX_SPEED, this.chromeSpeed + ACCELERATION * deltaMs);

    const worldSpeed = this.getWorldSpeed();
    this.distanceRan += worldSpeed * deltaSeconds;

    this.nextSpawnTimerMs -= deltaMs;

    const spawns: RuntimeSpawnDecision[] = [];

    // Keep Chrome-like pacing: never spawn a burst of obstacles in one frame.
    if (this.nextSpawnTimerMs <= 0) {
      const decision = this.createSpawnDecision(currentScore);
      spawns.push(decision);

      this.commitPattern(decision.type, decision.clusterCount);
      this.nextSpawnTimerMs = this.computeNextSpawnDelay(
        worldSpeed,
        decision.type,
        decision.clusterCount,
        decision.flyingHeightIndex
      );
    }

    return {
      chromeSpeed: this.chromeSpeed,
      worldSpeed,
      distanceRan: this.distanceRan,
      spawns
    };
  }

  private buildObstacleMetas(obstacles: SkinObstacle[]): ObstacleMeta[] {
    const low = obstacles.find((obstacle) => obstacle.category === 'low') ?? obstacles[0]!;
    const high =
      obstacles.find((obstacle) => obstacle.category === 'high') ??
      obstacles.find((obstacle) => obstacle.id !== low.id) ??
      low;
    const flying =
      obstacles.find((obstacle) => obstacle.category === 'flying') ??
      obstacles.find((obstacle) => obstacle.id !== low.id && obstacle.id !== high.id) ??
      high;

    return [
      {
        key: 'smallCactus',
        obstacle: low,
        category: 'low',
        minSpeed: 0
      },
      {
        key: 'largeCactus',
        obstacle: high,
        category: 'high',
        minSpeed: 0
      },
      {
        key: 'pterodactyl',
        obstacle: flying,
        category: 'flying',
        minSpeed: FLYING_MIN_SPEED
      }
    ];
  }

  private createSpawnDecision(currentScore: number): RuntimeSpawnDecision {
    const selectedType = this.pickObstacleType();
    const clusterCount = this.pickClusterCount(selectedType, currentScore);
    const flyingHeightIndex =
      selectedType.category === 'flying' ? this.pickFlyingHeight() : null;

    return {
      type: selectedType.obstacle,
      clusterCount,
      clusterSpacing: clusterCount > 1 ? CLUSTER_SPACING : 0,
      flyingHeightIndex,
      flyingYOffset:
        flyingHeightIndex === null ? null : NO_CROUCH_FLYING_HEIGHTS[flyingHeightIndex]
    };
  }

  private pickObstacleType(): ObstacleMeta {
    const groundTypes = this.obstacleMetas.filter((meta) => meta.category !== 'flying');
    const dedupedGround = this.filterByDuplicationLimit(groundTypes);
    const groundPool = dedupedGround.length > 0 ? dedupedGround : groundTypes;

    const flying = this.obstacleMetas.find((meta) => meta.category === 'flying') ?? null;
    const canSpawnFlying =
      flying !== null &&
      this.chromeSpeed >= flying.minSpeed &&
      !this.lastWasFlying;

    if (canSpawnFlying) {
      const flyingChance = this.chromeSpeed < 1.9 ? 0.11 : 0.17;
      if (Math.random() < flyingChance) {
        return flying;
      }
    }

    return randomFrom(groundPool);
  }

  private filterByDuplicationLimit(types: ObstacleMeta[]): ObstacleMeta[] {
    if (this.lastTypeKey === null || this.lastTypeDuplication < MAX_OBSTACLE_DUPLICATION) {
      return types;
    }

    return types.filter((type) => type.key !== this.lastTypeKey);
  }

  private pickFlyingHeight(): number {
    const roll = Math.random();

    if (roll < 0.34) {
      return 0;
    }

    if (roll < 0.72) {
      return 1;
    }

    return 2;
  }

  private pickClusterCount(type: ObstacleMeta, currentScore: number): number {
    if (type.category === 'flying') {
      return 1;
    }

    if (currentScore < CLUSTER_UNLOCK_SCORE) {
      return 1;
    }

    if (this.lastWasCluster || this.lastWasFlying) {
      return 1;
    }

    if (this.chromeSpeed < 1.25) {
      return 1;
    }

    return Math.random() < GROUND_CLUSTER_CHANCE ? MAX_GROUND_CLUSTER : 1;
  }

  private computeNextSpawnDelay(
    worldSpeed: number,
    obstacle: SkinObstacle,
    clusterCount: number,
    flyingHeightIndex: number | null
  ): number {
    const baseIntervalMs = randomInt(SPAWN_INTERVAL_MIN_MS, SPAWN_INTERVAL_MAX_MS);
    const speedGrowthFactor = 1 + Math.max(0, this.chromeSpeed - INITIAL_SPEED) * 0.22;
    const intervalMs = baseIntervalMs * speedGrowthFactor;

    const jumpRequired = obstacle.category !== 'flying' || flyingHeightIndex !== 2;
    const reactionTime = jumpRequired ? 0.24 : 0.16;
    const safetyPadding = jumpRequired ? 125 : 85;

    const obstacleSpan =
      obstacle.width * clusterCount + CLUSTER_SPACING * Math.max(0, clusterCount - 1);
    const minDistance = obstacleSpan + worldSpeed * reactionTime + safetyPadding;
    const intervalDistance = worldSpeed * (intervalMs / 1000);
    let targetDistance = Math.max(minDistance, intervalDistance);

    targetDistance *= GAP_DENSITY_FACTOR;

    if (this.lastWasFlying || jumpRequired) {
      targetDistance *= 1.1;
    }

    const maxDistance = 170 + worldSpeed * 0.95;
    targetDistance = Math.min(targetDistance, maxDistance);

    const delay = (targetDistance / worldSpeed) * 1000;
    return Math.max(delay, MIN_SPAWN_DELAY_MS);
  }

  private commitPattern(type: SkinObstacle, clusterCount: number): void {
    const key = this.resolveKeyByObstacleId(type.id);

    if (this.lastTypeKey === key) {
      this.lastTypeDuplication += 1;
    } else {
      this.lastTypeDuplication = 1;
    }

    this.lastTypeKey = key;
    this.lastWasFlying = type.category === 'flying';
    this.lastWasCluster = clusterCount > 1;
  }

  private resolveKeyByObstacleId(obstacleId: string): ObstacleKey {
    const found = this.obstacleMetas.find((meta) => meta.obstacle.id === obstacleId);
    return found?.key ?? 'smallCactus';
  }
}
