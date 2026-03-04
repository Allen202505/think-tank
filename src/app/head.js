export default function Head() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: '大师吵股',
    alternateName: '世界投资大师智囊团',
    description: '汇聚巴菲特、芒格、索罗斯等世界顶级投资大师的智慧，通过AI模拟激烈辩论，为您的投资决策提供多角度专业参考',
    url: process.env.NEXT_PUBLIC_SITE_URL || 'https://think-tank.example.com',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'CNY',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      ratingCount: '100',
    },
    author: {
      '@type': 'Organization',
      name: '大师吵股团队',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}
