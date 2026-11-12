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
      <div className="relative isolate aspect-square w-[min(84vw,420px)]">
        <div aria-hidden="true" className="absolute inset-1 rounded-[18%] bg-violet-500/70 blur-2xl" />
        <div className="relative h-full w-full overflow-hidden rounded-[18%] border-[3px] border-fuchsia-300 shadow-[0_0_35px_rgba(179,75,255,0.70),0_0_75px_rgba(126,34,206,0.30)]">
          <Image
            src="/images/anime_tracker_loading_screen-1.png"
            fill
            sizes="(max-width: 500px) 84vw, 420px"
            alt=""
            priority
            unoptimized
            className="object-cover"
          />
        </div>
      </div>
    </div>
  );
}
