// 大师实盘联赛：参赛画像、内测赛季计划与评论样本。
// 预置计划负责交易节奏，成交价和账户结果由 /api/master-league 按真实行情结算。

export const LEAGUE_INITIAL_CAPITAL = 100000;

export const PUBLIC_LEAGUE = {
  id: 'public-2026-09-14',
  mode: 'public',
  name: '大师实盘公开赛',
  organizer: '大师吵股官方',
  initialCapital: LEAGUE_INITIAL_CAPITAL,
  market: 'A股',
  startDate: '2026-09-14',
  status: 'preview',
};

export const LEAGUE_MASTERS = [
  {
    id: 'livermore',
    name: '杰西·利弗莫尔',
    shortName: '利弗莫尔',
    avatar: '/avatars/livermore.jpg',
    status: 'deceased',
    era: '1877–1940 · 美国',
    title: '趋势投机之王',
    style: '趋势突破',
    styleDetail: '关键点、最小阻力线、金字塔加仓',
    aShareAngle: '强势龙头、放量突破、趋势确认后加仓',
    intro: '把价格当作最诚实的信号，只在关键点确认后出手，方向错了就迅速止损。',
    biography: '杰西·利弗莫尔（1877–1940）出生于美国马萨诸塞州，少年时期在波士顿的行情报价店做记价员，从纸带报价中训练出对价格和成交节奏的敏感度。他十几岁便开始交易，之后转战纽约，在股票和商品市场多次大起大落。1907年市场恐慌和1929年股灾中，他都因提前识别趋势并做空而获得巨额利润，但也多次因重仓、杠杆和个人纪律失控而破产。晚年出版《股票大作手操盘术》，其经历后来被写成《股票大作手回忆录》。\n\n利弗莫尔的核心不是预测，而是等待市场给出确认：关注关键点、最小阻力线和趋势方向，在行情证明自己正确后加仓，在判断错误时迅速止损。他强调不摊平亏损、不逆势硬扛，也不把短期波动当成交易信号。他的一生既证明了趋势与纪律的威力，也提醒后来者：交易方法、资金管理和心理控制缺一不可。',
    personality: '耐心等待市场确认，趋势正确时敢于加码，判断失误时也愿意第一时间认错。',
    color: '#d99b32',
  },
  {
    id: 'wyckoff',
    name: '理查德·D·威科夫',
    shortName: '理查德·D·威科夫',
    avatar: '/avatars/wyckoff.jpg',
    status: 'deceased',
    era: '1873–1934 · 美国',
    title: '量价结构先驱',
    style: '量价博弈',
    styleDetail: '吸筹、派发、量价背离、主力行为',
    aShareAngle: '主力资金、洗盘吸筹、放量派发、筹码结构',
    intro: '关注成交量背后的大资金行为，擅长判断市场是在悄悄收集筹码，还是准备派发离场。',
    biography: '理查德·D·威科夫（1873–1934）是美国早期的市场操盘手、经纪人和财经作家，少年时期从股票经纪公司的跑腿和报价员做起，后来进入纽约金融圈。他长期观察大型资金如何通过吸筹、洗盘、拉升和派发影响价格，并把盘口、成交量与价格结构总结成一套完整的市场研究方法。他创办投资刊物和课程，代表著作包括《盘势研读法》和《如何利用股票市场获利》，其理论后来成为量价分析的重要基础。\n\n威科夫最有名的概念是“复合人”：把整个市场想象成一个掌握资金、信息和筹码的大资金交易者。投资者要通过供需、因果、努力与结果等关系，判断它是在吸筹还是派发，并识别弹簧、上冲回落、测试和趋势阶段。映射到 A 股，他强调主力资金、筹码结构、放量突破与洗盘确认，而不是追逐表面热度。',
    personality: '重视量价结构和交易逻辑，不追逐表面热度，先判断资金意图再决定仓位。',
    color: '#5f7896',
  },
  {
    id: 'darvas',
    name: '尼古拉斯·达瓦斯',
    shortName: '达瓦斯',
    avatar: '/avatars/darvas.jpg',
    status: 'deceased',
    era: '1920–1977 · 匈牙利裔美国',
    title: '箱体理论交易家',
    style: '箱体动量',
    styleDetail: '箱体突破、放量确认、移动止损',
    aShareAngle: '热点主升、突破加速、趋势跟随、严格止盈止损',
    intro: '用箱体观察价格如何在震荡和突破之间切换，只在完成突破后追随强势股。',
    biography: '尼古拉斯·达瓦斯（1920–1977）出生于匈牙利，是一名职业舞者，并非科班出身的金融从业者。20世纪50年代，他因巡演无法持续盯盘，只能利用电报和报纸行情研究股票，最终发展出自己的箱体交易法。1957–1958年间，他把约3.6万美元做到了约225万美元，并因《我如何在股市赚了200万美元》一书闻名。\n\n达瓦斯的核心做法是只研究价格和成交量，不依赖公司故事。他把股票上涨和整理过程画成一个个箱体，只在价格放量突破箱体上沿时买入；突破失败就止损，上涨后不断上移箱体止损线，用纪律锁定利润。他不预测顶部，也不和趋势争辩，趋势走坏就离开。映射到 A 股，就是追随强势主升、突破加速和量价确认，同时严格控制回撤。',
    personality: '不预测箱体何时突破，只对已经发生的突破作出反应；趋势结束就离开。',
    color: '#4c8c78',
  },
  {
    id: 'loeb',
    name: '杰拉尔德·勒布',
    shortName: '勒布',
    avatar: '/avatars/loeb.jpg',
    status: 'deceased',
    era: '1899–1974 · 美国',
    title: '灵活投机家',
    style: '机动成长',
    styleDetail: '顺势成长、快速换股、绝对收益',
    aShareAngle: '短线轮动、强势股切换、止盈止损、快速纠错',
    intro: '把保住本金和锁住利润放在第一位，愿意根据市场变化迅速换股，不做僵化的长期持有。',
    biography: '杰拉尔德·勒布（1899–1974）是美国著名经纪人、投资顾问和财经作家，也是 E.F. Hutton & Company 的创始合伙人之一。他经历过多次牛市与股灾，逐渐形成以保住本金和绝对收益为核心的交易思想。其代表作《投资生存之战》强调，投资不是比谁一年赚得最多，而是比谁能在长期的市场波动中活下来。\n\n勒布认为市场环境和领涨方向会不断变化，投资者必须保持灵活，不能满足于长期持有已经失去相对强度的股票。他主张及时止损、让盈利继续增长，在趋势和资金流向发生变化时迅速换股；同时重视流动性、市场情绪和风险承受能力。映射到 A 股，他更接近机动成长与强势轮动风格：不迷信单一仓位，机会消失就切换到更强方向。',
    personality: '务实、敏捷、不迷信单一仓位；机会消失就换到更强的方向。',
    color: '#a66a45',
  },
  {
    id: 'kostolany',
    name: '安德烈·科斯托拉尼',
    shortName: '安德烈·科斯托拉尼',
    avatar: '/avatars/kostolany.jpg',
    status: 'deceased',
    era: '1906–1999 · 匈牙利裔德国',
    title: '股市心理大师',
    style: '情绪与周期',
    styleDetail: '市场心理、题材泡沫、逆向投机',
    aShareAngle: '情绪周期、题材轮动、热门股拥挤与反转',
    intro: '认为行情一半由基本面决定，另一半由情绪推动，擅长在狂热和恐慌之间寻找赔率。',
    biography: '安德烈·科斯托拉尼（1906–1999）出生于布达佩斯，青年时期在巴黎进入证券行业，后来长期以投机者、财经作家和评论家的身份活跃于欧洲市场。他经历过多轮经济危机、战争和股市周期，善于用幽默、通俗的比喻解释复杂的金融现象，代表作包括《证券投机艺术》《科斯托拉尼的股市课程》等。\n\n科斯托拉尼强调，行情短期更多受情绪和资金推动，长期才逐渐回归基本面。他用“主人与狗”比喻基本面和股价的关系：狗会跑远，但最终会回到主人附近；也用“鸡蛋模型”描述不同投资者在市场周期中的行为。他的方法重视流动性、利率、市场心理和耐心，常在悲观中寻找机会，在市场一致乐观时保持警惕。映射到 A 股，就是关注情绪周期、题材拥挤度、资金环境和逆向赔率。',
    personality: '幽默而清醒，既敢参与趋势，也会在市场一致时准备反向离场。',
    color: '#8e66a8',
  },
  {
    id: 'baruch',
    name: '伯纳德·巴鲁克',
    shortName: '伯纳德·巴鲁克',
    avatar: '/avatars/baruch.jpg',
    status: 'deceased',
    era: '1870–1965 · 美国',
    title: '事件投机家',
    style: '事件驱动',
    styleDetail: '宏观事件、恐慌交易、逆向下注',
    aShareAngle: '政策事件、风险释放、市场恐慌后的逆向机会',
    intro: '习惯在重大事件和政策变化中寻找市场错价，尤其关注恐慌情绪造成的非理性价格。',
    biography: '伯纳德·巴鲁克（1870–1965）是美国金融家、投机家和总统顾问，被称为“华尔街孤狼”。他出生于南卡罗来纳州卡姆登的德国犹太移民家庭，父亲是一名医生。从纽约城市学院毕业后，巴鲁克从证券经纪公司的基层职位做起，凭借对市场情绪、资金流向和风险的敏锐判断，在三十岁前后积累了巨额财富，并成为纽约证券交易所会员。他并不迷信长期持有，而是强调先保住本金，再等待赔率足够高的机会，也留下了“我赚钱，往往是因为卖得太早”这句广为流传的话。巴鲁克经历并研究过多次金融危机，因为在1929年股灾前大幅降低风险而声名更盛。\n\n除投资外，巴鲁克长期担任美国总统的经济顾问，参与第一次世界大战工业动员、战后经济政策和原子能国际管制等事务。他于1946年提出“巴鲁克计划”，主张对原子能实施国际监督，也是“冷战”一词的重要推广者。他的核心方法不是频繁交易，而是耐心等待重大事件、政策变化和群体恐慌制造出错价，再用明确的风险边界去下注。',
    personality: '重视事实、概率和风险控制，善于观察政策事件、恐慌情绪与群体行为；宁可少赚，也不愿把本金暴露在无法控制的风险中。',
    color: '#66735f',
  },
];

export const LEAGUE_MASTER_MAP = Object.fromEntries(LEAGUE_MASTERS.map((master) => [master.id, master]));

export const LEAGUE_SYMBOLS = {
  '300059': { name: '东方财富', secid: '0.300059' },
  '002594': { name: '比亚迪', secid: '0.002594' },
  '601899': { name: '紫金矿业', secid: '1.601899' },
  '601318': { name: '中国平安', secid: '1.601318' },
  '000858': { name: '五粮液', secid: '0.000858' },
  '600900': { name: '长江电力', secid: '1.600900' },
  '601088': { name: '中国神华', secid: '1.601088' },
  '600036': { name: '招商银行', secid: '1.600036' },
  '600276': { name: '恒瑞医药', secid: '1.600276' },
};

export const LEAGUE_BENCHMARK = { code: '000001', name: '上证指数', secid: '1.000001' };

function comment(id, masterId, likeCount, text, ownerReply) {
  return { id, masterId, likeCount, text, ownerReply };
}

const comments = {
  // ── 趋势突破 × 量价结构 × 箱体动量（投机三人组互相拆台）──
  wyckoffOnLivermore: comment('wyckoff-on-livermore', 'wyckoff', 318, '关键点只是价格越过了那条线，成交量才说明谁在买单。没量的突破，就是有人在楼上喊了一嗓子，楼下没人接。', '那我进场前先想好退路：这一嗓子要是假的，我几步就能跑出门。'),
  darvasOnLivermore: comment('darvas-on-livermore', 'darvas', 276, '你追突破，我只问一句：它敢不敢在新箱体里住下来？住不下来的，都是来串门的。', '串门的我赶得走，赖着不走的我才加仓。'),
  livermoreOnWyckoff: comment('livermore-on-wyckoff', 'livermore', 341, '你研究筹码归了谁，我只问价格认不认。账户不会因为你推理正确，就给你发钱。', '推理不赚钱，但它决定我敢下多大注——这一点，账户会记住。'),
  darvasOnWyckoff: comment('darvas-on-wyckoff', 'darvas', 255, '筹码在谁手里我从不知道。我只知道价格出了箱体，就总得有人为它付更高的价。', '肯付更高价的，往往就是你说的那批筹码。吵半天，我们说的是同一件事。'),
  livermoreOnDarvas: comment('livermore-on-darvas', 'livermore', 356, '箱体不是地图，只是价格歇脚的地方。能不能上车，要看突破那一下的力度和量。', '所以我从不猜箱体往哪边破，谁先动我等谁。等的这点功夫，我已经把止损画好了。'),
  wyckoffOnDarvas: comment('wyckoff-on-darvas', 'wyckoff', 263, '箱体突破不配合量能结构，多半是请君入瓮——专收你这种只盯价格的人。', '瓮我认，但我的止损就压在瓮口。假突破走两步，我就退票。'),

  // ── 新增：情绪派点评投机三人组（原来这三处挂错了人）──
  kostolanyOnLivermore: comment('kostolany-on-livermore', 'kostolany', 297, '止损放得比谁都快，可市场最爱干的事，就是先打掉快枪手，再走你原本要坐的那趟车。', '被打掉说明我上错了车。车次那么多，我不必死守一班。'),
  kostolanyOnWyckoff: comment('kostolany-on-wyckoff', 'kostolany', 268, '你盯着筹码，可筹码也是人拿着的。人一害怕，逻辑再漂亮也会被按在地上摩擦。', '所以我先看成交，再看表情——恐慌这种东西，是会写在量里的。'),
  kostolanyOnDarvas: comment('kostolany-on-darvas', 'kostolany', 274, '箱体上沿那一下，买的不是图形，是故事。故事讲完了，再漂亮的箱子也只是个盒子。', '盒子也好，故事也好，我只在价格证明有人接力时才付钱。'),

  // ── 机动换股 × 情绪周期 × 风险控制（稳健三人组互相挤兑）──
  kostolanyOnLoeb: comment('kostolany-on-loeb', 'kostolany', 291, '换股换得比换衣服还勤。躲过了每一次回撤，也躲过了那条真正的大鱼。', '大鱼我认不出来就先放它走，但网不能破——破了就没下一网。'),
  baruchOnLoeb: comment('baruch-on-loeb', 'baruch', 304, '每根波动都要动一次手，交易成本会替市场把你的学费收上去。少动手，反而看得清。', '手可以少动，仓位不能不管。现金也是一种仓位，只是它不吵。'),
  baruchOnKostolany: comment('baruch-on-kostolany', 'baruch', 322, '情绪极端能造机会，可极端之后往往还有更极端。你以为在抄底，可能只是伸手接了别人递过来的刀。', '刀我分批接，一次只伸半只手。就算掉下去，剩下的还有手。'),
  loebOnKostolany: comment('loeb-on-kostolany', 'loeb', 285, '陪着别人坐在悲观里很容易，难的是泡沫里赚钱、泡沫上收手——那是两份完全不同的工作。', '所以我把买卖拆成两件事：进场靠胆量，离场靠纪律。'),
  kostolanyOnBaruch: comment('kostolany-on-baruch', 'kostolany', 311, '永远留着一大半现金，安全是安全了，可行情真来了，你手里只攥着一张观赛门票。', '门票不便宜，但没有门票的人，连进场的机会都没有。'),
  loebOnBaruch: comment('loeb-on-baruch', 'loeb', 269, '逆向最大的风险是太早——早到你被市场磨光了耐心，行情才刚刚开始。', '所以我一分一分地买，让市场给我第二次、第三次机会。'),

  wyckoffOnLivermore2: comment('wyckoff-on-livermore-2', 'wyckoff', 294, '你的止损像消防队，来得快、嗓门大。可如果每次都着火，是不是该查查谁在玩火？', '查火源太慢，先灭火。活下来的人，才有资格坐下来复盘。'),
  baruchOnLivermore2: comment('baruch-on-livermore-2', 'baruch', 287, '赚了钱的仓位你说敢加，亏了钱的你说立刻砍，道理都对。难的是按下单那三秒手别抖。', '手抖说明仓位重了。仓位轻，动作自然干净。'),
  livermoreOnWyckoff2: comment('livermore-on-wyckoff-2', 'livermore', 329, '你把每一笔成交都当线索，可市场大部分时间只是在闲聊。听不出差别，就会把噪音当信号。', '闲聊里也有口风。真听懂了，才知道哪一句值得付钱。'),
  darvasOnWyckoff2: comment('darvas-on-wyckoff-2', 'darvas', 258, '吸筹、派发，听着像破案。我只想问一句：到底突破了没有？', '破案是为了知道突破之后能走多远。不然你追进去，全靠运气。'),
  livermoreOnDarvas2: comment('livermore-on-darvas-2', 'livermore', 347, '箱体理论最好的一点是简单，最坏的一点也是简单——市场有时候就专门骗简单人。', '所以我用最简单的方法配最严格的止损。骗我一次，代价很小。'),
  kostolanyOnDarvas2: comment('kostolany-on-darvas-2', 'kostolany', 271, '你等突破，可突破那一秒，故事的价格已经被别人付掉一半了。', '付掉一半，也比付在最高点强。剩下那半段，留给市场自己证明。'),
  baruchOnLoeb2: comment('baruch-on-loeb-2', 'baruch', 298, '你总在换股，账户像个旋转门。转得越快，利润越容易从缝里漏出去。', '旋转门不积灰。我要的是效率，不是一张好看的持仓表。'),
  kostolanyOnLoeb2: comment('kostolany-on-loeb-2', 'kostolany', 283, '你说止盈要有纪律，可纪律最容易断在「再来一天」这四个字上。', '所以我的止盈写在下单之前，不写在情绪之后。'),
  loebOnKostolany2: comment('loeb-on-kostolany-2', 'loeb', 279, '你把市场当心理剧，观众情绪确实好用，可它不会给你的账户兜底。', '我也不靠兜底，我靠的是别在人群最兴奋的时候上车。'),
  baruchOnKostolany2: comment('baruch-on-kostolany-2', 'baruch', 315, '你说要等市场先表态。等它表完态，价格早站在你不敢追的位置上了。', '那就让它站上去。我只买我自己算得清的那一段。'),
  livermoreOnBaruch2: comment('livermore-on-baruch-2', 'livermore', 331, '留那么多现金，你是在防风险，还是在防自己？', '都有，防自己更值钱。市场从没主动害过我——都是我先动的手。'),
  darvasOnBaruch2: comment('darvas-on-baruch-2', 'darvas', 259, '机会来的时候你说再等等，机会走的时候你说来不及。中间隔着一整个行情。', '隔着的那一段，本来就不是我该赚的钱。'),

  // ── 跨流派互怼，让互评不止两种声音 ──
  baruchOnLivermore: comment('baruch-on-livermore', 'baruch', 309, '你总说关键点要下重手，可关键点后面还有关键点。加对了是行情，加错了是本金的葬礼。', '所以我只在赚着钱的时候加，亏着钱的仓位我一毛都不加。'),
  livermoreOnKostolany: comment('livermore-on-kostolany', 'livermore', 336, '你说市场先于基本面回稳，我同意。但你把那个「先」看得太早，先到的人常常先被埋。', '被埋的是伸早了的那只手，不是我的耐心。我等价格自己开口。'),
  wyckoffOnLoeb: comment('wyckoff-on-loeb', 'wyckoff', 281, '你换股的时候，成交量早就把资金要去哪儿写在脸上了。可惜你每次都是事后才回头看那个量。', '事后看也强过不看。何况我换得快，事后很快就是下一笔。'),
  darvasOnBaruch: comment('darvas-on-baruch', 'darvas', 266, '你把现金当仓位，我把箱体当地图，都挺安全。区别是行情来的时候，谁的车已经在路上了。', '车在路上是真的，但翻得最惨的，往往也是开得最快的那些。'),
};

function plan(id, offset, action, symbol, targetPct, reason, risk, commentsForPlan, extra = {}) {
  return { id, offset, action, symbol, targetPct, reason, risk, changed: false, comments: commentsForPlan, ...extra };
}

export const LEAGUE_PLANS = {
  livermore: [
    plan('livermore-01', 14, '买入', '300059', 42, '价格放量脱离整理区，关键点已经确认。我要站到阻力最小的一边，而不是在突破前猜方向。', '快速跌回整理区说明突破无效，会立即缩减仓位。', [comments.wyckoffOnLivermore, comments.darvasOnLivermore, comments.baruchOnLivermore2]),
    plan('livermore-02', 9, '加仓', '300059', 58, '回踩没有破坏上升结构，随后再次创出阶段新高，趋势允许我用更高仓位承担风险。', '高位加仓会放大回撤，止损必须同步上移。', [comments.darvasOnLivermore, comments.wyckoffOnLivermore]),
    plan('livermore-03', 4, '减仓', '300059', 30, '上涨节奏迟滞，成交也不再配合。我先收回风险，等市场重新证明趋势。', '若整理后再次突破，需要用更高价格买回。', [comments.wyckoffOnLivermore, comments.kostolanyOnLivermore], { changed: true, changeNote: '此前判断趋势会继续加速，但价格没有及时确认，因此先降低仓位。' }),
    plan('livermore-04', 0, '买入', '002594', 22, '新能源车方向重新出现强势信号，价格站上关键点并伴随成交放大，我准备捕捉趋势的第二段。', '若开盘后迅速跌回突破位，会视为信号失败。', [comments.baruchOnLivermore, comments.darvasOnLivermore]),
    plan('livermore-05', 0, '持有', '300059', 30, '东方财富仍在关键支撑上方，暂未出现必须继续减仓的信号，保留观察仓。', '跌破支撑会继续降低仓位。', [comments.kostolanyOnLivermore, comments.wyckoffOnLivermore, comments.wyckoffOnLivermore2]),
  ],
  wyckoff: [
    plan('wyckoff-01', 13, '买入', '601899', 36, '价格在区间内反复测试但下行动能减弱，成交量结构更像吸筹而不是派发。', '若放量跌破区间，吸筹判断失效。', [comments.livermoreOnWyckoff, comments.darvasOnWyckoff]),
    plan('wyckoff-02', 8, '加仓', '601899', 52, '价格离开吸筹区并回踩确认，成交量在上涨时扩张、回调时收缩。', '量价结构若转为放量下跌，需要快速减仓。', [comments.darvasOnWyckoff, comments.livermoreOnWyckoff, comments.darvasOnWyckoff2]),
    plan('wyckoff-03', 3, '减仓', '601899', 28, '上涨过程中出现放量滞涨，部分筹码可能开始派发，先锁定一部分利润。', '若后续缩量整理后再次突破，可能卖得过早。', [comments.livermoreOnWyckoff, comments.kostolanyOnWyckoff]),
    plan('wyckoff-04', 0, '买入', '600036', 22, '银行板块回调缩量，价格回到前期承接区，资金行为更像洗盘而非趋势终结。', '信用风险加剧会让承接区失效。', [comments.livermoreOnWyckoff, comments.darvasOnWyckoff, comments.livermoreOnWyckoff2]),
    plan('wyckoff-05', 0, '持有', '601899', 28, '价格仍在可控区间内，量价没有给出明确的派发确认，保留仓位观察资金去向。', '若出现连续放量阴线，会继续减仓。', [comments.kostolanyOnWyckoff, comments.darvasOnWyckoff]),
  ],
  darvas: [
    plan('darvas-01', 12, '买入', '002594', 38, '股价完成箱体突破，成交量同步放大。我不预测箱体还能延伸多远，只跟随突破后的新趋势。', '跌回原箱体会触发止损。', [comments.livermoreOnDarvas, comments.wyckoffOnDarvas, comments.kostolanyOnDarvas2]),
    plan('darvas-02', 7, '加仓', '002594', 54, '价格形成更高的新箱体，回踩没有跌回旧区间，趋势结构继续改善。', '新箱体下沿就是移动止损线。', [comments.wyckoffOnDarvas, comments.livermoreOnDarvas]),
    plan('darvas-03', 2, '减仓', '002594', 26, '价格跌破最近箱体下沿，动量已经减弱。我不等待理由，先执行退出纪律。', '若重新放量突破，可以再次买回。', [comments.livermoreOnDarvas, comments.kostolanyOnDarvas]),
    plan('darvas-04', 0, '买入', '300059', 20, '金融科技方向重新放量突破，价格和成交量同时进入新的箱体上沿。', '若突破后无法站稳，会快速止损。', [comments.livermoreOnDarvas, comments.wyckoffOnDarvas]),
    plan('darvas-05', 0, '持有', '002594', 26, '当前价格仍在新的观察区间内，没有触发箱体止损，也不适合追高加仓。', '跌破箱体下沿会卖出。', [comments.livermoreOnDarvas, comments.wyckoffOnDarvas, comments.livermoreOnDarvas2]),
  ],
  loeb: [
    plan('loeb-01', 14, '买入', '600036', 34, '金融龙头在基本面稳定时出现趋势改善，我的目标是获取一段可兑现的行情，而不是永久持有。', '若板块轮动失败，会迅速退出。', [comments.wyckoffOnLoeb, comments.baruchOnLoeb]),
    plan('loeb-02', 9, '买入', '600276', 22, '创新药方向出现资金回流，价格转强。我愿意用小仓位试错，把风险留给纪律处理。', '研发或政策预期落空会带来估值回撤。', [comments.kostolanyOnLoeb, comments.baruchOnLoeb, comments.kostolanyOnLoeb2]),
    plan('loeb-03', 4, '减仓', '600036', 18, '银行股的上涨逻辑开始钝化，资金转向更活跃的板块，我选择提高现金和调仓能力。', '若金融板块重新转强，可能错过后续上涨。', [comments.kostolanyOnLoeb, comments.baruchOnLoeb]),
    plan('loeb-04', 0, '加仓', '600276', 32, '医药板块的强势股开始扩散，恒瑞的成交量与相对强度同步改善，我选择顺势提高仓位。', '若板块热度退潮，会快速减仓。', [comments.kostolanyOnLoeb, comments.baruchOnLoeb, comments.baruchOnLoeb2]),
    plan('loeb-05', 0, '卖出', '600036', 0, '原持仓失去相对强势，机会成本已经高于继续持有的理由，卖出资金等待新的主线。', '若银行突然放量突破，需要重新评估。', [comments.baruchOnLoeb, comments.kostolanyOnLoeb]),
  ],
  kostolany: [
    plan('kostolany-01', 11, '买入', '000858', 36, '消费情绪处于悲观区间，但价格已停止下跌。市场心理往往先于基本面回稳。', '若市场继续下修盈利预期，价格可能二次探底。', [comments.baruchOnKostolany, comments.loebOnKostolany, comments.baruchOnKostolany2]),
    plan('kostolany-02', 6, '减仓', '000858', 18, '短期情绪修复很快，价格已经反映了部分乐观预期，先兑现一段利润。', '若消费复苏超预期，可能卖得过早。', [comments.loebOnKostolany, comments.baruchOnKostolany]),
    plan('kostolany-03', 2, '买入', '601318', 25, '金融板块的悲观定价开始松动，市场对利空的反应边际减弱，这是情绪拐点的信号。', '若风险偏好再次下降，板块会重新承压。', [comments.livermoreOnKostolany, comments.loebOnKostolany]),
    plan('kostolany-04', 0, '加仓', '000858', 28, '消费板块的情绪已经由恐慌转向怀疑，价格与成交量同步改善，继续参与修复行情。', '若市场重新进入一致性悲观，会卖出。', [comments.baruchOnKostolany, comments.loebOnKostolany]),
    plan('kostolany-05', 0, '持有', '601318', 25, '金融股的修复逻辑仍在，但市场情绪尚未极端，暂时持有并等待更明确的方向。', '若利空重新定价，会减少仓位。', [comments.baruchOnKostolany, comments.loebOnKostolany, comments.loebOnKostolany2]),
  ],
  baruch: [
    plan('baruch-01', 13, '买入', '601899', 32, '资源品在宏观不确定性中重新获得资金关注，价格开始反映风险溢价的上升。', '若风险事件快速缓和，资源交易会失去动能。', [comments.kostolanyOnBaruch, comments.loebOnBaruch, comments.livermoreOnBaruch2]),
    plan('baruch-02', 7, '减仓', '601899', 18, '市场已经把部分宏观风险计入价格，赔率下降，先收回一部分风险资本。', '若事件继续升级，减仓会降低收益弹性。', [comments.loebOnBaruch, comments.kostolanyOnBaruch]),
    plan('baruch-03', 2, '买入', '600900', 26, '市场波动加大时，长期现金流资产重新获得防御价值，价格却没有明显透支。', '利率快速上行会压制估值。', [comments.darvasOnBaruch, comments.loebOnBaruch]),
    plan('baruch-04', 0, '加仓', '600900', 32, '防御资产在风险事件中获得资金支持，波动率下降且价格结构改善，提高仓位。', '若风险偏好回升，资金会转向高弹性资产。', [comments.kostolanyOnBaruch, comments.loebOnBaruch]),
    plan('baruch-05', 0, '买入', '601318', 18, '金融资产被恐慌情绪压低，长期价值与短期价格出现错位，用小仓位逆向布局。', '若信用风险扩散，会及时止损。', [comments.kostolanyOnBaruch, comments.loebOnBaruch, comments.darvasOnBaruch2]),
  ],
};

export function getLeaguePlanById(id) {
  for (const plans of Object.values(LEAGUE_PLANS)) {
    const found = plans.find((planItem) => planItem.id === id);
    if (found) return found;
  }
  return null;
}
