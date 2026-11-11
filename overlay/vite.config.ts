import { defineConfig } from "vite";

// Single self-contained IIFE, injected by the Rust proxy into the user's dev-server HTML.
export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      name: "DivinaOverlay",
      formats: ["iife"],
      fileName: () => "divina-overlay.js",
    },
    emptyOutDir: true,
  },
});
