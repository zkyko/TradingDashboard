import type { NextConfig } from "next";

/** Project Pages live at https://zkyko.github.io/TradingDashboard/ */
const basePath = process.env.GITHUB_PAGES === "true" ? "/TradingDashboard" : "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  turbopack: { root: process.cwd() },
  allowedDevOrigins: ["192.168.1.100", "127.0.0.1", "localhost"],
};

export default nextConfig;
