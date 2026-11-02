"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export default function WallpaperBackground() {
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/site-settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { wallpaperUrl?: unknown } | null) => {
        if (active && (typeof data?.wallpaperUrl === "string" || data?.wallpaperUrl === null)) {
          setWallpaperUrl(data.wallpaperUrl);
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!wallpaperUrl) return null;
  return (
    <div aria-hidden="true" data-testid="site-wallpaper" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <Image src={wallpaperUrl} alt="" fill sizes="100vw" priority unoptimized className="object-cover object-center" />
      <div className="absolute inset-0 bg-black/70" />
    </div>
  );
}
