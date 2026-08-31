import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./tests/cloudflare-workers.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}", "bot/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
