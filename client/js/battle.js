/* =========================================================================
 * 《云屿酒馆》 Web 版 - battle.js
 * 战斗引擎（文档第8章·四条铁律 + 调研报告 8.2 结算顺序）：
 *   铁律1 先手：随从多的一方先出手，相等随机；
 *   铁律2 顺序：双方交替；各方从最左存活随从开始左→右轮转循环，
 *              亡语新召唤按出生位置加入出手序列；
 *   铁律3 目标：随机目标，嘲讽必须先被打（多嘲讽随机其一）；
 *   铁律4 上限：单场最多60次出手，超时按存活数判定，仍相等为平局。
 * 结算顺序：圣盾先于剧毒（盾可挡毒）→ 双方同时互造成=自身攻击力的伤害 →
 *          攻击方剧毒致目标死 → 死亡结算（亡语/复生/拾骨）→ 光环回落级联。
 * ========================================================================= */

'use strict';

var Battle = (function () {

  function cloneForBattle(m, side) {
    return {
      uid: m.uid, cardId: m.cardId, name: m.name, tier: m.tier, star: m.star,
      tribe: m.tribe, effectKind: m.effectKind,
      baseAtk: m.baseAtk, baseHp: m.baseHp, buffAtk: m.buffAtk, buffHp: m.buffHp,
      damage: 0,
      shield: !!m.shield, taunt: !!m.taunt, venomous: !!m.venomous,
      windfury: !!m.windfury, cleave: !!m.cleave, reborn: !!m.reborn,
      token: !!m.token, // 衍生物标记（克隆漏字段会致token判定失效；★2026-09-05 m76 已移出卡池，字段保留）
      grantedVenomous: !!m.grantedVenomous,
      alive: true, revived: false, pendingDeath: false,
      _side: side
    };
  }

  /** 供 UI 渲染的快照（含光环后的有效属性） */
  function snap(m, board, heroId) {
    return {
      uid: m.uid, cardId: m.cardId, name: m.name, tier: m.tier, star: m.star,
      tribe: m.tribe,
      atk: Effects.effAtk(m, board, heroId),
      hp: Math.max(0, Effects.effHp(m, board, heroId)),
      maxHp: Effects.effMaxHp(m, board),
      shield: m.shield, taunt: m.taunt, venomous: m.venomous,
      windfury: m.windfury, cleave: m.cleave, reborn: m.reborn,
      buffAtk: m.buffAtk, buffHp: m.buffHp
    };
  }

  /**
   * 模拟一场战斗。
   * @param boardA 玩家方随从（原始数组，不修改）
   * @param boardB 敌方随从
   * @param opts {heroA, heroB, heroHpA, heroHpB} 双方英雄id与当前血量（AI 无英雄传 null；h10 背水判定用 hp）
   * @returns {events, winner, attacks, survivorsA, survivorsB, boards}
   */
  function simulate(boardA, boardB, opts) {
    opts = opts || {};
    var heroA = opts.heroA || null, heroB = opts.heroB || null;
    var heroHpA = opts.heroHpA, heroHpB = opts.heroHpB;
    var A = boardA.map(function (m) { return cloneForBattle(m, 'a'); });
    var B = boardB.map(function (m) { return cloneForBattle(m, 'b'); });
    var ev = [];

    // ★V3 每场战斗独立的属性提升事件预算 + 枯木长老死亡计数（m48 动态光环数据源）
    Effects.resetGains();
    A._deaths = 0; B._deaths = 0;
    A._heroId = heroA; B._heroId = heroB; // ★V17 英雄上下文挂载（h07 图腾行者光环判定；真实板由 game.js/ai.js 同款注入）

    function emit(e) {
      ev.push(e);
      // ★V3 涌泉祭司 m51：监听本方"属性提升"事件（另一友方获得提升→自身成长，5次/回合+全局200次双上限）
      if (e.t === 'buff' && e.side) {
        var gb = boardOf(e.side);
        var gt = null;
        for (var gi = 0; gi < gb.length; gi++) { if (gb[gi].uid === e.uid) { gt = gb[gi]; break; } }
        if (gt) {
          Effects.onBuffGained(gb, gt, function (e2) { if (!e2.side) e2.side = e.side; emit(e2); });
        }
      }
    }
    function boardOf(side) { return side === 'a' ? A : B; }
    function heroOf(side) { return side === 'a' ? heroA : heroB; }
    function countAlive(board) {
      var n = 0; for (var i = 0; i < board.length; i++) if (board[i].alive) n++;
      return n;
    }

    emit({ t: 'init', a: A.map(function (m) { return snap(m, A, heroA); }), b: B.map(function (m) { return snap(m, B, heroB); }) });

    /* ---------- 单次伤害结算（圣盾先于剧毒） ---------- */
    function applyHit(src, tgt, dmg, tgtSide) {
      var board = boardOf(tgtSide);
      if (tgt.shield) {
        tgt.shield = false;
        emit({ t: 'shieldPop', side: tgtSide, uid: tgt.uid });
        Effects.onShieldLost(board, tgt, function (e) { e.side = tgtSide; emit(e); });
        // ★V3 m42 双联磨轮：击破圣盾者获得攻击（src 位于另一方阵地）
        var breakerSide = other(tgtSide);
        Effects.onShieldBrokenBy(boardOf(breakerSide), src, function (e) { if (!e.side) e.side = breakerSide; emit(e); });
        return;
      }
      tgt.damage += dmg;
      emit({ t: 'dmg', side: tgtSide, uid: tgt.uid, amount: dmg, hp: Math.max(0, Effects.effHp(tgt, board, heroOf(tgtSide))) });
      if (src.venomous) {
        tgt.pendingDeath = true;
        emit({ t: 'poison', side: tgtSide, uid: tgt.uid });
        emit({ t: 'log', text: '「' + tgt.name + '」被剧毒侵蚀！' });
      }
      // ★V2 受击存活触发：蜕壳巨蟹等
      if (tgt.alive && !tgt.pendingDeath && Effects.effHp(tgt, board, heroOf(tgtSide)) > 0) {
        Effects.onSurviveDamage(board, tgt, function (e) { e.side = tgtSide; emit(e); });
      }
    }

    /* ---------- 死亡结算（含级联） ---------- */
    function collectDead() {
      var dead = [];
      var i, m;
      for (i = 0; i < A.length; i++) {
        m = A[i];
        if (m.alive && (m.pendingDeath || Effects.effHp(m, A, heroA) <= 0)) dead.push(m);
      }
      for (i = 0; i < B.length; i++) {
        m = B[i];
        if (m.alive && (m.pendingDeath || Effects.effHp(m, B, heroB) <= 0)) dead.push(m);
      }
      return dead;
    }

    function hasDeathrattle(m) { return m.effectKind === 'deathrattle'; }

    function processDeaths() {
      var guard = 200;
      var dead = collectDead();
      while (dead.length && guard-- > 0) {
        // 萨满光环按本批次移除前快照计（文档11.3 鬼魂快照同思路）
        var extraA = Effects.deathrattleExtra(A);
        var extraB = Effects.deathrattleExtra(B);
        // a 侧先按从左到右处理，再 b 侧
        ['a', 'b'].forEach(function (side) {
          dead.filter(function (m) { return m._side === side; }).forEach(function (m) {
            var board = boardOf(side);
            var idx = board.indexOf(m);
            if (idx < 0) return;
            board.splice(idx, 1);          // 移出战场（UI 播放死亡动画）
            m.alive = false;
            board._deaths = (board._deaths || 0) + 1; // ★V3 m48 枯木长老动态光环计数（复生前后各计1次死亡）
            emit({ t: 'die', side: side, uid: m.uid });
            // ★V14 轮转指针补偿标记：复生/亡语召唤会在原位补员，纯阵亡则数组净收缩
            var reoccupied = false;
            // 拾骨兀鹫：友方死亡触发
            Effects.onFriendlyDeath(board, m, function (e) { e.side = side; emit(e); });
            // 复生：首次死亡以1血复活（亡语共触发两次：本次+再次死亡时）
            if (m.reborn && !m.revived) {
              m.revived = true;
              m.pendingDeath = false;
              m.damage = Math.max(0, Effects.effMaxHp(m, board) - 1);
              board.splice(idx, 0, m);
              m.alive = true;
              reoccupied = true;
              emit({ t: 'revive', side: side, uid: m.uid, minion: snap(m, board, heroOf(side)), idx: idx });
              emit({ t: 'log', text: '「' + m.name + '」复生了！' });
              // ★V2 复生触发：绷带傀儡/永恒角斗士
              Effects.onReborn(board, m, function (e) { e.side = side; emit(e); });
              idx++;
            }
            // 亡语（含萨满加成次数）
            var summoned = false;
            if (hasDeathrattle(m)) {
              var times = 1 + (side === 'a' ? extraA : extraB);
              for (var t = 0; t < times; t++) {
                Effects.runDeathrattle(m, {
                  board: board,
                  emit: function (e) { if (e.t === 'buff' || e.t === 'log' || e.t === 'shieldGain' || e.t === 'venomGain') e.side = side; emit(e); },
                  summonFn: function (cardId, star) {
                    // ★V18.1 召唤物占位修复：无空位（存活随从已达场上上限）则不生成，
                    //   不顶掉任何存活随从（用户 18:15 报告：荒野亡语多召曾把最右侧存活者挤出7格）。
                    //   生成失败不置 summoned → 纯阵亡语义保留（V14 指针补偿照常）。
                    var aliveCount = board.filter(function (x) { return x.alive; }).length;
                    if (aliveCount >= CFG.BOARD_SLOTS) return;
                    summoned = true;
                    var tok = makeMinion(cardId, star);
                    tok._side = side;
                    board.splice(idx, 0, tok);
                    idx++;
                    emit({ t: 'summon', side: side, minion: snap(tok, board, heroOf(side)), idx: idx - 1 });
                    // ★V3 m47 掘尸鬣狗：己方场上每次召唤→+{n}/{n}
                    Effects.onSummon(board, tok, function (e) { if (!e.side) e.side = side; emit(e); });
                  }
                });
              }
            }
            // ★V14 轮转指针补偿（攻击顺序跳位根因修复）：纯阵亡（无复生/亡语召唤补位）
            //   使战斗数组净收缩，若阵亡位置在本方出手指针之前，指针同步左移一位。
            //   否则下一位未出手随从会被跳过、已出手随从被重复轮转（用户反馈：
            //   "风怒随从攻击两下后轮到第三个随从"即此机制叠加阵亡收缩所致）。
            //   ptr 未初始化（开战效果阶段）时无需补偿：出手指针随后从0起扫，无跳位窗口。
            if (ptr && !reoccupied && !summoned && idx < ptr[side]) ptr[side]--;
          });
        });
        dead = collectDead(); // 光环回落/连锁亡语可能引发新死亡
      }
    }

    /* ---------- 战斗开始时效果 ---------- */
    (function runStart() {
      var ca = countAlive(A), cb = countAlive(B);
      var preSide = ca > cb ? 'a' : cb > ca ? 'b' : (Math.random() < 0.5 ? 'a' : 'b');
      var order = preSide === 'a' ? ['a', 'b'] : ['b', 'a'];

      // ★V17 英雄战开技能（设计§5.2：英雄技能最先于随从战开效果结算）
      [heroA && 'a', heroB && 'b'].forEach(function (side) {
        if (!side) return;
        var bd = boardOf(side);
        var hid = heroOf(side);
        // h06 兽群看守·苔莉：战开召唤狼崽（t07，走普通召唤事件喂 m47，不触发随从战开——t07 无效果）
        //   ★V2.7 兽群哺育强化（用户需求+伊莎贝拉精确文本）：狼崽攻血复制「生命值最高的友方随从」——
        //   取值口径=base+buff（最大生命，战开时当前=最大），光环不计入复制值（狼崽入场后与源同受光环
        //   实时加成，若复制含光环值再叠光环=双重加成）；并列取站位最左（数组序最小，严格>保留先者）；
        //   空场保底 1/1（t07 原始面板）；取值时点=英雄战开，先于随从战开效果，故不含 m31/m52/m37 等战斗内成长。
        //   ★V18.1 同一占位规则：满员（存活≥上限）则不生成
        if (hid === 'h06') {
          if (bd.filter(function (x) { return x.alive; }).length >= CFG.BOARD_SLOTS) {
            emit({ t: 'log', text: '「兽穴看守·苔莉」的兽群哺育：场上已满，狼崽未能降临' });
          } else {
            var tok = makeMinion('t07', 1);
            var src = null;
            for (var _i6 = 0; _i6 < bd.length; _i6++) {
              var _x6 = bd[_i6];
              if (!_x6.alive) continue;
              if (!src || (_x6.baseHp + _x6.buffHp) > (src.baseHp + src.buffHp)) src = _x6;
            }
            if (src) {
              tok.baseAtk = src.baseAtk + src.buffAtk;
              tok.baseHp = src.baseHp + src.buffHp;
            }
            tok._side = side;
            bd.push(tok);
            emit({ t: 'summon', side: side, minion: snap(tok, bd, hid), idx: bd.length - 1 });
            Effects.onSummon(bd, tok, function (e) { if (!e.side) e.side = side; emit(e); });
            emit({ t: 'log', text: src
              ? '「兽穴看守·苔莉」的兽群哺育：召唤狼崽（复制自「' + src.name + '」 ' + tok.baseAtk + '/' + tok.baseHp + '）'
              : '「兽穴看守·苔莉」的兽群哺育：召唤一只1/1狼崽' });
          }
        }
        // h10 末路剑客·凯拉：背水（生命值≤17 → 全队随从攻击翻倍；战斗内英雄血量恒定，战开一次性施加，等价动态光环；★V2.9.4 阈值 10→17，维持 50 血的 1/3 血线锚点）
        //   翻倍口径：再叠加一份「当前有效攻击」（base+buff+光环，含h01/h07等光环叠加后的值）；
        //   战开快照语义——此后新召唤/新获得的攻击不再翻倍。0攻随从无可翻倍值，跳过。
        else if (hid === 'h10') {
          var hp = side === 'a' ? heroHpA : heroHpB;
          if (typeof hp === 'number' && hp <= 17) { // ★V2.9.4 背水阈值 10→17
            bd.forEach(function (x) {
              if (!x.alive) return;
              var cur = Math.max(0, x.baseAtk + x.buffAtk + Effects.auraAtkFor(x, bd, hid));
              if (cur <= 0) return;
              x.buffAtk += cur; // 翻倍 = +当前有效攻
              emit({ t: 'buff', side: side, uid: x.uid, atk: cur, hp: 0 });
            });
            emit({ t: 'log', text: '「末路剑客·凯拉」背水而战：全队攻击翻倍' });
          }
        }
      });

      Effects.runStartEffects({
        a: A, b: B, order: order, emit: emit,
        applyHitFn: function (src, tgt, dmg, tgtSide) { applyHit(src, tgt, dmg, tgtSide); }
      });
      processDeaths(); // 开战伤害可能直接造成死亡
    })();

    /* ---------- 先手判定（战斗开始效果结算后） ---------- */
    var aliveA0 = countAlive(A), aliveB0 = countAlive(B);
    var side;
    if (aliveA0 > aliveB0) side = 'a';
    else if (aliveB0 > aliveA0) side = 'b';
    else side = Math.random() < 0.5 ? 'a' : 'b';
    emit({ t: 'firstStrike', side: side });

    /* ---------- 出手循环 ---------- */
    function nextAttackerIdx(board, from, heroId) {
      if (!board.length) return -1;
      for (var k = 0; k < board.length; k++) {
        var idx = ((from % board.length) + k) % board.length;
        var m = board[idx];
        if (m.alive && Effects.effAtk(m, board, heroId) > 0) return idx;
      }
      return -1;
    }

    var ptr = { a: 0, b: 0 };
    var attacks = 0;
    var passStreak = 0;

    function performAttack(atkSide, attacker) {
      var atkBoard = boardOf(atkSide);
      var defBoard = boardOf(other(atkSide));
      var defSide = other(atkSide);

      emit({ t: 'attackStart', side: atkSide, uid: attacker.uid });
      // 铁律3：嘲讽强制目标
      var pool = defBoard.filter(function (x) { return x.alive && x.taunt; });
      if (!pool.length) pool = defBoard.filter(function (x) { return x.alive; });
      if (!pool.length) return;
      var target = pool[Math.floor(Math.random() * pool.length)];
      var targetIdx = defBoard.indexOf(target);
      emit({ t: 'lunge', side: atkSide, uid: attacker.uid, targetUid: target.uid });
      emit({ t: 'log', text: '「' + attacker.name + '」攻击「' + target.name + '」' + (attacker.cleave ? '（顺劈！）' : '') });

      // 同时结算：攻击者→目标（顺劈含左右邻），目标→攻击者反击
      var hits = [];
      var dmgMain = Effects.effAtk(attacker, atkBoard, heroOf(atkSide));
      hits.push({ src: attacker, tgt: target, dmg: dmgMain, tgtSide: defSide });
      if (attacker.cleave) {
        [targetIdx - 1, targetIdx + 1].forEach(function (i) {
          if (i >= 0 && i < defBoard.length && defBoard[i].alive) {
            hits.push({ src: attacker, tgt: defBoard[i], dmg: dmgMain, tgtSide: defSide, splash: true });
          }
        });
      }
      if (target.alive) {
        hits.push({ src: target, tgt: attacker, dmg: Effects.effAtk(target, defBoard, heroOf(defSide)), tgtSide: atkSide, counter: true });
      }
      hits.forEach(function (h) { applyHit(h.src, h.tgt, h.dmg, h.tgtSide); });
      processDeaths();
    }

    while (attacks < CFG.ATTACK_CAP) {
      var myBoard = boardOf(side), foeBoard = boardOf(other(side));
      if (countAlive(myBoard) === 0 || countAlive(foeBoard) === 0) break;
      var idx = nextAttackerIdx(myBoard, ptr[side], heroOf(side));
      if (idx < 0) {
        // 全员0攻：跳过本方回合
        passStreak++;
        ptr[side] = 0;
        if (passStreak >= 2) break; // 双方僵局
        side = other(side);
        continue;
      }
      passStreak = 0;
      // ★V14 轮转跳过可见化：被跳过的阵亡/0攻随从给出战斗日志（不改轮转顺序，仅解释性输出，
      //   回应用户"怎么跳到第三个"的困惑——第二个随从阵亡/0攻时按铁律2跳过，现在有据可查）
      if (idx !== ptr[side] % myBoard.length) {
        var kSkip = ptr[side] % myBoard.length, limSkip = myBoard.length;
        while (kSkip !== idx) {
          var smSkip = myBoard[kSkip];
          if (!smSkip.alive) emit({ t: 'log', text: '「' + smSkip.name + '」已阵亡，跳过出手' });
          else emit({ t: 'log', text: '「' + smSkip.name + '」0攻无法出手，跳过' });
          kSkip = (kSkip + 1) % limSkip;
        }
      }
      var attacker = myBoard[idx];
      ptr[side] = idx + 1;
      var swings = attacker.windfury ? 2 : 1; // 风怒：每轮出手两次
      for (var s = 0; s < swings; s++) {
        if (!attacker.alive) break;
        if (countAlive(boardOf(other(side))) === 0) break;
        attacks++;
        performAttack(side, attacker);
        if (attacks >= CFG.ATTACK_CAP) break;
      }
      side = other(side);
    }

    /* ---------- 结果 ---------- */
    var survA = A.filter(function (m) { return m.alive; });
    var survB = B.filter(function (m) { return m.alive; });
    var winner = null;
    if (survA.length > survB.length) winner = 'a';
    else if (survB.length > survA.length) winner = 'b';
    emit({
      t: 'end', winner: winner, attacks: attacks,
      survivors: {
        a: survA.map(function (m) { return snap(m, A, heroA); }),
        b: survB.map(function (m) { return snap(m, B, heroB); })
      }
    });

    return {
      events: ev, winner: winner, attacks: attacks,
      survivorsA: survA, survivorsB: survB,
      boards: { a: A, b: B }
    };
  }

  function other(side) { return side === 'a' ? 'b' : 'a'; }

  return { simulate: simulate, snap: snap, other: other };
})();
