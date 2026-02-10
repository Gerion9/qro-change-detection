/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp ya viene incluido en Vercel, pero por si acaso:
  experimental: {
    serverComponentsExternalPackages: ['sharp'],
  },
};

export default nextConfig;

