// Chrome Dino clone style (inspired by AbinandhMJ/Dino-Game-Clone):
// speedScale starts at 1 and grows slowly over frame time.
export const INITIAL_SPEED = 1;
export const ACCELERATION = 0.000018;
export const MAX_SPEED = 2.3;

export const MAX_OBSTACLE_DUPLICATION = 2;

export const FLYING_MIN_SPEED = 1;
export const NO_CROUCH_FLYING_HEIGHTS = [40, 54, 96] as const;

export const WORLD_SPEED_SCALE = 320;

export const INITIAL_SPAWN_DELAY_MS = 650;
export const SPAWN_INTERVAL_MIN_MS = 680;
export const SPAWN_INTERVAL_MAX_MS = 1600;
export const MIN_SPAWN_DELAY_MS = 430;

// Gameplay density and grouping
export const GAP_DENSITY_FACTOR = 0.9; // 10% denser than current pacing
export const MAX_GROUND_CLUSTER = 2;
export const GROUND_CLUSTER_CHANCE = 0.16;
export const CLUSTER_SPACING = 18;
