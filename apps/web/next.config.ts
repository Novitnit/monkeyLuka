import type { NextConfig } from "next";

const allowedOriginHost = process.env.ALLOWED_ORIGIN_HOST ?? "*";

const nextConfig: NextConfig = {
  allowedDevOrigins: [allowedOriginHost],
};

export default nextConfig;
