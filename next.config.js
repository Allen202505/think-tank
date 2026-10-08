/** @type {import('next').NextConfig} */
const fs = require('fs');
const path = require('path');

function resolveBuildCommit() {
  try {
    const fileCommit = fs.readFileSync(path.join(__dirname, '.deploy-commit'), 'utf8').trim();
    if (fileCommit) return fileCommit;
  } catch (e) { /* 本地构建没有部署标记时回退环境变量 */ }
  return process.env.GIT_COMMIT || 'dev';
}

const nextConfig = {
  env: { BUILD_COMMIT: resolveBuildCommit() },
  turbopack: { root: __dirname },
  productionBrowserSourceMaps: false,
  output: 'standalone',
  poweredByHeader: false,
  images: { unoptimized: true },
  async redirects() {
    return [{ source: '/breakfast', destination: '/?tab=breakfast', permanent: false }]
  },
}

module.exports = nextConfig
