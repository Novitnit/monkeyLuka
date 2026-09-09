import { Client } from "@colyseus/sdk";

/**
 * Shared Colyseus client for the browser. The endpoint defaults to the page's
 * own host on the Colyseus port (2567) so LAN dev — loading the site from
 * another machine — reaches the same server that served the page. Override
 * with NEXT_PUBLIC_COLYSEUS_ENDPOINT for a different host/port.
 */
const defaultEndpoint = `ws://${
  typeof window !== "undefined" ? window.location.hostname : "localhost"
}:2567`;

export const colyseusClient = new Client(
  process.env.NEXT_PUBLIC_COLYSEUS_ENDPOINT ?? defaultEndpoint,
);
