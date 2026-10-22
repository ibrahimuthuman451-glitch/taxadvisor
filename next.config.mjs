/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // xlsx ships CJS only — keep it external to the server bundle.
    serverComponentsExternalPackages: ["xlsx"],
  },
};

export default nextConfig;
