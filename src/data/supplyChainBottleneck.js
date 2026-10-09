// 供应链瓶颈分析：跨端共享的 Skill、Serenity 与六步框架公开说明。
// 分析提示词基于 fadewalk/serenity-stock-choke v3.2.1（MIT）改写接入。

export const SERENITY_SKILL = {
  id: 'serenity-stock-choke',
  displayName: 'Serenity 卡脖子选股技能',
  version: '3.2.1',
  owner: 'fadewalk',
  sourceUrl: 'https://github.com/fadewalk/serenity-stock-choke',
  license: 'MIT',
  markets: 'A股 / 港股 / 美股',
  dataStrategy: [
    '优先复用运行环境已有的行情、估值与年报数据',
    '无可用工具时使用 Skill 内置公开接口脚本',
    '深度供应链信息再用公开检索交叉验证，并标注缺口',
  ],
};

export const SERENITY_PROFILE = {
  name: 'Serenity',
  handle: '@aleabitoreddit',
  identity: 'Reddit WallStreetBets 社区中提出供应链瓶颈框架的投资者',
  summary:
    'Serenity 的分析起点不是“哪家公司故事更好”，而是沿着产业链向上游追溯：哪一个环节一旦断货、延期或被出口管制，整条产业就会被迫降速。掌握这种关键节点的公司，可能因为稀缺产能、技术壁垒或客户认证而获得阶段性定价权。',
  quote:
    '霍尔木兹海峡是全球石油的咽喉。如果你控制瓶颈，你拥有的不是流量，而是定价权。',
  caveat:
    '公开资料中的历史收益为个人自报口径，未经独立审计；本模块只采用其分析框架，不把历史业绩视为未来收益依据。',
};

export const CHOKE_FRAMEWORK_STEPS = [
  {
    id: 'cycle',
    label: '定位周期',
    question: '需求爆发、技术跃迁，还是供给受限？',
    action: '先确认产业链为什么现在紧，而不是先找公司。',
  },
  {
    id: 'map',
    label: '溯源供应链',
    question: '从终端往上游，哪一层最不可替代？',
    action: '按终端、集成、核心零部件、关键材料、资源逐层排查。',
  },
  {
    id: 'choke',
    label: '锁定卡点',
    question: '谁是这条产业链的“霍尔木兹海峡”？',
    action: '用技术壁垒、扩产周期、自给率、集中度与政策风险做判断。',
  },
  {
    id: 'filter',
    label: '真伪筛选',
    question: '真瓶颈，还是只沾了一点概念？',
    action: '执行七条排除规则，剔除主营不足、低壁垒、高估值与流动性陷阱。',
  },
  {
    id: 'confirm',
    label: '多空确认',
    question: '资本与产业证据是确认，还是拥挤？',
    action: '同时检查订单、公告、研报、资金、融资与估值位置。',
  },
  {
    id: 'report',
    label: '形成报告',
    question: '什么会证明判断，什么会推翻判断？',
    action: '输出瓶颈地图、候选信号卡、多空证据、催化日历与证伪条件。',
  },
];

export const CHOKE_EXCLUSION_RULES = [
  '相关业务收入占比低，主营仍是蹭热点',
  '竞争格局分散，没有持续护城河',
  '产能扩张门槛低，半年内即可放量',
  '进口替代逻辑不成立，海外同样缺货',
  '估值历史分位过高，逻辑已被充分定价',
  '成交与机构覆盖不足，流动性风险高',
  'ST、退市风险警示或存在重大治理瑕疵',
];

export const CHOKE_MARKETS = [
  { id: 'auto', label: '自动识别' },
  { id: 'CN', label: 'A 股' },
  { id: 'HK', label: '港股' },
  { id: 'US', label: '美股' },
  { id: 'global', label: '全球对比' },
];

export const CHOKE_EXAMPLES = [
  'AI 算力链',
  'CPO / 光模块',
  '半导体设备',
  '电力 / 电网',
  '军工材料',
  '新能源车',
  '创新药',
];
