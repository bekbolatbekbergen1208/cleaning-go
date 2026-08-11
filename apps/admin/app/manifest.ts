import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name: 'Cleaning Go', short_name: 'Cleaning Go', description: 'Маркетплейс клининговых услуг', start_url: '/', display: 'standalone', background_color: '#f8fafc', theme_color: '#087562', lang: 'ru', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] };
}
