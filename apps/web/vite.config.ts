import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const geistFonts = fileURLToPath(new URL("./node_modules/geist/dist/fonts", import.meta.url));

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@geist-fonts": geistFonts } },
  build: { outDir: "dist", target: "es2022", chunkSizeWarningLimit: 1500 },
  server: { proxy: { "/api": process.env.MARQUM_API ?? "http://localhost:8787" } },
});
