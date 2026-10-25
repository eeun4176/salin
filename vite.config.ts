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
 * Builds carry a Content Security Policy (see contentSecurityPolicy below).
 */

import { createHash } from "node:crypto";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

/** "city-vet.vercel.app/" or "https://city-vet.vercel.app" → "https://city-vet.vercel.app" ("" when unset or not a URL). */
function originOf(setting: string | undefined) {
  const value = setting?.trim() ?? "";
  try {
    return value ? new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).origin : "";
  } catch {
    return "";
  }
}

/**
 * The built app's Content Security Policy, as a <meta> tag so it follows each
 * build's VITE_CITY_VET_API_URL and VITE_AI_MODEL_HOST. The session token
 * lives in IndexedDB, so scripts come only from Salin itself (plus blob: and
 * WebAssembly for the OCR engine, and the hashed theme script in index.html),
 * and network calls go only to Salin, the City Vet server and the model host
 * with its download CDN.
 */
function contentSecurityPolicy(env: Record<string, string>): Plugin {
  return {
    name: "salin-csp",
    apply: "build",
    transformIndexHtml(html) {
      const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);
      const connect = ["'self'", originOf(env.VITE_CITY_VET_API_URL), originOf(env.VITE_AI_MODEL_HOST) || "https://huggingface.co", "https://*.huggingface.co", "https://*.hf.co", "blob:", "data:"];
      const policy = [
        "default-src 'self'",
        `script-src 'self' 'wasm-unsafe-eval' blob: ${inline.join(" ")}`,
        "worker-src 'self' blob:",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "media-src 'self' blob:",
        `connect-src ${connect.filter(Boolean).join(" ")}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ");
      return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" }];
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    contentSecurityPolicy(loadEnv(mode, process.cwd(), "VITE_")),
    react(),
    tailwindcss(),
    VitePWA({
      // The app shows its own "new version ready" toast (src/app/pwa.ts).
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.png", "icons/apple-touch-icon.png"],
      manifest: {
        // id stays "/" so phones that installed Salin update in place to e-Vet.
        id: "/",
        name: "e-Vet Field",
        short_name: "e-Vet",
        description: "The City Veterinary Office's field app for paravets, City of San Jose del Monte.",
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
}));
