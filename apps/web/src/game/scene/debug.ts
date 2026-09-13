/**
 * Debug gates and window handles for the jungle scene: the NEXT_PUBLIC_DEBUG
 * flag (collision overlay, R-key checkpoint return) plus the window-scoped
 * inspector hooks the scene publishes for the browser console.
 */

/**
 * Whether the NEXT_PUBLIC_DEBUG flag is "1" or "true" (case-insensitive).
 * Plain `DEBUG` is server-only in Next.js — the browser client only sees
 * NEXT_PUBLIC_-prefixed env vars (inlined at build time). Gates the debug
 * extras: the collision overlay and the R-key checkpoint return.
 */
export function isDebugEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_DEBUG;
  return flag === "1" || flag?.toLowerCase() === "true";
}

export function isCollisionDebugEnabled(): boolean {
  return isDebugEnabled();
}

/**
 * Whether the NEXT_PUBLIC_DOOR_DEBUG flag is "1" or "true": draws the
 * door-link debug lines (cyan) from every showquest interaction to every
 * door in the same room-objectgroup name group — see
 * `src/game/door/door-debug.ts`. Independent of NEXT_PUBLIC_DEBUG so the
 * link preview can run without the full collision overlay.
 */
export function isDoorDebugEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_DOOR_DEBUG;
  return flag === "1" || flag?.toLowerCase() === "true";
}

/**
 * Publishes a value as `window.<key>` for console debugging (the scene only
 * ever runs in the browser, so `window` is safe here).
 */
export function setDebugHandle(key: string, value: unknown): void {
  (window as unknown as Record<string, unknown>)[key] = value;
}