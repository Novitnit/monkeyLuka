/**
 * Movable traps — the `trap` objectgroup of the Tiled map.
 *
 * The objectgroup is a container shared by every future trap type; the
 * objects inside it are named by their type. Today there is one type:
 * `Trap_Spike_Run` (see `TRAP_SPIKE_RUN_OBJECT_NAME` below — the same name
 * as the sprite sheet). Each `Trap_Spike_Run` object is one trap instance;
 * the object's own Tiled id is its `id`, distinguishing each instance. The
 * object's rectangle is its patrol area: a marker sweeps back and forth
 * along the rectangle's horizontal axis, vertically centered. Three custom
 * properties drive the motion:
 *
 * - `speedMin` / `speedMax` — bounds of the random patrol speed (px/s);
 * - `time2change_speed` — seconds; after this long the trap rolls a new
 *   speed, uniform in [speedMin, speedMax], keeping its travel direction.
 *
 * Pure and engine-free like the rest of the physics barrel:
 * `buildTrapSpikeRuns` turns the raw Tiled annotations into
 * `TrapSpikeRunEntity`s, and `stepTrapSpikeRun` advances a
 * `TrapSpikeRunMotion` deterministically under an injectable RNG (default
 * `Math.random`). The web client renders each entity as a sprite from the
 * `Trap_Spike_Run.png` sheet driven by `stepTrapSpikeRun`; positions are
 * map pixels, the same space as the player physics. The trap model lives
 * in the shared barrel so the client's kill probe
 * (`isBoxTouchingTrapSpikeRun`, see the web update loop) and any future
 * server-side validation share the exact geometry.
 */

/**
 * The Tiled objectgroup that holds the trap annotations. One group for
 * every trap type: objects inside are filtered by their own exact name
 * (see `isTrapSpikeRunObject`), so a future `Trap_Saw` object can live in
 * the same group.
 */
export const TRAP_OBJECT_GROUP_NAME = "trap";
/** Exact name of a Trap_Spike_Run object (matches the sprite sheet's file name). */
export const TRAP_SPIKE_RUN_OBJECT_NAME = "Trap_Spike_Run";
/** Custom property: upper bound of the random patrol speed (px/s). */
export const TRAP_SPIKE_RUN_SPEED_MAX_PROP = "speedMax";
/** Custom property: lower bound of the random patrol speed (px/s). */
export const TRAP_SPIKE_RUN_SPEED_MIN_PROP = "speedMin";
/** Custom property: seconds between random speed re-rolls. */
export const TRAP_SPIKE_RUN_TIME2CHANGE_PROP = "time2change_speed";

/** One custom property of a Tiled trap object (name + raw Tiled value). */
export interface TrapObjectProperty {
  name: string;
  value: unknown;
}

/** A raw trap object as parsed from the Tiled map's `trap` objectgroup. */
export interface TrapObjectAnnotation {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties: readonly TrapObjectProperty[];
}

/**
 * One recognized Trap_Spike_Run trap: the patrol rectangle plus its speed
 * config. `id` is the Tiled object's own numeric id (see
 * `TrapObjectAnnotation.id`), distinguishing each trap instance.
 */
export interface TrapSpikeRunEntity {
  id: number;
  /** Patrol-area rectangle, map px (the Tiled object's rect). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Patrol speed bounds, px/s. */
  speedMin: number;
  speedMax: number;
  /** Seconds between random speed re-rolls. */
  time2changeSpeed: number;
}

/** Is this object name a Trap_Spike_Run instance (exactly `Trap_Spike_Run`)? */
export function isTrapSpikeRunObject(name: string): boolean {
  return name === TRAP_SPIKE_RUN_OBJECT_NAME;
}

/** Reads a numeric custom property; Tiled may type numbers as strings. */
function readTrapSpikeRunNumber(
  properties: readonly TrapObjectProperty[],
  propName: string,
): number | null {
  const prop = properties.find((candidate) => candidate.name === propName);
  if (prop === undefined) return null;
  const value = Number(prop.value);
  return Number.isFinite(value) ? value : null;
}

/**
 * Recognize every Trap_Spike_Run in a `trap` objectgroup. Objects are
 * matched by exact name (`Trap_Spike_Run`); an object with missing or
 * invalid speed properties is skipped — a misconfigured trap is dropped,
 * mirroring how `buildDoorEntities` only recognizes complete 1×2 door
 * stacks. Future trap types get their own builders over the same raw
 * `TrapObjectAnnotation`s.
 */
export function buildTrapSpikeRuns(
  objects: readonly TrapObjectAnnotation[],
): TrapSpikeRunEntity[] {
  const trapSpikeRuns: TrapSpikeRunEntity[] = [];
  for (const obj of objects) {
    if (!isTrapSpikeRunObject(obj.name)) continue;
    const speedMax = readTrapSpikeRunNumber(
      obj.properties,
      TRAP_SPIKE_RUN_SPEED_MAX_PROP,
    );
    const speedMin = readTrapSpikeRunNumber(
      obj.properties,
      TRAP_SPIKE_RUN_SPEED_MIN_PROP,
    );
    const time2changeSpeed = readTrapSpikeRunNumber(
      obj.properties,
      TRAP_SPIKE_RUN_TIME2CHANGE_PROP,
    );
    if (
      speedMax === null ||
      speedMin === null ||
      time2changeSpeed === null ||
      speedMax <= 0 ||
      speedMin < 0 ||
      speedMin > speedMax ||
      time2changeSpeed <= 0
    ) {
      continue;
    }
    trapSpikeRuns.push({
      id: obj.id,
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      speedMin,
      speedMax,
      time2changeSpeed,
    });
  }
  return trapSpikeRuns;
}

/**
 * Runtime motion of one Trap_Spike_Run: the marker's current center (map
 * px), its signed patrol speed, and the countdown to the next speed
 * re-roll.
 */
export interface TrapSpikeRunMotion {
  x: number;
  y: number;
  /** Signed patrol speed (px/s); the sign is the travel direction. */
  vx: number;
  /** Seconds until the next random speed re-roll. */
  untilSpeedChange: number;
}

/**
 * The initial motion of a trap: centered in its patrol rectangle, moving
 * right at a random speed within [speedMin, speedMax].
 */
export function createTrapSpikeRunMotion(
  spikeRun: TrapSpikeRunEntity,
  random: () => number = Math.random,
): TrapSpikeRunMotion {
  const speed =
    spikeRun.speedMin + random() * (spikeRun.speedMax - spikeRun.speedMin);
  return {
    x: spikeRun.x + spikeRun.width / 2,
    y: spikeRun.y + spikeRun.height / 2,
    vx: speed,
    untilSpeedChange: spikeRun.time2changeSpeed,
  };
}

/**
 * Advance a trap's motion by `dt` seconds: the marker moves along the
 * patrol rectangle's horizontal axis, bouncing at its left/right edges
 * (clamping onto the edge and flipping direction), and every
 * `time2changeSpeed` seconds rolls a new speed — `random()` must return
 * [0, 1) and defaults to `Math.random`; passing a stub makes the
 * simulation deterministic for tests.
 */
export function stepTrapSpikeRun(
  motion: TrapSpikeRunMotion,
  spikeRun: TrapSpikeRunEntity,
  dt: number,
  random: () => number = Math.random,
): void {
  if (dt <= 0) return;
  const minX = spikeRun.x;
  const maxX = spikeRun.x + spikeRun.width;
  motion.x += motion.vx * dt;
  if (motion.x <= minX) {
    motion.x = minX;
    motion.vx = Math.abs(motion.vx);
  } else if (motion.x >= maxX) {
    motion.x = maxX;
    motion.vx = -Math.abs(motion.vx);
  }
  motion.untilSpeedChange -= dt;
  while (motion.untilSpeedChange <= 0) {
    const speed =
      spikeRun.speedMin + random() * (spikeRun.speedMax - spikeRun.speedMin);
    motion.vx = (motion.vx >= 0 ? 1 : -1) * speed;
    motion.untilSpeedChange += spikeRun.time2changeSpeed;
  }
}

/**
 * Does the player's AABB (center (x, y), `width`×`height` — the same
 * player box the dead-zone probe uses) touch the trap marker? The marker
 * is a `trap.height`-square hazard centered on its motion position (the
 * 16px sprite matches the real map's 16px strip). Touching counts as
 * overlapping or resting exactly on the marker's edge, so a contact on
 * the spike's rim kills (the same conservative-lethal stance as
 * `isBoxInDeadZone`). The web client probes its own simulated position
 * against every trap every frame — see the kill in `scene/update.ts`.
 */
export function isBoxTouchingTrapSpikeRun(
  motion: TrapSpikeRunMotion,
  spikeRun: TrapSpikeRunEntity,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const half = spikeRun.height / 2;
  return (
    Math.abs(motion.x - x) <= width / 2 + half &&
    Math.abs(motion.y - y) <= height / 2 + half
  );
}