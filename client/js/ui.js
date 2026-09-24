/* =========================================================================
 * 《云屿酒馆》Web 版 - ui.js
 * 前端交互层（织码者）：选英雄 → 招募(拖拽/商店/冻结/升级/限时) →
 *   自动战斗演出(事件队列驱动·出手高亮+弧线箭头+伤害飘字) → 结算 →
 *   三连合成演出(金光+三选一发现) → 终局排名。状态机与演出优先级遵循设计文档第13章。
 * 依赖：data.js icons.js pool.js effects.js battle.js ai.js game.js
 *       embedded-assets.js（构建时内联 SVG data URI）assets.js（素材路径索引）
 * ========================================================================= */
'use strict';

var UI = (function () {
  /* ===================== 基础工具 ===================== */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function encodePath(p) { return p ? encodeURI(p) : ''; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* 关键词英文键 → 中文标签 */
  var KW_LABEL = {
    shield: '圣盾', taunt: '嘲讽', venomous: '剧毒', windfury: '风怒', cleave: '顺劈',
    reborn: '复生', deathrattle: '亡语', battlecry: '战吼', aura: '光环', startofcombat: '开战'
  };
  var KW_DESC = {
    shield: '吸收下一次伤害', taunt: '敌方必须优先攻击它', venomous: '击杀目标（圣盾可挡）',
    windfury: '每轮出手两次', cleave: '顺劈相邻目标', reborn: '死亡后以1血复活',
    deathrattle: '死亡时触发', battlecry: '打出时触发', aura: '持续光环', startofcombat: '战斗开始时'
  };
  /* ★V6 关键词主题色：图标/标签/描边统一取色，卡面与 tooltip 一致 */
  var KW_COLORS = {
    shield: '#4FA8E8', taunt: '#6FBF4A', venomous: '#B85CE8', windfury: '#F0B429',
    cleave: '#E2583E', reborn: '#2BC8D4', deathrattle: '#A78BFA', battlecry: '#E8C53A',
    aura: '#FF8A65', startofcombat: '#7DD8FF'
  };

  /* 族系名 */
  var TRIBE_NAME = { gear: '齿轮族', wild: '荒野族', tide: '潮汐族', neutral: '中立' };

  /* ===================== 素材解析 ===================== */
  /* 构建时内联 SVG（embedded-assets.js）→ data URI，彻底消除运行时 fetch。
   * EMBEDDED_SVG 由 tools/inline-assets.js 生成，key 为相对路径（如 assets/icons/铜壳哨兵.svg）。
   * 拿不到内联数据时回退到 icons.js 占位图。 */
  function embeddedPath(p) {
    if (p && typeof EMBEDDED_SVG !== 'undefined' && EMBEDDED_SVG[p]) return EMBEDDED_SVG[p];
    return null;
  }

  function artFor(cardId, star) {
    var p = ASSETS.art(cardId, star);
    if (p) {
      var inl = embeddedPath(p);
      if (inl) return inl;
      return encodePath(p);
    }
    return ICONS.svgDataURI(ICONS.artSVG(cardId));
  }
  function portraitFor(id) {
    var p = ASSETS.portrait(id);
    if (p) {
      var inl = embeddedPath(p);
      if (inl) return inl;
      return encodePath(p);
    }
    return ICONS.svgDataURI(ICONS.portraitSVG(id));
  }
  function portraitForEntity(ent) {
    if (!ent) return ICONS.svgDataURI(ICONS.portraitSVG('ai1'));
    var p = ASSETS.portraitForEntity(ent);
    if (p) {
      var inl = embeddedPath(p);
      if (inl) return inl;
      return encodePath(p);
    }
    return ICONS.svgDataURI(ICONS.portraitSVG(ent.kind === 'player' ? 'h01' : 'ai1'));
  }

  /* ===================== 随从卡组件 =====================
   * spec: {cardId, star, atk, hp, tier, name, tribe, def, mode, uid,
   *        shield, venomous, taunt, windfury, cleave, reborn, ghost, sizeCls, afford}
   * mode: shop | board | battle | preview | discover
   */
  function minionCard(spec) {
    var def = spec.def || CARD_BY_ID[spec.cardId];
    var star = spec.star || 1;
    var sz = spec.sizeCls || (spec.mode === 'battle' ? 'sz-battle'
      : spec.mode === 'preview' ? 'sz-mini'
      : spec.mode === 'discover' ? 'sz-discover' : 'sz-board');
    var c = el('div', 'mcard ' + sz + ' tier-' + spec.tier);
    if (spec.uid != null) c.dataset.uid = String(spec.uid);
    if (spec.ghost) c.classList.add('dim');
    if (spec.mode === 'shop') c.classList.add('shopcard');

    var img = el('img', 'art');
    img.src = artFor(spec.cardId, star);
    img.draggable = false;
    img.ondragstart = function () { return false; };
    c.appendChild(img);

    c.appendChild(el('div', 'tier-num', String(spec.tier)));

    /* ★V6 shop 也显示关键词条：触屏无悬停，选购时需要直观看到圣盾/嘲讽/亡语等 */
    var showCover = (spec.mode === 'board' || spec.mode === 'battle' || spec.mode === 'discover' || spec.mode === 'shop');
    if (showCover) {
      var strip = el('div', 'kw-strip' + (spec.mode === 'battle' ? ' tiny' : ''));
      if (star > 1) strip.appendChild(el('span', 'kstar', '★'.repeat(star)));
      var kws = collectKeywords(def, spec);
      kws.forEach(function (k) {
        var col = KW_COLORS[k] || '#e8e4d8';
        /* ★V6 直观化：图标 + 颜色主题 + 中文短标签（原来只有一枚灰色小圆图标） */
        var chip = el('span', 'kchip kw-' + k);
        chip.innerHTML = ICONS.kwIcon(k, col) + '<i>' + KW_LABEL[k] + '</i>';
        chip.title = KW_LABEL[k] + '：' + KW_DESC[k];
        chip.style.borderColor = col;
        chip.style.background = col + '30';
        strip.appendChild(chip);
      });
      c.appendChild(strip);
      /* ★V8 溢出防护：多关键词（如战斗中被赋予圣盾/风怒后 3+ 个）时检测内容
         是否超出一行/超时条高，自动加 .kw-compact 收缩字号，保证标签完整可见 */
      if (kws.length > 2 || (star > 1 && kws.length > 1)) {
        c.classList.add('kw-check');
      }
    }

    var info = el('div', 'info');
    info.appendChild(el('span', 'atk', String(spec.atk)));
    info.appendChild(el('span', 'nm', spec.name));
    info.appendChild(el('span', 'hp', String(spec.hp)));
    c.appendChild(info);

    if (spec.mode === 'shop') {
      /* ★V6 按用户反馈移除左下角金币价格角标；买不起仍以置灰提示 */
      if (spec.afford === false) c.classList.add('poor');
    }
    /* ★V8 溢出防护：渲染后实测，若 kw-strip 内容超出可视区（多关键词换行超条高）
       先收缩字号（kw-compact）；仍超高则退化为纯图标模式（kw-icons，悬停看全称），
       例如战斗中被大法官赋予圣盾后 3+ 关键词场景 */
    var stripEl = c.querySelector('.kw-strip');
    if (stripEl) {
      requestAnimationFrame(function () {
        if (!stripEl.isConnected) return;
        if (stripEl.scrollHeight > stripEl.clientHeight + 1) stripEl.classList.add('kw-compact');
        if (stripEl.scrollHeight > stripEl.clientHeight + 1) stripEl.classList.add('kw-icons');
      });
    }
    return c;
  }

  function collectKeywords(def, spec) {
    var kws = (def && def.kw) ? def.kw.slice() : [];
    function add(k) { if (kws.indexOf(k) < 0) kws.push(k); }
    /* ★V8 战斗实时态：随从状态字段是权威来源（战斗中圣盾被消耗/关键词被动态赋予
       都体现在 spec.* 上）。天赋表 def.kw 里的对应项需按当前状态校正：
       盾掉了移除盾标签；同理嘲讽/剧毒等被剥夺时也移除（当前设计只有圣盾会失去，
       其余字段不退化，但统一处理更稳）。仅 battle 模式需要实时校正，
       商店/发现等静态场景 def.kw 即真实状态。 */
    if (spec.mode === 'battle') {
      ['shield', 'taunt', 'venomous', 'windfury', 'cleave', 'reborn'].forEach(function (k) {
        if (!spec[k]) {
          var at = kws.indexOf(k);
          if (at >= 0) kws.splice(at, 1);
        }
      });
    }
    if (spec.shield) add('shield');
    if (spec.taunt) add('taunt');
    if (spec.venomous) add('venomous');
    if (spec.windfury) add('windfury');
    if (spec.cleave) add('cleave');
    if (spec.reborn) add('reborn');
    return kws.slice(0, 5);
  }

  /* ===================== 舞台缩放 ===================== */
  var stageScale = 1;
  function fitStage() {
    var s = Math.min(innerWidth / 960, innerHeight / 540);
    stageScale = s;
    $('stage').style.transform = 'scale(' + s + ')';
  }
  function clientToStage(cx, cy) {
    var r = $('stage').getBoundingClientRect();
    return { x: (cx - r.left) / stageScale, y: (cy - r.top) / stageScale };
  }
  function cardCenter(cardEl) {
    var r = cardEl.getBoundingClientRect();
    return clientToStage(r.left + r.width / 2, r.top + r.height / 2);
  }

  /* ===================== 屏幕切换 ===================== */
  /* ★V9 新增 home/lobby/screen-room 三屏（多人流程），单人流程切换逻辑零改动 */
  function showScreen(name) {
    /* ★V11 修复：加 null 守卫——若浏览器缓存了「新JS+旧HTML」混合态（缺失屏 section），
       只跳过缺失屏，不再抛 TypeError 杀死整个 init（否则全页按钮失去绑定） */
    ['home', 'lobby', 'room', 'hero', 'recruit', 'battle', 'settle', 'over'].forEach(function (n) {
      var sec = $('screen-' + n);
      if (sec) sec.classList.toggle('hidden', n !== name);
    });
    hideTooltip(); /* ★V6 切屏必清：避免上一屏悬停的卡牌信息残留 */
  }

  /* ===================== Toast / Tooltip / 飘字 ===================== */
  function toast(msg, err) {
    var t = el('div', 'toast' + (err ? ' err' : ''), msg);
    $('toasts').appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 2700);
  }
  function floatAt(x, y, txt, cls) {
    var f = el('div', 'float-txt ' + (cls || 'dmg'), String(txt));
    f.style.left = x + 'px'; f.style.top = y + 'px';
    $('fx-layer').appendChild(f);
    setTimeout(function () { if (f.parentNode) f.remove(); }, 1000);
  }
  function showTooltip(spec, cx, cy) {
    var def = spec.def || CARD_BY_ID[spec.cardId];
    var star = spec.star || 1;
    var p = clientToStage(cx, cy);
    var t = $('tooltip');
    t.innerHTML = '';
    var head = el('div', 'tt-head');
    var im = el('img'); im.src = artFor(spec.cardId, star); im.width = 46; im.height = 46;
    head.appendChild(im);
    var meta = el('div');
    meta.appendChild(el('div', 'tt-name', spec.name));
    meta.appendChild(el('div', 'tt-sub', 'T' + spec.tier + ' · ' + TRIBE_NAME[spec.tribe] + (star > 1 ? ' · ' + '★'.repeat(star) : '')));
    head.appendChild(meta);
    t.appendChild(head);
    var st = el('div', 'tt-stats');
    var atk = (spec.atk != null) ? spec.atk : def.atk * (star === 2 ? 2 : star === 3 ? 4 : 1);
    var hp = (spec.hp != null) ? spec.hp : def.hp * (star === 2 ? 2 : star === 3 ? 4 : 1);
    st.appendChild(el('span', 'a', '⚔ ' + atk));
    st.appendChild(el('span', 'h', '♥ ' + hp));
    t.appendChild(st);
    if (def && def.kw && def.kw.length) {
      var kw = el('div', 'tt-kws');
      def.kw.forEach(function (k) {
        var col = KW_COLORS[k] || '#e8e4d8';
        var c = el('span', 'kw');
        c.innerHTML = ICONS.kwIcon(k, col);
        c.appendChild(document.createTextNode(KW_LABEL[k]));
        c.title = KW_DESC[k];           /* ★V6 悬停释义 */
        c.style.borderColor = col;      /* ★V6 与卡面同色系 */
        c.style.background = col + '26';
        kw.appendChild(c);
      });
      t.appendChild(kw);
    }
    var txt = (typeof cardText === 'function') ? cardText(def, star) : (def && def.text || '白板');
    if (txt) t.appendChild(el('div', 'tt-text', txt));
    if (spec.mode === 'shop') {
      t.appendChild(el('div', 'tt-pool', '池中剩余 ' + Pool.available(spec.cardId) + ' 张'));
    }
    t.classList.remove('hidden');
    var w = 250, h = t.offsetHeight || 200;
    var x = clamp(p.x + 14, 8, 960 - w);
    var y = clamp(p.y - h - 8, 8, 540 - h);
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTooltip() { $('tooltip').classList.add('hidden'); }

  /* ===================== 全局状态 ===================== */
  var flow = {
    curScreen: 'hero',
    selectedHero: 'h03',
    difficulty: 'hard', // ★V2.9.4 默认困难（单档表：'normal' 已不在 DIFFICULTIES，保留旧值会致难度 mult 读取 filter[0] 落空）
    timerOn: true,
    timer: { remaining: 0, handle: null, paused: false },
    drag: { active: false, pendingUpdate: false, ghost: null, source: null, cx: 0, cy: 0 },
    battle: { speed: 2, skip: false, playing: false },
    target: { active: false, resolver: null, options: null, byUid: null },
    merge: { ceremonyDone: null },
    stats: { tripleCount: 0, maxRoundDmg: 0, finalTavern: 1 }
  };

  /* ===================== 选英雄屏（★V17 抽选模式：开局随机 N 选一，默认三选一；全桌去重） =====================
   *  功能 MVP：渲染 CFG.HERO_DRAFT_CHOICES 张候选（复用 hero-card 样式）；★V2.4 全英雄无护甲，无护甲 chip。
   *  背面翻牌动效/立绘占位/技能类型 tag 由维克多批次增强（设计§5.1）。 */
  function renderHeroScreen() {
    if (!flow.heroDraft || !flow.heroDraft.length) {
      flow.heroDraft = GameCore.drawHeroDraft().choices; // 抽选草稿：渲染期间保持稳定，开局消耗
      flow.selectedHero = null;
    }
    var box = $('hero-cards'); box.innerHTML = '';
    flow.heroDraft.forEach(function (hid) {
      var h = HERO_BY_ID[hid];
      var c = el('div', 'hero-card panel' + (flow.selectedHero === h.id ? ' selected' : ''));
      var im = el('img', 'avatar'); im.src = portraitFor(h.id);
      c.appendChild(im);
      c.appendChild(el('div', 'h-name', h.name));
      c.appendChild(el('div', 'h-skill', h.skill));
      c.appendChild(el('div', 'h-text', h.text));
      var chips = el('div', 'h-chips'); // ★V2.4 全英雄无护甲，护甲 chip 已随 armor 字段一并移除
      chips.appendChild(el('span', 'tag blue', TRIBE_NAME[h.tribe]));
      c.appendChild(chips);
      c.onclick = function () { flow.selectedHero = h.id; renderHeroScreen(); };
      box.appendChild(c);
    });
    var dg = $('opt-difficulty'); dg.innerHTML = '';
    DIFFICULTIES.forEach(function (d) {
      var b = el('button', 'opt-chip' + (flow.difficulty === d.id ? ' on' : ''), d.name);
      b.onclick = function () { flow.difficulty = d.id; renderHeroScreen(); };
      dg.appendChild(b);
    });
    var tg = $('opt-timer'); tg.innerHTML = '';
    var tb = el('button', 'opt-chip' + (flow.timerOn ? ' toggle-on' : ''), '招募限时 ' + (flow.timerOn ? '✓' : ''));
    tb.onclick = function () { flow.timerOn = !flow.timerOn; renderHeroScreen(); };
    tg.appendChild(tb);
    /* ★V6.2 战绩档案：导出/清空（记录本体由 Recorder 旁路自动进行，此处仅管理入口）
     * ★V2.5 导出修复（根因②）：聊天内嵌预览等沙箱 iframe 常静默拦截 Blob+a[download]，
     * 单一下载路径失效且无任何可见反馈。改为导出弹层三通道：下载文件 / 复制全文 /
     * 新窗口打开，JSON 文本常驻可手动全选——任何环境下都能真正拿到数据。 */
    var rg = $('opt-records');
    if (rg) {
      rg.innerHTML = '';
      var st = (typeof Recorder !== 'undefined') ? Recorder.stats() : { total: 0, detailed: 0 };
      var eb = el('button', 'opt-chip', '导出战绩 JSON' + (st.total ? '(' + st.total + ')' : ''));
      eb.title = '打开导出面板：下载 / 复制 / 新窗口三种方式任选（含每回合阵容快照）';
      eb.onclick = function () {
        if (typeof Recorder === 'undefined') return;
        exportRecordsModal();
      };
      var cb = el('button', 'opt-chip', '清空战绩');
      cb.onclick = function () {
        if (typeof Recorder === 'undefined') return;
        Recorder.clear();
        toast('战绩档案已清空');
        renderHeroScreen();
      };
      rg.appendChild(eb); rg.appendChild(cb);
    }
  }

  /* ★V2.5 导出战绩弹层：下载 / 复制 / 新窗口三通道 + JSON 常驻文本兜底。
   * 背景：沙箱预览（聊天内嵌 iframe）拦截 a[download] 与 window.open 时，
   * 旧的单一下载实现毫无反馈；复制 API 被禁时用户仍可手动全选文本复制。 */
  function exportRecordsModal() {
    var st = Recorder.stats();
    if (!st.total) { toast('暂无战绩可导出'); return; }
    var json = Recorder.exportJSON();
    var old = $('modal-export');
    if (old) { old.parentNode.removeChild(old); }
    var m = el('div', 'modal'); m.id = 'modal-export';
    m.appendChild(el('div', 'm-title', '导出战绩'));
    m.appendChild(el('div', 'm-note',
      '共 ' + st.total + ' 局（含明细 ' + st.detailed + ' 局）· 内嵌预览可能拦截下载，三种方式任选'));
    var btns = el('div', 'm-exp-btns');
    function mkBtn(label, fn) { var b = el('button', 'opt-chip', label); b.onclick = fn; return b; }
    var ta = document.createElement('textarea');
    ta.className = 'm-exp-ta'; ta.readOnly = true; ta.spellcheck = false;
    var MAX_SHOW = 80000;   // 展示层截断（复制/下载仍为完整数据，避免超大文本撑爆渲染）
    ta.value = json.length > MAX_SHOW
      ? json.slice(0, MAX_SHOW) + '\n…（仅预览截断，复制/下载均为完整 ' + json.length + ' 字符）'
      : json;
    function copyFull() {
      var done = function (ok) {
        toast(ok ? '已复制完整战绩（' + json.length + ' 字符）'
                 : '自动复制失败：请点击文本框 Ctrl+A 全选后手动复制', !ok);
      };
      var legacy = function () {
        try {
          ta.value = json; ta.focus(); ta.select();
          done(!!document.execCommand('copy'));
        } catch (e) { done(false); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(function () { done(true); }, legacy);
      } else { legacy(); }
    }
    btns.appendChild(mkBtn('⬇ 下载 .json 文件', function () {
      var ok = Recorder.downloadJSON();
      toast(ok ? '已尝试下载（未弹出保存框就用「复制全文」）' : '当前环境不支持下载，请用「复制全文」', !ok);
    }));
    btns.appendChild(mkBtn('⧉ 复制全文', copyFull));
    btns.appendChild(mkBtn('↗ 新窗口打开', function () {
      try {
        var u = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        var w = window.open(u, '_blank');
        toast(w ? '已在新窗口打开（Ctrl+S 可另存）' : '弹窗被拦截，请用「复制全文」', !w);
      } catch (e) { toast('弹窗被拦截，请用「复制全文」', true); }
    }));
    m.appendChild(btns);
    m.appendChild(ta);
    m.appendChild(el('div', 'm-exp-hint',
      '复制后粘贴到记事本另存为 .json 即为完整战绩档案；开局面板导入战绩可回灌合并'));
    var cancel = el('button', 'm-cancel', '关 闭');
    var close = function () { m.classList.add('hidden'); setTimeout(function () { if (m.parentNode) m.parentNode.removeChild(m); }, 150); };
    cancel.onclick = close;
    m.appendChild(cancel);
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    /* 与 #modal-discover 同级挂载（#stage 内）：.modal 为 absolute inset:0，
     * 挂 body 会脱离舞台坐标系（移动端缩放不一致） */
    var anchor = $('modal-discover');
    (anchor && anchor.parentNode ? anchor.parentNode : document.body).appendChild(m);
  }

  function startGame() {
    var dm = DIFFICULTIES.filter(function (d) { return d.id === flow.difficulty; })[0].mult;
    GameCore.newGame(flow.selectedHero, {
      difficultyMult: dm,
      timerOn: flow.timerOn,
      ui: GameUI
    });
    flow.heroDraft = null; // ★V17 草稿已消耗（AI 侧按全桌去重分配）
    flow.stats = { tripleCount: 0, maxRoundDmg: 0, finalTavern: 1 };
    flow.curScreen = 'recruit';
    showScreen('recruit');
    renderRecruit();
    startTimer();
  }

  /* ===================== 招募屏 ===================== */
  function renderRecruit() {
    if (flow.drag.active) { flow.drag.pendingUpdate = true; return; }
    /* ★V6 修复「信息卡在界面上」：购买/卖出等操作会重渲商店与手牌，悬停中的
       卡牌元素被移除 DOM 后 pointerleave 不再触发，tooltip 因此残留。
       每次重渲强制隐藏即可覆盖所有路径。 */
    hideTooltip();
    var S = GameCore.state();
    var p = S.player;

    /* 顶栏 */
    var top = $('rc-top'); top.innerHTML = '';
    var hero = HERO_BY_ID[p.heroId];
    var who = el('div', 'who');
    var im = el('img', 'avatar'); im.src = portraitFor(p.heroId);
    who.appendChild(im);
    var wmeta = el('div');
    wmeta.appendChild(el('div', 'nm', hero.short));
    var hp = el('div', 'hpchip'); hp.appendChild(el('span', 'heart', '♥')); hp.appendChild(el('span', '', p.hp));
    wmeta.appendChild(hp);
    who.appendChild(wmeta);
    top.appendChild(who);

    var pill = el('div', 'pill', '回合 ' + S.round + ' · 招募');
    top.appendChild(pill);
    if (S.timerOn) {
      var tp = el('div', 'pill timer' + (flow.timer.remaining <= 10 ? ' warn' : ''));
      tp.appendChild(el('span', '', '⏱'));
      tp.appendChild(el('span', 'v', fmtTime(flow.timer.remaining)));
      top.appendChild(tp);
    }
    var opp = playerOpponent(S);
    var oppChip = el('div', 'pill');
    oppChip.appendChild(el('span', '', '对手：'));
    oppChip.appendChild(el('span', 'v', opp ? opp.name : '—'));
    if (opp && opp.ghost) oppChip.appendChild(el('span', 'tag', '鬼魂'));
    top.appendChild(oppChip);

    var gold = el('div', 'goldchip');
    gold.appendChild(el('div', 'coin'));
    gold.appendChild(el('span', '', p.gold));
    top.appendChild(gold);

    /* ★V7 左侧血量实时排行榜：按血量降序，实时反映伤害/出局；
       下轮对手头像靠右错位 + ⚔ 标记（学炉石） */
    var rankBox = $('rc-rank'); rankBox.innerHTML = '';
    var ranked = S.entities.slice().sort(function (a, b) { return b.hp - a.hp; });
    ranked.forEach(function (ent) {
      var item = el('div', 'rk-item' + (ent === p ? ' me' : '') +
        (ent.hp <= 0 || ent.ghost ? ' dead' : '') + (opp && ent === opp ? ' next-opp' : ''));
      var im = el('img', 'avatar' + (ent.ghost ? ' ghost' : '')); im.src = portraitForEntity(ent);
      item.appendChild(im);
      if (ent === p) item.appendChild(el('span', 'tag gold', '你'));
      item.appendChild(el('span', 'hpv', Math.max(0, ent.hp)));
      item.appendChild(el('span', 'tv', 'T' + ent.tavern));
      if (opp && ent === opp) item.appendChild(el('span', 'vs-tag', '⚔'));
      item.title = ent.name + '（酒馆 T' + ent.tavern + '）' + (opp && ent === opp ? ' · 下轮对手' : '');
      rankBox.appendChild(item);
    });

    /* ★V7 对手预览：招募阶段不再展示对手阵容（保留悬念，战斗阶段才能看到），
       仅显示头像 / 酒馆等级 / 战力（AI 是否升本一眼可见） */
    var opBox = $('rc-opponent'); opBox.innerHTML = '';
    if (opp) {
      var opLeft = el('div', 'op-who');
      var opim = el('img', 'avatar' + (opp.ghost ? ' ghost' : '')); opim.src = portraitForEntity(opp);
      opLeft.appendChild(opim);
      opLeft.appendChild(el('div', 'nm', opp.name));
      opBox.appendChild(opLeft);
      opBox.appendChild(el('div', 'op-sep'));
      var pw = el('div', 'op-power');
      pw.innerHTML = '酒馆 <b>T' + opp.tavern + '</b> · 战力 <b>' + AI.boardPower(opp.board) + '</b>' +
        (opp.ghost ? ' · 鬼魂阵容' : '');
      opBox.appendChild(pw);
      opBox.appendChild(el('div', 'op-sep'));
      opBox.appendChild(el('div', 'op-power', '阵容开战后揭晓'));
    }

    /* 棋盘 */
    var lab = $('rc-board-label');
    lab.innerHTML = '你的战队（' + CFG.BOARD_SLOTS + ' 格）';
    var pw2 = el('span'); pw2.innerHTML = '战力 <b>' + boardPower(p.board, p.heroId) + '</b>';
    lab.appendChild(pw2);

    var board = $('rc-board'); board.innerHTML = '';
    for (var i = 0; i < CFG.BOARD_SLOTS; i++) {
      var slot = el('div', 'slot');
      slot.dataset.slot = String(i);
      var m = p.board[i];
      if (m) {
        var def = CARD_BY_ID[m.cardId];
        var eff = GameCore.playerEff(m);
        var card = minionCard({
          cardId: m.cardId, star: m.star, atk: eff.atk, hp: eff.hp,
          tier: def.tier, name: def.name, tribe: def.tribe, def: def, mode: 'board', uid: m.uid,
          shield: m.shield, taunt: m.taunt, venomous: m.venomous, windfury: m.windfury,
          cleave: m.cleave, reborn: m.reborn
        });
        card.dataset.boardIdx = String(i);
        attachBoardCardEvents(card, i, m, def);
        slot.appendChild(card);
      }
      attachSlotEvents(slot, i);
      board.appendChild(slot);
    }

    /* ★V2 手牌区 */
    var handBox = $('rc-hand'); handBox.innerHTML = '';
    for (var h = 0; h < CFG.HAND_LIMIT; h++) {
      var hslot = el('div', 'slot');
      hslot.dataset.handSlot = String(h);
      var hm = p.hand[h];
      if (hm) {
        var hdef = CARD_BY_ID[hm.cardId];
        var hcard = minionCard({
          cardId: hm.cardId, star: hm.star, atk: hm.baseAtk + hm.buffAtk, hp: hm.baseHp + hm.buffHp,
          tier: hdef.tier, name: hdef.name, tribe: hdef.tribe, def: hdef, mode: 'hand', uid: hm.uid,
          shield: hm.shield, taunt: hm.taunt, venomous: hm.venomous, windfury: hm.windfury,
          cleave: hm.cleave, reborn: hm.reborn, sizeCls: 'sz-mini'
        });
        hcard.dataset.handIdx = String(h);
        attachHandCardEvents(hcard, h, hm, hdef);
        hslot.appendChild(hcard);
      }
      handBox.appendChild(hslot);
    }

    /* 商店面板 */
    var lv = $('rc-shop-lv'); lv.innerHTML = '酒馆等级 <b>' + p.tavern + '</b>';
    var cards = $('shop-cards'); cards.innerHTML = '';
    if (!p.shop.length) {
      cards.appendChild(el('div', 'shop-empty', '（商店为空）'));
    }
    p.shop.forEach(function (c, idx) {
      var def = CARD_BY_ID[c.id];
      var card = minionCard({
        cardId: c.id, star: 1, atk: def.atk, hp: def.hp, tier: def.tier, name: def.name,
        tribe: def.tribe, def: def, mode: 'shop', uid: 'shop' + idx,
        afford: p.gold >= CFG.COST_BUY, sizeCls: 'sz-shop'
      });
      card.dataset.shopSlot = String(idx);
      attachShopCardEvents(card, idx, c, def);
      cards.appendChild(card);
    });

    /* 按钮状态（★V2.9.3 递减口径：显示费用已降幅；0金=免费升级） */
    var bUp = $('btn-upgrade');
    var cost = GameCore.upgradeCost();
    if (!isFinite(cost)) { bUp.disabled = true; bUp.firstChild.textContent = '酒馆已满级'; bUp.querySelector('.sub').textContent = ''; }
    else {
      var saved = CFG.UPGRADE_BASE[p.tavern - 1] - cost;
      bUp.disabled = p.gold < cost;
      bUp.firstChild.textContent = cost === 0 ? '免费升级酒馆' : ('升级酒馆 ' + cost + '金');
      bUp.querySelector('.sub').textContent = 'T' + (p.tavern + 1) + (saved > 0 ? ' · 已降' + saved + '金' : '');
    }

    var bRf = $('btn-refresh');
    var free = (p.heroId === 'h02' && !p.freeRefreshUsed);
    bRf.firstChild.textContent = free ? '免费刷新' : ('刷新 ' + CFG.COST_REFRESH + '金');
    bRf.disabled = (!free && p.gold < CFG.COST_REFRESH);

    var bFz = $('btn-freeze');
    bFz.classList.toggle('frozen', p.frozen);
    bFz.firstChild.textContent = p.frozen ? '已冻结 ❄' : '冻结 ❄';
    bFz.disabled = p.freezeUsed >= CFG.FREEZE_LIMIT;

    /* 应用待执行的 fx 标记 */
    pendingBuyFx.forEach(function (uid) {
      var c = board.querySelector('.mcard[data-uid="' + uid + '"]');
      if (c) { c.classList.add('fx-buy'); setTimeout(function () { c.classList.remove('fx-buy'); }, 520); }
    });
    pendingBuyFx.length = 0;
  }

  function playerOpponent(S) {
    var opp = GameCore.currentOpponent();
    return opp;
  }
  function boardPower(board, heroId) {
    var sum = 0;
    board.forEach(function (m) {
      var a = Effects.effAtk(m, board, heroId), h = Effects.effHp(m, board, heroId);
      sum += a + h;
      if (m.shield) sum += 2;
      if (m.venomous) sum += 4;
      if (m.windfury) sum += 3;
      if (m.cleave) sum += 2;
      if (m.reborn) sum += 2;
    });
    return sum;
  }

  /* ---- 棋盘卡事件 ---- */
  function attachBoardCardEvents(card, idx, m, def) {
    card.addEventListener('pointerdown', function (e) {
      if (flow.target.active) { return; } /* 让 click 处理 */
      beginDrag(e, card, { type: 'board', idx: idx, m: m, def: def });
    });
    card.addEventListener('click', function (e) {
      if (flow.drag.justDropped) return;
      if (flow.target.active) {
        var opt = flow.target.byUid[m.uid];
        if (opt) { flow.target.resolver(opt); }
        return;
      }
      var r = card.getBoundingClientRect();
      showTooltip({ cardId: m.cardId, star: m.star, atk: (GameCore.playerEff(m)).atk, hp: (GameCore.playerEff(m)).hp, tier: def.tier, name: def.name, tribe: def.tribe, def: def, mode: 'board' }, r.left + r.width / 2, r.top);
    });
    card.addEventListener('pointerenter', function (e) {
      if (flow.drag.active || flow.target.active) return;
      var r = card.getBoundingClientRect();
      showTooltip({ cardId: m.cardId, star: m.star, atk: (GameCore.playerEff(m)).atk, hp: (GameCore.playerEff(m)).hp, tier: def.tier, name: def.name, tribe: def.tribe, def: def, mode: 'board' }, r.left + r.width / 2, r.top);
    });
    card.addEventListener('pointerleave', hideTooltip);
  }

  /* ★V2 手牌卡事件 */
  function attachHandCardEvents(card, idx, m, def) {
    card.addEventListener('pointerdown', function (e) {
      if (flow.target.active) return;
      beginDrag(e, card, { type: 'hand', idx: idx, m: m, def: def });
    });
    card.addEventListener('click', function (e) {
      if (flow.drag.justDropped) return;
      /* 点击手牌卡 → 尝试上场 */
      if (GameCore.state().player.board.length < CFG.BOARD_SLOTS) {
        GameCore.playFromHand(idx).then(function (r) {
          if (!r.ok) toast(r.msg || '上场失败', true);
        });
      } else {
        toast('战场已满，无法上场', true);
      }
    });
    card.addEventListener('pointerenter', function (e) {
      if (flow.drag.active || flow.target.active) return;
      var r = card.getBoundingClientRect();
      showTooltip({ cardId: m.cardId, star: m.star, atk: m.baseAtk + m.buffAtk, hp: m.baseHp + m.buffHp, tier: def.tier, name: def.name, tribe: def.tribe, def: def, mode: 'hand' }, r.left + r.width / 2, r.top);
    });
    card.addEventListener('pointerleave', hideTooltip);
  }

  /* ---- 商店卡事件 ---- */
  function attachShopCardEvents(card, idx, c, def) {
    card.addEventListener('pointerdown', function (e) {
      if (card.classList.contains('poor')) { toast('金币不足', true); return; }
      beginDrag(e, card, { type: 'shop', slot: idx, card: c, def: def });
    });
    card.addEventListener('click', function (e) {
      if (flow.drag.justDropped) return;
      var p = GameCore.state().player;
      if (p.gold < CFG.COST_BUY) { toast('金币不足', true); return; }
      doBuy(idx, null);
    });
    card.addEventListener('pointerenter', function (e) {
      if (flow.drag.active) return;
      var r = card.getBoundingClientRect();
      showTooltip({ cardId: c.id, star: 1, atk: def.atk, hp: def.hp, tier: def.tier, name: def.name, tribe: def.tribe, def: def, mode: 'shop' }, r.left + r.width / 2, r.top);
    });
    card.addEventListener('pointerleave', hideTooltip);
  }

  function doBuy(slot, position) {
    GameCore.buyFromShop(slot, position).then(function (r) {
      if (!r.ok) toast(r.msg || '购买失败', true);
    });
  }

  /* ---- 槽位（拖放目标） ---- */
  function attachSlotEvents(slot, idx) {
    slot.addEventListener('pointerenter', function () {
      if (flow.drag.active && flow.drag.source && flow.drag.source.type === 'board') slot.classList.add('droptarget');
    });
    slot.addEventListener('pointerleave', function () { slot.classList.remove('droptarget'); });
  }

  /* ===================== 拖拽 ===================== */
  function beginDrag(e, card, source) {
    e.preventDefault();
    flow.drag.active = false; /* 待阈值 */
    flow.drag.source = source;
    flow.drag.cardEl = card;
    flow.drag.cx = e.clientX; flow.drag.cy = e.clientY;
    flow.drag.justDropped = false;
    var move = function (ev) {
      var dx = ev.clientX - flow.drag.cx, dy = ev.clientY - flow.drag.cy;
      if (!flow.drag.active && Math.hypot(dx, dy) > 6) {
        flow.drag.active = true;
        hideTooltip();
        startGhost(card);
      }
      if (flow.drag.active) {
        moveGhost(ev.clientX, ev.clientY);
      }
    };
    var detach = function () {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
    };
    var up = function (ev) {
      detach();
      if (!flow.drag.active) { /* 视为 click */
        card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return;
      }
      finishDrag(ev.clientX, ev.clientY);
    };
    /* ★V5 修复「升级酒馆费用一直不变」：触屏上浏览器接管手势（页面滚动等）时
       派发的是 pointercancel 而非 pointerup；若不清理，flow.drag.active 永久卡死，
       renderRecruit 持续早退（拖拽守卫），整个招募屏——包括升级按钮的费用文案——
       不再刷新（升级仍会真实扣费，但界面纹丝不动）。此处取消拖拽并恢复渲染。 */
    var cancel = function () {
      detach();
      if (!flow.drag.active) return; /* 未越过拖拽阈值，无需恢复 */
      if (flow.drag.ghost) { flow.drag.ghost.remove(); flow.drag.ghost = null; }
      var board = $('rc-board');
      if (board) board.querySelectorAll('.slot').forEach(function (s) { s.classList.remove('droptarget'); });
      var sz = $('rc-sellzone'); if (sz) sz.classList.remove('droptarget');
      var handBox = $('rc-hand');
      if (handBox) handBox.querySelectorAll('.slot').forEach(function (s) { s.classList.remove('droptarget'); });
      flow.drag.active = false;
      flow.drag.justDropped = true;
      setTimeout(function () { flow.drag.justDropped = false; }, 60);
      if (flow.drag.pendingUpdate) { flow.drag.pendingUpdate = false; renderRecruit(); }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  }
  function startGhost(card) {
    var g = card.cloneNode(true);
    g.classList.add('drag-ghost');
    g.style.width = card.offsetWidth + 'px';
    g.style.height = card.offsetHeight + 'px';
    document.body.appendChild(g);
    flow.drag.ghost = g;
    moveGhost(flow.drag.cx, flow.drag.cy);
  }
  function moveGhost(cx, cy) {
    if (!flow.drag.ghost) return;
    flow.drag.ghost.style.left = cx + 'px';
    flow.drag.ghost.style.top = cy + 'px';
    /* 高亮放置区 */
    var board = $('rc-board');
    board.querySelectorAll('.slot').forEach(function (s) { s.classList.remove('droptarget'); });
    var sz = $('rc-sellzone'); sz.classList.remove('droptarget');
    var under = document.elementFromPoint(cx, cy);
    if (under) {
      var slot = under.closest('.slot');
      if (slot && slot.parentNode === board) slot.classList.add('droptarget');
      else if (under.closest('#rc-sellzone')) sz.classList.add('droptarget');
    }
  }
  function finishDrag(cx, cy) {
    var ghost = flow.drag.ghost;
    var under = document.elementFromPoint(cx, cy);
    var src = flow.drag.source;
    var dropped = false;
    if (ghost) { ghost.remove(); flow.drag.ghost = null; }
    $('rc-board').querySelectorAll('.slot').forEach(function (s) { s.classList.remove('droptarget'); });
    $('rc-sellzone').classList.remove('droptarget');
    var handBox = $('rc-hand');
    if (handBox) handBox.querySelectorAll('.slot').forEach(function (s) { s.classList.remove('droptarget'); });
    if (under) {
      var slot = under.closest('.slot');
      var board = $('rc-board');
      if (slot && slot.parentNode === board) {
        var toIdx = parseInt(slot.dataset.slot, 10);
        if (src.type === 'board') { GameCore.moveMinion(src.idx, toIdx); }
        else if (src.type === 'hand') { GameCore.playFromHand(src.idx, toIdx).then(function(r){ if(!r.ok) toast(r.msg||'上场失败', true); }); }
        else { doBuy(src.slot, toIdx); }
        dropped = true;
      } else if (under.closest('#rc-sellzone')) {
        if (src.type === 'board') GameCore.sellMinion(src.idx);
        else if (src.type === 'hand') GameCore.sellFromHand(src.idx);
        else toast('商店卡不可卖出', true);
        dropped = true;
      } else if (under.closest('#rc-board') || under.closest('.shop-cards') || under.closest('#screen-recruit')) {
        if (src.type === 'shop') { doBuy(src.slot, null); dropped = true; }
        else if (src.type === 'hand') { GameCore.playFromHand(src.idx, null).then(function(r){ if(!r.ok) toast(r.msg||'上场失败', true); }); dropped = true; }
      }
    }
    flow.drag.active = false;
    flow.drag.justDropped = true;
    setTimeout(function () { flow.drag.justDropped = false; }, 60);
    if (flow.drag.pendingUpdate) { flow.drag.pendingUpdate = false; renderRecruit(); }
  }

  /* ===================== 计时器 ===================== */
  function fmtTime(sec) {
    if (sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function startTimer() {
    stopTimer();
    var S = GameCore.state();
    if (!S.timerOn) { flow.timer.remaining = -1; return; }
    flow.timer.remaining = GameCore.timerForRound(S.round);
    flow.timer.paused = false;
    flow.timer.handle = setInterval(tickTimer, 1000);
  }
  function tickTimer() {
    if (flow.timer.paused) return;
    flow.timer.remaining--;
    var pill = document.querySelector('.pill.timer');
    if (pill) pill.querySelector('.v').textContent = fmtTime(flow.timer.remaining);
    if (pill) pill.classList.toggle('warn', flow.timer.remaining <= 10);
    if (flow.timer.remaining <= 0) {
      stopTimer();
      toast('时间到！自动开战');
      startBattle();
    }
  }
  function stopTimer() {
    if (flow.timer.handle) { clearInterval(flow.timer.handle); flow.timer.handle = null; }
  }
  function pauseTimer(v) { flow.timer.paused = v; }

  /* ===================== 战斗屏 ===================== */
  function renderBattleScreen(setup) {
    var S = GameCore.state();
    var p = S.player;
    var hero = HERO_BY_ID[p.heroId];
    var enemy = setup.enemy;
    /* 顶栏 */
    var top = $('bt-top'); top.innerHTML = '';
    var eLeft = el('div', 'who');
    if (enemy) {
      var eim = el('img', 'avatar' + (enemy.ghost ? ' ghost' : '')); eim.src = portraitForEntity(enemy);
      eLeft.appendChild(eim);
      var emeta = el('div');
      emeta.appendChild(el('div', 'nm', enemy.name));
      if (enemy.ghost) emeta.appendChild(el('div', 'tag', '鬼魂阵容'));
      eLeft.appendChild(emeta);
    } else {
      eLeft.appendChild(el('div', 'nm', '—'));
    }
    top.appendChild(eLeft);
    var mid = el('div', 'pill', '回合 ' + S.round + ' · 战斗阶段');
    top.appendChild(mid);
    var pRight = el('div', 'who');
    var pim = el('img', 'avatar'); pim.src = portraitFor(p.heroId);
    pRight.appendChild(pim);
    pRight.appendChild(el('div', 'nm', '你 · ' + hero.short));
    top.appendChild(pRight);

    var speed = $('bt-speed'); speed.innerHTML = '';
    [1, 2, 4].forEach(function (s) {
      var b = el('button', 'spd-btn' + (flow.battle.speed === s ? ' on' : ''), s + '×');
      b.onclick = function () { flow.battle.speed = s; renderBattleScreen(setup); };
      speed.appendChild(b);
    });
    var sk = el('button', 'spd-btn skip', '跳过');
    sk.onclick = function () { flow.battle.skip = true; $('stage').classList.add('skipping'); };
    speed.appendChild(sk);
  }

  function startBattle() {
    if (flow.battle.playing) return;
    var setup = GameCore.ready();
    if (!setup) { toast('当前不能开战', true); return; }
    stopTimer();
    hideTooltip();
    flow.curScreen = 'battle';
    showScreen('battle');
    renderBattleScreen(setup);
    flow.battle.playing = true;
    flow.battle.skip = false;
    var sim = Battle.simulate(setup.playerBoard, setup.enemyBoard, { heroA: setup.heroA, heroB: setup.heroB, heroHpA: setup.heroHpA, heroHpB: setup.heroHpB });
    playBattle(sim, setup).then(function () {
      flow.battle.playing = false;
      $('stage').classList.remove('skipping');
      var data = GameCore.finishPlayerBattle(sim);
      if (data) {
        if (data.playerFight && data.playerFight.dmgToPlayer > flow.stats.maxRoundDmg)
          flow.stats.maxRoundDmg = data.playerFight.dmgToPlayer;
        showSettle(data);
      }
    });
  }

  /* 战斗事件播放 */
  function playBattle(sim, setup) {
    var views = { a: [], b: [] }; /* {uid, cardId, star, tier, name, atk, hp, shield, ...} */
    var byUid = {};
    var enemy = setup.enemy;
    var hero = HERO_BY_ID[GameCore.state().player.heroId];

    function snapToView(s) {
      return {
        uid: s.uid, cardId: s.cardId, star: s.star, tier: s.tier, name: s.name, tribe: s.tribe,
        atk: s.atk, hp: s.hp, maxHp: s.maxHp, shield: s.shield, taunt: s.taunt,
        venomous: s.venomous, windfury: s.windfury, cleave: s.cleave, reborn: s.reborn,
        alive: true, el: null
      };
    }
    function rebuildRow(side) {
      var board = side === 'a' ? $('bt-board-a') : $('bt-board-b');
      board.innerHTML = '';
      var arr = views[side];
      for (var i = 0; i < CFG.BOARD_SLOTS; i++) {
        var slot = el('div', 'slot');
        var v = arr[i];
        if (v) {
          var c = makeBattleCard(v, side);
          v.el = c;
          slot.appendChild(c);
        }
        board.appendChild(slot);
      }
      updateSurvCount();
    }
    function makeBattleCard(v, side) {
      var def = CARD_BY_ID[v.cardId];
      var c = minionCard({
        cardId: v.cardId, star: v.star, atk: v.atk, hp: v.hp, tier: v.tier, name: v.name,
        tribe: v.tribe, def: def, mode: 'battle', uid: v.uid,
        shield: v.shield, taunt: v.taunt, venomous: v.venomous, windfury: v.windfury,
        cleave: v.cleave, reborn: v.reborn, sizeCls: 'sz-battle'
      });
      c.style.position = 'absolute'; c.style.inset = '-2px'; c.style.width = 'auto'; c.style.height = 'auto';
      if (!v.alive) c.classList.add('dim');
      /* ★V7 战斗阶段悬停查看随从完整信息（己方与敌方随从均生效） */
      c.addEventListener('pointerenter', function (e) {
        showTooltip({
          cardId: v.cardId, star: v.star, atk: v.atk, hp: v.hp, tier: v.tier, name: v.name,
          tribe: v.tribe, def: def, mode: 'battle', uid: v.uid,
          shield: v.shield, taunt: v.taunt, venomous: v.venomous, windfury: v.windfury,
          cleave: v.cleave, reborn: v.reborn
        }, e.clientX, e.clientY);
      });
      c.addEventListener('pointerleave', hideTooltip);
      return c;
    }
    function updateSurvCount() {
      var aN = views.a.filter(function (v) { return v.alive; }).length;
      var bN = views.b.filter(function (v) { return v.alive; }).length;
      var sa = $('bt-surv-a'), sb = $('bt-surv-b');
      if (sa) sa.innerHTML = '存活 <b>' + aN + '</b>';
      if (sb) sb.innerHTML = '存活 <b>' + bN + '</b>';
    }
    function findView(uid) { return byUid[uid]; }
    function refreshCard(v) {
      if (!v.el) return;
      var atk = v.el.querySelector('.atk'), hp = v.el.querySelector('.hp');
      if (atk) atk.textContent = v.atk;
      if (hp) hp.textContent = v.hp;
    }
    function logText(txt) {
      var lt = $('bt-log-text');
      if (lt) lt.textContent = txt;
    }
    function showBanner(txt, cls) {
      var b = el('div', 'bt-banner ' + (cls || ''), txt);
      $('fx-layer').appendChild(b);
      setTimeout(function () { b.classList.add('out'); }, 1100);
      setTimeout(function () { if (b.parentNode) b.remove(); }, 1600);
    }

    function wait(ms) {
      var d = flow.battle.skip ? 1 : ms / flow.battle.speed;
      return new Promise(function (r) { setTimeout(r, d); });
    }

    return new Promise(function (resolve) {
      var i = 0;
      var events = sim.events;
      function next() {
        if (i >= events.length) { resolve(); return; }
        var ev = events[i++];
        handle(ev).then(next);
      }
      function handle(ev) {
        switch (ev.t) {
          case 'init':
            views.a = ev.a.map(snapToView);
            views.b = ev.b.map(snapToView);
            views.a.forEach(function (v) { byUid[v.uid] = v; });
            views.b.forEach(function (v) { byUid[v.uid] = v; });
            rebuildRow('a'); rebuildRow('b');
            logText('战斗开始！');
            return wait(450);
          case 'firstStrike': {
            var who = ev.side === 'a' ? '你' : (enemy ? enemy.name : '对手');
            showBanner(who + ' 方先手！', 'first');
            return wait(700);
          }
          case 'attackStart': {
            var v = findView(ev.uid);
            if (v && v.el) v.el.classList.add('attacking');
            return wait(120);
          }
          case 'lunge': {
            var atk = findView(ev.uid), tgt = findView(ev.targetUid);
            if (atk && tgt && atk.el && tgt.el) {
              var c1 = cardCenter(atk.el), c2 = cardCenter(tgt.el);
              atk.el.style.setProperty('--lx', (c2.x - c1.x) * 0.25 + 'px');
              atk.el.style.setProperty('--ly', (c2.y - c1.y) * 0.25 + 'px');
              atk.el.classList.add('fx-lunge');
              setTimeout(function () { if (atk.el) atk.el.classList.remove('fx-lunge'); }, 320);
              drawArrow(c1, c2, ev.side);
            }
            return wait(200);
          }
          case 'dmg': {
            var t = findView(ev.uid);
            if (t) {
              t.hp = ev.hp;
              if (t.el) {
                t.el.classList.add('fx-hit');
                setTimeout(function () { if (t.el) t.el.classList.remove('fx-hit'); }, 340);
                var cc = cardCenter(t.el);
                floatAt(cc.x, cc.y, '-' + ev.amount, ev.amount >= 5 ? 'dmg big' : 'dmg');
              }
              refreshCard(t);
            }
            return wait(360);
          }
          case 'shieldPop': {
            var t = findView(ev.uid);
            if (t) {
              t.shield = false;
              if (t.el) {
                t.el.classList.add('fx-shieldpop');
                setTimeout(function () { if (t.el) t.el.classList.remove('fx-shieldpop'); }, 460);
                var cc = cardCenter(t.el);
                floatAt(cc.x, cc.y, '圣盾！', 'shield');
                /* 刷新 kw-strip */
                var def = CARD_BY_ID[t.cardId];
                rebuildCardKeepAlive(t, 'a');
              }
            }
            return wait(380);
          }
          case 'poison': {
            var t = findView(ev.uid);
            if (t && t.el) {
              t.el.classList.add('poisoned');
              var cc = cardCenter(t.el);
              floatAt(cc.x, cc.y, '剧毒', 'poison');
            }
            return wait(280);
          }
          case 'die': {
            var t = findView(ev.uid);
            if (t) {
              t.alive = false;
              if (t.el) t.el.classList.add('fx-die');
              // ★V18.1 死后立即不占位：视图阵列即时收缩（与引擎 splice 同口径），
              //   保证后续 summon/revive 的 idx 坐标系一致，不再挤掉最右侧存活随从。
              var dside = views.a.indexOf(t) >= 0 ? 'a' : 'b';
              var di = views[dside].indexOf(t);
              if (di >= 0) views[dside].splice(di, 1);
              if (byUid[t.uid] === t) delete byUid[t.uid];
              return wait(380).then(function () { rebuildRow(dside); });
            }
            return wait(380);
          }
          case 'revive': {
            var v = snapToView(ev.minion);
            v.alive = true;
            var side = ev.side;
            views[side].splice(ev.idx, 0, v);
            byUid[v.uid] = v;
            rebuildRow(side);
            if (v.el) { v.el.classList.add('fx-revive'); setTimeout(function () { if (v.el) v.el.classList.remove('fx-revive'); }, 560); }
            var cc = v.el ? cardCenter(v.el) : { x: 480, y: 380 };
            floatAt(cc.x, cc.y, '复生', 'heal');
            return wait(450);
          }
          case 'summon': {
            var v = snapToView(ev.minion);
            v.alive = true;
            var side = ev.side;
            views[side].splice(ev.idx, 0, v);
            byUid[v.uid] = v;
            rebuildRow(side);
            if (v.el) { v.el.classList.add('fx-summon'); setTimeout(function () { if (v.el) v.el.classList.remove('fx-summon'); }, 420); }
            return wait(360);
          }
          case 'buff': {
            /* buff 无 side：按 uid 查 */
            var v = findView(ev.uid);
            if (v) {
              v.atk += ev.atk; v.hp += ev.hp; v.maxHp += ev.hp;
              if (v.el) {
                refreshCard(v);
                var cc = cardCenter(v.el);
                floatAt(cc.x, cc.y, '+' + ev.atk + '/+' + ev.hp, 'buff');
              }
            }
            return wait(280);
          }
          case 'shieldGain': {
            var v = findView(ev.uid);
            if (v) {
              v.shield = true;
              rebuildCardKeepAlive(v, ev.side);
              if (v.el) {
                var cc = cardCenter(v.el);
                floatAt(cc.x, cc.y, '圣盾', 'shield');
              }
            }
            return wait(280);
          }
          case 'venomGain': {
            /* ★bugfix 2026-09-22（m50 毒棘河豚，萨必实测"亡语没效果"根因之一）：
               上毒事件（m50 亡语随机友方潮汐 / m28 毒鳍巫医战吼）此前无 case，
               handle 返回 undefined → 播放链 handle(ev).then(next) 抛 TypeError，
               战斗播放在该事件处中断卡死。修复=对齐 shieldGain 同构：更新剧毒标记
               → 重建卡面（关键词条亮起）→ 浮动提示。 */
            var vg = findView(ev.uid);
            if (vg) {
              vg.venomous = true;
              rebuildCardKeepAlive(vg, ev.side);
              if (vg.el) {
                var vgc = cardCenter(vg.el);
                floatAt(vgc.x, vgc.y, '剧毒', 'poison');
              }
            }
            return wait(280);
          }
          case 'bolt': {
            var t = findView(ev.uid);
            if (t && t.el) {
              t.el.classList.add('fx-bolt');
              setTimeout(function () { if (t.el) t.el.classList.remove('fx-bolt'); }, 520);
              var cc = cardCenter(t.el);
              drawBolt(cc.x, cc.y);
              floatAt(cc.x, cc.y, '落雷', 'poison');
            }
            return wait(420);
          }
          case 'log': logText(ev.text); return wait(flow.battle.skip ? 1 : 120);
          case 'end': {
            var winText;
            if (ev.winner === 'a') winText = '你 胜利！';
            else if (ev.winner === 'b') winText = '你 战败…';
            else winText = '平局';
            showBanner(winText, ev.winner === 'a' ? '' : ev.winner === 'b' ? 'first' : '');
            return wait(900);
          }
          default:
            return wait(0);
        }
      }
      function rebuildCardKeepAlive(v, side) {
        /* 重建单张卡片样式（shield 变化）而尽量保留动画 */
        var def = CARD_BY_ID[v.cardId];
        var parent = v.el ? v.el.parentNode : null;
        if (!parent) return;
        var c = makeBattleCard(v, side);
        parent.replaceChild(c, v.el);
        v.el = c;
      }
      function drawArrow(a, b, side) {
        var svg = $('fx-svg');
        var mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 36 };
        var path = 'M ' + a.x + ' ' + a.y + ' Q ' + mid.x + ' ' + mid.y + ' ' + b.x + ' ' + b.y;
        var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', path);
        p.setAttribute('stroke', side === 'a' ? '#FFE45C' : '#FF8B8B');
        p.setAttribute('stroke-width', '3');
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('marker-end', 'url(#ah)');
        p.setAttribute('opacity', '0.9');
        svg.appendChild(p);
        setTimeout(function () { if (p.parentNode) p.remove(); }, 500);
      }
      function drawBolt(x, y) {
        var svg = $('fx-svg');
        var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        var bx = x, by = 0;
        p.setAttribute('d', 'M ' + (bx - 6) + ' 0 L ' + (bx + 4) + ' ' + (y - 18) + ' L ' + (bx - 2) + ' ' + (y - 14) + ' L ' + (bx + 8) + ' ' + y + ' L ' + bx + ' ' + (y - 4) + ' L ' + (bx - 4) + ' ' + (y) + ' Z');
        p.setAttribute('fill', '#CFeFFF');
        p.setAttribute('stroke', '#7aa8d6');
        p.setAttribute('stroke-width', '2');
        p.setAttribute('opacity', '0');
        svg.appendChild(p);
        p.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 480 });
        setTimeout(function () { if (p.parentNode) p.remove(); }, 500);
      }
      next();
    });
  }

  /* ===================== 结算屏 ===================== */
  function showSettle(data) {
    flow.curScreen = 'settle';
    showScreen('settle');
    var pf = data.playerFight;
    var bn = $('st-banner');
    bn.innerHTML = '';
    var cls = pf.result === 'win' ? 'win' : pf.result === 'lose' ? 'lose' : 'draw';
    var txt = pf.result === 'win' ? '胜 利！' : pf.result === 'lose' ? '战 败…' : '平 局';
    var big = el('div', 'big ' + cls, txt);
    bn.appendChild(big);
    /* ★V10 修复（击杀伤害显示0）：与鬼魂对局胜方本就不扣血（机制正确），横幅需明示，避免"造成 0 点伤害"误导 */
    /* ★V11 击杀横幅：胜方淘汰对手时改显「击杀（对方名称）」——名称取被淘汰对手实体名
       （单机=该AI名，联机=对端玩家昵称）。鬼魂本就不受伤、永不淘汰，故击杀分支与
       上方★V10胜方免伤文案互斥并存，两套文案不冲突 */
    var sub = pf.result === 'win' ? (pf.ghost
        ? ('你击败了鬼魂 ' + pf.enemyName + '（鬼魂已出局，不受伤害）')
        : (pf.killed
          ? ('击杀（' + pf.enemyName + '）')
          : ('你击败了 ' + pf.enemyName + '，造成 ' + pf.dmgToEnemy + ' 点伤害')))
      : pf.result === 'lose' ? ('你被 ' + pf.enemyName + (pf.ghost ? '（鬼魂）' : '') + ' 击败，损失 ' + pf.dmgToPlayer + ' 点生命')
        : ('与 ' + pf.enemyName + ' 战成平局');
    bn.appendChild(el('div', 'sub', sub));

    var col = $('st-fights'); col.innerHTML = '';
    col.appendChild(el('div', 'panel-title', '本回合战况'));
    /* 其他对局 */
    data.otherFights.forEach(function (f) {
      var line = el('div', 'fight-line');
      line.innerHTML = '<span>' + f.aName + '</span><span class="vs">vs</span><span>' + f.bName + '</span>';
      var res = f.draw ? '平' : (f.winnerName + '胜');
      var rc = f.draw ? 'd' : 'w';
      line.appendChild(el('span', 'res ' + rc, res));
      if (!f.draw && f.dmg) line.appendChild(el('span', 'dmg', ' -' + f.dmg));
      col.appendChild(line);
    });
    if (!data.otherFights.length) col.appendChild(el('div', 'fight-line', '（无其他对局）'));

    /* 出局（★V10 修复：消除 "[object Object]" 显示，改显名字+名次） */
    data.eliminations.forEach(function (nm) {
      col.appendChild(el('div', 'st-elim-line', nm.name + ' 在本回合出局（第' + nm.rank + '名）'));
    });

    var hpPanel = $('st-hp'); hpPanel.innerHTML = '';
    hpPanel.appendChild(el('div', 'panel-title', '生命面板'));
    var S = GameCore.state();
    S.entities.forEach(function (ent) {
      var row = el('div', 'hp-row' + (ent.hp <= 0 || ent.ghost ? ' dead' : ''));
      var im = el('img', 'avatar' + (ent.ghost ? ' ghost' : '')); im.src = portraitForEntity(ent);
      row.appendChild(im);
      var nm = el('span', 'nm', ent.name);
      if (ent === S.player) nm.appendChild(el('span', 'tag gold', '你'));
      row.appendChild(nm);
      var bar = el('div', 'bar'); var inner = el('i');
      var maxHp = ent.maxHp || CFG.BASE_HP; // ★V2.4 全英雄无护甲，兜底即基础血量
      inner.style.width = clamp(ent.hp / maxHp * 100, 0, 100) + '%';
      bar.appendChild(inner); row.appendChild(bar);
      row.appendChild(el('span', 'val', ent.hp + '/' + maxHp));
      var dl = (function () {
        var c = data.hpChanges.filter(function (h) { return h.id === ent.id; })[0];
        return c ? c.delta : 0;
      })();
      row.appendChild(el('span', 'delta', dl ? ('-' + dl) : ''));
      hpPanel.appendChild(row);
    });

    var act = $('st-actions'); act.innerHTML = '';
    if (data.gameOver) {
      flow.stats.finalTavern = S.player.tavern;
      showOver(data.gameOver, S);
    } else {
      var btn = el('button', 'btn btn-primary btn-big', '进入下一回合');
      btn.onclick = function () {
        var ns = GameCore.nextRound();
        if (!ns) { /* gameOver after settle */ return; }
        flow.curScreen = 'recruit';
        showScreen('recruit');
        renderRecruit();
        startTimer();
      };
      act.appendChild(btn);
    }
  }

  /* ===================== 终局排名 ===================== */
  function showOver(go, S) {
    flow.curScreen = 'over';
    showScreen('over');
    toast('本局已存入战绩档案（开局面板可导出）'); // ★V6.2 对局数据记录
    var isWin = go.win;
    var myRank = go.ranking.filter(function (r) { return r.isPlayer; })[0].rank;
    var bn = $('ov-banner');
    bn.innerHTML = '';
    bn.appendChild(el('div', 'big', isWin ? '云屿新店主！' : '终局结算'));
    bn.appendChild(el('div', 'sub', '第 ' + S.round + ' 回合 · ' + (isWin
      ? '你是最后留在云屿酒馆的人！'
      : '你倒在了第 ' + S.round + ' 回合，排名第 ' + myRank)));

    /* 排名 */
    var rk = $('ov-ranking'); rk.innerHTML = '';
    go.ranking.forEach(function (r) {
      var ent = S.entities.filter(function (e) { return e.id === r.id; })[0] || r;
      var row = el('div', 'rank-row r' + r.rank + (r.isPlayer ? ' me' : ''));
      row.appendChild(el('div', 'rk', String(r.rank)));
      var im = el('img', 'avatar' + (r.ghost ? ' ghost' : '')); im.src = portraitForEntity(ent);
      row.appendChild(im);
      var nm = el('div', 'nm', r.name);
      if (r.isPlayer) {
        var hero = HERO_BY_ID[S.player.heroId];
        nm.appendChild(el('span', 'sub', hero.name + ' · ' + hero.skill.split('（')[0]));
      } else if (ent && ent.configId) {
        var ai = AI_CONFIGS.filter(function (a) { return a.id === ent.configId; })[0];
        if (ai) nm.appendChild(el('span', 'sub', ai.desc));
      }
      row.appendChild(nm);
      var hp = (r.hp != null) ? r.hp : (ent ? ent.hp : 0);
      row.appendChild(el('div', 'hpline', hp > 0 ? (hp + ' ❤') : '鬼魂'));
      rk.appendChild(row);
    });

    /* 出局顺序（★V10 修复：正序=出局先后；名次=实体总数-下标，与最终排名一致；
       回合取各实体自己的出局回合，不再全显终局回合） */
    var od = $('ov-order'); od.innerHTML = '';
    od.appendChild(el('div', 'panel-title', '出局顺序'));
    var elims = S.eliminations.slice();
    if (!elims.length) od.appendChild(el('div', 'ov-order-line', '（无出局）'));
    elims.forEach(function (rec, idx) {
      var id = (rec && rec.id != null) ? rec.id : rec;
      var rnd = (rec && rec.round != null) ? rec.round : S.round;
      var ent = S.entities.filter(function (e) { return e.id === id; })[0];
      if (ent) od.appendChild(el('div', 'ov-order-line', '<b>第' + (S.entities.length - idx) + '</b> ' + ent.name + '（R' + rnd + ' 出局）'));
    });

    /* 战绩 */
    var stats = $('ov-stats'); stats.innerHTML = '';
    stats.appendChild(el('div', 'panel-title', '本局战绩'));
    stats.appendChild(makeStat('三连合成', '× ' + flow.stats.tripleCount));
    stats.appendChild(makeStat('最高单回合承伤', flow.stats.maxRoundDmg + ' 点'));
    stats.appendChild(makeStat('最终酒馆', 'T' + flow.stats.finalTavern));
    var title = isWin ? '云屿新店主' : (myRank <= 3 ? '酒馆红人' : myRank <= 5 ? '云屿过客' : '门外汉');
    stats.appendChild(makeStat('称号', title));

    var act = $('ov-actions'); act.innerHTML = '';
    var again = el('button', 'btn btn-primary btn-big', '再来一局');
    again.onclick = function () { flow.heroDraft = null; flow.selectedHero = null; flow.curScreen = 'hero'; showScreen('hero'); renderHeroScreen(); }; // ★V17 重开局重抽
    act.appendChild(again);
  }
  function makeStat(k, v) {
    var d = el('div', 'stat-line');
    d.appendChild(el('span', 'k', k));
    d.appendChild(el('span', 'v', v));
    return d;
  }

  /* ===================== 三连合成演出 ===================== */
  function mergeCeremony(data) {
    var def = CARD_BY_ID[data.cardId];
    var star = data.star;
    var div = $('merge-ceremony');
    div.innerHTML = '';
    div.classList.remove('hidden');
    hideTooltip(); /* ★V6 演出覆盖层打开时清掉残留悬停信息 */
    div.appendChild(el('div', 'merge-rays'));
    var body = el('div', 'merge-body');
    body.appendChild(el('div', 'merge-banner', star >= 3 ? '三星降临！' : '三连达成！'));
    var mergeName = data.name || (CARD_BY_ID[data.cardId] && CARD_BY_ID[data.cardId].name) || '';
    body.appendChild(el('div', 'merge-sub', mergeName + ' → <b>' + '★'.repeat(star) + '</b> ' + (star >= 3 ? '三星随从' : '金色随从')));
    var cards = el('div', 'merge-cards');
    for (var i = 0; i < 3; i++) {
      var s = el('img', 'src s' + i); s.src = artFor(data.cardId, star - 1);
      cards.appendChild(s);
    }
    var dst = el('img', 'dst'); dst.src = artFor(data.cardId, star);
    cards.appendChild(dst);
    var flash = el('div', 'merge-flash'); cards.appendChild(flash);
    body.appendChild(cards);
    div.appendChild(body);
    /* 星屑 */
    for (var k = 0; k < 10; k++) {
      var sp = el('div', 'merge-star', '✦');
      sp.style.left = (220 + Math.random() * 220) + 'px';
      sp.style.top = (80 + Math.random() * 100) + 'px';
      sp.style.setProperty('--sx', (Math.random() * 200 - 100) + 'px');
      sp.style.setProperty('--sy', (Math.random() * 120 - 30) + 'px');
      sp.style.animationDelay = (Math.random() * 0.4) + 's';
      div.appendChild(sp);
    }
    setTimeout(function () { dst.classList.add('show'); flash.classList.add('show'); }, 900);
    var dur = star >= 3 ? 1500 : 1800;
    return new Promise(function (r) { setTimeout(function () { div.classList.add('hidden'); r(); }, dur); });
  }

  /* ===================== 发现弹窗 ===================== */
  function discoverModal(meta) {
    return new Promise(function (resolve) {
      var isTriple = meta.reason === 'triple';
      var waitCeremony = isTriple && flow.merge.ceremonyDone ? flow.merge.ceremonyDone : Promise.resolve();
      waitCeremony.then(function () {
        var m = $('modal-discover');
        m.innerHTML = '';
        m.classList.remove('hidden');
        hideTooltip(); /* ★V6 弹窗打开时清掉屏上残留的悬停信息 */
        m.appendChild(el('div', 'm-title', isTriple ? '三连奖励' : '发现随从'));
        m.appendChild(el('div', 'm-note', meta.note || (isTriple ? '从更高一级卡池发现一张随从（三选一）' : '从牌池发现一张随从')));
        var cards = el('div', 'm-cards');
        meta.options.forEach(function (opt) {
          var cid = typeof opt === 'string' ? opt : opt.id;
          var def = CARD_BY_ID[cid];
          if (!def) return;
          var c = minionCard({
            cardId: cid, star: 1, atk: def.atk, hp: def.hp, tier: def.tier, name: def.name,
            tribe: def.tribe, def: def, mode: 'discover', sizeCls: 'sz-discover'
          });
          /* ★V6 候选随从的特殊信息（关键词/技能/族系）改为悬停显示完整 tooltip */
          c.addEventListener('pointerenter', function (e) {
            var r = c.getBoundingClientRect();
            showTooltip({ cardId: cid, star: 1, atk: def.atk, hp: def.hp, tier: def.tier,
              name: def.name, tribe: def.tribe, def: def, mode: 'discover' },
              e.clientX != null ? e.clientX : r.left + r.width / 2, r.top);
          });
          c.addEventListener('pointerleave', hideTooltip);
          c.onclick = function () {
            hideTooltip();
            m.classList.add('hidden');
            resolve(cid);
          };
          cards.appendChild(c);
        });
        m.appendChild(cards);
        if (!isTriple) {
          var cancel = el('button', 'm-cancel', '放弃');
          cancel.onclick = function () { hideTooltip(); m.classList.add('hidden'); resolve(null); };
          m.appendChild(cancel);
        }
      });
    });
  }

  /* ===================== 目标选择 ===================== */
  function targetMode(meta) {
    flow.target.active = true;
    flow.target.byUid = {};
    meta.options.forEach(function (o) { flow.target.byUid[o.uid] = o; });
    var S = GameCore.state();
    pauseTimer(true);
    var b = $('target-banner');
    b.innerHTML = '';
    b.appendChild(el('span', '', '为「' + meta.def.name + '」选择战吼目标'));
    var cancel = el('button', 'cancel', '取消');
    cancel.onclick = function () { endTarget(); meta.resolve(null); };
    b.appendChild(cancel);
    b.classList.remove('hidden');
    /* 高亮可选目标 */
    var board = $('rc-board');
    meta.options.forEach(function (o) {
      var card = board.querySelector('.mcard[data-uid="' + o.uid + '"]');
      if (card) card.classList.add('targetable');
    });
    function endTarget() {
      flow.target.active = false;
      flow.target.byUid = null;
      b.classList.add('hidden');
      board.querySelectorAll('.mcard.targetable').forEach(function (c) { c.classList.remove('targetable'); });
      pauseTimer(false);
    }
    flow.target.end = endTarget;
    flow.target.resolver = function (pick) { endTarget(); meta.resolve(pick); };
  }

  /* ===================== GameCore ui 接口 ===================== */
  var pendingBuyFx = [];
  var GameUI = {
    update: function () { if (flow.curScreen === 'recruit') renderRecruit(); },
    fx: function (type, data) {
      if (type === 'buy') {
        if (data && data.uid != null) pendingBuyFx.push(data.uid);
      } else if (type === 'sell') {
        toast('卖出 +1 金币');
        var sz = $('rc-sellzone'); if (sz) { var r = sz.getBoundingClientRect(); var c = clientToStage(r.left + r.width / 2, r.top); floatAt(c.x, c.y, '+1金', 'gold'); }
      } else if (type === 'autosell') {
        toast('战场已满：自动卖出最右侧随从 (+1金)');
      } else if (type === 'merge') {
        flow.stats.tripleCount++;
        flow.merge.ceremonyDone = mergeCeremony(data);
      } else if (type === 'buff') {
        var card = document.querySelector('.mcard[data-uid="' + data.uid + '"]');
        if (card) {
          var c = cardCenter(card);
          floatAt(c.x, c.y, '+' + data.atk + (data.hp ? '/+' + data.hp : ''), 'buff');
        }
      } else if (type === 'shieldGain') {
        var card = document.querySelector('.mcard[data-uid="' + data.uid + '"]');
        if (card) { var c = cardCenter(card); floatAt(c.x, c.y, '圣盾', 'shield'); }
      }
    },
    selectTarget: function (opts) {
      return new Promise(function (resolve) {
        targetMode({ minion: opts.minion, options: opts.options, def: opts.def, resolve: resolve });
      });
    },
    discover: function (opts) {
      return discoverModal(opts);
    }
  };

  /* ===================== 初始化 ===================== */
  function init() {
    /* 箭头 marker */
    var svg = $('fx-svg');
    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = '<marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#FFE45C"/></marker>';
    svg.appendChild(defs);

    window.addEventListener('resize', fitStage);
    fitStage();

    /* 商店操作按钮 */
    $('btn-refresh').onclick = function () { var r = GameCore.refreshShop(); if (!r.ok) toast(r.msg || '刷新失败', true); };
    $('btn-freeze').onclick = function () { var r = GameCore.toggleFreeze(); if (!r.ok) toast(r.msg || '冻结失败', true); };
    $('btn-upgrade').onclick = function () { var r = GameCore.upgradeTavern(); if (!r.ok) toast(r.msg || '升级失败', true); };
    $('btn-battle').onclick = startBattle;

    $('btn-start').onclick = function () {
      if (!flow.selectedHero) { toast('请先从 3 位候选英雄中选择一位'); return; } // ★V17 抽选模式校验
      startGame();
    };

    /* ★V11 修复（主页按钮无反应）：「单人游戏」按钮归属 ui.js 自绑——此前绑定在 multi.js，
       一旦 multi.js 404/过期（版本混合窗口），主页两按钮全部失去绑定 → 点击无反应。
       上移后即使多人组件缺失，单人流程照常可进 */
    if ($('btn-mode-single')) {
      $('btn-mode-single').onclick = function () { showScreen('hero'); };
    }
    /* ★V11 多人组件就绪自检：multi.js 未成功加载时，给「多人游戏」按钮可见兜底反馈，不再静默 */
    setTimeout(function () {
      if (!window.__yuyuMultiReady && $('btn-mode-multi')) {
        $('btn-mode-multi').onclick = function () {
          toast('多人组件未加载完成，请刷新页面重试（电脑 Ctrl+F5 / 手机清缓存后重开）', true);
        };
      }
    }, 600);

    /* ★V9 联机版：入口改落主页；选英雄屏照常预渲染（单人流程零改动） */
    renderHeroScreen();
    showScreen('home');
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);

  /* ★V9 对多人模块（multi.js）暴露的最小接口：切屏 + 按指定英雄/配置直接开局 */
  return {
    init: init,
    GameUI: GameUI,
    _showSettle: showSettle,
    _showOver: showOver,
    showScreen: showScreen,
    startWith: function (heroId, difficulty, timerOn) {
      flow.selectedHero = heroId || 'h03';
      flow.difficulty = difficulty || 'hard'; // ★V2.9.4 缺省困难
      flow.timerOn = timerOn !== false;
      startGame();
    }
  };
})();
