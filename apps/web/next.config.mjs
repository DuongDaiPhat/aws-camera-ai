/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker builds on Linux need standalone output. Local Windows builds use next start
  // and avoid symlink privileges required by standalone file tracing.
  output: process.platform === 'win32' ? undefined : 'standalone',
  transpilePackages: ['@cam/contracts'],
};

export default nextConfig;
