/* =========================================================================
 * 《云屿酒馆》 Web 版 - game.js
 * 游戏核心状态机（纯逻辑，无 DOM；可被 Node 测试）：
 *   选英雄 → 招募(限时) → 战斗(自动) → 结算 → 招募… → 决出冠军
 *   6人局（1玩家+5AI）、血量30+护甲、出局排名、鬼魂快照、配对规则(3回合不重复)
 * 经济：按第4章（无利息/存款，回合结束清零）；商店权重抽取/冻结/升级折扣：第5章
 * 三合一（压线购买/增益继承/三连奖励）：第7章；伤害公式与动态上限：第8章
 * ========================================================================= */

'use strict';

var GameCore = (function () {

  var S = null;          // 游戏状态
  var ui = null;         // 注入的UI接口（可缺省）
  var UID = 1000;

  function defaultUI() {
    return {
      update: function () {},
      fx: function () {},
      selectTarget: function (opts) { return Promise.resolve(opts.options.length ? opts.options[0] : null); },
      discover: function (opts) { return Promise.resolve(opts.options.length ? opts.options[0].id : null); }
    };
  }

  /* ================== 开局 ================== */

  function newGame(heroId, opts) {
    opts = opts || {};
    ui = opts.ui || defaultUI();
    UID = 1000;
    Pool.init();
    S = {
      phase: 'recruit',
      round: 0,
      difficultyMult: opts.difficultyMult || 1.2, // ★V2.9.4 缺省封死精英档 1.2（防漏传难度回落 normal 档）
      timerOn: opts.timerOn !== false,
      player: {
        id: 'P', kind: 'player', name: '你',
        heroId: heroId,
        hp: CFG.BASE_HP,
        maxHp: CFG.BASE_HP,
        gold: 0, tavern: 1,
        board: [], shop: [], hand: [],
        frozen: false, freezeUsed: 0,
        tierSince: 1,             // ★V2.9.3 到达当前酒馆等级的回合（升级费递减锚点，玩家/AI同规）
        refreshCount: 0, freeRefreshUsed: false,
        oppHistory: []
      },
      ais: [],
      entities: [],
      pairs: [],
      eliminations: [],   // 出局顺序 [{id, round}]（★V10 记录出局回合，供终局面板展示）
      pendingQuickResults: [],
      lastSettlement: null,
      gameOver: null
    };
    // 5个AI：兜帽每局随机族系；★V17 AI实体注入英雄id（抽选草稿分配，或从10位池随机不重复杂抽）
    AI_CONFIGS.forEach(function (cfg) {
      var tribe = cfg.tribe;
      if (cfg.randomTribe) tribe = ['gear', 'wild', 'tide'][Math.floor(Math.random() * 3)];
      var heroId = heroForAI(cfg.id);
      S.ais.push({
        id: 'A' + cfg.id, kind: 'ai', configId: cfg.id,
        name: cfg.name, desc: cfg.desc,
        heroId: heroId,
        tribe: tribe, mult: cfg.mult,
        hp: CFG.BASE_HP, maxHp: CFG.BASE_HP,
        ghost: false, tavern: 1, board: [], hand: [], shop: [],
        gold: 0, tierSince: 1, frozen: false,
        ghostBoard: null, ghostTavern: 0, ghostPower: 0,
        oppHistory: []
      });
    });
    S.entities = [S.player].concat(S.ais);
    // ★V17 英雄上下文挂载到真实板（h07 图腾行者光环按 board._heroId 判定，战斗克隆由 battle.js 同款注入）
    S.player.board._heroId = S.player.heroId;
    S.ais.forEach(function (ai) { ai.board._heroId = ai.heroId; });
    // ★V6.2 对局数据记录（方案：云屿酒馆-对局数据记录方案-阿莱克斯）——开局建档
    if (typeof Recorder !== 'undefined') Recorder.onGameStart(S);
    startRound();
    return S;
  }

  function state() { return S; }

  /* ================== ★V17 英雄抽选（设计§4：玩家三选一 + AI随机，全桌去重） ================== */

  var _draft = null; // 本局抽选草稿 {choices:[3], aiAssign:{ai1..ai5}}；newGame 消费

  /** 全桌去重抽选：10位英雄洗牌，前 CFG.HERO_DRAFT_CHOICES 位为玩家 N 选一候选，
   *  随后按序直接分配给 ai1~ai5（AI 不做候选挑选，池不足该位为空 → heroForAI 兜底随机）。
   *  多次调用重新洗牌（重开局/重渲染安全），newGame 时生效最近一次草稿。 */
  function drawHeroDraft() {
    var ids = HEROES.map(function (h) { return h.id; });
    for (var i = ids.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
    }
    var c = CFG.HERO_DRAFT_CHOICES;
    var aiAssign = {};
    AI_CONFIGS.forEach(function (cfg, i) { aiAssign[cfg.id] = ids[c + i]; });
    _draft = { choices: ids.slice(0, c), aiAssign: aiAssign };
    return { choices: _draft.choices.slice(), aiAssign: JSON.parse(JSON.stringify(_draft.aiAssign)) };
  }

  /* ---- ★V2.4 确定性种子抽选（联机等待房 N 选一） ----
   *  同一 key 恒定同一候选集：等待房以「房间号|座位」为 key，双方各自本地计算、
   *  渲染结果一致——无竞态、无需服务端存储，换房间即换抽选；
   *  与单机 drawHeroDraft 的 Math.random 洗牌互不影响。 */
  function seedFromKey(key) { // FNV-1a 变体（Math.imul 保证跨引擎位运算一致）
    var h = 2166136261 >>> 0;
    for (var i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function mulberry32(seed) { // 确定性 PRNG（32位）
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seededHeroDraft(key) {
    var ids = HEROES.map(function (h) { return h.id; });
    var rnd = mulberry32(seedFromKey(String(key)));
    for (var i = ids.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
    }
    return ids.slice(0, CFG.HERO_DRAFT_CHOICES);
  }

  /** AI 英雄取值：有抽选草稿按草稿，否则从全池随机（尽量不重复） */
  function heroForAI(configId) {
    if (_draft && _draft.aiAssign[configId]) return _draft.aiAssign[configId];
    if (!heroForAI._pool || !heroForAI._pool.length) {
      heroForAI._pool = HEROES.map(function (h) { return h.id; });
      for (var i = heroForAI._pool.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = heroForAI._pool[i]; heroForAI._pool[i] = heroForAI._pool[j]; heroForAI._pool[j] = t;
      }
    }
    return heroForAI._pool.pop();
  }

  /* ================== 回合流转 ================== */

  function goldForRound(r) {
    return r >= CFG.GOLD_CURVE.length - 1 ? CFG.GOLD_CURVE[CFG.GOLD_CURVE.length - 1] : CFG.GOLD_CURVE[r];
  }
  function timerForRound(r) {
    return r <= 3 ? 60 : r <= 7 ? 75 : 90; // 招募限时（文档 12.2）
  }

  function startRound() {
    S.round++;
    var p = S.player;
    p.gold = goldForRound(S.round);
    p.refreshCount = 0;
    p.freeRefreshUsed = false;
    p.freezeUsed = 0;
    // ★V3 每回合重置属性提升事件预算与 m51 涌泉祭司计数（防死循环上限，数值框架7.3）
    // ★V2.1 m43 余烬锻炉回盾计数同点清零（每回合限2次/2星4次）
    Effects.resetGains();
    p.board.concat(p.hand).forEach(function (m) { m._m51n = 0; m._m43n = 0; });
    // ★V17 每回合重置英雄技能计数（h04机簧/h05回收/h08引浪；h02免费刷新沿用 freeRefreshUsed）
    p._h04used = false; p._h05n = 0; p._h08n = 0;

    // 商店：冻结则原样保留（消耗冻结标记），否则重新生成
    if (p.frozen && p.shop.length) {
      p.frozen = false;
    } else {
      p.shop.forEach(function (c) { Pool.unloan(c.id); });
      p.shop = generateShop();
    }

    // ★V2 AI真实经济运营：活着的像真实玩家一样赚金→抽商店→买→升酒馆→凑三合一
    // ★V4 AI强化：传入实体情报供 hard 档（P2）预判对手战力（不影响玩家规则）
    S.ais.forEach(function (ai) {
      if (ai.ghost) {
        ai.board = ai.ghostBoard;
        ai.tavern = ai.ghostTavern;
      } else {
        AI.aiTurn(ai, S.round, S.difficultyMult, { entities: S.entities });
      }
    });

    // 配对
    makePairs();
    S.phase = 'recruit';
    ui.update();
  }

  /* ================== 配对（每回合6实体两两，3回合内不重复） ================== */

  function facedRecently(a, b) {
    var h = a.oppHistory.slice(-3);
    return h.indexOf(b.id) >= 0;
  }

  function makePairs() {
    var ents = S.entities.slice();
    var alive = ents.filter(function (e) { return !e.ghost; });
    var pairs = null;

    if (alive.length === 2) {
      // 仅剩2人：强制对决，其余鬼魂互殴（无实际后果）
      var rest = ents.filter(function (e) { return e.ghost; });
      pairs = [[alive[0], alive[1]]];
      for (var i = 0; i + 1 < rest.length; i += 2) pairs.push([rest[i], rest[i + 1]]);
    } else {
      // 全实体随机完美匹配 + 约束重试
      for (var attempt = 0; attempt < 600; attempt++) {
        var shuffled = ents.slice();
        for (var s = shuffled.length - 1; s > 0; s--) {
          var j = Math.floor(Math.random() * (s + 1));
          var t = shuffled[s]; shuffled[s] = shuffled[j]; shuffled[j] = t;
        }
        var ok = true;
        var cand = [];
        for (var k = 0; k + 1 < shuffled.length; k += 2) {
          var x = shuffled[k], y = shuffled[k + 1];
          var relax = attempt < 400 ? 3 : attempt < 500 ? 1 : 0; // 逐步放宽
          var h = x.oppHistory.slice(-relax);
          if (relax > 0 && h.indexOf(y.id) >= 0) { ok = false; break; }
          cand.push([x, y]);
        }
        if (ok) { pairs = cand; break; }
      }
      if (!pairs) { // 理论到不了这里
        pairs = [[ents[0], ents[1]], [ents[2], ents[3]], [ents[4], ents[5]]];
      }
    }

    S.pairs = pairs;
    pairs.forEach(function (pr) {
      pr[0].oppHistory.push(pr[1].id);
      pr[1].oppHistory.push(pr[0].id);
      if (pr[0].oppHistory.length > 6) pr[0].oppHistory.shift();
      if (pr[1].oppHistory.length > 6) pr[1].oppHistory.shift();
    });
  }

  function playerPair() {
    for (var i = 0; i < S.pairs.length; i++) {
      if (S.pairs[i][0] === S.player) return S.pairs[i][1];
      if (S.pairs[i][1] === S.player) return S.pairs[i][0];
    }
    return null;
  }

  /* ================== 商店 ================== */

  function generateShop() {
    var p = S.player;
    var slots = CFG.SHOP_SLOTS[p.tavern - 1];
    var cards = [];
    for (var i = 0; i < slots; i++) {
      var id = Pool.draw(p.tavern);
      if (id) cards.push({ id: id });
    }
    // 驯潮师·摩根：每次生成必含1张潮汐（替换一个卡位）
    if (p.heroId === 'h03' && cards.length) {
      var hasTide = cards.some(function (c) { return CARD_BY_ID[c.id].tribe === 'tide'; });
      if (!hasTide) {
        var tid = Pool.draw(p.tavern, function (c) { return c.tribe === 'tide'; });
        if (tid) {
          var slot = Math.floor(Math.random() * cards.length);
          Pool.unloan(cards[slot].id);
          cards[slot] = { id: tid };
        }
      }
    }
    return cards;
  }

  function refreshShop() {
    var p = S.player;
    if (S.phase !== 'recruit') return { ok: false, msg: '当前不是招募阶段' };
    var free = (p.heroId === 'h02' && !p.freeRefreshUsed);
    if (!free && p.gold < CFG.COST_REFRESH) return { ok: false, msg: '金币不足' };
    if (free) p.freeRefreshUsed = true; else p.gold -= CFG.COST_REFRESH;
    p.refreshCount++;
    p.shop.forEach(function (c) { Pool.unloan(c.id); });
    p.shop = generateShop();
    p.frozen = false; // 刷新即放弃冻结
    ui.update();
    return { ok: true };
  }

  function toggleFreeze() {
    var p = S.player;
    if (S.phase !== 'recruit') return { ok: false, msg: '当前不是招募阶段' };
    if (p.freezeUsed >= CFG.FREEZE_LIMIT) return { ok: false, msg: '本回合冻结次数已用完（5次）' };
    p.freezeUsed++;
    p.frozen = !p.frozen;
    ui.update();
    return { ok: true, frozen: p.frozen };
  }

  /** 下一级升级费用（★V2.9.3 完全对齐炉石）：
   *  基础价 UPGRADE_BASE[当前等级-1]，自到达当前等级（开局或上次升级）起每回合开始 -1，
   *  下限 0 金（可免费升本）；升级后 tierSince 重置为本回合 → 下一级恢复基础价（同回合连升第二跳亦按基础价）。 */
  function upgradeCost() {
    var p = S.player;
    if (p.tavern >= CFG.MAX_TIER) return Infinity;
    var base = CFG.UPGRADE_BASE[p.tavern - 1];
    return Math.max(CFG.UPGRADE_MIN, base - (S.round - p.tierSince));
  }

  function upgradeTavern() {
    var p = S.player;
    if (S.phase !== 'recruit') return { ok: false, msg: '当前不是招募阶段' };
    if (p.tavern >= CFG.MAX_TIER) return { ok: false, msg: '酒馆已满级' };
    var cost = upgradeCost();
    if (p.gold < cost) return { ok: false, msg: '金币不足' };
    p.gold -= cost;
    p.tavern++;
    p.tierSince = S.round; // ★V2.9.3 重置递减锚点：下一级从基础价重新开始递减
    ui.update();
    return { ok: true };
  }

  /* ================== 招募操作 ================== */

  function boardCopies(cardId) {
    return S.player.board.filter(function (m) { return m.cardId === cardId; });
  }

  /** 同名计数：手牌 + 场上（商店不参与三连计算） */
  function countCopiesAll(cardId, star) {
    var p = S.player;
    var n = 0;
    p.hand.forEach(function (m) { if (m.cardId === cardId && m.star === star) n++; });
    p.board.forEach(function (m) { if (m.cardId === cardId && m.star === star) n++; });
    return n;
  }

  /**
   * ★V2 从商店购买 → 入手牌（非直接上场）
   * 手牌满5张时，仅当购买能触发三合一（手牌+场上已有2张同名）时允许压线购买
   * @returns Promise<{ok, msg}>
   */
  function buyFromShop(slotIdx, position) {
    var p = S.player;
    if (S.phase !== 'recruit') return Promise.resolve({ ok: false, msg: '当前不是招募阶段' });
    var card = p.shop[slotIdx];
    if (!card) return Promise.resolve({ ok: false, msg: '卡位为空' });
    if (p.gold < CFG.COST_BUY) return Promise.resolve({ ok: false, msg: '金币不足' });
    // ★V2 检查同名数（手牌+场上，商店不参与三连）
    var copies = countCopiesAll(card.id, 1);
    var handFull = p.hand.length >= CFG.HAND_LIMIT;
    if (handFull && copies < 2) {
      return Promise.resolve({ ok: false, msg: '手牌已满（仅同名第3张可压线购买）' });
    }
    p.gold -= CFG.COST_BUY;
    Pool.consume(card.id);
    p.shop.splice(slotIdx, 1);
    var m = makeMinion(card.id, 1);
    // ★V2 购买入手牌
    p.hand.push(m);
    ui.fx('buy', { uid: m.uid });
    ui.update();
    /* ★V7 战吼时机修复：购买不触发战吼（战吼只在 playFromHand 上场时触发）
       ★V8 修复回归：购买仍需触发三合一检查（此前与战吼共用 afterAcquire 被
       一并移除，导致"场上2张A+买第3张A不三连"）。压线购买依赖此检查腾手位。 */
    return mergeCheck().then(function () { return { ok: true }; });
  }

  /**
   * ★V2 从手牌拖拽上场（触发战吼/打出触发/三合一检查）
   * @param handIdx 手牌索引
   * @param boardPos 场上位置（可选，默认最右）
   * @returns Promise<{ok, msg}>
   */
  function playFromHand(handIdx, boardPos) {
    var p = S.player;
    if (S.phase !== 'recruit') return Promise.resolve({ ok: false, msg: '当前不是招募阶段' });
    var m = p.hand[handIdx];
    if (!m) return Promise.resolve({ ok: false, msg: '手牌卡不存在' });
    if (p.board.length >= CFG.BOARD_SLOTS) return Promise.resolve({ ok: false, msg: '战场已满' });
    p.hand.splice(handIdx, 1);
    if (boardPos != null && boardPos >= 0 && boardPos <= p.board.length) p.board.splice(boardPos, 0, m);
    else p.board.push(m);
    ui.fx('playFromHand', { uid: m.uid });
    ui.update();
    return afterAcquire(m).then(function () { return { ok: true }; });
  }

  /**
   * 入场管线：战吼（可能要选目标/发现）→ 潮汐女王打出触发 → 三合一检查（链式）
   */
  function afterAcquire(m) {
    var p = S.player;
    var def = CARD_BY_ID[m.cardId];

    /* ★bugfix 2026-09-22（萨必实测反馈）：手牌入场也是"召唤到你的场上"事件，必须通知
       Effects.onSummon（m61 暖巢羽雀+生命 / m47 掘尸鬣狗+{n}/{n}）。此前该钩子仅覆盖
       m65 亡语召唤（本文件 summonFn，见 431 行）与战斗内召唤（battle.js），玩家招募期
       手牌入场（playFromHand 与发现 placeDiscovered 共用本管线）全程漏通知 → 上随从不
       加血/不成长。时机=入场后、战吼结算前（召唤触发先于战吼，炉石语义）。
       注：onSummon 内 m61/m47 数值基数（scaleNum(1,star)）保持不动，属后续数值补丁范围。 */
    Effects.onSummon(p.board, m, function (e) { ui.fx(e.t, e); });

    var chain = Promise.resolve();
    // 1. 战吼
    if (def.effectKind === 'battlecry') {
      chain = chain.then(function () {
        var options = [];
        if (def.needTarget) {
          options = Effects.battlecryTargets(m, p.board);
          if (!options.length) return null; // 无合法目标，战吼落空
          return ui.selectTarget({ minion: m, options: options, def: def })
            .then(function (tgt) { return tgt; });
        }
        return undefined; // 无需目标
      }).then(function (target) {
        var res = Effects.runBattlecry(m, p.board, {
          target: target,
          hand: p.hand, // ★V3 m49 拾贝寄居蟹：战吼可增益手牌中的随从
          fx: function (type, data) { ui.fx(type, data); },
          // ★V2.8 m65 兽骨招魂幡：招募期亡语召唤（满员拦截；入队即通知 onSummon/m61）
          summonFn: function (cardId, star) {
            if (p.board.length >= CFG.BOARD_SLOTS) return null;
            var tok = makeMinion(cardId, star);
            p.board.push(tok);
            ui.fx('summon', { side: 'a', idx: p.board.length - 1, minion: {
              uid: tok.uid, cardId: tok.cardId, name: tok.name, tier: tok.tier, star: tok.star,
              tribe: tok.tribe, atk: tok.baseAtk, hp: tok.baseHp, maxHp: tok.baseHp,
              shield: tok.shield, taunt: tok.taunt, venomous: tok.venomous,
              windfury: tok.windfury, cleave: tok.cleave, reborn: tok.reborn, buffAtk: 0, buffHp: 0
            } });
            Effects.onSummon(p.board, tok, function (e) { ui.fx(e.t, e); });
            return tok;
          },
          // ★V2.8 m72 酒馆医师：英雄回血（上限=基础血+护甲池）
          healHero: function (n) { p.hp = Math.min(CFG.BASE_HP + (p.armor || 0), p.hp + n); }
        });
        if (res === 'discover2') {
          // ★V2.8 云游星商：连续两次发现（复用 dealer 管线）
          var discChain = Promise.resolve();
          for (var di71 = 0; di71 < 2; di71++) {
            (function (round71) {
              discChain = discChain.then(function () {
                return openDiscover({
                  reason: 'dealer',
                  options: discoverOptions(0, p.tavern),
                  note: '连续发现 ' + (round71 + 1) + '/2'
                }).then(function (cardId) {
                  if (cardId) return placeDiscovered(cardId, m);
                });
              });
            })(di71);
          }
          return discChain;
        }
        if (res === 'discover') {
          // 情报贩子：跨档三选一（本级/本级−1/本级−2 各一张，★V3 审计报告方案A）
          return openDiscover({
            reason: 'dealer',
            options: discoverOptions(0, p.tavern),
            note: '本级 / 低一级 / 低二级 各一张'
          }).then(function (cardId) {
            if (cardId) return placeDiscovered(cardId, m);
          });
        }
      });
    }
    // 2. 打出触发（潮汐女王）
    chain = chain.then(function () {
      Effects.onPlayTrigger(p.board, m, function (type, data) { ui.fx(type, data); });
      heroOnPlay(p, m, function (type, data) { ui.fx(type, data); }); // ★V17 英雄打出触发（h04机簧启动/h08引浪）
      ui.update();
    });
    // 3. 三合一检查（可能产生新的三连奖励→继续入场）
    chain = chain.then(function () { return mergeCheck(); });
    return chain;
  }

  /** ★V17 英雄打出触发（玩家/AI 同规；ent 为 player 或 ai 实体，fx 动画回调）
   *  h04 机簧启动：每回合打出的第一张齿轮族随从获得圣盾（经m56可视为齿轮；已持盾不消耗次数）；
   *  h08 引浪：打出潮汐族随从→随机友方潮汐+1/+1（每回合最多3次，喂 m51）。 */
  function heroOnPlay(ent, m, fx) {
    fx = fx || function () {};
    if (!ent || !ent.heroId) return;
    var board = ent.board;
    if (ent.heroId === 'h04' && !ent._h04used && !m.shield && isTribeSafe(m, 'gear', board)) {
      ent._h04used = true;
      m.shield = true;
      m.grantedShield = true; // 赋予型口径：随三连继承
      fx('shieldGain', { uid: m.uid });
      Effects.onShieldGain(board, m, fx); // 喂 m21 偏转机兵等吃盾链
    }
    if (ent.heroId === 'h08' && (ent._h08n || 0) < 3 && isTribeSafe(m, 'tide', board)) {
      var cands = board.filter(function (x) { return x.alive && isTribeSafe(x, 'tide', board); });
      if (cands.length) {
        ent._h08n = (ent._h08n || 0) + 1;
        var pick = cands[Math.floor(Math.random() * cands.length)];
        pick.buffAtk += 1; pick.buffHp += 1;
        fx('buff', { uid: pick.uid, atk: 1, hp: 1 });
        Effects.onBuffGained(board, pick, fx); // 喂 m51 涌泉祭司（招募阶段不走战斗emit，统一显式通知）
      }
    }
  }

  /** 种族判定安全封装（实体侧 board 已挂 _heroId，经 m56 可视为对应族） */
  function isTribeSafe(m, tribe, board) {
    return Effects.isTribe(m, tribe, board);
  }

  /** ★V17 h09 藏品热忱的发现选项：等级≤酒馆等级内完全随机3张不重复（占用共享池） */
  function heroDiscoverOptions(maxTier) {
    var opts = [];
    var avail = CARDS.filter(function (c) {
      return c.tier <= maxTier && Pool.available(c.id) > 0;
    });
    var guard = 40;
    while (opts.length < 3 && avail.length && guard-- > 0) {
      var k = Math.floor(Math.random() * avail.length);
      var c = avail.splice(k, 1)[0];
      Pool.loan(c.id);
      opts.push({ id: c.id, loaned: true });
    }
    return opts;
  }

  /** 发现选项：tier>0 表示精确档位（三连奖励，锁档填满）；tier=0 表示 ≤maxTier 跨档三选一
   *  ★V3 审计报告方案A：情报贩子（dealer）三张 = 本级 / 本级−1 / 本级−2 各一张（每档只取1张，
   *  该档池抽干才降档补位），发现类效果的策略张力来自档位取舍；三连奖励路径保持锁档不变。 */
  function discoverOptions(tier, maxTier) {
    var opts = [];
    if (tier > 0) {
      // 三连奖励：精确档位锁档填满3张（与玩家规则一致，不降档）
      var locked = [];
      var guard0 = 40;
      while (locked.length < 3 && guard0-- > 0) {
        var avail0 = CARDS.filter(function (c) {
          return c.tier === tier && Pool.available(c.id) > 0 && locked.every(function (o) { return o.id !== c.id; });
        });
        if (!avail0.length) break;
        var c0 = avail0[Math.floor(Math.random() * avail0.length)];
        Pool.loan(c0.id);
        locked.push({ id: c0.id, loaned: true });
      }
      return locked;
    }
    // dealer 跨档三选一：本级 / 本级−1 / 本级−2 各取1张；某档抽干则顺延降档补位
    var tryTiers = [maxTier, maxTier - 1, maxTier - 2, maxTier - 3];
    for (var t = 0; t < tryTiers.length && opts.length < 3; t++) {
      var lv = tryTiers[t];
      // ★修复 2026-09-04：上限原硬编码 4（四本时代遗留），酒馆5/6本时 dealer 会漏掉本级/低一级档
      if (lv < 1 || lv > CFG.MAX_TIER) continue;
      // ★方案A核心：每档只取1张（同档已取过则跳过该档）
      var sameTierCount = opts.filter(function (o) { return CARD_BY_ID[o.id].tier === lv; }).length;
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

  function openDiscover(meta) {
    if (!meta.options.length) return Promise.resolve(null);
    return ui.discover(meta).then(function (cardId) {
      // 释放未选中的借用，选中者转为占用
      meta.options.forEach(function (o) {
        if (o.id === cardId) Pool.consume(o.id);
        else Pool.unloan(o.id);
      });
      return cardId;
    });
  }

  /** 发现的随从入场：满7格自动卖出最右侧（非当前战吼随从）腾位 */
  /** ★V2 发现/三连奖励入队：优先入手牌（满则卖手牌最右腾位） */
  function placeDiscovered(cardId, exclude) {
    var p = S.player;
    if (p.hand.length >= CFG.HAND_LIMIT) {
      // 手牌满：卖手牌最右腾位
      var last = p.hand.length - 1;
      if (p.hand[last]) {
        Pool.returnMinion(p.hand[last].cardId, p.hand[last].star);
        p.gold += sellGain(p);
        p.hand.splice(last, 1);
      }
    }
    var m = makeMinion(cardId, 1);
    p.hand.push(m);
    ui.update();
    return afterAcquire(m);
  }

  /* ================== 三合一（第7章） ================== */

  /** 场上凑齐3张同名同星 → 合成；2星创建时弹出三连奖励发现 */
  function mergeCheck() {
    var p = S.player;
    // 三连触发域：手牌 + 上阵阵容（战场7格）；商店不参与三连计算
    var groups = {};
    p.hand.forEach(function (m, i) {
      var key = m.cardId + '@' + m.star;
      if (!groups[key]) groups[key] = [];
      groups[key].push({ domain: 'hand', idx: i, minion: m });
    });
    p.board.forEach(function (m, i) {
      var key = m.cardId + '@' + m.star;
      if (!groups[key]) groups[key] = [];
      groups[key].push({ domain: 'board', idx: i, minion: m });
    });

    var keys = Object.keys(groups).filter(function (k) { return groups[k].length >= 3; });
    if (!keys.length) return Promise.resolve(null);
    var key = keys[0];
    var picks = groups[key].slice(0, 3);
    var cardId = picks[0].minion.cardId;
    var newStar = picks[0].minion.star + 1;
    var materials = [];

    // 从各域移除素材（从后往前处理同域索引避免位移）
    picks.sort(function (a, b) {
      if (a.domain !== b.domain) return 0;
      return b.idx - a.idx;
    });
    picks.forEach(function (pk) {
      if (pk.domain === 'hand') {
        materials.push(p.hand[pk.idx]);
        p.hand.splice(pk.idx, 1);
      } else if (pk.domain === 'board') {
        materials.push(p.board[pk.idx]);
        p.board.splice(pk.idx, 1);
      }
    });

    var merged = makeMinion(cardId, newStar);
    // 增益继承
    var sumAtk = 0, sumHp = 0;
    var kwAny = {};
    KW_LIST.forEach(function (k) { kwAny[k] = false; });
    materials.forEach(function (mat) {
      sumAtk += mat.buffAtk; sumHp += mat.buffHp;
      KW_LIST.forEach(function (k) {
        if (mat[k] || mat[kwGrantedKey(k)]) kwAny[k] = true;
      });
    });
    merged.buffAtk = Math.max(0, sumAtk);
    merged.buffHp = Math.max(0, sumHp);
    // ★修复2026-08-29 三连关键词继承（用户反馈：增益获得的圣盾三连后丢失）
    //   卡面自带：makeMinion 按同 cardId 的 def.kw 重建，天然保留；
    //   运行时增益（grantedXxx 标记路径）：任一素材持有 → 合并卡继承并保留 granted 标记。
    //   覆盖圣盾/剧毒/风怒/嘲讽/顺劈/复生全部关键词（剧毒为既有规则的对齐泛化）。
    KW_LIST.forEach(function (k) {
      if (kwAny[k] && !merged[k]) {
        merged[k] = true;
        merged[kwGrantedKey(k)] = true;
      }
    });

    // ★V2 合成结果优先入手牌（满则上场；场也满则卖最弱腾位入手牌）
    if (p.hand.length < CFG.HAND_LIMIT) {
      p.hand.push(merged);
    } else if (p.board.length < CFG.BOARD_SLOTS) {
      p.board.push(merged);
    } else {
      // 卖场上最弱腾位 → 合成卡入手牌
      var weakest = 0;
      for (var w = 1; w < p.board.length; w++) {
        if ((p.board[w].baseAtk + p.board[w].buffAtk + p.board[w].baseHp + p.board[w].buffHp) <
            (p.board[weakest].baseAtk + p.board[weakest].buffAtk + p.board[weakest].baseHp + p.board[weakest].buffHp)) weakest = w;
      }
      Pool.returnMinion(p.board[weakest].cardId, p.board[weakest].star);
      p.gold += sellGain(p);
      p.board.splice(weakest, 1);
      p.hand.push(merged);
    }

    ui.fx('merge', { uid: merged.uid, cardId: cardId, star: newStar });
    ui.update();

    if (newStar >= 2) {
      // 三连奖励：从高一级卡池发现（4本酒馆则4级池）
      // ★平衡调整2026-08-29（用户拍板）：3星合成（2星×3）同样享锁档三连奖励（原仅2星合成有）
      var tier = Math.min(p.tavern + 1, CFG.MAX_TIER);
      return new Promise(function (resolve) {
        // 先给合成演出留时间（UI可自行覆盖时长）
        setTimeout(function () { resolve(null); }, 60);
      }).then(function () {
        return openDiscover({
          reason: 'triple',
          options: discoverOptions(tier, tier),
          note: '等级' + tier + '卡池'
        });
      }).then(function (cardId2) {
        var chained = cardId2 ? placeDiscovered(cardId2, null) : Promise.resolve();
        return chained.then(function () {
          // ★V17 h09 藏品热忱：三连后额外发现一张≤酒馆等级的随从免费入手牌（满则+3金币）
          if (p.heroId === 'h09') {
            if (p.hand.length < CFG.HAND_LIMIT) {
              return openDiscover({
                reason: 'h09-triple',
                options: heroDiscoverOptions(p.tavern),
                note: '藏品热忱：等级≤' + p.tavern + '卡池'
              }).then(function (c3) {
                if (c3) return placeDiscovered(c3, null).then(function () { return mergeCheck(); });
                return mergeCheck();
              });
            }
            p.gold += 3; // 手牌已满 → 改为+3金币
          }
          return mergeCheck();
        });
      });
    }
    return mergeCheck(); // 链式：可能继续合成3星
  }

  /** ★平衡调整2026-08-29：战斗内永久增益回写（m42 双联磨轮 / m32 余晖收藏家）。
   *  战斗模拟操作的是克隆体，permAtk/permHp 在克隆上累计；战斗结束后按 uid 写回
   *  真实随从的 buffAtk/buffHp（合并继承按 buff 求和，口径一致），跨战斗保留。 */
  function writebackPerm(simBoards, realBoard) {
    if (!simBoards || !realBoard) return;
    simBoards.forEach(function (sim) {
      if (!sim || !(sim.permAtk || sim.permHp)) return;
      for (var i = 0; i < realBoard.length; i++) {
        if (realBoard[i].uid === sim.uid) {
          realBoard[i].buffAtk += sim.permAtk || 0;
          realBoard[i].buffHp += sim.permHp || 0;
          break;
        }
      }
    });
  }

  /** ★V17 h05 回收协议：卖出随从的实际收益（基础售价 + 英雄回金，每回合最多2次）。
   *  覆盖全部卖出路径：手动卖场上/手牌、购买腾位、发现腾位、三连腾位。 */
  function sellGain(p) {
    var g = CFG.COST_SELL;
    if (p.heroId === 'h05' && (p._h05n || 0) < 2) {
      p._h05n = (p._h05n || 0) + 1;
      g += 1;
    }
    return g;
  }

  function sellMinion(idx, silent) {
    var p = S.player;
    if (S.phase !== 'recruit' && !silent) return { ok: false, msg: '当前不是招募阶段' };
    var m = p.board[idx];
    if (!m) return { ok: false, msg: '随从不存在' };
    p.board.splice(idx, 1);
    p.gold += sellGain(p);
    Pool.returnMinion(m.cardId, m.star);
    // ★V3 m55 铁算盘账房：卖出后随机友方+{n}/{n}
    Effects.onSold(p.board, function (type, data) { ui.fx(type, data); });
    if (!silent) { ui.fx('sell', { uid: m.uid }); ui.update(); }
    return { ok: true };
  }

  /** ★V2 从手牌卖出 */
  function sellFromHand(idx, silent) {
    var p = S.player;
    if (S.phase !== 'recruit' && !silent) return { ok: false, msg: '当前不是招募阶段' };
    var m = p.hand[idx];
    if (!m) return { ok: false, msg: '手牌卡不存在' };
    p.hand.splice(idx, 1);
    p.gold += sellGain(p);
    Pool.returnMinion(m.cardId, m.star);
    // ★V3 m55 铁算盘账房：卖出后随机友方+{n}/{n}
    Effects.onSold(p.board, function (type, data) { ui.fx(type, data); });
    if (!silent) { ui.fx('sell', { uid: m.uid }); ui.update(); }
    return { ok: true };
  }

  function moveMinion(from, to) {
    var p = S.player;
    if (S.phase !== 'recruit') return { ok: false };
    if (from < 0 || from >= p.board.length || to < 0 || to >= CFG.BOARD_SLOTS) return { ok: false };
    var m = p.board.splice(from, 1)[0];
    if (!m) return { ok: false };
    var pos = Math.min(to, p.board.length);
    p.board.splice(pos, 0, m);
    ui.update();
    return { ok: true };
  }

  /* ================== 招募结束 → 战斗 ================== */

  function ready() {
    if (S.phase !== 'recruit') return null;
    var p = S.player;
    // ★V2.9.3 自研升级折扣机制删除：下一级费用改由「趴本递减」驱动（upgradeCost 按 tierSince 计算），ready() 不再累积折扣
    // 未冻结的商店卡回池
    if (!p.frozen) p.shop.forEach(function (c) { Pool.unloan(c.id); });
    else p.shop.forEach(function (c) { /* 冻结：保持占用 */ });
    // ★V2 AI商店卡也回池
    S.ais.forEach(function (ai) {
      if (ai.ghost) return;
      ai.shop.forEach(function (c) { Pool.unloan(c.id); });
      ai.shop = [];
    });

    S.phase = 'battle';

    // 其余配对快速结算
    S.pendingQuickResults = [];
    S.pairs.forEach(function (pr) {
      if (pr[0] === S.player || pr[1] === S.player) return;
      var r = AI.quickSettle(pr[0], pr[1]);
      S.pendingQuickResults.push({ a: pr[0], b: pr[1], result: r });
    });

    var enemy = playerPair();
    ui.update();
    return {
      enemy: enemy,
      playerBoard: S.player.board,
      enemyBoard: enemy ? enemy.board : [],
      heroA: S.player.heroId,
      heroB: enemy ? (enemy.heroId || null) : null, // ★V17 AI英雄id传入战斗（h06/h10战开技能生效）
      heroHpA: S.player.hp,
      heroHpB: enemy ? enemy.hp : null
    };
  }

  /* ================== 战斗结算（第8章 伤害公式） ================== */

  /** 败方扣血 = 胜方酒馆等级 + 存活随从卡面等级和（衍生物按1级） */
  function damageFromBattle(winnerEnt, survivors) {
    var sum = winnerEnt.tavern;
    survivors.forEach(function (m) { sum += m.tier; });
    return sum;
  }

  /** 伤害结算口径（★V17.1 用户澄清；★V2.4 复核定版；★V2.7 帽15→18按公告默认实装）：败者最终结算伤害 = min(酒馆等级+存活随从等级和, 18)。
   *  ★V2.4 间接伤害口径说明（全库审计结论）：battle.js/effects.js 对英雄血量只有读取（h10 背水按 hp≤17（★V2.9.4）
   *  判定攻击翻倍），不存在技能/亡语直接伤害英雄的路径——英雄扣血全库仅玩家战 dmgE/dmgP 与 AI 互战
   *  三处，全部经本函数封顶，故"间接伤害是否同受上限"无额外路径：对英雄的伤害口径天然全覆盖受 30 帽（★V2.9.4，原 18）。
   *  ★V2.7 帽重校依据：6 本时代酒馆+存活等级和显著变大，15 帽会过度截断形成拖局；18 ≈ 30 血基准的
   *  60%，保留斩杀张力又给高本面板合理结算空间（备选 20 与 40 血重做未采纳，待实测数据回调）。
   *  ★V2.9.4 帽重校：BASE_HP 30→50 后维持「帽≈60%×BASE_HP」锚点 18→30（灵犀 50 血 hard 实测：帽 18 截断率 12.4~12.9%，帽 30 为 0.5~0.7%，整局中位轮不变）。
   *  仅作用于最终结算（damageFromBattle / quickSettle 的 dmg），不涉及随从攻击层面；
   *  旧 R1~3=5 / R4~7=10 动态帽已移除（存活人数/回合数不再影响上限）。 */
  function capDamage(dmg) {
    return Math.min(dmg, 30); // ★V2.9.4 18→30（≈50 血基准的 60%）
  }

  function finishPlayerBattle(simResult) {
    if (S.phase !== 'battle') return null;
    var p = S.player;
    var enemy = playerPair();
    var data = {
      round: S.round,
      playerFight: null,
      otherFights: [],
      hpChanges: [],
      eliminations: [],
      gameOver: null
    };

    // 玩家战斗
    // ★平衡调整2026-08-29：永久增益回写（m42/m32 战斗内触发 → 写回双方真实阵容）
    writebackPerm(simResult.boards && simResult.boards.a, p.board);
    writebackPerm(simResult.boards && simResult.boards.b, enemy && enemy.board);
    var pf = { enemyName: enemy ? enemy.name : '—', ghost: enemy ? !!enemy.ghost : false };
    if (simResult.winner === 'a') {
      var dmgE = capDamage(damageFromBattle(p, simResult.survivorsA));
      pf.result = 'win'; pf.dmgToPlayer = 0; pf.dmgToEnemy = enemy && !enemy.ghost ? dmgE : 0;
      pf.survivors = simResult.survivorsA.length;
    } else if (simResult.winner === 'b') {
      var dmgP = capDamage(damageFromBattle(enemy, simResult.survivorsB));
      pf.result = 'lose'; pf.dmgToPlayer = dmgP; pf.dmgToEnemy = 0;
      pf.survivors = simResult.survivorsB.length;
    } else {
      pf.result = 'draw'; pf.dmgToPlayer = 0; pf.dmgToEnemy = 0;
    }
    data.playerFight = pf;

    // 应用玩家战斗伤害
    if (enemy && !enemy.ghost) enemy.hp -= pf.dmgToEnemy;
    if (pf.dmgToPlayer > 0) p.hp -= pf.dmgToPlayer;
    // ★V11 击杀标记：胜方本次战斗将对方打至出局（伤害落地后 hp≤0，且对方此前非鬼魂）。
    //   供结算横幅显示「击杀（对方名称）」——名称随实体名走：单机=AI名，联机=对端玩家昵称。
    //   鬼魂本就不受伤（dmgToEnemy 恒 0）→ 永不触发本标记，与★V10胜方免伤文案并存不冲突。
    pf.killed = pf.result === 'win' && !!enemy && !enemy.ghost && enemy.hp <= 0;

    // AI互战
    S.pendingQuickResults.forEach(function (q) {
      var r = q.result;
      var of_ = { aName: q.a.name, bName: q.b.name, winnerName: null, dmg: 0, draw: !!r.winner === false && r.winner === null };
      var loser = null, dmg = 0;
      if (r.winner === 'a') { of_.winnerName = q.a.name; loser = q.b; dmg = r.dmg; }
      else if (r.winner === 'b') { of_.winnerName = q.b.name; loser = q.a; dmg = r.dmg; }
      if (loser && !loser.ghost) {
        var capped = capDamage(dmg);
        loser.hp -= capped;
        of_.dmg = capped;
      }
      data.otherFights.push(of_);
    });

    // 结算血量变化与出局
    S.entities.forEach(function (e) {
      data.hpChanges.push({ id: e.id, name: e.name, hp: Math.max(0, e.hp), ghost: e.ghost });
    });
    var dead = S.entities.filter(function (e) { return !e.ghost && e.hp <= 0; });
    dead.sort(function (a, b) { return a.hp - b.hp; }); // 同回合出局：血量更低者先出局
    dead.forEach(function (e) {
      e.ghost = true;
      e.hp = 0;
      // ★V10 修复（出局顺序异常）：记录含出局回合，终局面板不再全显终局回合
      S.eliminations.push({ id: e.id, round: S.round });
      if (e.kind === 'ai') {
        e.ghostBoard = e.board.map(function (m) { return cloneMinion(m); });
        e.ghostTavern = e.tavern;
        e.ghostPower = AI.boardPower(e.ghostBoard);
      }
      data.eliminations.push({ name: e.name, isPlayer: e.kind === 'player', rank: S.eliminations.length, round: S.round });
    });

    // 玩家出局 / 全AI出局 → 终局
    if (S.player.hp <= 0) {
      S.gameOver = { win: false, ranking: finalRanking() };
      data.gameOver = S.gameOver;
    } else if (S.ais.every(function (a) { return a.ghost; })) {
      S.gameOver = { win: true, ranking: finalRanking() };
      data.gameOver = S.gameOver;
    }

    // ★V6.2 对局数据记录——每回合快照 + 终局落盘（纯旁路，不改动流程与平衡）
    if (typeof Recorder !== 'undefined') {
      Recorder.onRound(data, { S: S, enemy: enemy });
      if (data.gameOver) Recorder.onGameOver(S, data.gameOver);
    }

    S.lastSettlement = data;
    S.phase = 'settle';
    ui.update();
    return data;
  }

  /** 最终排名：存活者(血量降序) → 出局倒序 */
  function finalRanking() {
    var alive = S.entities.filter(function (e) { return !e.ghost; });
    alive.sort(function (a, b) { return b.hp - a.hp; });
    var out = alive.map(function (e) { return e; });
    for (var i = S.eliminations.length - 1; i >= 0; i--) {
      out.push(S.entities.filter(function (e) { return e.id === S.eliminations[i].id; })[0]);
    }
    return out.map(function (e, i) {
      // ★V10 附带 id：终局面板头像可按实体精确匹配
      return { rank: i + 1, id: e.id, name: e.name, hp: Math.max(0, e.hp), isPlayer: e.kind === 'player', ghost: !!e.ghost };
    });
  }

  function nextRound() {
    if (S.phase !== 'settle') return null;
    if (S.gameOver) { S.phase = 'over'; ui.update(); return null; }
    startRound();
    return S;
  }

  function cloneMinion(m) {
    return {
      uid: ++UID, cardId: m.cardId, name: m.name, tier: m.tier, star: m.star,
      tribe: m.tribe, effectKind: m.effectKind,
      baseAtk: m.baseAtk, baseHp: m.baseHp, buffAtk: m.buffAtk, buffHp: m.buffHp,
      damage: 0,
      shield: !!m.shield, taunt: !!m.taunt, venomous: !!m.venomous,
      windfury: !!m.windfury, cleave: !!m.cleave, reborn: !!m.reborn,
      // ★修复 2026-09-04：克隆补 token 字段——鬼魂阵容此前丢失衍生物标记
      //   （衍生物判定通用字段；★萨必调整2026-09-05 m76 已移出卡池，字段保留给 t01~t08 体系）
      token: !!m.token,
      grantedVenomous: !!m.grantedVenomous,
      // ★2026-08-29 granted 标记随克隆保留（战斗副本与源随从字段口径一致）
      grantedShield: !!m.grantedShield, grantedTaunt: !!m.grantedTaunt,
      grantedWindfury: !!m.grantedWindfury, grantedCleave: !!m.grantedCleave,
      grantedReborn: !!m.grantedReborn,
      alive: true, revived: false
    };
  }

  /* ================== 查询辅助 ================== */

  function currentOpponent() { return playerPair(); }
  function playerEff(m) {
    return {
      atk: Effects.effAtk(m, S.player.board, S.player.heroId),
      hp: Effects.effHp(m, S.player.board, S.player.heroId),
      maxHp: Effects.effMaxHp(m, S.player.board)
    };
  }

  return {
    newGame: newGame, state: state,
    drawHeroDraft: drawHeroDraft, // ★V17 英雄抽选（玩家N选一+AI随机，全桌去重）
    seededHeroDraft: seededHeroDraft, // ★V2.4 联机等待房按「房间号|座位」确定性抽选（双端同构渲染）
    _heroOnPlay: heroOnPlay,      // ★V17 测试钩子：英雄打出触发（h04/h08 玩家侧）
    refreshShop: refreshShop, toggleFreeze: toggleFreeze,
    upgradeTavern: upgradeTavern, upgradeCost: upgradeCost,
    buyFromShop: buyFromShop, sellMinion: sellMinion, sellFromHand: sellFromHand,
    playFromHand: playFromHand, moveMinion: moveMinion,
    ready: ready, finishPlayerBattle: finishPlayerBattle, nextRound: nextRound,
    currentOpponent: currentOpponent, playerEff: playerEff,
    goldForRound: goldForRound, timerForRound: timerForRound,
    finalRanking: finalRanking
  };
})();
