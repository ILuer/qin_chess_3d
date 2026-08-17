#!/usr/bin/env node
/**
 * gen-icons.mjs —— L1 PWA 程序化图标生成（release-ops-lead）
 *
 * 纯 Node 零依赖：手工实现 PNG 编码（zlib 内置 deflate + CRC32），
 * 用软件光栅化（SDF 抗锯齿）绘制「秦风 · 3D 中国象棋」图标：
 *   深色棋盘底 + 细金描边 + 9×10 楚河汉界网格 + 中心红帅（金圈 + 金"帅"字）
 *
 * 用法：node scripts/gen-icons.mjs
 * 输出：icons/icon-192.png、icons/icon-512.png（默认）
 *
 * 说明：图标内容变更必须改文件名（与 /vendor immutable 同一纪律），
 *       或整体递增 sw.js 的 CACHE_NAME 强制换缓存。
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'icons');

// ---------------------------------------------------------------------------
// PNG 编码（纯 Node，零依赖）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 把 RGBA 像素缓冲编码为 PNG Buffer */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 软件光栅化（SDF 抗锯齿 + 源上叠加合成）
// ---------------------------------------------------------------------------

class Canvas {
  constructor(size) {
    this.size = size;
    this.data = new Uint8ClampedArray(size * size * 4);
  }

  /** 源上叠加：dst = src over dst */
  blend(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size || a <= 0) return;
    const i = (y * this.size + x) * 4;
    const da = this.data[i + 3] / 255;
    const outA = a + da * (1 - a);
    if (outA <= 0) return;
    this.data[i]     = Math.round((r * a + this.data[i]     * da * (1 - a)) / outA);
    this.data[i + 1] = Math.round((g * a + this.data[i + 1] * da * (1 - a)) / outA);
    this.data[i + 2] = Math.round((b * a + this.data[i + 2] * da * (1 - a)) / outA);
    this.data[i + 3] = Math.round(outA * 255);
  }

  /** 圆角矩形（S=size 归一化坐标），colorFn(x,y)->[r,g,b] 渐变，alpha 常量 */
  fillRoundedRect(x0, y0, x1, y1, r, colorFn, alpha = 1) {
    const S = this.size;
    const X0 = Math.floor(x0 * S), X1 = Math.ceil(x1 * S);
    const Y0 = Math.floor(y0 * S), Y1 = Math.ceil(y1 * S);
    const rad = r * S;
    for (let py = Y0; py <= Y1; py++) {
      for (let px = X0; px <= X1; px++) {
        const cx = (px + 0.5) / S, cy = (py + 0.5) / S;
        // 圆角矩形 SDF（负值在内）
        const qx = Math.abs(cx - (x0 + x1) / 2) - (x1 - x0) / 2 + r;
        const qy = Math.abs(cy - (y0 + y1) / 2) - (y1 - y0) / 2 + r;
        const dist = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) * S - rad;
        const cov = Math.max(0, Math.min(1, 0.5 - dist));
        if (cov <= 0) continue;
        const [r2, g2, b2] = colorFn(cx, cy);
        this.blend(px, py, r2, g2, b2, cov * alpha);
      }
    }
  }

  /** 圆环 / 实心圆（归一化坐标），colorFn(cx,cy)->[r,g,b] */
  fillDisc(cx0, cy0, outerR, colorFn, innerR = 0, alpha = 1) {
    const S = this.size;
    const rOut = outerR * S, rIn = innerR * S;
    const x0 = Math.floor((cx0 - outerR) * S), x1 = Math.ceil((cx0 + outerR) * S);
    const y0 = Math.floor((cy0 - outerR) * S), y1 = Math.ceil((cy0 + outerR) * S);
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const cx = (px + 0.5) / S, cy = (py + 0.5) / S;
        const d = Math.hypot(cx - cx0, cy - cy0) * S;
        const cov = Math.max(0, Math.min(1, 0.5 - (d - rOut))) * Math.max(0, Math.min(1, 0.5 + (d - rIn)));
        if (cov <= 0) continue;
        const [r2, g2, b2] = colorFn(cx, cy);
        this.blend(px, py, r2, g2, b2, cov * alpha);
      }
    }
  }

  /** 圆帽粗线（归一化坐标）：两端圆帽 + 中段矩形，SDF 求交 */
  strokeLine(x0, y0, x1, y1, w, [r, g, b, a = 1]) {
    const S = this.size;
    const half = (w / 2) * S;
    const X0 = Math.floor(Math.min(x0, x1) * S - half), X1 = Math.ceil(Math.max(x0, x1) * S + half);
    const Y0 = Math.floor(Math.min(y0, y1) * S - half), Y1 = Math.ceil(Math.max(y0, y1) * S + half);
    const ax = x0 * S, ay = y0 * S, bx = x1 * S, by = y1 * S;
    const lenSq = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    for (let py = Y0; py <= Y1; py++) {
      for (let px = X0; px <= X1; px++) {
        const px2 = px + 0.5, py2 = py + 0.5;
        const t = Math.max(0, Math.min(1, ((px2 - ax) * (bx - ax) + (py2 - ay) * (by - ay)) / lenSq));
        const d = Math.hypot(px2 - (ax + t * (bx - ax)), py2 - (ay + t * (by - ay)));
        const cov = Math.max(0, Math.min(1, 0.5 - (d - half)));
        if (cov <= 0) continue;
        this.blend(px, py, r, g, b, cov * a);
      }
    }
  }

  /** 圆弧（分段直线逼近） */
  strokeArc(cx, cy, rad, w, a0Deg, a1Deg, color) {
    const N = Math.max(8, Math.ceil(((a1Deg - a0Deg) / 360) * 48));
    for (let i = 0; i < N; i++) {
      const t0 = (a0Deg + (a1Deg - a0Deg) * (i / N)) * Math.PI / 180;
      const t1 = (a0Deg + (a1Deg - a0Deg) * ((i + 1) / N)) * Math.PI / 180;
      this.strokeLine(
        cx + rad * Math.cos(t0), cy + rad * Math.sin(t0),
        cx + rad * Math.cos(t1), cy + rad * Math.sin(t1),
        w, color,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 图标绘制（归一化坐标，192/512 共用同一设计）
// ---------------------------------------------------------------------------

const GOLD = [201, 162, 39];
const GOLD_SOFT = [201, 162, 39, 0.16];
const GOLD_HI = [232, 207, 114];

function drawIcon(S) {
  const c = new Canvas(S);
  const t = (n) => n * S; // 归一化→像素

  // 1) 底色：深色圆角方块 + 垂直渐变 + 边缘暗角
  c.fillRoundedRect(0, 0, 1, 1, 0.21, (x, y) => {
    const v = y;
    const base = [0x0f, 0x11, 0x16, 0x0a, 0x0b, 0x0e];
    const rr = base[0] + (base[3] - base[0]) * v;
    const gg = base[1] + (base[4] - base[1]) * v;
    const bb = base[2] + (base[5] - base[2]) * v;
    // 中心轻微提亮（径向），制造聚焦感
    const d = Math.hypot(x - 0.5, y - 0.52);
    const glow = Math.max(0, 1 - d / 0.75) * 14;
    return [rr + glow, gg + glow, bb + glow];
  });

  // 2) 细金描边（圆角框）
  const bw = 0.008;
  c.fillRoundedRect(0.015, 0.015, 0.985, 0.985, 0.195, () => GOLD, 0.9);            // 外缘
  c.fillRoundedRect(0.015 + bw * 3, 0.015 + bw * 3, 0.985 - bw * 3, 0.985 - bw * 3, 0.185, () => [10, 11, 14], 1); // 镂空回填底色

  // 3) 楚河汉界网格（9×10，中间留河界空隙）
  const gx0 = 0.13, gx1 = 0.87, gy0 = 0.14, gy1 = 0.90;
  for (let i = 0; i < 9; i++) { // 竖线 9 条
    const x = gx0 + (gx1 - gx0) * (i / 8);
    c.strokeLine(x, gy0, x, gy1, 0.0045, GOLD_SOFT);
  }
  for (let i = 0; i <= 4; i++) { // 上 5 行横线（含边框）
    const y = gy0 + (gy1 - gy0) * (i / 9);
    c.strokeLine(gx0, y, gx1, y, 0.0045, GOLD_SOFT);
  }
  for (let i = 5; i <= 9; i++) { // 下 5 行横线（跳过河界）
    const y = gy0 + (gy1 - gy0) * (i / 9);
    c.strokeLine(gx0, y, gx1, y, 0.0045, GOLD_SOFT);
  }

  // 4) 中心红帅棋子：外金圈 + 内红渐变
  const pcx = 0.5, pcy = 0.52, pr = 0.20;
  c.fillDisc(pcx, pcy, pr + 0.016, () => [10, 11, 14], pr - 0.016, 1); // 外阴影圈
  c.fillDisc(pcx, pcy, pr + 0.016, () => GOLD, pr + 0.006, 1);          // 金圈
  c.fillDisc(pcx, pcy, pr - 0.006, (x, y) => {                          // 红面径向渐变
    const d = Math.hypot(x - pcx, y - pcy) / pr;
    const edge = 0.75;
    const rr = 0xcf + (0x63 - 0xcf) * Math.min(1, d / edge);
    const gg = 0x3f + (0x18 - 0x3f) * Math.min(1, d / edge);
    const bb = 0x2d + (0x10 - 0x2d) * Math.min(1, d / edge);
    return [rr, gg, bb];
  });
  // 左上高光弧
  c.strokeArc(pcx, pcy, pr * 0.78, 0.016, 205, 325, [255, 235, 200, 0.28]);

  // 5) 金"帅"字（粗圆帽笔画，归一化字形框内坐标）
  const gx = 0.34, gy = 0.345, gw = 0.32, gh = 0.35; // 字形框
  const S2 = (u, v) => [gx + u * gw, gy + v * gh];   // 框内→图标归一化
  const glyph = (a, b, w, alpha = 1) => {
    const [x0, y0] = S2(...a), [x1, y1] = S2(...b);
    c.strokeLine(x0, y0, x1, y1, w, [...GOLD_HI, alpha]);
  };
  glyph([0.00, 0.10], [0.16, 0.42], 0.075);            // 刂：丿
  glyph([0.13, 0.02], [0.13, 0.90], 0.068);            // 刂：丨
  glyph([0.13, 0.90], [0.00, 0.90], 0.055);            // 刂：钩
  glyph([0.30, 0.10], [1.00, 0.10], 0.080);            // 巾：顶横
  glyph([0.38, 0.10], [0.38, 0.92], 0.068);            // 巾：左竖
  glyph([0.61, 0.10], [0.61, 1.00], 0.068);            // 巾：中竖
  glyph([0.84, 0.10], [0.84, 0.92], 0.068);            // 巾：右竖

  // 6) 内圈细金线（棋子内沿装饰）
  c.strokeArc(pcx, pcy, pr - 0.028, 0.006, 0, 360, [GOLD_HI[0], GOLD_HI[1], GOLD_HI[2], 0.5]);

  return encodePng(S, S, c.data);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const SIZES = [192, 512];
mkdirSync(OUT_DIR, { recursive: true });
for (const s of SIZES) {
  const png = drawIcon(s);
  const file = join(OUT_DIR, `icon-${s}.png`);
  writeFileSync(file, png);
  console.log(`[gen-icons] ${file}  ${png.length} bytes  (${s}x${s})`);
}
console.log('[gen-icons] done.');
