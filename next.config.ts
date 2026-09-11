import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output keeps the production image small (only traced deps get copied).
  output: 'standalone',
  experimental: {
    // Server Actions receive multipart form data for ticket attachments.
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default nextConfig;
