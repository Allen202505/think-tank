// src/data/radarAccounts.js —— 跟踪大师动态：内置被跟踪账号注册表
// 每个账号可挂多个平台源（同一位大师自己的雪球+知乎等），但各大师之间不合并展示。
// 说明：
//  - masterId：若该真人是站内预置大师（PRESET_MASTERS），填其 id，可复用头像/配色
//  - source.platform：xueqiu=雪球 / zhihu=知乎 / custom=网页链接源
//  - source.uid：平台主页 URL 里的标识（雪球=数字 id 或别名；知乎=people/ 后的 token）
//  - xueqiu 源可带 type：0=原发布动态（推荐），10=全部动态（含回复/转发）
//  - 新增账号 = 在此文件加一行；需要先人工确认 uid 确实属于该大师本人

export const PLATFORM_LABEL = {
  xueqiu: '雪球',
  zhihu: '知乎',
  x: 'X',
  custom: '网页',
};

export const RADAR_ACCOUNTS = [
  {
    id: 'duanyongping',
    masterId: 'duan', // 站内大师：段永平
    name: '段永平',
    nameEn: 'Duan Yongping',
    role: '本分投资者',
    emoji: '🍎',
    color: '#3d4a63',
    sources: [
      {
        platform: 'xueqiu',
        uid: '1247347556',
        nick: '大道无形我有型',
        profileUrl: 'https://xueqiu.com/u/1247347556',
        type: 0,
      },
    ],
  },
  {
    id: 'danbin',
    masterId: null,
    name: '但斌',
    nameEn: 'Dan Bin',
    role: '东方港湾创始人',
    emoji: '🍷',
    color: '#c0392b',
    sources: [
      {
        platform: 'xueqiu',
        uid: '1102105103',
        nick: '但斌',
        profileUrl: 'https://xueqiu.com/u/1102105103',
        type: 0,
      },
    ],
  },
  {
    id: 'wuzhijian',
    masterId: null,
    name: '伍治坚',
    nameEn: 'Wu Zhijian',
    role: '五福资本创始人 · 投资作者',
    emoji: '📘',
    color: '#1f6f52',
    sources: [
      {
        platform: 'zhihu',
        uid: 'wuzhijiansingapore',
        nick: '伍治坚',
        profileUrl: 'https://www.zhihu.com/people/wuzhijiansingapore',
      },
    ],
  },
];

export function findRadarAccount(id) {
  return RADAR_ACCOUNTS.find((a) => a.id === id) || null;
}

// 默认选中的大师：第一个（不跨大师合并展示，所以无「全部动态」）
export const DEFAULT_RADAR_ACCOUNT_ID = RADAR_ACCOUNTS[0].id;
