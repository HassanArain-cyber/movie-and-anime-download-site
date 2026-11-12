import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import UpdatesProvider from "@/components/UpdatesProvider";
import Navbar from "@/components/Navbar";
import CopyToast from "@/components/CopyToast";
import PwaRegister from "@/components/PwaRegister";
import WallpaperBackground from "@/components/WallpaperBackground";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gojo’s Vault — Movies, Anime & Series",
  description: "A lightweight library for movies, anime, and TV series with direct downloads.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/pwa-icon/192?v=2", sizes: "192x192", type: "image/png" },
      { url: "/pwa-icon/512?v=2", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/pwa-icon/512?v=2", sizes: "512x512", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "Vault", statusBarStyle: "black-translucent" },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#200c38",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="relative min-h-screen bg-neutral-950 text-neutral-200 antialiased">
        <WallpaperBackground />
        <a href="#main-content" className="vault-skip">Skip to content</a>
        <UpdatesProvider>
        <Navbar />
        <CopyToast />
        <PwaRegister />
        <main id="main-content" className="relative z-10 mx-auto w-full max-w-7xl px-4 py-6 pb-10 sm:px-6 lg:px-8">
          {children}
        </main>
        <footer className="relative z-10 mt-8 border-t border-neutral-900 py-6 pb-12">
          <div className="mx-auto max-w-7xl px-4 text-center text-xs text-neutral-300/70 sm:px-6">
            Gojo’s Vault · Movies, anime & series. Your collection, beautifully organized.
          </div>
        </footer>
        </UpdatesProvider>
      </body>
    </html>
  );
}
