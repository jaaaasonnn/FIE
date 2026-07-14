import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack is default in Next.js 16. maplibre-gl is loaded client-side only
  // via dynamic({ ssr: false }) — no alias needed.
  turbopack: {},
};

export default nextConfig;
