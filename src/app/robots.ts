import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const base = SITE_ORIGIN;
  return {
    rules: [{ userAgent: "*", allow: ["/", "/api/image", "/api/seo-poster"], disallow: ["/admin", "/api/"] }],
    sitemap: base + "/sitemap.xml",
  };
}
