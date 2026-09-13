/**
 * Live on-screen control state for touch devices.
 *
 * One instance is created per game (`createTouchControlsState`) and shared
 * between the two sides: the React HUD (`src/components/touch-controls.tsx`)
 * writes into it, and the scene's update loop (`scene/update.ts`) merges it
 * into the player input each frame, exactly like the keyboard axes. The HUD
 * mutates the object directly, so the game never polls the DOM — passing
 * the same instance to both sides (via `JungleGameOptions.touchControls`)
 * is the whole contract.
 *
 * `left`/`right` are held states (a thumb is down on the button).
 * `jump`/`interact` are edges: the HUD sets them on tap, and the update
 * loop consumes them (mirroring `Keyboard.JustDown`) so a tap is exactly
 * one jump / one interaction, never a held auto-repeat.
 */

export interface TouchControlsState {
  /** A thumb is holding the left-move button. */
  left: boolean;
  /** A thumb is holding the right-move button. */
  right: boolean;
  /** Edge: the jump button was tapped since the last frame. */
  jump: boolean;
  /** Edge: the interact button was tapped since the last frame. */
  interact: boolean;
}

/** Creates a fresh (all-released) control state for one game instance. */
export function createTouchControlsState(): TouchControlsState {
  return { left: false, right: false, jump: false, interact: false };
}