"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export default function VaultStartupSplash() {
  const [ready, setReady] = useState(false);

  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    if (!imageLoaded) return;
    // Keep the real startup image visible until decoded and painted.
    // No artificial delay is added to the app opening.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setReady(true));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [imageLoaded]);

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-[#200c38] transition-opacity duration-200 motion-reduce:transition-none ${ready ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      <Image
        src="/images/anime_tracker_loading_screen-1.png"
        width={864}
        height={1536}
        alt=""
        priority
        unoptimized
        onLoad={() => setImageLoaded(true)}
        onError={() => setReady(true)}
        className="h-[100dvh] w-full object-contain"
      />
    </div>
  );
}
