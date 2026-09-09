import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // If an internal package ships raw TypeScript (see packages/shared), list it
  // here so Turbopack can follow its bare `.ts` exports:
  // transpilePackages: ["@monkeyluka/shared"],
};

export default nextConfig;
