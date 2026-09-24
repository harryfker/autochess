/* =========================================================================
 * 《云屿酒馆》 Web 版 - icons.js
 * CSS/SVG 占位美术（文档第2章三族配色）。绮梦者的正式素材放入
 * assets/icons/{随从名}.svg|.png 后将自动优先加载（见 ui.js 的 asset 链）。
 * 每个图标 100×100 viewBox，族系主色打底 + 剪影。
 * ========================================================================= */

'use strict';

var ICONS = (function () {
  var C = { gear: '#C9A227', wild: '#3E7C4F', tide: '#3A6EA5', neutral: '#8C8A84' };
  var DARK = { gear: '#8a6f18', wild: '#2a5236', tide: '#274d73', neutral: '#5e5c57' };
  var LIGHT = { gear: '#e8cf6a', wild: '#6fb383', tide: '#7aa8d6', neutral: '#b3b1aa' };

  function wrap(tribe, inner, bg2) {
    var c = C[tribe] || C.neutral, d = DARK[tribe] || DARK.neutral;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs><radialGradient id="g" cx="50%" cy="38%" r="75%">' +
      '<stop offset="0%" stop-color="' + (bg2 || LIGHT[tribe] || LIGHT.neutral) + '" stop-opacity=".35"/>' +
      '<stop offset="70%" stop-color="' + c + '" stop-opacity=".18"/>' +
      '<stop offset="100%" stop-color="' + d + '" stop-opacity=".38"/></radialGradient></defs>' +
      '<rect width="100" height="100" rx="14" fill="url(#g)"/>' + inner + '</svg>';
  }

  // —— 常用部件 ——
  function shield(x, y, s, fill) {
    return '<path transform="translate(' + x + ',' + y + ') scale(' + s + ')" d="M20 0 L40 8 V26 C40 42 32 52 20 58 C8 52 0 42 0 26 V8 Z" fill="' + fill + '"/>';
  }
  function gearShape(x, y, s, fill) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">' +
      '<circle r="18" fill="' + fill + '"/><circle r="8" fill="#00000055"/>' +
      '<g fill="' + fill + '">' +
      [0, 45, 90, 135, 180, 225, 270, 315].map(function (a) {
        return '<rect x="-4" y="-26" width="8" height="12" rx="2" transform="rotate(' + a + ')"/>';
      }).join('') + '</g></g>';
  }
  function wolfHead(x, y, s, fill, dark) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">' +
      '<path d="M-26 8 L-20 -14 L-8 -4 L0 -22 L8 -4 L20 -14 L26 8 L14 18 L0 24 L-14 18 Z" fill="' + fill + '"/>' +
      '<circle cx="-8" cy="2" r="3" fill="' + dark + '"/><circle cx="8" cy="2" r="3" fill="' + dark + '"/>' +
      '<path d="M-4 10 L0 16 L4 10 Z" fill="' + dark + '"/></g>';
  }
  function bubble(x, y, r, fill, op) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" opacity="' + (op || 0.8) + '"/>';
  }

  var ART = {
    /* —— 齿轮族 —— */
    m01: function () { return wrap('gear', shield(30, 22, 1, C.gear) + gearShape(50, 52, 0.42, LIGHT.gear) + '<circle cx="50" cy="52" r="6" fill="' + DARK.gear + '"/>'); },
    m02: function () { return wrap('gear', '<rect x="24" y="40" width="52" height="34" rx="6" fill="' + C.gear + '"/>' + gearShape(30, 34, 0.3, LIGHT.gear) + '<path d="M36 74 V60 h8 M56 74 V54 h8" stroke="' + DARK.gear + '" stroke-width="4" fill="none" stroke-linecap="round"/>'); },
    m03: function () { return wrap('gear', '<path d="M46 16 L54 16 L56 44 L44 44 Z" fill="' + LIGHT.gear + '"/><rect x="42" y="44" width="16" height="10" rx="2" fill="' + DARK.gear + '"/><path d="M30 58 Q50 78 70 58" stroke="' + C.gear + '" stroke-width="7" fill="none" stroke-linecap="round"/>'); },
    m11: function () { return wrap('gear', shield(28, 20, 1.15, C.gear) + '<rect x="36" y="30" width="28" height="36" rx="6" fill="' + LIGHT.gear + '"/>' + '<circle cx="50" cy="42" r="5" fill="' + DARK.gear + '"/><rect x="42" y="52" width="16" height="6" rx="3" fill="' + DARK.gear + '"/>'); },
    m12: function () { return wrap('gear', '<path d="M28 62 L22 26 L44 40 Z" fill="' + C.gear + '"/><rect x="40" y="34" width="20" height="26" rx="10" fill="' + LIGHT.gear + '"/>' + '<path d="M60 40 L82 28 L78 64 Z" fill="' + C.gear + '"/>' + bubble(62, 72, 6, LIGHT.gear)); },
    m59: function () { return wrap('gear', '<path d="M22 44 q7 7 0 14 M14 44 q7 7 0 14 M6 44 q7 7 0 14" stroke="' + DARK.gear + '" stroke-width="4" fill="none" stroke-linecap="round"/>' + '<rect x="26" y="43" width="38" height="16" rx="8" fill="' + LIGHT.gear + '"/>' + '<path d="M60 34 L86 45 L86 57 L60 68 Z" fill="' + C.gear + '"/>' + '<circle cx="70" cy="51" r="4" fill="' + DARK.gear + '"/>' + '<circle cx="79" cy="51" r="3" fill="' + LIGHT.gear + '"/>'); }, // ★V2.7 蓄压撞锤（压缩弹簧+撞锤头）
    m21: function () { return wrap('gear', '<path d="M20 70 L50 18 L80 70 Z" fill="' + C.gear + '"/>' + '<path d="M34 70 L50 42 L66 70 Z" fill="' + LIGHT.gear + '"/>' + '<path d="M28 76 H72" stroke="' + DARK.gear + '" stroke-width="5" stroke-linecap="round"/>'); },
    m22: function () { return wrap('gear', shield(24, 14, 1.35, C.gear) + '<circle cx="50" cy="46" r="7" fill="' + DARK.gear + '"/>' + [30, 50, 70].map(function (x) { return '<circle cx="' + x + '" cy="62" r="3" fill="' + DARK.gear + '"/>'; }).join('')); },
    m23: function () { return wrap('gear', '<rect x="40" y="14" width="20" height="56" rx="4" fill="' + C.gear + '"/>' + '<path d="M60 20 L86 30 L60 40 Z" fill="' + LIGHT.gear + '"/>' + shield(16, 46, 0.6, LIGHT.gear) + bubble(30, 84, 5, LIGHT.gear)); },
    m31: function () { return wrap('gear', '<circle cx="50" cy="42" r="24" fill="' + C.gear + '"/>' + '<circle cx="50" cy="42" r="15" fill="' + LIGHT.gear + '"/>' + '<path d="M30 74 H70 M35 82 H65" stroke="' + C.gear + '" stroke-width="6" stroke-linecap="round"/>'); },
    m32: function () { return wrap('gear', '<path d="M28 70 C28 44 40 30 50 26 C60 30 72 44 72 70 Z" fill="' + C.gear + '"/>' + bubble(50, 42, 10, LIGHT.gear, 0.95) + bubble(38, 56, 5, LIGHT.gear) + bubble(62, 56, 5, LIGHT.gear) + '<path d="M40 20 L44 30 M60 20 L56 30" stroke="' + LIGHT.gear + '" stroke-width="3" stroke-linecap="round"/>'); },

    /* —— 荒野族 —— */
    m04: function () { return wrap('wild', wolfHead(50, 46, 1.2, C.wild, DARK.wild) + wolfHead(24, 74, 0.62, LIGHT.wild, DARK.wild) + wolfHead(76, 74, 0.62, LIGHT.wild, DARK.wild)); },
    m05: function () { return wrap('wild', '<ellipse cx="50" cy="56" rx="26" ry="22" fill="' + C.wild + '"/>' + '<circle cx="50" cy="32" r="14" fill="' + LIGHT.wild + '"/>' + '<circle cx="45" cy="30" r="2.6" fill="' + DARK.wild + '"/><circle cx="55" cy="30" r="2.6" fill="' + DARK.wild + '"/>' + [24, 32, 40, 48, 56, 64, 72, 80].map(function (a) { return '<path d="M50 18 L' + (50 + 26 * Math.cos(a * 0.11)) + ' ' + (18 + 10 * Math.sin(a * 0.8)) + '" stroke="' + C.wild + '" stroke-width="3" stroke-linecap="round"/>'; }).join('')); },
    m06: function () { return wrap('wild', '<path d="M18 76 Q50 30 82 76 Z" fill="' + DARK.wild + '"/>' + '<ellipse cx="50" cy="56" rx="18" ry="16" fill="' + C.wild + '"/>' + '<circle cx="44" cy="52" r="2.6" fill="' + DARK.wild + '"/><circle cx="56" cy="52" r="2.6" fill="' + DARK.wild + '"/>' + '<path d="M42 62 Q50 68 58 62" stroke="' + DARK.wild + '" stroke-width="2.5" fill="none"/>'); },
    m14: function () { return wrap('wild', '<path d="M26 60 Q26 30 50 30 Q74 30 74 60 Q74 78 50 78 Q26 78 26 60 Z" fill="' + C.wild + '"/>' + '<path d="M30 44 Q22 26 38 24 M70 44 Q78 26 62 24" stroke="' + LIGHT.wild + '" stroke-width="6" fill="none" stroke-linecap="round"/>' + '<circle cx="42" cy="52" r="3.4" fill="' + DARK.wild + '"/><circle cx="58" cy="52" r="3.4" fill="' + DARK.wild + '"/>'); },
    m15: function () { return wrap('wild', '<circle cx="50" cy="52" r="22" fill="' + C.wild + '"/>' + '<circle cx="28" cy="46" r="11" fill="' + LIGHT.wild + '"/><circle cx="72" cy="46" r="11" fill="' + LIGHT.wild + '"/><circle cx="50" cy="24" r="8" fill="' + LIGHT.wild + '"/>' + '<circle cx="28" cy="46" r="3" fill="' + DARK.wild + '"/><circle cx="72" cy="46" r="3" fill="' + DARK.wild + '"/><circle cx="50" cy="24" r="2.4" fill="' + DARK.wild + '"/>'); },
    m16: function () { return wrap('wild', wolfHead(50, 48, 1.35, C.wild, DARK.wild) + '<circle cx="76" cy="22" r="13" fill="' + LIGHT.gear + '"/>' + '<circle cx="72" cy="20" r="11" fill="' + C.wild + '"/>'); },
    m24: function () { return wrap('wild', '<path d="M30 66 Q34 26 50 20 Q66 26 70 66 Q60 80 50 80 Q40 80 30 66 Z" fill="#e08a3c" opacity="0.92"/>' + '<circle cx="43" cy="44" r="3" fill="#fff" opacity=".85"/><circle cx="57" cy="44" r="3" fill="#fff" opacity=".85"/>' + '<path d="M46 56 Q50 60 54 56" stroke="#7a3d12" stroke-width="2.5" fill="none"/>'); },
    m25: function () { return wrap('wild', '<ellipse cx="50" cy="54" rx="16" ry="24" fill="' + C.wild + '"/>' + '<circle cx="50" cy="30" r="12" fill="' + LIGHT.wild + '"/>' + '<path d="M42 24 Q50 14 58 24" stroke="' + DARK.wild + '" stroke-width="4" fill="none"/>' + '<circle cx="46" cy="30" r="2.2" fill="' + DARK.wild + '"/><circle cx="54" cy="30" r="2.2" fill="' + DARK.wild + '"/>' + '<path d="M20 84 Q50 70 80 84" stroke="' + LIGHT.wild + '" stroke-width="3" fill="none" stroke-dasharray="2 5"/>'); },
    m26: function () { return wrap('wild', '<ellipse cx="50" cy="56" rx="34" ry="24" fill="' + C.wild + '"/>' + '<circle cx="50" cy="34" r="17" fill="' + LIGHT.wild + '"/>' + '<path d="M36 22 Q30 8 44 14 M64 22 Q70 8 56 14" stroke="' + LIGHT.wild + '" stroke-width="5" fill="none" stroke-linecap="round"/>' + '<circle cx="43" cy="32" r="2.8" fill="' + DARK.wild + '"/><circle cx="57" cy="32" r="2.8" fill="' + DARK.wild + '"/>' + '<path d="M44 42 L48 46 L52 42 L56 46" stroke="' + DARK.wild + '" stroke-width="2.5" fill="none"/>'); },
    m33: function () { return wrap('wild', wolfHead(50, 44, 1.5, C.wild, '#fff') + '<path d="M34 14 L38 24 M50 10 L50 22 M66 14 L62 24" stroke="' + LIGHT.gear + '" stroke-width="4" stroke-linecap="round"/>'); },
    m34: function () { return wrap('wild', '<circle cx="50" cy="48" r="22" fill="' + C.wild + '"/>' + '<path d="M50 48 m-14 0 a14 14 0 1 1 5 10" stroke="' + LIGHT.wild + '" stroke-width="5" fill="none" stroke-linecap="round"/>' + '<path d="M36 28 L28 14 M64 28 L72 14" stroke="' + LIGHT.wild + '" stroke-width="4" stroke-linecap="round"/>' + '<path d="M30 70 Q50 86 70 70" stroke="' + DARK.wild + '" stroke-width="4" fill="none"/>'); },

    /* —— 潮汐族 —— */
    m07: function () { return wrap('tide', '<path d="M50 22 C64 40 76 48 76 60 C76 74 64 82 50 82 C36 82 24 74 24 60 C24 48 36 40 50 22 Z" fill="' + C.tide + '"/>' + '<path d="M44 44 Q48 40 52 44 L52 60 Q48 64 44 60 Z" fill="' + LIGHT.tide + '"/>' + bubble(68, 30, 6, LIGHT.tide) + bubble(30, 28, 4, LIGHT.tide)); },
    m08: function () { return wrap('tide', '<path d="M30 56 H70 L62 44 H38 Z" fill="' + DARK.tide + '"/>' + '<rect x="36" y="26" width="28" height="20" rx="8" fill="' + C.tide + '"/>' + '<circle cx="58" cy="36" r="4" fill="' + LIGHT.tide + '"/><path d="M24 52 L76 52" stroke="' + LIGHT.tide + '" stroke-width="4" stroke-linecap="round"/>'); },
    m09: function () { return wrap('tide', '<path d="M30 54 Q50 30 70 54 Q60 66 50 62 Q40 66 30 54 Z" fill="' + C.tide + '"/>' + '<path d="M46 40 Q50 24 62 22 M54 44 Q66 36 74 26" stroke="' + LIGHT.tide + '" stroke-width="4" fill="none" stroke-linecap="round"/>' + bubble(66, 20, 4, LIGHT.tide) + bubble(76, 30, 3, LIGHT.tide)); },
    m17: function () { return wrap('tide', '<circle cx="50" cy="52" r="20" fill="' + C.tide + '"/>' + bubble(30, 32, 9, LIGHT.tide) + bubble(70, 30, 7, LIGHT.tide) + bubble(38, 74, 6, LIGHT.tide) + bubble(64, 74, 5, LIGHT.tide) + '<path d="M42 48 Q50 42 58 48" stroke="#fff" stroke-width="2.5" fill="none" opacity=".8"/>'); },
    m18: function () { return wrap('tide', '<ellipse cx="50" cy="58" rx="30" ry="20" fill="' + C.tide + '"/>' + '<circle cx="28" cy="44" r="8" fill="' + LIGHT.tide + '"/><circle cx="72" cy="44" r="8" fill="' + LIGHT.tide + '"/>' + '<path d="M24 30 V14 M34 32 V22 M66 32 V22 M76 30 V14" stroke="' + LIGHT.tide + '" stroke-width="4" stroke-linecap="round"/>' + '<circle cx="42" cy="54" r="2.6" fill="' + DARK.tide + '"/><circle cx="58" cy="54" r="2.6" fill="' + DARK.tide + '"/>'); },
    m19: function () { return wrap('tide', '<path d="M22 56 Q50 34 78 56 L70 64 Q50 48 30 64 Z" fill="' + C.tide + '"/>' + '<path d="M78 56 L88 44 L86 62 Z" fill="' + LIGHT.tide + '"/>' + '<circle cx="30" cy="52" r="3" fill="' + DARK.tide + '"/>'); },
    m27: function () { return wrap('tide', '<path d="M50 18 L54 32 H46 Z M38 26 L44 36 L34 36 Z M62 26 L56 36 L66 36 Z" fill="' + LIGHT.gear + '"/><path d="M32 40 H68 L58 52 H42 Z" fill="' + C.tide + '"/><path d="M46 52 L46 82 M54 52 L54 82" stroke="' + C.tide + '" stroke-width="6" stroke-linecap="round"/><path d="M40 82 H60" stroke="' + LIGHT.tide + '" stroke-width="4" stroke-linecap="round"/>'); },
    m28: function () { return wrap('tide', '<path d="M32 66 Q28 34 50 30 Q72 34 68 66 Q58 74 50 70 Q42 74 32 66 Z" fill="' + C.tide + '"/>' + '<path d="M42 20 Q38 8 48 10 M58 20 Q62 8 52 10" stroke="' + LIGHT.tide + '" stroke-width="3.5" fill="none" stroke-linecap="round"/>' + '<circle cx="44" cy="48" r="2.8" fill="#c33"/><circle cx="56" cy="48" r="2.8" fill="#c33"/>'); },
    m29: function () { return wrap('tide', '<rect x="44" y="20" width="7" height="52" rx="3" fill="' + LIGHT.tide + '"/>' + '<path d="M51 26 Q78 34 74 56 L64 52 Q66 38 51 34 Z" fill="' + C.tide + '"/>' + '<path d="M18 60 Q34 46 52 56 Q70 66 84 54" stroke="' + C.tide + '" stroke-width="5" fill="none" stroke-linecap="round"/>'); },
    m35: function () { return wrap('tide', '<circle cx="50" cy="50" r="26" fill="none" stroke="' + C.tide + '" stroke-width="9"/>' + '<circle cx="50" cy="50" r="12" fill="' + DARK.tide + '"/>' + '<path d="M50 24 Q64 34 60 50" stroke="' + LIGHT.tide + '" stroke-width="4" fill="none"/>' + bubble(50, 50, 5, LIGHT.tide)); },
    m36: function () { return wrap('tide', '<path d="M30 34 Q50 20 70 34 L70 52 Q70 74 50 82 Q30 74 30 52 Z" fill="' + C.tide + '"/>' + '<path d="M38 26 L42 14 L48 24 L54 12 L60 24 L66 16 L66 28" fill="none" stroke="' + LIGHT.gear + '" stroke-width="4" stroke-linejoin="round"/>' + '<circle cx="43" cy="48" r="3" fill="' + LIGHT.tide + '"/><circle cx="57" cy="48" r="3" fill="' + LIGHT.tide + '"/>'); },

    /* —— 中立 —— */
    m10: function () { return wrap('neutral', '<rect x="34" y="26" width="32" height="46" rx="8" fill="' + C.neutral + '"/>' + '<path d="M40 34 Q50 42 60 34 M40 46 Q50 54 60 46 M40 58 Q50 66 60 58" stroke="' + LIGHT.neutral + '" stroke-width="4" fill="none"/>' + '<circle cx="46" cy="38" r="2.4" fill="' + DARK.neutral + '"/><circle cx="54" cy="38" r="2.4" fill="' + DARK.neutral + '"/>'); },
    m20: function () { return wrap('neutral', '<path d="M26 26 H74 V70 H26 Z" fill="' + C.neutral + '"/>' + '<path d="M32 36 H52 M32 44 H64 M32 52 H56 M32 60 H68" stroke="' + LIGHT.neutral + '" stroke-width="3.5"/>' + '<path d="M70 28 L84 40 L74 50 L64 40 Z" fill="' + DARK.neutral + '"/><circle cx="76" cy="38" r="3.4" fill="#fff"/>'); },
    m30: function () { return wrap('neutral', shield(28, 14, 1.25, C.neutral) + '<path d="M44 62 H56 M50 62 V56" stroke="' + LIGHT.gear + '" stroke-width="5" stroke-linecap="round"/>' + '<circle cx="50" cy="48" r="6" fill="' + LIGHT.neutral + '"/>'); },
    m37: function () { return wrap('neutral', '<path d="M56 12 L30 52 H46 L38 88 L72 42 H54 Z" fill="' + '#e8c96a' + '" stroke="' + DARK.neutral + '" stroke-width="2" stroke-linejoin="round"/>'); },
    m38: function () { return wrap('neutral', '<circle cx="50" cy="44" r="18" fill="' + C.neutral + '"/>' + '<path d="M30 40 Q24 30 32 28 M70 40 Q76 30 68 28" stroke="' + LIGHT.neutral + '" stroke-width="4" fill="none" stroke-linecap="round"/>' + '<rect x="36" y="62" width="28" height="16" rx="7" fill="' + C.neutral + '"/>' + '<circle cx="44" cy="42" r="2.6" fill="' + DARK.neutral + '"/><circle cx="56" cy="42" r="2.6" fill="' + DARK.neutral + '"/>'); },

    /* —— 衍生物 —— */
    t01: function () { return wrap('wild', wolfHead(50, 50, 0.9, LIGHT.wild, DARK.wild)); },
    t02: function () { return wrap('wild', '<ellipse cx="50" cy="58" rx="16" ry="13" fill="' + LIGHT.wild + '"/><circle cx="45" cy="55" r="2" fill="' + DARK.wild + '"/><circle cx="55" cy="55" r="2" fill="' + DARK.wild + '"/>'); },
    t03: function () { return wrap('wild', '<circle cx="50" cy="52" r="14" fill="' + LIGHT.wild + '"/><circle cx="36" cy="48" r="7" fill="' + C.wild + '"/><circle cx="64" cy="48" r="7" fill="' + C.wild + '"/><circle cx="50" cy="30" r="5" fill="' + C.wild + '"/>'); },
    t04: function () { return wrap('wild', wolfHead(50, 50, 1.3, C.wild, DARK.wild)); },
    t05: function () { return wrap('wild', '<circle cx="50" cy="54" r="17" fill="' + LIGHT.wild + '"/><circle cx="50" cy="44" r="14" fill="' + C.wild + '"/><circle cx="38" cy="36" r="5" fill="' + DARK.wild + '"/><circle cx="50" cy="32" r="5" fill="' + DARK.wild + '"/><circle cx="62" cy="36" r="5" fill="' + DARK.wild + '"/><circle cx="45" cy="52" r="2" fill="' + DARK.wild + '"/><circle cx="55" cy="52" r="2" fill="' + DARK.wild + '"/><circle cx="50" cy="58" r="2.4" fill="' + DARK.wild + '"/>'); },
    t06: function () { return wrap('wild', '<ellipse cx="50" cy="58" rx="15" ry="12" fill="' + LIGHT.wild + '"/><circle cx="50" cy="40" r="10" fill="' + LIGHT.wild + '"/><path d="M44 32 Q40 22 46 20 M56 32 Q60 22 54 20" stroke="' + C.wild + '" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="46" cy="40" r="1.8" fill="' + DARK.wild + '"/><circle cx="54" cy="40" r="1.8" fill="' + DARK.wild + '"/><circle cx="44" cy="56" r="2.6" fill="' + C.wild + '"/><circle cx="56" cy="58" r="2.2" fill="' + C.wild + '"/>'); },
    t07: function () { return wrap('wild', wolfHead(50, 52, 0.7, LIGHT.wild, DARK.wild)); },
    t08: function () { return wrap('wild', '<rect x="46" y="48" width="8" height="22" rx="3" fill="' + DARK.wild + '"/><circle cx="50" cy="36" r="13" fill="' + C.wild + '"/><circle cx="42" cy="30" r="6" fill="' + LIGHT.wild + '"/><circle cx="58" cy="32" r="5" fill="' + LIGHT.wild + '"/><circle cx="46" cy="56" r="1.8" fill="' + LIGHT.wild + '"/><circle cx="54" cy="56" r="1.8" fill="' + LIGHT.wild + '"/><path d="M46 60 Q50 63 54 60" stroke="' + LIGHT.wild + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>'); },
  };

  /* —— 英雄 / AI 头像占位 —— */
  var PORTRAITS = {
    h01: function () { return wrap('gear', '<path d="M28 58 H72 V70 H28 Z" fill="' + C.gear + '"/><path d="M34 58 V36 Q50 20 66 36 V58" fill="' + DARK.gear + '"/>' + '<circle cx="43" cy="44" r="3.4" fill="#ffdf8a"/><circle cx="57" cy="44" r="3.4" fill="#ffdf8a"/>' + gearShape(50, 78, 0.22, C.gear)); },
    h02: function () { return wrap('neutral', '<path d="M50 16 L58 30 H42 Z M50 84 L42 70 H58 Z M34 50 H20 M80 50 H66 M38 34 L28 24 M62 34 L72 24 M38 66 L28 76 M62 66 L72 76" stroke="' + C.neutral + '" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="50" cy="50" r="9" fill="' + LIGHT.neutral + '"/>'); },
    h03: function () { return wrap('tide', '<path d="M20 60 Q35 42 50 58 Q65 74 80 56" stroke="' + C.tide + '" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="50" cy="36" r="16" fill="' + C.tide + '"/><path d="M42 32 Q50 26 58 32" stroke="#fff" stroke-width="3" fill="none" opacity=".8"/><circle cx="45" cy="36" r="2.4" fill="#fff"/><circle cx="55" cy="36" r="2.4" fill="#fff"/>'); },
    ai1: function () { return wrap('gear', gearShape(50, 40, 0.75, C.gear) + '<path d="M30 68 Q50 84 70 68 L66 78 Q50 90 34 78 Z" fill="' + DARK.gear + '"/><circle cx="43" cy="34" r="2.6" fill="#1b1b1b"/><circle cx="57" cy="34" r="2.6" fill="#1b1b1b"/>'); },
    ai2: function () { return wrap('wild', wolfHead(50, 46, 1.4, C.wild, '#ffd7a1') + '<path d="M36 74 L64 74 M50 74 V86" stroke="' + LIGHT.wild + '" stroke-width="5" stroke-linecap="round"/>'); },
    ai3: function () { return wrap('tide', '<circle cx="50" cy="44" r="20" fill="' + C.tide + '"/>' + '<path d="M32 30 Q50 8 68 30" stroke="' + LIGHT.tide + '" stroke-width="6" fill="none" stroke-linecap="round"/>' + '<circle cx="43" cy="44" r="2.8" fill="#fff"/><circle cx="57" cy="44" r="2.8" fill="#fff"/>' + shield(38, 60, 0.5, LIGHT.tide)); },
    ai4: function () { return wrap('neutral', '<circle cx="50" cy="42" r="20" fill="' + C.neutral + '"/><path d="M30 42 Q50 30 70 42" stroke="' + DARK.neutral + '" stroke-width="7" fill="none"/>' + '<circle cx="43" cy="44" r="2.8" fill="#fff"/><path d="M54 44 L62 44" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' + '<path d="M36 70 H64" stroke="' + C.neutral + '" stroke-width="6" stroke-linecap="round"/>'); },
    ai5: function () { return wrap('neutral', '<path d="M50 14 Q72 26 70 56 Q60 82 50 86 Q40 82 30 56 Q28 26 50 14 Z" fill="#37414d"/>' + '<circle cx="43" cy="46" r="3.2" fill="#9fd6ff"/><circle cx="57" cy="46" r="3.2" fill="#9fd6ff"/>'); },
  };

  function artSVG(cardId) {
    var f = ART[cardId];
    if (f) return f();
    return wrap('neutral', '<circle cx="50" cy="50" r="22" fill="' + C.neutral + '"/>');
  }
  function portraitSVG(id) {
    var f = PORTRAITS[id];
    if (f) return f();
    // ★V17 h04-h10 专属立绘未就位（维克多批次）：稳定轮换既有英雄剪影，
    // 避免英雄回退成 AI 兜帽像；设计§5.3 过渡方案，立绘到位后自然覆盖。
    if (/^h\d+$/.test(id)) return PORTRAITS['h0' + ((parseInt(id.slice(1), 10) - 1) % 3 + 1)]();
    return PORTRAITS.ai5();
  }
  function svgDataURI(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* 关键词小徽标（内联 svg） */
  var KW_ICON = {
    shield: 'M8 1 L14 3.5 V8 C14 12 11.5 14.6 8 16 C4.5 14.6 2 12 2 8 V3.5 Z',
    taunt: 'M8 2 L14 5 L14 9 C14 12.5 11.5 15 8 16 C4.5 15 2 12.5 2 9 L2 5 Z',
    venomous: 'M8 1 C12 5 14 8 14 11 C14 14 11.3 16 8 16 C4.7 16 2 14 2 11 C2 8 4 5 8 1 Z',
    windfury: 'M3 2 L9 8 L5 8 L13 14 L10 8 L14 8 Z',
    cleave: 'M2 14 L9 2 L10 8 L14 4 L7 16 L6 10 Z',
    reborn: 'M8 3 A5 5 0 1 1 3.5 10 L1.8 10 L4.5 14 L7.2 10 L5.5 10 A3.4 3.4 0 1 0 8 5.4 Z',
    deathrattle: 'M5 2 H11 V6 A4 4 0 0 1 8 10 A4 4 0 0 1 5 6 Z M7 11 H9 V15 H7 Z',
    battlecry: 'M3 6 H10 V3 L15 8 L10 13 V10 H3 Z',
    aura: 'M8 3 L10 6.5 L14 7 L11 10 L12 14 L8 12 L4 14 L5 10 L2 7 L6 6.5 Z',
    startofcombat: 'M9 1 L3 9 H7 L6 15 L13 6 H9 Z',
  };
  function kwIcon(kw, color) {
    var p = KW_ICON[kw];
    if (!p) return '';
    return '<svg viewBox="0 0 16 16" class="kwicon"><path d="' + p + '" fill="' + (color || '#e8e4d8') + '"/></svg>';
  }

  return { artSVG: artSVG, portraitSVG: portraitSVG, svgDataURI: svgDataURI, kwIcon: kwIcon, COLORS: C };
})();
