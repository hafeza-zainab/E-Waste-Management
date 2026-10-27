import type { NextConfig } from "next";

// Cache Components / partial prefetching are intentionally off: every page in
// ReLoop reads per-request state (cookie role + SQLite), so the classic
// dynamic-by-default model is simpler and safer. See DECISIONS.md.
const nextConfig: NextConfig = {
  cacheComponents: false,
  partialPrefetching: false,
  serverExternalPackages: ["@prisma/client", "pdf-lib"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
