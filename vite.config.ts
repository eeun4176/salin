/**
 * Vite Configuration
 * Build setup: React, Tailwind CSS, the "@/…" import alias, and the PWA
 * plugin that writes the web app manifest and a Workbox service worker which
 * precaches the app shell (HTML, JS, CSS, fonts, icons — including the
 * document parsers, the pdf.js worker, the image-preparation worker and the
 * small OCR engine worker script) for offline use. The OCR engine builds
 * (~4 MB each, one per kind of device) and language files are emitted as
 * assets but NOT precached: Salin downloads only the ones a device needs,
 * on demand, into its own Cache Storage (see model-manager.ts). So is the
 * WebLLM engine (6.6 MB), which only the laptop build of the assistant uses.
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
        // mjs: the pdf.js worker, so PDFs can be read offline. jpg/xlsx: the census sheet's logo and the office's workbook template.
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,jpg,xlsx,woff2,webmanifest}"],
        // OCR engine builds: downloaded on demand by the model manager, not by every visitor.
        globIgnores: ["**/tesseract-core-*", "**/web-llm-*"],
        // Any in-app URL (e.g. /folders/…) opens from the cached app shell when offline.
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    rollupOptions: {
      // A recognisable name for the WebLLM engine, so it can be left out of the precache above.
      output: { assetFileNames: (asset) => (asset.originalFileNames.some((name) => name.includes("@mlc-ai/web-llm")) ? "assets/web-llm-[hash][extname]" : "assets/[name]-[hash][extname]") },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
