// Chrome Dino clone style (inspired by AbinandhMJ/Dino-Game-Clone):
// speedScale starts at 1 and grows slowly over frame time.
export const INITIAL_SPEED = 1;
export const ACCELERATION = 0.000016;
export const MAX_SPEED = 2.1;

export const MAX_OBSTACLE_DUPLICATION = 2;

export const FLYING_MIN_SPEED = 1;
export const NO_CROUCH_FLYING_HEIGHTS = [40, 54, 96] as const;

export const WORLD_SPEED_SCALE = 320;

export const INITIAL_SPAWN_DELAY_MS = 720;
export const SPAWN_INTERVAL_MIN_MS = 760;
export const SPAWN_INTERVAL_MAX_MS = 1700;
export const MIN_SPAWN_DELAY_MS = 500;

// Gameplay density and grouping
export const GAP_DENSITY_FACTOR = 1.03; // slightly more spacing between obstacles
export const MAX_GROUND_CLUSTER = 2;
export const GROUND_CLUSTER_CHANCE = 0.1;
export const CLUSTER_SPACING = 18;
