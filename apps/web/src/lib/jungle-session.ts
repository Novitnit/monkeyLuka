/**
 * Persists the live Colyseus jungle session across page reloads so the Play
 * screen can silently resume instead of forcing a fresh join: the stored
 * `reconnectionToken` (`roomId:token`) re-enters the same room seat that the
 * server holds via `allowReconnection` after a drop, and the name pre-fills
 * the name dialog if the resume ever fails.
 *
 * sessionStorage (not localStorage) on purpose: the session belongs to the
 * tab — a reload keeps it, closing the tab discards it (so no stale seat is
 * claimed by a tab nobody is looking at).
 */

const STORAGE_KEY = "monkeyluka.jungle-session";

export interface JungleSession {
  /** `room.reconnectionToken`, i.e. `roomId:token`, for `client.reconnect`. */
  reconnectionToken: string;
  /** Leaderboard name, used to pre-fill the name dialog after a resume miss. */
  name: string;
}

/** Best-effort: storage can be unavailable (private mode / quota). */
export function saveJungleSession(session: JungleSession): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Reconnection is an enhancement, never a reason to fail the join.
  }
}

export function loadJungleSession(): JungleSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<JungleSession>;
    if (
      typeof parsed.reconnectionToken !== "string" ||
      typeof parsed.name !== "string"
    ) {
      return null;
    }
    return {
      reconnectionToken: parsed.reconnectionToken,
      name: parsed.name,
    };
  } catch {
    return null;
  }
}

export function clearJungleSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same best-effort contract as the other helpers.
  }
}