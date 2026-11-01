import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow arbitrary remote images; using unoptimized for external URLs already,
    // but we list common patterns so next/image can render them.
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  // Increase API body size for video uploads
  experimental: {
    serverActions: {
      bodySizeLimit: "2gb",
    },
  },
};

export default nextConfig;
