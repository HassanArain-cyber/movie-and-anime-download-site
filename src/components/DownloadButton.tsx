"use client";

import { useState } from "react";
import type { DownloadLink } from "@/lib/types";

export default function DownloadButton({ link }: { link: DownloadLink }) {
  const [broken, setBroken] = useState(false);

  // Uploaded files: stream through our API to force attachment download
  const href = link.url.startsWith("/uploads/")
    ? `/api/download?id=${link.id}`
    : link.url;

  const isExternal = !link.url.startsWith("/uploads/");

  return (
    <a
      href={href}
      {...(isExternal
        ? { target: "_blank", rel: "noopener noreferrer" }
        : { download: "" })}
      onError={() => setBroken(true)}
      className="inline-flex items-center gap-2 rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-white ring-1 ring-neutral-700 transition hover:bg-red-600 hover:ring-red-600"
    >
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"
        />
      </svg>
      <span>{link.label || "Download"}</span>
      {link.fileSize && (
        <span className="text-xs text-neutral-400">({link.fileSize})</span>
      )}
      {broken && (
        <span className="text-xs text-yellow-400">(may be unavailable)</span>
      )}
    </a>
  );
}
