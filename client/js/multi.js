/* =========================================================================
 * 《云屿酒馆》Web 版 - multi.js  ★V9 联机版新增
 * 多人流程前端：主页分流 → 多人大厅（建房/凭号加入）→ 等待房（选英雄/配置/
 * 开局）。数据通道为同源 /api/room*；等待房状态以 2s 轮询刷新。
 * 依赖：data.js（HEROES/DIFFICULTIES）、assets.js（ASSETS.portrait）、
 *       ui.js（UI.showScreen / UI.startWith）
 * 本轮范围：房间流程。对局实时同步（RemoteHost/Snapshot 适配器）下轮接入。
 * ========================================================================= */
'use strict';

var Multi = (function () {
  function $(id) { return document.getElementById(id); }

  var API = {
    create: function (body) { return req('POST', '/api/room', body); },
    get: function (code) { return req('GET', '/api/room/' + code); },
    join: function (code, body) { return req('POST', '/api/room/' + code + '/join', body); },
    put: function (code, body) { return req('PUT', '/api/room/' + code, body); },
    start: function (code, body) { return req('POST', '/api/room/' + code + '/start', body); },
    beat: function (code, body) { return req('POST', '/api/room/' + code + '/beat', body); }
  };

  function req(method, url, body) {
    var opt = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opt.body = JSON.stringify(body);
    return fetch(url, opt).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.error) {
          var e = new Error(data.error || ('HTTP ' + res.status));
          e.code = data.error; e.status = res.status;
          throw e;
        }
        return data;
      });
    });
  }

  /* ===================== 本地状态 ===================== */
  var me = { role: null, token: null, code: null, name: '' };
  var lastVersion = -1;      /* 变化检测：version 变了才重绘（防按钮闪烁） */
  var lastRoom = null;       /* ★V2.9.5 机器人补位：最近一次房间快照（开局按钮据此判断对手是否已加入） */
  var pollHandle = null;
  var starting = false;      /* 防重复开局 */

  var LS_NICK = 'yuyu_nick';
  function tokenKey(code) { return 'yuyu_room_token_' + code; }

  function saveNick(n) { try { localStorage.setItem(LS_NICK, n); } catch (e) {} }
  function loadNick() { try { return localStorage.getItem(LS_NICK) || ''; } catch (e) { return ''; } }
  function saveToken(code, t) { try { localStorage.setItem(tokenKey(code), t); } catch (e) {} }
  function loadToken(code) { try { return localStorage.getItem(tokenKey(code)); } catch (e) { return null; } }
  function clearToken(code) { try { localStorage.removeItem(tokenKey(code)); } catch (e) {} }

  /* ===================== 工具 ===================== */
  var ERR_TEXT = {
    ROOM_NOT_FOUND: '房间不存在，请核对房间号',
    ROOM_FULL: '房间已满（已有两位玩家）',
    ROOM_IN_GAME: '该房间对局已开始，无法加入',
    HERO_NOT_READY: '双方都选定英雄后才能开始',
    GUEST_NOT_JOINED: '对手还未加入房间',
    FORBIDDEN: '身份校验失败，请重新加入房间',
    NETWORK: '网络异常，请稍后再试'
  };
  function errText(e) { return ERR_TEXT[e.code] || e.message || '操作失败'; }

  function toast(msg, err) {
    var box = $('toasts'); if (!box) return;
    var t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 2700);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
  }

  /* ===================== 主页 ===================== */
  /* ★V11 防御式绑定：HTML/JS 版本混合（缓存旧页或资源加载失败）时，缺失元素仅告警，
     不再因 TypeError 中断 init 导致主页所有按钮失去绑定 */
  function bindClick(id, fn) {
    var node = $(id);
    if (!node) { console.warn('[multi] 绑定跳过：页面缺少 #' + id + '（HTML/JS 版本不一致?）'); return; }
    node.onclick = fn;
  }
  function bindHome() {
    /* ★V11 「单人游戏」绑定已上移 ui.js（单人流程不依赖本模块），此处仅绑多人入口 */
    bindClick('btn-mode-multi', function () { enterLobby(); });
  }

  /* ===================== 多人大厅 ===================== */
  function enterLobby() {
    $('mp-nick').value = loadNick();
    var urlRoom = getQueryParam('room');
    if (urlRoom) $('mp-join-code').value = urlRoom.toUpperCase();
    setLobbyMsg('');
    UI.showScreen('lobby');
  }
  function getQueryParam(k) {
    var m = location.search.match(new RegExp('[?&]' + k + '=([^&]+)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function setLobbyMsg(text, err) {
    var m = $('lobby-msg');
    m.textContent = text || '';
    m.classList.toggle('err', !!err);
  }

  function bindLobby() {
    var codeInput = $('mp-join-code');
    if (!codeInput) { console.warn('[multi] 绑定跳过：页面缺少 #mp-join-code'); return; }
    codeInput.addEventListener('input', function () {
      /* 只留合法字符：大写化 + 去 0/O/1/I/L + 截断 6 位 */
      this.value = this.value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 6);
    });
    codeInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') doJoin(); });

    bindClick('btn-create-room', doCreate);
    bindClick('btn-join-room', doJoin);
    bindClick('btn-lobby-back', function () { UI.showScreen('home'); });
  }

  function readNick() {
    var n = $('mp-nick').value.trim() || '无名酒客';
    saveNick(n);
    return n;
  }

  function doCreate() {
    setLobbyMsg('正在创建房间…');
    me.name = readNick();
    API.create({ name: me.name }).then(function (r) {
      me.role = r.role; me.token = r.token; me.code = r.roomCode;
      saveToken(r.roomCode, r.token);
      enterRoom();
    }).catch(function (e) {
      setLobbyMsg('创建失败：' + errText(e), true);
    });
  }

  function doJoin() {
    var code = $('mp-join-code').value.trim().toUpperCase();
    if (code.length !== 6) { setLobbyMsg('请输入完整的 6 位房间号', true); return; }
    me.name = readNick();
    setLobbyMsg('正在加入房间 ' + code + ' …');
    API.join(code, { name: me.name, token: loadToken(code) }).then(function (r) {
      me.role = r.role; me.token = r.token; me.code = code;
      saveToken(code, r.token);
      enterRoom();
    }).catch(function (e) {
      setLobbyMsg('加入失败：' + errText(e), true);
    });
  }

  /* ===================== 等待房 ===================== */
  function enterRoom() {
    lastVersion = -1;
    starting = false;
    $('room-code').textContent = me.code;
    $('seat-host-name').textContent = '…';
    $('seat-guest-name').textContent = '等待对手…';
    $('btn-room-start').disabled = true;
    $('room-share-link').textContent = shareLink(me.code);
    $('mp-guest-overlay').classList.add('hidden');
    UI.showScreen('room');
    startPolling();
  }

  function shareLink(code) {
    return location.origin + '/yuyu/?room=' + code;
  }

  function startPolling() {
    stopPolling();
    tick();
    pollHandle = setInterval(tick, 2000);
  }
  function stopPolling() {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  }

  function tick() {
    if (!me.code || !me.token) return;
    API.get(me.code).then(function (r) {
      renderRoom(r.room);
      API.beat(me.code, { token: me.token }).catch(function () {});
    }).catch(function (e) {
      if (e.code === 'ROOM_NOT_FOUND') {
        stopPolling();
        clearToken(me.code);
        toast('房间已失效（超过2小时无活动）', true);
        UI.showScreen('lobby');
      }
    });
  }

  function renderRoom(room) {
    if (room.version === lastVersion) return;   /* 无变化不重绘 */
    lastVersion = room.version;
    lastRoom = room;                            /* ★V2.9.5 快照供开局按钮判断 */

    var isHost = me.role === 'host';
    $('seat-host-name').textContent = room.hostName || '房主';
    $('seat-guest-name').textContent = room.guestName || '等待对手…';

    /* 双方英雄选择区（★V2.4 三选一）：各自座位只渲染该座位抽到的候选，自己的可点，对方的只读展示 */
    renderSeatHeroes('host', room.hostHero, isHost);
    renderSeatHeroes('guest', room.guestHero, !isHost);

    $('seat-host-status').textContent = room.hostHero ? ('已选定：' + heroName(room.hostHero)) : '未选英雄';
    $('seat-guest-status').textContent = room.guestName
      ? (room.guestHero ? ('已选定：' + heroName(room.guestHero)) : '未选英雄')
      : '尚未加入';

    /* 设置区：房主可改，客人只读 */
    renderSettings(room.settings, isHost);

    /* 状态行 + 开始按钮 */
    var ready = !!(room.guestName && room.hostHero && room.guestHero);
    /* ★V2.9.5 机器人补位：对手未加入时，房主选定英雄即可直接开局，空位由 AI（hard 档）顶替 */
    var canStart = isHost && room.phase === 'waiting' && !!room.hostHero && (!room.guestName || ready);
    var statusEl = $('room-status');
    if (room.phase === 'playing') {
      statusEl.textContent = '对局进行中';
    } else if (!room.guestName) {
      statusEl.textContent = room.hostHero
        ? '对手未加入——可直接开局（AI 机器人补位），好友仍可凭房间号加入'
        : '等待对手加入…（可复制房间号或下方链接发给好友）';
    } else if (!ready) {
      statusEl.textContent = '双方都选定英雄后，房主即可开始游戏';
    } else {
      statusEl.textContent = isHost ? '准备就绪！点击开始游戏' : '准备就绪！等待房主开始游戏';
    }
    var startBtn = $('btn-room-start');
    startBtn.disabled = !canStart;
    startBtn.textContent = (canStart && !room.guestName) ? '与 AI 开局（机器人补位）' : '开 始 游 戏';
    /* ★开始按钮仅房主可见（客人只读等待） */
    startBtn.classList.toggle('hidden', !isHost);

    /* 客人端：房主已开局 → 过渡提示浮层 */
    if (room.phase === 'playing' && !isHost) {
      stopPolling();
      $('mp-guest-overlay').classList.remove('hidden');
      return;
    }

    /* 房主端：phase 变为 playing（例如自己点了开始后刷新）→ 以房主视角进对局 */
    if (room.phase === 'playing' && isHost && !starting) {
      stopPolling();
      hostBegin(room);
      return;
    }
  }

  function heroName(id) {
    for (var i = 0; i < HEROES.length; i++) if (HEROES[i].id === id) return HEROES[i].short;
    return id;
  }

  function renderSeatHeroes(seat, selectedHero, clickable) {
    var box = $('seat-' + seat + '-heroes');
    box.innerHTML = '';
    /* ★V2.4 N 选一（默认三选一，CFG.HERO_DRAFT_CHOICES）：每个座位只渲染该座位抽到的候选。
       候选集以「房间号|座位」为 key 的确定性抽选（GameCore.seededHeroDraft）——双方各自本地
       计算，对同一座位渲染出完全一致的候选，无竞态、无需服务端存储，换房间即换抽选。
       自己座位可点选提交，对方座位只读展示；若已选英雄不在候选内（旧房遗留/异常数据）
       仅不高亮，不阻塞开局。 */
    var draftIds = GameCore.seededHeroDraft((me.code || '') + '|' + seat);
    draftIds.forEach(function (hid) {
      var h = HERO_BY_ID[hid];
      var card = document.createElement('div');
      card.className = 'seat-hero' + (selectedHero === h.id ? ' selected' : '') + (clickable ? ' clickable' : '');
      var im = document.createElement('img');
      /* ★修复 2026-09-04：头像补回退链（内联SVG → 相对路径 → icons.js占位剪影）。
         原写法 ASSETS.portrait(h.id) || '' 在 h04-h10 无立绘时 src 为空串，渲染裂图。 */
      var psrc = ASSETS.portrait(h.id);
      if (psrc && typeof EMBEDDED_SVG !== 'undefined' && EMBEDDED_SVG[psrc]) psrc = EMBEDDED_SVG[psrc];
      im.src = psrc || ICONS.svgDataURI(ICONS.portraitSVG(h.id));
      im.alt = h.short;
      card.appendChild(im);
      var name = document.createElement('div');
      name.className = 'seat-hero-name';
      name.textContent = h.short;
      card.appendChild(name);
      if (clickable) {
        card.onclick = function () {
          API.put(me.code, { token: me.token, hero: h.id }).then(function (r) {
            lastVersion = -1; renderRoom(r.room);
          }).catch(function (e) { toast(errText(e), true); });
        };
      }
      box.appendChild(card);
    });
  }

  /* ★V2.9.4 难度白名单净化：DIFFICULTIES 仅剩 hard 单档，任何来源（旧房间存档/旧客户端上报）
     的 'easy'/'normal' 等历史值一律归一为 'hard'——口径：非 hard 即按 hard 执行。 */
  function normDifficulty(v) {
    for (var i = 0; i < DIFFICULTIES.length; i++) {
      if (DIFFICULTIES[i].id === v) return v;
    }
    return DIFFICULTIES[0].id;
  }

  function renderSettings(settings, isHost) {
    settings.difficulty = normDifficulty(settings.difficulty); /* ★V2.9.4 渲染前净化（旧档兼容） */
    var dg = $('mp-opt-difficulty'); dg.innerHTML = '';
    var label = document.createElement('span');
    label.className = 'opt-label';
    label.textContent = 'AI 难度：';
    dg.appendChild(label);
    DIFFICULTIES.forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'opt-chip' + (settings.difficulty === d.id ? ' on' : '');
      b.textContent = d.name;
      if (isHost) {
        b.onclick = function () {
          API.put(me.code, { token: me.token, settings: { difficulty: d.id, timerOn: settings.timerOn !== false } })
            .then(function (r) { lastVersion = -1; renderRoom(r.room); })
            .catch(function (e) { toast(errText(e), true); });
        };
      } else {
        b.disabled = true;   /* 客人只读 */
      }
      dg.appendChild(b);
    });

    var tg = $('mp-opt-timer'); tg.innerHTML = '';
    var tl = document.createElement('span');
    tl.className = 'opt-label';
    tl.textContent = '招募限时：';
    tg.appendChild(tl);
    var tb = document.createElement('button');
    tb.className = 'opt-chip' + (settings.timerOn !== false ? ' toggle-on' : '');
    tb.textContent = settings.timerOn !== false ? '开启 ✓' : '关闭';
    if (isHost) {
      tb.onclick = function () {
        API.put(me.code, { token: me.token, settings: { difficulty: normDifficulty(settings.difficulty), timerOn: !(settings.timerOn !== false) } } /* ★V2.9.4 上报前净化 */)
          .then(function (r) { lastVersion = -1; renderRoom(r.room); })
          .catch(function (e) { toast(errText(e), true); });
      };
    } else {
      tb.disabled = true;
    }
    tg.appendChild(tb);
  }

  /* 房主开局：进入现有单机对局逻辑（本轮过渡方案），并推进房间的 phase */
  function hostBegin(room) {
    if (starting) return;
    starting = true;
    var settings = room.settings || {};
    UI.startWith(room.hostHero, normDifficulty(settings.difficulty), settings.timerOn !== false); /* ★V2.9.4 开局前净化 */
    /* 房主在局内时保持低频心跳，避免 2 小时内被清理的风险（对局一般远短于此） */
  }

  /* ===================== 绑定与启动 ===================== */
  function bindRoom() {
    bindClick('btn-copy-code', function () {
      copyText(me.code || '').then(function (ok) {
        toast(ok ? '房间号已复制：' + me.code : '复制失败，请手动记下房间号', !ok);
      });
    });
    bindClick('btn-room-start', function () {
      /* ★V2.9.5 机器人补位：对手未加入时上报 AI 座位英雄——取等待房客人座候选首位
         （GameCore.seededHeroDraft('房间号|guest') 确定性抽选，与座位渲染同源无竞态） */
      var body = { token: me.token };
      if (lastRoom && !lastRoom.guestName) {
        var draft = GameCore.seededHeroDraft((me.code || '') + '|guest');
        if (draft && draft.length) body.botHero = draft[0];
      }
      API.start(me.code, body).then(function (r) {
        stopPolling();
        lastVersion = -1;
        hostBegin(r.room);
      }).catch(function (e) { toast(errText(e), true); });
    });
    bindClick('btn-room-back', function () {
      stopPolling();
      if (me.code) clearToken(me.code);
      me.code = null; me.token = null; me.role = null;
      UI.showScreen('home');
    });
    bindClick('btn-guest-leave', function () {
      if (me.code) clearToken(me.code);
      me.code = null; me.token = null; me.role = null;
      UI.showScreen('home');
    });
  }

  function init() {
    if (typeof UI === 'undefined') return; /* ui.js 未就绪（不应发生） */
    bindHome();
    bindLobby();
    bindRoom();
    window.__yuyuMultiReady = true; /* ★V11 就绪标记：ui.js 据此决定「多人游戏」按钮兜底提示 */

    /* 带 ?room= 深链打开：预填房间号直达大厅；若本机存有该房 token 自动尝试重连 */
    var urlRoom = getQueryParam('room');
    if (urlRoom && /^[2-9A-HJ-NP-Z]{6}$/.test(urlRoom.toUpperCase())) {
      var code = urlRoom.toUpperCase();
      var saved = loadToken(code);
      if (saved) {
        API.join(code, { name: readNick(), token: saved }).then(function (r) {
          me.role = r.role; me.token = r.token; me.code = code;
          enterRoom();
          return;
        }).catch(function () {
          enterLobby();
        });
        return;
      }
      /* ★无本机存档：带房间号直达大厅（房间号已预填，填昵称即可加入） */
      enterLobby();
      return;
    }
    /* 无深链：停在主页（ui.js 已落主页，此处兜底） */
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);

  return { init: init };
})();
