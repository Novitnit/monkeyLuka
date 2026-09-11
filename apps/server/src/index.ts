import { createRouter, defineRoom, defineServer, playground, WebSocketTransport } from "colyseus";
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
  // `skipTrailingSlashes` — rou3's radix router (and better-call's stricter
  // trailing-slash consistency check on top of it) treats `/playground` and
  // `/playground/` as distinct; both 404/blank-page without this, because the
  // playground registers only `/playground/` + `/playground/**:splat`.
  routes: createRouter(
    {
      ...playground({ prefix: "/playground" }),
    },
    { skipTrailingSlashes: true },
  )
});

try {
  await gameServer.listen(colyseusPort, hostname);
  console.log(`🎮 Colyseus ready at ws://localhost:${colyseusPort}`);
} catch (err) {
  console.error("Colyseus failed to start:", err);
  process.exit(1);
}

export { gameServer };