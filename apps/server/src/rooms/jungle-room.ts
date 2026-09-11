import { Room } from "colyseus";
import type { Client } from "colyseus";
import {
  JungleState,
  MAX_PLAYER_NAME_LENGTH,
  PlayerInfo,
  type JungleRoomState,
} from "@monkeyluka/shared";

/**
 * The jungle matchmaking room. Registered under `ROOM_NAMES.jungle` by
 * `defineRoom()` in `src/index.ts`; every joined client is tracked in the
 * shared `JungleState` schema keyed by sessionId, so leaderboard identities
 * sync across all room members.
 */
export class JungleRoom extends Room<{ state: JungleRoomState }> {
  /** Soft cap until matchmaking/filtering lands (Colyseus default is 10). */
  override maxClients = 20;

  override onCreate(): void {
    this.state = new JungleState();
  }

  override onJoin(client: Client, options: { name?: string } = {}): void {
    const name =
      options.name?.trim().slice(0, MAX_PLAYER_NAME_LENGTH) ||
      `Player-${client.sessionId.slice(0, 4)}`;
    this.state.players.set(client.sessionId, new PlayerInfo({ name }));
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
  }

  override onDispose(): void {
    this.state.players.clear();
  }
}