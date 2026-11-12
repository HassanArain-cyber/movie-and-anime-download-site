"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export default function VaultStartupSplash() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Disappear on the first paint after hydration; never delay app readiness.
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-[#09090b] transition-opacity duration-200 motion-reduce:transition-none ${ready ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      <Image
        src="/images/anime_tracker_loading_screen-1.png"
        width={864}
        height={1536}
        alt=""
        priority
        unoptimized
        className="h-[100dvh] w-full object-contain"
      />
    </div>
  );
}
