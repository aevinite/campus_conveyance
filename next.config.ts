import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next doesn't pick up an unrelated lockfile
  // elsewhere on the machine.
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    // Add Bus uploads a bus photo + optional driver photo (up to ~6 MB each)
    // via a Server Action; the default 1 MB body cap rejects them, so raise it.
    serverActions: {
      bodySizeLimit: '15mb',
    },
  },
  // Baseline security headers on every response. frame-ancestors/X-Frame-Options
  // stop other sites embedding the payment/admin pages (clickjacking); the native
  // app loads the site top-level in its WebView, so it isn't affected.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
