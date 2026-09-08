'use client';

// 导航图标：统一使用 Lucide 开源线性图标（黑白单色，currentColor 跟随主题）
// id 与各模块 tab 对齐：ask / breakfast / munger / zen / pools / radar / naval
import {
  Swords,         // 大师PK：对战/辩论
  Newspaper,      // 巴菲特的早餐：新闻
  FileText,       // 芒格财报：财报解读
  TrendingUp,     // 缠论：走势/短线
  Target,         // 大师的选股池：靶心
  Radar,          // 跟踪大师动态：雷达
  BookOpen,       // 纳瓦尔学堂：书
} from 'lucide-react';

const MAP = {
  ask: Swords,
  breakfast: Newspaper,
  munger: FileText,
  zen: TrendingUp,
  pools: Target,
  radar: Radar,
  naval: BookOpen,
};

export default function NavIcon({ id, size = 18, className = '' }) {
  const Cmp = MAP[id] || Radar;
  return <Cmp className={className} size={size} strokeWidth={1.8} aria-hidden="true" />;
}
