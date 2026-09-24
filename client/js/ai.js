/* =========================================================================
 * 《云屿酒馆》 Web 版 - ai.js  ★V2 真实经济模拟 + ★V5 AI强化落地（2026-08-29）
 * 5 个 AI 对手（V2文档第11章）：
 *   - AI每回合像真实玩家一样赚金币 → 从共享池抽取商店(占用Pool) →
 *     购买随从(占用共享池) → 刷新 → 升酒馆 → 凑三合一升星 → 站位
 *   - AI商店抽取与玩家走同一 Pool 模块，真实影响共享池计数
 *   - 鬼魂机制：死亡后保留真实board作鬼魂
 *
 * ★V5 AI强化（依据《云屿酒馆-AI强化设计方案-阿莱克斯》；★管理员 2026-08-29 范围指令：
 *   本轮只交付 P0+P1，P2 不做 → ENABLE_P2=false，hard 档走 P1 精英档多变体择优；
 *   P2 代码完整保留，拍板启用后一行开关生效）：
 *   P0 难度接线：diffMult 三档映射决策强度，个体系数 ai.mult 同步接入
 *     easy(0.8)  → strength 0.3 → 现版基线逻辑原样（legacy，作为弱AI基线）
 *     normal(1.0)→ strength 0.6 → P1 启发式管线（评分制买/卖/上场/升本/冻结/血线）
 *     hard(1.2)  → strength 1.0 → ENABLE_P2 ? P2模拟驱动 : P1精英档（多变体择优）
 *     个体强度系数 ai.mult（AI_CONFIGS：1.1/1.0/1.0/0.95/1.05）首次生效：
 *     - 决策强度缩放 s=strengthOf(diffMult)×mult（档位边界生效）；
 *     - mult≥1.05 的 AI 精英档追加组合变体；- quickSettle 战力乘数（mult^1.2 温和映射）
 *   P1 启发式：统一卡牌评分器（族系/关键词/三连嗅觉/档位适配）+ 最优购买 +
 *     价值化上场 + 修复"卖嘲讽"bug + 升本门（不再升完饿死）+ 冻结攒三连 + 血线意识
 *   P2 模拟驱动（★V4.1 两段式，默认关闭待拍板）：影子视图无副作用推演多套计划变体；
 *     第一段战力比值快评全体变体 → 第二段 Top-2 变体与对手真实阵容跑真·Battle.simulate
 *     蒙特卡洛精评（65/35 混合战力先验）→ 最优阵容站位模板对拍（剧毒先手）；
 *     单回合预算 120ms，任一阶段超时降级为已算最优/启发式。
 *   ★V4.1 其余：P1/P2 场满腾位回收（护嘲讽/三连组件/升星核心）；
 *     修复 planHeuristic minBuyScore 参数错位（cheapBuy/酒馆档位感知失效）。
 *   ★V6（2026-08-29 管理员指令②）：P2 启停实验——开启实测 B1=48.0%（n=400，连同 V5
 *     三次复测均值≈50.7%，远低于 65% 验收线；性能合规 81.5ms/回合）→ 按"不达标即回退"
 *     指令回退关闭，P2 重设计前维持 ENABLE_P2=false（详见开关处注记）。
 *   ★V6.1（2026-08-29）：E8b 基准暴露 P1 影子推演不建模三连合并，aggressiveSell 变体
 *     会拆卖素材（复现 57/3000）→ P1 路径计划前补真实 aiMergeCheck 预合并（0/3000）；
 *     worstHandIdx 补三连/对子组件保护 + 修复嘲讽符号写反（原 sc-=6 实为优先卖嘲讽）。
 *   红线：不触碰 56 张卡池、POOL_COPIES、TIER_WEIGHT、GOLD_CURVE、玩家规则。
 * ========================================================================= */

'use strict';

var AI = (function () {

  /* ---------- 战力估值（文档 11.10） ---------- */

  function minionPower(m, board) {
    var atk = m.baseAtk + m.buffAtk;
    var hp = m.baseHp + m.buffHp;
    var p = atk + hp;
    if (m.shield) p += 2;
    if (m.venomous) p += 4;
    if (m.taunt) p += 1;
    if (m.windfury) p += atk;
    if (m.reborn) p += hp / 2;
    if (m.effectKind === 'deathrattle') {
      switch (m.cardId) {
        case 'm04': p += (scaleNum(3, m.star) + scaleNum(2, m.star)) / 2; break;
        case 'm05': p += (scaleNum(2, m.star) + scaleNum(2, m.star)) / 2; break;
        case 'm06': p += 2 * (1 + 1) * CFG.STAR_MULT[m.star] / 2; break;
        case 'm14': p += (2 + 2) * CFG.STAR_MULT[m.star] * 1.5; break;
        case 'm15': p += 2 * (1 + 2) * CFG.STAR_MULT[m.star] / 2; break;
        case 'm24': p += (2 + 2) * CFG.STAR_MULT[m.star] * 1.5; break;
        case 'm33': p += 2 * (4 + 4) * CFG.STAR_MULT[m.star] / 2; break;
        /* ★V2.9 新卡亡语估值 */
        case 'm64': p += 5; break;
        case 'm66': p += 3 + scaleNum(1, m.star); break;
        case 'm67': p += 2 + scaleNum(1, m.star); break;
        // ★萨必调整2026-09-05：六星精简，估值 case m75/m77 随卡移除
      }
    }
    // ★萨必调整2026-09-05：六星精简，m73/m80（startofcombat 估值）随卡移除
    if (m.effectKind === 'aura') {
      var mates = 0;
      if (board) {
        for (var i = 0; i < board.length; i++) {
          var x = board[i];
          if (x !== m && x.tribe === m.tribe) mates++;
        }
      }
      mates = Math.max(mates, 2);
      switch (m.cardId) {
        case 'm12': p += mates * scaleNum(1, m.star); break;
        case 'm16': p += mates * scaleNum(1, m.star) * 2; break;
        case 'm29': p += mates * scaleNum(2, m.star); break;
        case 'm23': p += 3; break;
        case 'm34': p += 6; break;
        case 'm60': p += 2 * scaleNum(1, m.star); break;
        case 'm63': p += mates * scaleNum(1, m.star); break;
        // ★萨必调整2026-09-05：六星精简，估值 case m76 随卡移除
      }
    }
    // V2 触发链成长引擎额外估值
    var growthCards = { 'm08': 1, 'm11': 1, 'm18': 1, 'm21': 1, 'm22': 1, 'm25': 1, 'm30': 1, 'm31': 1, 'm32': 1, 'm36': 1, 'm37': 1, 'm38': 1, 'm10': 1, 'm61': 1, 'm74': 1 }; // ★V2.9 +m61召唤成长/+m74盾破复生引擎
    if (growthCards[m.cardId]) p *= 1.3;
    if (m.cardId === 'm37') p += 8;
    if (m.cardId === 'm31') p += 6;
    if (m.cardId === 'm62') p += 5;   // ★V2.9 吞并成长（买侧已建模体系协同）
    return p;
  }

  function boardPower(board) {
    var total = 0;
    for (var i = 0; i < board.length; i++) total += minionPower(board[i], board);
    return total;
  }

  /* ---------- ★V2 真实经济运营 ---------- */

  /** AI目标酒馆等级曲线（★V2.9 六本重排：适配 R8~R14 对局——
   *  金账校验（★V2.9.3 炉石收入曲线 3/4/5/6/7/8/9/R8起10）：R12 累计收入 92金，
   *  全升级费原价 43金（5/7/8/11/12）、典型节奏（T2@R3/T3@R4/T4@R5/T5@R7/T6@R9）等效 ≈35金（递减）；
   *  T5=11/T6=12 基础价 > 收入10，踩点升级可由 aiTurn「卖弱补差价」门补 ≤1金，趴本则自然降价；
   *  150局探针实测（test/ai-upgrade-curve.js，T6中位）：rush R10 / 均衡 R12 / triple R13，
   *  与灵犀《升级规则整理文档V2》§7.5 预期逐项吻合，R14 达6本率 100%；
   *  rush 以少买怪换节奏，triple 滞留低本抓三连。 */
  function targetTavern(turn, strategy) {
    // strategy: 'rush'(冲本型) / 'balanced'(均衡) / 'triple'(追三连)
    if (strategy === 'rush') {
      if (turn <= 1) return 1;
      if (turn <= 3) return 2;
      if (turn <= 5) return 3;
      if (turn <= 7) return 4;
      if (turn <= 9) return 5;
      return 6;
    }
    if (strategy === 'triple') {
      if (turn <= 2) return 1;
      if (turn <= 5) return 2;
      if (turn <= 8) return 3;
      if (turn <= 10) return 4;
      if (turn <= 12) return 5;
      return 6;
    }
    // balanced
    if (turn <= 2) return 1;
    if (turn <= 4) return 2;
    if (turn <= 7) return 3;
    if (turn <= 9) return 4;
    if (turn <= 11) return 5;
    return 6;
  }

  /** AI从共享池抽取商店（与玩家同一 Pool；★V17 h03 驯潮师同规：每次生成必含1张潮汐） */
  function aiDrawShop(ai) {
    var slots = CFG.SHOP_SLOTS[ai.tavern - 1];
    var cards = [];
    for (var i = 0; i < slots; i++) {
      var id = Pool.draw(ai.tavern);
      if (id) cards.push({ id: id });
    }
    if (ai.heroId === 'h03' && cards.length) {
      var hasTide = cards.some(function (c) { return CARD_BY_ID[c.id].tribe === 'tide'; });
      if (!hasTide) {
        var tid = Pool.draw(ai.tavern, function (c) { return c.tribe === 'tide'; });
        if (tid) {
          var slot = Math.floor(Math.random() * cards.length);
          Pool.unloan(cards[slot].id);
          cards[slot] = { id: tid };
        }
      }
    }
    return cards;
  }

  /** AI升级费用（★V2.9.3 与玩家 upgradeCost 同规：基础价+趴本递减、下限0金；turn=当前回合） */
  function aiUpgradeCost(ai, turn) {
    if (ai.tavern >= CFG.MAX_TIER) return 999;
    var base = CFG.UPGRADE_BASE[ai.tavern - 1];
    return Math.max(CFG.UPGRADE_MIN, base - (turn - ai.tierSince));
  }

  /** AI刷新商店 */
  function aiRefreshShop(ai) {
    ai.shop.forEach(function (c) { Pool.unloan(c.id); });
    ai.shop = aiDrawShop(ai);
  }

  /** ★V17 h02 时之旅人 AI 同规：每回合第一次刷新免费；否则扣金（余额不足返回 false）。
   *  统一支付入口，供 aiTurn 内三处刷新决策调用。 */
  function aiPayRefresh(ai) {
    if (ai.heroId === 'h02' && !ai._h02free) {
      ai._h02free = true;
      return true;
    }
    if (ai.gold >= CFG.COST_REFRESH) {
      ai.gold -= CFG.COST_REFRESH;
      return true;
    }
    return false;
  }

  /** AI购买随从（占用共享池，入手牌） */
  function aiBuy(ai, shopIdx) {
    var card = ai.shop[shopIdx];
    if (!card) return false;
    if (ai.gold < CFG.COST_BUY) return false;
    if (ai.hand.length >= CFG.HAND_LIMIT) return false;
    ai.gold -= CFG.COST_BUY;
    Pool.consume(card.id);
    ai.shop.splice(shopIdx, 1);
    ai.hand.push(makeMinion(card.id, 1));
    return true;
  }

  /** AI从手牌上场 */
  function aiPlayFromHand(ai, handIdx) {
    var m = ai.hand[handIdx];
    if (!m) return false;
    if (ai.board.length >= CFG.BOARD_SLOTS) return false;
    ai.hand.splice(handIdx, 1);
    ai.board.push(m);
    /* ★bugfix 2026-09-22（m61/m47）：AI 招募期打出手牌也是召唤事件，同步通知 onSummon
       （对齐玩家侧 afterAcquire 同规；召唤触发先于战吼）。数值基数不动。 */
    Effects.onSummon(ai.board, m, function () {});
    // 触发战吼（简化版：不给目标选择，自动选最优）
    var bRes = runAIBattlecry(ai, m);
    // ★BUG修复 2026-09-04：m20/m71 发现信号由 AI 侧接管结算（对齐玩家 openDiscover→placeDiscovered）
    if (bRes === 'discover' || bRes === 'discover2') {
      aiDiscoverSettle(ai, bRes === 'discover2' ? 2 : 1, 0);
    }
    // 打出触发（潮汐女王/潮池枪手）
    Effects.onPlayTrigger(ai.board, m, function () {});
    // ★V17 英雄打出触发（h04机簧启动/h08引浪，与玩家 heroOnPlay 同规）
    heroOnPlayAI(ai, m);
    // 三合一检查
    aiMergeCheck(ai);
    return true;
  }

  /** ★V17 AI版英雄打出触发：与玩家 heroOnPlay 同规（h04 第一张齿轮获盾/h08 打出潮汐→随机潮汐+1/+1×3） */
  function heroOnPlayAI(ai, m) {
    if (!ai.heroId) return;
    if (ai.heroId === 'h04' && !ai._h04used && !m.shield && Effects.isTribe(m, 'gear', ai.board)) {
      ai._h04used = true;
      m.shield = true;
      m.grantedShield = true;
      Effects.onShieldGain(ai.board, m, function () {});
    }
    if (ai.heroId === 'h08' && (ai._h08n || 0) < 3 && Effects.isTribe(m, 'tide', ai.board)) {
      var cands = ai.board.filter(function (x) { return x.alive && Effects.isTribe(x, 'tide', ai.board); });
      if (cands.length) {
        ai._h08n = (ai._h08n || 0) + 1;
        var pick = cands[Math.floor(Math.random() * cands.length)];
        pick.buffAtk += 1; pick.buffHp += 1;
        Effects.onBuffGained(ai.board, pick, function () {});
      }
    }
  }

  /** AI卖弱卡（场上） */
  function aiSellBoard(ai, idx) {
    var m = ai.board[idx];
    if (!m) return false;
    ai.board.splice(idx, 1);
    // ★V17 h05 回收协议：AI 同规卖出回金（每回合最多2次）
    ai.gold += CFG.COST_SELL + (ai.heroId === 'h05' && (ai._h05n || 0) < 2 ? ((ai._h05n = (ai._h05n || 0) + 1), 1) : 0);
    Pool.returnMinion(m.cardId, m.star);
    return true;
  }

  /** AI卖手牌 */
  function aiSellHand(ai, idx) {
    var m = ai.hand[idx];
    if (!m) return false;
    ai.hand.splice(idx, 1);
    // ★V17 h05 回收协议：AI 同规卖出回金（每回合最多2次）
    ai.gold += CFG.COST_SELL + (ai.heroId === 'h05' && (ai._h05n || 0) < 2 ? ((ai._h05n = (ai._h05n || 0) + 1), 1) : 0);
    Pool.returnMinion(m.cardId, m.star);
    return true;
  }

  /** AI战吼（简化：自动选目标；★V4 m28 剧毒优先给攻击力最高的友方潮汐） */
  function runAIBattlecry(ai, m) {
    var def = CARD_BY_ID[m.cardId];
    if (def.effectKind !== 'battlecry') return;
    var target = null;
    if (def.needTarget) {
      var options = Effects.battlecryTargets(m, ai.board);
      if (options.length) {
        if (m.cardId === 'm28' || m.cardId === 'm69') { // ★V2.8 m69 雾瘴海巫同享剧毒优先级（攻高者先浸毒）
          // 剧毒的毒杀价值随攻击力放大 → 选最高攻目标
          options.sort(function (a, b) { return (b.baseAtk + b.buffAtk) - (a.baseAtk + a.buffAtk); });
        } else {
          // 其余战吼：选战力最高的目标
          options.sort(function (a, b) { return minionPower(b, ai.board) - minionPower(a, ai.board); });
        }
        target = options[0];
      }
    }
    // ★BUG修复 2026-09-04：透传 effects.js 信号（'discover'/'discover2'），
    //   由调用方接管 AI 发现结算——旧实现丢弃返回值，导致 AI 打出 m20 情报贩子/m71
    //   云游星商=白板战吼（玩家侧 game.js 会完整接管发现流程，AI 侧为缺失路径）。
    return Effects.runBattlecry(m, ai.board, {
      target: target,
      hand: ai.hand, // ★V3 m49 拾贝寄居蟹：AI 战吼可增益手牌
      fx: function () {},
      // ★V2.8 m72 酒馆医师：AI 英雄回血（上限=基础血+护甲）
      healHero: function (n) { ai.hp = Math.min(CFG.BASE_HP + (ai.armor || 0), (ai.hp || CFG.BASE_HP) + n); },
      // ★V2.8 m65 兽骨招魂幡：AI 招募期亡语召唤（满员拦截）
      summonFn: function (cardId, star) {
        if (ai.board.length >= CFG.BOARD_SLOTS) return null;
        var tok = makeMinion(cardId, star);
        ai.board.push(tok);
        Effects.onSummon(ai.board, tok, function () {});
        return tok;
      }
    });
  }

  /* =======================================================================
   * ★BUG修复 2026-09-04：AI 侧发现结算（m20 情报贩子 / m71 云游星商）
   * 根因：effects.js 两卡战吼仅返回 'discover'/'discover2' 信号串，由游戏层接管；
   *   玩家侧 game.js playFromHand → openDiscover → placeDiscovered 完整结算，
   *   而 ai.js runAIBattlecry 丢弃返回值 → AI 打出即白板，且 discoverOptions 已
   *   Pool.loan 借出的选项无人释放/占用 → 共享池泄漏。
   * 本实现只镜像玩家侧既有语义（以极客修复版 zip 的 game.js 为基准，game/pool/effect
   * 三文件零改动）：
   *   ① 选项生成 = aiDealerOptions：镜像 game.js discoverOptions(0, tavern) 方案A
   *      （本级/-1/-2 各1张、某档抽干顺延降档、每档至多1张、含 2026-09-04 上限
   *      修复 lv∈[1,MAX_TIER]），每张 Pool.loan 借出；
   *   ② 择优 = 按 minionPower(tok, board) 取最高（AI 无选卡 UI，等同玩家最优决策；
   *      平分时倾向高档位）；
   *   ③ 占池结算 = 镜像 openDiscover：选中者 Pool.consume 转永久占用，
   *      未选中者 Pool.unloan 归还；
   *   ④ 入手 = 镜像 placeDiscovered：优先入手牌；手牌满5（HAND_LIMIT）时卖最右侧
   *      手牌腾位——Pool.returnMinion 回池 + sellGain 同规回金（COST_SELL=1，
   *      h05 回收协议每回合最多2次同规，与 aiSellHand 表达式一致）；
   *   ⑤ 发现的随从按玩家 afterAcquire 同规立即结算其战吼/打出触发/英雄打出触发
   *      （链式发现：如选中另一张 m20，由共享池每张占用1份自然收敛，
   *      另设 depth≤12 兜底防 AI 同步链极端死循环）；
   *   ⑥ 每次落定后 aiMergeCheck(ai) 收口，与玩家 afterAcquire→mergeCheck 同规。
   * ======================================================================= */

  /** AI 版跨档三选一（镜像 game.js discoverOptions 方案A，borrow 走 Pool.loan） */
  function aiDealerOptions(maxTier) {
    var opts = [];
    var tryTiers = [maxTier, maxTier - 1, maxTier - 2, maxTier - 3];
    for (var t = 0; t < tryTiers.length && opts.length < 3; t++) {
      var lv = tryTiers[t];
      if (lv < 1 || lv > CFG.MAX_TIER) continue; // ★2026-09-04 上限修复同规（原玩家侧硬编码4）
      // 每档只取1张（同档已取过则跳过该档）
      var sameTierCount = 0;
      for (var k = 0; k < opts.length; k++) {
        if (CARD_BY_ID[opts[k].id].tier === lv) sameTierCount++;
      }
      if (sameTierCount >= 1) continue;
      var avail = CARDS.filter(function (c) {
        return c.tier === lv && Pool.available(c.id) > 0 && opts.every(function (o) { return o.id !== c.id; });
      });
      if (!avail.length) continue; // 该档无卡（抽干/全部已在选项中）→ 顺延降档
      var c = avail[Math.floor(Math.random() * avail.length)];
      Pool.loan(c.id);
      opts.push({ id: c.id, loaned: true });
    }
    return opts;
  }

  /**
   * AI 发现结算主流程：times=1（m20）/ times=2（m71 连续两次发现）
   * @param depth 链式发现深度（发现结果本身是 m20/m71 时递归，≤12 兜底）
   */
  function aiDiscoverSettle(ai, times, depth) {
    depth = depth || 0;
    for (var i = 0; i < times; i++) {
      var opts = aiDealerOptions(ai.tavern);
      if (!opts.length) return; // 池空：玩家侧 openDiscover 空选项直接跳过，同规

      // 择优：minionPower 最高者；平分倾向高档位
      var bestIdx = 0;
      var bestScore = -Infinity;
      for (var j = 0; j < opts.length; j++) {
        var sc = minionPower(makeMinion(opts[j].id, 1), ai.board);
        var tierBias = CARD_BY_ID[opts[j].id].tier - CARD_BY_ID[opts[bestIdx].id].tier;
        if (sc > bestScore || (sc === bestScore && tierBias > 0)) { bestScore = sc; bestIdx = j; }
      }

      // 占池结算：选中者 consume（永久占用），未选中 unloan（归还），杜绝 loan 泄漏
      var pickId = opts[bestIdx].id;
      opts.forEach(function (o) { if (o.id !== pickId) Pool.unloan(o.id); });
      Pool.consume(pickId);

      // 手牌满5：对齐玩家 placeDiscovered——卖最右侧手牌腾位（回池 + sellGain 同规回金）
      if (ai.hand.length >= CFG.HAND_LIMIT) {
        var last = ai.hand.length - 1;
        Pool.returnMinion(ai.hand[last].cardId, ai.hand[last].star);
        // 与 aiSellHand 同表达式：COST_SELL + h05 回收协议（每回合最多2次）
        ai.gold += CFG.COST_SELL + (ai.heroId === 'h05' && (ai._h05n || 0) < 2 ? ((ai._h05n = (ai._h05n || 0) + 1), 1) : 0);
        ai.hand.splice(last, 1);
      }

      var tok = makeMinion(pickId, 1);
      ai.hand.push(tok);

      // 发现的随从按玩家 afterAcquire 同规立即结算其战吼（可能链式发现）
      if (depth < 12) {
        var res2 = runAIBattlecry(ai, tok);
        if (res2 === 'discover' || res2 === 'discover2') {
          aiDiscoverSettle(ai, res2 === 'discover2' ? 2 : 1, depth + 1);
        }
      }
      Effects.onPlayTrigger(ai.board, tok, function () {});
      heroOnPlayAI(ai, tok);
      aiMergeCheck(ai);
    }
  }

  /** AI三合一检查（★修复2026-08-27：与玩家同规——仅「手牌+上阵阵容」两域，
   *  商店不参与合并。旧版把商店当第三域，导致AI把未购买的商店卡免费吞噬合成，
   *  出现"首回合0消费上场2随从"的经济违规。） */
  function aiMergeCheck(ai) {
    var groups = {};
    [['hand', ai.hand], ['board', ai.board]].forEach(function (pair) {
      pair[1].forEach(function (m, i) {
        var key = m.cardId + '@' + m.star;
        if (!groups[key]) groups[key] = [];
        groups[key].push({ domain: pair[0], idx: i });
      });
    });

    var keys = Object.keys(groups).filter(function (k) { return groups[k].length >= 3; });
    if (!keys.length) return false;
    var key = keys[0];
    var picks = groups[key].slice(0, 3);
    var kv = key.split('@');
    var cardId = kv[0];
    var newStar = Number(kv[1]) + 1;

    // 从后往前摘除素材，避免同域索引位移
    picks.sort(function (a, b) {
      if (a.domain !== b.domain) return 0;
      return b.idx - a.idx;
    });
    var sumAtk = 0, sumHp = 0;
    var kwAny = {};
    KW_LIST.forEach(function (k) { kwAny[k] = false; });
    picks.forEach(function (pk) {
      var arr = pk.domain === 'hand' ? ai.hand : ai.board;
      var mat = arr.splice(pk.idx, 1)[0];
      sumAtk += mat.buffAtk; sumHp += mat.buffHp;
      KW_LIST.forEach(function (k) {
        if (mat[k] || mat[kwGrantedKey(k)]) kwAny[k] = true;
      });
    });

    var merged = makeMinion(cardId, newStar);
    merged.buffAtk = Math.max(0, sumAtk);
    merged.buffHp = Math.max(0, sumHp);
    // ★修复2026-08-29 与玩家 mergeCheck 同规：后天增益关键词（含圣盾）随 AI 三连合并继承
    KW_LIST.forEach(function (k) {
      if (kwAny[k] && !merged[k]) {
        merged[k] = true;
        merged[kwGrantedKey(k)] = true;
      }
    });

    // 合成结果优先入手牌
    if (ai.hand.length < CFG.HAND_LIMIT) {
      ai.hand.push(merged);
    } else if (ai.board.length < CFG.BOARD_SLOTS) {
      ai.board.push(merged);
      var mRes = runAIBattlecry(ai, merged);
      // ★BUG修复 2026-09-04：上场合并卡的发现信号同样接管（m20/m71 三连上场路径）
      if (mRes === 'discover' || mRes === 'discover2') {
        aiDiscoverSettle(ai, mRes === 'discover2' ? 2 : 1, 0);
      }
      Effects.onPlayTrigger(ai.board, merged, function () {});
    } else {
      // 卖弱腾位
      var weakest = 0;
      for (var w = 1; w < ai.board.length; w++) {
        if (minionPower(ai.board[w], ai.board) < minionPower(ai.board[weakest], ai.board)) weakest = w;
      }
      Pool.returnMinion(ai.board[weakest].cardId, ai.board[weakest].star);
      ai.gold += CFG.COST_SELL;
      ai.board.splice(weakest, 1);
      ai.hand.push(merged);
    }

    // 三连奖励：真实合成的2星/3星随从 → 从高一级卡池发现（★consume占用共享池，杜绝loan泄漏）
    // ★V3 审计报告 BUG-1 修复：
    //   1) 去掉 ai.tavern < 4 限制 —— 玩家在4本三连仍可拿T4奖励，AI同规；
    //   2) Pool.drawExactTier(rewardTier) 精确锁档 —— 旧 Pool.draw(rewardTier) 是
    //      「≤rewardTier 加权抽取」，2万次抽样实测31.2%跑偏到低档（玩家侧规则为100%锁档）。
    // ★平衡调整2026-08-29（用户拍板）：3星合成（2星×3）同样享锁档三连奖励，与玩家 mergeCheck 同规。
    if (newStar >= 2) {
      var rewardTier = Math.min(ai.tavern + 1, CFG.MAX_TIER);
      var rewardId = Pool.drawExactTier(rewardTier);
      if (rewardId) {
        Pool.consume(rewardId);
        if (ai.hand.length < CFG.HAND_LIMIT) {
          ai.hand.push(makeMinion(rewardId, 1));
        } else if (ai.board.length < CFG.BOARD_SLOTS) {
          var rm = makeMinion(rewardId, 1);
          ai.board.push(rm);
          var rRes = runAIBattlecry(ai, rm);
          // ★BUG修复 2026-09-04：上场奖励卡的发现信号同样接管（m20/m71 三连奖励路径）
          if (rRes === 'discover' || rRes === 'discover2') {
            aiDiscoverSettle(ai, rRes === 'discover2' ? 2 : 1, 0);
          }
          Effects.onPlayTrigger(ai.board, rm, function () {});
        }
      }
      // ★V17 h09 藏品热忱 AI 同规：三连后随机发现一张≤酒馆等级的随从免费入手牌（满则+3金币）
      if (ai.heroId === 'h09') {
        if (ai.hand.length < CFG.HAND_LIMIT) {
          var candH09 = CARDS.filter(function (c) { return c.tier <= ai.tavern && Pool.available(c.id) > 0; });
          if (candH09.length) {
            var pickH09 = candH09[Math.floor(Math.random() * candH09.length)];
            Pool.consume(pickH09.id);
            ai.hand.push(makeMinion(pickH09.id, 1));
          }
        } else {
          ai.gold += 3;
        }
      }
    }

    // 链式检查
    aiMergeCheck(ai);
    return true;
  }

  /* =======================================================================
   * ★V4 P0：难度接线（方案 2.1）
   * ======================================================================= */

  /** 难度乘数 → 决策强度分档
   *  easy(0.8)=现版基线 / normal(1.0)=启发式 / hard(1.2)=模拟驱动 */
  function strengthOf(diffMult) {
    if (diffMult == null) return 0.6;           // 兼容缺省调用：按标准档
    if (diffMult <= 0.9) return 0.3;            // easy → legacy 基线
    if (diffMult <= 1.1) return 0.6;            // normal → P1 启发式
    return 1.0;                                  // hard → P2 模拟驱动
  }

  function aiStrategy(ai) {
    if (ai.configId === 'ai1') return 'rush';
    if (ai.configId === 'ai3') return 'triple';
    return 'balanced';
  }

  /* =======================================================================
   * ★V4 P1：卡牌评分器与影子计划（方案 2.2）
   * ======================================================================= */

  /** 统计某卡在两域的数量（三连嗅觉用） */
  function countCopies(cardId, arr) {
    var n = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i].cardId === cardId) n++;
    return n;
  }

  /** 统计持有者本族随从数（光环协同用） */
  function tribeCount(holder, tribe) {
    var n = 0;
    var t = tribe || holder.tribe;
    holder.board.forEach(function (m) { if (m.tribe === t) n++; });
    return n;
  }

  /** ★V2.9 两域（board+hand）中带某 effectKind 的随从数（新引擎体系协同评估用） */
  function countTribeKw(holder, kind) {
    var n = 0;
    holder.board.concat(holder.hand || []).forEach(function (m) {
      var d = CARD_BY_ID[m.cardId];
      if (d && d.effectKind === kind) n++;
    });
    return n;
  }

  /** 卡牌静态评分（不生成随从对象，纯 def 数据 + 两域上下文） */
  function evalCardScore(cardId, holder, turn) {
    var def = CARD_BY_ID[cardId];
    if (!def) return -1;
    var p = def.atk + def.hp;
    var kws = def.kw || [];
    if (kws.indexOf('shield') >= 0) p += 2.5;
    if (kws.indexOf('venomous') >= 0) p += 4;
    if (kws.indexOf('taunt') >= 0) p += 1.5;
    if (kws.indexOf('windfury') >= 0) p += def.atk;
    if (kws.indexOf('reborn') >= 0) p += def.hp / 2;
    if (kws.indexOf('cleave') >= 0) p += 2;
    if (def.effectKind === 'deathrattle') p += 2;
    if (def.effectKind === 'aura') p += 3;
    if (def.effectKind === 'startofcombat') p += 3;
    if (def.effectKind === 'trigger') p *= 1.2;   // 成长引擎溢价
    if (def.effectKind === 'battlecry') p += 1;
    // ★V2.9 新卡机制估值（m60-m74；★萨必调整2026-09-05：六星精简，m73/m75~m81 条目随卡移除）：
    // 亡语触发/盾破复生/吞并成长等
    var NEWV = {
      m60: 2,   // 相邻攻光环（按2邻居近似）
      m61: 2,   // onSummon 成长（trigger 已×1.2）
      m62: 6,   // 吞并成长：吃友方齿轮攻血
      m63: 5,   // 齿轮群体光环
      m64: 5,   // 亡语全员圣盾
      m65: 3,   // 触发一个亡语
      m66: 4,   // 复生+亡语召唤
      m67: 3,   // 风怒+亡语点攻
      m68: 5,   // 潮汐群体战吼buff
      m69: 4,   // 至多2目标剧毒
      m70: 1,   // 大body cleave（kw已+2）
      m71: 3,   // 连续两次发现
      m72: 2,   // 英雄回血（战力外）
      m74: 5    // 盾破复生引擎（六星仅存 m74/m56）
    };
    if (NEWV[cardId]) p += NEWV[cardId];
    // 族系匹配（★V2.9 保留 neutral 轻增溢 ×1.05，勿并入同族倍率）
    var offTribe = def.tribe !== holder.tribe && def.tribe !== 'neutral';
    if (def.tribe === holder.tribe) p *= 1.35;
    else if (def.tribe === 'neutral') p *= 1.05;
    else p *= 0.55;                                // 异族强抑制
    // ★V2.9 后期引擎跨族适配：5本起放宽异族抑制（0.55→0.85）——6本时代
    // 制胜引擎跨四族分布，AI 必须能采纳异族 T5/T6 核心，否则终局铺场烂尾
    if (offTribe && holder.tavern >= 5 && def.tier >= 5) p *= (0.85 / 0.55);
    // 三连嗅觉：已有2张同名 → 必买；1张 → 囤对子
    var copies = countCopies(cardId, holder.hand) + countCopies(cardId, holder.board);
    if (copies >= 2) p += 60;
    else if (copies === 1) p *= 1.6;
    // ★V2.9 体系协同：新引擎与在场体系联动增值（★萨必调整2026-09-05：m73/m75/m76/m77/m78/m79 条目随卡移除）
    if ((cardId === 'm69' || cardId === 'm68') && tribeCount(holder, 'tide') >= 2) p += 4;
    if ((cardId === 'm64' || cardId === 'm74' || cardId === 'm63' || cardId === 'm62') && tribeCount(holder, 'gear') >= 2) p += 4;
    // 光环/群buff 协同：本族随从成型时增值
    if ((def.effectKind === 'aura' || def.cardId === 'm27' || def.cardId === 'm24') &&
        tribeCount(holder, def.tribe) >= 3) p += 5;
    // 档位适配
    if (def.tier === holder.tavern) p *= 1.12;
    else if (def.tier < holder.tavern - 1 && turn >= 6) p *= 0.7;  // 后期低档卡降权
    if (turn <= 2) p += def.tier * 1.2;            // 早期档位潜力
    return p;
  }

  /** 购买门槛分（turn≤3 全买铺场对齐 legacy；此后随回合抬升，并与酒馆档位联动，
   *  防止低本期 T1/T2 卡全部低于门槛 → "无可买→摆烂"的恶性循环） */
  function minBuyScore(turn, holder, opts) {
    if (turn <= 3) return 0;
    var byTurn = 7 + turn * 0.8;
    var tav = holder && holder.tavern ? holder.tavern : 4;
    var byTavern = 4 + tav * 2.5;                 // 1本=6.5 / 2本=9 / 3本=11.5 / 4本=14
    var base = Math.min(byTurn, byTavern);
    if (opts && opts.cheapBuy) base -= 3;
    if (opts && opts.noUpgrade) base -= 1.5;
    /* ★V2.9 六本封顶：5/6本店卡面评分≈15~19，旧门槛 5本=16.5/6本=19 会把
     * T5/T6 制胜引擎整体挡在购买线之下（E11 首测成型率 24% 的主因之一）。
     * 门槛封顶 15：高本仍保持筛选（垃圾卡分不过线），但引擎卡能过线。 */
    if (base > 15) base = 15;
    return base;
  }

  /** 影子视图：浅拷贝两域与商店（不碰 Pool、不跑战吼/三合一，纯推演） */
  function makeShadowView(ai) {
    return {
      gold: ai.gold, tavern: ai.tavern, tierSince: ai.tierSince,
      hand: ai.hand.slice(), board: ai.board.slice(),
      shop: ai.shop.slice(), tribe: ai.tribe, hp: ai.hp,
      configId: ai.configId, mult: ai.mult
    };
  }

  function shadowUpgradeCost(view, turn) {
    if (view.tavern >= CFG.MAX_TIER) return 999;
    return Math.max(CFG.UPGRADE_MIN, CFG.UPGRADE_BASE[view.tavern - 1] - (turn - view.tierSince));
  }

  /** 商店中评分最高的可负担卡 */
  function bestShopPick(holder, turn, minBuy) {
    var best = null;
    for (var i = 0; i < holder.shop.length; i++) {
      var c = holder.shop[i];
      if (!c) continue;
      var sc = evalCardScore(c.id, holder, turn);
      var copies = countCopies(c.id, holder.hand) + countCopies(c.id, holder.board);
      var must = copies >= 2 && holder.gold >= CFG.COST_BUY;    // 三连组件必买
      if (sc < minBuy && !must) continue;
      if (holder.gold < CFG.COST_BUY) continue;
      if (!best || sc > best.score) best = { cardId: c.id, score: sc };
    }
    return best;
  }

  /** 手牌中最该卖掉的卡索引（minionPower 最低 + 嘲讽保护；★修复"卖嘲讽"bug） */
  function worstHandIdx(holder, rivalScore, opts) {
    if (!holder.hand.length) return -1;
    var wi = -1, ws = Infinity;
    for (var i = 0; i < holder.hand.length; i++) {
      var m = holder.hand[i];
      var sc = minionPower(m, holder.board);
      // ★V6.1 修复：原 sc -= 6 符号写反——注释声称"嘲讽保护"实则让手牌嘲讽被优先卖掉；
      //   与 worstBoardIdx（sc += 4 保护）对齐为正保护。
      if (m.taunt) sc += 6;                       // 嘲讽强保护，杜绝周期性卖嘲讽
      // ★V6.1 补充（E8b 根因加固）：三连素材强保护（可达三连绝不拆卖）、对子弱保护
      var copies = countCopies(m.cardId, holder.hand) + countCopies(m.cardId, holder.board);
      if (copies >= 3) sc += 60;
      else if (copies === 2) sc += 18;
      if (sc < ws) { ws = sc; wi = i; }
    }
    if (ws >= rivalScore) return -1;              // 没有比新卡差的就不卖
    if (opts && opts.aggressiveSell) { /* 激进换血：阈值已由 rivalScore 体现 */ }
    return wi;
  }

  /** ★V4.1 场上最该卖掉的卡索引（场满腾位回收用）：
   *  minionPower 最低者优先；保护嘲讽/三连组件/升星核心，杜绝"卖嘲讽"复燃 */
  function worstBoardIdx(holder) {
    var wi = -1, ws = Infinity;
    for (var i = 0; i < holder.board.length; i++) {
      var m = holder.board[i];
      var sc = minionPower(m, holder.board);
      if (m.taunt) sc += 4;                                                          // 嘲讽保护
      if (countCopies(m.cardId, holder.board) + countCopies(m.cardId, holder.hand) >= 2) sc += 60;  // 三连组件保护
      if (m.star >= 2) sc += 40;                                                     // 升星核心保护
      if (sc < ws) { ws = sc; wi = i; }
    }
    return wi;
  }

  /** 手牌中上场价值最高的卡索引 */
  function bestPlayIdx(holder) {
    var bi = -1, bs = -Infinity;
    for (var i = 0; i < holder.hand.length; i++) {
      var sc = minionPower(holder.hand[i], holder.board);
      if (sc > bs) { bs = sc; bi = i; }
    }
    return bi;
  }

  /** P1 启发式计划生成（影子推演，产出意图序列，无任何副作用） */
  function planHeuristic(view, ai, turn, opts) {
    opts = opts || {};
    var plan = [];
    var strategy = aiStrategy(ai);
    var hpRatio = (ai.hp || CFG.BASE_HP) / CFG.BASE_HP;
    // ★V4.2 血线门控按方案 P1.5 三段实现（★V2.9.4 注释由 30 血绝对值改比例描述，随 BASE_HP 自适配）：hpRatio≥2/3 沿用贪本曲线 / 0.5~0.67 均衡（升本保留≥3金）/
    //   hpRatio<0.5 买牌优先（残血保命不升本）。旧版 ≤0.3 一刀切 + 满血抢节奏+1 与方案不符：
    //   贪本段被 ≥3金 门压制后，升本曲线整体落后基线档 1~2 回合（基准 B2 实测 37.5% 根因之二）。
    //   另据实测：R8 起若仍执行"残血封顶/保留≥3金"，T4（9金/收入10）将永远点不出来，
    //   而基线档无此顾虑会先拿 T4 卡池 → 后期战力反超。故 R8+ 统一切换为升本冲刺。
    var lowHp = hpRatio < 0.5 && turn >= 4 && turn < 8;      // hpRatio<0.5：买牌优先（R8 前保血线）
    var greedy = hpRatio >= 2 / 3 || turn >= 8;              // hpRatio≥2/3 贪本；R8+ 升本冲刺
    var targetT = targetTavern(turn, strategy);
    if (lowHp) targetT = Math.min(targetT, view.tavern);      // 残血不升本
    if (opts.noUpgrade) targetT = Math.min(targetT, view.tavern);
    var minBuy = minBuyScore(turn, view, opts) + (lowHp ? -2 : 0);   // ★V4.1修复：原误传 opts 到 holder 位致 cheapBuy/档位感知失效；残血放宽买战力

    var guard = 48;
    while (view.gold > 0 && guard-- > 0) {
      // 1) 升本（评分门：杜绝"升完0金零成长"，对齐方案 1.4 批评点）
      if (view.tavern < targetT) {
        var cost = shadowUpgradeCost(view, turn);
        if (view.gold >= cost) {
          var leftover = view.gold - cost;
          var shopHasGood = !!bestShopPick(view, turn, minBuy);
          // ★V4.2 升本门后期放行（修复 normal 档中盘失速）：
          //   R8 起收入恒为 10 金，T3→T4 基础 8 金（★V2.9.3 趴本递减后更低），按"保留≥3金"门
          //   leftover=1 永远不过，且 T4 自家店几乎必有 minBuy 之上的卡（shopHasGood 恒真）
          //   → AI 永远卡在 3 本、战力进入平台期（基准 B2 实测 normal 37.5% 落后 easy 的根因）。
          //   后期仅当商店存在「远超门槛的核心卡」时才推迟升本，其余放行；
          //   残血(lowHp)与 noUpgrade 的封顶逻辑不受影响，经济常量零改动（决策层内修正）。
          var exceptional = false;
          if (turn >= 7) {
            for (var ei = 0; ei < view.shop.length; ei++) {
              var ec = view.shop[ei];
              if (!ec) continue;
              // ★V4.2：仅"远超门槛的核心卡"值得推迟升本；普通同名对子不构成例外
              //   （7随从+8手牌下对子极常见，会把 R7+ 放行门重新堵死）
              if (evalCardScore(ec.id, view, turn) >= minBuy + 8) { exceptional = true; break; }
            }
          }
          // 贪本段（hp≥20，方案P1.5）：金币够即升，对齐基线曲线节奏；
          // 均衡段（15~19）：执行"保留≥3金"门（后期放行见上）；残血段已被 targetT 封顶。
          if (opts.upgradeFirst || turn <= 2 || greedy ||
              leftover >= CFG.COST_BUY || !shopHasGood || (turn >= 7 && !exceptional)) {
            plan.push({ act: 'upgrade' });
            view.gold -= cost;
            view.tavern++;
            view.tierSince = turn; // ★V2.9.3 影子锚点重置：连升第二跳按基础价推演
            continue;   // 注意：影子视图不重抽商店（真实执行时 aiRefreshShop）
          }
        }
      }
      // 2) 买最优卡
      var pick = bestShopPick(view, turn, minBuy);
      if (pick) {
        if (view.hand.length >= CFG.HAND_LIMIT) {
          var si = worstHandIdx(view, pick.score, opts);
          if (si >= 0) {
            plan.push({ act: 'sellHand', idx: si });
            view.hand.splice(si, 1);
            view.gold += CFG.COST_SELL;
          } else break;
        }
        plan.push({ act: 'buy', cardId: pick.cardId });
        view.gold -= CFG.COST_BUY;
        view.hand.push(makeMinion(pick.cardId, 1));
        continue;
      }
      break;
    }

    // 3b) ★V2.9 终局换血：高本期用「场上最弱位」换「手里高价值卡」。
    //     旧版换血只在 spendLoop 且要求手牌为空——满场满手时永不触发，
    //     T6 期仍端着 T4 期阵容（用户「AI 后期太菜」主因）。worstBoardIdx 已自带
    //     嘲讽/三连组件/升星核心保护。
    if (view.tavern >= 5 && view.board.length >= CFG.BOARD_SLOTS) {
      var swaps = 4;
      while (view.hand.length && swaps-- > 0) {
        var sbi = bestPlayIdx(view);
        if (sbi < 0) break;
        var wbi = worstBoardIdx(view);
        if (wbi < 0) break;
        var inP = minionPower(view.hand[sbi], view.board);
        var outP = minionPower(view.board[wbi], view.board);
        if (inP > outP + 3) {
          plan.push({ act: 'sellBoard', idx: wbi });
          plan.push({ act: 'play', cardId: view.hand[sbi].cardId, star: view.hand[sbi].star });
          view.gold += CFG.COST_SELL;
          var playedIn = view.hand.splice(sbi, 1)[0];
          view.board.splice(wbi, 1)[0];
          view.board.push(playedIn);
        } else break;
      }
    }
    return plan;
  }

  /** 计划执行：在真实状态重放意图（真正的 Pool 占用在此发生）；turn=当前回合（tierSince 锚点重置用） */
  function executePlan(ai, plan, turn) {
    for (var i = 0; i < plan.length; i++) {
      var a = plan[i];
      if (a.act === 'upgrade') {
        var cost = aiUpgradeCost(ai, turn);
        if (ai.tavern < CFG.MAX_TIER && ai.gold >= cost) {
          ai.gold -= cost;
          ai.tavern++;
          ai.tierSince = turn; // ★V2.9.3 递减锚点重置（与玩家 upgradeTavern 同规）
          // ★P1修正：升本后不免费重抽（保留旧店，与玩家 upgradeTavern 同规）
        }
      } else if (a.act === 'buy') {
        var idx = -1;
        for (var k = 0; k < ai.shop.length; k++) {
          if (ai.shop[k] && ai.shop[k].id === a.cardId) { idx = k; break; }
        }
        if (idx < 0) continue;                       // 失配 → 交给兜底循环
        if (ai.hand.length >= CFG.HAND_LIMIT) break; // 防御：卖牌意图失配时不强买
        aiBuy(ai, idx);
      } else if (a.act === 'sellHand') {
        if (ai.hand.length > a.idx) aiSellHand(ai, a.idx);
      } else if (a.act === 'sellBoard') {
        if (ai.board.length > a.idx) aiSellBoard(ai, a.idx); // ★V2.9 终局换血
      } else if (a.act === 'play') {
        var pi = -1;
        for (var j = 0; j < ai.hand.length; j++) {
          if (ai.hand[j].cardId === a.cardId && ai.hand[j].star === a.star) { pi = j; break; }
        }
        if (pi >= 0 && ai.board.length < CFG.BOARD_SLOTS) aiPlayFromHand(ai, pi);
      }
    }
  }

  /** 兜底清零循环（对齐玩家"必须花完"）：评分制买 → 刷新 → 直到无意义 */
  function spendLoop(ai, turn, s) {
    var minBuy = minBuyScore(turn, ai, null) + (s >= 0.8 ? -1 : 0);
    var guard = 24;
    while (ai.gold > 0 && guard-- > 0) {
      aiMergeCheck(ai);
      // 上场空位优先打手牌
      if (ai.hand.length > 0 && ai.board.length < CFG.BOARD_SLOTS) {
        aiPlayFromHand(ai, bestPlayIdx(ai));
        continue;
      }
      // ★V4.1 场满腾位回收（P1/P2 独有；easy 基线不含）：
      // 场满+手空+有余钱时，卖场上最弱（护嘲讽/三连组件/升星核心）换商店明显更强的卡
      // ★V4.2 修复：旧版 soldP<9 绝对上限使该分支在 T2/T3 体量下永不触发（场满本就发生在
      //   6回合后），等于死代码 → 战力平台期被基线反超。改为方案 P1.3 的相对阈值：
      //   仅要求「新卡评分 > 场上最弱 + 2」，高价随从由 worstBoardIdx 的嘲讽/三连/升星保护兜底。
      if (ai.hand.length === 0 && ai.board.length >= CFG.BOARD_SLOTS && ai.gold >= CFG.COST_BUY) {
        var rp = bestShopPick(ai, turn, minBuy);
        if (rp) {
          var wb = worstBoardIdx(ai);
          if (wb >= 0) {
            var soldP = minionPower(ai.board[wb], ai.board);
            if (rp.score > soldP + 2) { aiSellBoard(ai, wb); continue; }
          }
        }
      }
      // 评分制买卡（门槛过不了时散钱兜底买最高分——清零制下钱不花即浪费）
      var pick = bestShopPick(ai, turn, minBuy);
      if (!pick && ai.gold >= CFG.COST_BUY && ai.shop.length > 0) {
        pick = bestShopPick(ai, turn, 0);
      }
      if (pick) {
        if (ai.hand.length >= CFG.HAND_LIMIT) {
          var wi = worstHandIdx(ai, pick.score, null);
          if (wi >= 0) { aiSellHand(ai, wi); continue; }
        }
        var idx = -1;
        for (var k = 0; k < ai.shop.length; k++) {
          if (ai.shop[k] && ai.shop[k].id === pick.cardId) { idx = k; break; }
        }
        if (idx >= 0 && aiBuy(ai, idx)) continue;
      }
      // 刷新到花光（★V17 h02 第一次免费）
      if (ai.shop.length > 0 && aiPayRefresh(ai)) {
        aiRefreshShop(ai);
        continue;
      }
      break;
    }
  }

  /** P1 冻结决策：商店留有"买不起的高分卡/三连组件"时冻结（最多连冻2回合） */
  function maybeFreeze(ai, turn, s) {
    ai.frozen = false;
    if (s <= 0.35) return;
    if (turn < 4) return;
    if ((ai._frozenStreak || 0) >= 2) return;
    if (ai.gold >= CFG.COST_BUY) return;
    // ★V4.2 冻结与升本曲线解耦：酒馆仍在升本曲线下方且血量健康时不冻结——
    //   P1 升本后不重抽，若本回合冻结、下回合升本，则旧档商店会一直压到下下回合，
    //   吞掉新档首抽（实测为 normal 档中盘失速的次因）。残血封顶(lowHp)时不受此限。
    var lowHp = (ai.hp || CFG.BASE_HP) / CFG.BASE_HP <= 0.3 && turn >= 4;
    if (!lowHp && ai.tavern < targetTavern(turn, aiStrategy(ai))) return;
    var minBuy = minBuyScore(turn, ai, null);
    for (var i = 0; i < ai.shop.length; i++) {
      var c = ai.shop[i];
      if (!c) continue;
      var copies = countCopies(c.id, ai.hand) + countCopies(c.id, ai.board);
      if (copies >= 2 || evalCardScore(c.id, ai, turn) >= minBuy + 4) {
        ai.frozen = true;
        return;
      }
    }
  }

  /* =======================================================================
   * ★V4 P2：模拟驱动（方案 2.3）—— ★V6 实验后维持关闭（2026-08-29，见下方开关注记）
   * ======================================================================= */

  /** ★V5 范围开关：P2 模拟驱动保持关闭（★V6 实验结论 2026-08-29）：
   *  管理员指令「启用 P2 并复验 hard vs normal ≥65%」→ 实测开启态：
   *  B1 = 48.0%（n=400；连同 ★V5 三次复测 49.8/50.2/53.8%，四次独立实测均值≈50.7%），
   *  显著低于 65% 验收线；性能合规（81.5ms/回合 ≤800ms，超时降级生效）但为精英档 13 倍耗时。
   *  结论：当前 P2 与 P1 精英档强度相当（~51% vs ~52%），模拟收益未转化为对 normal 的胜率优势，
   *  按「不达标即回退」指令回退关闭。启用前提=P2 重设计（对手建模强化/全局 lookahead）后复测达标。 */
  var ENABLE_P2 = false;

  var SIM_BUDGET_MS = 120;   // 单回合单AI模拟预算（5 AI 合计 ≤ 800ms 验收线内）
  var SIM_ROUNDS = 40;       // 每个候选的蒙特卡洛采样数（战力比值快评）
  var SIM_ROUNDS_DEEP = 8;   // ★V4.1 真·Battle.simulate 精评采样数 / 每对手样本（两段式第二段）
  var SIM_ROUNDS_TPL = 6;    // ★V4.1 站位模板对拍采样数 / 每对手样本

  /** 预判对手战力兜底曲线（无真实对手情报时使用；按 normal 档实测成长曲线×75分位保守系数拟合） */
  var EXPECTED_POWER = [0, 7, 14, 21, 30, 42, 58, 76, 96, 118, 142, 168, 196, 226, 258, 292, 328];
  function expectedPower(turn) {
    return EXPECTED_POWER[Math.min(turn, EXPECTED_POWER.length - 1)];
  }

  /** 期望酒馆等级（对齐 balanced 曲线，伤害期望用） */
  function expectedTavern(turn) {
    if (turn <= 1) return 1;
    if (turn <= 4) return 2;
    if (turn <= 7) return 3;
    return 4;
  }

  /** 预判对手战力：其他存活实体的 boardPower 75 分位（保守估计） */
  function estimateOppPower(ai, turn, ctx) {
    var powers = [];
    if (ctx && ctx.entities) {
      for (var i = 0; i < ctx.entities.length; i++) {
        var e = ctx.entities[i];
        if (!e || e === ai || e.ghost) continue;
        if (e.board && e.board.length) powers.push(boardPower(e.board));
      }
    }
    if (!powers.length) return expectedPower(turn);
    powers.sort(function (x, y) { return x - y; });
    return powers[Math.min(powers.length - 1, Math.floor(powers.length * 0.75))];
  }

  /** ★V4.1 取对手真实阵容样本（按战力降序取前K个，供 P2 真·Battle.simulate 精评；
   *  与 estimateOppPower 同口径：跳过自身与鬼魂；无可用阵容返回空表 → 走战力先验路径） */
  function oppBoardsOf(ai, ctx, maxK) {
    var list = [];
    if (ctx && ctx.entities) {
      for (var i = 0; i < ctx.entities.length; i++) {
        var e = ctx.entities[i];
        if (!e || e === ai || e.ghost) continue;
        if (e.board && e.board.length) list.push(e.board);
      }
    }
    var k = maxK || 2;
    if (list.length <= k) return list;
    list.sort(function (a, b) { return boardPower(b) - boardPower(a); });
    return list.slice(0, k);
  }

  function survCountEst(pa, pb) {
    return Math.max(1, Math.min(CFG.BOARD_SLOTS, Math.ceil(7 * Math.max(pa, pb) / (pa + pb))));
  }

  /**
   * 候选计划评估（★修复2026-08-29：成长主导制）。
   * 旧版"期望伤害差"主导存在系统性缺陷：逆风时（oppP 高估/我方暂弱）评估鼓励
   * "摆烂少投入"，且把"花钱升本"（不涨当回合战力）判为负贡献 → hard 档卡死
   * 低本、战力停摆。现改为：战力成长主导 + 升本未来选项价值 + 胜负与血量次级修正。
   * ★V4.1 两段式：oppBoards 缺省走战力比值快评（第一段，全变体）；
   *   传入对手真实阵容样本时启用真·Battle.simulate 精评（第二段，Top-2 变体），
   *   与战力先验 65/35 混合以抑制小样本噪声（方案 2.3 原始设计的落地）。
   */
  function evaluatePlan(view, turn, oppP, aiTavern, oppBoards, simRounds) {
    var SR = simRounds || SIM_ROUNDS;   // ★V5：精英档传 80 降选优噪声（P2 缺省 40 不变）
    var board = view.board.slice();
    arrange(board);
    var myP = boardPower(board);
    var winP, i;
    if (oppBoards && oppBoards.length) {
      // 真·模拟精评：候选阵容 vs 对手真实阵容样本（Battle.simulate 内部克隆，无写穿）
      var simWin = 0, tot = 0;
      for (var k = 0; k < oppBoards.length; k++) {
        for (i = 0; i < SIM_ROUNDS_DEEP; i++) {
          var r = Battle.simulate(board, oppBoards[k], {});
          if (r.winner === 'a') simWin++;
          else if (r.winner == null) simWin += 0.5;
          tot++;
        }
      }
      var prior = 0;
      for (i = 0; i < SR; i++) {
        var a = myP * (0.85 + Math.random() * 0.3);
        var b = oppP * (0.85 + Math.random() * 0.3);
        if (a > b) prior++;
      }
      winP = (simWin / tot) * 0.65 + (prior / SR) * 0.35;
    } else {
      var win = 0;
      for (i = 0; i < SR; i++) {
        var a2 = myP * (0.85 + Math.random() * 0.3);
        var b2 = oppP * (0.85 + Math.random() * 0.3);
        if (a2 > b2) win++;
      }
      winP = win / SR;
    }
    var avgTier = Math.min(4, 1 + turn / 3);
    var dmgTaken = (1 - winP) * (Math.max(1, view.tavern) + survCountEst(oppP, myP) * avgTier);
    var growth = 0.06 * myP;                                       // 战力≈未来收益（主导项）
    if (view.tavern > aiTavern) growth += 8 + view.tavern * 2;     // 升本的抽卡档位未来价值
    return growth + winP * 2 - dmgTaken * 0.12;                    // 本回合胜负/血量为次级修正
  }

  /** 候选计划变体（个体系数 mult ≥1.05 的"聪明AI"再多两组组合变体；★V4.1 扩充组合维度） */
  function simVariants(ai) {
    var list = [
      {},
      { upgradeFirst: true },
      { noUpgrade: true },
      { aggressiveSell: true },
      { cheapBuy: true },
      { upgradeFirst: true, cheapBuy: true },
      { noUpgrade: true, aggressiveSell: true }
    ];
    if ((ai.mult || 1) >= 1.05) {
      list.push({ noUpgrade: true, cheapBuy: true });
      list.push({ upgradeFirst: true, aggressiveSell: true, cheapBuy: true });
    }
    return list;
  }

  /** P2 主入口（★V4.1 两段式）：第一段战力快评全体变体 → 第二段 Top-2 真·模拟精评
   *  → 最优阵容站位模板对拍；任一阶段超时均降级为已算最优（验收 ≤800ms 兜底） */
  function planSimTurn(ai, turn, ctx) {
    var t0 = Date.now();
    var oppP = estimateOppPower(ai, turn, ctx);
    var oppBoards = oppBoardsOf(ai, ctx, 2);
    var variants = simVariants(ai);
    // —— 第一段：战力比值快评全体变体（成长主导，近乎零成本） ——
    var ranked = [];
    for (var i = 0; i < variants.length; i++) {
      if (i > 0 && Date.now() - t0 > SIM_BUDGET_MS) break;   // 超时降级：用已算最优
      var view = makeShadowView(ai);
      var plan = planHeuristic(view, ai, turn, variants[i]);
      ranked.push({ view: view, plan: plan, sc: evaluatePlan(view, turn, oppP, ai.tavern, null) });
    }
    if (!ranked.length) {                                     // 兜底：理论上不可能
      var v0 = makeShadowView(ai);
      return planHeuristic(v0, ai, turn, {});
    }
    ranked.sort(function (a, b) { return b.sc - a.sc; });
    // —— 第二段：Top-2 变体用真·Battle.simulate 对对手真实阵容精评（方案2.3） ——
    var deepN = oppBoards.length ? Math.min(2, ranked.length) : 0;
    for (var d = 0; d < deepN; d++) {
      if (d > 0 && Date.now() - t0 > SIM_BUDGET_MS) break;    // 超时降级：保留快评排序
      ranked[d].sc = evaluatePlan(ranked[d].view, turn, oppP, ai.tavern, oppBoards);
    }
    var best = ranked[0];
    // —— 站位模板终选（hard 独占）：现行模板 vs 剧毒先手模板，真模拟对拍 ——
    if (best && oppBoards.length && Date.now() - t0 <= SIM_BUDGET_MS) {
      var boardA = best.view.board.slice();
      var boardB = best.view.board.slice();
      arrange(boardA);
      arrangeVenomFirst(boardB);
      var same = boardA.length === boardB.length;
      if (same) {
        for (var q = 0; q < boardA.length; q++) { if (boardA[q] !== boardB[q]) { same = false; break; } }
      }
      if (!same) {
        var wA = 0, wB = 0, tot2 = 0;
        for (var k = 0; k < oppBoards.length; k++) {
          for (var s = 0; s < SIM_ROUNDS_TPL; s++) {
            var rA = Battle.simulate(boardA, oppBoards[k], {});
            var rB = Battle.simulate(boardB, oppBoards[k], {});
            if (rA.winner === 'a') wA++; else if (rA.winner == null) wA += 0.5;
            if (rB.winner === 'a') wB++; else if (rB.winner == null) wB += 0.5;
            tot2 += 2;
          }
        }
        if (tot2 > 0) best.plan._venomFirst = wB > wA;   // 剧毒先手模板胜场更多才启用
      }
    }
    return best.plan;
  }

  /** ★V5 P1 精英档（hard 档在 ENABLE_P2=false 时的入口；本轮范围 P0+P1）：
   *  启发式多变体择优——复用 P1 管线生成全部变体计划（simVariants，mult≥1.05 追加组合变体），
   *  用 evaluatePlan 第一段（战力比值快评：成长主导+胜负/血量次级修正）选最优。
   *  与 P2 的边界清晰：本函数纯数学评分，绝不调用 Battle.simulate；
   *  真模拟精评与站位模板对拍仅存在于 planSimTurn（ENABLE_P2=true 时）。 */
  function planEliteTurn(ai, turn, ctx) {
    var oppP = estimateOppPower(ai, turn, ctx);
    var variants = simVariants(ai);
    var best = null, bestSc = -Infinity;
    for (var i = 0; i < variants.length; i++) {
      var view = makeShadowView(ai);
      var plan = planHeuristic(view, ai, turn, variants[i]);
      // ★V5：精英档采样加倍（80）降选优噪声——纯数学比值，仍不调用 Battle.simulate
      var sc = evaluatePlan(view, turn, oppP, ai.tavern, null, 80);
      if (sc > bestSc) { bestSc = sc; best = plan; }
    }
    if (!best) return planHeuristic(makeShadowView(ai), ai, turn, {});   // 理论兜底
    return best;
  }

  /* =======================================================================
   * 主路由（P0 分档）
   * ======================================================================= */

  /**
   * ★V2 AI每回合运营主循环 → ★V5 按难度分档路由（难度×个体系数）
   * @param ai AI实体（有gold/hand/board/shop/tavern/tierSince）
   * @param turn 当前回合
   * @param diffMult 难度乘数（0.8/1.0/1.2，映射三档决策强度）
   * @param ctx 可选上下文 { entities }（对手战力预判用，兼容缺省）
   */
  function aiTurn(ai, turn, diffMult, ctx) {
    // ★V3 每回合重置属性提升事件预算与 m51 涌泉祭司计数（防死循环上限，数值框架7.3）
    Effects.resetGains();
    ai.board.concat(ai.hand).forEach(function (m) { m._m51n = 0; m._m43n = 0; }); // ★V2.1 m43 回盾计数同点清零
    // ★V17 每回合重置英雄技能计数（与玩家 startRound 同规：h04机簧/h05回收/h08引浪/h02免费刷新）
    ai._h04used = false; ai._h05n = 0; ai._h08n = 0; ai._h02free = false;

    // 赚金币（回合清零、无利息存款，与玩家同规）
    var curIncome = turn >= CFG.GOLD_CURVE.length - 1 ? CFG.GOLD_CURVE[CFG.GOLD_CURVE.length - 1] : CFG.GOLD_CURVE[turn];
    ai.gold = curIncome;
    ai._turnIncome = curIncome;

    // ★V5 P0：决策强度 = 难度档位 × 个体系数（AI_CONFIGS mult 1.1/1.0/1.0/0.95/1.05）。
    //   档位边界生效：easy 0.285~0.33(全legacy) / normal 0.57~0.66(全P1基础) / hard 0.95~1.1(全精英)；
    //   legacy 判定用未缩放档位值 sBase，防止"easy×高mult"误入启发式档。
    var sBase = strengthOf(diffMult);
    var s = sBase * (ai.mult || 1);

    // P1 冻结生效：沿用上回合末冻结的商店（跳过重抽，与玩家冻结语义对齐）
    var keepShop = sBase > 0.35 && ai.frozen && ai.shop && ai.shop.length > 0 && (ai._frozenStreak || 0) < 2;
    if (keepShop) {
      ai.frozen = false;
      ai._frozenStreak = (ai._frozenStreak || 0) + 1;
    } else {
      ai.shop = aiDrawShop(ai);
      ai._frozenStreak = 0;
    }

    if (sBase <= 0.35) {
      aiTurnLegacy(ai, turn);   // easy：现版基线（curIncome 已随折扣门删除）
      return;
    }

    // ★V2.9.3「卖弱补差价」（炉石对齐后保留）：T5 基础 11 / T6 基础 12 仍 > 收入上限 10，
    //   且本作金币清零制（回合金不结转）→ 刚踩到目标曲线的回合可能差 1~2 金；
    //   递减机制会让趴本自然降价，但 rush 曲线要求准时升本——
    //   欠费且只差 ≤1金 时卖场上最弱随从补差（三连组件/升星核心由 worstBoardIdx 软保护），
    //   保底 2 场面在场不自残；决策层内修正，经济常量与玩家规则零改动。
    if (ai.tavern < targetTavern(turn, aiStrategy(ai)) && turn >= 7 && ai.board.length >= 2) {
      var uCost = aiUpgradeCost(ai, turn);
      if (ai.gold < uCost && ai.gold + CFG.COST_SELL >= uCost) {
        aiSellBoard(ai, worstBoardIdx(ai));
      }
    }

    // ★V6.1 修复（E8b 基准暴露，复现率 57/3000≈1.9%）：P1/精英/P2 路径在计划生成前
    //   补一次真实三连预合并。根因：影子推演不建模合并，aggressiveSell 变体会把"最弱"
    //   的三连素材卖掉（worstHandIdx 原无组件保护），开局手握三连却被拆卖、T4 奖励整组丢失。
    //   合并恒为正收益（升星+奖励卡），对齐 legacy 每轮先合并的语义；
    //   计划执行中新形成的三连仍由 finalizeAI→spendLoop 的 aiMergeCheck 兜底。
    var mg = 3;   // 预合并循环上限：防奖励卡再凑成新三连的链式极端局面
    while (mg-- > 0 && aiMergeCheck(ai)) {}

    // ★V5 分档路由：normal(s<0.85)=P1 启发式直出；hard(s≥0.85)=P2 模拟选优（本轮默认关闭）
    //   → 关闭时走 P1 精英档 planEliteTurn（多变体择优，纯数学评分，无真模拟）
    var plan;
    if (s >= 0.85 && ENABLE_P2) {
      plan = planSimTurn(ai, turn, ctx);
    } else if (s >= 0.85) {
      plan = planEliteTurn(ai, turn, ctx);
    } else {
      plan = planHeuristic(makeShadowView(ai), ai, turn, {});
    }
    executePlan(ai, plan, turn);
    finalizeAI(ai, turn, s, plan && plan._venomFirst);
  }

  /** P1 收尾：兜底花光 + 出场 + 冻结决策 + 站位（★V4.1 venomFirst：hard 档模板终选结果） */
  function finalizeAI(ai, turn, s, venomFirst) {
    spendLoop(ai, turn, s);
    // 出场兜底：破产也要把手牌打完（与玩家拖拽上场自由一致）
    var drainGuard = 24;
    while (ai.hand.length > 0 && ai.board.length < CFG.BOARD_SLOTS && drainGuard-- > 0) {
      aiPlayFromHand(ai, bestPlayIdx(ai));
    }
    // ★V4.2 场满换血（方案 P1.3「场满时：新卡评分 > 场上最弱 + 阈值 → 卖弱买新」）：
    //   修复后期手牌积压：场满时买到的更强卡此前会一直滞留手牌（战力平台期根因之一）。
    //   卖场上最弱（worstBoardIdx 含嘲讽/三连组件/升星核心保护）→ 上场手牌最强。
    //   注意：上场本身免费（卖出还+1金），故此处不再要求 gold≥3——旧条件使换血在
    //   金币花完后（0~1金）永不触发，正是 T4 后战力曲线走平的直接原因。
    var swapGuard = 8;
    while (ai.hand.length > 0 && ai.board.length >= CFG.BOARD_SLOTS && swapGuard-- > 0) {
      var hIdx = bestPlayIdx(ai);
      var hPow = minionPower(ai.hand[hIdx], ai.board);
      var wIdx = worstBoardIdx(ai);
      if (wIdx < 0) break;
      var bPow = minionPower(ai.board[wIdx], ai.board);
      if (hPow > bPow + 2) { aiSellBoard(ai, wIdx); aiPlayFromHand(ai, bestPlayIdx(ai)); }
      else break;
    }
    // ★V2.9.3 升级折扣门已删：递减公式天然按 tierSince 计价，AI 无需累积状态
    maybeFreeze(ai, turn, s);
    // ★V5 站位修正（方案 P1.4，管理员本轮验收项）：P1 基础/精英档默认「剧毒先手/光环最右」；
    //   仅 ENABLE_P2=true 时 hard 档保留模拟对拍终选权（_venomFirst === false 表示旧模板被真模拟选中）；easy 基线不动。
    if (venomFirst === false) arrange(ai.board);
    else arrangeVenomFirst(ai.board);
  }

  /** easy 档基线：现版（V2/V3）逻辑原样保留，作为弱AI对照（★V2.9.3 升级费用走递减公式） */
  function aiTurnLegacy(ai, turn) {
    // 决策策略
    var strategy = aiStrategy(ai);
    var targetT = targetTavern(turn, strategy);
    var guard = 30; // 防死循环

    while (ai.gold > 0 && guard-- > 0) {
      // 1. 三合一检查
      var beforeMerge = ai.hand.length + ai.board.length;
      aiMergeCheck(ai);
      if (ai.hand.length + ai.board.length < beforeMerge) continue;

      // 2. 升酒馆
      if (ai.tavern < targetT) {
        var cost = aiUpgradeCost(ai, turn);
        if (ai.gold >= cost) {
          ai.gold -= cost;
          ai.tavern++;
          ai.tierSince = turn; // ★V2.9.3 递减锚点重置（与玩家同规）
          aiRefreshShop(ai);
          continue;
        }
      }

      // 3. 买关键卡（legacy 随机门，保留原样作为 easy 基线）
      var bought = false;
      for (var sIdx = 0; sIdx < ai.shop.length; sIdx++) {
        var cardId = ai.shop[sIdx] && ai.shop[sIdx].id;
        if (!cardId) continue;
        // 检查是否已有2张同名（优先凑三合一）
        var copies = 0;
        ai.hand.forEach(function (m) { if (m.cardId === cardId) copies++; });
        ai.board.forEach(function (m) { if (m.cardId === cardId) copies++; });
        if (copies >= 2 || shouldBuy(cardId, ai, turn)) {
          if (ai.hand.length >= CFG.HAND_LIMIT) {
            // 手牌满：先卖手牌最弱
            aiSellHand(ai, ai.hand.length - 1);
          }
          if (aiBuy(ai, sIdx)) { bought = true; break; }
        }
      }
      if (bought) continue;

      // 4. 从手牌上场
      var played = false;
      if (ai.hand.length > 0 && ai.board.length < CFG.BOARD_SLOTS) {
        aiPlayFromHand(ai, 0);
        played = true;
      }
      if (played) continue;

      // 5. 卖弱卡腾位（场上满且手牌有更好卡）
      if (ai.board.length >= CFG.BOARD_SLOTS && ai.hand.length > 0) {
        aiSellBoard(ai, 0); // 卖最左（最弱）
        continue;
      }

      // 6. 刷新商店
      if (ai.gold >= CFG.COST_REFRESH && ai.shop.length > 0) {
        // 检查当前商店是否有可用卡
        var useful = false;
        for (var c = 0; c < ai.shop.length; c++) {
          if (ai.shop[c] && shouldBuy(ai.shop[c].id, ai, turn)) { useful = true; break; }
        }
        if (!useful) {
          if (!aiPayRefresh(ai)) break; // ★V17 h02 第一次免费
          aiRefreshShop(ai);
          continue;
        }
      }

      // 6.5 清零制兜底：仍有散钱且商店可刷 → 继续刷到花光（对齐玩家"必须花完"）
      if (ai.shop.length > 0 && aiPayRefresh(ai)) { // ★V17 h02 第一次免费
        aiRefreshShop(ai);
        continue;
      }

      // 7. 无有意义操作 → 结束
      break;
    }

    // 出场阶段在金币循环之外——破产也要把手牌打完，
    // 与玩家拖拽上场的自由一致（旧版受 gold>0 门控，首回合买完不上阵）
    var drainGuard = 20;
    while (ai.hand.length > 0 && ai.board.length < CFG.BOARD_SLOTS && drainGuard-- > 0) {
      aiPlayFromHand(ai, 0);
    }

    // ★V2.9.3 升级折扣门已删（对照 game.js ready() 同步删除）：费用由递减公式按 tierSince 计算

    // 站位
    arrange(ai.board);
  }

  /** 判断卡是否值得买（legacy easy 档专用：族系倾向+战力的随机门） */
  function shouldBuy(cardId, ai, turn) {
    var def = CARD_BY_ID[cardId];
    if (!def) return false;
    // 后期只买本族核心+中立工具
    if (turn >= 8) {
      if (def.tribe === ai.tribe) return true;
      if (def.tribe === 'neutral') return Math.random() < 0.5;
      return Math.random() < 0.2;
    }
    // 中期70%本族+30%中立
    if (turn >= 4) {
      if (def.tribe === ai.tribe) return Math.random() < 0.85;
      if (def.tribe === 'neutral') return Math.random() < 0.5;
      return Math.random() < 0.2;
    }
    return true; // 早期全买
  }

  /* ---------- 站位脚本 ---------- */
  function arrange(board) {
    function isAuraCore(m) {
      return m.cardId === 'm12' || m.cardId === 'm16' || m.cardId === 'm23' ||
        m.cardId === 'm29' || m.cardId === 'm34' || m.cardId === 'm36';
    }
    function score(m) {
      if (m.taunt) return 0;
      if (m.effectKind === 'deathrattle') return 1;
      if (isAuraCore(m)) return 4;
      if (m.venomous) return 3;
      return 2;
    }
    var withIdx = board.map(function (m, i) { return { m: m, i: i }; });
    withIdx.sort(function (a, b) { return score(a.m) - score(b.m) || a.i - b.i; });
    var out = withIdx.map(function (x) { return x.m; });
    for (var i = 0; i < out.length; i++) board[i] = out[i];
  }

  /** ★V4.1 hard 档备选站位模板：剧毒先手（方案 P1.4）
   *  剧毒→高攻→普攻→嘲讽→亡语→光环核心：剧毒先出手换掉敌方前排核心，
   *  高攻次之抢节奏；光环/引擎最右保活（与 arrange 同构，仅权重不同） */
  function arrangeVenomFirst(board) {
    function isAuraCore(m) {
      return m.cardId === 'm12' || m.cardId === 'm16' || m.cardId === 'm23' ||
        m.cardId === 'm29' || m.cardId === 'm34' || m.cardId === 'm36';
    }
    function score(m) {
      if (m.venomous) return 0;                    // 剧毒绝对先手
      var atk = (m.baseAtk || 0) + (m.buffAtk || 0);
      if (!m.venomous && atk >= 6 && !m.taunt) return 1;   // 高攻抢节奏
      if (m.effectKind === 'aura' || isAuraCore(m)) return 5;  // 光环引擎最右保活
      if (m.effectKind === 'deathrattle') return 4;    // 亡语居后（死了也有值）
      if (m.taunt) return 3;                       // 嘲讽中后排（承伤与位置无关）
      return 2;                                    // 普通输出
    }
    var withIdx = board.map(function (m, i) { return { m: m, i: i }; });
    withIdx.sort(function (a, b) { return score(a.m) - score(b.m) || a.i - b.i; });
    var out = withIdx.map(function (x) { return x.m; });
    for (var i = 0; i < out.length; i++) board[i] = out[i];
  }

  /* ---------- AI互打快速结算（11.10） ---------- */

  function quickSettle(entityA, entityB) {
    // ★V4 P0 AI强化：个体强度系数 mult（AI_CONFIGS 1.1/1.0/1.0/0.95/1.05）首次接入结算，
    //   mult^1.2 温和映射战力乘数（1.1→×1.12，0.95→×0.94），AI互打/淘汰结算体感分层。
    var ma = Math.pow(entityA.mult || 1, 1.2);
    var mb = Math.pow(entityB.mult || 1, 1.2);
    var pa = boardPower(entityA.board) * (0.85 + Math.random() * 0.3) * ma;
    var pb = boardPower(entityB.board) * (0.85 + Math.random() * 0.3) * mb;
    if (Math.abs(pa - pb) < 1e-9) return { winner: null, dmg: 0, survCount: 0, powerA: pa, powerB: pb };
    var winner = pa > pb ? 'a' : 'b';
    var winnerEnt = pa > pb ? entityA : entityB;
    var surv = Math.max(1, Math.min(CFG.BOARD_SLOTS, Math.ceil(7 * Math.max(pa, pb) / (pa + pb))));
    var sorted = winnerEnt.board.slice().sort(function (a, b) { return minionPower(b) - minionPower(a); });
    var tierSum = 0;
    for (var i = 0; i < Math.min(surv, sorted.length); i++) tierSum += sorted[i].tier;
    var dmg = winnerEnt.tavern + tierSum;
    return { winner: winner, dmg: dmg, survCount: surv, powerA: pa, powerB: pb };
  }

  return {
    minionPower: minionPower, boardPower: boardPower,
    aiTurn: aiTurn, arrange: arrange,
    quickSettle: quickSettle,
    targetTavern: targetTavern,
    _strengthOf: strengthOf,      // 测试/基准工具用（内部）
    _p2Enabled: ENABLE_P2,        // ★V5 范围开关暴露（基准/测试用；true=hard走P2模拟驱动）
    _aiMergeCheck: aiMergeCheck,  // ★2026-08-29 测试钩子：AI三连合并与玩家规则一致性回归用（内部）
    _heroOnPlayAI: heroOnPlayAI,  // ★V17 测试钩子：AI英雄打出触发（h04/h08）
    _aiSellHand: aiSellHand,      // ★V17 测试钩子：AI卖手牌（h05回金）
    _aiDrawShop: aiDrawShop,      // ★V17 测试钩子：AI商店生成（h03必含族）
    _aiPayRefresh: aiPayRefresh,  // ★V17 测试钩子：AI刷新支付（h02免费刷新）
    _aiDiscoverSettle: aiDiscoverSettle, // ★2026-09-04 测试钩子：AI发现结算（m20/m71）回归用（内部）
    _aiDealerOptions: aiDealerOptions,   // ★2026-09-04 测试钩子：AI跨档三选一结构回归用（内部）
    _aiPlayFromHand: aiPlayFromHand      // ★2026-09-04 测试钩子：AI打出上手（发现信号接管）回归用（内部）
  };
})();
