import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // same "@/..." import alias as tsconfig, so route handlers can be imported in tests
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
});
