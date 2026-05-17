/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'
const repoBase = '/fc-cm-web-parser'

const nextConfig = {
  output: "export", // Enables static export
  basePath: isProd ? repoBase : '',
  assetPrefix: isProd ? `${repoBase}/` : '',
  images: {
    unoptimized: true, // Disable image optimization since it's not supported on GitHub Pages
  },
};

export default nextConfig;
