/* =========================================================================
 * 《云屿酒馆》 Web 版 - data.js
 * 静态数据：随从卡牌（80张 + 衍生物8种）、英雄、AI对手、常量表
 * 依据：《云屿酒馆-核心玩法设计文档 V1.0》第2/4/5/9/11章 + 数值平衡表.xlsx
 *
 * 概念约定（文档 13.1 / 13.2，严格分离）：
 *   tier  = 卡面等级(1~6，★V2.7 上限扩至6)，决定计伤与商店档位，永不变；
 *   star  = 合成星级(1~3)，只影响属性与效果倍率。
 * ========================================================================= */

'use strict';

/* ---------- 通用常量 ---------- */
var CFG = {
  VERSION: '2.9.5',           // ★2026-09-22 升本流加强V2+暖巢羽雀调T2（18张高星随从+1/+1、m61定档T2 2/3+召唤+2；含m61/m47入场召唤通知修复与m50亡语上毒播放修复，原 '2.9.4' 50血统一版；战绩档案 meta.ver 用）
  PLAYER_COUNT: 6,            // 1玩家 + 5AI
  BASE_HP: 50,                // 基础血量（★V2.4 全英雄去护甲，统一 50 血开局；★V2.9.4 萨必拍板由 30 上调）
  HERO_DRAFT_CHOICES: 3,      // ★V2.4 选英雄三选一：玩家候选抽取数量（调大即 N 选一，需 ≤ 英雄池大小）
  BOARD_SLOTS: 7,             // 场上随从上限
  HAND_LIMIT: 5,              // ★V2 手牌上限
  COST_BUY: 3,                // 购买随从
  COST_REFRESH: 1,            // 刷新商店
  COST_SELL: 1,               // 卖出随从所得
  FREEZE_LIMIT: 5,            // 每回合冻结切换上限
  UPGRADE_BASE: [5, 7, 8, 11, 12], // 升到 2~6 本的基础费用（索引 = 当前等级-1；★V2.9.3 完全对齐炉石：5/7/8/11/12（28.2补丁T5=11、34.2补丁T6=12），配合趴本递减每回合-1；自研固定阶梯与折扣机制同版删除）
  UPGRADE_MIN: 0,             // ★V2.9.3 递减下限：0金（对齐炉石，趴本足久可免费升本，保留裸奔流风味）
  MAX_TIER: 6,                // ★V2.7 酒馆等级上限（原硬编码 4，game/ai 全部引用本常量）
  GOLD_CURVE: [0, 3, 4, 5, 6, 7, 8, 9, 10], // 索引=回合；★V2.9.3 对齐炉石收入曲线：R1~R7=3~9，R8起恒为10（原 R5=8/R6起10 快节奏口径）
  SHOP_SLOTS: [3, 4, 4, 5, 5, 6],   // ★V2.7 酒馆1~6级的商店卡位（5/6本新增 5/6）
  TIER_WEIGHT: [3, 2, 1, 0.5, 0.35, 0.25], // 权重按 (酒馆等级-卡面等级) 差值取索引：diff0→3…diff3→0.5（★V8 修复同级卡权重0的兜底错刷）；★V2.7 扩表 diff4→0.35/diff5→0.25——pool.tierWeight 越界返回0，不扩表则 T1/T2 在 5/6 本商店权重为 0（整档消失）
  POOL_COPIES: [0, 12, 10, 8, 6, 5, 4],  // ★V2.7 各卡面等级在共享池中的复制数（新增 T5=5 / T6=4）
  ATTACK_CAP: 60,             // 单场战斗出手上限
  RECRUIT_TIMER: { 1: 60, 4: 75, 8: 90 }, // 招募倒计时：R1-3:60s R4-7:75s R8+:90s
  TRIBES: {
    gear:    { name: '齿轮', color: '#C9A227' },
    wild:    { name: '荒野', color: '#3E7C4F' },
    tide:    { name: '潮汐', color: '#3A6EA5' },
    neutral: { name: '中立', color: '#8C8A84' }
  },
  KEYWORDS: {
    shield:     { name: '圣盾', desc: '抵消一次任意伤害（含剧毒）' },
    taunt:      { name: '嘲讽', desc: '敌方必须优先攻击它' },
    venomous:   { name: '剧毒', desc: '被其伤害的随从直接死亡（圣盾可挡）' },
    windfury:   { name: '风怒', desc: '每轮出手两次' },
    cleave:     { name: '顺劈', desc: '攻击时同时命中目标左右两侧随从' },
    reborn:     { name: '复生', desc: '首次死亡以1血复活（亡语随之触发两次）' },
    deathrattle:{ name: '亡语', desc: '死亡时触发' },
    battlecry:  { name: '战吼', desc: '打出时立即触发' },
    aura:       { name: '光环', desc: '在场时持续生效' },
    startofcombat:{ name: '战斗开始时', desc: '战斗开始时触发' }
  },
  STAR_MULT: [0, 1, 2, 4],    // star → 属性倍率
};

/* ---------- 随从卡牌总表（全池56张：V1基础38张 + ★V3扩容18张） ----------
 * effectKind: battlecry / deathrattle / aura / trigger / startofcombat / onplay / null
 * effectTags 用于 UI 展示；具体逻辑见 effects.js（按 id 分发）
 * needTarget: 战吼需要玩家点选目标 */
var CARDS = [
  // ===== 卡面等级 1 =====
  { id: 'm01', name: '铜壳哨兵',   tier: 1, atk: 1, hp: 1, tribe: 'gear',    kw: ['shield', 'taunt'], effectKind: null, role: '盾墙/过渡' },
  { id: 'm02', name: '发条信使',   tier: 2, atk: 2, hp: 2, tribe: 'gear',    kw: ['battlecry'], effectKind: 'battlecry', needTarget: false, role: '站位配合',
    text: '战吼：使相邻的友方齿轮族随从各获得圣盾。' },
  { id: 'm57', name: '曲柄装配匠', tier: 1, atk: 1, hp: 2, tribe: 'gear',    kw: ['battlecry'], effectKind: 'battlecry', needTarget: false, role: '齿轮前期曲线/相邻增益',
    text: '战吼：使相邻的友方齿轮族随从各+{n}/+{n}。' },
  /* ★V2.2 新增 m58 链轮卫兵（T1 齿轮）：预算 3属性+2效果=5 贴档（对标 m40 T2 亡语两盾 7 线的降档），齿轮族圣盾三时点补全（战吼 m03/m39 → 亡语 m58→m40 → 战开 m31） */
  { id: 'm58', name: '链轮卫兵',   tier: 1, atk: 1, hp: 2, tribe: 'gear',    kw: ['deathrattle'], effectKind: 'deathrattle', role: '亡语传盾/圣盾体系补全',
    text: '亡语：使一个随机友方齿轮族随从获得圣盾。' },
  { id: 'm59', name: '蓄压撞锤',   tier: 1, atk: 1, hp: 2, tribe: 'gear',    kw: [], effectKind: 'startofcombat', role: '战开条件成长/圣盾流低配前瞻',
    text: '战斗开始时：若你场上有其他带圣盾的友方随从，获得+{n}/+{n}。' }, // ★V2.7 新增（伊莎贝拉A案：T1齿轮超容至6，此后冻结T1齿轮新增）；预算1/2+条件效果=5 ✓
  { id: 'm03', name: '螺丝骑兵',   tier: 1, atk: 3, hp: 1, tribe: 'gear',    kw: ['battlecry'], effectKind: 'battlecry', needTarget: true, role: '过渡/先手',
    text: '战吼：使一个友方齿轮族随从获得圣盾；若目标已有圣盾，改为使其+{n}攻击。' },
  { id: 'm04', name: '柴窝母狼',   tier: 1, atk: 1, hp: 1, tribe: 'wild',    kw: ['deathrattle'], effectKind: 'deathrattle', role: '铺场引擎',
    text: '亡语：召唤一只{sa}/{sh}的幼狼。' },
  { id: 'm05', name: '浆果刺猬',   tier: 1, atk: 2, hp: 3, tribe: 'wild',    kw: ['deathrattle'], effectKind: 'deathrattle', role: '铺场引擎',
    text: '亡语：召唤一只{sa}/{sh}的小刺猬。' },
  { id: 'm06', name: '苔穴土拨鼠', tier: 1, atk: 1, hp: 2, tribe: 'wild',    kw: ['deathrattle'], effectKind: 'deathrattle', role: '铺场引擎',
    text: '亡语：召唤两只{sa}/{sh}的土拨鼠。' },
  { id: 'm07', name: '贝壳歌者',   tier: 1, atk: 1, hp: 3, tribe: 'tide',    kw: ['battlecry'], effectKind: 'battlecry', needTarget: true, role: '过渡配合',
    text: '战吼：使另一个友方潮汐随从+{n}/{m}。' },
  { id: 'm08', name: '潮池枪手',   tier: 1, atk: 2, hp: 2, tribe: 'tide',    kw: [], effectKind: 'onplay', role: '出牌连锁成长',
    text: '每当你打出一张潮汐族随从，获得+{n}攻击。' },
  { id: 'm09', name: '乘流幼豚',   tier: 1, atk: 2, hp: 1, tribe: 'tide',    kw: ['windfury'], effectKind: null, role: '先手破盾' },
  { id: 'm10', name: '绷带傀儡',   tier: 1, atk: 1, hp: 2, tribe: 'neutral', kw: ['reborn'], effectKind: 'trigger', role: '复生成长',
    text: '复生：复生后使一个随机友方随从+{n}/+{n}。' },

  { id: 'm60', name: '游丝调校师', tier: 1, atk: 2, hp: 1, tribe: 'gear',    kw: ['aura'], effectKind: 'aura', role: '相邻攻光环（★V2.8 新机制：空间维度）',
    text: '光环：相邻的友方随从+{n}攻击。' },
  { id: 'm61', name: '暖巢羽雀',   tier: 2, atk: 2, hp: 3, tribe: 'wild',    kw: [], effectKind: 'trigger', role: '召唤响应成长（onSummon钩子；★V2.9.5 萨必拍板T1→T2定档2/3+召唤+2）',
    text: '每当有一个随从被召唤到你的场上（含衍生物），获得+{n}生命。' },
  // ===== 卡面等级 2 =====
  { id: 'm11', name: '装甲货运兽', tier: 2, atk: 2, hp: 3, tribe: 'gear',    kw: ['shield'], effectKind: 'trigger', role: '盾破成长',
    text: '每当此随从的圣盾被击破后，获得+{n}/+{n}。' },
  { id: 'm12', name: '装甲军士',   tier: 2, atk: 2, hp: 3, tribe: 'gear',    kw: ['aura'], effectKind: 'aura', role: '血量光环/盾链容错',
    text: '光环：你的所有齿轮族随从生命值+{n}。' }, // ★V2.7 改版：原扩音军士攻光环（与h01重叠）→ 血光环，含自身（用户原文口径），改名装甲军士
  { id: 'm14', name: '獠牙猎首者', tier: 2, atk: 4, hp: 2, tribe: 'wild',    kw: ['deathrattle'], effectKind: 'deathrattle', role: '死亡团队buff',
    text: '亡语：使一个友方荒野族随从+{n}/+{n}。' },
  { id: 'm15', name: '育巢蜘蛛',   tier: 2, atk: 2, hp: 3, tribe: 'wild',    kw: ['deathrattle'], effectKind: 'deathrattle', role: '铺场引擎',
    text: '亡语：召唤两只{sa}/{sh}的织网蛛。' },
  { id: 'm16', name: '嚎月头狼',   tier: 3, atk: 3, hp: 4, tribe: 'wild',    kw: ['aura'], effectKind: 'aura', role: '计数光环（★V2.8 晋升T3，3/4）',
    text: '光环：你的其他荒野族随从+{n}/{n}。' },
  { id: 'm17', name: '泡沫歌姬',   tier: 2, atk: 2, hp: 3, tribe: 'tide',    kw: ['battlecry'], effectKind: 'battlecry', needTarget: false, role: '成长引擎',
    text: '战吼：你的所有潮汐族随从+{n}/{n}。' },
  { id: 'm18', name: '蜕壳巨蟹',   tier: 2, atk: 1, hp: 5, tribe: 'tide',    kw: ['taunt'], effectKind: 'trigger', role: '嘲讽/战长',
    text: '嘲讽。每当该随从受到伤害且存活后，使一个随机友方潮汐随从+{n}/+{n}。' },
  { id: 'm19', name: '旗鱼剑客',   tier: 2, atk: 3, hp: 2, tribe: 'tide',    kw: ['windfury'], effectKind: null, role: '先手破盾' },
  { id: 'm20', name: '情报贩子',   tier: 2, atk: 2, hp: 3, tribe: 'neutral', kw: ['battlecry'], effectKind: 'battlecry', needTarget: false, role: '补卡工具',
    text: '战吼：发现一张等级不高于你酒馆等级的随从。' },

  // ===== 卡面等级 3 =====
  { id: 'm21', name: '偏转机兵',   tier: 3, atk: 2, hp: 4, tribe: 'gear',    kw: [], effectKind: 'trigger', role: '获盾成长',
    text: '每当任意友方随从（含自身）获得圣盾后，获得+{n}/+{n}。' },
  { id: 'm22', name: '铆钉巨盾',   tier: 3, atk: 3, hp: 5, tribe: 'gear',    kw: ['shield', 'taunt'], effectKind: 'trigger', role: '盾墙/循回',
    text: '每当此随从的圣盾被击破后，使随机一个友方齿轮族随从获得圣盾。' },
  { id: 'm23', name: '圣徽巡礼官', tier: 3, atk: 2, hp: 4, tribe: 'gear',    kw: ['aura'], effectKind: 'aura', role: '计数光环',
    text: '光环：你每有一个其他带圣盾的友方随从，便获得+{n}攻击（动态）。' },
  { id: 'm24', name: '葬火狼灵',   tier: 3, atk: 4, hp: 4, tribe: 'wild',    kw: ['deathrattle'], effectKind: 'deathrattle', role: '答案卡/增益',
    text: '亡语：你的其他荒野族随从+{n}/{n}。' },
  { id: 'm25', name: '拾骨兀鹫',   tier: 3, atk: 2, hp: 4, tribe: 'wild',    kw: [], effectKind: 'trigger', role: '成长引擎',
    text: '每当一个友方随从死亡后，获得+{n}/{n}。' },
  { id: 'm26', name: '裂地猛犸',   tier: 3, atk: 4, hp: 5, tribe: 'wild',    kw: ['cleave'], effectKind: null, role: '答案卡/AOE' },
  { id: 'm27', name: '深潮国王',   tier: 3, atk: 4, hp: 4, tribe: 'tide',    kw: ['battlecry'], effectKind: 'battlecry', needTarget: false, role: '成长引擎',
    text: '战吼：你的其他潮汐族随从+{n}/{n}。' },
  { id: 'm28', name: '毒鳍巫医',   tier: 3, atk: 1, hp: 3, tribe: 'tide',    kw: ['battlecry'], effectKind: 'battlecry', needTarget: true, role: '答案卡/上毒',
    text: '战吼：使一名友方潮汐族随从获得剧毒。' },
  { id: 'm29', name: '怒涛战旗手', tier: 3, atk: 3, hp: 3, tribe: 'tide',    kw: ['aura'], effectKind: 'aura', role: '计数光环',
    text: '光环：你的其他潮汐族随从+{n}攻击。' },
  { id: 'm30', name: '竞技场冠军', tier: 4, atk: 5, hp: 6, tribe: 'neutral', kw: ['shield', 'taunt'], effectKind: 'trigger', role: '通用盾墙（★V2.8 晋升T4 5/6；★萨必调整2026-09-05：盾破改永久+1/+2）',
    text: '每当此随从的圣盾被击破后，永久获得+{n}/+{m}。' },

  // ===== 卡面等级 4 =====
  { id: 'm31', name: '圣徽大法官', tier: 4, atk: 4, hp: 6, tribe: 'gear',    kw: ['startofcombat'], effectKind: 'startofcombat', role: '答案卡/核心（随机三盾）',
    text: '战斗开始时：随机使三个齿轮族友方随从获得圣盾；已有圣盾的随从改为获得+{n}/+{n}。' },
  { id: 'm32', name: '余晖收藏家', tier: 4, atk: 2, hp: 8, tribe: 'gear',    kw: [], effectKind: 'trigger', role: '失盾成长',
    text: '每当一个友方随从失去圣盾后，永久获得+{n}/+{n}。' },
  { id: 'm33', name: '森林之王·苍牙', tier: 4, atk: 6, hp: 6, tribe: 'wild', kw: ['deathrattle'], effectKind: 'deathrattle', role: '终局炸弹',
    text: '亡语：召唤两只{sa}/{sh}的巨狼。' },
  { id: 'm34', name: '轮回萨满',   tier: 4, atk: 2, hp: 6, tribe: 'wild',    kw: ['aura'], effectKind: 'aura', role: '答案卡/核心',
    text: '光环：你的亡语效果额外触发{extra}次。' },
  { id: 'm35', name: '深渊巨兽·涡流', tier: 4, atk: 6, hp: 6, tribe: 'tide', kw: ['venomous'], effectKind: null, role: '终局答案卡' },
  { id: 'm36', name: '潮汐女王',   tier: 4, atk: 5, hp: 6, tribe: 'tide',    kw: [], effectKind: 'onplay', role: '成长引擎/核心（★V2.9.5 补弱+1/+1）',
    text: '每当你打出一个潮汐族随从（招募阶段），你的所有潮汐族随从+{n}/{n}。' },
  { id: 'm37', name: '落雷元素',   tier: 4, atk: 4, hp: 7, tribe: 'neutral', kw: ['startofcombat'], effectKind: 'startofcombat', role: '答案卡/AOE（★V2.9.5 补弱+1/+1）',
    text: '战斗开始时：随机对两个敌方随从造成{n}点伤害；若目标因此死亡，对其相邻随从再造成{m}点伤害。' },
  { id: 'm38', name: '永恒角斗士', tier: 4, atk: 6, hp: 6, tribe: 'neutral', kw: ['reborn'], effectKind: 'trigger', role: '复生自我成长',
    text: '复生：复生后获得+{n}/+{n}。' },

  /* ===== ★V3 扩容第一批 m39~m56（设计：伊莎贝拉；数值微调：阿莱克斯《随从扩容数值框架》7.2） ===== */
  // 卡面等级 1
  { id: 'm39', name: '注油工兵',   tier: 2, atk: 2, hp: 3, tribe: 'gear',    kw: ['battlecry'], effectKind: 'battlecry', needTarget: true, role: 'T2给盾工具（★V2.8 晋升T2，2/3）',
    text: '战吼：使一个友方齿轮族随从获得圣盾；若目标已有圣盾，改为使其+{n}/+{n}。' },
  { id: 'm49', name: '拾贝寄居蟹', tier: 2, atk: 2, hp: 3, tribe: 'tide',    kw: ['battlecry'], effectKind: 'battlecry', role: '手牌增益/三合一前置投资（★V2.8 晋升T2，2/3）',
    text: '战吼：使你手牌中的一个随机随从+{n}/{n}。' },
  { id: 'm53', name: '见习佣兵',   tier: 2, atk: 2, hp: 2, tribe: 'neutral', kw: ['shield'], effectKind: 'onplay', role: '跨族出牌成长/自带圣盾（★V2.8 晋升T2，2/2）',
    text: '每当你打出一个随从，获得+{n}攻击。' },
  // 卡面等级 2
  { id: 'm40', name: '殉爆机俑',   tier: 2, atk: 1, hp: 2, tribe: 'gear',    kw: ['deathrattle'], effectKind: 'deathrattle', role: '亡语给盾/桥接卡',
    text: '亡语：使两个随机友方齿轮族随从获得圣盾。' },
  { id: 'm41', name: '鎏金掌旗官', tier: 3, atk: 3, hp: 4, tribe: 'gear',    kw: ['aura'], effectKind: 'aura', role: '盾数团队光环（★V2.8 晋升T3，3/4）',
    text: '光环：你的其他带圣盾的友方随从+{n}攻击。' },
  { id: 'm44', name: '追风猎豹',   tier: 2, atk: 3, hp: 3, tribe: 'wild',    kw: ['windfury'], effectKind: null, role: '荒野速攻流先手/破盾（★萨必调整2026-09-05：2/3→3/3）' },
  { id: 'm45', name: '荆棘藤蔓',   tier: 2, atk: 1, hp: 4, tribe: 'wild',    kw: ['taunt', 'deathrattle'], effectKind: 'deathrattle', role: '死亡驱动的攻击buff',
    text: '嘲讽。亡语：你的其他荒野族随从+{n}攻击。' },
  { id: 'm54', name: '劈骨屠夫',   tier: 2, atk: 3, hp: 2, tribe: 'neutral', kw: ['cleave'], effectKind: null, role: '低配顺劈/前期反铺场' },
  // 卡面等级 3
  { id: 'm42', name: '双联磨轮',   tier: 3, atk: 3, hp: 4, tribe: 'gear',    kw: ['windfury'], effectKind: 'trigger', role: '内战破盾答案/永久成长（★萨必调整2026-09-05：获盾或破盾均永久+1/+1）',
    text: '风怒。每当该随从获得圣盾或击破一个圣盾后，永久获得+{n}/+{m}。' },
  { id: 'm46', name: '腐生双生鹿', tier: 4, atk: 5, hp: 4, tribe: 'wild',    kw: ['reborn', 'deathrattle'], effectKind: 'deathrattle', role: '复生×亡语双铺场（★V2.8 晋升T4；★V2.9.5 补弱+1/+1）',
    text: '亡语：召唤一只{sa}/{sh}的腐芽鹿。' },
  { id: 'm47', name: '掘尸鬣狗',   tier: 3, atk: 2, hp: 4, tribe: 'wild',    kw: [], effectKind: 'trigger', role: '召唤轴成长引擎',
    text: '每当有一个随从被召唤到你的场上（含衍生物），获得+{n}/{n}。' },
  { id: 'm50', name: '毒棘河豚',   tier: 3, atk: 1, hp: 2, tribe: 'tide',    kw: ['deathrattle'], effectKind: 'deathrattle', role: '亡语上毒/死亡链桥接',
    text: '亡语：使一个随机友方潮汐族随从获得剧毒{bonus}。' },
  { id: 'm51', name: '涌泉祭司',   tier: 3, atk: 2, hp: 5, tribe: 'tide',    kw: [], effectKind: 'trigger', role: '元成长引擎',
    text: '每当另一个友方随从获得属性提升后，获得+{n}攻击（每回合最多5次）。' },
  { id: 'm55', name: '铁算盘账房', tier: 3, atk: 2, hp: 5, tribe: 'neutral', kw: [], effectKind: 'trigger', role: '卖出流引擎',
    text: '每当你卖出一个随从后，使两个随机友方随从各+{n}/+{m}。' },
  // 卡面等级 4
  { id: 'm43', name: '余烬锻炉',   tier: 4, atk: 3, hp: 8, tribe: 'gear',    kw: [], effectKind: 'trigger', role: '破盾-回盾引擎（限次；★V2.9.5 补弱+1/+1）',
    text: '每当一个友方随从失去圣盾后，使另一个随机未持盾的友方齿轮族随从获得圣盾（每回合最多2次；2星为4次）。' },
  { id: 'm48', name: '枯木长老',   tier: 4, atk: 3, hp: 7, tribe: 'wild',    kw: ['aura'], effectKind: 'aura', role: '死亡计数团队光环',
    text: '光环：战斗中每有一个友方随从死亡后，你的其他荒野族随从+{n}/{n}（动态，持续至战斗结束）。' },
  // ===== 卡面等级 5（★V2.7 新开档） =====
  { id: 'm62', name: '熔铸巨像',   tier: 5, atk: 5, hp: 7, tribe: 'gear',    kw: ['battlecry'], effectKind: 'battlecry', needTarget: true, role: '齿轮吞并成长（★V2.8 新机制：被吞不触发亡语/复生；★V2.9.5 +1/+1）',
    text: '战吼：吞吃一个友方齿轮族随从获得其攻血（被吞者不触发亡语与复生）。' },
  { id: 'm63', name: '鎏金元帅',   tier: 5, atk: 5, hp: 7, tribe: 'gear',    kw: ['aura'], effectKind: 'aura', role: '齿轮团队光环（★V2.9.5 +1/+1）',
    text: '光环：你的其他齿轮族随从+{n}/{n}。' },
  { id: 'm64', name: '殉爆方阵',   tier: 5, atk: 4, hp: 8, tribe: 'gear',    kw: ['deathrattle'], effectKind: 'deathrattle', role: '亡语全体齿轮上盾（★V2.9.5 +1/+1）',
    text: '亡语：你的所有友方齿轮族随从获得圣盾。' },
  { id: 'm65', name: '兽骨招魂幡', tier: 5, atk: 4, hp: 6, tribe: 'wild',    kw: ['battlecry'], effectKind: 'battlecry', needTarget: true, role: '亡语触发器（★V2.8 新机制：递归深度1；★V2.9.5 +1/+1）',
    text: '战吼：触发一个友方随从的亡语效果（不消耗该随从）。' },
  { id: 'm66', name: '双生古树',   tier: 5, atk: 5, hp: 6, tribe: 'wild',    kw: ['reborn', 'deathrattle'], effectKind: 'deathrattle', role: '复生×亡语双铺场（T5递进；★V2.9.5 +1/+1）',
    text: '复生。亡语：召唤两条{sa}/{sh}的树苗。' },
  { id: 'm67', name: '裂风隼',     tier: 5, atk: 7, hp: 7, tribe: 'wild',    kw: ['windfury', 'deathrattle'], effectKind: 'deathrattle', role: '荒野物理输出（★V2.9.5 +1/+1）',
    text: '亡语：随机友方荒野随从+{n}攻击。' },
  { id: 'm68', name: '沧澜巨灵',   tier: 5, atk: 7, hp: 6, tribe: 'tide',    kw: ['battlecry'], effectKind: 'battlecry', role: '潮汐定值成长（★V2.9.5 +1/+1）',
    text: '战吼：你的其他潮汐族随从+{n}/{n}。' },
  { id: 'm69', name: '雾瘴海巫',   tier: 5, atk: 4, hp: 7, tribe: 'tide',    kw: ['battlecry'], effectKind: 'battlecry', needTarget: true, role: '双毒工具（复用m28管线；★V2.9.5 +1/+1）',
    text: '战吼：使至多两个友方潮汐族随从获得剧毒。' },
  { id: 'm70', name: '断浪鲸',     tier: 5, atk: 9, hp: 6, tribe: 'tide',    kw: ['cleave'], effectKind: null, role: '潮汐物理终结位（★V2.9.5 +1/+1）' },
  { id: 'm71', name: '云游星商',   tier: 5, atk: 5, hp: 6, tribe: 'neutral', kw: ['battlecry'], effectKind: 'battlecry', role: '连续发现（发现加速；★V2.9.5 +1/+1）',
    text: '战吼：连续发现两次（等级不高于你酒馆等级的随从）。' },
  { id: 'm72', name: '酒馆医师',   tier: 5, atk: 6, hp: 8, tribe: 'neutral', kw: ['battlecry'], effectKind: 'battlecry', role: '英雄回血/血量管理（★V2.9.5 +1/+1）',
    text: '战吼：使你的英雄恢复{n}点生命。' },
  { id: 'm52', name: '海渊唤潮者', tier: 5, atk: 4, hp: 8, tribe: 'tide',    kw: ['startofcombat'], effectKind: 'startofcombat', role: '全潮汐定值成长（★V2.9.5 +1/+1）',
    text: '战斗开始时：你所有潮汐族随从获得+{n}/+{n}。' },
  // ===== 卡面等级 6（★V2.7 新开档；★萨必调整2026-09-05：六星精简，仅保留 m74 不灭引擎 / m56 老橡木，m73/m75~m81 移出卡池） =====
  /* ★V2.7 强卡上移（6本框架§4）：m56 老橡木 T4→T6 重铸（T6预算=属性+光环效果5，★V2.9.5 属性15→总预算20）；
     m52 海渊唤潮者 T4→T5 平移（★V2.9.5 4/8+开战效果≈17 恰压 T5 预算线）。 */
  { id: 'm74', name: '不灭引擎',   tier: 6, atk: 6, hp: 8, tribe: 'gear',    kw: ['taunt'], effectKind: 'trigger', role: '盾破→复生纵深（★V2.8 新触发维度；★萨必调整2026-09-05：追加嘲讽；★V2.9.5 +1/+1）',
    text: '嘲讽。你的其他齿轮族随从的圣盾被击破后，获得复生。' },
  { id: 'm56', name: '酒馆老板·老橡木', tier: 6, atk: 6, hp: 9, tribe: 'neutral', kw: ['aura'], effectKind: 'aura', role: '混编终极核心（★V2.9.5 +1/+1）',
    text: '光环：你的所有随从视为所有种族。' },
];

/* ---------- 亡语衍生物（不在共享池中，计伤按1级） ---------- */
var TOKENS = [
  { id: 't01', name: '幼狼',   tier: 1, atk: 3, hp: 2, tribe: 'wild', kw: [], effectKind: null, token: true },
  { id: 't02', name: '土拨鼠', tier: 1, atk: 1, hp: 1, tribe: 'wild', kw: [], effectKind: null, token: true },
  { id: 't03', name: '织网蛛', tier: 1, atk: 1, hp: 2, tribe: 'wild', kw: [], effectKind: null, token: true },
  { id: 't04', name: '巨狼',   tier: 1, atk: 4, hp: 4, tribe: 'wild', kw: [], effectKind: null, token: true },
  { id: 't05', name: '小刺猬', tier: 1, atk: 2, hp: 2, tribe: 'wild', kw: [], effectKind: null, token: true },
  { id: 't06', name: '腐芽鹿', tier: 1, atk: 3, hp: 3, tribe: 'wild', kw: [], effectKind: null, token: true }, // m46 腐生双生鹿衍生物（★V2.8 随m46晋升T4重铸 2/2→3/3）
  { id: 't07', name: '狼崽',   tier: 1, atk: 1, hp: 1, tribe: 'wild', kw: [], effectKind: null, token: true }, // ★V17 h06 兽穴看守·苔莉战开召唤衍生物（文档记"1/1幼狼"与t01实际3/2冲突，定稿新增轻量token，t01保持m04亡语口径）
  { id: 't08', name: '树苗',   tier: 1, atk: 3, hp: 3, tribe: 'wild', kw: [], effectKind: null, token: true }, // ★V2.8 m66 双生古树衍生物
];

/* ---------- 英雄（第9章：★V17 扩容至10位 h01-h10，全部带技能；★V2.4 用户定版：
 *            全英雄去护甲——armor 字段整体移除，任何英雄统一 30 血开局） ---------- */
var HEROES = [
  {
    id: 'h01', name: '铁腕执政官·布伦希尔', short: '布伦希尔', tribe: 'gear',
    skill: '战争践踏（被动光环）：你的所有随从攻击力+2。',
    text: '铁腕统治锅炉城三十年的老执政官。'
  },
  {
    id: 'h02', name: '时之旅人·艾洛蒂', short: '艾洛蒂', tribe: 'neutral',
    skill: '先见之明（被动）：每回合的第一次商店刷新免费。',
    text: '在时间支流间漂泊的旅行者，总能抢到最新一版的酒单。'
  },
  {
    id: 'h03', name: '驯潮师·摩根', short: '摩根', tribe: 'tide',
    skill: '潮汐感知（被动）：商店每次生成/刷新必包含1张潮汐族随从。',
    text: '环礁氏族最年轻的驯潮师，能听见云海之下的暗涌。'
  },
];

/* ===== ★V17 英雄池扩容 h04–h10（设计：伊莎贝拉《带技能英雄池扩容设计》附录A；
 *        实装与数值校验：阿莱克斯。★V2.4 全英雄无护甲，统一 30 血平血） ===== */
var HEROES_ADD = [
  { id: 'h04', name: '锻盾师·薇拉', short: '薇拉', tribe: 'gear',
    skill: '机簧启动（被动）：每回合你打出的第一张齿轮族随从获得圣盾。',
    text: '锅炉城最好的锻盾匠，相信每一面盾都该在出坊前就挂上钩。' },
  { id: 'h05', name: '拾荒商人·霍克', short: '霍克', tribe: 'neutral',
    skill: '回收协议（被动）：你卖出随从时额外获得1金币（每回合最多2次）。',
    text: '锅炉城下水道口的旧货大王，信条是"没有废物，只有放错位置的钱"。' },
  { id: 'h06', name: '兽穴看守·苔莉', short: '苔莉', tribe: 'wild',
    skill: '兽群哺育（被动）：战斗开始时，召唤一只狼崽，其攻击力和生命值等同于你生命值最高的友方随从的攻击力和生命值；若你场上没有友方随从，则召唤一只1/1的狼崽。',
    text: '苍牙森林边缘的兽穴看守，幼狼们都以为她是妈妈。' },
  { id: 'h07', name: '图腾行者·喀尔', short: '喀尔', tribe: 'wild',
    skill: '部族图腾（被动光环）：你的荒野族随从+1/+1。',
    text: '背着整根图腾柱走遍云屿的苦行僧，柱上刻着所有荒野兽的名字。' },
  { id: 'h08', name: '驭浪祭司·澜', short: '澜', tribe: 'tide',
    skill: '引浪（被动）：每当你打出一个潮汐族随从，随机一个友方潮汐族随从+1/+1（每回合最多3次）。',
    text: '环礁祭司中的异类，坚信最好的祈祷是亲手把浪推回去。' },
  { id: 'h09', name: '珍品收藏家·杜恩', short: '杜恩', tribe: 'neutral',
    skill: '藏品热忱（被动）：你三连合成后，发现一张等级不高于你酒馆等级的随从，免费置入手牌（手牌已满时改为获得3金币）。',
    text: '酒馆二楼包厢的常客，为了一套完整的手办可以连赢三晚。' },
  { id: 'h10', name: '末路剑客·凯拉', short: '凯拉', tribe: 'neutral',
    skill: '背水（被动光环）：你的生命值不高于17时，你的所有随从攻击翻倍。',
    text: '输掉一切后才学会赢的流浪剑客，越接近绝境，剑越稳。' },
];
HEROES = HEROES.concat(HEROES_ADD);

/* ---------- AI 对手（第11章 + 数值平衡表“AI脚本参数”） ---------- */
var AI_CONFIGS = [
  {
    id: 'ai1', name: '锅炉城主·铁须', short: '铁须', tribe: 'gear', mult: 1.1,
    desc: '高压对手（局内Boss感）', posNote: '嘲讽置左1/2位，圣盾输出居中'
  },
  {
    id: 'ai2', name: '林海兽王·苍爪', short: '苍爪', tribe: 'wild', mult: 1.0,
    desc: '标准对手', posNote: '亡语怪前置，轮回萨满最右保活'
  },
  {
    id: 'ai3', name: '环礁祭司·潮语', short: '潮语', tribe: 'tide', mult: 1.0,
    desc: '标准对手', posNote: '巨蟹嘲讽顶前，剧毒随从中后位'
  },
  {
    id: 'ai4', name: '佣兵队长·独眼', short: '独眼', tribe: null, mult: 0.95,
    desc: '下限保底对手', posNote: '通用：嘲讽前，输出后'
  },
  {
    id: 'ai5', name: '神秘旅人·兜帽', short: '兜帽', tribe: 'random', mult: 1.05,
    desc: '每局随机三选一族，制造变化', posNote: '按实际族系执行对应脚本'
  },
];

var DIFFICULTIES = [          /* ★V2.9.4 萨必拍板：AI 全员最强档，仅留 hard 单档（表结构保留：ui/multi chips、recorder diffId 反查零改动；历史 easy/normal 由 multi 读侧净化） */
  { id: 'hard',   name: '困难', mult: 1.2 },
];

/* ---------- 工具 ---------- */
var CARD_BY_ID = {};
CARDS.concat(TOKENS).forEach(function (c) { CARD_BY_ID[c.id] = c; });

var HERO_BY_ID = {};
HEROES.forEach(function (h) { HERO_BY_ID[h.id] = h; });

var TRIBE_NAMES = { gear: '齿轮', wild: '荒野', tide: '潮汐', neutral: '中立' };
var TRIBE_COLORS = { gear: '#C9A227', wild: '#3E7C4F', tide: '#3A6EA5', neutral: '#8C8A84' };

/** 数值型效果随星级缩放：×1 / ×2 / ×4 */
function scaleNum(base, star) { return base * CFG.STAR_MULT[star]; }
/** 赋予型补正：2星+2/+2，3星+4/+4（返回 [atk,hp] 数组） */
function grantBonus(star) { return star >= 3 ? [4, 4] : star === 2 ? [2, 2] : [0, 0]; }
/** 触发次数型：1星+1 / 2星+2 / 3星+3（轮回萨满额外触发次数） */
function triggerExtra(star) { return star; }

/** ★2026-08-29 三连关键词继承：全部战斗关键词的统一口径
 *  两条存储路径——卡面自带：def.kw → makeMinion 实例化（同 cardId 合并时天然重建）；
 *  运行时增益：grantedXxx 标记（战吼/亡语/触发赋予），三连合并时必须随卡保留 */
var KW_LIST = ['shield', 'taunt', 'venomous', 'windfury', 'cleave', 'reborn'];
function kwGrantedKey(k) { return 'granted' + k.charAt(0).toUpperCase() + k.slice(1); }

/** 生成随从实例（star 为合成星级） */
function makeMinion(cardId, star) {
  var def = CARD_BY_ID[cardId];
  if (!def) throw new Error('unknown card: ' + cardId);
  star = star || 1;
  var mult = CFG.STAR_MULT[star];
  var m = {
    uid: makeMinion._uid++,
    cardId: def.id,
    name: def.name,
    tier: def.tier,            // 卡面等级（计伤用，永不变）
    star: star,                // 合成星级
    tribe: def.tribe,
    baseAtk: def.atk * mult,   // 星级基础值
    baseHp: def.hp * mult,
    buffAtk: 0, buffHp: 0,     // 永久增益（合成时继承）
    damage: 0,                 // 战斗中已损失的生命
    // 关键词实例化（天赋 + 后天获得）
    shield: def.kw.indexOf('shield') >= 0,
    taunt: def.kw.indexOf('taunt') >= 0,
    venomous: def.kw.indexOf('venomous') >= 0,
    windfury: def.kw.indexOf('windfury') >= 0,
    cleave: def.kw.indexOf('cleave') >= 0,
    reborn: def.kw.indexOf('reborn') >= 0,
    token: !!def.token,        // 衍生物标记（t01~t08 实例化；★修复2026-09-04 补齐字段）
    grantedVenomous: false,    // 巫医等后天赋予
    // ★2026-08-29 后天赋予标记全集（三连继承用；卡面自带的保持 false）
    grantedShield: false, grantedTaunt: false, grantedWindfury: false,
    grantedCleave: false, grantedReborn: false,
    // 战斗运行时
    alive: true,
    revived: false,
    pendingDeath: false,
  };
  m.effectKind = def.effectKind;
  return m;
}
makeMinion._uid = 1;

/** 卡牌效果文本按星级渲染 */
function cardText(def, star) {
  if (!def.text) return def.kw.length ? '' : '白板';
  var t = def.text, n;
  switch (def.id) {
    // 数值型 ×1/×2/×4
    case 'm03': t = t.replace('{n}', scaleNum(2, star)); break;
    case 'm04': t = fillSummon(t, 3, 2, star); break;
    case 'm05': t = fillSummon(t, 2, 2, star); break;
    case 'm06': t = fillSummon(t, 1, 1, star); break;
    case 'm07': t = t.replace('{n}', scaleNum(1, star)).replace('{m}', scaleNum(2, star)); break;
    case 'm08': t = t.replace('{n}', scaleNum(1, star)); break;
    case 'm10': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm11': t = t.replace(/\{n\}/g, scaleNum(2, star)); break;
    case 'm12': t = t.replace('{n}', scaleNum(1, star)); break;
    case 'm14': t = t.replace(/\{n\}/g, scaleNum(2, star)); break;
    case 'm15': t = fillSummon(t, 1, 2, star); break;
    case 'm16': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm17': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm18': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm21': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm23': t = t.replace('{n}', scaleNum(1, star)); break;
    case 'm24': t = t.replace(/\{n\}/g, scaleNum(2, star)); break;
    case 'm25': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm27': t = t.replace(/\{n\}/g, scaleNum(2, star)); break;
    case 'm29': t = t.replace('{n}', scaleNum(2, star)); break;
    case 'm30': t = t.replace('{n}', scaleNum(1, star)).replace('{m}', scaleNum(2, star)); break; // ★萨必调整2026-09-05：盾破永久+1/+2
    case 'm31': t = t.replace(/\{n\}/g, scaleNum(3, star)); break;
    case 'm32': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm33': t = fillSummon(t, 4, 4, star); break;
    case 'm36': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm37': t = t.replace('{n}', scaleNum(4, star)).replace('{m}', scaleNum(2, star)); break;
    case 'm38': t = t.replace(/\{n\}/g, scaleNum(3, star)); break;
    // ★V3 新增随从（m39~m56）
    case 'm39': t = t.replace(/\{n\}/g, scaleNum(2, star)); break;
    case 'm41': t = t.replace('{n}', scaleNum(1, star)); break;
    case 'm42': t = t.replace('{n}', scaleNum(1, star)).replace('{m}', scaleNum(1, star)); break; // ★萨必调整2026-09-05：获盾/破盾均永久+1/+1
    case 'm45': t = t.replace('{n}', scaleNum(2, star)); break;
    case 'm46': t = fillSummon(t, 3, 3, star); break; // ★V2.9.1 对齐t06重铸(2/2→3/3)，2026-09-04
    case 'm47': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm48': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm49': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm51': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm52': t = t.replace(/\{n\}/g, scaleNum(3, star)); break;
    case 'm53': t = t.replace('{n}', scaleNum(1, star)); break;
    case 'm55': t = t.replace('{n}', scaleNum(2, star)).replace('{m}', scaleNum(1, star)); break;
    case 'm57': t = t.replace(/\{n\}/g, scaleNum(1, star)); break;
    case 'm59': t = t.replace(/\{n\}/g, scaleNum(2, star)); break; // ★V2.8 补修：V2.7 漏配 case，{n}曾按字面量显示
    case 'm60': t = t.replace('{n}', scaleNum(1, star)); break;
    case 'm61': t = t.replace('{n}', scaleNum(2, star)); break; // ★V2.9.5 T2定档：召唤+2生命（基数1→2）
    case 'm63': t = t.replace(/\{n\}/g, scaleNum(2, star)); break;
    case 'm66': t = fillSummon(t, 3, 3, star); break;
    case 'm67': t = t.replace('{n}', scaleNum(2, star)); break;
    case 'm68': t = t.replace(/\{n\}/g, scaleNum(2, star)); break;
    case 'm72': t = t.replace('{n}', scaleNum(4, star)); break;
    // ★萨必调整2026-09-05：六星精简，m76/m77/m78/m80/m81 的文本模板随卡删除（m73/m75/m79 为静态文本无模板）
    // 赋予型：补正文本
    // （m28 毒鳍巫医已改为单体指定目标上毒，卡面不再含 {bonus} 补正，见平衡调整 2026-08-29）
    case 'm50': t = t.replace('{bonus}', grantText(star)); break;
    // 触发次数型
    case 'm34': t = t.replace('{extra}', triggerExtra(star)); break;
  }
  return t;
}
function fillSummon(t, a, h, star) {
  return t.replace('{sa}', scaleNum(a, star)).replace('{sh}', scaleNum(h, star));
}
function grantText(star) {
  var b = grantBonus(star);
  return b[0] ? '，并使其+' + b[0] + '/+' + b[1] : '';
}
