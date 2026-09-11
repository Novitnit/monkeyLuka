import { Elysia } from "elysia";
import { cors } from "@elysia/cors";
import {
  APP_NAME,
  compileOriginAllowlist,
  greeting,
  type HealthStatus,
} from "@monkeyluka/shared";

// Elysia's official "Integration with Next.js" pattern: the whole Elysia app
// mounts inside the App Router's catch-all route handler, and each HTTP
// method is forwarded to `app.fetch`. The REST API that used to run as the
// standalone `apps/server` :3001 process now lives here under /api.
//
// Route handlers run at request time by default; keep it that way so
// /api/health reports a live uptime instead of a prerendered value.
export const dynamic = "force-dynamic";

// Comma-separated host allowlist (same env var + semantics as the Colyseus
// WebSocket handshake gate in apps/server and Next's allowedDevOrigins).
// `*` (or unset) allows any origin.
const ALLOWED_ORIGIN = compileOriginAllowlist(process.env.ALLOWED_ORIGIN_HOST);

const app = new Elysia({ prefix: "/api" })
  .use(cors({ origin: ALLOWED_ORIGIN }))
  .get("/", () => ({
    name: APP_NAME,
    message: greeting("dev"),
  }))
  .get("/health", (): HealthStatus => ({
    ok: true,
    service: "monkeyluka-server",
    uptime: process.uptime(),
  }));

export const GET = app.fetch;
export const POST = app.fetch;
export const PUT = app.fetch;
export const PATCH = app.fetch;
export const DELETE = app.fetch;
export const OPTIONS = app.fetch;