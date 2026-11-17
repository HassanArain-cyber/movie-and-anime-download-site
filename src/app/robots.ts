import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = "https://movie-and-anime-download-site.vercel.app";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin/", "/api/"] }],
    sitemap: base + "/sitemap.xml",
  };
}
