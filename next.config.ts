import type { NextConfig } from "next";

// Cache Components / partial prefetching are intentionally off: every page in
// ReLoop reads per-request state (cookie role + SQLite), so the classic
// dynamic-by-default model is simpler and safer. See DECISIONS.md.
const isDev = process.env.NODE_ENV !== "production";

/**
 * CSP. Next.js needs inline bootstrap scripts, so script-src allows 'unsafe-inline' (a nonce-based CSP would
 * force fully dynamic rendering of every page). PayPal's JS SDK, checkout popup/iframes and API calls are
 * allowed for both sandbox and live hosts. Everything else is same-origin.
 */
const PAYPAL = "https://www.paypal.com https://www.sandbox.paypal.com https://*.paypal.com https://*.paypalobjects.com";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${PAYPAL}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${PAYPAL}`,
  "font-src 'self' data:",
  "media-src 'self'",
  `connect-src 'self' ${PAYPAL}`,
  `frame-src ${PAYPAL}`,
  `form-action 'self' ${PAYPAL}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
        ],
      },
    ];
  },
  serverExternalPackages: ["@prisma/client", "pdf-lib", "qrcode"],
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
