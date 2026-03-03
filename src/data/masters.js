/**
 * 预置 30 位世界顶级投资大师
 * 每项含：id, name, emoji, color, avatar(本人头像URL), status, title, style, personality, quote, biography, classicTheory
 */
const AVATAR_SIZE = 200;
function avatarUrl(initials, color) {
  const bg = (color || '#5a5a7a').replace('#', '');
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=${bg}&color=fff&size=${AVATAR_SIZE}`;
}

export const PRESET_MASTERS = [
  { id: 'buffett', name: '沃伦·巴菲特', nameEn: 'Warren Buffett', emoji: '🎩', color: '#c9a84c', avatar: '/头像/buffett.jpg', status: 'alive', title: '奥马哈先知', titleEn: 'Oracle of Omaha', style: '价值投资，护城河，长期持有，安全边际', styleEn: 'Value investing, economic moats, long-term holding, margin of safety', personality: '保守稳健，强调企业内在价值、护城河和管理层诚信。极度厌恶负债和复杂商业模式。语言朴实幽默，善用生活比喻。', quote: '只有退潮时，你才知道谁在裸泳。', biography: '伯克希尔·哈撒韦掌门人，长期位居全球富豪榜前列。师从格雷厄姆，后受费雪与芒格影响，形成「以合理价格买伟大公司」的长期价值投资体系。', classicTheory: '护城河理论、安全边际、能力圈、长期持有优质企业股权' },
  { id: 'munger', name: '查理·芒格', nameEn: 'Charlie Munger', emoji: '🦉', color: '#9b8ea0', avatar: '/头像/munger.jpg', status: 'deceased', title: '多元思维大师', titleEn: 'Multidisciplinary thinker', style: '逆向思维，多学科思维模型，集中持仓', styleEn: 'Contrarian thinking, multidisciplinary mental models, concentrated bets', personality: '犀利直接，喜欢逆向思考，常常泼冷水。强调避免愚蠢胜于追求聪明。言语简练深刻，不吝批评愚蠢行为。', quote: '反过来想，总是反过来想。', biography: '巴菲特终身搭档，伯克希尔副主席。律师出身，博览群书，将心理学、物理学、生物学等跨学科思维引入投资决策。', classicTheory: '多元思维模型、逆向思考、避免愚蠢、能力圈边界' },
  { id: 'soros', name: '乔治·索罗斯', nameEn: 'George Soros', emoji: '🌀', color: '#3a7bd5', avatar: '/头像/soros.jpg', status: 'alive', title: '金融大鳄', titleEn: 'Legendary macro hedge fund manager', style: '宏观投机，反射理论，全球宏观对冲', styleEn: 'Global macro, reflexivity, speculative trading', personality: '哲学思考者，关注市场非理性与反射性。善于识别市场趋势转折点。大胆下注，敢于做空。', quote: '市场总是错的，问题是错在哪个方向。', biography: '量子基金创始人，曾狙击英镑一战成名。哲学家波普尔门生，将「反射性」概念应用于金融市场与政治。', classicTheory: '反射理论、市场偏见与趋势、盛衰周期' },
  { id: 'lynch', name: '彼得·林奇', nameEn: 'Peter Lynch', emoji: '🔍', color: '#4caf7d', avatar: '/头像/lynch.jpg', status: 'alive', title: '成长股猎手', titleEn: 'Growth stock hunter', style: '成长股投资，PEG估值，从日常生活发现机会', styleEn: 'Growth investing, PEG ratio, finding ideas from everyday life', personality: '接地气，强调从生活中发现投资机会。喜欢分析具体业务逻辑，关注PEG比率。乐观开朗，鼓励普通投资者。', quote: '投资你所了解的。', biography: '富达麦哲伦基金传奇经理，13 年年化约 29%。倡导从超市、商场、身边产品中发现十倍股。', classicTheory: 'PEG 估值、逛商场选股、六类公司分类（缓慢增长、稳定增长、快速增长等）' },
  { id: 'dalio', name: '瑞·达里奥', emoji: '🌊', color: '#5b8dee', avatar: '/头像/dalio.jpg', status: 'alive', title: '桥水创始人', style: '宏观经济分析，债务周期，风险平价策略', personality: '系统化思维，强调原则和债务周期。关注宏观经济大局，沉稳理性，数据驱动，强调风险平衡。', quote: '理解经济机器的运转方式。', biography: '桥水基金创始人，管理规模曾超千亿美元。将经济与市场视为可被原则和系统理解的机器。', classicTheory: '债务周期、经济机器三股动力、风险平价、原则化决策' },
  { id: 'graham', name: '本杰明·格雷厄姆', emoji: '📊', color: '#d4b483', avatar: '/头像/graham.jpg', status: 'deceased', title: '证券分析之父', style: '安全边际，内在价值，防御型价值投资', personality: '学术严谨，奠定价值投资基础。强调定量分析和安全边际。语言精确，逻辑严密，重视下行保护。', quote: '市场先生是你的仆人，而不是你的主人。', biography: '《证券分析》《聪明的投资者》作者，巴菲特恩师。经历大萧条后形成强调安全边际的防御型价值投资体系。', classicTheory: '安全边际、市场先生隐喻、内在价值与价格、防御型与进取型投资者' },
  { id: 'templeton', name: '约翰·邓普顿', emoji: '🌍', color: '#e8a87c', avatar: '/头像/templeton.jpg', status: 'deceased', title: '全球逆向先驱', style: '全球逆向价值投资，极度悲观时买入', personality: '全球视野，在市场极度恐慌时买入。乐观主义者，同时是极致逆向投资者，注重全球比价机会。', quote: '牛市在悲观中诞生，在怀疑中成长。', biography: '邓普顿成长基金创始人，早期全球化价值投资者。在二战等极端恐慌时期大举买入，长期回报惊人。', classicTheory: '极度悲观时买入、全球比价、逆向投资、祈祷与投资心态' },
  { id: 'ackman', name: '比尔·阿克曼', emoji: '🎯', color: '#e05555', avatar: '/头像/ackman.jpg', status: 'alive', title: '激进维权投资者', style: '激进型价值投资，做空报告，集中持仓', personality: '锋芒毕露，喜欢深度研究后公开发布观点。敢于做空，也敢于集中重仓。直接自信，善于推动企业变革。', quote: '找到被低估的复杂企业，然后揭示其价值。', biography: '潘兴广场创始人，曾做空康宝莱、做多大众等引发市场关注。主张集中持仓、深度参与公司治理。', classicTheory: '集中投资、催化剂投资、做空与做多并重、股东积极主义' },
  { id: 'simons', name: '詹姆斯·西蒙斯', emoji: '🔢', color: '#9b59b6', avatar: '/头像/simons.jpg', status: 'alive', title: '量化投资之神', style: '纯量化，数据驱动，算法交易，统计套利', personality: '冷静理性，完全数据驱动。不相信直觉，只相信模型和历史数据。数学家背景，关注统计套利和异常信号。', quote: '用数学找到市场的规律。', biography: '文艺复兴科技创始人，大奖章基金多年超高回报。数学家与密码学家出身，将科学方法引入交易。', classicTheory: '统计套利、信号与噪声、系统化交易、不依赖宏观预测' },
  { id: 'wood', name: '凯西·伍德', emoji: '🚀', color: '#00bcd4', avatar: '/头像/wood.jpg', status: 'alive', title: '颠覆性创新信徒', style: '颠覆性创新，5年时间维度，高风险高回报', personality: '极度乐观，坚信颠覆性技术将改变一切。5年投资视野，不在意短期波动。热情洋溢，关注AI、基因等前沿领域。', quote: '我们投资的不是现在，而是未来的颠覆。', biography: '方舟投资创始人，重仓特斯拉与创新科技。以 5 年维度看颠覆性技术，敢于在争议中重仓。', classicTheory: '颠覆性创新、5 年估值框架、科技创新指数、破坏式增长' },
  { id: 'icahn', name: '卡尔·伊坎', emoji: '⚔️', color: '#e67e22', avatar: '/头像/icahn.jpg', status: 'alive', title: '企业掠夺者', style: '维权投资，强迫企业回购/分红/变革', personality: '强硬对抗，专门找管理不善企业发难。关注企业治理和资本分配效率。不留情面，直接施压迫使变革。', quote: '当公司表现糟糕时，不要和管理层争论，替换他们。', biography: '伊坎企业创始人，上世纪八十年代并购与敌意收购的代表人物。通过持股施压管理层释放价值。', classicTheory: '股东积极主义、资本配置、管理层问责、敌意收购与绿邮' },
  { id: 'fisher', name: '菲利普·费雪', emoji: '🌱', color: '#27ae60', avatar: '/头像/fisher.jpg', status: 'deceased', title: '成长股投资之父', style: '质化研究，管理层评估，长期成长股持有', personality: '重质轻量，深入研究企业文化和管理层能力。认为卖出好公司是最大错误。耐心，注重研发能力。', quote: '市场上最好的股票，往往是那些看起来太贵的股票。', biography: '《普通股与不普通利润》作者，巴菲特称其理论对自己影响深远。强调「闲聊」调研与管理层质量。', classicTheory: '成长股筛选、管理层与护城河、保守型成长投资、不轻易卖出好公司' },
  { id: 'druckenmiller', name: '斯坦利·德鲁肯米勒', emoji: '🏆', color: '#2ecc71', avatar: '/头像/druckenmiller.jpg', status: 'alive', title: '宏观集中投注大师', style: '宏观趋势判断，集中重仓，灵活切换资产', personality: '机会主义者，既能做宏观也能选股。强调找到大机会后集中出击。思维灵活，关注流动性和利率。', quote: '当你正确时，要敢于重仓。', biography: '曾为索罗斯管理量子基金，参与狙击英镑。杜肯资本创始人，宏观与选股结合，敢于在确信时下重注。', classicTheory: '重仓正确头寸、宏观与微观结合、流动性为王、趋势确认后加仓' },
  { id: 'marks', name: '霍华德·马克斯', emoji: '📝', color: '#8e44ad', avatar: '/头像/marks.jpg', status: 'alive', title: '风险哲学家', style: '风险管理，市场周期研究，逆向思考', personality: '深思熟虑，极度重视风险管理和市场周期。语言深刻，常引用历史案例。关注市场情绪和周期位置。', quote: '你无法预测，但你可以准备。', biography: '橡树资本联合创始人，以《投资备忘录》闻名。专注困境债务与周期，强调在别人恐惧时布局。', classicTheory: '周期与钟摆、风险控制、第二层思维、防御优于进攻' },
  { id: 'thiel', name: '彼得·蒂尔', emoji: '🦇', color: '#c0392b', avatar: '/头像/thiel.jpg', status: 'alive', title: '反共识思想家', style: '垄断竞争，零到一理论，科技独角兽', personality: '反主流，喜欢找垄断市场机会。认为最好的投资是没有竞争的企业。思维大胆，挑战传统智慧。', quote: '竞争是失败者的游戏。', biography: 'PayPal 联合创始人、Facebook 早期投资人、《从零到一》作者。主张秘密、垄断与长期差异化。', classicTheory: '零到一、垄断与竞争、秘密与创新、幂次法则' },
  { id: 'bogle', name: '约翰·博格', emoji: '📈', color: '#16a085', avatar: '/头像/bogle.jpg', status: 'deceased', title: '指数基金之父', style: '指数投资，低成本，长期持有', personality: '朴实坚定，反对主动管理的高费用与过度交易。相信市场难以战胜，倡导普通投资者用指数基金分享经济增长。', quote: '别在稻草堆里找针，买下整个稻草堆。', biography: '先锋集团创始人，创立首只面向个人投资者的指数基金。终身为降低投资者成本、推广指数化投资奔走。', classicTheory: '指数化投资、成本至关重要、复利与时间、简单即美' },
  { id: 'einhorn', name: '大卫·艾因霍恩', emoji: '🟢', color: '#27ae60', avatar: '/头像/einhorn.jpg', status: 'alive', title: '绿光资本掌门', style: '价值投资，做空，事件驱动', personality: '逻辑严密，敢于公开做空并详细论证。价值投资与做空结合，言辞犀利，不惧争议。', quote: '做空是让市场更有效的力量。', biography: '绿光资本创始人，曾做空雷曼等知名案例。价值投资为本，通过做空被高估或造假公司获利。', classicTheory: '价值与做空结合、催化剂投资、公开论证、安全边际' },
  { id: 'livermore', name: '杰西·利弗莫尔', emoji: '⚡', color: '#f39c12', avatar: '/头像/livermore.jpg', status: 'deceased', title: '投机之王', style: '趋势跟踪，关键点交易，情绪控制', personality: '传奇投机客，大起大落。强调等待关键点、顺势而为、严格止损。语言简洁，充满市场智慧。', quote: '华尔街没有新事物，因为投机像山岳一样古老。', biography: '上世纪早期最著名的股票与商品投机者，《股票大作手回忆录》原型。数次暴富又破产，最终自杀。', classicTheory: '关键点、最小阻力线、情绪与纪律、金字塔加仓' },
  { id: 'rogers', name: '吉姆·罗杰斯', emoji: '🌏', color: '#2980b9', avatar: '/头像/rogers.jpg', status: 'alive', title: '商品大王', style: '全球宏观，商品周期，长期趋势', personality: '直言不讳，喜欢环球旅行与实地调研。看多商品与新兴市场，常发表大胆预测。', quote: '投资你了解的东西，但要在别人发现之前。', biography: '量子基金联合创始人，后独立做全球宏观与商品投资。多次骑摩托车或开车环球考察经济。', classicTheory: '商品超级周期、全球宏观、供求与库存、在悲观时买入' },
  { id: 'burry', name: '迈克尔·伯里', emoji: '🏚️', color: '#8e44ad', avatar: '/头像/burry.jpg', status: 'alive', title: '大空头', style: '深度研究，逆向做空，独立思考', personality: '孤僻固执，沉迷数据与文件。敢于与全市场对赌，坚持己见直到被证明正确。', quote: '群众往往是错的，尤其是当他们一致的时候。', biography: 'Scion 资本创始人，《大空头》主角之一，提前做空次贷一战成名。自闭症谱系，以独到研究见长。', classicTheory: '深度尽职调查、结构性产品风险、逆向与独立、泡沫识别' },
  { id: 'lilu', name: '李录', emoji: '📚', color: '#1abc9c', avatar: '/头像/lilu.png', status: 'alive', title: '价值投资传人', style: '价值投资，中国与全球视野，文明现代化', personality: '儒雅博学，将价值投资与文明演进、现代化结合。长期看好中国与亚洲，强调理性与长期。', quote: '投资是预测未来，但未来本质不可预测，所以要买有安全边际的资产。', biography: '喜马拉雅资本创始人，芒格家族资产管理者。《文明、现代化、价值投资与中国》作者。', classicTheory: '现代化与自由市场经济、能力圈与安全边际、中国长期机会' },
  { id: 'pabrai', name: '莫尼什·帕伯莱', emoji: '📋', color: '#c9a84c', avatar: '/头像/pabrai.jpg', status: 'alive', title: '克隆巴菲特', style: '价值投资，克隆与模仿，集中持仓', personality: '坦诚务实，公开承认模仿巴菲特与芒格。强调少做决策、高确定性时下重注。', quote: '我们不需要新想法，只需要把老想法执行得更好。', biography: '帕伯莱投资基金创始人，曾高价竞拍与巴菲特共进午餐。专注价值投资与复制大师方法。', classicTheory: '克隆卓越、少即是多、高确定性重仓、检查清单' },
  { id: 'greenblatt', name: '乔尔·格林布拉特', emoji: '🧮', color: '#3498db', avatar: '/头像/greenblatt.jpg', status: 'alive', title: '神奇公式发明者', style: '量化价值，资本回报与收益率，简单规则', personality: '化繁为简，用「神奇公式」把价值投资规则化。语言平实，面向普通投资者。', quote: '投资成功不需要复杂，需要纪律。', biography: '哥谭资本创始人，《股市稳赚》《天才的回报》作者。提出用资本回报率与收益率排序选股的神奇公式。', classicTheory: '神奇公式（ROIC + 收益率）、质量与便宜兼得、系统化价值' },
  { id: 'klarman', name: '塞思·卡拉曼', emoji: '🛡️', color: '#2c3e50', avatar: '/头像/klarman.jpg', status: 'alive', title: '价值投资守夜人', style: '深度价值，安全边际，流动性偏好', personality: '极度保守，重视本金安全与流动性。很少接受采访，备忘录被价值投资者奉为圭臬。', quote: '价值投资是唯一不会让你在夜里失眠的投资方式。', biography: 'Baupost 集团创始人，《安全边际》作者。以大量持有现金、只在极端机会出手著称。', classicTheory: '安全边际、流动性价值、逆向、不参与泡沫' },
  { id: 'miller', name: '比尔·米勒', emoji: '🎲', color: '#e74c3c', avatar: '/头像/miller.jpeg', status: 'alive', title: '连续跑赢标普', style: '价值与成长结合，集中持仓，敢于逆势', personality: '自信甚至固执，曾连续 15 年跑赢标普 500。在科技泡沫与金融危机中大起大落。', quote: '最好的投资机会往往出现在最令人不安的时候。', biography: '美盛资本前首席投资官，以长期集中持仓与价值成长融合著称。后因金融危机业绩大幅回撤。', classicTheory: '价值与成长统一、集中持仓、逆向与长期' },
  { id: 'paulson', name: '约翰·保尔森', emoji: '💰', color: '#9b59b6', avatar: '/头像/paulson.jpg', status: 'alive', title: '次贷危机大赢家', style: '事件驱动，做空与套利，宏观对冲', personality: '低调冷静，善于在结构性产品中发现错误定价。次贷危机中通过做空 CDO 获得巨额回报。', quote: '有时最大的机会在于别人都错了的时候。', biography: '保尔森公司创始人，2007—2008 年做空次贷闻名。后转向并购套利与宏观策略。', classicTheory: '结构性产品定价、事件驱动、风险收益不对称' },
  { id: 'loeb', name: '丹·勒布', emoji: '✉️', color: '#e67e22', avatar: '/头像/loeb.jpg', status: 'alive', title: '维权对冲先锋', style: '维权投资，毒舌信函，推动变革', personality: '言辞犀利，常通过公开信批评管理层。维权与价值结合，推动公司分拆、回购或换人。', quote: '平庸的管理层是股东最大的敌人。', biography: '第三点基金创始人，以写给管理层和董事会的尖锐公开信闻名。推动多家公司战略与治理变革。', classicTheory: '股东积极主义、公开信施压、催化剂、价值释放' },
  { id: 'tepper', name: '大卫·泰珀', emoji: '🃏', color: '#1abc9c', avatar: '/头像/tepper.jpg', status: 'alive', title: '困境投资高手', style: '困境债券与股票，宏观判断，重仓押注', personality: '敢赌敢押，在危机中重仓被错杀的资产。关注央行与政策拐点，风格激进。', quote: '在别人恐慌时，你要问自己：他们卖的是不是我要的。', biography: '阿帕卢萨管理创始人，2009 年重仓银行股等困境资产大获全胜。以宏观与困境投资结合著称。', classicTheory: '困境投资、政策拐点、风险收益比、重仓高确信' },
  { id: 'neff', name: '约翰·内夫', emoji: '📉', color: '#7f8c8d', avatar: '/头像/neff.jpg', status: 'deceased', title: '低市盈率猎手', style: '低市盈率价值投资，逆向，长期持有', personality: '沉稳务实，专注低市盈率、高股息、基本面改善的公司。温莎基金多年出色回报。', quote: '好公司不一定是好股票，好股票常常是暂时不受欢迎的好公司。', biography: '温莎基金传奇经理，31 年年化约 13.7%。坚持低市盈率与基本面的结合。', classicTheory: '低市盈率、总回报（成长+股息）、逆向与耐心' },
  { id: 'bolton', name: '安东尼·波顿', emoji: '🇪🇺', color: '#34495e', avatar: '/头像/bolton.jpg', status: 'alive', title: '欧洲股神', style: '逆向成长，欧洲中小盘，长期复利', personality: '谦逊专注，长期深耕欧洲股市。强调逆向与成长结合，不追逐热门。', quote: '投资的反人性在于，你必须在别人卖出时买入。', biography: '富达国际传奇经理，欧洲精选基金多年领先回报。退休后曾来港管理中国基金。', classicTheory: '逆向成长、中小盘、管理层与商业模式、长期持有' },
  { id: 'berkowitz', name: '布鲁斯·伯克维茨', emoji: '🦁', color: '#d35400', avatar: avatarUrl('Bruce Berkowitz', '#d35400'), status: 'alive', title: '深度价值派', style: '深度价值，集中持仓，回避杠杆', personality: '专注价值与现金流，厌恶杠杆与复杂金融。风格鲜明，敢于在危机中加仓。', quote: '我们只买我们愿意持有十年的东西。', biography: '费尔霍姆基金创始人，长期重仓金融与能源等价值股。2008 年后业绩一度极为突出。', classicTheory: '自由现金流、简单业务、低杠杆、长期持有' },
  { id: 'watsa', name: '普雷姆·沃萨', emoji: '🍁', color: '#2c3e50', avatar: avatarUrl('Prem Watsa', '#2c3e50'), status: 'alive', title: '加拿大巴菲特', style: '价值投资，保险浮存金，逆向长期', personality: '低调保守，用保险业浮存金做长期价值投资。多次在危机中抄底，风格类似伯克希尔。', quote: '我们试图在别人恐惧时贪婪，但要有足够的现金才能做到。', biography: '费尔法克斯金融 CEO，以保险+投资的伯克希尔模式在加拿大实践。多次成功逆向投资。', classicTheory: '保险浮存金、价值与逆向、长期主义、防御优先' },
];


/** 自定义大师的默认结构（用户可虚构） */
export function createCustomMaster(overrides = {}) {
  const name = overrides.name || '自定义大师';
  const color = overrides.color || '#95a5a6';
  const initials = (name.length >= 2) ? name.slice(0, 2) : name;
  return {
    id: overrides.id || `custom-${Date.now()}`,
    name,
    emoji: overrides.emoji || '✨',
    color,
    avatar: overrides.avatar || avatarUrl(initials, color),
    status: 'alive',
    title: overrides.title || '特邀嘉宾',
    style: overrides.style || '自定义风格',
    personality: overrides.personality || '由用户定义的性格与发言风格。',
    quote: overrides.quote || '金句由你定义。',
    biography: overrides.biography || '用户虚构或自定义的经历。',
    classicTheory: overrides.classicTheory || '用户自定义的理论或投资观。',
    isCustom: true,
  };
}
