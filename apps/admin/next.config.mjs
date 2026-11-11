/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  experimental: { serverActions: { bodySizeLimit: '1mb' } },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ] }];
  },
};
export default config;
