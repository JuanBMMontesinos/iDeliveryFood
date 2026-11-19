import { buildHttpSecurityHeaders } from "@ideliveryfood/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    const secHeaders = buildHttpSecurityHeaders({ surface: "customer-web" });
    return [
      {
        source: "/(.*)",
        headers: Object.entries(secHeaders).map(([key, value]) => ({
          key,
          value,
        })),
      },
    ];
  },
};

export default nextConfig;
