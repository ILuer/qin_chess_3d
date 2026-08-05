/**
 * src/render/pieceFactory.js
 * ------------------------------------------------------------
 * 秦式棋子工厂 —— 七种棋子 = 七个可辨识的人物/器物立体形象。
 * 100% 由 Three.js 内置几何体程序化组合，零外部模型资源。
 *
 * 形象设计（剪影互不雷同）：
 *   'P' 兵/卒  → 秦步兵：介帻 + 皮甲，持戈与圆盾，最矮小前倾
 *   'N' 马     → 骑兵：人骑在马上，马四腿前腿抬起，骑手持长戟斜指
 *   'B' 象/相  → 书生：进贤冠 + 宽袖深衣，双手捧简牍，无兵器
 *   'A' 士/仕  → 卫兵：武弁 + 筒袖铠，双手拄剑于身前，笔直对称
 *   'R' 车     → 双轮古战车：8 辐大轮 + 车舆栏板 + 车辕衡轭 + 小旗
 *   'C' 炮     → 抛石车：A 字木架 + 斜指天空的抛杆 + 配重箱 + 石弹
 *   'K' 将/帅  → 主帅：披风 + 鱼鳞甲 + 鹖冠立缨 + 按剑 + 帅旗
 *
 * 契约导出：
 *   createPieceMesh(type, side) -> THREE.Group
 *     - 局部原点在底座底面中心 (y=0)，整体沿 +Y 生长
 *     - group.userData.pieceType / pieceSide 已设置
 *     - 所有子 mesh castShadow = true
 *     - group.userData.dispose() 可安全释放（内部引用计数，共享几何体）
 *
 * 性能说明（对契约的一处**优化性偏离**，见 docs/art-bible.md）：
 *   每枚棋子由 28~45 个几何"零件"塑形，但在构建期按材质
 *   mergeGeometries 合并为 4~8 个 Mesh，把 32 枚棋子的 draw call
 *   从 ~1200 压到 ~180，保证 1080p / 60fps。视觉细节量不变。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMaterials, getBaseTopMaterial, getBannerMaterial } from './materials.js';

/* ============================================================
 * 常量
 * ============================================================ */

export const PIECE_BASE_RADIUS = 0.40;
export const PIECE_MAX_RADIUS = 0.44;

const BASE_H = 0.06;     // 底座高
const FOOT = 0.086;      // 人物/器物起始高度（底座 + 内台）

/** 底座顶面汉字标识 */
export const PIECE_GLYPH = {
  r: { K: '帥', A: '仕', B: '相', N: '馬', R: '俥', C: '炮', P: '兵' },
  b: { K: '將', A: '士', B: '象', N: '馬', R: '車', C: '砲', P: '卒' }
};

/** 各类型标称总高（含最高装饰） */
export const PIECE_TOP_Y = { P: 0.79, N: 0.95, B: 0.88, A: 0.88, R: 0.92, C: 1.00, K: 1.05 };

/* ============================================================
 * 几何体简写
 * ============================================================ */

const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg, 1);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sph = (r, w = 12, h = 10) => new THREE.SphereGeometry(r, w, h);
const dome = (r, w = 12, h = 7, frac = 0.6) =>
  new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI * frac);
const tor = (R, t, rs = 6, ts = 18) => new THREE.TorusGeometry(R, t, rs, ts);

/** 轻微弯曲的旗面（PlaneGeometry + 顶点位移，仍为 indexed 几何体） */
function curvedBanner(w, h, bend, segs = 8) {
  const g = new THREE.PlaneGeometry(w, h, segs, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getX(i) / w + 0.5;              // 0..1
    const v = p.getY(i) / h + 0.5;
    p.setZ(i, Math.sin(t * Math.PI * 1.55) * bend * (0.35 + 0.65 * t)
      + Math.sin(v * Math.PI * 2.0) * bend * 0.25 * t);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/* ============================================================
 * 零件收集器（按材质合并）
 * ============================================================ */

const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

class Parts {
  constructor() { this.list = []; }

  /** 放置一个零件：pos / rot(Euler XYZ) / scale */
  add(geom, mat, opts) {
    const o = opts || {};
    const pos = o.pos || [0, 0, 0];
    const rot = o.rot || [0, 0, 0];
    const scl = o.scale || [1, 1, 1];
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(pos[0], pos[1], pos[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ')),
      new THREE.Vector3(scl[0], scl[1], scl[2])
    );
    geom.applyMatrix4(m);
    this.list.push({ geom: geom, mat: mat });
    return this;
  }

  /** 从 A 点到 B 点的圆柱（腿、臂、杆、索、支架） */
  strut(mat, a, b, rTop, rBot, seg) {
    _v3a.set(a[0], a[1], a[2]);
    _v3b.set(b[0], b[1], b[2]);
    const dir = _v3b.clone().sub(_v3a);
    const len = dir.length();
    if (len < 1e-6) return this;
    dir.normalize();
    const mid = _v3a.clone().add(_v3b).multiplyScalar(0.5);
    const g = new THREE.CylinderGeometry(
      rTop, (rBot === undefined ? rTop : rBot), len, seg || 8, 1
    );
    // 默认 +Y 朝向 A→B 的反方向修正：几何体 +Y 端对应 rTop
    const q = new THREE.Quaternion().setFromUnitVectors(_up, dir.clone().negate());
    g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    this.list.push({ geom: g, mat: mat });
    return this;
  }

  /** 按材质合并 -> Mesh 数组 */
  build() {
    const byMat = new Map();
    for (const p of this.list) {
      let arr = byMat.get(p.mat);
      if (!arr) { arr = []; byMat.set(p.mat, arr); }
      arr.push(p.geom);
    }
    const out = [];
    for (const entry of byMat) {
      const mat = entry[0];
      const geos = entry[1];
      let merged;
      if (geos.length === 1) {
        merged = geos[0];
      } else {
        merged = mergeGeometries(geos, false);
        if (!merged) { merged = geos[0]; }       // 极端兜底
        else { for (const g of geos) g.dispose(); }
      }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      out.push(mesh);
    }
    this.list.length = 0;
    return out;
  }
}

/* ============================================================
 * 统一底座（所有棋子共用形制）
 * ============================================================ */

function makeBaseMesh(parts, side, glyph, M) {
  // 主体：三材质圆柱 [侧面云雷纹, 顶面汉字, 底面]
  const g = new THREE.CylinderGeometry(PIECE_BASE_RADIUS, PIECE_BASE_RADIUS + 0.008, BASE_H, 28, 1);
  g.translate(0, BASE_H / 2, 0);
  const mesh = new THREE.Mesh(g, [
    M.baseSide,
    getBaseTopMaterial(glyph, side),
    M.baseBottom
  ]);
  mesh.name = 'base';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // 顶沿装饰环（鎏金 / 冷银）
  parts.add(tor(0.383, 0.016, 6, 28), M.baseRim, { pos: [0, BASE_H + 0.002, 0], rot: [Math.PI / 2, 0, 0] });
  // 内凹装饰环（与顶面贴图上绘制的内环半径 0.52R 对齐）
  parts.add(tor(0.208, 0.009, 5, 24), M.baseRim, { pos: [0, BASE_H + 0.001, 0], rot: [Math.PI / 2, 0, 0] });
  // 人物立台（把人物抬离汉字环带，避免遮挡）
  parts.add(cyl(0.195, 0.212, 0.028, 20), M.pedestal, { pos: [0, BASE_H + 0.013, 0] });

  return mesh;
}

/* ============================================================
 * 'P' 兵/卒 —— 秦步兵（持戈 + 圆盾）
 * ============================================================ */

function buildPawn(P, M, K) {
  // 战靴
  P.add(box(0.075, 0.045, 0.115), K.leatherDark, { pos: [0.055, FOOT + 0.022, -0.028] });
  P.add(box(0.075, 0.045, 0.115), K.leatherDark, { pos: [-0.055, FOOT + 0.022, -0.028] });
  // 短褐（下摆）
  P.add(cyl(0.105, 0.155, 0.235, 14), M.cloth, { pos: [0, FOOT + 0.118, 0] });
  P.add(tor(0.150, 0.012, 5, 16), M.clothDeep, { pos: [0, FOOT + 0.024, 0], rot: [Math.PI / 2, 0, 0] });
  // 革带
  P.add(tor(0.108, 0.016, 5, 16), M.leather, { pos: [0, 0.345, 0], rot: [Math.PI / 2, 0, 0] });
  // 躯干 + 皮甲片（三层）
  P.add(cyl(0.100, 0.112, 0.185, 14), M.clothDeep, { pos: [0, 0.437, 0] });
  P.add(cyl(0.118, 0.122, 0.022, 14), M.armor, { pos: [0, 0.375, 0] });
  P.add(cyl(0.118, 0.122, 0.022, 14), M.armor, { pos: [0, 0.435, 0] });
  P.add(cyl(0.116, 0.120, 0.022, 14), M.armor, { pos: [0, 0.492, 0] });
  // 肩
  P.add(sph(0.050, 10, 8), M.armorDeep, { pos: [0.098, 0.523, 0] });
  P.add(sph(0.050, 10, 8), M.armorDeep, { pos: [-0.098, 0.523, 0] });
  // 领 + 颈 + 头
  P.add(cyl(0.062, 0.080, 0.024, 12), M.accentDim, { pos: [0, 0.542, 0] });
  P.add(cyl(0.030, 0.032, 0.038, 8), M.skin, { pos: [0, 0.566, 0] });
  P.add(sph(0.056, 12, 10), M.skin, { pos: [0, 0.618, -0.006] });
  // 介帻（扁平尖顶软帽）
  P.add(cyl(0.072, 0.076, 0.012, 14), M.clothDeep, { pos: [0, 0.657, -0.004] });
  P.add(tor(0.062, 0.008, 5, 14), M.leather, { pos: [0, 0.664, -0.004], rot: [Math.PI / 2, 0, 0] });
  P.add(cyl(0.022, 0.068, 0.070, 12), M.cloth, { pos: [0, 0.700, -0.004], rot: [-0.12, 0, 0] });
  // 双臂
  P.strut(M.clothDeep, [0.096, 0.505, 0], [0.150, 0.372, -0.012], 0.028, 0.024, 8);
  P.strut(M.clothDeep, [-0.096, 0.505, 0], [-0.148, 0.402, -0.040], 0.028, 0.024, 8);
  P.add(sph(0.032, 10, 8), M.skin, { pos: [0.156, 0.366, -0.014] });
  P.add(sph(0.032, 10, 8), M.skin, { pos: [-0.152, 0.398, -0.046] });
  // 戈：长杆 + 青铜援 + 内 + 顶刺
  P.add(cyl(0.011, 0.013, 0.600, 8), M.woodDeep, { pos: [0.170, 0.440, -0.020], rot: [-0.055, 0, 0] });
  P.add(box(0.118, 0.028, 0.011), K.bronze, { pos: [0.226, 0.700, -0.030], rot: [0, 0, -0.10] });
  P.add(box(0.052, 0.020, 0.011), K.bronze, { pos: [0.126, 0.686, -0.030] });
  P.add(cyl(0.000, 0.018, 0.050, 8), K.bronze, { pos: [0.170, 0.765, -0.030] });
  // 小圆盾（面向 -Z）
  P.add(cyl(0.094, 0.094, 0.018, 14), M.leather, { pos: [-0.176, 0.400, -0.058], rot: [Math.PI / 2, 0, 0] });
  P.add(tor(0.094, 0.012, 5, 16), M.accentDim, { pos: [-0.176, 0.400, -0.058] });
  P.add(sph(0.030, 10, 8), K.bronze, { pos: [-0.176, 0.400, -0.076] });
}

/* ============================================================
 * 'N' 马 —— 骑兵（人骑在马上）
 * ============================================================ */

function buildHorse(P, M, K) {
  const hide = M.leather;
  // 马身
  P.add(sph(0.135, 14, 10), hide, { pos: [0, 0.355, 0.015], scale: [0.78, 0.82, 1.42] });
  P.add(sph(0.115, 12, 9), hide, { pos: [0, 0.372, -0.145], scale: [0.86, 0.90, 0.90] });
  P.add(sph(0.120, 12, 9), hide, { pos: [0, 0.358, 0.160], scale: [0.90, 0.95, 0.90] });
  // 颈 + 头 + 口鼻 + 耳
  P.strut(hide, [0, 0.600, -0.240], [0, 0.415, -0.130], 0.050, 0.080, 10);
  P.add(sph(0.055, 10, 8), hide, { pos: [0, 0.600, -0.282], scale: [0.80, 0.95, 1.42] });
  P.add(sph(0.036, 8, 6), hide, { pos: [0, 0.566, -0.344], scale: [0.85, 0.80, 1.00] });
  P.add(cyl(0.000, 0.018, 0.044, 6), hide, { pos: [0.028, 0.652, -0.244], rot: [-0.2, 0, 0.15] });
  P.add(cyl(0.000, 0.018, 0.044, 6), hide, { pos: [-0.028, 0.652, -0.244], rot: [-0.2, 0, -0.15] });
  // 鬃毛（三角片列）
  P.add(box(0.014, 0.058, 0.048), K.hair, { pos: [0, 0.648, -0.232], rot: [0.45, 0, 0] });
  P.add(box(0.014, 0.062, 0.048), K.hair, { pos: [0, 0.610, -0.190], rot: [0.55, 0, 0] });
  P.add(box(0.014, 0.058, 0.048), K.hair, { pos: [0, 0.564, -0.152], rot: [0.62, 0, 0] });
  // 马面帘
  P.add(box(0.060, 0.075, 0.018), M.armor, { pos: [0, 0.610, -0.342], rot: [0.12, 0, 0] });
  // 四腿（左前腿抬起 = 动势）
  P.strut(hide, [0.076, 0.300, -0.140], [0.108, 0.178, -0.262], 0.030, 0.024, 8);
  P.strut(hide, [-0.076, 0.300, -0.140], [-0.082, FOOT, -0.170], 0.030, 0.024, 8);
  P.strut(hide, [0.080, 0.300, 0.165], [0.086, FOOT, 0.208], 0.031, 0.025, 8);
  P.strut(hide, [-0.080, 0.300, 0.165], [-0.086, FOOT, 0.208], 0.031, 0.025, 8);
  // 尾
  P.strut(K.hair, [0, 0.420, 0.240], [0, 0.196, 0.332], 0.030, 0.010, 8);
  // 鞍
  P.add(cyl(0.098, 0.108, 0.052, 12), M.cloth, { pos: [0, 0.438, 0.020], scale: [1, 1, 1.45] });

  /* ---- 骑手 ---- */
  P.add(sph(0.070, 10, 8), M.cloth, { pos: [0, 0.490, 0.020] });
  P.strut(M.cloth, [0.078, 0.482, 0.005], [0.116, 0.338, -0.098], 0.034, 0.026, 8);
  P.strut(M.cloth, [-0.078, 0.482, 0.005], [-0.116, 0.338, -0.098], 0.034, 0.026, 8);
  P.add(cyl(0.082, 0.096, 0.160, 12), M.armorDeep, { pos: [0, 0.580, 0.010] });
  P.add(cyl(0.101, 0.104, 0.020, 12), M.armor, { pos: [0, 0.548, 0.010] });
  P.add(cyl(0.099, 0.102, 0.020, 12), M.armor, { pos: [0, 0.608, 0.010] });
  P.add(sph(0.045, 10, 8), M.armorDeep, { pos: [0.086, 0.652, 0.010] });
  P.add(sph(0.045, 10, 8), M.armorDeep, { pos: [-0.086, 0.652, 0.010] });
  P.add(cyl(0.026, 0.028, 0.030, 8), M.skin, { pos: [0, 0.676, 0.008] });
  P.add(sph(0.050, 12, 10), M.skin, { pos: [0, 0.716, 0.002] });
  // 兜鍪 + 顿项 + 缨
  P.add(cyl(0.058, 0.070, 0.032, 12), M.armorDeep, { pos: [0, 0.704, 0.002] });
  P.add(dome(0.056, 12, 7, 0.58), M.armor, { pos: [0, 0.732, 0.002] });
  P.add(cyl(0.000, 0.020, 0.062, 8), M.plume, { pos: [0, 0.796, 0.002] });
  // 双臂持戟
  P.strut(M.armorDeep, [0.088, 0.638, 0.005], [0.132, 0.548, -0.086], 0.028, 0.024, 8);
  P.strut(M.armorDeep, [-0.088, 0.638, 0.005], [-0.120, 0.556, 0.060], 0.028, 0.024, 8);
  P.add(sph(0.030, 10, 8), M.skin, { pos: [0.136, 0.542, -0.094] });
  // 长戟（斜指前上方）
  P.add(cyl(0.011, 0.013, 0.680, 8), M.woodDeep, { pos: [0.132, 0.610, -0.010], rot: [-0.742, 0, 0] });
  P.strut(K.bronze, [0.132, 0.945, -0.320], [0.132, 0.858, -0.236], 0.000, 0.024, 8);
  P.add(box(0.010, 0.072, 0.030), K.bronze, { pos: [0.132, 0.840, -0.262], rot: [-0.742, 0, 0.28] });
}

/* ============================================================
 * 'B' 象/相 —— 书生（宽袖深衣 + 捧简牍）
 * ============================================================ */

function buildElephant(P, M, K) {
  // 履
  P.add(box(0.070, 0.035, 0.100), K.leatherDark, { pos: [0.048, FOOT + 0.018, -0.030] });
  P.add(box(0.070, 0.035, 0.100), K.leatherDark, { pos: [-0.048, FOOT + 0.018, -0.030] });
  // 深衣（下摆外扩的车削袍身）
  const robePts = [
    new THREE.Vector2(0.006, FOOT),
    new THREE.Vector2(0.172, FOOT + 0.004),
    new THREE.Vector2(0.180, 0.130),
    new THREE.Vector2(0.166, 0.240),
    new THREE.Vector2(0.146, 0.360),
    new THREE.Vector2(0.128, 0.460),
    new THREE.Vector2(0.116, 0.530),
    new THREE.Vector2(0.100, 0.578),
    new THREE.Vector2(0.030, 0.600)
  ];
  P.add(new THREE.LatheGeometry(robePts, 18), M.robe, {});
  P.add(tor(0.174, 0.013, 5, 18), M.clothDeep, { pos: [0, 0.104, 0], rot: [Math.PI / 2, 0, 0] });
  // 大带 + 结
  P.add(tor(0.125, 0.018, 5, 18), M.accentDim, { pos: [0, 0.452, 0], rot: [Math.PI / 2, 0, 0] });
  P.add(box(0.052, 0.055, 0.020), M.accentDim, { pos: [0, 0.442, -0.126] });
  // 交领
  P.add(box(0.098, 0.016, 0.012), M.clothDeep, { pos: [0.034, 0.544, -0.098], rot: [0, 0, 0.62] });
  P.add(box(0.098, 0.016, 0.012), M.clothDeep, { pos: [-0.034, 0.544, -0.098], rot: [0, 0, -0.62] });
  P.add(cyl(0.048, 0.060, 0.022, 12), M.clothDeep, { pos: [0, 0.585, 0] });
  // 宽袖（外张锥台）
  P.strut(M.robe, [0.104, 0.545, -0.010], [0.176, 0.378, -0.042], 0.060, 0.088, 12);
  P.strut(M.robe, [-0.104, 0.545, -0.010], [-0.176, 0.378, -0.042], 0.060, 0.088, 12);
  P.add(tor(0.084, 0.012, 5, 14), M.clothDeep, { pos: [0.178, 0.372, -0.044], rot: [1.30, 0, -0.38] });
  P.add(tor(0.084, 0.012, 5, 14), M.clothDeep, { pos: [-0.178, 0.372, -0.044], rot: [1.30, 0, 0.38] });
  // 双手捧简牍
  P.add(sph(0.032, 10, 8), M.skin, { pos: [0.052, 0.498, -0.118] });
  P.add(sph(0.032, 10, 8), M.skin, { pos: [-0.052, 0.498, -0.118] });
  P.add(box(0.168, 0.112, 0.016), K.paper, { pos: [0, 0.516, -0.136], rot: [-0.34, 0, 0] });
  P.add(box(0.174, 0.009, 0.020), K.ink, { pos: [0, 0.549, -0.146], rot: [-0.34, 0, 0] });
  P.add(box(0.174, 0.009, 0.020), K.ink, { pos: [0, 0.483, -0.124], rot: [-0.34, 0, 0] });
  P.add(box(0.006, 0.098, 0.006), K.ink, { pos: [0.046, 0.516, -0.145], rot: [-0.34, 0, 0] });
  P.add(box(0.006, 0.098, 0.006), K.ink, { pos: [0, 0.516, -0.145], rot: [-0.34, 0, 0] });
  P.add(box(0.006, 0.098, 0.006), K.ink, { pos: [-0.046, 0.516, -0.145], rot: [-0.34, 0, 0] });
  // 颈 + 头 + 髯
  P.add(cyl(0.028, 0.030, 0.034, 8), M.skin, { pos: [0, 0.602, 0] });
  P.add(sph(0.055, 12, 10), M.skin, { pos: [0, 0.652, -0.004] });
  P.strut(K.hair, [0, 0.632, -0.048], [0, 0.548, -0.030], 0.030, 0.008, 8);
  // 髻 + 进贤冠
  P.add(cyl(0.058, 0.064, 0.030, 12), M.clothDeep, { pos: [0, 0.706, 0.004] });
  P.add(box(0.082, 0.145, 0.096), M.clothDeep, { pos: [0, 0.790, 0.014], rot: [-0.18, 0, 0] });
  P.add(box(0.060, 0.012, 0.098), M.accentDim, { pos: [0, 0.862, 0.002], rot: [-0.18, 0, 0] });
  P.add(box(0.070, 0.058, 0.014), M.clothDeep, { pos: [0, 0.726, 0.074], rot: [0.30, 0, 0] });
}

/* ============================================================
 * 'A' 士/仕 —— 宫廷卫士（筒袖铠 + 双手拄剑）
 * ============================================================ */

function buildAdvisor(P, M, K) {
  // 战靴
  P.add(box(0.070, 0.040, 0.100), K.leatherDark, { pos: [0.050, FOOT + 0.020, -0.024] });
  P.add(box(0.070, 0.040, 0.100), K.leatherDark, { pos: [-0.050, FOOT + 0.020, -0.024] });
  // 甲裙
  P.add(cyl(0.128, 0.168, 0.254, 14), M.armorDeep, { pos: [0, FOOT + 0.127, 0] });
  P.add(cyl(0.152, 0.158, 0.022, 14), M.armor, { pos: [0, 0.160, 0] });
  P.add(cyl(0.143, 0.148, 0.022, 14), M.armor, { pos: [0, 0.252, 0] });
  // 腰带
  P.add(tor(0.130, 0.017, 5, 18), M.leather, { pos: [0, 0.346, 0], rot: [Math.PI / 2, 0, 0] });
  // 筒袖铠躯干 + 四层甲片
  P.add(cyl(0.116, 0.132, 0.262, 14), M.armorDeep, { pos: [0, 0.472, 0] });
  P.add(cyl(0.136, 0.140, 0.023, 14), M.armor, { pos: [0, 0.382, 0] });
  P.add(cyl(0.134, 0.138, 0.023, 14), M.armor, { pos: [0, 0.446, 0] });
  P.add(cyl(0.131, 0.135, 0.023, 14), M.armor, { pos: [0, 0.510, 0] });
  P.add(cyl(0.127, 0.131, 0.023, 14), M.armor, { pos: [0, 0.572, 0] });
  // 筒袖
  P.add(cyl(0.050, 0.060, 0.180, 10), M.armorDeep, { pos: [0.146, 0.472, -0.006] });
  P.add(cyl(0.050, 0.060, 0.180, 10), M.armorDeep, { pos: [-0.146, 0.472, -0.006] });
  // 披膊
  P.add(dome(0.072, 12, 7, 0.60), M.armor, { pos: [0.140, 0.582, 0] });
  P.add(dome(0.072, 12, 7, 0.60), M.armor, { pos: [-0.140, 0.582, 0] });
  // 盆领 + 颈 + 头
  P.add(cyl(0.064, 0.086, 0.030, 12), M.accentDim, { pos: [0, 0.615, 0] });
  P.add(cyl(0.028, 0.030, 0.030, 8), M.skin, { pos: [0, 0.648, 0] });
  P.add(sph(0.056, 12, 10), M.skin, { pos: [0, 0.715, -0.004] });
  // 武弁
  P.add(cyl(0.062, 0.068, 0.024, 12), M.accentDim, { pos: [0, 0.756, -0.002] });
  P.add(cyl(0.028, 0.062, 0.086, 12), M.clothDeep, { pos: [0, 0.810, -0.002] });
  P.add(sph(0.020, 10, 8), M.accent, { pos: [0, 0.860, -0.002] });
  P.add(box(0.012, 0.088, 0.008), M.cloth, { pos: [0.052, 0.716, 0.040], rot: [0.16, 0, 0.08] });
  P.add(box(0.012, 0.088, 0.008), M.cloth, { pos: [-0.052, 0.716, 0.040], rot: [0.16, 0, -0.08] });
  // 双手拄剑（剑尖着地）
  P.add(box(0.048, 0.400, 0.015), K.blade, { pos: [0, 0.288, -0.116] });
  P.add(box(0.094, 0.022, 0.030), K.bronze, { pos: [0, 0.500, -0.116] });
  P.add(cyl(0.017, 0.019, 0.086, 10), M.leather, { pos: [0, 0.554, -0.116] });
  P.add(sph(0.026, 10, 8), K.bronze, { pos: [0, 0.606, -0.116] });
  P.add(sph(0.032, 10, 8), M.skin, { pos: [0.036, 0.556, -0.114] });
  P.add(sph(0.032, 10, 8), M.skin, { pos: [-0.036, 0.532, -0.114] });
  P.strut(M.armorDeep, [0.140, 0.560, -0.006], [0.048, 0.556, -0.100], 0.030, 0.026, 8);
  P.strut(M.armorDeep, [-0.140, 0.560, -0.006], [-0.048, 0.534, -0.100], 0.030, 0.026, 8);
}

/* ============================================================
 * 'R' 车 —— 双轮古战车（车身沿 Z，车轮在左右）
 * ============================================================ */

function buildChariot(P, M, K, side) {
  const WR = 0.240, TUBE = 0.026, WX = 0.285;
  const HUB = FOOT + WR + TUBE;      // 0.352

  for (let s = -1; s <= 1; s += 2) {
    const x = WX * s;
    // 轮辋 + 内圈
    P.add(tor(WR, TUBE, 8, 20), M.wood, { pos: [x, HUB, 0], rot: [0, Math.PI / 2, 0] });
    P.add(tor(WR - 0.028, 0.011, 5, 18), M.woodDeep, { pos: [x, HUB, 0], rot: [0, Math.PI / 2, 0] });
    // 8 辐（4 根通杆）
    for (let k = 0; k < 4; k++) {
      P.add(box(0.020, WR * 1.92, 0.020), M.wood, { pos: [x, HUB, 0], rot: [(k * Math.PI) / 4, 0, 0] });
    }
    // 毂 + 軎
    P.add(cyl(0.050, 0.050, 0.076, 12), M.woodDeep, { pos: [x, HUB, 0], rot: [0, 0, Math.PI / 2] });
    P.add(sph(0.036, 10, 8), M.accentDim, { pos: [x * 1.14, HUB, 0] });
  }
  // 车轴
  P.add(cyl(0.026, 0.026, 0.600, 10), M.wood, { pos: [0, HUB, 0], rot: [0, 0, Math.PI / 2] });

  // 车舆（方形栏板车厢，前低后高）
  P.add(box(0.340, 0.028, 0.300), M.wood, { pos: [0, 0.402, 0.020] });
  P.add(box(0.340, 0.150, 0.024), M.wood, { pos: [0, 0.486, 0.166] });
  P.add(box(0.024, 0.118, 0.300), M.wood, { pos: [0.158, 0.470, 0.020] });
  P.add(box(0.024, 0.118, 0.300), M.wood, { pos: [-0.158, 0.470, 0.020] });
  P.add(box(0.340, 0.076, 0.024), M.wood, { pos: [0, 0.450, -0.128] });
  // 栏杆立柱
  P.add(cyl(0.013, 0.013, 0.140, 8), M.woodDeep, { pos: [0.152, 0.486, 0.150] });
  P.add(cyl(0.013, 0.013, 0.140, 8), M.woodDeep, { pos: [-0.152, 0.486, 0.150] });
  P.add(cyl(0.013, 0.013, 0.110, 8), M.woodDeep, { pos: [0.152, 0.470, -0.116] });
  P.add(cyl(0.013, 0.013, 0.110, 8), M.woodDeep, { pos: [-0.152, 0.470, -0.116] });
  // 上沿包边
  P.add(box(0.352, 0.018, 0.018), M.accentDim, { pos: [0, 0.564, 0.166] });

  // 车辕 + 衡 + 轭
  P.strut(M.wood, [0, 0.388, 0.090], [0, 0.470, -0.372], 0.024, 0.018, 8);
  P.add(cyl(0.015, 0.015, 0.300, 8), M.wood, { pos: [0, 0.472, -0.362], rot: [0, 0, Math.PI / 2] });
  P.strut(M.woodDeep, [0.086, 0.464, -0.362], [0.114, 0.362, -0.352], 0.012, 0.012, 6);
  P.strut(M.woodDeep, [-0.086, 0.464, -0.362], [-0.114, 0.362, -0.352], 0.012, 0.012, 6);
  P.add(sph(0.030, 10, 8), M.accent, { pos: [0, 0.478, -0.382] });

  // 车旗
  P.add(cyl(0.012, 0.014, 0.450, 8), M.woodDeep, { pos: [0.116, 0.632, 0.146] });
  P.strut(M.accent, [0.116, 0.912, 0.146], [0.116, 0.856, 0.146], 0.000, 0.018, 8);
  P.add(
    curvedBanner(0.200, 0.150, 0.030),
    getBannerMaterial(PIECE_GLYPH[side].R, side),
    { pos: [0.116, 0.760, 0.044], rot: [0, Math.PI / 2, 0] }
  );
}

/* ============================================================
 * 'C' 炮 —— 抛石车（A 字架 + 斜指天空的抛杆）
 * ============================================================ */

function buildCannon(P, M, K, side) {
  const PIV = 0.500;      // 横轴（支点）高度
  const ANG = -Math.PI / 6;  // 抛杆与竖直方向夹角（向 -Z 倾）
  const dirY = Math.cos(Math.PI / 6);   // 0.866
  const dirZ = -Math.sin(Math.PI / 6);  // -0.5
  const LONG = 0.560, SHORT = 0.300;

  // 木质基座
  P.add(box(0.045, 0.045, 0.520), M.wood, { pos: [0.155, FOOT + 0.022, 0] });
  P.add(box(0.045, 0.045, 0.520), M.wood, { pos: [-0.155, FOOT + 0.022, 0] });
  P.add(box(0.356, 0.040, 0.045), M.wood, { pos: [0, FOOT + 0.022, 0.200] });
  P.add(box(0.356, 0.040, 0.045), M.wood, { pos: [0, FOOT + 0.022, -0.200] });
  // 铁角
  P.add(box(0.050, 0.030, 0.050), M.accentDim, { pos: [0.155, FOOT + 0.044, 0.200] });
  P.add(box(0.050, 0.030, 0.050), M.accentDim, { pos: [-0.155, FOOT + 0.044, 0.200] });
  P.add(box(0.050, 0.030, 0.050), M.accentDim, { pos: [0.155, FOOT + 0.044, -0.200] });
  P.add(box(0.050, 0.030, 0.050), M.accentDim, { pos: [-0.155, FOOT + 0.044, -0.200] });
  // A 字形支架（两侧各一组）
  P.strut(M.wood, [0.155, 0.125, 0.185], [0.155, PIV, 0], 0.023, 0.019, 8);
  P.strut(M.wood, [0.155, 0.125, -0.185], [0.155, PIV, 0], 0.023, 0.019, 8);
  P.strut(M.wood, [-0.155, 0.125, 0.185], [-0.155, PIV, 0], 0.023, 0.019, 8);
  P.strut(M.wood, [-0.155, 0.125, -0.185], [-0.155, PIV, 0], 0.023, 0.019, 8);
  // 牵引拉索
  P.strut(K.rope, [0.155, PIV - 0.030, 0], [0.062, 0.130, 0.200], 0.007, 0.007, 6);
  P.strut(K.rope, [-0.155, PIV - 0.030, 0], [-0.062, 0.130, 0.200], 0.007, 0.007, 6);
  // 横轴 + 轴承
  P.add(cyl(0.021, 0.021, 0.400, 10), K.bronzeDark, { pos: [0, PIV, 0], rot: [0, 0, Math.PI / 2] });
  P.add(cyl(0.040, 0.040, 0.028, 10), M.accentDim, { pos: [0.155, PIV, 0], rot: [0, 0, Math.PI / 2] });
  P.add(cyl(0.040, 0.040, 0.028, 10), M.accentDim, { pos: [-0.155, PIV, 0], rot: [0, 0, Math.PI / 2] });

  // 抛杆（长端斜指天空）
  const off = (LONG - SHORT) / 2;
  P.add(cyl(0.017, 0.021, LONG + SHORT, 10), M.wood, {
    pos: [0, PIV + off * dirY, off * dirZ], rot: [ANG, 0, 0]
  });
  P.add(cyl(0.026, 0.026, 0.020, 10), M.accentDim, {
    pos: [0, PIV + 0.180 * dirY, 0.180 * dirZ], rot: [ANG, 0, 0]
  });
  P.add(cyl(0.026, 0.026, 0.020, 10), M.accentDim, {
    pos: [0, PIV - 0.170 * dirY, -0.170 * dirZ], rot: [ANG, 0, 0]
  });

  const tipY = PIV + LONG * dirY;         // ≈ 0.985
  const tipZ = LONG * dirZ;               // ≈ -0.280
  const btmY = PIV - SHORT * dirY;        // ≈ 0.240
  const btmZ = -SHORT * dirZ;             // ≈ +0.150

  // 皮索 + 抛兜 + 石弹
  P.strut(K.rope, [0.030, tipY, tipZ], [0.030, 0.892, tipZ - 0.058], 0.006, 0.006, 6);
  P.strut(K.rope, [-0.030, tipY, tipZ], [-0.030, 0.892, tipZ - 0.058], 0.006, 0.006, 6);
  P.add(sph(0.048, 10, 8), K.leather, { pos: [0, 0.878, tipZ - 0.056], scale: [1, 0.68, 1.1] });
  P.add(sph(0.042, 10, 8), K.stone, { pos: [0, 0.906, tipZ - 0.056] });

  // 配重箱（悬于短端，箱底 0.133 > 底座顶 0.086，不穿模）
  const cwY = 0.190, cwZ = btmZ + 0.006;
  P.strut(K.rope, [0, 0.268, 0.134], [0.052, cwY + 0.052, cwZ + 0.014], 0.007, 0.007, 6);
  P.strut(K.rope, [0, 0.268, 0.134], [-0.052, cwY + 0.052, cwZ + 0.014], 0.007, 0.007, 6);
  P.add(box(0.145, 0.115, 0.132), M.woodDeep, { pos: [0, cwY, cwZ] });
  P.add(box(0.150, 0.013, 0.137), M.accentDim, { pos: [0, cwY + 0.040, cwZ] });
  P.add(box(0.150, 0.013, 0.137), M.accentDim, { pos: [0, cwY - 0.040, cwZ] });

  // 侧旗（阵营辨识）
  P.add(cyl(0.009, 0.010, 0.250, 8), M.woodDeep, { pos: [0.186, 0.250, 0.200] });
  P.add(
    curvedBanner(0.130, 0.104, 0.022, 6),
    getBannerMaterial(PIECE_GLYPH[side].C, side),
    { pos: [0.186, 0.328, 0.135], rot: [0, Math.PI / 2, 0] }
  );
}

/* ============================================================
 * 'K' 将/帅 —— 主帅（披风 + 鱼鳞甲 + 鹖冠 + 按剑 + 帅旗）
 * ============================================================ */

function buildKing(P, M, K, side) {
  // 战靴
  P.add(box(0.080, 0.045, 0.115), K.leatherDark, { pos: [0.058, FOOT + 0.022, -0.030] });
  P.add(box(0.080, 0.045, 0.115), K.leatherDark, { pos: [-0.058, FOOT + 0.022, -0.030] });
  // 甲裙
  P.add(cyl(0.140, 0.176, 0.260, 16), M.armorDeep, { pos: [0, FOOT + 0.130, 0] });
  P.add(cyl(0.160, 0.166, 0.024, 16), M.armor, { pos: [0, 0.186, 0] });
  P.add(tor(0.142, 0.020, 6, 18), M.accent, { pos: [0, 0.358, 0], rot: [Math.PI / 2, 0, 0] });
  // 鱼鳞甲躯干 + 五层鳞片
  P.add(cyl(0.126, 0.144, 0.250, 16), M.armorDeep, { pos: [0, 0.486, 0] });
  P.add(cyl(0.150, 0.154, 0.022, 16), M.armor, { pos: [0, 0.396, 0] });
  P.add(cyl(0.148, 0.152, 0.022, 16), M.armor, { pos: [0, 0.450, 0] });
  P.add(cyl(0.145, 0.149, 0.022, 16), M.armor, { pos: [0, 0.504, 0] });
  P.add(cyl(0.141, 0.145, 0.022, 16), M.armor, { pos: [0, 0.556, 0] });
  P.add(cyl(0.136, 0.140, 0.022, 16), M.armor, { pos: [0, 0.602, 0] });

  // 披风（覆盖背面 +Z 的车削壳体，向后下方展开）
  const capePts = [
    new THREE.Vector2(0.114, 0.628),
    new THREE.Vector2(0.158, 0.520),
    new THREE.Vector2(0.198, 0.400),
    new THREE.Vector2(0.232, 0.262),
    new THREE.Vector2(0.252, 0.142),
    new THREE.Vector2(0.246, 0.096)
  ];
  P.add(
    new THREE.LatheGeometry(capePts, 20, -Math.PI * 0.56, Math.PI * 1.12),
    M.capeCloth, {}
  );
  P.add(cyl(0.108, 0.132, 0.046, 16), M.cloth, { pos: [0, 0.638, 0] });

  // 兽面披膊
  P.add(dome(0.086, 12, 7, 0.62), M.armor, { pos: [0.156, 0.600, 0] });
  P.add(dome(0.086, 12, 7, 0.62), M.armor, { pos: [-0.156, 0.600, 0] });
  P.add(box(0.068, 0.050, 0.048), M.accent, { pos: [0.192, 0.600, -0.038] });
  P.add(box(0.068, 0.050, 0.048), M.accent, { pos: [-0.192, 0.600, -0.038] });
  // 双臂：右手按剑首，左手垂握
  P.strut(M.armorDeep, [0.152, 0.588, 0], [0.176, 0.560, -0.024], 0.046, 0.036, 8);
  P.strut(M.armorDeep, [-0.152, 0.588, 0], [-0.160, 0.418, -0.056], 0.046, 0.034, 8);
  P.add(sph(0.036, 10, 8), M.skin, { pos: [0.176, 0.556, -0.028] });
  P.add(sph(0.034, 10, 8), M.skin, { pos: [-0.162, 0.400, -0.060] });
  // 按剑（右侧佩剑，剑尖近地）
  P.add(box(0.050, 0.382, 0.024), M.woodDeep, { pos: [0.176, 0.278, -0.020] });
  P.add(box(0.057, 0.024, 0.030), M.accent, { pos: [0.176, 0.480, -0.020] });
  P.add(box(0.092, 0.020, 0.030), K.bronze, { pos: [0.176, 0.500, -0.020] });
  P.add(cyl(0.017, 0.019, 0.074, 10), M.leather, { pos: [0.176, 0.540, -0.020] });
  P.add(sph(0.026, 10, 8), K.bronze, { pos: [0.176, 0.582, -0.020] });
  // 颈 + 头 + 髯
  P.add(cyl(0.032, 0.034, 0.032, 8), M.skin, { pos: [0, 0.654, 0] });
  P.add(sph(0.058, 12, 10), M.skin, { pos: [0, 0.706, -0.004] });
  P.strut(K.hair, [0, 0.682, -0.052], [0, 0.586, -0.034], 0.032, 0.008, 8);
  // 鹖冠（高冠 + 立缨双羽）
  P.add(cyl(0.066, 0.072, 0.026, 14), M.accent, { pos: [0, 0.752, -0.002] });
  P.add(cyl(0.030, 0.064, 0.100, 14), M.clothDeep, { pos: [0, 0.816, -0.002] });
  P.add(sph(0.024, 10, 8), M.accent, { pos: [0, 0.876, -0.002] });
  P.strut(M.plume, [0.030, 0.868, 0.014], [0.078, 1.042, 0.062], 0.006, 0.019, 6);
  P.strut(M.plume, [-0.030, 0.868, 0.014], [-0.078, 1.042, 0.062], 0.006, 0.019, 6);

  // 帅旗（旗杆 + 飘扬旗面 + 矛头 + 红缨）
  P.add(cyl(0.050, 0.062, 0.040, 10), M.accentDim, { pos: [0.246, FOOT + 0.020, 0.136] });
  P.add(cyl(0.013, 0.015, 0.650, 8), M.woodDeep, { pos: [0.246, 0.430, 0.136] });
  P.strut(M.accent, [0.246, 0.818, 0.136], [0.246, 0.752, 0.136], 0.000, 0.021, 8);
  P.add(sph(0.027, 8, 6), M.plume, { pos: [0.246, 0.746, 0.136] });
  P.add(
    curvedBanner(0.210, 0.280, 0.036, 8),
    getBannerMaterial(PIECE_GLYPH[side].K, side),
    { pos: [0.246, 0.600, 0.032], rot: [0, Math.PI / 2, 0] }
  );
}

/* ============================================================
 * 模板构建 + 实例化
 * ============================================================ */

const BUILDERS = {
  P: buildPawn,
  N: buildHorse,
  B: buildElephant,
  A: buildAdvisor,
  R: buildChariot,
  C: buildCannon,
  K: buildKing
};

const _templates = new Map();

function buildTemplate(type, side) {
  const mats = getMaterials();
  const M = mats.side(side);
  const K = mats.common;
  const glyph = (PIECE_GLYPH[side] && PIECE_GLYPH[side][type]) || '兵';

  const P = new Parts();
  const baseMesh = makeBaseMesh(P, side, glyph, M);
  const fn = BUILDERS[type] || BUILDERS.P;
  fn(P, M, K, side);

  const meshes = P.build();

  const body = new THREE.Group();
  body.name = 'body';
  body.add(baseMesh);
  for (const m of meshes) body.add(m);
  // 红方面朝 -Z（朝黑方）；黑方面朝 +Z。
  // 构建时统一朝 -Z，黑方内层 body 整体绕 Y 旋转 180°。
  // ★ 用 quaternion 而非 rotation.y —— 180° 的 Euler 分解有万向锁歧义（会读成 (π,0,π)）。
  // ★ 外层 root 保持单位变换，engineering-lead 可自由设置 root.rotation/position 做动画，不破坏朝向。
  if (side === 'b') {
    body.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  }

  const root = new THREE.Group();
  root.name = 'pieceTemplate_' + type + side;
  root.add(body);

  const geoms = [baseMesh.geometry];
  for (const m of meshes) geoms.push(m.geometry);

  return { root: root, geoms: geoms, count: 0 };
}

/**
 * 创建一枚棋子。
 * @param {'K'|'A'|'B'|'N'|'R'|'C'|'P'} type
 * @param {'r'|'b'} side
 * @returns {THREE.Group}
 */
export function createPieceMesh(type, side) {
  const key = type + side;
  let tpl = _templates.get(key);
  if (!tpl) {
    tpl = buildTemplate(type, side);
    _templates.set(key, tpl);
  }

  const group = tpl.root.clone(true);
  tpl.count++;

  group.name = 'piece_' + key;
  group.userData.pieceType = type;
  group.userData.pieceSide = side;
  group.userData.glyph = PIECE_GLYPH[side][type];
  group.userData.topY = PIECE_TOP_Y[type] || 0.9;

  group.traverse(function (o) {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = o.name === 'base';
    }
  });
  group.userData.baseMesh = group.getObjectByName('base') || null;

  let released = false;
  group.userData.dispose = function () {
    if (released) return;
    released = true;
    if (group.parent) group.parent.remove(group);
    tpl.count--;
    if (tpl.count <= 0 && _templates.get(key) === tpl) {
      for (const g of tpl.geoms) g.dispose();
      _templates.delete(key);
    }
  };

  return group;
}

/**
 * 强制释放全部棋子模板几何体（换局/退出时调用）。
 * ⚠ 调用后所有仍在场景中的棋子实例将失效，请先清空场景。
 */
export function disposePieceFactory() {
  for (const tpl of _templates.values()) {
    for (const g of tpl.geoms) g.dispose();
  }
  _templates.clear();
}
