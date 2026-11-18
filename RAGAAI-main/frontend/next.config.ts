import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Admin-only pages moved into the admin portal; keep old links working (temporary 307s).
  async redirects() {
    return [
      { source: "/documents", destination: "/admin/documents", permanent: false },
      { source: "/evaluation", destination: "/admin/evaluation", permanent: false },
      { source: "/analytics", destination: "/admin", permanent: false },
      { source: "/settings", destination: "/admin/settings", permanent: false },
    ];
  },
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
