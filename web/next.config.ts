import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static export not needed — we need API routes
  output: 'standalone',
};

export default nextConfig;