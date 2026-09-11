import type Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import type { JungleRoomState } from "@monkeyluka/shared";

/** A joined jungle room, typed with its synced state. */
export type JungleRoom = Room<unknown, JungleRoomState>;

/**
 * Boot the Phaser jungle client inside `parent` and return the game instance.
 *
 * Phaser is imported dynamically on purpose: its bundle touches `window` at
 * module scope, so it must never load during server-side rendering. This
 * function only ever runs from a browser effect.
 */
export async function createJungleGame(
  parent: HTMLElement,
  room: JungleRoom,
): Promise<Phaser.Game> {
  const Phaser = await import("phaser");

  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#0b0e14",
    width: 1280,
    height: 720,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: {
      create(this: Phaser.Scene) {
        const { width, height } = this.scale;

        this.cameras.main.setBackgroundColor("#0b0e14");

        const title = this.add
          .text(width / 2, height / 2 - 90, "monkeyLuka", {
            fontFamily: "sans-serif",
            fontSize: "56px",
            fontStyle: "bold",
            color: "#fafafa",
          })
          .setOrigin(0.5);

        const me = room.state?.players.get(room.sessionId);
        const name = me?.name ?? "unknown";

        const connected = this.add
          .text(
            width / 2,
            height / 2 + 4,
            `Connected to the jungle as "${name}"`,
            {
              fontFamily: "sans-serif",
              fontSize: "22px",
              color: "#fbbf24",
            },
          )
          .setOrigin(0.5);

        this.add
          .text(width / 2, height / 2 + 44, `room ${room.roomId}`, {
            fontFamily: "sans-serif",
            fontSize: "15px",
            color: "#71717a",
          })
          .setOrigin(0.5);

        this.add
          .text(width / 2, height / 2 + 110, "Gameplay is being built…", {
            fontFamily: "sans-serif",
            fontSize: "15px",
            color: "#a1a1aa",
            fontStyle: "italic",
          })
          .setOrigin(0.5);

        this.tweens.add({
          targets: [title, connected],
          alpha: { from: 0, to: 1 },
          duration: 400,
        });
      },
    },
  });
}
