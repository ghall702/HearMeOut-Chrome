import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
// @ts-expect-error — plain ESM helper without types
import { buildManifest } from "./scripts/manifest.mjs";

const PROD = { hmo: "https://hearmeout.george-hall.uk", media: "https://mediahub-lm-1.georgehalltuition.com" };
const E2E = { hmo: "http://127.0.0.1:8787", media: "http://127.0.0.1:8788" };

function manifestPlugin(origins: { hmo: string; media: string }, includeKey: boolean): Plugin {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as { version: string };
  return {
    name: "hmo-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(buildManifest({ version: pkg.version, hmoOrigin: origins.hmo, mediaOrigin: origins.media, includeKey }), null, 2),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const e2e = mode === "e2e";
  const origins = e2e ? E2E : PROD;
  return {
    root: resolve(__dirname, "src"),
    publicDir: resolve(__dirname, "public"),
    base: "./",
    define: {
      "import.meta.env.VITE_HMO_ORIGIN": JSON.stringify(origins.hmo),
      "import.meta.env.VITE_MEDIA_ORIGIN": JSON.stringify(origins.media),
    },
    plugins: [react(), manifestPlugin(origins, process.env["HMO_NO_KEY"] !== "1")],
    build: {
      outDir: resolve(__dirname, e2e ? "dist-e2e" : "dist"),
      emptyOutDir: true,
      target: "chrome116",
      modulePreload: { polyfill: false },
      sourcemap: mode === "development",
      minify: mode !== "development",
      rollupOptions: {
        input: {
          popup: resolve(__dirname, "src/popup.html"),
          offscreen: resolve(__dirname, "src/offscreen.html"),
          permission: resolve(__dirname, "src/permission.html"),
          background: resolve(__dirname, "src/background/index.ts"),
        },
        output: {
          entryFileNames: (c) => (c.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        },
      },
    },
  };
});
