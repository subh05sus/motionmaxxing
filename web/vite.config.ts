import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": path.join(here, "src"), "@shared": path.join(here, "..", "src", "shared") } },
  server: { port: 5198, proxy: { "/api": "http://127.0.0.1:5199", "/media": "http://127.0.0.1:5199" } },
  build: { outDir: path.join(here, "dist"), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
