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
};

export default nextConfig;
