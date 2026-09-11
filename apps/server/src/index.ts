import { defineRoom, defineServer, WebSocketTransport } from "colyseus";
import { ROOM_NAMES } from "@monkeyluka/shared";
import { JungleRoom } from "./rooms/jungle-room";

const colyseusPort = Number(Bun.env.COLYSEUS_PORT ?? 2567);
const hostname = Bun.env.HOST ?? "0.0.0.0";
const allowedOriginHost = Bun.env.ALLOWED_ORIGIN_HOST ?? "*";
const ALLOWED_ORIGIN = new RegExp(
  `^https?://${allowedOriginHost.replaceAll(".", "\\.")}(?::\\d+)?$`,
);

const gameServer = defineServer({
  greet: false,
  transport: new WebSocketTransport({
    beforeUpgrade: (request) => {
      const origin = request.headers.get("origin");
      if (origin && !ALLOWED_ORIGIN.test(origin)) {
        return new Response(null, { status: 403 });
      }
    },
  }),
  rooms: {
    [ROOM_NAMES.jungle]: defineRoom(JungleRoom),
  },
});

try {
  await gameServer.listen(colyseusPort, hostname);
  console.log(`🎮 Colyseus ready at ws://localhost:${colyseusPort}`);
} catch (err) {
  console.error("Colyseus failed to start:", err);
  process.exit(1);
}

export { gameServer };