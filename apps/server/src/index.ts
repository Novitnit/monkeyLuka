import { Server, WebSocketTransport } from "colyseus";
import { cors } from "@elysia/cors";
import { Elysia } from "elysia";
import { APP_NAME, greeting, type HealthStatus } from "@monkeyluka/shared";

const httpPort = Number(Bun.env.PORT ?? 3001);
const colyseusPort = Number(Bun.env.COLYSEUS_PORT ?? 2567);
const hostname = Bun.env.HOST ?? "0.0.0.0";
const allowedOriginHost = Bun.env.ALLOWED_ORIGIN_HOST ?? "*";
const ALLOWED_ORIGIN = new RegExp(
  `^https?://${allowedOriginHost.replaceAll(".", "\\.")}(?::\\d+)?$`,
);

const app = new Elysia()
  .use(cors({ origin: ALLOWED_ORIGIN }))
  .get("/", () => ({
    name: APP_NAME,
    message: greeting("dev"),
  }))
  .get("/health", (): HealthStatus => ({
    ok: true,
    service: "monkeyluka-server",
    uptime: process.uptime(),
  }))
  .listen({
    port: httpPort,
    hostname,
  });

console.log(`🦊 Elysia HTTP ready at http://localhost:${httpPort}`);

const gameServer = new Server({
  greet: false,
  transport: new WebSocketTransport({
    beforeUpgrade: (request) => {
      const origin = request.headers.get("origin");
      // Reject WebSocket handshakes from browsers on other hosts (origin absent
      // for non-browser clients, e.g. smoke-test scripts).
      if (origin && !ALLOWED_ORIGIN.test(origin)) {
        return new Response(null, { status: 403 });
      }
    },
  }),
});

await gameServer
  .listen(colyseusPort, hostname)
  .then(() => {
    console.log(`🎮 Colyseus ready at ws://localhost:${colyseusPort}`);
  })
  .catch((err) => {
    console.error("Colyseus failed to start:", err);
    process.exit(1);
  });

export { app };