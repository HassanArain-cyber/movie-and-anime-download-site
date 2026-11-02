import type { Metadata } from "next";
import type { ReactNode } from "react";
import Navbar from "@/components/Navbar";
import WallpaperBackground from "@/components/WallpaperBackground";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vault — Movies, Anime & Series",
  description:
    "A lightweight library for movies, anime, and TV series with direct downloads.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="relative min-h-screen bg-neutral-950 text-neutral-200 antialiased">
        <WallpaperBackground />
        <Navbar />
        <main className="relative z-10 mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
        <footer className="relative z-10 mt-16 border-t border-neutral-900 py-6">
          <div className="mx-auto max-w-7xl px-4 text-center text-xs text-neutral-300/70 sm:px-6">
            Vault — a private media library.
          </div>
        </footer>
      </body>
    </html>
  );
}
