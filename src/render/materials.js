/**
 * src/render/materials.js
 * ------------------------------------------------------------
 * 秦式材质库 —— 100% 程序化，零外部资源。
 * 所有贴图均由 Canvas2D 在运行时绘制成 THREE.CanvasTexture。
 *
 * 契约导出：
 *   getMaterials()      -> 材质库对象（懒加载 + 全局缓存复用）
 *   disposeMaterials()  -> 释放全部材质与贴图
 *
 * 附加导出（供 pieceFactory / boardMesh / engineering-lead 复用）：
 *   PALETTE
 *   getBaseTopMaterial(glyph, side)
 *   getBannerMaterial(glyph, side)
 *   createLeiWenTexture / createWoodTexture / createTextTexture
 *   createBaseTopTexture / createBannerTexture
 *
 * 设计原则：红黑双方**形制完全相同、材质与配色不同**。
 *   红方 = 赤红戎装 + 鎏金/青铜配件 + 暖调
 *   黑方 = 玄黑甲胄 + 冷银/暗铜配件 + 冷调
 */

import * as THREE from 'three';

/* ============================================================
 * 0. 秦式配色（唯一真相源）
 *    engineering-lead 可原样落到 src/core/constants.js 的 PALETTE
 * ============================================================ */
export const PALETTE = {
  /* 玄黑 —— 秦尚黑，水德 */
  xuan:        '#1a1a1f',
  xuanLight:   '#2b2b33',
  xuanRim:     '#5b6270',   // 冷灰高光
  /* 赤红 —— 秦军赤色戎装、旗帜 */
  chi:         '#8c1c1c',
  chiBright:   '#c0392b',
  chiDeep:     '#5e1212',
  /* 青铜 —— 兵器与甲片 */
  bronze:      '#8d7440',
  bronzeDark:  '#6e5a3a',
  /* 玉白 —— 士/象的文人素袍 */
  jade:        '#d8d4c8',
  jadeCool:    '#c6ccd0',
  /* 朱漆 —— 战车与抛石机木构 */
  zhu:         '#a8321f',
  zhuDark:     '#6d2416',
  /* 鎏金 —— 主帅装饰 */
  gold:        '#c9a227',
  goldDim:     '#8e7020',
  /* 冷银 —— 黑方配件 */
  silver:      '#9aa3ae',
  silverDim:   '#666e7a',
  /* 辅助 */
  skin:        '#c6a481',
  skinCool:    '#b39572',
  leather:     '#6b4a2c',
  leatherDark: '#33291f',
  wood:        '#5a4231',
  woodDark:    '#31241b',
  rope:        '#8a7455',
  bone:        '#e6ddc7',
  ink:         '#0d0c0b',
  stone:       '#33323a',
  ground:      '#14141a',
  flame:       '#ff9840',
  /* UI 同源色（styles/main.css 使用同一套） */
  uiBg:        '#12100e',
  uiPanel:     '#1a1714',
  uiAccent:    '#c0392b',
  uiGold:      '#c9a227'
};

/* ============================================================
 * 1. Canvas 贴图工具
 * ============================================================ */

const _textures = new Set();
const _extraMats = new Map();

function track(tex) { _textures.add(tex); return tex; }

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, opts = {}) {
  const {
    repeat = [1, 1],
    srgb = true,
    aniso = 8,
    wrap = THREE.RepeatWrapping
  } = opts;
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = wrap;
  t.wrapT = wrap;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return track(t);
}

/** 单个方形回旋（雷纹基元） */
function drawSpiral(ctx, cx, cy, s, mirror) {
  ctx.save();
  ctx.translate(cx, cy);
  if (mirror) ctx.rotate(Math.PI);
  ctx.beginPath();
  const half = s / 2;
  let x = -half;
  let y = half;
  ctx.moveTo(x, y);
  const dirs = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  let len = s;
  const step = s * 0.26;
  for (let i = 0; i < 7; i++) {
    const d = dirs[i % 4];
    x += d[0] * len;
    y += d[1] * len;
    ctx.lineTo(x, y);
    if (i % 2 === 1) len -= step;
    if (len < s * 0.2) break;
  }
  ctx.stroke();
  ctx.restore();
}

/** 一条云雷纹饰带 */
function drawLeiWenBand(ctx, x, y, w, h, color, lw, unit) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  const n = Math.max(1, Math.round(w / unit));
  const u = w / n;
  const s = Math.min(u * 0.82, h * 0.82);
  for (let i = 0; i < n; i++) {
    drawSpiral(ctx, x + i * u + u / 2, y + h / 2, s, i % 2 === 1);
  }
  ctx.restore();
}

/**
 * 秦式云雷纹 / 夔龙纹饰带贴图（底座侧面、旗面边框通用）
 */
export function createLeiWenTexture(opts = {}) {
  const {
    w = 512,
    h = 128,
    bg = PALETTE.xuan,
    bg2 = null,
    fg = PALETTE.gold,
    repeat = [3, 1],
    lw = 5
  } = opts;
  const cv = mkCanvas(w, h);
  const ctx = cv.getContext('2d');

  if (bg2) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, bg2);
    g.addColorStop(0.5, bg);
    g.addColorStop(1, bg2);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = bg;
  }
  ctx.fillRect(0, 0, w, h);

  // 上下阑线
  ctx.strokeStyle = fg;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(2, h * 0.035);
  ctx.beginPath();
  ctx.moveTo(0, h * 0.12); ctx.lineTo(w, h * 0.12);
  ctx.moveTo(0, h * 0.88); ctx.lineTo(w, h * 0.88);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 主饰带
  drawLeiWenBand(ctx, 0, h * 0.16, w, h * 0.68, fg, lw, w / 8);

  // 轻微磨损噪点，避免塑料感
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    d[i] = Math.min(255, Math.max(0, d[i] + n));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  return toTexture(cv, { repeat });
}

/**
 * 程序化木纹（棋盘台面、战车/抛石机木构）
 */
export function createWoodTexture(opts = {}) {
  const {
    w = 1024,
    h = 1024,
    base = PALETTE.wood,
    dark = PALETTE.woodDark,
    light = '#6e5340',
    grains = 46,
    vertical = false,
    vignette = 0.45,
    repeat = [1, 1]
  } = opts;
  const cv = mkCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  if (vertical) {
    ctx.translate(w, 0);
    ctx.rotate(Math.PI / 2);
  }
  const L = vertical ? h : w;
  const H = vertical ? w : h;

  // 年轮式条纹
  for (let i = 0; i < grains; i++) {
    const y0 = (i / grains) * H + (Math.random() - 0.5) * (H / grains) * 0.8;
    const amp = 4 + Math.random() * 16;
    const freq = 1 + Math.random() * 2.4;
    const phase = Math.random() * Math.PI * 2;
    ctx.beginPath();
    for (let x = 0; x <= L; x += 8) {
      const y = y0 + Math.sin((x / L) * Math.PI * 2 * freq + phase) * amp;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = Math.random() > 0.45 ? dark : light;
    ctx.globalAlpha = 0.12 + Math.random() * 0.26;
    ctx.lineWidth = 1 + Math.random() * 4.5;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // 细噪点
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  // 暗角
  if (vignette > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.18, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + vignette + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  return toTexture(cv, { repeat });
}

/**
 * 透明底的文字贴图（河界"楚河/漢界"、UI 牌匾等）
 */
export function createTextTexture(text, opts = {}) {
  const {
    w = 1024,
    h = 512,
    color = PALETTE.bone,
    shadow = 'rgba(0,0,0,0.85)',
    fontSize = null,
    letterSpacing = 0.18,
    glow = PALETTE.gold
  } = opts;
  const cv = mkCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const chars = Array.from(text);
  const fs = fontSize || Math.min(h * 0.78, (w / Math.max(1, chars.length)) * 0.92);
  ctx.font = '700 ' + Math.round(fs) + 'px "STKaiti","KaiTi","STSong","SimSun","Songti SC",serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const adv = fs * (1 + letterSpacing);
  const total = adv * chars.length;
  let x = w / 2 - total / 2 + adv / 2;

  for (const ch of chars) {
    ctx.save();
    ctx.shadowColor = shadow;
    ctx.shadowBlur = fs * 0.14;
    ctx.shadowOffsetY = fs * 0.035;
    ctx.fillStyle = color;
    ctx.fillText(ch, x, h / 2);
    ctx.restore();
    if (glow) {
      ctx.save();
      ctx.lineWidth = Math.max(2, fs * 0.028);
      ctx.strokeStyle = glow;
      ctx.globalAlpha = 0.55;
      ctx.strokeText(ch, x, h / 2);
      ctx.restore();
    }
    x += adv;
  }
  return toTexture(cv, { wrap: THREE.ClampToEdgeWrapping });
}

/**
 * 棋子底座顶面贴图（汉字标识 + 内凹装饰环）
 *
 * ★ UV 推导（关键）：THREE.CylinderGeometry 顶盖 UV 为
 *      u = z / (2R) + 0.5 ，v = x / (2R) + 0.5
 *   即 canvas 右 = 世界 +Z，canvas 上 = 世界 +X。
 *   俯视时（相机在 +Z 上方）屏幕右 = +X = canvas 上，屏幕上 = -Z = canvas 左。
 *   → 文字需 rotate(-PI/2) 才能被 +Z 侧玩家正读；rotate(+PI/2) 被 -Z 侧玩家正读。
 *   汉字绘制在**外圈环带**（半径 0.55R~0.95R），中心留给人物立柱台，绝不遮挡。
 */
export function createBaseTopTexture(glyph, side, opts = {}) {
  const S = opts.size || 512;
  const warm = side === 'r';
  const cv = mkCanvas(S, S);
  const ctx = cv.getContext('2d');
  const C = S / 2;

  const faceA = warm ? '#3a1c17' : '#1c1c22';
  const faceB = warm ? '#24110e' : '#101014';
  const ringC = warm ? PALETTE.gold : PALETTE.silver;
  const glyphC = warm ? '#ffd98a' : '#dfe6ee';

  // 底盘渐变
  const g = ctx.createRadialGradient(C, C, S * 0.06, C, C, C);
  g.addColorStop(0, faceA);
  g.addColorStop(0.62, faceA);
  g.addColorStop(1, faceB);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(C, C, C, 0, Math.PI * 2);
  ctx.fill();

  // 内凹装饰环（两道）
  ctx.strokeStyle = ringC;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = S * 0.014;
  ctx.beginPath(); ctx.arc(C, C, C * 0.94, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = S * 0.008;
  ctx.beginPath(); ctx.arc(C, C, C * 0.52, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;

  // 四方雷纹小点（分隔）
  ctx.fillStyle = ringC;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    ctx.save();
    ctx.translate(C + Math.cos(a) * C * 0.72, C + Math.sin(a) * C * 0.72);
    ctx.rotate(a);
    ctx.globalAlpha = 0.8;
    ctx.fillRect(-S * 0.035, -S * 0.012, S * 0.07, S * 0.024);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // 汉字 ×2（分别面向 +Z / -Z 玩家），落在 0.55R~0.92R 的环带内，不与立台/顶沿冲突
  const fs = Math.round(S * 0.185);
  const rr = C * 0.73;
  const drawGlyph = (px, py, rot) => {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rot);
    ctx.font = '700 ' + fs + 'px "STKaiti","KaiTi","STSong","SimSun","Songti SC",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = fs * 0.16;
    ctx.fillStyle = glyphC;
    ctx.fillText(glyph, 0, 0);
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1.5, fs * 0.022);
    ctx.strokeStyle = warm ? '#8c1c1c' : '#0a0a0d';
    ctx.globalAlpha = 0.7;
    ctx.strokeText(glyph, 0, 0);
    ctx.restore();
  };
  // canvas 右 = 世界 +Z ；canvas 左 = 世界 -Z
  drawGlyph(C + rr, C, -Math.PI / 2);
  drawGlyph(C - rr, C, Math.PI / 2);

  return toTexture(cv, { wrap: THREE.ClampToEdgeWrapping, aniso: 16 });
}

/**
 * 旗面贴图：云雷纹边框 + 中央大字
 */
export function createBannerTexture(glyph, side, opts = {}) {
  const w = opts.w || 384;
  const h = opts.h || 512;
  const warm = side === 'r';
  const cv = mkCanvas(w, h);
  const ctx = cv.getContext('2d');

  const fieldA = warm ? '#b3271d' : '#20202a';
  const fieldB = warm ? '#7a1512' : '#0f0f15';
  const trim = warm ? PALETTE.gold : PALETTE.silver;

  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, fieldA);
  g.addColorStop(1, fieldB);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 边框
  ctx.strokeStyle = trim;
  ctx.lineWidth = w * 0.035;
  ctx.strokeRect(w * 0.07, h * 0.055, w * 0.86, h * 0.89);

  // 上下云雷饰带
  drawLeiWenBand(ctx, w * 0.09, h * 0.075, w * 0.82, h * 0.09, trim, w * 0.014, w * 0.21);
  drawLeiWenBand(ctx, w * 0.09, h * 0.835, w * 0.82, h * 0.09, trim, w * 0.014, w * 0.21);

  // 中央大字
  const fs = Math.round(w * 0.56);
  ctx.font = '700 ' + fs + 'px "STKaiti","KaiTi","STSong","SimSun","Songti SC",serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = fs * 0.12;
  ctx.fillStyle = warm ? '#ffe9b0' : '#e8eef5';
  ctx.fillText(glyph, w / 2, h * 0.5);
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(2, fs * 0.02);
  ctx.strokeStyle = warm ? '#5e1212' : '#000000';
  ctx.globalAlpha = 0.6;
  ctx.strokeText(glyph, w / 2, h * 0.5);
  ctx.globalAlpha = 1;

  // 布纹
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 20;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  return toTexture(cv, { wrap: THREE.ClampToEdgeWrapping, aniso: 8 });
}

/* ============================================================
 * 2. 材质库
 * ============================================================ */

let _lib = null;

function std(color, roughness, metalness, extra) {
  return new THREE.MeshStandardMaterial(
    Object.assign({ color: new THREE.Color(color), roughness, metalness }, extra || {})
  );
}

/**
 * 材质分档（PBR 数值规范，全项目统一）：
 *   布料  roughness 0.85  metalness 0.00
 *   皮革  roughness 0.72  metalness 0.05
 *   甲片  roughness 0.35  metalness 0.85
 *   兵刃  roughness 0.28  metalness 0.92
 *   木构  roughness 0.70  metalness 0.05
 *   玉石  roughness 0.25  metalness 0.00
 *   鎏金  roughness 0.30  metalness 0.95
 */
function buildLibrary() {
  const leiRed = createLeiWenTexture({
    bg: '#341612', bg2: '#1d0b09', fg: PALETTE.gold, repeat: [4, 1]
  });
  const leiBlack = createLeiWenTexture({
    bg: '#1b1b21', bg2: '#0d0d11', fg: PALETTE.silver, repeat: [4, 1]
  });

  const woodTop = createWoodTexture({
    w: 1024, h: 1024, base: '#4a3527', dark: '#251a12', light: '#634834',
    grains: 54, vignette: 0.5
  });
  const woodEdge = createWoodTexture({
    w: 512, h: 256, base: '#3b2a1e', dark: '#1d140e', light: '#523b2b',
    grains: 26, vignette: 0.1, repeat: [3, 1]
  });
  const woodPiece = createWoodTexture({
    w: 256, h: 256, base: '#6a3a24', dark: '#3a1d12', light: '#8a4a2c',
    grains: 22, vignette: 0.15, repeat: [2, 2]
  });
  const woodPieceDark = createWoodTexture({
    w: 256, h: 256, base: '#332a26', dark: '#171313', light: '#463a34',
    grains: 22, vignette: 0.15, repeat: [2, 2]
  });

  /* ---- 通用（红黑共用） ---- */
  const common = {
    skin:        std(PALETTE.skin, 0.78, 0.0),
    skinCool:    std(PALETTE.skinCool, 0.78, 0.0),
    bronze:      std(PALETTE.bronze, 0.35, 0.85),
    bronzeDark:  std(PALETTE.bronzeDark, 0.45, 0.75),
    blade:       std('#b9b3a0', 0.28, 0.92),
    steelDark:   std('#5a606b', 0.34, 0.88),
    leather:     std(PALETTE.leather, 0.72, 0.05),
    leatherDark: std(PALETTE.leatherDark, 0.75, 0.05),
    rope:        std(PALETTE.rope, 0.9, 0.0),
    hair:        std('#15130f', 0.85, 0.02),
    stone:       std('#6d6a63', 0.9, 0.02),
    bone:        std(PALETTE.bone, 0.6, 0.0),
    ink:         std(PALETTE.ink, 0.9, 0.0),
    paper:       std('#cfc3a2', 0.85, 0.0),
    flame:       new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.flame),
      emissive: new THREE.Color('#ff7a1a'),
      emissiveIntensity: 2.4,
      roughness: 1.0,
      metalness: 0.0,
      transparent: true,
      opacity: 0.88,
      depthWrite: false
    })
  };

  /* ---- 红方：赤红戎装 + 鎏金/青铜 + 暖调 ---- */
  const r = {
    cloth:     std('#a8281f', 0.85, 0.0),
    clothDeep: std(PALETTE.chi, 0.85, 0.0),
    clothLight:std('#c94a33', 0.85, 0.0),
    robe:      std('#e0d6bd', 0.85, 0.0),      // 象/相 素袍（暖白）
    armor:     std(PALETTE.bronze, 0.35, 0.85),
    armorDeep: std(PALETTE.bronzeDark, 0.42, 0.8),
    accent:    std(PALETTE.gold, 0.3, 0.95),
    accentDim: std(PALETTE.goldDim, 0.4, 0.85),
    leather:   std('#7a4a28', 0.72, 0.05),
    /** 披风专用：双面布料 */
    capeCloth: std('#8f2018', 0.86, 0.0, { side: THREE.DoubleSide }),
    wood:      std(PALETTE.zhu, 0.7, 0.05, { map: woodPiece }),
    woodDeep:  std(PALETTE.zhuDark, 0.72, 0.05),
    jade:      std('#e3dcc6', 0.25, 0.0),
    skin:      common.skin,
    baseSide:  std('#7a3428', 0.62, 0.25, { map: leiRed }),
    baseBottom:std('#1a0f0c', 0.9, 0.05),
    baseRim:   std(PALETTE.gold, 0.3, 0.95),
    pedestal:  std('#2e1512', 0.7, 0.15),
    plume:     std('#d9432c', 0.8, 0.0)
  };

  /* ---- 黑方：玄黑甲胄 + 冷银/暗铜 + 冷调 ---- */
  const b = {
    cloth:     std('#22222b', 0.85, 0.0),
    clothDeep: std(PALETTE.xuan, 0.85, 0.0),
    clothLight:std('#3a3a46', 0.85, 0.0),
    robe:      std(PALETTE.jadeCool, 0.85, 0.0),  // 象 素袍（冷白）
    armor:     std('#767d88', 0.35, 0.85),
    armorDeep: std('#4c525c', 0.42, 0.8),
    accent:    std(PALETTE.silver, 0.3, 0.95),
    accentDim: std(PALETTE.silverDim, 0.4, 0.85),
    leather:   std('#3b3129', 0.72, 0.05),
    /** 披风专用：双面布料 */
    capeCloth: std('#1e1e26', 0.86, 0.0, { side: THREE.DoubleSide }),
    wood:      std('#4a3d38', 0.7, 0.05, { map: woodPieceDark }),
    woodDeep:  std('#2a2320', 0.72, 0.05),
    jade:      std(PALETTE.jadeCool, 0.25, 0.0),
    skin:      common.skinCool,
    baseSide:  std('#2c2c36', 0.62, 0.25, { map: leiBlack }),
    baseBottom:std('#0b0b0f', 0.9, 0.05),
    baseRim:   std(PALETTE.silver, 0.3, 0.95),
    pedestal:  std('#16161d', 0.7, 0.15),
    plume:     std('#7f8896', 0.8, 0.0)
  };

  /* ---- 棋盘 / 环境 ---- */
  const board = {
    top:      std('#6a5140', 0.66, 0.06, { map: woodTop }),
    edge:     std('#4a3527', 0.72, 0.06, { map: woodEdge }),
    frame:    std(PALETTE.zhu, 0.55, 0.15),
    frameGold:std(PALETTE.gold, 0.32, 0.92),
    line:     std('#e8dcbc', 0.55, 0.1, {
      emissive: new THREE.Color('#3a2f18'), emissiveIntensity: 0.6
    }),
    ground:   std(PALETTE.ground, 1.0, 0.0),
    platform: std(PALETTE.stone, 0.92, 0.05),
    riverText: new THREE.MeshStandardMaterial({
      map: createTextTexture('楚河', { color: '#efe4c4', glow: PALETTE.gold }),
      transparent: true,
      roughness: 0.7,
      metalness: 0.05,
      depthWrite: false,
      side: THREE.FrontSide
    }),
    riverText2: new THREE.MeshStandardMaterial({
      map: createTextTexture('漢界', { color: '#efe4c4', glow: PALETTE.gold }),
      transparent: true,
      roughness: 0.7,
      metalness: 0.05,
      depthWrite: false,
      side: THREE.FrontSide
    })
  };

  /* ---- FX / 高亮（emissive 变体，命名清晰） ---- */
  const fx = {
    /** 选中棋子：底座光环（鎏金自发光） */
    selectRing: new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffd76a'), transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false
    }),
    /** 合法空落点：玉青光圈 */
    moveHint: new THREE.MeshBasicMaterial({
      color: new THREE.Color('#6fe0c0'), transparent: true, opacity: 0.7,
      side: THREE.DoubleSide, depthWrite: false
    }),
    /** 可吃子落点：赤红危险环 */
    captureHint: new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff4b39'), transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false
    }),
    /** 蹩马腿 / 塞象眼阻挡点：灰叉 */
    blockMark: new THREE.MeshBasicMaterial({
      color: new THREE.Color('#8a8a92'), transparent: true, opacity: 0.6,
      side: THREE.DoubleSide, depthWrite: false
    }),
    /** 被将军的帅：脉冲红光 */
    checkGlow: new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff2f1f'), transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthWrite: false
    }),
    /** 底座 emissive 变体：选中时替换 baseRim 用 */
    baseRimGlowR: std(PALETTE.gold, 0.28, 0.9, {
      emissive: new THREE.Color('#ffbf3a'), emissiveIntensity: 1.6
    }),
    baseRimGlowB: std(PALETTE.silver, 0.28, 0.9, {
      emissive: new THREE.Color('#7fd8ff'), emissiveIntensity: 1.4
    }),
    /** 悬停微亮 */
    hoverRing: new THREE.MeshBasicMaterial({
      color: new THREE.Color('#f0e2b0'), transparent: true, opacity: 0.35,
      side: THREE.DoubleSide, depthWrite: false
    })
  };

  return {
    palette: PALETTE,
    common,
    r,
    b,
    board,
    fx,
    /** 便捷：按阵营取材质集 */
    side(id) { return id === 'r' ? this.r : this.b; }
  };
}

/**
 * 取材质库（懒加载 + 全局缓存）
 * @returns {object}
 */
export function getMaterials() {
  if (!_lib) _lib = buildLibrary();
  return _lib;
}

/**
 * 底座顶面材质（含汉字标识），按 glyph+side 缓存
 */
export function getBaseTopMaterial(glyph, side) {
  const key = 'basetop:' + glyph + ':' + side;
  let m = _extraMats.get(key);
  if (!m) {
    const tex = createBaseTopTexture(glyph, side);
    m = new THREE.MeshStandardMaterial({
      map: tex,
      // 字面自发光：底座顶面朝上，在斜俯视角下极易整片落入棋子自身的阴影，
      // 单靠外部布光无法根治。用同一张贴图兼作 emissiveMap，
      // 让字形的亮部自带微光——暗处能读、亮处也不会糊成白斑。
      // 强度压在 0.3 以内：再高会让字面在主光直射下过曝发白。
      emissiveMap: tex,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.28,
      roughness: 0.5,
      metalness: 0.2
    });
    _extraMats.set(key, m);
  }
  return m;
}

/**
 * 旗面材质（双面 + 汉字），按 glyph+side 缓存
 */
export function getBannerMaterial(glyph, side) {
  const key = 'banner:' + glyph + ':' + side;
  let m = _extraMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: createBannerTexture(glyph, side),
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide
    });
    _extraMats.set(key, m);
  }
  return m;
}

function disposeDeep(node, seen) {
  if (!node || typeof node !== 'object') return;
  if (node.isMaterial) {
    if (!seen.has(node)) { seen.add(node); node.dispose(); }
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) disposeDeep(v, seen);
    return;
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === 'object') disposeDeep(v, seen);
  }
}

/**
 * 释放全部材质与贴图。
 * ⚠ 调用前请先调用 pieceFactory.disposePieceFactory() 与 board/env 的 userData.dispose()。
 */
export function disposeMaterials() {
  const seen = new Set();
  if (_lib) disposeDeep(_lib, seen);
  for (const m of _extraMats.values()) {
    if (!seen.has(m)) { seen.add(m); m.dispose(); }
  }
  _extraMats.clear();
  for (const t of _textures) t.dispose();
  _textures.clear();
  _lib = null;
}
