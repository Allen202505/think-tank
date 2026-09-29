/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: false,
  output: 'standalone',
  poweredByHeader: false,
  images: { unoptimized: true },
  async redirects() {
    return [{ source: '/breakfast', destination: '/?tab=breakfast', permanent: false }]
  },
}

module.exports = nextConfig
