/**
 * Schema writes for accepted movement reports. `writeIfChanged` updates a
 * `PlayerInfo` field only when its value actually changed, so Colyseus
 * patches just the deltas instead of re-sending every field each report.
 */

import type { PlayerInfo } from "@monkeyluka/shared";

/** Writes a schema field only when its value changed (less patch churn). */
export function writeIfChanged<K extends "x" | "y" | "vx" | "vy" | "grounded" | "facing">(
  info: InstanceType<typeof PlayerInfo>,
  key: K,
  value: InstanceType<typeof PlayerInfo>[K],
): void {
  if (info[key] !== value) {
    info[key] = value;
  }
}