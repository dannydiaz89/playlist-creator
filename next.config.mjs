/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Deezer serves catalog artwork from its CDN.
    remotePatterns: [{ protocol: 'https', hostname: '*.dzcdn.net' }],
  },
};
export default nextConfig;
