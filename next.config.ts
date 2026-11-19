import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["**.run.app", "localhost", "127.0.0.1"],
  experimental: {
    serverActions: {
      allowedOrigins: [
        "**.run.app",
        "**.workers.dev",
        "**.pages.dev",
        "localhost:3000",
        "127.0.0.1:3000",
      ],
    },
  },
};

export default nextConfig;

// Only initialize local Miniflare/workerd bindings when explicitly opted in via CLOUDFLARE_DEV=true
// (standard `next dev` does not need workerd unless calling `getCloudflareContext()`).
if (process.env.NODE_ENV === "development" && process.env.CLOUDFLARE_DEV === "true") {
  void import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
}
