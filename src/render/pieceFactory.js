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
 *   'R' 车     → 双马战车：两匹战马并排 + 车舆 + 御马兵 + 持戈兵 + 小旗
 *   'C' 炮     → 抛石车（修正朝向）：A 字木架 + 抛杆朝前 + 配重箱 + 两名操作士兵
 *   'K' 将/帅  → 主帅端坐龙椅：龙椅（扶手/椅背/底座）+ 坐姿人物 + 鹖冠立缨 + 帅旗
 *
 * 阶段二分组契约（为阶段三动画预留）：
 *   K: root > orient > { base, body(坐姿人物), throne(龙椅) }
 *   C: root > orient > { base, trebuchet(抛石机), soldierL(左兵), soldierR(右兵) }
 *   R: root > orient > { base, horses(双马), body(车体), driver(御马兵), spearman(持戈兵) }
 *   其他: root > orient > { base, ...merged meshes... }
 *
 *   orient 继承阵营旋转（红方朝 -Z，黑方绕 Y 转 180°）。
 *   子 Group 通过 root.userData.subGroups 或 orient.getObjectByName(name) 访问。
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
export const PIECE_TOP_Y = { P: 0.79, N: 0.95, B: 0.88, A: 0.88, R: 1.08, C: 1.02, K: 1.12 };

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
        if (!merged) { merged = geos[0]; }
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
 * 多分组零件收集器（阶段二：K/C/R 使用命名子组）
 * ============================================================ */

class MultiParts {
  constructor() {
    this.groups = new Map();
    /** 默认组名（底座等公共零件归入此组，最终放入 orient 层） */
    this.defaultName = '_base';
  }

  /** 取指定名称的 Parts 收集器；不存在则创建 */
  get(name) {
    if (!this.groups.has(name)) this.groups.set(name, new Parts());
    return this.groups.get(name);
  }

  /** 默认收集器（用于底座、装饰环等不归属动画子组的零件） */
  get base() { return this.get(this.defaultName); }

  /** 全部构建 -> { groupName: [THREE.Mesh][] } */
  buildAll() {
    const result = {};
    for (const [name, parts] of this.groups) {
      result[name] = parts.build();
    }
    return result;
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
 * 'R' 车 —— 双马战车（两匹战马 + 车舆 + 御马兵 + 持戈兵）
 * 分组：horses | body(车体) | driver(御马兵) | spearman(持戈兵)
 * ============================================================ */

function buildChariot(mp, M, K, side) {
  const PB = mp.base;       // 底座等公共零件
  const Ph = mp.get('horses'); // 双马
  const Pc = mp.get('body');   // 车体
  const Pd = mp.get('driver'); // 御马兵
  const Ps = mp.get('spearman');// 持戈兵

  /* ======== 车轮（放在 base 组，随整体旋转）======== */
  const WR = 0.220, TUBE = 0.024, WX = 0.260;
  const HUB = FOOT + WR + TUBE;

  for (let s = -1; s <= 1; s += 2) {
    const x = WX * s;
    PB.add(tor(WR, TUBE, 8, 18), M.wood, { pos: [x, HUB, 0], rot: [0, Math.PI / 2, 0] });
    PB.add(tor(WR - 0.024, 0.010, 5, 16), M.woodDeep, { pos: [x, HUB, 0], rot: [0, Math.PI / 2, 0] });
    for (let k = 0; k < 4; k++) {
      PB.add(box(0.018, WR * 1.88, 0.018), M.wood, { pos: [x, HUB, 0], rot: [(k * Math.PI) / 4, 0, 0] });
    }
    PB.add(cyl(0.044, 0.044, 0.068, 12), M.woodDeep, { pos: [x, HUB, 0], rot: [0, 0, Math.PI / 2] });
    PB.add(sph(0.032, 10, 8), M.accentDim, { pos: [x * 1.12, HUB, 0] });
  }
  PB.add(cyl(0.024, 0.024, 0.540, 10), M.wood, { pos: [0, HUB, 0], rot: [0, 0, Math.PI / 2] });

  /* ======== 车体（body 组）======== */
  // 车舆（方形栏板车厢，前低后高）
  Pc.add(box(0.310, 0.026, 0.270), M.wood, { pos: [0, 0.392, 0.018] });
  Pc.add(box(0.310, 0.130, 0.022), M.wood, { pos: [0, 0.472, 0.148] });
  Pc.add(box(0.022, 0.105, 0.270), M.wood, { pos: [0.144, 0.458, 0.018] });
  Pc.add(box(0.022, 0.105, 0.270), M.wood, { pos: [-0.144, 0.458, 0.018] });
  Pc.add(box(0.310, 0.066, 0.022), M.wood, { pos: [0, 0.440, -0.114] });
  // 栏杆立柱
  Pc.add(cyl(0.012, 0.012, 0.120, 8), M.woodDeep, { pos: [0.138, 0.472, 0.134] });
  Pc.add(cyl(0.012, 0.012, 0.120, 8), M.woodDeep, { pos: [-0.138, 0.472, 0.134] });
  Pc.add(cyl(0.012, 0.012, 0.095, 8), M.woodDeep, { pos: [0.138, 0.458, -0.104] });
  Pc.add(cyl(0.012, 0.012, 0.095, 8), M.woodDeep, { pos: [-0.138, 0.458, -0.104] });
  // 上沿包边
  Pc.add(box(0.320, 0.016, 0.016), M.accentDim, { pos: [0, 0.544, 0.148] });

  // 车辕 + 衡 + 轭（连接马匹方向，朝向 -Z 即前方）
  Pc.strut(M.wood, [0, 0.378, 0.080], [0, 0.456, -0.340], 0.022, 0.016, 8);
  Pc.add(cyl(0.013, 0.013, 0.270, 8), M.wood, { pos: [0, 0.458, -0.330], rot: [0, 0, Math.PI / 2] });
  Pc.strut(M.woodDeep, [0.078, 0.450, -0.330], [0.104, 0.350, -0.320], 0.011, 0.011, 6);
  Pc.strut(M.woodDeep, [-0.078, 0.450, -0.330], [-0.104, 0.350, -0.320], 0.011, 0.011, 6);

  // 车旗
  Pc.add(cyl(0.010, 0.012, 0.400, 8), M.woodDeep, { pos: [0.104, 0.610, 0.130] });
  Pc.strut(M.accent, [0.104, 0.872, 0.130], [0.104, 0.818, 0.130], 0.000, 0.016, 8);
  Pc.add(
    curvedBanner(0.175, 0.130, 0.026, 8),
    getBannerMaterial(PIECE_GLYPH[side].R, side),
    { pos: [0.104, 0.736, 0.038], rot: [0, Math.PI / 2, 0] }
  );

  /* ======== 双马（horses 组，在车前方 -Z 方向）======== */
  // 左马（略靠后）
  const hxL = -0.110, hzL = -0.520;
  buildOneHorse(Ph, M, K, hxL, hzL, 0.95);
  // 右马（略靠前，形成前后错落）
  const hxR = 0.110, hzR = -0.480;
  buildOneHorse(Ph, M, K, hxR, hzR, 0.98);

  /* ======== 御马兵（driver 组，站在车舆前部偏右）======== */
  buildDriver(Pd, M, K, 0.050, -0.030, 0.85, 0.405);

  /* ======== 持戈兵（spearman 组，站在车舆后部偏左）======== */
  buildSpearman(Ps, M, K, -0.050, 0.060, 0.88, 0.405);
}

/** 单匹战马（复用给车用，缩放版） */
function buildOneHorse(P, M, K, ox, oz, scl) {
  const s = scl || 1.0;
  const hide = M.leather;
  // 马身
  P.add(sph(0.108 * s, 12, 8), hide, { pos: [ox, 0.295 * s + 0.086, oz + 0.012 * s], scale: [0.76*s, 0.80*s, 1.36*s] });
  P.add(sph(0.092 * s, 10, 7), hide, { pos: [ox, 0.308 * s + 0.086, oz - 0.120 * s], scale: [0.84*s, 0.88*s, 0.88*s] });
  P.add(sph(0.096 * s, 10, 7), hide, { pos: [ox, 0.296 * s + 0.086, oz + 0.134 * s], scale: [0.88*s, 0.92*s, 0.88*s] });
  // 颈 + 头
  P.strut(hide, [ox, 0.500 * s + 0.086, oz - 0.200 * s], [ox, 0.345 * s + 0.086, oz - 0.108 * s], 0.040 * s, 0.066 * s, 9);
  P.add(sph(0.044 * s, 9, 7), hide, { pos: [ox, 0.500 * s + 0.086, oz - 0.234 * s], scale: [0.78*s, 0.92*s, 1.36*s] });
  P.add(sph(0.028 * s, 7, 5), hide, { pos: [ox, 0.470 * s + 0.086, oz - 0.284 * s], scale: [0.83*s, 0.77*s, 0.96*s] });
  // 耳
  P.add(cyl(0.000, 0.014 * s, 0.036 * s, 5), hide, { pos: [ox + 0.022 * s, 0.542 * s + 0.086, oz - 0.202 * s], rot: [-0.2, 0, 0.15] });
  P.add(cyl(0.000, 0.014 * s, 0.036 * s, 5), hide, { pos: [ox - 0.022 * s, 0.542 * s + 0.086, oz - 0.202 * s], rot: [-0.2, 0, -0.15] });
  // 鬃毛
  P.add(box(0.011 * s, 0.048 * s, 0.040 * s), K.hair, { pos: [ox, 0.540 * s + 0.086, oz - 0.192 * s], rot: [0.45, 0, 0] });
  P.add(box(0.011 * s, 0.052 * s, 0.040 * s), K.hair, { pos: [ox, 0.504 * s + 0.086, oz - 0.156 * s], rot: [0.55, 0, 0] });
  // 马面帘
  P.add(box(0.048 * s, 0.060 * s, 0.014 * s), M.armor, { pos: [ox, 0.504 * s + 0.086, oz - 0.284 * s], rot: [0.12, 0, 0] });
  // 四腿（奔腾姿态：左前右后抬起）
  P.strut(hide, [ox + 0.062 * s, 0.250 * s + 0.086, oz - 0.116 * s],
          [ox + 0.088 * s, 0.086, oz - 0.216 * s], 0.024 * s, 0.020 * s, 8);
  P.strut(hide, [ox - 0.062 * s, 0.250 * s + 0.086, oz - 0.116 * s],
          [ox - 0.066 * s, 0.086, oz - 0.140 * s], 0.024 * s, 0.020 * s, 8);
  P.strut(hide, [ox + 0.064 * s, 0.250 * s + 0.086, oz + 0.136 * s],
          [ox + 0.068 * s, 0.086, oz + 0.172 * s], 0.025 * s, 0.021 * s, 8);
  P.strut(hide, [ox - 0.064 * s, 0.250 * s + 0.086, oz + 0.136 * s],
          [ox - 0.090 * s, 0.086, oz + 0.168 * s], 0.025 * s, 0.021 * s, 8);
  // 尾
  P.strut(K.hair, [ox, 0.350 * s + 0.086, oz + 0.196 * s],
          [ox, 0.164 * s + 0.086, oz + 0.272 * s], 0.024 * s, 0.008 * s, 8);
  // 鞍
  P.add(cyl(0.080 * s, 0.088 * s, 0.044 * s, 10), M.cloth,
    { pos: [ox, 0.364 * s + 0.086, oz + 0.016 * s], scale: [1, 1, 1.38*s] });
}

/** 御马兵（站姿，双手握缰绳状） */
function buildDriver(P, M, K, ox, oz, s, oy = 0.086) {
  const sc = s || 1.0;
  // 下身（简化为裙甲）
  P.add(cyl(0.058 * sc, 0.080 * sc, 0.160 * sc, 10), M.clothDeep, { pos: [ox, 0.080 * sc + oy, oz] });
  P.add(tor(0.080 * sc, 0.012 * sc, 4, 12), M.leather, { pos: [ox, 0.156 * sc + oy, oz], rot: [Math.PI / 2, 0, 0] });
  // 躯干
  P.add(cyl(0.056 * sc, 0.066 * sc, 0.140 * sc, 10), M.armorDeep, { pos: [ox, 0.256 * sc + oy, oz] });
  P.add(cyl(0.068 * sc, 0.072 * sc, 0.018 * sc, 10), M.armor, { pos: [ox, 0.216 * sc + oy, oz] });
  P.add(cyl(0.066 * sc, 0.070 * sc, 0.018 * sc, 10), M.armor, { pos: [ox, 0.264 * sc + oy, oz] });
  // 肩
  P.add(sph(0.038 * sc, 9, 7), M.armorDeep, { pos: [ox + 0.072 * sc, 0.308 * sc + oy, oz] });
  P.add(sph(0.038 * sc, 9, 7), M.armorDeep, { pos: [ox - 0.072 * sc, 0.308 * sc + oy, oz] });
  // 颈 + 头
  P.add(cyl(0.026 * sc, 0.028 * sc, 0.024 * sc, 8), M.accentDim, { pos: [ox, 0.350 * sc + oy, oz] });
  P.add(cyl(0.024 * sc, 0.026 * sc, 0.028 * sc, 8), M.skin, { pos: [ox, 0.376 * sc + oy, oz] });
  P.add(sph(0.044 * sc, 10, 8), M.skin, { pos: [ox, 0.416 * sc + oy, oz - 0.004 * sc] });
  // 兜鍪
  P.add(dome(0.042 * sc, 10, 6, 0.56), M.armor, { pos: [ox, 0.436 * sc + oy, oz - 0.004 * sc] });
  // 双臂前伸（握缰绳姿态，收窄 lateral 防穿侧板）
  P.strut(M.armorDeep, [ox + 0.068 * sc, 0.304 * sc + oy, oz],
          [ox + 0.075 * sc, 0.248 * sc + oy, oz - 0.080 * sc], 0.024 * sc, 0.020 * sc, 8);
  P.strut(M.armorDeep, [ox - 0.068 * sc, 0.304 * sc + oy, oz],
          [ox - 0.065 * sc, 0.252 * sc + oy, oz - 0.070 * sc], 0.024 * sc, 0.020 * sc, 8);
  P.add(sph(0.026 * sc, 9, 7), M.skin, { pos: [ox + 0.077 * sc, 0.244 * sc + oy, oz - 0.082 * sc] });
  P.add(sph(0.026 * sc, 9, 7), M.skin, { pos: [ox - 0.067 * sc, 0.248 * sc + oy, oz - 0.072 * sc] });
}

/** 持戈兵（站姿，双手持长戈） */
function buildSpearman(P, M, K, ox, oz, s, oy = 0.086) {
  const sc = s || 1.0;
  // 下身
  P.add(cyl(0.060 * sc, 0.082 * sc, 0.165 * sc, 10), M.clothDeep, { pos: [ox, 0.082 * sc + oy, oz] });
  P.add(tor(0.082 * sc, 0.012 * sc, 4, 12), M.leather, { pos: [ox, 0.162 * sc + oy, oz], rot: [Math.PI / 2, 0, 0] });
  // 躯干
  P.add(cyl(0.058 * sc, 0.068 * sc, 0.145 * sc, 10), M.armorDeep, { pos: [ox, 0.258 * sc + oy, oz] });
  P.add(cyl(0.070 * sc, 0.074 * sc, 0.018 * sc, 10), M.armor, { pos: [ox, 0.218 * sc + oy, oz] });
  P.add(cyl(0.068 * sc, 0.072 * sc, 0.018 * sc, 10), M.armor, { pos: [ox, 0.266 * sc + oy, oz] });
  // 肩
  P.add(sph(0.040 * sc, 9, 7), M.armorDeep, { pos: [ox + 0.074 * sc, 0.310 * sc + oy, oz] });
  P.add(sph(0.040 * sc, 9, 7), M.armorDeep, { pos: [ox - 0.074 * sc, 0.310 * sc + oy, oz] });
  // 颈 + 头
  P.add(cyl(0.026 * sc, 0.028 * sc, 0.024 * sc, 8), M.accentDim, { pos: [ox, 0.352 * sc + oy, oz] });
  P.add(cyl(0.024 * sc, 0.026 * sc, 0.028 * sc, 8), M.skin, { pos: [ox, 0.378 * sc + oy, oz] });
  P.add(sph(0.044 * sc, 10, 8), M.skin, { pos: [ox, 0.418 * sc + oy, oz - 0.004 * sc] });
  // 兜鍪
  P.add(dome(0.042 * sc, 10, 6, 0.56), M.armor, { pos: [ox, 0.438 * sc + oy, oz - 0.004 * sc] });
  // 右臂前伸持戈
  P.strut(M.armorDeep, [ox + 0.070 * sc, 0.306 * sc + oy, oz],
          [ox + 0.124 * sc, 0.272 * sc + oy, oz - 0.084 * sc], 0.024 * sc, 0.020 * sc, 8);
  P.add(sph(0.026 * sc, 9, 7), M.skin, { pos: [ox + 0.126 * sc, 0.268 * sc + oy, oz - 0.086 * sc] });
  // 长戈（斜指右上方）
  P.add(cyl(0.010 * sc, 0.012 * sc, 0.480 * sc, 8), M.woodDeep,
    { pos: [ox + 0.122 * sc, 0.340 * sc + oy, oz - 0.080 * sc], rot: [-0.55, 0, 0] });
  P.add(box(0.096 * sc, 0.024 * sc, 0.010 * sc), K.bronze,
    { pos: [ox + 0.168 * sc, 0.540 * sc + oy, oz - 0.106 * sc], rot: [0, 0, -0.10] });
  P.add(box(0.044 * sc, 0.018 * sc, 0.010 * sc), K.bronze,
    { pos: [ox + 0.094 * sc, 0.528 * sc + oy, oz - 0.106 * sc] });
  // 左臂垂放
  P.strut(M.armorDeep, [ox - 0.070 * sc, 0.306 * sc + oy, oz],
          [ox - 0.102 * sc, 0.210 * sc + oy, oz - 0.044 * sc], 0.024 * sc, 0.020 * sc, 8);
  P.add(sph(0.026 * sc, 9, 7), M.skin, { pos: [ox - 0.104 * sc, 0.206 * sc + oy, oz - 0.046 * sc] });
}

/* ============================================================
 * 'C' 炮 —— 抛石车（蓄势态：抛杆后扬，长端在 +Z 后方扬起）
 * 分组：trebuchet | soldierL(左兵) | soldierR(右兵)
 * ============================================================ */

function buildCannon(mp, M, K, side) {
  const PB = mp.base;           // 底座等公共零件
  const Pt = mp.get('trebuchet');// 抛石机本体
  const PL = mp.get('soldierL'); // 左侧士兵
  const PR = mp.get('soldierR'); // 右侧士兵

  const PIV = 0.480;            // 横轴（支点）高度
  // 蓄势态：抛杆后扬，长端（投掷端）在 +Z 后方扬起，
  // 短端（配重端）垂向 -Z 前方，呈待发姿态。
  const ANG = Math.PI / 8;
  const dirY = Math.cos(ANG);   //  0.924
  const dirZ = Math.sin(ANG);   //  0.383 （长端/投掷端在 +Z 后方）
  const LONG = 0.540, SHORT = 0.290;

  /* ======== 木质基座（trebuchet 组）======== */
  Pt.add(box(0.042, 0.042, 0.480), M.wood, { pos: [0.145, FOOT + 0.020, 0] });
  Pt.add(box(0.042, 0.042, 0.480), M.wood, { pos: [-0.145, FOOT + 0.020, 0] });
  Pt.add(box(0.334, 0.038, 0.042), M.wood, { pos: [0, FOOT + 0.020, 0.185] });
  Pt.add(box(0.334, 0.038, 0.042), M.wood, { pos: [0, FOOT + 0.020, -0.185] });

  // 铁角
  Pt.add(box(0.046, 0.028, 0.046), M.accentDim, { pos: [0.145, FOOT + 0.040, 0.185] });
  Pt.add(box(0.046, 0.028, 0.046), M.accentDim, { pos: [-0.145, FOOT + 0.040, 0.185] });
  Pt.add(box(0.046, 0.028, 0.046), M.accentDim, { pos: [0.145, FOOT + 0.040, -0.185] });
  Pt.add(box(0.046, 0.028, 0.046), M.accentDim, { pos: [-0.145, FOOT + 0.040, -0.185] });

  // A 字形支架
  Pt.strut(M.wood, [0.145, 0.118, 0.170], [0.145, PIV, 0], 0.022, 0.018, 8);
  Pt.strut(M.wood, [0.145, 0.118, -0.170], [0.145, PIV, 0], 0.022, 0.018, 8);
  Pt.strut(M.wood, [-0.145, 0.118, 0.170], [-0.145, PIV, 0], 0.022, 0.018, 8);
  Pt.strut(M.wood, [-0.145, 0.118, -0.170], [-0.145, PIV, 0], 0.022, 0.018, 8);

  // A 架四脚青铜包铁节点
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      Pt.add(box(0.038, 0.030, 0.038), K.bronzeDark, { pos: [0.145 * sx, 0.118, 0.170 * sz] });
    }
  }

  // 牵引拉索
  Pt.strut(K.rope, [0.145, PIV - 0.028, 0], [0.058, 0.122, 0.185], 0.007, 0.007, 6);
  Pt.strut(K.rope, [-0.145, PIV - 0.028, 0], [-0.058, 0.122, 0.185], 0.007, 0.007, 6);

  // 横轴 + 轴承
  Pt.add(cyl(0.020, 0.020, 0.380, 10), K.bronzeDark, { pos: [0, PIV, 0], rot: [0, 0, Math.PI / 2] });
  Pt.add(cyl(0.038, 0.038, 0.026, 10), M.accentDim, { pos: [0.145, PIV, 0], rot: [0, 0, Math.PI / 2] });
  Pt.add(cyl(0.038, 0.038, 0.026, 10), M.accentDim, { pos: [-0.145, PIV, 0], rot: [0, 0, Math.PI / 2] });

  // 绞盘（基座中央，两纵梁之间，对应小兵转绞盘姿态）
  Pt.strut(M.woodDeep, [0.080, FOOT + 0.020, 0], [0.080, 0.140, 0], 0.014, 0.012, 6);
  Pt.strut(M.woodDeep, [-0.080, FOOT + 0.020, 0], [-0.080, 0.140, 0], 0.014, 0.012, 6);
  Pt.add(cyl(0.026, 0.026, 0.160, 10), M.woodDeep, { pos: [0, 0.140, 0], rot: [0, 0, Math.PI / 2] });
  Pt.add(cyl(0.014, 0.014, 0.030, 8), K.bronzeDark, { pos: [0.095, 0.140, 0], rot: [0, 0, Math.PI / 2] });
  Pt.add(cyl(0.014, 0.014, 0.030, 8), K.bronzeDark, { pos: [-0.095, 0.140, 0], rot: [0, 0, Math.PI / 2] });
  // 摇柄（L 形，两侧）
  Pt.add(box(0.040, 0.010, 0.010), K.bronzeDark, { pos: [0.125, 0.140, 0] });
  Pt.add(cyl(0.006, 0.006, 0.028, 6), K.bronzeDark, { pos: [0.142, 0.154, 0] });
  Pt.add(box(0.040, 0.010, 0.010), K.bronzeDark, { pos: [-0.125, 0.140, 0] });
  Pt.add(cyl(0.006, 0.006, 0.028, 6), K.bronzeDark, { pos: [-0.142, 0.154, 0] });

  // 抛杆（蓄势态：长端在 +Z 后方扬起，短端垂向 -Z 前方）
  const off = (LONG - SHORT) / 2;
  Pt.add(cyl(0.016, 0.020, LONG + SHORT, 10), M.wood, {
    pos: [0, PIV + off * dirY, off * dirZ], rot: [ANG, 0, 0]
  });
  Pt.add(cyl(0.024, 0.024, 0.018, 10), M.accentDim, {
    pos: [0, PIV + 0.170 * dirY, 0.170 * dirZ], rot: [ANG, 0, 0]
  });
  Pt.add(cyl(0.024, 0.024, 0.018, 10), M.accentDim, {
    pos: [0, PIV - 0.160 * dirY, -0.160 * dirZ], rot: [ANG, 0, 0]
  });

  // 抛杆中段青铜箍（支点偏长端侧）
  Pt.add(cyl(0.022, 0.022, 0.018, 10), K.bronzeDark, {
    pos: [0, PIV + 0.04 * dirY, 0.04 * dirZ], rot: [ANG, 0, 0]
  });

  // 触发钩（抛杆长端近支点处，暗示扣机待发）
  const hkY = PIV + 0.08 * dirY;
  const hkZ = 0.08 * dirZ;
  Pt.strut(K.bronzeDark, [0, hkY, hkZ], [0, hkY + 0.024, hkZ], 0.008, 0.006, 5);
  Pt.strut(K.bronzeDark, [0, hkY + 0.024, hkZ], [0.014, hkY + 0.024, hkZ], 0.006, 0.006, 5);

  const tipY = PIV + LONG * dirY;         // ≈ 0.979
  const tipZ = LONG * dirZ;               // ≈ +0.207（长端在 +Z 后方扬起）
  const btmY = PIV - SHORT * dirY;        // ≈ 0.212
  const btmZ = -SHORT * dirZ;             // ≈ -0.111（配重垂向 -Z 前方）

  // 皮索 + 抛兜 + 石弹（在长端/后方扬起处）
  Pt.strut(K.rope, [0.028, tipY, tipZ], [0.028, tipY - 0.056, tipZ - 0.054], 0.006, 0.006, 6);
  Pt.strut(K.rope, [-0.028, tipY, tipZ], [-0.028, tipY - 0.056, tipZ - 0.054], 0.006, 0.006, 6);
  Pt.add(sph(0.044, 10, 8), K.leather, { pos: [0, tipY - 0.052, tipZ - 0.052], scale: [1, 0.66, 1.08] });
  Pt.add(sph(0.038, 10, 8), K.stone, { pos: [0, tipY - 0.080, tipZ - 0.052] });

  // 配重箱（悬于短端/前方 -Z 侧，索从抛杆短端端点垂下）
  const cwY = btmY - 0.030, cwZ = btmZ + 0.006;
  Pt.strut(K.rope, [0, btmY, btmZ], [0.048, cwY + 0.048, cwZ + 0.012], 0.007, 0.007, 6);
  Pt.strut(K.rope, [0, btmY, btmZ], [-0.048, cwY + 0.048, cwZ + 0.012], 0.007, 0.007, 6);
  Pt.add(box(0.136, 0.106, 0.124), M.woodDeep, { pos: [0, cwY, cwZ] });
  Pt.add(box(0.140, 0.012, 0.128), M.accentDim, { pos: [0, cwY + 0.038, cwZ] });
  Pt.add(box(0.140, 0.012, 0.128), M.accentDim, { pos: [0, cwY - 0.038, cwZ] });

  // 备用石弹（基座右侧）
  Pt.add(sph(0.038, 10, 8), K.stone, { pos: [0.16, FOOT + 0.044, 0.08] });

  // 侧旗
  Pt.add(cyl(0.008, 0.009, 0.230, 8), M.woodDeep, { pos: [0.174, 0.238, 0.185] });
  Pt.add(
    curvedBanner(0.120, 0.096, 0.020, 6),
    getBannerMaterial(PIECE_GLYPH[side].C, side),
    { pos: [0.174, 0.312, 0.126], rot: [0, Math.PI / 2, 0] }
  );

  /* ======== 左侧士兵（soldierL 组）======== */
  buildCannonSoldier(PL, M, K, -0.250, 0.086, 0.95, 1);

  /* ======== 右侧士兵（soldierR 组）======== */
  buildCannonSoldier(PR, M, K, 0.250, 0.086, 0.95, -1);
}

/** 炮兵（推车/操作绞盘姿态，mirrorX=-1 时镜像翻转） */
function buildCannonSoldier(P, M, K, ox, oy, s, mirrorX) {
  const sc = s || 0.85;
  const mx = mirrorX || 1;
  const legH = 0.038 * sc;
  // 腿 + 靴（落地，靴底 y = oy = FOOT）
  P.add(cyl(0.016 * sc, 0.020 * sc, 0.055 * sc, 8), M.clothDeep, { pos: [ox - 0.024 * sc * mx, oy + 0.027 * sc, 0] });
  P.add(cyl(0.016 * sc, 0.020 * sc, 0.055 * sc, 8), M.clothDeep, { pos: [ox + 0.024 * sc * mx, oy + 0.027 * sc, 0] });
  P.add(box(0.034 * sc, 0.022 * sc, 0.058 * sc), K.leatherDark, { pos: [ox - 0.024 * sc * mx, oy + 0.011 * sc, -0.016 * sc] });
  P.add(box(0.034 * sc, 0.022 * sc, 0.058 * sc), K.leatherDark, { pos: [ox + 0.024 * sc * mx, oy + 0.011 * sc, -0.016 * sc] });
  // 身体微微前倾，面向绞盘方向（身体抬高 legH 给腿留可见空间）
  // 下身（简化裙甲）
  P.add(cyl(0.052 * sc, 0.072 * sc, 0.140 * sc, 10), M.clothDeep, { pos: [ox, oy + legH + 0.070 * sc, 0] });
  P.add(tor(0.072 * sc, 0.010 * sc, 4, 10), M.leather, { pos: [ox, oy + legH + 0.138 * sc, 0], rot: [Math.PI / 2, 0, 0] });
  // 躯干（前倾）
  P.add(cyl(0.050 * sc, 0.060 * sc, 0.130 * sc, 10), M.armorDeep, { pos: [ox, oy + legH + 0.222 * sc, 0.016 * mx] });
  P.add(cyl(0.062 * sc, 0.066 * sc, 0.016 * sc, 10), M.armor, { pos: [ox, oy + legH + 0.186 * sc, 0.016 * mx] });
  P.add(cyl(0.060 * sc, 0.064 * sc, 0.016 * sc, 10), M.armor, { pos: [ox, oy + legH + 0.228 * sc, 0.016 * mx] });
  // 肩
  P.add(sph(0.034 * sc, 9, 7), M.armorDeep, { pos: [ox + 0.062 * sc * mx, oy + legH + 0.268 * sc, 0.016 * mx] });
  P.add(sph(0.034 * sc, 9, 7), M.armorDeep, { pos: [ox - 0.062 * sc * mx, oy + legH + 0.268 * sc, 0.016 * mx] });
  // 颈 + 头（略微低头看绞盘）
  P.add(cyl(0.024 * sc, 0.026 * sc, 0.022 * sc, 8), M.accentDim, { pos: [ox, oy + legH + 0.304 * sc, 0.018 * mx] });
  P.add(cyl(0.022 * sc, 0.024 * sc, 0.026 * sc, 8), M.skin, { pos: [ox, oy + legH + 0.326 * sc, 0.018 * mx] });
  P.add(sph(0.040 * sc, 10, 8), M.skin, { pos: [ox, oy + legH + 0.362 * sc, 0.014 * mx] });
  // 介帻帽
  P.add(cyl(0.056 * sc, 0.060 * sc, 0.010 * sc, 12), M.clothDeep, { pos: [ox, oy + legH + 0.392 * sc, 0.014 * mx] });
  P.add(tor(0.048 * sc, 0.007 * sc, 4, 12), M.leather, { pos: [ox, oy + legH + 0.398 * sc, 0.014 * mx], rot: [Math.PI / 2, 0, 0] });
  // 双臂前伸（推车/转绞盘姿态）
  P.strut(M.armorDeep, [ox + 0.058 * sc * mx, oy + legH + 0.264 * sc, 0.016 * mx],
          [ox + 0.110 * sc * mx, oy + legH + 0.218 * sc, -0.048 * sc], 0.022 * sc, 0.018 * sc, 8);
  P.strut(M.armorDeep, [ox - 0.058 * sc * mx, oy + legH + 0.264 * sc, 0.016 * mx],
          [ox - 0.096 * sc * mx, oy + legH + 0.222 * sc, -0.038 * sc], 0.022 * sc, 0.018 * sc, 8);
  P.add(sph(0.024 * sc, 9, 7), M.skin, { pos: [ox + 0.112 * sc * mx, oy + legH + 0.214 * sc, -0.050 * sc] });
  P.add(sph(0.024 * sc, 9, 7), M.skin, { pos: [ox - 0.098 * sc * mx, oy + legH + 0.218 * sc, -0.040 * sc] });
}

/* ============================================================
 * 'K' 将/帅 —— 主帅端坐龙椅
 * 分组：body(坐姿人物) | throne(龙椅)
 * ============================================================ */

function buildKing(mp, M, K, side) {
  const PB = mp.base;       // 底座等公共零件
  const Pb = mp.get('body');   // 坐姿人物
  const Pt = mp.get('throne'); // 龙椅

  const SEAT_Y = FOOT + 0.065; // 龙椅座位高度
  const BODY_BOT = SEAT_Y + 0.020; // 人物臀部坐在椅面上

  /* ======== 龙椅（throne 组）======== */
  // 底座台阶（三层递减）
  Pt.add(box(0.340, 0.045, 0.280), M.woodDeep, { pos: [0, FOOT + 0.022, 0] });
  Pt.add(box(0.300, 0.040, 0.245), M.wood, { pos: [0, FOOT + 0.060, 0] });
  Pt.add(box(0.260, 0.035, 0.210), M.wood, { pos: [0, FOOT + 0.095, 0] });
  // 底座鎏金包边
  Pt.add(box(0.348, 0.010, 0.288), M.accent, { pos: [0, FOOT + 0.044, 0] });
  Pt.add(box(0.308, 0.008, 0.253), M.accentDim, { pos: [0, FOOT + 0.080, 0] });

  // 椅座（厚垫）
  Pt.add(box(0.230, 0.048, 0.190), M.clothDeep, { pos: [0, SEAT_Y, 0] });
  Pt.add(box(0.238, 0.012, 0.198), M.accentDim, { pos: [0, SEAT_Y + 0.028, 0] });
  Pt.add(box(0.238, 0.012, 0.198), M.accentDim, { pos: [0, SEAT_Y - 0.028, 0] });

  // 椅背（高耸弧形靠背，秦式回纹镂空效果用分层表现）
  Pt.add(box(0.220, 0.260, 0.028), M.woodDeep, { pos: [0, SEAT_Y + 0.148, -0.098] });
  Pt.add(box(0.200, 0.230, 0.022), M.wood, { pos: [0, SEAT_Y + 0.138, -0.098] });
  // 椅背顶部横梁（龙首装饰位）
  Pt.add(box(0.240, 0.038, 0.036), M.wood, { pos: [0, SEAT_Y + 0.284, -0.098] });
  Pt.add(box(0.248, 0.014, 0.044), M.accent, { pos: [0, SEAT_Y + 0.306, -0.098] });
  // 椅背中央竖脊
  Pt.add(box(0.028, 0.220, 0.018), M.accentDim, { pos: [0, SEAT_Y + 0.158, -0.108] });
  // 椅背两侧云纹饰板
  Pt.add(box(0.058, 0.140, 0.012), M.accent, { pos: [0.088, SEAT_Y + 0.128, -0.108] });
  Pt.add(box(0.058, 0.140, 0.012), M.accent, { pos: [-0.088, SEAT_Y + 0.128, -0.108] });

  // 扶手（左右各一，从椅座前角升起）
  for (let s = -1; s <= 1; s += 2) {
    const fx = 0.108 * s;
    // 扶手支柱
    Pt.strut(M.woodDeep, [fx, SEAT_Y + 0.024, 0.080], [fx, SEAT_Y + 0.148, 0.040], 0.018, 0.014, 8);
    // 扶手横杆（圆棍）
    Pt.add(cyl(0.014, 0.014, 0.155, 10), M.wood, {
      pos: [fx, SEAT_Y + 0.156, 0.004], rot: [0, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2]
    });
    // 扶手头部球饰（龙头简化）
    Pt.add(sph(0.024, 10, 8), M.accent, { pos: [fx, SEAT_Y + 0.168, -0.068] });
    // 扶手底部兽爪足
    Pt.add(box(0.028, 0.028, 0.036), M.accentDim, { pos: [fx, FOOT + 0.012, 0.086] });
  }

  // 椅座前沿垂帘（暗红丝织）
  Pt.add(box(0.200, 0.065, 0.014), M.capeCloth, { pos: [0, SEAT_Y - 0.052, 0.100] });

  /* ======== 坐姿人物（body 组）======== */
  // 臀部+大腿（简化为坐姿椭球，不可见或仅露边缘）
  Pb.add(sph(0.090, 10, 8), M.clothDeep, { pos: [0, BODY_BOT - 0.010, 0.020], scale: [1.1, 0.55, 0.85] });
  // 躯干（坐姿挺直，比站立略矮）
  Pb.add(cyl(0.110, 0.128, 0.200, 14), M.clothDeep, { pos: [0, BODY_BOT + 0.098, 0] });
  // 鱼鳞甲（四层，坐姿时下两层被椅背遮挡部分仍保留）
  Pb.add(cyl(0.130, 0.142, 0.020, 14), M.armor, { pos: [0, BODY_BOT + 0.038, 0] });
  Pb.add(cyl(0.128, 0.140, 0.020, 14), M.armor, { pos: [0, BODY_BOT + 0.076, 0] });
  Pb.add(cyl(0.124, 0.136, 0.020, 14), M.armor, { pos: [0, BODY_BOT + 0.114, 0] });
  Pb.add(cyl(0.120, 0.132, 0.020, 14), M.armor, { pos: [0, BODY_BOT + 0.152, 0] });
  // 甲裙腰带
  Pb.add(tor(0.118, 0.018, 5, 16), M.accent, { pos: [0, BODY_BOT + 0.018, 0], rot: [Math.PI / 2, 0, 0] });

  // 披风（坐姿时从肩后垂落到椅背外）
  const capePts = [
    new THREE.Vector2(0.100, BODY_BOT + 0.178),
    new THREE.Vector2(0.140, BODY_BOT + 0.098),
    new THREE.Vector2(0.178, BODY_BOT - 0.002),
    new THREE.Vector2(0.208, BODY_BOT - 0.098),
    new THREE.Vector2(0.222, BODY_BOT - 0.168)
  ];
  Pb.add(
    new THREE.LatheGeometry(capePts, 18, -Math.PI * 0.52, Math.PI * 1.04),
    M.capeCloth, {}
  );
  Pb.add(cyl(0.098, 0.120, 0.040, 14), M.cloth, { pos: [0, BODY_BOT + 0.188, 0] });

  // 兽面披膊
  Pb.add(dome(0.078, 12, 7, 0.62), M.armor, { pos: [0.142, BODY_BOT + 0.158, 0] });
  Pb.add(dome(0.078, 12, 7, 0.62), M.armor, { pos: [-0.142, BODY_BOT + 0.158, 0] });
  Pb.add(box(0.062, 0.046, 0.044), M.accent, { pos: [0.174, BODY_BOT + 0.158, -0.036] });
  Pb.add(box(0.062, 0.046, 0.044), M.accent, { pos: [-0.174, BODY_BOT + 0.158, -0.036] });

  // 双臂：右手按剑首（坐姿时手位置更低），左手搁扶手上
  Pb.strut(M.armorDeep, [0.140, BODY_BOT + 0.146, 0], [0.162, BODY_BOT + 0.108, -0.022], 0.042, 0.034, 8);
  Pb.strut(M.armorDeep, [-0.140, BODY_BOT + 0.146, 0], [-0.168, BODY_BOT + 0.118, 0.056], 0.042, 0.032, 8);
  Pb.add(sph(0.034, 10, 8), M.skin, { pos: [0.162, BODY_BOT + 0.104, -0.026] });
  Pb.add(sph(0.032, 10, 8), M.skin, { pos: [-0.168, BODY_BOT + 0.114, 0.058] });

  // 按剑（右侧佩剑，坐姿时更贴近身体）
  Pb.add(box(0.046, 0.340, 0.022), M.woodDeep, { pos: [0.162, BODY_BOT - 0.018, -0.018] });
  Pb.add(box(0.052, 0.022, 0.028), M.accent, { pos: [0.162, BODY_BOT + 0.144, -0.018] });
  Pb.add(box(0.084, 0.018, 0.028), K.bronze, { pos: [0.162, BODY_BOT + 0.162, -0.018] });
  Pb.add(cyl(0.016, 0.018, 0.068, 10), M.leather, { pos: [0.162, BODY_BOT + 0.204, -0.018] });
  Pb.add(sph(0.024, 10, 8), K.bronze, { pos: [0.162, BODY_BOT + 0.244, -0.018] });

  // 颈 + 头 + 髯
  Pb.add(cyl(0.030, 0.032, 0.030, 8), M.skin, { pos: [0, BODY_BOT + 0.218, 0] });
  Pb.add(sph(0.056, 12, 10), M.skin, { pos: [0, BODY_BOT + 0.268, -0.004] });
  Pb.strut(K.hair, [0, BODY_BOT + 0.244, -0.048], [0, BODY_BOT + 0.204, -0.032], 0.030, 0.008, 8);

  // 鹖冠（高冠 + 立缨双羽）
  Pb.add(cyl(0.064, 0.068, 0.024, 14), M.accent, { pos: [0, BODY_BOT + 0.312, -0.002] });
  Pb.add(cyl(0.028, 0.060, 0.094, 14), M.clothDeep, { pos: [0, BODY_BOT + 0.374, -0.002] });
  Pb.add(sph(0.022, 10, 8), M.accent, { pos: [0, BODY_BOT + 0.430, -0.002] });
  Pb.strut(M.plume, [0.028, BODY_BOT + 0.424, 0.014], [0.072, BODY_BOT + 0.588, 0.058], 0.006, 0.018, 6);
  Pb.strut(M.plume, [-0.028, BODY_BOT + 0.424, 0.014], [-0.072, BODY_BOT + 0.588, 0.058], 0.006, 0.018, 6);

  // 帅旗（旗杆从龙椅右侧伸出）
  PB.add(cyl(0.046, 0.056, 0.036, 10), M.accentDim, { pos: [0.228, FOOT + 0.018, 0.126] });
  PB.add(cyl(0.012, 0.014, 0.600, 8), M.woodDeep, { pos: [0.228, 0.400, 0.126] });
  PB.strut(M.accent, [0.228, 0.756, 0.126], [0.228, 0.694, 0.126], 0.000, 0.020, 8);
  PB.add(sph(0.024, 8, 6), M.plume, { pos: [0.228, 0.688, 0.126] });
  PB.add(
    curvedBanner(0.195, 0.260, 0.034, 8),
    getBannerMaterial(PIECE_GLYPH[side].K, side),
    { pos: [0.228, 0.560, 0.028], rot: [0, Math.PI / 2, 0] }
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

/** 需要多分组的棋子类型（阶段二/三动画预留） */
const MULTI_GROUP_TYPES = new Set(['K', 'C', 'R']);

const _templates = new Map();

function buildTemplate(type, side) {
  const mats = getMaterials();
  const M = mats.side(side);
  const K = mats.common;
  const glyph = (PIECE_GLYPH[side] && PIECE_GLYPH[side][type]) || '兵';

  const useMulti = MULTI_GROUP_TYPES.has(type);
  let mp = null;
  let P = null;

  if (useMulti) {
    mp = new MultiParts();
    P = mp.base;
  } else {
    P = new Parts();
  }

  const baseMesh = makeBaseMesh(P, side, glyph, M);
  const fn = BUILDERS[type] || BUILDERS.P;

  // 多分组构建器接收 MultiParts 作为第四参数
  if (useMulti) {
    fn(mp, M, K, side);
  } else {
    fn(P, M, K);
  }

  // ── 多分组路径（K/C/R）──
  if (mp) {
    const allGroups = mp.buildAll();

    // orient 包裹层：仅承载阵营旋转（黑方 Y=180° 四元数），其余动画绝不触碰，
    // 避免欧拉万向锁把 Y=180° 四元数重算成 X=180°（棋子翻面/头朝下）。
    const orient = new THREE.Group();
    orient.name = 'orient';

    // 阵营朝向：红方朝 -Z（朝黑方）；黑方朝 +Z。
    // 构建时统一朝 -Z，黑方 orient 整体绕 Y 旋转 180°。
    if (side === 'b') {
      orient.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    }

    // idleGroup：待机微动 / 移动 / 吃子整体风味作用层。所有对「整枚棋子」的
    // position.y / rotation.x / rotation.z 微动都写到这里，永远不写 orient，
    // 从而保住黑方 orient 的 Y=180° 四元数不被重算。子组(sg.*)也挂在此层下。
    const idleGroup = new THREE.Group();
    idleGroup.name = 'idleGroup';
    orient.add(idleGroup);

    idleGroup.add(baseMesh);
    if (allGroups['_base']) {
      for (const m of allGroups['_base']) idleGroup.add(m);
    }

    // 创建命名子 Group 并挂入 idleGroup
    const subGroupNames = [];
    for (const name of Object.keys(allGroups)) {
      if (name === '_base') continue;
      const g = new THREE.Group();
      g.name = name;
      const meshes = allGroups[name];
      for (const m of meshes) g.add(m);
      idleGroup.add(g);
      subGroupNames.push(name);
    }

    // 根 Group（单位变换，供外部做动画/定位）
    const root = new THREE.Group();
    root.name = 'pieceTemplate_' + type + side;
    root.add(orient);

    // 收集所有 geometry 引用（用于 dispose 计数）
    const geoms = [baseMesh.geometry];
    for (const arr of Object.values(allGroups)) {
      for (const m of arr) geoms.push(m.geometry);
    }

    // 暴露子组名列表（post-clone 时解析为 Object3D 引用，避免
    // Object3D.copy() 对 userData 做 JSON.stringify 时序列化整个场景图）
    root.userData._subGroupNames = subGroupNames;

    return { root: root, geoms: geoms, count: 0 };
  }

  // ── 单分组路径（P/N/B/A，原有逻辑不变）──
  const meshes = P.build();

  // orient 仅承载阵营旋转；整枚棋子的微动一律走 idleGroup（见多分组路径注释）
  const body = new THREE.Group();
  body.name = 'orient';
  if (side === 'b') {
    body.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  }
  const idleGroup = new THREE.Group();
  idleGroup.name = 'idleGroup';
  body.add(idleGroup);
  idleGroup.add(baseMesh);
  for (const m of meshes) idleGroup.add(m);

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

  // 解析子组名 → Object3D 引用（clone 后 orient 已重建，需重新查找）
  if (group.userData._subGroupNames) {
    const orient = group.getObjectByName('orient');
    group.userData.subGroups = {};
    for (const name of group.userData._subGroupNames) {
      group.userData.subGroups[name] = orient ? orient.getObjectByName(name) : null;
    }
  }

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
