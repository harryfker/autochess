/* =========================================================================
 * 《云屿酒馆》 Web 版 - pool.js
 * 共享卡池（文档 5.2 / 13.7）：
 *   - poolCount[cardId] 全局计数；
 *   - 商店抽取权重：等级差 0/1/2/3 → 权重 3/2/1/0.5；
 *   - 购买占用 / 卖出回池（金色按3张、3星按9张）；
 *   - 发现（三连奖励 / 情报贩子）同样占用池子。
 * 说明：AI 阵容按第11章脚本直接生成、不模拟经济，因此不占用共享池
 *      （单人局 V1 简化，README 中有说明）。
 * ========================================================================= */

'use strict';

var Pool = (function () {
  var counts = {};      // cardId → 剩余张数
  var loaned = {};      // cardId → 商店/发现暂时占用的张数

  function init() {
    counts = {}; loaned = {};
    CARDS.forEach(function (c) { counts[c.id] = CFG.POOL_COPIES[c.tier]; });
  }

  function available(cardId) {
    return Math.max(0, (counts[cardId] || 0) - (loaned[cardId] || 0));
  }

  /** 等级差对应抽取权重 */
  function tierWeight(diff) { return CFG.TIER_WEIGHT[diff] != null ? CFG.TIER_WEIGHT[diff] : 0; }

  /**
   * 按玩家酒馆等级加权抽取一张卡（占用池子）。
   * @param tavernLevel 酒馆等级 1~6（★V2.7 MAX_TIER）
   * @param filter 可选过滤函数
   * @returns cardId 或 null
   */
  function draw(tavernLevel, filter) {
    var pool = CARDS.filter(function (c) {
      return c.tier <= tavernLevel && available(c.id) > 0 &&
        (!filter || filter(c));
    });
    if (!pool.length) {
      // 兜底：同级池抽干时放宽到全池（极端情况）
      pool = CARDS.filter(function (c) { return available(c.id) > 0 && (!filter || filter(c)); });
      if (!pool.length) return null;
    }
    var total = 0, weights = pool.map(function (c) {
      var w = tierWeight(tavernLevel - c.tier) * available(c.id);
      total += w; return w;
    });
    var r = Math.random() * total;
    for (var i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) { loan(pool[i].id); return pool[i].id; }
    }
    loan(pool[pool.length - 1].id);
    return pool[pool.length - 1].id;
  }

  /** 抽取指定等级的卡（用于三连奖励：高一级卡池）
   *  ★修复 2026-09-04：原写死 draw(4,…)——等级5/6的卡与酒馆等级4差值为负、
   *    权重全为 0，会退化成"永远返回该档第一张卡"。改传 tier 本身（档内 diff=0 →
   *    权重 3 均匀抽取），与 drawExactTier 语义对齐。 */
  function drawOfTier(tier, filter) {
    return draw(tier, function (c) { return c.tier === tier && (!filter || filter(c)); });
  }

  /**
   * ★V3 精确档位抽取（随机性审计报告 BUG-1 修复用）：
   * 只从目标档位内均匀抽取，档内池抽干时返回 null —— 绝不降档兜底。
   * AI 三连奖励与玩家侧 discoverOptions(tier>0) 锁档语义一致。
   */
  function drawExactTier(tier) {
    var pool = CARDS.filter(function (c) { return c.tier === tier && available(c.id) > 0; });
    if (!pool.length) return null;
    var pick = pool[Math.floor(Math.random() * pool.length)];
    loan(pick.id);
    return pick.id;
  }

  function loan(cardId) { loaned[cardId] = (loaned[cardId] || 0) + 1; }
  function unloan(cardId) { loaned[cardId] = Math.max(0, (loaned[cardId] || 0) - 1); }

  /** 购买确认：把占用转为永久移除 */
  function consume(cardId) { unloan(cardId); counts[cardId] = Math.max(0, counts[cardId] - 1); }

  /** 卖出回池：1星+1 / 2星+3 / 3星+9 */
  function returnMinion(cardId, star) {
    counts[cardId] = Math.min(CFG.POOL_COPIES[CARD_BY_ID[cardId].tier], counts[cardId] + CFG.STAR_MULT[star]);
  }

  /** 供调试/断言 */
  function snapshot() {
    var s = {};
    CARDS.forEach(function (c) { s[c.id] = { left: counts[c.id], loaned: loaned[c.id] || 0 }; });
    return s;
  }

  init();
  return {
    init: init, draw: draw, drawOfTier: drawOfTier, drawExactTier: drawExactTier,
    loan: loan, unloan: unloan, consume: consume, returnMinion: returnMinion,
    available: available, snapshot: snapshot, tierWeight: tierWeight
  };
})();
