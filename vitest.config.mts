import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global.ts"],
    env: { DATABASE_URL: "file:./test.db", PAYPAL_CLIENT_ID: "", PAYPAL_CLIENT_SECRET: "", PAYPAL_SIMULATE_APPROVAL: "", DEMO_ACTIONS: "true", DEMO_MODE: "true", ANTHROPIC_API_KEY: "" },
    fileParallelism: false,
  },
});
