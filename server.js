#!/usr/bin/env node
/* =========================================================================
 * 《云屿酒馆》Web 版 —— 联机房间服务 server.js  ★V2.9.5
 * -----------------------------------------------------------------------
 * 职责：
 *   1. /api/room* 房间服务（此前客户端 multi.js 已有调用但从未有服务端实现）
 *      · POST /api/room              建房（房主）
 *      · GET  /api/room/:code        状态轮询（等待房 2s 轮询）
 *      · POST /api/room/:code/join   凭号加入 / 本机 token 重连
 *      · PUT  /api/room/:code        配置上报（选英雄 / 房主改设置）
 *      · POST /api/room/:code/start  开局（★支持机器人补位）
 *      · POST /api/room/:code/beat   心跳（房间保活）
 *   2. 静态托管游戏客户端（/yuyu/ 前缀，与 index.html <base href="/yuyu/"> 对齐）
 *   3. /healthz 健康检查；根路径 / 302 跳转 /yuyu/
 * 机器人补位：房主在对手未加入时可直接开局，空位由 AI（hard 档）顶替——
 *   服务端在 start 时为空位补 AI 座位（guestHero 可由客户端按等待房候选集上报，
 *   缺省 h03），房间 phase → playing，此后真实玩家加入将提示"对局已开始"。
 * 零依赖：仅用 Node 内置模块，npm install 无需执行。Node ≥ 14 即可运行。
 * 房间存储：内存（重启即清空；2 小时无活动自动清理，与客户端提示文案一致）。
 * ========================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ===================== 配置 ===================== */
const PORT = parseInt(process.env.PORT || '8080', 10);
const CLIENT_DIR = process.env.CLIENT_DIR || path.join(__dirname, 'client');
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;   /* 房间 2 小时无活动清理（与客户端提示一致） */
const SWEEP_MS = 60 * 1000;               /* 清理扫描间隔 */
const MAX_ROOMS = 2000;                   /* 房间数上限（内存保护） */
const MAX_BODY = 32 * 1024;               /* 请求体上限 32KB */
/* 房间号字符集：6 位，去除易混淆的 0/O/1/I/L（与客户端输入过滤一致） */
const ROOM_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
/* 英雄白名单（与 data.js HEROES h01~h10 对齐） */
const HERO_IDS = ['h01', 'h02', 'h03', 'h04', 'h05', 'h06', 'h07', 'h08', 'h09', 'h10'];
const DIFF_IDS = ['hard'];                /* ★V2.9.4 单档困难；非 hard 一律归一 hard */
const BOT_NAME = 'AI·机器人补位';
const DEFAULT_BOT_HERO = 'h03';

/* ===================== 房间表 ===================== */
const rooms = new Map();  /* code -> room */

function newToken() { return crypto.randomBytes(18).toString('hex'); }

function newCode() {
  for (let tries = 0; tries < 200; tries++) {
    let s = '';
    for (let i = 0; i < 6; i++) s += ROOM_CHARS[crypto.randomInt(ROOM_CHARS.length)];
    if (!rooms.has(s)) return s;
  }
  return null;
}

function normName(v) {
  const s = String(v == null ? '' : v).trim();
  return (s.slice(0, 20)) || '无名酒客';
}

function normDifficulty(v) { return DIFF_IDS.indexOf(v) >= 0 ? v : DIFF_IDS[0]; }

function roomView(r) {
  return {
    version: r.version,
    phase: r.phase,
    hostName: r.host.name,
    guestName: r.guest ? r.guest.name : null,
    hostHero: r.host.hero,
    guestHero: r.guest ? r.guest.hero : null,
    bot: !!(r.guest && r.guest.bot),
    settings: { difficulty: r.settings.difficulty, timerOn: r.settings.timerOn },
    startedAt: r.startedAt || null
  };
}

function createRoom(name) {
  if (rooms.size >= MAX_ROOMS) return null;
  const code = newCode();
  if (!code) return null;
  const now = Date.now();
  const room = {
    code: code,
    version: 0,
    phase: 'waiting',
    createdAt: now,
    lastActive: now,
    host: { name: normName(name), token: newToken(), hero: null },
    guest: null,
    settings: { difficulty: DIFF_IDS[0], timerOn: true },
    startedAt: null
  };
  rooms.set(code, room);
  return room;
}

function touch(room) { room.lastActive = Date.now(); }

/* 定时清理：2 小时无活动的房间（对局开始后客户端会持续心跳保活） */
setInterval(function () {
  const now = Date.now();
  rooms.forEach(function (r, code) {
    if (now - r.lastActive > ROOM_TTL_MS) {
      rooms.delete(code);
      console.log('[清理] 房间 ' + code + ' 超时无活动，已移除（剩余 ' + rooms.size + '）');
    }
  });
}, SWEEP_MS).unref();

/* ===================== 工具 ===================== */
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function apiError(res, status, code) { json(res, status, { error: code }); }

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

/* ===================== API 处理 ===================== */
function handleCreate(req, res, body) {
  const room = createRoom(body.name);
  if (!room) return apiError(res, 503, 'SERVER_BUSY');
  console.log('[建房] ' + room.code + ' 房主「' + room.host.name + '」（当前 ' + rooms.size + ' 房）');
  json(res, 200, { role: 'host', token: room.host.token, roomCode: room.code });
}

function handleGet(res, code) {
  const r = rooms.get(code);
  if (!r) return apiError(res, 404, 'ROOM_NOT_FOUND');
  json(res, 200, { room: roomView(r) });
}

function handleJoin(req, res, code, body) {
  const r = rooms.get(code);
  if (!r) return apiError(res, 404, 'ROOM_NOT_FOUND');
  const token = body.token ? String(body.token) : null;
  /* 本机 token 重连：还原原身份（昵称顺带更新） */
  if (token && r.host.token === token) {
    r.host.name = normName(body.name);
    touch(r);
    return json(res, 200, { role: 'host', token: r.host.token, roomCode: code, room: roomView(r) });
  }
  if (token && r.guest && !r.guest.bot && r.guest.token === token) {
    r.guest.name = normName(body.name);
    touch(r);
    return json(res, 200, { role: 'guest', token: r.guest.token, roomCode: code, room: roomView(r) });
  }
  /* 新加入 */
  if (r.phase !== 'waiting') return apiError(res, 409, 'ROOM_IN_GAME');
  if (r.guest) return apiError(res, 409, 'ROOM_FULL');
  r.guest = { name: normName(body.name), token: newToken(), hero: null, bot: false };
  r.version += 1;
  touch(r);
  console.log('[加入] ' + code + ' 客人「' + r.guest.name + '」');
  json(res, 200, { role: 'guest', token: r.guest.token, roomCode: code, room: roomView(r) });
}

function handlePut(req, res, code, body) {
  const r = rooms.get(code);
  if (!r) return apiError(res, 404, 'ROOM_NOT_FOUND');
  if (r.phase !== 'waiting') return apiError(res, 409, 'ROOM_IN_GAME');
  const token = body.token ? String(body.token) : '';
  const isHost = r.host.token === token;
  const isGuest = !!(r.guest && !r.guest.bot && r.guest.token === token);
  if (!isHost && !isGuest) return apiError(res, 403, 'FORBIDDEN');
  if (body.hero !== undefined) {
    if (HERO_IDS.indexOf(body.hero) < 0) return apiError(res, 400, 'HERO_INVALID');
    if (isHost) r.host.hero = body.hero; else r.guest.hero = body.hero;
  }
  if (body.settings !== undefined) {
    if (!isHost) return apiError(res, 403, 'FORBIDDEN');   /* 客人只读（与前端渲染口径一致） */
    const s = body.settings || {};
    if (s.difficulty !== undefined) r.settings.difficulty = normDifficulty(s.difficulty);
    if (s.timerOn !== undefined) r.settings.timerOn = !!s.timerOn;
  }
  r.version += 1;
  touch(r);
  json(res, 200, { room: roomView(r) });
}

function handleStart(req, res, code, body) {
  const r = rooms.get(code);
  if (!r) return apiError(res, 404, 'ROOM_NOT_FOUND');
  if (r.host.token !== (body.token ? String(body.token) : '')) return apiError(res, 403, 'FORBIDDEN');
  if (r.phase === 'playing') return json(res, 200, { room: roomView(r) });   /* 幂等：防双击/刷新重复开局 */
  if (!r.host.hero) return apiError(res, 409, 'HERO_NOT_READY');
  if (!r.guest) {
    /* ★V2.9.5 机器人补位：对手未加入，空位由 AI（hard 档）顶替 */
    const bh = HERO_IDS.indexOf(body.botHero) >= 0 ? body.botHero : DEFAULT_BOT_HERO;
    r.guest = { name: BOT_NAME, token: null, hero: bh, bot: true };
    console.log('[补位] ' + code + ' AI 顶替空位（对手未加入，难度 ' + r.settings.difficulty + '，英雄 ' + bh + '）');
  } else if (!r.guest.hero) {
    return apiError(res, 409, 'HERO_NOT_READY');
  }
  r.phase = 'playing';
  r.startedAt = Date.now();
  r.version += 1;
  touch(r);
  console.log('[开局] ' + code + ' 房主「' + r.host.name + '」vs 「' + r.guest.name + '」' + (r.guest.bot ? '（机器人补位）' : ''));
  json(res, 200, { room: roomView(r) });
}

function handleBeat(req, res, code, body) {
  const r = rooms.get(code);
  if (!r) return apiError(res, 404, 'ROOM_NOT_FOUND');
  const token = body.token ? String(body.token) : '';
  const ok = r.host.token === token || !!(r.guest && r.guest.token && r.guest.token === token);
  if (ok) touch(r);
  json(res, 200, { ok: ok });
}

/* ===================== 静态托管 ===================== */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm'
};

function serveStatic(req, res, pathname) {
  /* / → 302 跳转 /yuyu/（保持与客户端 <base href="/yuyu/">、分享链接一致） */
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(302, { Location: '/yuyu/' });
    return res.end();
  }
  if (pathname === '/healthz') {
    return json(res, 200, { ok: true, service: 'yunyu-tavern', rooms: rooms.size, uptime: Math.round(process.uptime()) });
  }
  if (pathname !== '/yuyu' && pathname.indexOf('/yuyu/') !== 0) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 Not Found（游戏位于 /yuyu/ 路径）');
  }
  let rel = pathname === '/yuyu' ? '/' : pathname.slice('/yuyu'.length);
  try { rel = decodeURIComponent(rel); } catch (e) { rel = '/'; }
  /* 防路径穿越 */
  const abs = path.normalize(path.join(CLIENT_DIR, rel));
  if (abs !== CLIENT_DIR && abs.indexOf(CLIENT_DIR + path.sep) !== 0) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }
  let file = abs;
  let st = null;
  try { st = fs.statSync(file); } catch (e) { st = null; }
  if (st && st.isDirectory()) { file = path.join(file, 'index.html'); try { st = fs.statSync(file); } catch (e) { st = null; } }
  if (!st) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 Not Found');
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*'
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ===================== 路由分发 ===================== */
const ROOM_CODE_RE = /^[2-9A-HJ-NP-Z]{6}$/;

const server = http.createServer(function (req, res) {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (e) {}
  /* CORS 预检（跨端口/跨域联调场景；生产同源不触发） */
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }
  if (pathname.indexOf('/api/') === 0) {
    const seg = pathname.split('/').filter(Boolean);   /* ['api', 'room', code, 'start'] */
    /* POST /api/room */
    if (req.method === 'POST' && pathname === '/api/room') {
      return readBody(req).then(function (body) { handleCreate(req, res, body); }).catch(function (e) {
        apiError(res, 400, e.message === 'INVALID_JSON' ? 'INVALID_JSON' : 'BODY_TOO_LARGE');
      });
    }
    /* /api/room/:code 系列 */
    if (seg[0] === 'api' && seg[1] === 'room' && seg.length >= 3) {
      const code = String(seg[2]).toUpperCase();
      if (!ROOM_CODE_RE.test(code)) return apiError(res, 404, 'ROOM_NOT_FOUND');
      const action = seg[3] || '';
      if (req.method === 'GET' && !action) return handleGet(res, code);
      if (req.method === 'POST' && action === 'join') {
        return readBody(req).then(function (body) { handleJoin(req, res, code, body); }).catch(function (e) {
          apiError(res, 400, e.message === 'INVALID_JSON' ? 'INVALID_JSON' : 'BODY_TOO_LARGE');
        });
      }
      if (req.method === 'PUT' && !action) {
        return readBody(req).then(function (body) { handlePut(req, res, code, body); }).catch(function (e) {
          apiError(res, 400, e.message === 'INVALID_JSON' ? 'INVALID_JSON' : 'BODY_TOO_LARGE');
        });
      }
      if (req.method === 'POST' && action === 'start') {
        return readBody(req).then(function (body) { handleStart(req, res, code, body); }).catch(function (e) {
          apiError(res, 400, e.message === 'INVALID_JSON' ? 'INVALID_JSON' : 'BODY_TOO_LARGE');
        });
      }
      if (req.method === 'POST' && action === 'beat') {
        return readBody(req).then(function (body) { handleBeat(req, res, code, body); }).catch(function (e) {
          apiError(res, 400, e.message === 'INVALID_JSON' ? 'INVALID_JSON' : 'BODY_TOO_LARGE');
        });
      }
    }
    return apiError(res, 404, 'NOT_FOUND');
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('405 Method Not Allowed');
});

server.listen(PORT, function () {
  console.log('==============================================');
  console.log('  《云屿酒馆》联机房间服务已启动');
  console.log('  端口: ' + PORT + '   客户端目录: ' + CLIENT_DIR);
  console.log('  本机试玩:   http://localhost:' + PORT + '/yuyu/');
  console.log('  健康检查:   http://localhost:' + PORT + '/healthz');
  console.log('  外网访问需将此端口通过 Nginx 反代或防火墙放行');
  console.log('==============================================');
});

process.on('uncaughtException', function (e) { console.error('[异常兜底]', e && e.message); });
process.on('unhandledRejection', function (e) { console.error('[Promise兜底]', e && (e.message || e)); });
