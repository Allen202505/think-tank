const perspectives = require('../data/perspectives');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debateResult(question) {
  const topic = String(question || '').trim() || '财经概念';
  const isMargin = /安全边际/.test(topic);
  const baseSummary = isMargin
    ? '安全边际不是简单的“价格低”，而是价格与保守估计价值之间的缓冲。'
    : `这次演示会从多个框架拆解“${topic}”，帮助你看清概念、假设和边界。`;

  const sections = perspectives.slice(0, 3).map((item, index) => {
    const copies = isMargin
      ? [
          '先估算企业在保守情景下能产生的长期现金流，再比较当前价格是否留出足够缓冲。关键不是追求精确，而是避免在乐观假设上再加乐观。',
          '反过来想：如果收入增长放缓、成本上升或竞争加剧，当前的判断还成立吗？安全边际的作用是承受判断错误，而不是保证结果一定正确。',
          '安全边际也要看资产所处环境。利率、通胀和行业景气变化会改变估值中枢，因此同一个价格在不同环境下并不代表相同的缓冲。',
        ]
      : [
          `价值框架先问：它是否创造了可持续的现金流，当前理解是否留有保守空间。重点是识别假设，而不是急着给结论。`,
          `逆向框架先问：如果结论错了，最可能错在哪里？通过反例、失败路径和风险清单检验“${topic}”是否被过度简化。`,
          `宏观框架关注利率、周期和流动性的传导。它们会影响不同资产和行业的相对表现，但传导方向和时滞都存在不确定性。`,
        ];
    return {
      id: item.id,
      heading: item.label,
      content: copies[index] || copies[0],
      question: isMargin ? '你的估算中，哪一个假设最经不起压力测试？' : '这个概念在什么条件下会失效？',
    };
  });

  return {
    title: isMargin ? '安全边际的三重视角' : '多视角财经笔记',
    summary: baseSummary,
    sections,
    takeaway: '先分清事实、假设与判断，再讨论结论是否可靠。',
    keywords: isMargin ? ['安全边际', '估值', '风险缓冲'] : ['财经通识', '多视角', '不确定性'],
  };
}

function readingResult() {
  return {
    title: '公开市场操作学习卡',
    summary: '公开市场操作会影响短端资金价格，并通过银行负债、债券定价和风险偏好向市场传导。',
    points: [
      { label: '发生了什么', content: '央行通过公开市场操作调节银行体系流动性，操作规模和期限是主要观察点。' },
      { label: '为什么重要', content: '短端资金价格会改变金融机构的融资成本，并影响债券等资产的定价环境。' },
      { label: '可能影响', content: '影响可能沿银行负债成本、收益率曲线和风险偏好传导，但方向和幅度取决于经济基本面。' },
      { label: '不同解读', content: '一种解读强调流动性宽松，另一种更关注政策信号和市场需求。单次操作不足以决定长期方向。' },
    ],
    concepts: [
      { term: '流动性', explanation: '资金在金融体系中可获取和周转的难易程度，不等于资产一定会涨。' },
      { term: '传导', explanation: '政策或价格变化通过不同市场环节逐步影响其他资产的过程，通常存在时滞。' },
    ],
    uncertainties: ['后续操作规模和期限结构', '经济基本面与信用需求是否同步变化', '市场是否已经提前定价'],
    takeaway: '先区分操作事实、市场解读和价格结果，再判断影响能否持续。',
  };
}

async function callMock(action, payload) {
  await wait(700);
  if (action === 'debate') {
    const selected = Array.isArray(payload?.perspectives)
      ? perspectives.filter((item) => payload.perspectives.includes(item.id))
      : perspectives.slice(0, 3);
    return {
      ok: true,
      data: debateResult(payload?.question),
      perspectives: selected,
      disclaimer: '本内容仅用于财经通识学习，不构成投资建议、收益承诺或交易依据。请独立判断并注意风险。',
    };
  }
  return {
    ok: true,
    data: readingResult(),
    disclaimer: '本内容仅用于财经通识学习，不构成投资建议、收益承诺或交易依据。请独立判断并注意风险。',
  };
}

module.exports = { callMock };
