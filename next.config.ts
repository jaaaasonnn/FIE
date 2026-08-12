import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack is default in Next.js 16. maplibre-gl is loaded client-side only
  // via dynamic({ ssr: false }) — no alias needed.
  //
  // root is pinned explicitly because a stray lockfile in a parent folder
  // was making Turbopack infer the wrong workspace root on some runs,
  // which changes its internal module hashes and corrupts the dev cache
  // ("Cannot find module '@swc/helpers-<hash>/...'").
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
