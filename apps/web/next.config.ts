import type { NextConfig } from "next";

// Comma-separated list of extra origins allowed in Next dev (mirrors the
// server's ALLOWED_ORIGIN_HOST). Next allows localhost by default; entries
// here add LAN hosts. Avoid "*" — Next treats it as a literal origin value,
// so prefer explicit hosts.
const allowedOriginHosts = (process.env.ALLOWED_ORIGIN_HOST ?? "*")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: allowedOriginHosts,
  // @monkeyluka/shared ships raw .ts (no build step) — Turbopack needs the
  // hint to transpile it.
  transpilePackages: ["@monkeyluka/shared"],
};

export default nextConfig;
