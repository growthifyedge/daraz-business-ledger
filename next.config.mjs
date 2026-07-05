/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      // Supabase Storage public objects (invoice / receipt uploads).
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
};

export default nextConfig;
