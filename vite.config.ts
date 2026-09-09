import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
  },
  // SELF-HOST: build a Node server (runs in docker) instead of the default cloudflare worker.
  nitro: { preset: "node-server" },
});
