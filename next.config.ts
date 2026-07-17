import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  turbopack: { root: process.cwd() },
  // Dev-only convenience when opening via LAN IP.
  allowedDevOrigins: ["192.168.1.100", "127.0.0.1", "localhost"],
};

export default nextConfig;
