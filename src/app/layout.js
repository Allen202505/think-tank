import './globals.css'
import { Analytics } from '@vercel/analytics/react'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://think-tank.example.com'

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export const metadata = {
  title: '大师吵股 - AI投资大师智囊团：大师实盘联赛、大师PK、巴菲特早餐、财报解读、缠论短线、大师选股池、纳瓦尔知识学堂',
  description: '大师吵股汇聚巴菲特、利弗莫尔、威科夫、达瓦斯等投资大师。大师实盘联赛公开赛邀请六位已故历史投机大师，按真实 A 股行情模拟 10 万元投资比赛；另有大师PK、巴菲特的早餐、芒格财报解读、缠论短线、大师选股池、纳瓦尔知识学堂等功能。',
  keywords: '大师吵股,大师实盘联赛,利弗莫尔,威科夫,达瓦斯,杰拉尔德勒布,科斯托拉尼,伯纳德巴鲁克,真实行情,模拟交易,大师PK,巴菲特早餐,新闻解读,事件穿透,芒格读财报,财报解读,缠论,短线分析,大师选股池,纳瓦尔,知识学堂,投资大师,投资决策,AI投资顾问',
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
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: '大师吵股 - 世界投资大师智囊团',
    description: 'AI 模拟利弗莫尔、威科夫、达瓦斯等历史投机大师：大师实盘联赛、大师PK、新闻解读、财报解读、缠论短线、大师选股池与纳瓦尔知识学堂',
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
    description: '大师实盘联赛、大师PK、巴菲特早餐、财报解读、缠论短线、大师选股池与纳瓦尔知识学堂，用真实行情与 AI 模拟大师智慧',
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
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
    other: {
      'baidu-site-verification':
        process.env.NEXT_PUBLIC_BAIDU_SITE_VERIFICATION || 'codeva-SZct0NDaHJ',
      'msvalidate.01': process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION || undefined,
    },
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" type="image/png" href="/favicon.png" sizes="180x180" />
        <link rel="apple-touch-icon" href="/favicon.png" />
        <meta name="theme-color" content="#c9a84c" />
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebSite",
              "name": "大师吵股",
              "alternateName": "Master Debate AI",
              "url": siteUrl,
              "inLanguage": "zh-CN",
              "description": "AI 投资大师智囊团：大师实盘联赛、大师PK、巴菲特早餐新闻解读、芒格财报解读、缠论短线、大师选股池"
            },
            {
              "@type": "WebApplication",
              "name": "大师吵股",
              "applicationCategory": "FinanceApplication",
              "url": siteUrl,
              "operatingSystem": "Web",
              "description": "AI 模拟巴菲特等投资大师进行多角度分析与解读，含纳瓦尔知识学堂的辅助工具",
              "offers": { "@type": "Offer", "price": "0", "priceCurrency": "CNY" }
            },
            {
              "@type": "ItemList",
              "name": "大师吵股核心能力",
              "itemListElement": [
                { "@type": "ListItem", "position": 1, "name": "大师PK", "description": "多大师 AI 模拟辩论，多元视角碰撞" },
                { "@type": "ListItem", "position": 2, "name": "巴菲特的早餐", "description": "新闻事件穿透解读，捕捉投资机会点" },
                { "@type": "ListItem", "position": 3, "name": "芒格教你读财报", "description": "财报链接/附件上传，深入浅出解读" },
                { "@type": "ListItem", "position": 4, "name": "缠中说禅看短线", "description": "缠论方法做短线分析评估" },
                { "@type": "ListItem", "position": 5, "name": "大师的选股池", "description": "预置大师选股池，区间统计与持仓追踪" },
                { "@type": "ListItem", "position": 6, "name": "纳瓦尔知识学堂", "description": "财务与投资知识点深入浅出讲解，每日投资知识点" },
                { "@type": "ListItem", "position": 7, "name": "大师实盘联赛", "description": "六位已故历史投机大师用 10 万元虚拟账户按真实 A 股行情交易比赛" }
              ]
            }
          ]
        })
      }}
    />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t!=='dark'&&t!=='light'&&t!=='white'){t='white';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`,
          }}
        />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
