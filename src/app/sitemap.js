import { PRESET_MASTERS } from '../data/masters';

export default function sitemap() {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://think-tank.example.com'
  const now = new Date()

  return [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/masters`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...PRESET_MASTERS.map((m) => ({
      url: `${baseUrl}/masters/${m.id}`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    })),
  ]
}
