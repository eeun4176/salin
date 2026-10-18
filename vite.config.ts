/**
 * Vite Configuration
 * Build setup: React, Tailwind CSS, the "@/…" import alias, and the PWA
 * plugin that writes the web app manifest and a Workbox service worker which
 * precaches the app shell (HTML, JS, CSS, fonts, icons) for offline use.
 * User documents are never put in these caches — they live in IndexedDB.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The app shows its own "new version ready" toast (src/app/pwa.ts).
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Salin AI",
        short_name: "Salin",
        description: "Turn documents into structured data, on your device.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#F8FAF9",
        theme_color: "#F8FAF9",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        // Any in-app URL (e.g. /folders/…) opens from the cached app shell when offline.
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
