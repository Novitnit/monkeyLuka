import { Server } from "colyseus";
import { Elysia } from "elysia";
import { APP_NAME, greeting, type HealthStatus } from "@monkeyluka/shared";

const httpPort = Number(Bun.env.PORT ?? 3001);
const colyseusPort = Number(Bun.env.COLYSEUS_PORT ?? 2567);
const hostname = Bun.env.HOST ?? "0.0.0.0";

const app = new Elysia()
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

const gameServer = new Server({ greet: false });

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