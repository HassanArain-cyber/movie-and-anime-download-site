"use client";

import Image from "next/image";
import { useState } from "react";
import { needsUnoptimizedImage, placeholderPoster } from "@/lib/utils";

/** Keep failed or removed remote posters inside the same reserved aspect ratio. */
export default function PosterImage({ src, title, sizes, className = "object-contain" }: {
  src: string | null;
  title: string;
  sizes: string;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const resolved = src && failedSource !== src ? src : placeholderPoster(title);
  return <Image src={resolved} alt={title} fill sizes={sizes} className={className}
    unoptimized={needsUnoptimizedImage(resolved)} onError={() => { if (src) setFailedSource(src); }} />;
}
