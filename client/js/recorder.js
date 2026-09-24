/* =========================================================================
 * 《云屿酒馆》 Web 版 - recorder.js  ★V6.2 对局数据记录（2026-08-29）
 * 依据：《云屿酒馆-对局数据记录方案-阿莱克斯》（一局一条 + 局内回合快照混合粒度）
 *   - 挂接点：game.js newGame(开局) / finishPlayerBattle(每回合快照+终局落盘)
 *   - 随从增量编码 [cardId, star, buffAtk, buffHp, kwMask]：baseAtk/baseHp 全库只读，
 *     可由 cardId+star 经 data.js 复算，故不记录（体积 ~20字符/随从）
 *   - 存储：localStorage 单键 'yzt.rec.v1'，双层上限（明细200局/汇总1000局）+FIFO；
 *     meta 自含统计聚合（rc/ws/dds/dts/hpEnd），明细被清理后汇总仍可分析
 *   - Node/无 localStorage 环境自动降级为内存兜底（smoke/unit 可跑，_dump 断言）
 *   - seed 字段：当前无种子化 RNG，按方案置 null；版本缺失已由 CFG.VERSION 补齐
 *   红线：纯旁路观察者——不触碰卡池/经济/战斗任何状态与常量，hook 调用带 typeof 守卫
 * ========================================================================= */

'use strict';

var Recorder = (function () {

  var SV = 1;                      // 档案 schema 版本（字段变更时递增，import 按此校验）
  var LS_KEY = 'yzt.rec.v1';       // 战绩档案存储键
  var LS_EN = 'yzt.rec.enabled';   // 记录开关持久化键
  var MAX_DETAIL = 200;            // 明细上限：最近200局保留 rounds[]（方案3.3）
  var MAX_SUMMARY = 1000;          // 汇总上限：meta 自含统计，FIFO 整条淘汰
  var HARD_BUDGET = 1500000;       // 序列化字符硬预算（>50% 配额余量，方案3.3）

  var KW_BITS = { shield: 1, taunt: 2, venomous: 4, windfury: 8, cleave: 16, reborn: 32 };

  var _mem = null;                 // 无 localStorage 环境的内存兜底（Node 测试）
  var _cur = null;                 // 当前对局缓冲（终局才落盘，中断局不产生脏数据）
  var _enabled = null;             // null=未初始化（惰性读取持久化开关）

  /* ---------- 存储适配层 ---------- */

  function hasLS() {
    try { return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'; }
    catch (e) { return false; }
  }

  function lsGet(key) {
    if (!hasLS()) return _mem ? _mem[key] : null;
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function lsSet(key, val) {
    if (!hasLS()) { _mem = _mem || {}; _mem[key] = val; return true; }
    try { localStorage.setItem(key, val); return true; }
    catch (e) { return false; }   // QuotaExceeded / 隐私模式
  }

  function lsDel(key) {
    if (!hasLS()) { if (_mem) delete _mem[key]; return; }
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function isEnabled() {
    if (_enabled === null) {
      var raw = lsGet(LS_EN);
      _enabled = raw === null ? true : raw === '1';
    }
    return _enabled;
  }

  /** 用户开关（ui.js 设置按钮用）：关闭即停记并丢弃当前局缓冲 */
  function setEnabled(v) {
    _enabled = !!v;
    lsSet(LS_EN, _enabled ? '1' : '0');
    if (!_enabled) _cur = null;
  }

  function loadStore() {
    var raw = lsGet(LS_KEY);
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.sv === SV && Array.isArray(parsed.recs)) return parsed;
      } catch (e) { /* 损坏档案视为空，不抛出 */ }
    }
    return { sv: SV, recs: [] };
  }

  /* ---------- 清理策略（仅终局写入点执行，无定时器；方案3.3） ---------- */

  function cleanup(store) {
    // 汇总层：整条 FIFO 淘汰
    while (store.recs.length > MAX_SUMMARY) store.recs.shift();
    // 明细层：滑出200局窗口的记录剥离 rounds[]（meta 统计已自含，无信息损失）
    for (var i = 0; i < store.recs.length - MAX_DETAIL; i++) {
      if (store.recs[i].rounds) {
        store.recs[i].rc = store.recs[i].rounds.length;
        delete store.recs[i].rounds;
      }
    }
  }

  /** 落盘 + QuotaExceeded 四级降级梯（方案3.3）：明细减半→汇总砍半→明细全清→放弃。
   *  ★V6.2 修复：接受可选 existing（importJSON 的合并结果直接落盘——原实现内部重读
   *  存储导致合并记录被丢弃，导入永远不生效）。 */
  function save(existing) {
    var store = existing || loadStore();
    if (_cur) store.recs.push(_cur);
    cleanup(store);
    var json = JSON.stringify(store);
    if (json.length > HARD_BUDGET) {
      // 硬预算兜底：从最旧明细开始剥离
      for (var i = 0; i < store.recs.length && json.length > HARD_BUDGET; i++) {
        if (store.recs[i].rounds) { store.recs[i].rc = store.recs[i].rounds.length; delete store.recs[i].rounds; }
        json = JSON.stringify(store);
      }
    }
    if (lsSet(LS_KEY, json)) return true;
    // 降级1：最旧一半明细剥离
    var half = Math.floor(store.recs.length / 2);
    for (var j = 0; j < half; j++) {
      if (store.recs[j].rounds) { store.recs[j].rc = store.recs[j].rounds.length; delete store.recs[j].rounds; }
    }
    if (lsSet(LS_KEY, JSON.stringify(store))) return true;
    // 降级2：汇总砍半
    store.recs = store.recs.slice(Math.floor(store.recs.length / 2));
    if (lsSet(LS_KEY, JSON.stringify(store))) return true;
    // 降级3：明细全清（仅保留 meta）
    store.recs.forEach(function (r) { if (r.rounds) { r.rc = r.rounds.length; delete r.rounds; } });
    if (lsSet(LS_KEY, JSON.stringify(store))) return true;
    return false;   // 放弃（调用方 console.warn，不影响对局）
  }

  /* ---------- 编码 ---------- */

  function kwMaskOf(m) {
    var k = 0;
    if (m.shield) k |= KW_BITS.shield;
    if (m.taunt) k |= KW_BITS.taunt;
    if (m.venomous || m.grantedVenomous) k |= KW_BITS.venomous;
    if (m.windfury) k |= KW_BITS.windfury;
    if (m.cleave) k |= KW_BITS.cleave;
    if (m.reborn) k |= KW_BITS.reborn;
    return k;
  }

  /** 随从增量编码（场上位置=数组顺序）：baseAtk/baseHp/tier/tribe 可复算不记录 */
  function encodeMinions(board) {
    return (board || []).map(function (m) {
      return [m.cardId, m.star || 1, m.buffAtk | 0, m.buffHp | 0, kwMaskOf(m)];
    });
  }

  /** 解码（导出校验/单测 round-trip 用）：kwMask 还原为关键词对象 */
  function decodeMinions(arr) {
    return (arr || []).map(function (a) {
      return {
        cardId: a[0], star: a[1], buffAtk: a[2], buffHp: a[3],
        kw: {
          shield: !!(a[4] & 1), taunt: !!(a[4] & 2), venomous: !!(a[4] & 4),
          windfury: !!(a[4] & 8), cleave: !!(a[4] & 16), reborn: !!(a[4] & 32)
        }
      };
    });
  }

  function diffId(mult) {
    if (typeof DIFFICULTIES !== 'undefined') {
      for (var i = 0; i < DIFFICULTIES.length; i++) {
        if (DIFFICULTIES[i].mult === mult) return DIFFICULTIES[i].id;
      }
    }
    return 'hard'; // ★V2.9.4 兜底口径与单档表一致（原 'normal'）
  }

  function makeGid() {
    return 'G' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }

  /* ---------- 挂接入口（game.js 调用，均为纯旁路） ---------- */

  /** 开局：构建 meta（实体名册/难度/英雄/版本/时间戳；seed 置 null 待种子化） */
  function onGameStart(S) {
    if (!isEnabled()) return;
    _cur = {
      sv: SV,
      gid: makeGid(),
      ver: (typeof CFG !== 'undefined' && CFG.VERSION) || null,   // 版本常量 V6.2 新增
      seed: null,                                                  // 种子化(Phase2)前置空
      diff: diffId(S.difficultyMult),
      hero: S.player.heroId || null,
      heroes: { // ★V17 全桌英雄名册（向后兼容：旧档案无此字段；新英雄立绘由维克多批次落地）
        player: S.player.heroId || null,
        ais: (S.ais || S.entities.filter(function (e) { return e.kind === 'ai'; })).map(function (a) { return a.heroId || null; })
      },
      t0: Date.now(),
      t1: null, dur: null, rank: null, win: null,
      ent: S.entities.map(function (e) { return { id: e.id, name: e.name, kind: e.kind }; }),
      rc: 0, ws: 0, dds: 0, dts: 0, hpEnd: null,
      rounds: []
    };
  }

  /** 每回合快照（finishPlayerBattle 尾部调用；战斗不 mutate 真实 board，此处即招募期末阵容） */
  function onRound(data, ctx) {
    if (!isEnabled() || !_cur || !data || !ctx || !ctx.S) return;
    var S = ctx.S;
    var enemy = ctx.enemy || null;
    var pf = data.playerFight || {};
    var pIdx = 0;   // 实体序：[player, ai1..ai5]（newGame 固定构造顺序）

    var eIdx = -1;
    if (enemy) { for (var i = 0; i < S.entities.length; i++) { if (S.entities[i] === enemy) { eIdx = i; break; } } }

    // AI互战压缩为实体下标四元组 [aIdx, bIdx, winnerIdx(-1=平), dmg]
    var nameIdx = {};
    _cur.ent.forEach(function (e, i) { nameIdx[e.name] = i; });
    var of = (data.otherFights || []).map(function (f) {
      return [nameIdx[f.aName], nameIdx[f.bName], f.winnerName ? nameIdx[f.winnerName] : -1, f.dmg | 0];
    });
    // 出局压缩 [实体下标, 名次]
    var out = (data.eliminations || []).map(function (e) {
      return [e.isPlayer ? 0 : (nameIdx[e.name] !== undefined ? nameIdx[e.name] : -1), e.rank | 0];
    });

    _cur.rounds.push({
      r: data.round,
      pb: encodeMinions(S.player.board),
      eb: encodeMinions(enemy ? enemy.board : null),
      et: eIdx,
      eg: enemy && enemy.ghost ? 1 : 0,
      ptv: S.player.tavern | 0,
      etv: enemy ? (enemy.tavern | 0) : 0,
      res: pf.result || 'draw',
      dp: pf.dmgToPlayer | 0,            // 承伤
      de: pf.dmgToEnemy | 0,             // 输出
      s: pf.survivors | 0,               // 我方存活数
      pg: S.player.gold | 0,             // 剩余金币（经济画像）
      rt: Date.now() - _cur.t0,          // 相对开局毫秒（时长画像）
      hps: (data.hpChanges || []).map(function (h) { return h.hp | 0; }),
      of: of,
      out: out
    });
  }

  /** 终局：补齐聚合统计（meta 自含 → 明细被清理后 summary 仍可分析）并落盘 */
  function onGameOver(S, go) {
    if (!isEnabled() || !_cur || !go) { _cur = null; return; }
    _cur.t1 = Date.now();
    _cur.dur = _cur.t1 - _cur.t0;
    _cur.win = !!go.win;
    _cur.rank = null;
    if (Array.isArray(go.ranking)) {
      for (var i = 0; i < go.ranking.length; i++) {
        if (go.ranking[i] && go.ranking[i].isPlayer) { _cur.rank = go.ranking[i].rank; break; }
      }
    }
    _cur.rc = _cur.rounds.length;
    var ws = 0, dds = 0, dts = 0;
    _cur.rounds.forEach(function (r) {
      if (r.res === 'win') ws++;
      dds += r.de; dts += r.dp;
    });
    _cur.ws = ws; _cur.dds = dds; _cur.dts = dts;
    if (_cur.rounds.length && _cur.rounds[_cur.rounds.length - 1].hps) {
      _cur.hpEnd = _cur.rounds[_cur.rounds.length - 1].hps[0];   // 玩家恒为实体0
    }
    var okSave = save();
    if (!okSave && typeof console !== 'undefined' && console.warn) {
      console.warn('[Recorder] 战绩落盘失败（存储配额不足且降级失败），本局未记录');
    }
    _cur = null;
  }

  /* ---------- 导出 / 导入 / 清空 ---------- */

  function exportJSON() {
    var store = loadStore();
    return JSON.stringify({ sv: SV, exportedAt: new Date().toISOString(), recs: store.recs });
  }

  /* ★V2.5 导出修复（根因①）：ui.js 导出按钮一直调用 Recorder.downloadJSON()，
   * 但本模块此前从未定义/导出该函数 → 点击必抛 TypeError，表现为「点了没反应」
   * （连后续 toast 都不会执行）。现补齐：Blob + a[download] 带日期文件名。
   * 注意：聊天内嵌预览等沙箱 iframe 可能静默拦截 a[download]（无 allow-downloads），
   * 下载被拦截时本函数不抛错但也拿不到文件——调用方（ui.js 导出弹层）需提供
   * 「复制全文 / 新窗口打开」兜底通道。Node 环境（无 document）安全返回 false。 */
  function downloadJSON() {
    try {
      var blob = new Blob([exportJSON()], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var d = new Date();
      var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      var a = document.createElement('a');
      a.href = url;
      a.download = '云屿酒馆战绩_' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())
                 + '_' + p2(d.getHours()) + p2(d.getMinutes()) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e2) {} }, 3000);
      return true;
    } catch (e) { return false; }
  }

  /** 导入：校验 schema + 按 gid 去重合并；返回 {added, skipped} */
  function importJSON(text) {
    var added = 0, skipped = 0;
    var incoming = null;
    try { incoming = JSON.parse(text); } catch (e) { return { added: 0, skipped: 0, error: 'JSON解析失败' }; }
    if (!incoming || incoming.sv !== SV || !Array.isArray(incoming.recs)) {
      return { added: 0, skipped: 0, error: 'schema版本不符或格式非法' };
    }
    var store = loadStore();
    var gids = {};
    store.recs.forEach(function (r) { gids[r.gid] = true; });
    incoming.recs.forEach(function (r) {
      if (!r || !r.gid || typeof r.t0 !== 'number') { skipped++; return; }
      if (gids[r.gid]) { skipped++; return; }
      store.recs.push(r); gids[r.gid] = true; added++;
    });
    cleanup(store);
    save(store);
    return { added: added, skipped: skipped };
  }

  function clear() { _cur = null; lsDel(LS_KEY); }

  function stats() {
    var store = loadStore();
    var detailed = 0;
    store.recs.forEach(function (r) { if (r.rounds) detailed++; });
    return { total: store.recs.length, detailed: detailed };
  }

  /* ---------- 测试/调试后门（下划线前缀，非公开 API） ---------- */
  return {
    SV: SV,
    onGameStart: onGameStart, onRound: onRound, onGameOver: onGameOver,
    exportJSON: exportJSON, downloadJSON: downloadJSON, importJSON: importJSON, clear: clear,
    stats: stats, isEnabled: isEnabled, setEnabled: setEnabled,
    decodeMinions: decodeMinions,
    _dump: function () { return loadStore(); },
    _reset: function () { _cur = null; _mem = null; lsDel(LS_KEY); },
    _caps: function (d, s) { if (d) MAX_DETAIL = d; if (s) MAX_SUMMARY = s; }   // 单测注入小上限用
  };
})();
