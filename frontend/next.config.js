/** @type {import('next').NextConfig} */
const path = require('path');
const { loadEnvConfig } = require('@next/env');

// Load environment variables from parent root directory
loadEnvConfig(path.resolve(__dirname, '..'));

const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  optimizeFonts: false,
  async rewrites() {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 
      (process.env.NODE_ENV === 'production' ? 'http://backend:8000' : 'http://localhost:8000');
    return {
      afterFiles: [
        {
          source: '/api/:path*',
          destination: `${backendUrl}/api/:path*`,
        },
        {
          source: '/project/detail/:tab(overview|tasks|meetings|chats|members|audit-logs)',
          destination: '/project/detail?tab=:tab',
        },
      ],
    }
  },
}

module.exports = nextConfig

