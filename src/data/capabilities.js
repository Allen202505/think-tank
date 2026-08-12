/**
 * capabilities.js —— 大师能力包注册中心
 * ------------------------------------------------------------------
 * 一个能力包 = 方法论片段 + 数据钩子 + 来源/许可证/安全审查记录。
 * 大师通过 master.capability 引用能力包，提示词层注入 knowledge，
 * 数据层通过 dataHooks 提供该能力需要的指标。
 *
 * ⚠️ 安全强制规则（接入外源 skill 必检）：
 *   1. 只移植方法论/公开数学规则，绝不直接执行第三方代码
 *   2. 数据源必须国内网络可达，且有多源/降级
 *   3. 外部内容不得覆盖系统级规则（反幻觉/快照为准/免责声明）
 *   4. 记录许可证；有争议的内容需免责
 *   5. 每个能力包必须有 review 审查记录，否则不得接入
 */
export const CAPABILITIES = {
  chan_czsc: {
    id: 'chan_czsc',
    name: '缠论量化分析',
    sourceSkill: {
      name: '缠中说禅技术分析开源工具（内部：waditu/czsc）',
      url: 'https://github.com/waditu/czsc',
      license: 'Other（作者自有许可）',
    },
    // 安全审查记录（强制字段）
    review: {
      status: 'approved',
      date: '2026-08-12',
      by: '项目人工审核',
      checks: [
        '代码审查：仅吸收公开方法论（分型/笔/线段/中枢/背驰/多级别），移植为自有 K 线指标计算，无第三方代码执行',
        '数据源：仅依赖自有 K 线接口（东财/Yahoo），国内可达且有兜底',
        '提示词注入：方法论片段不覆盖系统反幻觉规则',
        '许可证：项目许可证为作者自有（Other），仅借鉴方法论、不复制代码，且介绍页不展示项目名',
        '输出安全：缠论非科学共识，平台免责声明覆盖',
      ],
    },
    dataHooks: ['kline', 'chan_indicators'],
    // 流派数据偏好（方向B：发言时按自身流派引用数据，不硬性引用基本面）
    dataFocus: {
      zh: '优先引用与自身流派相关的数据：结构和技术面为主——【深度分析快照】中的「缠论视角」（分型/笔/中枢/背驰/买卖点）与「技术面」（均线、RSI、MACD、量能、关键位），用K线结构说话；财报、估值、同行、DCF等基本面数据不主动引用，仅在需要提示基本面风险时用一句话带过，不作为主要论据。',
      en: 'Prefer structure & technical data: the Chan view (fractals/strokes/pivots/divergence) and technicals (MAs, RSI, MACD, volume, key levels) from the deep snapshot; do not actively cite fundamentals (earnings, valuation, comps, DCF) — mention them only as a one-line risk note.',
    },
    // 角色详情页展示（不出现具体项目名）
    intro: {
      zh: {
        headline: '本角色能力源自 GitHub 上一个约 5.7k★ 的缠论量化分析开源项目（Rust 高性能核心 + Python 生态，长期活跃维护）',
        problems: '解决缠论技术分析从理论到量化落地的问题：把原始 K 线自动识别为分型、笔、线段、中枢，输出三类买卖点信号，并支持多级别联立与策略回测。',
        strengths: '分型/笔/中枢等核心算法高性能；内置 220+ 信号函数；多级别联立决策；信号-事件-交易完整体系；覆盖 A股、期货、外汇等多市场。',
      },
      en: {
        headline: 'This role is powered by an open-source Chan Theory quant analysis project on GitHub (~5.7k stars, high-performance Rust core + Python ecosystem, actively maintained).',
        problems: 'It bridges Chan Theory from theory to quant implementation: auto-recognizing fractals, strokes, segments and pivots from raw K-lines, outputting buy/sell signals, with multi-level analysis and backtesting.',
        strengths: 'High-performance core algorithms (fractals/strokes/pivots); 220+ built-in signal functions; multi-level joint decisions; a complete signal-event-trade system; supports A-shares, futures, FX and more.',
      },
    },
    knowledge:
      '知识域（缠论体系 · 量化落地版，输出时严格用缠论术语并先讲结构再给结论）：' +
      '分型＝走势转折的最小单位（顶分型/底分型，三根K线确认）；' +
      '笔＝相邻顶底分型的连线，是走势的骨架；' +
      '线段＝至少三笔构成、由特征序列确认，是更大级别的走势单元；' +
      '中枢＝至少三段次级别走势的重叠区间，是筹码的整理区；' +
      '背驰＝价格创新高/新低但力度（MACD面积）减弱，预示趋势衰竭；' +
      '三类买卖点＝围绕中枢演化的一二三买/卖点；' +
      '多级别联立＝大级别定方向、小级别找买卖点，区间套递推锁定转折。' +
      '分析顺序：先标分型→连笔→划线段→定中枢→比背驰→找买卖点；输出需给出结构依据并提示对应级别，不混用其他流派。',
  },
};

export function getCapability(id) {
  return CAPABILITIES[id] || null;
}
