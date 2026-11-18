import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // server-only throws outside React Server Components; tests import server modules directly.
    alias: { "server-only": path.resolve(import.meta.dirname, "tests/helpers/server-only-stub.ts") },
  },
});
