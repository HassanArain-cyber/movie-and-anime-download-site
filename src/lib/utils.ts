// Simple slugify for URL-friendly titles
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// Format bytes into human-readable size (e.g. 1.2 GB)
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i < 2 ? 0 : 1)} ${units[i]}`;
}

// Parse user-provided size string (e.g. "1.5 GB") to bytes, or return the string
export function parseSize(input: string): string {
  if (!input) return "";
  return input.trim();
}

export { needsUnoptimizedImage } from "./media-links";

// Basic placeholder poster SVG as data URL (when no poster provided)
export function placeholderPoster(title: string): string {
  const letter = (title || "?").charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1f2937"/><stop offset="100%" stop-color="#111827"/>
    </linearGradient></defs>
    <rect width="300" height="450" fill="url(#g)"/>
    <text x="150" y="240" font-family="sans-serif" font-size="120" fill="#4b5563" text-anchor="middle" font-weight="bold">${letter}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
