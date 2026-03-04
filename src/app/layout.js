import './globals.css'
import { Analytics } from '@vercel/analytics/react'

export const metadata = {
  title: '大师吵股 - 世界投资大师智囊团 | AI投资决策辅助工具',
  description: '大师吵股是一个创新的投资决策辅助平台，汇聚巴菲特、芒格、索罗斯等世界顶级投资大师的智慧，通过AI模拟激烈辩论，为您的投资决策提供多角度专业参考。',
  keywords: '大师吵股,投资大师,巴菲特,芒格,索罗斯,投资决策,股票分析,AI投资顾问',
  authors: [{ name: '大师吵股团队' }],
  creator: '大师吵股',
  publisher: '大师吵股',
  applicationName: '大师吵股',
  generator: 'Next.js',
  referrer: 'origin-when-cross-origin',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://think-tank.example.com'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: '大师吵股 - 世界投资大师智囊团',
    description: '汇聚巴菲特、芒格、索罗斯等世界顶级投资大师的智慧，通过AI模拟激烈辩论，为您的投资决策提供多角度专业参考',
    url: '/',
    siteName: '大师吵股',
    locale: 'zh_CN',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: '大师吵股 - 世界投资大师智囊团',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '大师吵股 - 世界投资大师智囊团',
    description: '汇聚世界顶级投资大师智慧，AI模拟激烈辩论，助力投资决策',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    // google: 'your-google-verification-code',
    // baidu: 'your-baidu-verification-code',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <meta name="theme-color" content="#c9a84c" />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
