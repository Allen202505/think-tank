import './globals.css'

export const metadata = {
  title: '大师吵股 · 世界投资大师智囊团',
  description: '邀请顶级投资大师激情辩论，为你参谋决策',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
