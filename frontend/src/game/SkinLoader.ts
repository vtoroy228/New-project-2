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

export type ObstacleCategory = 'low' | 'high' | 'flying';

export interface SkinObstacle extends SkinEntity {
  id: string;
  category: ObstacleCategory;
  yOffset?: number;
  minGap?: number;
  minSpeed?: number;
  multipleSpeed?: number;
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

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const skinCache = new Map<string, Promise<LoadedSkin>>();

const loadImage = async (url: string): Promise<HTMLImageElement> => {
  const cached = imageCache.get(url);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    const image = new Image();
    image.src = url;

    try {
      await image.decode();
    } catch {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      });
    }

    return image;
  })();

  imageCache.set(url, promise);

  try {
    return await promise;
  } catch (error) {
    imageCache.delete(url);
    throw error;
  }
};

const resolveAssetUrl = (skinName: string, assetPath: string): string => {
  return new URL(`./skins/${skinName}/${assetPath}`, import.meta.url).toString();
};

export const loadSkin = async (skinName = DEFAULT_SKIN): Promise<LoadedSkin> => {
  const resolvedSkinName = skinManifests[skinName] ? skinName : DEFAULT_SKIN;
  const cached = skinCache.get(resolvedSkinName);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    const manifest = skinManifests[resolvedSkinName] ?? skinManifests.default;

    const dinoImage = await loadImage(resolveAssetUrl(resolvedSkinName, manifest.dino.sprite));

    const obstacleImages = Object.fromEntries(
      await Promise.all(
        manifest.obstacles.map(async (obstacle) => {
          const image = await loadImage(resolveAssetUrl(resolvedSkinName, obstacle.sprite));
          return [obstacle.id, image] as const;
        })
      )
    );

    return {
      name: resolvedSkinName,
      manifest,
      dinoImage,
      obstacleImages
    };
  })();

  skinCache.set(resolvedSkinName, promise);

  try {
    return await promise;
  } catch (error) {
    skinCache.delete(resolvedSkinName);
    throw error;
  }
};
