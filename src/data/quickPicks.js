// src/data/quickPicks.js
// 「邀请大师」快捷人选：公开资料多、发言多、知名度高的国内投资人物
// 按身份分组，点击即自动填名并开始构建画像
// 注意：徐翔等有法律污点的人物刻意不收录；寒武纪的鳄鱼已退乎（资料以网友讨论为主），保留以回应其影响力

export const QUICK_PICK_GROUPS = [
  {
    id: 'fund',
    label: '公募基金经理',
    people: [
      { name: '张坤', hint: '易方达 · 重仓消费龙头' },
      { name: '朱少醒', hint: '富国天惠 · 长跑冠军' },
      { name: '谢治宇', hint: '兴全合润 · 均衡成长' },
      { name: '葛兰', hint: '中欧医疗 · 医药一姐' },
      { name: '刘彦春', hint: '景顺长城 · 白酒消费' },
      { name: '傅鹏博', hint: '睿远成长 · 老将' },
    ],
  },
  {
    id: 'private',
    label: '私募大佬',
    people: [
      { name: '但斌', hint: '东方港湾 · 茅台多头' },
      { name: '林园', hint: '林园投资 · 消费医药' },
      { name: '冯柳', hint: '高毅 · 逆向投资' },
      { name: '李蓓', hint: '半夏投资 · 宏观对冲' },
      { name: '邓晓峰', hint: '高毅 · 产业研究' },
      { name: '赵丹阳', hint: '赤子之心 · 价值投资' },
      { name: '邱国鹭', hint: '高毅资产 · 董事长' },
    ],
  },
  {
    id: 'youzi',
    label: '游资 / 短线高手',
    people: [
      { name: '炒股养家', hint: '情绪周期 · 打板鼻祖' },
      { name: '章盟主', hint: '章建平 · 顶级游资' },
      { name: '赵老哥', hint: '八年一万倍' },
      { name: '作手新一', hint: '新生代游资' },
      { name: '陈小群', hint: '一线游资' },
    ],
  },
  {
    id: 'zhihu',
    label: '知乎 / 自媒体大V',
    people: [
      { name: '寒武纪的鳄鱼', hint: '周期股大佬 · 已退乎' },
      { name: 'Dang大', hint: '周期有色 · MR Dang' },
      { name: 'DeepVan', hint: '美股 · 叫兽指数' },
      { name: '培风客', hint: '宏观 · 大宗商品' },
      { name: '君临', hint: '君临投资汇 · 财经专栏' },
      { name: '陈达', hint: '陈达美股投资' },
      { name: '谦和屋', hint: '价值投资 · 职业投资人' },
    ],
  },
  {
    id: 'kol',
    label: '财经KOL / 评论员',
    people: [
      { name: '李大霄', hint: '英大证券 · 网红多头' },
      { name: '洪榕', hint: '洪攻略 · 财经大V' },
      { name: '任泽平', hint: '宏观经济学家' },
    ],
  },
];
