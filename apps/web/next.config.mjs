/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker builds on Linux need standalone output. Local Windows builds use next start
  // and avoid symlink privileges required by standalone file tracing.
  output: process.platform === 'win32' ? undefined : 'standalone',
  transpilePackages: ['@cam/contracts'],
  webpack(config, { dev }) {
    // Docker Desktop bind mounts do not reliably forward Windows file events.
    if (dev) config.watchOptions = { ...config.watchOptions, poll: 1000, aggregateTimeout: 150 };
    return config;
  },
};

export default nextConfig;
