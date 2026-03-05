import defaultSkinManifest from './skins/default/skin.json';

export const DEFAULT_SKIN = 'default';

export interface SkinRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SkinPhysics {
  gravity: number;
  jumpVelocity: number;
  initialSpeed: number;
  speedAcceleration: number;
  minObstacleGap: number;
  maxObstacleGap: number;
  scorePerSecond: number;
  scorePerObstacle: number;
  groundOffset: number;
}

export interface SkinEntity {
  sprite: string;
  width: number;
  height: number;
  hitbox: SkinRect;
}

export interface SkinObstacle extends SkinEntity {
  id: string;
  yOffset?: number;
}

export interface SkinManifest {
  physics: SkinPhysics;
  dino: SkinEntity;
  obstacles: SkinObstacle[];
}

export interface LoadedSkin {
  name: string;
  manifest: SkinManifest;
  dinoImage: HTMLImageElement;
  obstacleImages: Record<string, HTMLImageElement>;
}

const skinManifests: Record<string, SkinManifest> = {
  default: defaultSkinManifest as SkinManifest
};

const loadImage = async (url: string): Promise<HTMLImageElement> => {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
};

const resolveAssetUrl = (skinName: string, assetPath: string): string => {
  return new URL(`./skins/${skinName}/${assetPath}`, import.meta.url).toString();
};

export const loadSkin = async (skinName = DEFAULT_SKIN): Promise<LoadedSkin> => {
  const manifest = skinManifests[skinName] ?? skinManifests.default;

  const dinoImage = await loadImage(resolveAssetUrl(skinName, manifest.dino.sprite));

  const obstacleImages = Object.fromEntries(
    await Promise.all(
      manifest.obstacles.map(async (obstacle) => {
        const image = await loadImage(resolveAssetUrl(skinName, obstacle.sprite));
        return [obstacle.id, image] as const;
      })
    )
  );

  return {
    name: skinName,
    manifest,
    dinoImage,
    obstacleImages
  };
};
