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
 * Publishes a value as `window.<key>` for console debugging (the scene only
 * ever runs in the browser, so `window` is safe here).
 */
export function setDebugHandle(key: string, value: unknown): void {
  (window as unknown as Record<string, unknown>)[key] = value;
}