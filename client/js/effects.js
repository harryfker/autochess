/* =========================================================================
 * 《云屿酒馆》 Web 版 - effects.js
 * 效果系统：战吼 / 光环（动态）/ 亡语 / 触发 / 战斗开始时 / 打出触发
 * 依据：设计文档第4章（关键词矩阵）+ 第7章（升星倍率）+ 数值平衡表
 *
 * 光环采用"实时计算"模型（文档 13.1）：
 *   有效攻击 = base + buff + Σ光环；有效最大生命 = base + buff + Σ光环(+HP)
 *   战斗内伤害以 damage(已损失生命) 记账，光环源死亡后自然回落。
 * ========================================================================= */

'use strict';

var Effects = (function () {

  /* ============ ★V3 全局防死循环预算（数值框架 7.3） ============ */
  /* 每回合（招募阶段或单场战斗）全局"触发型属性提升/赋予"事件上限 200 次：
   * 防止 m43 余烬锻炉 / m51 涌泉祭司等循环卡在极端组合下性能与数值失控。 */
  var GAIN_CAP = 200;
  var deathCascade = 0; // ★V2.8 m65 亡语触发器级联深度（>0 时「触发亡语」类效果休眠，防递归雪崩；★萨必调整2026-09-05 m75 已移出卡池）
  var gainCount = 0;
  function resetGains() { gainCount = 0; }
  function gainLeft() { return gainCount < GAIN_CAP; }
  function spendGain() { gainCount++; }
  function gainsUsed() { return gainCount; }

  /* ============ ★V3 有效族系（m56 酒馆老板统一出口） ============ */
  /** m56 在场 → 全队视为所有种族；否则返回其原生族系。审计报告建议：族系判定统一走本函数。 */
  function effTribe(m, board) {
    if (board) {
      for (var i = 0; i < board.length; i++) {
        var x = board[i];
        if (x.alive && x.cardId === 'm56') return 'all';
      }
    }
    return m.tribe;
  }
  function isTribe(m, tribe, board) {
    var t = effTribe(m, board);
    return t === 'all' || t === tribe;
  }

  /* ============ 属性计算（含动态光环） ============ */

  /** 攻击光环：嚎月头狼(m16,+n/+n的攻部分) / 怒涛战旗手(m29) / 圣徽巡礼官(m23动态) / 布伦希尔 / ★V3 鎏金掌旗官(m41) / 枯木长老(m48动态)
   *  ★V2.7 m12 扩音军士→装甲军士：攻光环（与其他齿轮攻光环及h01重叠）迁至血光环，见 auraHpFor */
  function auraAtkFor(m, board, heroId) {
    var bonus = 0;
    var mi = board.indexOf(m); // ★V2.8 m60 相邻判定用
    // ★V17 h07 图腾行者：荒野+1攻（board._heroId 由战斗克隆/实体侧注入，与m48._deaths同款数组挂载口径）
    if (board._heroId === 'h07' && isTribe(m, 'wild', board)) bonus += 1;
    for (var i = 0; i < board.length; i++) {
      var x = board[i];
      if (!x.alive || x === m) continue;
      if (x.cardId === 'm16' && isTribe(m, 'wild', board)) bonus += scaleNum(1, x.star);
      else if (x.cardId === 'm29' && isTribe(m, 'tide', board)) bonus += scaleNum(2, x.star);
      // ★V3 m41 鎏金掌旗官：其他带圣盾的友方+n攻
      else if (x.cardId === 'm41' && m.shield) bonus += scaleNum(1, x.star);
      // ★V2.8 m60 游丝调校师：相邻友方+{n}攻（光环首个空间维度；indexOf 每源一次可忽略，板≤7）
      else if (x.cardId === 'm60' && Math.abs(i - board.indexOf(m)) === 1) bonus += scaleNum(1, x.star);
      // ★V2.8 m63 鎏金元帅：其他齿轮+{n}/{n}（攻侧）
      else if (x.cardId === 'm63' && isTribe(m, 'gear', board)) bonus += scaleNum(2, x.star);
      // ★V3 m48 枯木长老：战斗中每有一个友方死亡 → 其他荒野+n攻（board._deaths 由战斗引擎维护）
      else if (x.cardId === 'm48' && isTribe(m, 'wild', board)) bonus += scaleNum(1, x.star) * (board._deaths || 0);
    }
    if (m.cardId === 'm23') { // 动态：其他带圣盾友方随从数 × 数值
      var shields = 0;
      for (var j = 0; j < board.length; j++) {
        var y = board[j];
        if (y.alive && y !== m && y.shield) shields++;
      }
      bonus += scaleNum(1, m.star) * shields;
    }
    if (heroId === 'h01') bonus += 2; // 铁腕执政官：全队+2攻
    return bonus;
  }

  /** 生命光环：嚎月头狼(m16) / ★V3 枯木长老(m48动态) / ★V17 h07图腾行者
   *  ★V2.7 新增 m12 装甲军士：所有齿轮族随从生命值+{n}（用户原文「所有」=含自身——
   *  循环内管他人、循环外特判自身；双军士同场时彼此+自身各计一次，等效+2 ✓）；
   *  effMaxHp 已含 auraHpFor（V3 审计 BUG-2 修复口径），m37 落雷连锁判定自动兼容 */
  function auraHpFor(m, board) {
    var bonus = 0;
    if (board._heroId === 'h07' && isTribe(m, 'wild', board)) bonus += 1; // ★V17 图腾行者：荒野+1血（board._heroId 由战斗克隆时注入，招募阶段走 ui 直调时传 board 侧参数）
    for (var i = 0; i < board.length; i++) {
      var x = board[i];
      if (!x.alive || x === m) continue;
      if (x.cardId === 'm16' && isTribe(m, 'wild', board)) bonus += scaleNum(1, x.star);
      // ★V2.7 m12 装甲军士：所有齿轮族+{n}血（他人方向）
      else if (x.cardId === 'm12' && isTribe(m, 'gear', board)) bonus += scaleNum(1, x.star);
      // ★V2.8 m63 鎏金元帅：其他齿轮+{n}/{n}（血侧）
      else if (x.cardId === 'm63' && isTribe(m, 'gear', board)) bonus += scaleNum(2, x.star);
      // ★V3 m48 枯木长老：战斗中每有一个友方死亡 → 其他荒野+n血（动态）
      else if (x.cardId === 'm48' && isTribe(m, 'wild', board)) bonus += scaleNum(1, x.star) * (board._deaths || 0);
    }
    // ★V2.7 m12 自身特判：「所有」含自身（用户原文口径），与 m16/m48 的「其他」语义区分
    if (m.cardId === 'm12' && m.alive && isTribe(m, 'gear', board)) bonus += scaleNum(1, m.star);
    return bonus;
  }

  function effAtk(m, board, heroId) {
    return Math.max(0, m.baseAtk + m.buffAtk + auraAtkFor(m, board, heroId));
  }
  function effMaxHp(m, board) {
    return Math.max(1, m.baseHp + m.buffHp + auraHpFor(m, board));
  }
  function effHp(m, board, heroId) {
    return effMaxHp(m, board) - m.damage;
  }

  /* ============ 战吼（招募阶段） ============ */

  /** 需要玩家选目标的战吼 */
  function battlecryNeedsTarget(def) {
    return !!def.needTarget;
  }

  /** 合法目标列表 */
  function battlecryTargets(m, board) {
    var idx = board.indexOf(m);
    switch (m.cardId) {
      case 'm03': // 一个友方齿轮族随从（含自身；★圣盾限本族2026-08-29）
      case 'm39': // 一个友方齿轮族随从（含自身；★圣盾限本族2026-08-29，旧版走default漏过滤已补；★V2.7 m13盾卫改装匠已删并，战吼给盾职责归并至本卡）
        return board.filter(function (x) { return x.alive && isTribe(x, 'gear', board); });
      case 'm07': // 另一个友方潮汐随从（★V3 经m56可视为潮汐）
        return board.filter(function (x) { return x.alive && x !== m && isTribe(x, 'tide', board); });
      case 'm28': // 一名友方潮汐族随从（含自身；★平衡调整2026-08-29 由"其他全体潮汐"改为单体指定）
        return board.filter(function (x) { return x.alive && isTribe(x, 'tide', board); });
      case 'm62': // ★V2.8 熔铸巨像：一个其他友方齿轮族随从（吞吃不含自身）
        return board.filter(function (x) { return x.alive && x !== m && isTribe(x, 'gear', board); });
      case 'm65': // ★V2.8 兽骨招魂幡：一个其他带亡语关键词的友方随从
        return board.filter(function (x) {
          return x.alive && x !== m && CARD_BY_ID[x.cardId] &&
            (CARD_BY_ID[x.cardId].kw || []).indexOf('deathrattle') >= 0;
        });
      case 'm69': // ★V2.8 雾瘴海巫：友方潮汐族（含自身；第二目标由引擎按攻击力自动补位）
        return board.filter(function (x) { return x.alive && isTribe(x, 'tide', board); });
      default:
        return board.filter(function (x) { return x.alive; });
    }
  }

  /**
   * 执行战吼。ctx: { target, fx(type,data), discover() }
   * @returns 'discover' 表示需要触发发现流程（由游戏层接管），否则完成
   */
  function runBattlecry(m, board, ctx) {
    ctx = ctx || {};
    var fx = ctx.fx || function () {};
    var star = m.star;

    function buff(t, a, h) {
      t.buffAtk += a; t.buffHp += h;
      fx('buff', { uid: t.uid, atk: a, hp: h });
      notifyBuff(board, t, fx); // ★m51修复2026-08-29：战吼增益也通知涌泉祭司（战斗内由battle.js emit统一驱动，不重复）
    }
    function eachTribe(fn, includeSelf) {
      board.forEach(function (x) {
        if (!x.alive) return;
        if (!includeSelf && x === m) return;
        if (isTribe(x, 'tide', board)) fn(x);
      });
    }

    switch (m.cardId) {
      case 'm02': { // ★V2 发条信使：相邻友方齿轮族各获得圣盾（★圣盾限本族2026-08-29）
        var idx = board.indexOf(m);
        [idx - 1, idx + 1].forEach(function (i) {
          if (i >= 0 && i < board.length && board[i].alive && !board[i].shield
              && isTribe(board[i], 'gear', board)) { // ★圣盾限本族：仅齿轮族
            board[i].shield = true;
            board[i].grantedShield = true; // ★后天赋予标记（三连继承，2026-08-29）
            fx('shieldGain', { uid: board[i].uid });
            onShieldGain(board, board[i], fx);
          }
        });
        break;
      }
      case 'm57': { // ★新增2026-08-29 曲柄装配匠：相邻友方齿轮族+1/+1（补 m02 升 2 级后的 T1 齿轮曲线）
        var idx57 = board.indexOf(m);
        [idx57 - 1, idx57 + 1].forEach(function (i57) {
          if (i57 >= 0 && i57 < board.length && board[i57].alive && isTribe(board[i57], 'gear', board)) {
            buff(board[i57], scaleNum(1, star), scaleNum(1, star));
          }
        });
        break;
      }
      case 'm03': { // ★V2 螺丝骑兵：给友方齿轮族盾；已有盾→+{n}攻（★圣盾限本族2026-08-29）
        if (ctx.target && ctx.target.alive && isTribe(ctx.target, 'gear', board)) { // 执行端防御：目标列表已过滤，此处兜底
          if (!ctx.target.shield) {
            ctx.target.shield = true;
            ctx.target.grantedShield = true; // ★后天赋予标记（三连继承，2026-08-29）
            fx('shieldGain', { uid: ctx.target.uid });
            onShieldGain(board, ctx.target, fx);
          } else {
            var v3 = scaleNum(2, star);
            buff(ctx.target, v3, 0);
          }
        }
        break;
      }
      case 'm07': { // 贝壳歌者：另一个潮汐+n/+2n
        if (ctx.target && ctx.target.alive) buff(ctx.target, scaleNum(1, star), scaleNum(2, star));
        break;
      }
      case 'm39': { // ★V3 注油工兵：给友方齿轮族盾；已有盾→+{n}/+{n}（★V2.7 起为唯一T1给盾战吼——m13已删并，约定同旧m13；★圣盾限本族2026-08-29）
        if (ctx.target && ctx.target.alive && isTribe(ctx.target, 'gear', board)) { // 执行端防御
          if (!ctx.target.shield) {
            ctx.target.shield = true;
            ctx.target.grantedShield = true; // ★后天赋予标记（三连继承，2026-08-29）
            fx('shieldGain', { uid: ctx.target.uid });
            onShieldGain(board, ctx.target, fx);
          } else {
            var v39 = scaleNum(2, star);
            buff(ctx.target, v39, v39);
          }
        }
        break;
      }
      case 'm49': { // ★V3 拾贝寄居蟹：手牌中一个随机随从+{n}/{n}（增益随三合一继承）
        var hand = ctx.hand || [];
        if (hand.length) {
          var pick49 = hand[Math.floor(Math.random() * hand.length)];
          var v49 = scaleNum(1, star);
          pick49.buffAtk += v49; pick49.buffHp += v49;
          fx('buff', { uid: pick49.uid, atk: v49, hp: v49 });
          notifyBuff(board, pick49, fx); // ★m51修复2026-08-29：手牌增益同样通知涌泉祭司
        }
        break;
      }
      case 'm17': { // 泡沫歌姬：所有潮汐+n/+n（含自身）
        eachTribe(function (x) { buff(x, scaleNum(1, star), scaleNum(1, star)); }, true);
        break;
      }
      case 'm27': { // 深潮国王：其他潮汐+n/+n
        eachTribe(function (x) { buff(x, scaleNum(2, star), scaleNum(2, star)); }, false);
        break;
      }
      case 'm28': { // 毒鳍巫医：使一名友方潮汐族随从获得剧毒（★平衡调整2026-08-29 单体指定目标）
        var t28 = ctx.target;
        if (t28 && t28.alive && isTribe(t28, 'tide', board)) {
          t28.venomous = true; t28.grantedVenomous = true;
          fx('venomGain', { uid: t28.uid });
        }
        break;
      }
      case 'm20': // 情报贩子：发现
        return 'discover';
      case 'm69': { // ★V2.8 雾瘴海巫：至多两个友方潮汐获剧毒（目标优先，余位按攻击力自动补齐）
        var granted69 = 0;
        var try69 = function (x) {
          if (granted69 >= 2 || !x || !x.alive || x.venomous || !isTribe(x, 'tide', board)) return;
          x.venomous = true; x.grantedVenomous = true; granted69++;
          fx('venomGain', { uid: x.uid });
          fx('log', { text: '「' + x.name + '」浸染雾瘴，获得剧毒' });
        };
        try69(ctx.target);
        var rest69 = board.filter(function (x) { return x.alive && x !== ctx.target && !x.venomous && isTribe(x, 'tide', board); });
        rest69.sort(function (a, b) { return (b.baseAtk + b.buffAtk) - (a.baseAtk + a.buffAtk); });
        while (granted69 < 2 && rest69.length) try69(rest69.shift());
        break;
      }
      case 'm71': // ★V2.8 云游星商：连续两次发现（游戏层双段接管，与 m20 同管线）
        return 'discover2';
      case 'm72': { // ★V2.8 酒馆医师：英雄回血（ctx.healHero 由游戏层注入，上限=基础血+护甲池）
        var v72 = scaleNum(4, star);
        if (ctx.healHero) {
          ctx.healHero(v72);
          fx('log', { text: '「' + m.name + '」为英雄恢复 ' + v72 + ' 点生命' });
        }
        break;
      }
      case 'm62': { // ★V2.8 熔铸巨像：吞吃（销毁目标不触发亡语/复生；攻血按基底+永久增益转移）
        var t62 = ctx.target;
        if (t62 && t62.alive && t62 !== m && isTribe(t62, 'gear', board)) {
          var idx62 = board.indexOf(t62);
          if (idx62 >= 0) {
            var gA = t62.baseAtk + t62.buffAtk, gH = t62.baseHp + t62.buffHp;
            m.baseAtk += gA; m.baseHp += gH;
            board.splice(idx62, 1);
            fx('log', { text: '「' + m.name + '」吞吃了「' + t62.name + '」（+' + gA + '/+' + gH + '）' });
          }
        }
        break;
      }
      case 'm65': { // ★V2.8 兽骨招魂幡：触发目标亡语（不消耗该随从；级联深度保护）
        var t65 = ctx.target;
        if (t65 && t65.alive && t65 !== m && ctx.summonFn) {
          deathCascade++;
          try {
            runDeathrattle(t65, {
              board: board,
              emit: function (e) { fx(e.t, e); },
              summonFn: ctx.summonFn,
              applyHitFn: function () {}
            });
          } finally { deathCascade--; }
        }
        break;
      }
    }
    return null;
  }

  /* ============ 打出触发（招募阶段）：潮汐女王 m36 / 潮池枪手 m08 ============ */

  function onPlayTrigger(board, played, fx) {
    fx = fx || function () {};
    board.forEach(function (q) {
      if (!q.alive) return;
      // ★V2 潮池枪手 m08：每打出1张潮汐→+{n}攻
      // ★修复 2026-09-04：判族改走 isTribe 统一口径——m56 酒馆老板「全族」光环下
      //   打出任意随从也应触发（原写法 played.tribe==='tide' 漏判，与 m36 口径不一致）
      if (q.cardId === 'm08' && q !== played && isTribe(played, 'tide', board)) {
        var v8 = scaleNum(1, q.star);
        q.buffAtk += v8;
        fx('buff', { uid: q.uid, atk: v8, hp: 0 });
        notifyBuff(board, q, fx); // ★m51修复2026-08-29：招募阶段增益也通知涌泉祭司
      }
      // ★V3 见习佣兵 m53：每打出1张随从（不限种族）→自身+{n}攻
      if (q.cardId === 'm53' && q !== played) {
        var v53 = scaleNum(1, q.star);
        q.buffAtk += v53;
        fx('buff', { uid: q.uid, atk: v53, hp: 0 });
        notifyBuff(board, q, fx); // ★m51修复2026-08-29
      }
      // 潮汐女王 m36：每打出1张潮汐族随从→全队潮汐+{n}/+{n}
      // ★平衡调整2026-08-29（用户拍板）：回归潮汐限定触发（替代 V3 BUG-3 期间的"任意随从"行为）
      if (q.cardId === 'm36' && isTribe(played, 'tide', board)) {
        board.forEach(function (x) {
          if (!x.alive || !isTribe(x, 'tide', board)) return;
          x.buffAtk += scaleNum(1, q.star);
          x.buffHp += scaleNum(1, q.star);
          fx('buff', { uid: x.uid, atk: scaleNum(1, q.star), hp: scaleNum(1, q.star) });
          notifyBuff(board, x, fx); // ★m51修复2026-08-29（x===自身时 onBuffGained 自行排除）
        });
      }
    });
  }

  /* ============ 战斗内触发 ============ */

  /** 友方获得圣盾后：偏转机兵 m21 ★V2 → +1/+1；
   *  ★萨必调整2026-09-05：双联磨轮 m42 自身获得圣盾 → 永久+1/+1（perm 跨战斗回写） */
  function onShieldGain(board, gained, emit) {
    board.forEach(function (x) {
      if (!x.alive) return;
      if (x.cardId === 'm21') {
        if (!gainLeft()) return; // ★V3 全局属性提升事件上限
        spendGain();
        var v = scaleNum(1, x.star);
        x.buffAtk += v; x.buffHp += v;
        emit({ t: 'buff', uid: x.uid, atk: v, hp: v });
        emit({ t: 'log', text: '「' + x.name + '」因圣盾获得 +' + v + '/+' + v });
      }
      if (x.cardId === 'm42' && x === gained) { // 双联磨轮：自身获得圣盾→永久+1/+1
        if (!gainLeft()) return;
        spendGain();
        var v42g = scaleNum(1, x.star);
        x.buffAtk += v42g; x.buffHp += v42g;
        x.permAtk = (x.permAtk || 0) + v42g;
        x.permHp = (x.permHp || 0) + v42g;
        emit({ t: 'buff', uid: x.uid, atk: v42g, hp: v42g });
        emit({ t: 'log', text: '「' + x.name + '」挂载圣盾，永久+' + v42g + '/+' + v42g });
      }
    });
  }

  /** 友方失去圣盾后：余晖收藏家 m32 ★V2 → +1/+1；自身盾破触发：m11/m22/m30；★V3 余烬锻炉 m43 → 回盾 */
  function onShieldLost(board, lost, emit) {
    board.forEach(function (x) {
      if (!x.alive) return;
      // m32 余晖收藏家：任意友方失盾→+1/+1
      if (x.cardId === 'm32') {
        if (!gainLeft()) return;
        spendGain();
        var v32 = scaleNum(1, x.star);
        x.buffAtk += v32; x.buffHp += v32;
        // ★平衡调整2026-08-29（用户拍板）：改为永久+1/+1 —— perm 累计随战斗结算回写
        x.permAtk = (x.permAtk || 0) + v32;
        x.permHp = (x.permHp || 0) + v32;
        emit({ t: 'buff', uid: x.uid, atk: v32, hp: v32 });
        emit({ t: 'log', text: '「' + x.name + '」因圣盾破碎永久获得 +' + v32 + '/+' + v32 });
      }
      // ★V3 m43 余烬锻炉：任意友方失盾→使另一个随机未持盾友方齿轮族获得圣盾（只给未持盾者→无自嵌套死循环；★圣盾限本族2026-08-29）
      //   ★V2.1 死循环防护（用户 19:36）：每回合限 2 次、2 星 4 次（_m43n 每回合与 m51 同点清零，
      //   防止"破盾-回盾"永动拖满 60 出手上限，战斗体验冗长）
      // ★V2.8 m74 不灭引擎：其他齿轮的盾被击破→该随从获得复生（战斗纵深；复生由 battle.js 按实例标志判定）
      if (x.cardId === 'm74' && x.alive && x !== lost && lost.alive &&
          !lost.reborn && isTribe(lost, 'gear', board) && gainLeft()) {
        lost.reborn = true;
        spendGain();
        emit({ t: 'log', text: '「' + x.name + '」的余律：「' + lost.name + '」获得复生' });
      }
      if (x.cardId === 'm43' && (x._m43n || 0) < (x.star >= 2 ? 4 : 2) && gainLeft()) {
        var forgeCands = board.filter(function (y) { return y.alive && !y.shield && y !== x && isTribe(y, 'gear', board); });
        if (forgeCands.length) {
          x._m43n = (x._m43n || 0) + 1;
          spendGain();
          var forgePick = forgeCands[Math.floor(Math.random() * forgeCands.length)];
          forgePick.shield = true;
          forgePick.grantedShield = true; // ★后天赋予标记（三连继承，2026-08-29）
          emit({ t: 'shieldGain', uid: forgePick.uid });
          emit({ t: 'log', text: '「' + x.name + '」的余烬重燃：「' + forgePick.name + '」获得圣盾' });
          onShieldGain(board, forgePick, emit);
        }
      }
      // 自身盾破触发
      if (x === lost) {
        if (x.cardId === 'm11') { // 装甲货运兽：自身盾破→+2/+2
          if (gainLeft()) {
            spendGain();
            var v11 = scaleNum(2, x.star);
            x.buffAtk += v11; x.buffHp += v11;
            emit({ t: 'buff', uid: x.uid, atk: v11, hp: v11 });
            emit({ t: 'log', text: '「' + x.name + '」盾破后获得 +' + v11 + '/+' + v11 });
          }
        }
        if (x.cardId === 'm22') { // 铆钉巨盾：自身盾破→随机友方齿轮族获盾（★圣盾限本族2026-08-29）
          var others = board.filter(function (y) { return y.alive && y !== x && !y.shield && isTribe(y, 'gear', board); });
          if (others.length && gainLeft()) {
            spendGain();
            var pick = others[Math.floor(Math.random() * others.length)];
            pick.shield = true;
            pick.grantedShield = true; // ★后天赋予标记（三连继承，2026-08-29）
            emit({ t: 'shieldGain', uid: pick.uid });
            emit({ t: 'log', text: '「' + x.name + '」盾破碎后传递圣盾给「' + pick.name + '」' });
            onShieldGain(board, pick, emit); // 连锁触发偏转机兵
          }
        }
        if (x.cardId === 'm30') { // ★萨必调整2026-09-05：竞技场冠军 自身盾破→永久+1/+2（原相邻友方+2攻）
          if (gainLeft()) {
            spendGain();
            var a30 = scaleNum(1, x.star), h30 = scaleNum(2, x.star);
            x.buffAtk += a30; x.buffHp += h30;
            x.permAtk = (x.permAtk || 0) + a30;
            x.permHp = (x.permHp || 0) + h30;
            emit({ t: 'buff', uid: x.uid, atk: a30, hp: h30 });
            emit({ t: 'log', text: '「' + x.name + '」盾破后永久获得 +' + a30 + '/+' + h30 });
          }
        }
      }
    });
  }

  /** ★V3 击破圣盾者触发：双联磨轮 m42 → 每击破一盾永久+1/+1（由 battle.js applyHit 调用）
   *  ★萨必调整2026-09-05（用户拍板）：由永久+2/+1 改为永久+1/+1，并与「获得圣盾」并列为双触发维度。
   *  战斗克隆上累计 permAtk/permHp，战斗结算后由 game.js writebackPerm 写回真实随从，跨战斗保留。 */
  function onShieldBrokenBy(board, breaker, emit) {
    if (!breaker || !breaker.alive || breaker.cardId !== 'm42') return;
    if (!gainLeft()) return;
    spendGain();
    var a42 = scaleNum(1, breaker.star), h42 = scaleNum(1, breaker.star);
    breaker.buffAtk += a42; breaker.buffHp += h42;
    breaker.permAtk = (breaker.permAtk || 0) + a42;
    breaker.permHp = (breaker.permHp || 0) + h42;
    emit({ t: 'buff', uid: breaker.uid, atk: a42, hp: h42 });
    emit({ t: 'log', text: '「' + breaker.name + '」碾碎圣盾，永久+' + a42 + '/+' + h42 });
  }

  /** ★V3 召唤触发：掘尸鬣狗 m47 → 每有随从被召唤到己方场上（含衍生物）→自身+{n}/{n} */
  function onSummon(board, summoned, emit) {
    board.forEach(function (x) {
      if (!x.alive) return;
      if (x.cardId === 'm47') { // 掘尸鬣狗：召唤响应+{n}/{n}
        if (!gainLeft()) return;
        spendGain();
        var v47 = scaleNum(1, x.star);
        x.buffAtk += v47; x.buffHp += v47;
        emit({ t: 'buff', uid: x.uid, atk: v47, hp: v47 });
        emit({ t: 'log', text: '「' + x.name + '」嗅到新的尸骸，+' + v47 + '/+' + v47 });
      }
      if (x.cardId === 'm61') { // ★V2.8 暖巢羽雀：召唤响应+{n}生命（仅血）
        if (!gainLeft()) return;
        spendGain();
        var v61 = scaleNum(2, x.star); // ★V2.9.5 m61 T2定档基数2（v47保持1不动）
        x.buffHp += v61;
        emit({ t: 'buff', uid: x.uid, atk: 0, hp: v61 });
        emit({ t: 'log', text: '「' + x.name + '」的暖巢庇佑：+' + v61 + ' 生命' });
      }
    });
  }

  /** ★V3 元成长触发：涌泉祭司 m51 → 另一个友方获得属性提升后自身+{n}/{n}（每回合最多5次） */
  function onBuffGained(board, target, emit) {
    board.forEach(function (x) {
      if (!x.alive || x.cardId !== 'm51') return;
      if (x === target) return;            // 仅响应"另一个"友方随从
      if ((x._m51n || 0) >= 5) return;     // 每回合最多5次（卡面文本约定）
      if (!gainLeft()) return;             // 全局属性提升事件上限
      x._m51n = (x._m51n || 0) + 1;
      spendGain();
      var v51 = scaleNum(1, x.star);
      // ★平衡调整2026-08-29（用户拍板）：+1/+1 → 仅+1攻击
      x.buffAtk += v51;
      emit({ t: 'buff', uid: x.uid, atk: v51, hp: 0 });
      emit({ t: 'log', text: '「' + x.name + '」汲取增益之力，攻击+' + v51 });
    });
  }

  /** ★m51修复2026-08-29（用户反馈实现疑似有bug）：招募阶段统一通知入口。
   *  根因：onBuffGained 原本只由 battle.js 的 emit('buff') 驱动（战斗内），
   *        招募阶段的战吼/打出触发/卖出增益全部不通知 m51 → 卡面"每当"语义不完整。
   *  修复：招募阶段 buff 落地后调用本函数；战斗内路径仍走 emit（避免双触发）。
   *  级联：m51 自身的提升不再二次通知（与战斗内 target 自排除口径一致），无自激励循环。 */
  function notifyBuff(board, target, fx) {
    onBuffGained(board, target, function (e) {
      if (e.t === 'buff' && fx) fx('buff', { uid: e.uid, atk: e.atk, hp: e.hp });
    });
  }

  /** ★V3 卖出触发（招募阶段）：铁算盘账房 m55 → 每卖出一个随从→两个随机友方+2/+1
   *  ★平衡调整2026-08-29（用户拍板）：一个+1/+1 → 两个随机友方各+2/+1（同 m40 抽取口径：不重复） */
  function onSold(board, fx) {
    fx = fx || function () {};
    board.forEach(function (x) {
      if (!x.alive || x.cardId !== 'm55') return;
      if (!gainLeft()) return;
      spendGain();
      var cands = board.filter(function (y) { return y.alive; });
      for (var i55 = 0; i55 < 2 && cands.length; i55++) {
        var j55 = Math.floor(Math.random() * cands.length);
        var pick55 = cands.splice(j55, 1)[0];
        var a55 = scaleNum(2, x.star), h55 = scaleNum(1, x.star);
        pick55.buffAtk += a55; pick55.buffHp += h55;
        fx('buff', { uid: pick55.uid, atk: a55, hp: h55 });
        notifyBuff(board, pick55, fx); // ★m51修复2026-08-29
      }
    });
  }

  /** ★V2 复生触发：绷带傀儡 m10（随机友方+1/+1）/ 永恒角斗士 m38（自身+3/+3） */
  function onReborn(board, reborn, emit) {
    if (reborn.cardId === 'm10') {
      var targets = board.filter(function (x) { return x.alive && x !== reborn; });
      if (targets.length && gainLeft()) {
        spendGain();
        var pick = targets[Math.floor(Math.random() * targets.length)];
        var v10 = scaleNum(1, reborn.star);
        pick.buffAtk += v10; pick.buffHp += v10;
        emit({ t: 'buff', uid: pick.uid, atk: v10, hp: v10 });
        emit({ t: 'log', text: '「' + reborn.name + '」复生后使「' + pick.name + '」+' + v10 + '/+' + v10 });
      }
    }
    if (reborn.cardId === 'm38' && gainLeft()) {
      spendGain();
      var v38 = scaleNum(3, reborn.star);
      reborn.buffAtk += v38; reborn.buffHp += v38;
      emit({ t: 'buff', uid: reborn.uid, atk: v38, hp: v38 });
      emit({ t: 'log', text: '「' + reborn.name + '」复生后获得 +' + v38 + '/+' + v38 });
    }
  }

  /** ★V2 受击存活触发：蜕壳巨蟹 m18（随机潮汐+1/+1） */
  function onSurviveDamage(board, m, emit) {
    if (!m.alive || m.cardId !== 'm18') return;
    var tideMins = board.filter(function (x) { return x.alive && isTribe(x, 'tide', board); });
    if (tideMins.length && gainLeft()) {
      spendGain();
      var pick = tideMins[Math.floor(Math.random() * tideMins.length)];
      var v18 = scaleNum(1, m.star);
      pick.buffAtk += v18; pick.buffHp += v18;
      emit({ t: 'buff', uid: pick.uid, atk: v18, hp: v18 });
      emit({ t: 'log', text: '「' + m.name + '」受击存活后使「' + pick.name + '」+' + v18 + '/+' + v18 });
    }
  }

  /** 友方死亡后：拾骨兀鹫 m25 */
  function onFriendlyDeath(board, dead, emit) {
    board.forEach(function (x) {
      if (!x.alive || x.cardId !== 'm25') return;
      if (!gainLeft()) return;
      spendGain();
      var v = scaleNum(1, x.star);
      x.buffAtk += v; x.buffHp += v;
      emit({ t: 'buff', uid: x.uid, atk: v, hp: v });
      emit({ t: 'log', text: '「' + x.name + '」拾骨获得 +' + v + '/+' + v });
    });
  }

  /** 轮回萨满 m34：亡语额外触发次数（按存活萨满星级求和） */
  function deathrattleExtra(board) {
    var extra = 0;
    board.forEach(function (x) {
      if (x.alive && x.cardId === 'm34') extra += triggerExtra(x.star);
    });
    return extra;
  }

  /* ============ 亡语（战斗内） ============ */

  /**
   * 执行一次亡语。sim: { board(己方), enemy(敌方), emit, summonFn(cardId, star) }
   * summonFn 由战斗引擎提供，负责插入出手序列并产生 summon 事件。
   */
  function runDeathrattle(m, sim) {
    var star = m.star;
    var emit = sim.emit;
    switch (m.cardId) {
      case 'm04': // 柴窝母狼：召唤幼狼
        sim.summonFn('t01', star);
        emit({ t: 'log', text: '亡语：召唤一只幼狼' });
        break;
      case 'm05': // ★V2 浆果刺猬：召唤小刺猬
        sim.summonFn('t05', star);
        emit({ t: 'log', text: '亡语：召唤一只小刺猬' });
        break;
      case 'm06': // 苔穴土拨鼠：召唤两只土拨鼠
        sim.summonFn('t02', star); sim.summonFn('t02', star);
        emit({ t: 'log', text: '亡语：召唤两只土拨鼠' });
        break;
      case 'm14': { // ★V2 獠牙猎首者：友方荒野+2/+2
        var wilds = sim.board.filter(function (x) { return x.alive && isTribe(x, 'wild', sim.board); });
        if (wilds.length && gainLeft()) {
          spendGain();
          var pick14 = wilds[Math.floor(Math.random() * wilds.length)];
          var v14 = scaleNum(2, star);
          pick14.buffAtk += v14; pick14.buffHp += v14;
          emit({ t: 'buff', uid: pick14.uid, atk: v14, hp: v14 });
          emit({ t: 'log', text: '亡语：使「' + pick14.name + '」+' + v14 + '/+' + v14 });
        }
        break;
      }
      case 'm15': // 育巢蜘蛛：召唤两只织网蛛
        sim.summonFn('t03', star); sim.summonFn('t03', star);
        emit({ t: 'log', text: '亡语：召唤两只织网蛛' });
        break;
      case 'm24': { // 葬火狼灵：其他荒野+{n}/{n}
        var v24 = scaleNum(2, star);
        sim.board.forEach(function (x) {
          if (x.alive && x !== m && isTribe(x, 'wild', sim.board) && gainLeft()) {
            spendGain();
            x.buffAtk += v24; x.buffHp += v24;
            emit({ t: 'buff', uid: x.uid, atk: v24, hp: v24 });
          }
        });
        emit({ t: 'log', text: '亡语：其他荒野随从+' + v24 + '/+' + v24 });
        break;
      }
      case 'm33': // 森林之王·苍牙：召唤两只巨狼
        sim.summonFn('t04', star); sim.summonFn('t04', star);
        emit({ t: 'log', text: '亡语：召唤两只巨狼' });
        break;
      /* ===== ★V3 新增亡语 ===== */
      case 'm40': { // 殉爆机俑：两个随机友方齿轮族获得圣盾（已有盾→+{n}/{n}补正，同赋予型约定；★圣盾限本族2026-08-29）
        var cands40 = sim.board.filter(function (x) { return x.alive && isTribe(x, 'gear', sim.board); });
        for (var c40 = 0; c40 < 2 && cands40.length; c40++) {
          var j40 = Math.floor(Math.random() * cands40.length);
          var pick40 = cands40.splice(j40, 1)[0];
          if (pick40.shield) {
            var b40 = grantBonus(star);
            if (b40[0] && gainLeft()) {
              spendGain();
              pick40.buffAtk += b40[0]; pick40.buffHp += b40[1];
              emit({ t: 'buff', uid: pick40.uid, atk: b40[0], hp: b40[1] });
            }
          } else {
            pick40.shield = true;
            pick40.grantedShield = true; // ★后天赋予标记（三连继承，2026-08-29）
            emit({ t: 'shieldGain', uid: pick40.uid });
            emit({ t: 'log', text: '「' + pick40.name + '」获得殉爆圣盾' });
            onShieldGain(sim.board, pick40, emit);
          }
        }
        break;
      }
      case 'm58': { // ★V2.2 链轮卫兵：一个随机友方齿轮族获得圣盾（已有盾→+{n}/{n}补正，同 m40 赋予型约定；圣盾限本族同口径）
        var cands58 = sim.board.filter(function (x) { return x.alive && isTribe(x, 'gear', sim.board); });
        if (cands58.length) {
          var pick58 = cands58[Math.floor(Math.random() * cands58.length)];
          if (pick58.shield) {
            var b58 = grantBonus(star);
            if (b58[0] && gainLeft()) {
              spendGain();
              pick58.buffAtk += b58[0]; pick58.buffHp += b58[1];
              emit({ t: 'buff', uid: pick58.uid, atk: b58[0], hp: b58[1] });
            }
          } else {
            pick58.shield = true;
            pick58.grantedShield = true; // 后天赋予标记（三连继承，同 m40 口径）
            emit({ t: 'shieldGain', uid: pick58.uid });
            emit({ t: 'log', text: '「' + pick58.name + '」接续了链轮卫兵的圣盾' });
            onShieldGain(sim.board, pick58, emit);
          }
        }
        break;
      }
      case 'm45': { // 荆棘藤蔓：其他荒野+{n}攻击
        var v45 = scaleNum(2, star);
        sim.board.forEach(function (x) {
          if (x.alive && x !== m && isTribe(x, 'wild', sim.board) && gainLeft()) {
            spendGain();
            x.buffAtk += v45;
            emit({ t: 'buff', uid: x.uid, atk: v45, hp: 0 });
          }
        });
        emit({ t: 'log', text: '亡语：荆棘缠绕，其他荒野随从攻击+' + v45 });
        break;
      }
      case 'm46': // 腐生双生鹿：召唤腐芽鹿（复生使亡语触发两次）
        sim.summonFn('t06', star);
        emit({ t: 'log', text: '亡语：召唤一只腐芽鹿' });
        break;
      case 'm64': { // ★V2.8 殉爆方阵：所有友方齿轮获得圣盾（已持盾者跳过，文本忠实）
        sim.board.forEach(function (x) {
          if (x.alive && isTribe(x, 'gear', sim.board) && !x.shield) {
            x.shield = true; x.grantedShield = true;
            emit({ t: 'shieldGain', uid: x.uid });
          }
        });
        emit({ t: 'log', text: '亡语：殉爆冲击为齿轮族点燃圣盾' });
        break;
      }
      case 'm66': // ★V2.8 双生古树：召唤两条树苗（复生使亡语触发两次）
        sim.summonFn('t08', star); sim.summonFn('t08', star);
        emit({ t: 'log', text: '亡语：召唤两条树苗' });
        break;
      case 'm67': { // ★V2.8 裂风隼：随机友方荒野+{n}攻（仅攻）
        var wilds67 = sim.board.filter(function (x) { return x.alive && x !== m && isTribe(x, 'wild', sim.board); });
        if (wilds67.length && gainLeft()) {
          spendGain();
          var pick67 = wilds67[Math.floor(Math.random() * wilds67.length)];
          var v67 = scaleNum(2, star);
          pick67.buffAtk += v67;
          emit({ t: 'buff', uid: pick67.uid, atk: v67, hp: 0 });
          emit({ t: 'log', text: '「裂风隼」的疾风赋予「' + pick67.name + '」+' + v67 + ' 攻击' });
        }
        break;
      }
      case 'm50': { // 毒棘河豚：随机友方潮汐获得剧毒{bonus}
        // ★萨必调整2026-09-05：六星精简，亡语 case m77（林海之心）/m75（万灵终葬）随卡移除
        var tides50 = sim.board.filter(function (x) { return x.alive && isTribe(x, 'tide', sim.board); });
        if (tides50.length) {
          var pick50 = tides50[Math.floor(Math.random() * tides50.length)];
          pick50.venomous = true;
          pick50.grantedVenomous = true;
          emit({ t: 'venomGain', uid: pick50.uid });
          emit({ t: 'log', text: '「' + pick50.name + '」继承了河豚的剧毒' });
          var b50 = grantBonus(star);
          if (b50[0] && gainLeft()) {
            spendGain();
            pick50.buffAtk += b50[0]; pick50.buffHp += b50[1];
            emit({ t: 'buff', uid: pick50.uid, atk: b50[0], hp: b50[1] });
          }
        }
        break;
      }
    }
  }

  /* ============ 战斗开始时效果 ============ */

  /** sim: { a, b, emit, heroA, heroB, applyHitFn(src, tgt, dmg) } */
  function runStartEffects(sim) {
    var sides = sim.order; // ['a','b'] 先手侧优先
    for (var s = 0; s < sides.length; s++) {
      var side = sides[s];
      var mine = side === 'a' ? sim.a : sim.b;
      var theirs = side === 'a' ? sim.b : sim.a;
      // 按站位从左到右触发
      for (var i = 0; i < mine.length; i++) {
        var m = mine[i];
        if (!m.alive) continue;
        if (m.cardId === 'm31') { // ★V2 圣徽大法官 → ★V20 平衡改版：随机使三个齿轮族友方获圣盾，已有盾者改为+3/+3
          // （★圣盾限本族2026-08-29：非齿轮族不受影响，经m56可视为齿轮；候选≤3时全选=确定性）
          var v31 = scaleNum(3, m.star);
          var pool31 = [];
          mine.forEach(function (x) {
            if (x.alive && isTribe(x, 'gear', mine)) pool31.push(x); // 齿轮族候选（含自身）
          });
          for (var p31 = pool31.length - 1; p31 > 0; p31--) { // 部分洗牌
            var q31 = Math.floor(Math.random() * (p31 + 1));
            var tmp31 = pool31[p31]; pool31[p31] = pool31[q31]; pool31[q31] = tmp31;
          }
          pool31.slice(0, 3).forEach(function (x) {
            if (x.shield) {
              // 已有盾 → +3/+3
              x.buffAtk += v31; x.buffHp += v31;
              sim.emit({ t: 'buff', side: side, uid: x.uid, atk: v31, hp: v31 });
            } else {
              x.shield = true;
              x.grantedShield = true; // ★后天赋予标记（三连继承，2026-08-29）
              sim.emit({ t: 'shieldGain', side: side, uid: x.uid });
              onShieldGain(mine, x, function (e) { e.side = side; sim.emit(e); });
            }
          });
          sim.emit({ t: 'log', text: '「圣徽大法官」的审判：随机三个齿轮族随从获得圣盾（已有盾者+' + v31 + '/+' + v31 + '）' });
        } else if (m.cardId === 'm37') { // ★V2 落雷元素：对2敌4伤，击杀→相邻再2伤
          var dmg = scaleNum(4, m.star);
          var chainDmg = scaleNum(2, m.star);
          var targets = aliveMinions(theirs);
          var enemyBoard = theirs;
          for (var k = 0; k < 2 && targets.length; k++) {
            var pickIdx = Math.floor(Math.random() * targets.length);
            var tgt = targets.splice(pickIdx, 1)[0];
            sim.emit({ t: 'bolt', side: side === 'a' ? 'b' : 'a', uid: tgt.uid });
            sim.emit({ t: 'log', text: '「落雷元素」轰击「' + tgt.name + '」造成 ' + dmg + ' 点伤害' });
            var wasAlive = tgt.alive;
            sim.applyHitFn(m, tgt, dmg, side === 'a' ? 'b' : 'a');
            // ★V8 修复击杀连锁判定：applyHit 只累计 damage 不置 alive=false
            //   （死亡统一由 battle.collectDead 结算），旧判定 !tgt.alive 永远不成立，
            //   连锁闪电从未触发（用户实测反馈）。改为按当前剩余血量判定；
            //   圣盾挡下落雷（applyHit 早退）不视为击杀 → 无连锁，符合规则。
            // ★V3 审计报告 BUG-2 修复：剩余血量改用 effMaxHp（计入光环生命），
            //   旧判定 tgt.baseHp + tgt.buffHp 忽略了 m16 嚎月头狼等 HP 光环，
            //   导致"光环救场"的随从被误判击杀而触发连锁闪电。
            var killed = wasAlive && !tgt.shield &&
              (tgt.pendingDeath || (effMaxHp(tgt, theirs) - tgt.damage <= 0));
            if (killed) {
              var tidx = enemyBoard.indexOf(tgt);
              [tidx - 1, tidx + 1].forEach(function (j) {
                if (j >= 0 && j < enemyBoard.length && enemyBoard[j].alive) {
                  var nb = enemyBoard[j];
                  sim.emit({ t: 'bolt', side: side === 'a' ? 'b' : 'a', uid: nb.uid });
                  sim.emit({ t: 'log', text: '连锁闪电击中「' + nb.name + '」造成 ' + chainDmg + ' 点伤害' });
                  sim.applyHitFn(m, nb, chainDmg, side === 'a' ? 'b' : 'a');
                }
              });
            }
          }
        } else if (m.cardId === 'm52') { // ★V3 → ★V20 平衡改版：所有潮汐族随从+3/+3
          // （原"每有一个其他潮汐→全体+n/+n"为二次方成长，属性膨胀超模，按用户口径替换为定值）
          var v52 = scaleNum(3, m.star);
          mine.forEach(function (x) {
            if (!x.alive || !isTribe(x, 'tide', mine)) return;
            if (!gainLeft()) return;
            spendGain();
            x.buffAtk += v52; x.buffHp += v52;
            sim.emit({ t: 'buff', side: side, uid: x.uid, atk: v52, hp: v52 });
          });
          sim.emit({ t: 'log', text: '「海渊唤潮者」掀起怒潮：所有潮汐随从+' + v52 + '/+' + v52 });
        } else if (m.cardId === 'm59') { // ★V2.7 蓄压撞锤：若场上有「其他」带圣盾的友方随从 → 自身+{n}/+{n}（战开一次性，受 gainLeft 预算约束）
          var hasShieldMate = false;
          for (var q59 = 0; q59 < mine.length; q59++) {
            var y59 = mine[q59];
            if (y59 !== m && y59.alive && y59.shield) { hasShieldMate = true; break; }
          }
          if (hasShieldMate && gainLeft()) {
            var v59 = scaleNum(2, m.star);
            spendGain();
            m.buffAtk += v59; m.buffHp += v59;
            sim.emit({ t: 'buff', side: side, uid: m.uid, atk: v59, hp: v59 });
            sim.emit({ t: 'log', text: '「蓄压撞锤」吸收盾能：+' + v59 + '/+' + v59 });
          }
        }
        // ★萨必调整2026-09-05：六星精简，战开 case m73（圣械方舟）/m80（天罚巨像）随卡移除
      }
    }
  }

  function aliveMinions(board) {
    return board.filter(function (x) { return x.alive; });
  }

  return {
    auraAtkFor: auraAtkFor, auraHpFor: auraHpFor,
    effAtk: effAtk, effMaxHp: effMaxHp, effHp: effHp,
    effTribe: effTribe, isTribe: isTribe,
    resetGains: resetGains, gainsUsed: gainsUsed, GAIN_CAP: GAIN_CAP,
    battlecryNeedsTarget: battlecryNeedsTarget, battlecryTargets: battlecryTargets,
    runBattlecry: runBattlecry, onPlayTrigger: onPlayTrigger,
    onShieldGain: onShieldGain, onShieldLost: onShieldLost, onFriendlyDeath: onFriendlyDeath,
    onReborn: onReborn, onSurviveDamage: onSurviveDamage,
    onShieldBrokenBy: onShieldBrokenBy, onSummon: onSummon,
    onBuffGained: onBuffGained, onSold: onSold,
    deathrattleExtra: deathrattleExtra, runDeathrattle: runDeathrattle,
    runStartEffects: runStartEffects, aliveMinions: aliveMinions
  };
})();
