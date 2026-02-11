import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // We serve our own WebP thumbnails from the backend -- no need for
    // Next.js Image Optimization. Using unoptimized to avoid double
    // processing and allow direct <img> tags with backend URLs.
    unoptimized: true,
  },
};

export default nextConfig;
