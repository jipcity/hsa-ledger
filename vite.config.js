import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [react(), VitePWA({
    registerType: "autoUpdate",
    includeAssets: ["icon.svg"],
    manifest: {
      name: "Deductible ledger",
      short_name: "Ledger",
      description: "Track medical spending against an HSA and HRA deductible.",
      theme_color: "#16292e",
      background_color: "#eff2ec",
      display: "standalone",
      orientation: "portrait",
      icons: [
        { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
      ],
    },
    workbox: {
      globPatterns: ["**/*.{js,css,html,svg,woff2}"],
      maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
    },
  })],
});