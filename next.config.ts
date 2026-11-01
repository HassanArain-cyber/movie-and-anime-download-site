import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Arena live preview is served from an e2b.app subdomain in development.
  allowedDevOrigins: ["*.e2b.app", "127.0.0.1", "localhost"],
  images: {
    // Existing external poster URLs remain supported. R2 posters are served
    // through /api/image as short-lived signed redirects and are unoptimized.
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
  // Video/archive bytes go directly from the browser to R2. Next.js only
  // handles JSON metadata and signed URLs, so no large server body is needed.
};

export default nextConfig;
