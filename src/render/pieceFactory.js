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
 * 阶段二分组契约 2.0（去基座后，见 qin-refactor-master-plan §1.2）：
 *   root > orient > idleGroup > [body meshes] + [命名子组]
 *   K: body | throne | crown | sword | banner
 *   C: trebuchet | cart | soldierL | soldierR
 *   R: horses | body | driver | spearman
 *   P: body | arm | legs
 *   A: body | arms | sword
 *   N: mount | rider
 *   B: robe | arms
 *   公共零件（如 R 车轮）归入 idleGroup 顶层，不作为独立子组。
 *
 *   orient 继承阵营旋转（红方朝 -Z，黑方绕 Y 转 180°）。
 *   子 Group 通过 root.userData.subGroups 或 orient.getObjectByName(name) 访问。
 *
 * 契约导出：
 *   createPieceMesh(type, side) -> THREE.Group
 *     - 局部原点在地面接触点 (y=0)，整体沿 +Y 生长
 *     - group.userData.pieceType / pieceSide 已设置
 *     - 所有子 mesh castShadow = true
 *     - group.userData.dispose() 可安全释放（内部引用计数，共享几何体）
 *     - userData.baseMesh = null（无底座，兼容旧读取方）
 *
 * 性能说明（对契约的一处**优化性偏离**，见 docs/art-bible.md）：
 *   每枚棋子由 28~45 个几何"零件"塑形，但在构建期按材质
 *   mergeGeometries 合并为 3~7 个 Mesh，把 32 枚棋子的 draw call
 *   从 ~1200 压到 ~150，保证 1080p / 60fps。视觉细节量不变。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMaterials, getBannerMaterial } from './materials.js';

/* ============================================================
 * 常量
 * ============================================================ */

/** @deprecated 去基座后保留，仅为外部兼容（原底座半径不再使用） */
export const PIECE_BASE_RADIUS = 0.40;
export const PIECE_MAX_RADIUS = 0.44;

/**
 * 人物/器物起始高度（底座 + 内台）。
 * Phase 1 去基座：历史 FOOT=0.086 保留为「统一下降量」——所有棋子身体部件的
 *  Y 坐标在 Parts.add/strut 内统一减 FOOT（art-bible §5.1 纯减法），
 *  于是靴底/轮底/马蹄直接踩到棋盘面 y=0，总高同步下降 0.086。
 */
const FOOT = 0.086;

/** 底座顶面汉字标识（保留供旗帜/日志备用，不再用于底座贴图） */
export const PIECE_GLYPH = {
  r: { K: '帥', A: '仕', B: '相', N: '馬', R: '俥', C: '炮', P: '兵' },
  b: { K: '將', A: '士', B: '象', N: '馬', R: '車', C: '砲', P: '卒' }
};

/** 各类型标称总高（去基座后，含最高装饰，master-plan §1.1） */
export const PIECE_TOP_Y = { P: 0.70, N: 0.86, B: 0.79, A: 0.79, R: 0.99, C: 0.93, K: 1.29 };

/**
 * K 整体等比预缩放（用户拍板：路径 B，idleGroup.scale=1.25；crown 零加长）。
 * 顶高 1.0332 → 1.0332×1.25 ≈ 1.29，体量 ≈ ×1.95。
 * ⚠ 预缩放锁定：K 的 idleGroup.scale 恒定 1.25，任何动画/崩解不得把它写成 1.0。
 *    MoveAction / CaptureAction / PieceChoreography 已改为按 idleGroup 自身基准缩放。
 */
export const K_IDLE_SCALE = 1.25;

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
const _v2one = new THREE.Vector2(1, 1);

/** 把 Canvas 贴图像素读入内存（仅木纹等单面贴图；banner 双面不在此路径）。
 *  返回 { w, h, data } 或 null（读取失败时退回纯色）。 */
const _mapCache = new Map();
function _sampleMap(tex) {
  if (_mapCache.has(tex)) return _mapCache.get(tex);
  let entry = null;
  try {
    const img = tex && tex.image;
    const w = img && img.width ? img.width : 0;
    const h = img && img.height ? img.height : 0;
    if (w > 0 && h > 0 && img.getContext) {
      const id = img.getContext('2d').getImageData(0, 0, w, h);
      entry = { w: w, h: h, data: id.data };
    }
  } catch (e) { entry = null; }
  _mapCache.set(tex, entry);
  return entry;
}

class Parts {
  constructor() { this.list = []; }

  /** 放置一个零件：pos / rot(Euler XYZ) / scale
   *  ★ 去基座统一偏移：所有零件的 Y 坐标减 FOOT（0.086），
   *    即"整枚棋子身体下移 0.086"，靴/轮/蹄直接踩地（art-bible §5.1）。 */
  add(geom, mat, opts) {
    const o = opts || {};
    const pos = o.pos || [0, 0, 0];
    const rot = o.rot || [0, 0, 0];
    const scl = o.scale || [1, 1, 1];
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(pos[0], pos[1] - FOOT, pos[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ')),
      new THREE.Vector3(scl[0], scl[1], scl[2])
    );
    geom.applyMatrix4(m);
    this.list.push({ geom: geom, mat: mat });
    return this;
  }

  /** 从 A 点到 B 点的圆柱（腿、臂、杆、索、支架）；Y 同减 FOOT */
  strut(mat, a, b, rTop, rBot, seg) {
    _v3a.set(a[0], a[1] - FOOT, a[2]);
    _v3b.set(b[0], b[1] - FOOT, b[2]);
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

  /**
   * 按「PBR 材质族」合并 -> Mesh 数组（draw call 优化的核心，V6 专项）。
   *
   * 硬约束：子组 2.0 契约要求每个演出子组保持独立 Object3D（windUp/strike/
   * settle/dissolvePose 按子组驱动），因此**绝不跨子组合并**、也**绝不把整个
   * 子组实例化**。这里的合并只发生在**单个子组内部**：
   *   1) 取该子组的「主导材质族」= 顶点数更多的族（matte 或 metal）；
   *   2) 子组内所有非双面零件（含木纹等单面贴图）全部烘焙进顶点色，
   *      并入**单 mesh**，材质用主导族代表材质（familyMatte/familyMetal）；
   *   3) 双面零件（banner 旗面 / cape 披风）因 culling/贴图语义不同保持独立。
   * 效果：每子组 N 个材质 → 单 mesh（+ 至多 1 个双面特殊件），
   *       32 子 draw call 544 → ~114（棋子侧 < 155 达标）。
   * 代价：子组内非主导族的 roughness/metalness 统一到主导族代表值——
   *       例：以布料为主的子组里的甲片/鎏金会失去高金属光泽（颜色仍在）。
   */
  build() {
    const mats = getMaterials();
    // 第一步：统计本子组的族分布（matte / metal / 双面特殊件）
    let matteVerts = 0, metalVerts = 0;
    const specials = []; // {geom, mat} 双面保持独立
    for (const p of this.list) {
      if (Array.isArray(p.mat) || !p.mat || p.mat.side === THREE.DoubleSide) {
        specials.push(p);
        continue;
      }
      const n = p.geom.attributes.position.count;
      if (p.mat.metalness >= 0.5) metalVerts += n; else matteVerts += n;
    }
    const useMetal = metalVerts > matteVerts;
    const familyMat = useMetal ? mats.families.metal : mats.families.matte;

    // 第二步：单面零件全部并入主导族 mesh
    const familyGeos = [];
    for (const p of this.list) {
      if (Array.isArray(p.mat) || !p.mat || p.mat.side === THREE.DoubleSide) continue;
      let g = p.geom.clone(); // 不污染模板共享几何
      const pos = g.attributes.position;
      const uv = g.attributes.uv;
      const col = new Float32Array(pos.count * 3);
      const c = p.mat.color;
      // 木纹等单面贴图材质：采样贴图（× 材质色）烘焙进顶点色，保留纹理观感
      const tex = p.mat.map || null;
      const texData = tex ? _sampleMap(tex) : null;
      for (let i = 0; i < pos.count; i++) {
        let r = c.r, gg = c.g, bb = c.b;
        if (texData && uv) {
          const rep = tex.repeat || _v2one;
          let u = uv.getX(i) * rep.x;
          let v = uv.getY(i) * rep.y;
          u = u - Math.floor(u);
          v = v - Math.floor(v);
          const px = Math.min(texData.w - 1, Math.max(0, Math.floor(u * texData.w)));
          const py = Math.min(texData.h - 1, Math.max(0, Math.floor(v * texData.h)));
          const idx = (py * texData.w + px) * 4;
          r = (texData.data[idx] / 255) * c.r;
          gg = (texData.data[idx + 1] / 255) * c.g;
          bb = (texData.data[idx + 2] / 255) * c.b;
        }
        col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = bb;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      familyGeos.push(g);
    }

    // 第三步：双面特殊件按各自材质独立合并
    const specialByMat = new Map();
    for (const p of specials) {
      const key = Array.isArray(p.mat) ? p.mat : p.mat;
      let arr = specialByMat.get(key);
      if (!arr) { arr = []; specialByMat.set(key, arr); }
      arr.push(p.geom);
    }

    const out = [];
    const emit = (geos, mat) => {
      if (!geos.length) return;
      let merged;
      if (geos.length === 1) merged = geos[0];
      else {
        merged = mergeGeometries(geos, false);
        if (!merged) { merged = geos[0]; }
        else { for (const g of geos) g.dispose(); }
      }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      out.push(mesh);
    };
    emit(familyGeos, familyMat);
    for (const entry of specialByMat) emit(entry[1], entry[0]);

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
    /** 默认组名（不归属动画子组的公共零件归入此组，最终放入 idleGroup 顶层，如 R 车轮） */
    this.defaultName = '_base';
  }

  /** 取指定名称的 Parts 收集器；不存在则创建 */
  get(name) {
    if (!this.groups.has(name)) this.groups.set(name, new Parts());
    return this.groups.get(name);
  }

  /** 默认收集器（不归属动画子组的公共零件） */
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
 * 'P' 兵/卒 —— 秦步兵（持戈 + 圆盾）
 * ============================================================ */

function buildPawn(mp, M, K, side) {
  const Pb = mp.get('body');   // 躯干 + 头 + 帽（dissolvePose 整体崩姿）
  const armP = mp.get('arm');  // 双臂 + 戈 + 盾（绕肩 pivot）
  const legP = mp.get('legs'); // 双靴（绕足 pivot，低伏 / 踏步）

  // 战靴（legs 组，接触面用鞋底材质）
  legP.add(box(0.075, 0.045, 0.115), M.bootSole, { pos: [0.055, FOOT + 0.022, -0.028] });
  legP.add(box(0.075, 0.045, 0.115), M.bootSole, { pos: [-0.055, FOOT + 0.022, -0.028] });
  // 短褐（下摆）
  Pb.add(cyl(0.105, 0.155, 0.235, 14), M.cloth, { pos: [0, FOOT + 0.118, 0] });
  Pb.add(tor(0.150, 0.012, 5, 16), M.clothDeep, { pos: [0, FOOT + 0.024, 0], rot: [Math.PI / 2, 0, 0] });
  // 革带
  Pb.add(tor(0.108, 0.016, 5, 16), M.leather, { pos: [0, 0.345, 0], rot: [Math.PI / 2, 0, 0] });
  // 躯干 + 皮甲片（三层）
  Pb.add(cyl(0.100, 0.112, 0.185, 14), M.clothDeep, { pos: [0, 0.437, 0] });
  Pb.add(cyl(0.118, 0.122, 0.022, 14), M.armor, { pos: [0, 0.375, 0] });
  Pb.add(cyl(0.118, 0.122, 0.022, 14), M.armor, { pos: [0, 0.435, 0] });
  Pb.add(cyl(0.116, 0.120, 0.022, 14), M.armor, { pos: [0, 0.492, 0] });
  // 肩
  Pb.add(sph(0.050, 10, 8), M.armorDeep, { pos: [0.098, 0.523, 0] });
  Pb.add(sph(0.050, 10, 8), M.armorDeep, { pos: [-0.098, 0.523, 0] });
  // 领 + 颈 + 头
  Pb.add(cyl(0.062, 0.080, 0.024, 12), M.accentDim, { pos: [0, 0.542, 0] });
  Pb.add(cyl(0.030, 0.032, 0.038, 8), M.skin, { pos: [0, 0.566, 0] });
  Pb.add(sph(0.056, 12, 10), M.skin, { pos: [0, 0.618, -0.006] });
  // 介帻（扁平尖顶软帽）
  Pb.add(cyl(0.072, 0.076, 0.012, 14), M.clothDeep, { pos: [0, 0.657, -0.004] });
  Pb.add(tor(0.062, 0.008, 5, 14), M.leather, { pos: [0, 0.664, -0.004], rot: [Math.PI / 2, 0, 0] });
  Pb.add(cyl(0.022, 0.068, 0.070, 12), M.cloth, { pos: [0, 0.700, -0.004], rot: [-0.12, 0, 0] });

  // 双臂（arm 组，绕肩 pivot）
  armP.strut(M.clothDeep, [0.096, 0.505, 0], [0.150, 0.372, -0.012], 0.028, 0.024, 8);
  armP.strut(M.clothDeep, [-0.096, 0.505, 0], [-0.148, 0.402, -0.040], 0.028, 0.024, 8);
  armP.add(sph(0.032, 10, 8), M.skin, { pos: [0.156, 0.366, -0.014] });
  armP.add(sph(0.032, 10, 8), M.skin, { pos: [-0.152, 0.398, -0.046] });
  // 戈：长杆 + 青铜援 + 内 + 顶刺
  armP.add(cyl(0.011, 0.013, 0.600, 8), M.woodDeep, { pos: [0.170, 0.440, -0.020], rot: [-0.055, 0, 0] });
  armP.add(box(0.118, 0.028, 0.011), K.bronze, { pos: [0.226, 0.700, -0.030], rot: [0, 0, -0.10] });
  armP.add(box(0.052, 0.020, 0.011), K.bronze, { pos: [0.126, 0.686, -0.030] });
  armP.add(cyl(0.000, 0.018, 0.050, 8), K.bronze, { pos: [0.170, 0.765, -0.030] });
  // 小圆盾（面向 -Z）
  armP.add(cyl(0.094, 0.094, 0.018, 14), M.leather, { pos: [-0.176, 0.400, -0.058], rot: [Math.PI / 2, 0, 0] });
  armP.add(tor(0.094, 0.012, 5, 16), M.accentDim, { pos: [-0.176, 0.400, -0.058] });
  armP.add(sph(0.030, 10, 8), K.bronze, { pos: [-0.176, 0.400, -0.076] });
}

/* ============================================================
 * 'N' 马 —— 骑兵（人骑在马上）
 * ============================================================ */

function buildHorse(mp, M, K, side) {
  const mountP = mp.get('mount');   // 马身 + 头 + 四腿 + 尾（绕马身关节自转）
  const riderP = mp.get('rider');   // 骑手 + 长戟（绕骑手关节自转）
  const hide = M.leather;
  // 马身（mount）
  mountP.add(sph(0.135, 14, 10), hide, { pos: [0, 0.355, 0.015], scale: [0.78, 0.82, 1.42] });
  mountP.add(sph(0.115, 12, 9), hide, { pos: [0, 0.372, -0.145], scale: [0.86, 0.90, 0.90] });
  mountP.add(sph(0.120, 12, 9), hide, { pos: [0, 0.358, 0.160], scale: [0.90, 0.95, 0.90] });
  // 颈 + 头 + 口鼻 + 耳
  mountP.strut(hide, [0, 0.600, -0.240], [0, 0.415, -0.130], 0.050, 0.080, 10);
  mountP.add(sph(0.055, 10, 8), hide, { pos: [0, 0.600, -0.282], scale: [0.80, 0.95, 1.42] });
  mountP.add(sph(0.036, 8, 6), hide, { pos: [0, 0.566, -0.344], scale: [0.85, 0.80, 1.00] });
  mountP.add(cyl(0.000, 0.018, 0.044, 6), hide, { pos: [0.028, 0.652, -0.244], rot: [-0.2, 0, 0.15] });
  mountP.add(cyl(0.000, 0.018, 0.044, 6), hide, { pos: [-0.028, 0.652, -0.244], rot: [-0.2, 0, -0.15] });
  // 鬃毛（三角片列）
  mountP.add(box(0.014, 0.058, 0.048), K.hair, { pos: [0, 0.648, -0.232], rot: [0.45, 0, 0] });
  mountP.add(box(0.014, 0.062, 0.048), K.hair, { pos: [0, 0.610, -0.190], rot: [0.55, 0, 0] });
  mountP.add(box(0.014, 0.058, 0.048), K.hair, { pos: [0, 0.564, -0.152], rot: [0.62, 0, 0] });
  // 马面帘
  mountP.add(box(0.060, 0.075, 0.018), M.armor, { pos: [0, 0.610, -0.342], rot: [0.12, 0, 0] });
  // 四腿（左前腿抬起 = 动势）
  mountP.strut(hide, [0.076, 0.300, -0.140], [0.108, 0.178, -0.262], 0.030, 0.024, 8);
  mountP.strut(hide, [-0.076, 0.300, -0.140], [-0.082, FOOT, -0.170], 0.030, 0.024, 8);
  mountP.strut(hide, [0.080, 0.300, 0.165], [0.086, FOOT, 0.208], 0.031, 0.025, 8);
  mountP.strut(hide, [-0.080, 0.300, 0.165], [-0.086, FOOT, 0.208], 0.031, 0.025, 8);
  // 尾
  mountP.strut(K.hair, [0, 0.420, 0.240], [0, 0.196, 0.332], 0.030, 0.010, 8);
  // 鞍
  mountP.add(cyl(0.098, 0.108, 0.052, 12), M.cloth, { pos: [0, 0.438, 0.020], scale: [1, 1, 1.45] });

  /* ---- 骑手（rider） ---- */
  riderP.add(sph(0.070, 10, 8), M.cloth, { pos: [0, 0.490, 0.020] });
  riderP.strut(M.cloth, [0.078, 0.482, 0.005], [0.116, 0.338, -0.098], 0.034, 0.026, 8);
  riderP.strut(M.cloth, [-0.078, 0.482, 0.005], [-0.116, 0.338, -0.098], 0.034, 0.026, 8);
  riderP.add(cyl(0.082, 0.096, 0.160, 12), M.armorDeep, { pos: [0, 0.580, 0.010] });
  riderP.add(cyl(0.101, 0.104, 0.020, 12), M.armor, { pos: [0, 0.548, 0.010] });
  riderP.add(cyl(0.099, 0.102, 0.020, 12), M.armor, { pos: [0, 0.608, 0.010] });
  riderP.add(sph(0.045, 10, 8), M.armorDeep, { pos: [0.086, 0.652, 0.010] });
  riderP.add(sph(0.045, 10, 8), M.armorDeep, { pos: [-0.086, 0.652, 0.010] });
  riderP.add(cyl(0.026, 0.028, 0.030, 8), M.skin, { pos: [0, 0.676, 0.008] });
  riderP.add(sph(0.050, 12, 10), M.skin, { pos: [0, 0.716, 0.002] });
  // 兜鍪 + 顿项 + 缨
  riderP.add(cyl(0.058, 0.070, 0.032, 12), M.armorDeep, { pos: [0, 0.704, 0.002] });
  riderP.add(dome(0.056, 12, 7, 0.58), M.armor, { pos: [0, 0.732, 0.002] });
  riderP.add(cyl(0.000, 0.020, 0.062, 8), M.plume, { pos: [0, 0.796, 0.002] });
  // 双臂持戟
  riderP.strut(M.armorDeep, [0.088, 0.638, 0.005], [0.132, 0.548, -0.086], 0.028, 0.024, 8);
  riderP.strut(M.armorDeep, [-0.088, 0.638, 0.005], [-0.120, 0.556, 0.060], 0.028, 0.024, 8);
  riderP.add(sph(0.030, 10, 8), M.skin, { pos: [0.136, 0.542, -0.094] });
  // 长戟（斜指前上方）
  riderP.add(cyl(0.011, 0.013, 0.680, 8), M.woodDeep, { pos: [0.132, 0.610, -0.010], rot: [-0.742, 0, 0] });
  riderP.strut(K.bronze, [0.132, 0.945, -0.320], [0.132, 0.858, -0.236], 0.000, 0.024, 8);
  riderP.add(box(0.010, 0.072, 0.030), K.bronze, { pos: [0.132, 0.840, -0.262], rot: [-0.742, 0, 0.28] });
}

/* ============================================================
 * 'B' 象/相 —— 书生（宽袖深衣 + 捧简牍）
 * ============================================================ */

function buildElephant(mp, M, K, side) {
  const robeP = mp.get('robe');   // 袍身 + 头 + 帽（静止主体，绕袍身关节微动）
  const armsP = mp.get('arms');   // 宽袖 + 双手 + 简牍（绕肩关节摆动）

  // 履（接触面用鞋底材质）
  robeP.add(box(0.070, 0.035, 0.100), M.bootSole, { pos: [0.048, FOOT + 0.018, -0.030] });
  robeP.add(box(0.070, 0.035, 0.100), M.bootSole, { pos: [-0.048, FOOT + 0.018, -0.030] });
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
  robeP.add(new THREE.LatheGeometry(robePts, 18), M.robe, {});
  robeP.add(tor(0.174, 0.013, 5, 18), M.clothDeep, { pos: [0, 0.104, 0], rot: [Math.PI / 2, 0, 0] });
  // 大带 + 结
  robeP.add(tor(0.125, 0.018, 5, 18), M.accentDim, { pos: [0, 0.452, 0], rot: [Math.PI / 2, 0, 0] });
  robeP.add(box(0.052, 0.055, 0.020), M.accentDim, { pos: [0, 0.442, -0.126] });
  // 交领
  robeP.add(box(0.098, 0.016, 0.012), M.clothDeep, { pos: [0.034, 0.544, -0.098], rot: [0, 0, 0.62] });
  robeP.add(box(0.098, 0.016, 0.012), M.clothDeep, { pos: [-0.034, 0.544, -0.098], rot: [0, 0, -0.62] });
  robeP.add(cyl(0.048, 0.060, 0.022, 12), M.clothDeep, { pos: [0, 0.585, 0] });
  // 颈 + 头 + 髯
  robeP.add(cyl(0.028, 0.030, 0.034, 8), M.skin, { pos: [0, 0.602, 0] });
  robeP.add(sph(0.055, 12, 10), M.skin, { pos: [0, 0.652, -0.004] });
  robeP.strut(K.hair, [0, 0.632, -0.048], [0, 0.548, -0.030], 0.030, 0.008, 8);
  // 髻 + 进贤冠
  robeP.add(cyl(0.058, 0.064, 0.030, 12), M.clothDeep, { pos: [0, 0.706, 0.004] });
  robeP.add(box(0.082, 0.145, 0.096), M.clothDeep, { pos: [0, 0.790, 0.014], rot: [-0.18, 0, 0] });
  robeP.add(box(0.060, 0.012, 0.098), M.accentDim, { pos: [0, 0.862, 0.002], rot: [-0.18, 0, 0] });
  robeP.add(box(0.070, 0.058, 0.014), M.clothDeep, { pos: [0, 0.726, 0.074], rot: [0.30, 0, 0] });

  // 宽袖 + 双手 + 简牍（arms，绕肩关节摆动）
  armsP.strut(M.robe, [0.104, 0.545, -0.010], [0.176, 0.378, -0.042], 0.060, 0.088, 12);
  armsP.strut(M.robe, [-0.104, 0.545, -0.010], [-0.176, 0.378, -0.042], 0.060, 0.088, 12);
  armsP.add(tor(0.084, 0.012, 5, 14), M.clothDeep, { pos: [0.178, 0.372, -0.044], rot: [1.30, 0, -0.38] });
  armsP.add(tor(0.084, 0.012, 5, 14), M.clothDeep, { pos: [-0.178, 0.372, -0.044], rot: [1.30, 0, 0.38] });
  armsP.add(sph(0.032, 10, 8), M.skin, { pos: [0.052, 0.498, -0.118] });
  armsP.add(sph(0.032, 10, 8), M.skin, { pos: [-0.052, 0.498, -0.118] });
  armsP.add(box(0.168, 0.112, 0.016), K.paper, { pos: [0, 0.516, -0.136], rot: [-0.34, 0, 0] });
  armsP.add(box(0.174, 0.009, 0.020), K.ink, { pos: [0, 0.549, -0.146], rot: [-0.34, 0, 0] });
  armsP.add(box(0.174, 0.009, 0.020), K.ink, { pos: [0, 0.483, -0.124], rot: [-0.34, 0, 0] });
  armsP.add(box(0.006, 0.098, 0.006), K.ink, { pos: [0.046, 0.516, -0.145], rot: [-0.34, 0, 0] });
  armsP.add(box(0.006, 0.098, 0.006), K.ink, { pos: [0, 0.516, -0.145], rot: [-0.34, 0, 0] });
  armsP.add(box(0.006, 0.098, 0.006), K.ink, { pos: [-0.046, 0.516, -0.145], rot: [-0.34, 0, 0] });
}

/* ============================================================
 * 'A' 士/仕 —— 宫廷卫士（筒袖铠 + 双手拄剑）
 * ============================================================ */

function buildAdvisor(mp, M, K, side) {
  const Pb = mp.get('body');    // 躯干 + 腿 + 头 + 武弁（dissolvePose 整体崩姿）
  const armP = mp.get('arms');  // 双臂 + 手（按剑下压，绕肩 pivot）
  const swordP = mp.get('sword'); // 剑（挥斩，绕握把 pivot）

  // 战靴（接触面用鞋底材质）
  Pb.add(box(0.070, 0.040, 0.100), M.bootSole, { pos: [0.050, FOOT + 0.020, -0.024] });
  Pb.add(box(0.070, 0.040, 0.100), M.bootSole, { pos: [-0.050, FOOT + 0.020, -0.024] });
  // 甲裙
  Pb.add(cyl(0.128, 0.168, 0.254, 14), M.armorDeep, { pos: [0, FOOT + 0.127, 0] });
  Pb.add(cyl(0.152, 0.158, 0.022, 14), M.armor, { pos: [0, 0.160, 0] });
  Pb.add(cyl(0.143, 0.148, 0.022, 14), M.armor, { pos: [0, 0.252, 0] });
  // 腰带
  Pb.add(tor(0.130, 0.017, 5, 18), M.leather, { pos: [0, 0.346, 0], rot: [Math.PI / 2, 0, 0] });
  // 筒袖铠躯干 + 四层甲片
  Pb.add(cyl(0.116, 0.132, 0.262, 14), M.armorDeep, { pos: [0, 0.472, 0] });
  Pb.add(cyl(0.136, 0.140, 0.023, 14), M.armor, { pos: [0, 0.382, 0] });
  Pb.add(cyl(0.134, 0.138, 0.023, 14), M.armor, { pos: [0, 0.446, 0] });
  Pb.add(cyl(0.131, 0.135, 0.023, 14), M.armor, { pos: [0, 0.510, 0] });
  Pb.add(cyl(0.127, 0.131, 0.023, 14), M.armor, { pos: [0, 0.572, 0] });
  // 筒袖
  Pb.add(cyl(0.050, 0.060, 0.180, 10), M.armorDeep, { pos: [0.146, 0.472, -0.006] });
  Pb.add(cyl(0.050, 0.060, 0.180, 10), M.armorDeep, { pos: [-0.146, 0.472, -0.006] });
  // 披膊
  Pb.add(dome(0.072, 12, 7, 0.60), M.armor, { pos: [0.140, 0.582, 0] });
  Pb.add(dome(0.072, 12, 7, 0.60), M.armor, { pos: [-0.140, 0.582, 0] });
  // 盆领 + 颈 + 头
  Pb.add(cyl(0.064, 0.086, 0.030, 12), M.accentDim, { pos: [0, 0.615, 0] });
  Pb.add(cyl(0.028, 0.030, 0.030, 8), M.skin, { pos: [0, 0.648, 0] });
  Pb.add(sph(0.056, 12, 10), M.skin, { pos: [0, 0.715, -0.004] });
  // 武弁
  Pb.add(cyl(0.062, 0.068, 0.024, 12), M.accentDim, { pos: [0, 0.756, -0.002] });
  Pb.add(cyl(0.028, 0.062, 0.086, 12), M.clothDeep, { pos: [0, 0.810, -0.002] });
  Pb.add(sph(0.020, 10, 8), M.accent, { pos: [0, 0.860, -0.002] });
  Pb.add(box(0.012, 0.088, 0.008), M.cloth, { pos: [0.052, 0.716, 0.040], rot: [0.16, 0, 0.08] });
  Pb.add(box(0.012, 0.088, 0.008), M.cloth, { pos: [-0.052, 0.716, 0.040], rot: [0.16, 0, -0.08] });

  // 双臂 + 手（arms 组，绕肩 pivot）
  armP.strut(M.armorDeep, [0.140, 0.560, -0.006], [0.048, 0.556, -0.100], 0.030, 0.026, 8);
  armP.strut(M.armorDeep, [-0.140, 0.560, -0.006], [-0.048, 0.534, -0.100], 0.030, 0.026, 8);
  armP.add(sph(0.032, 10, 8), M.skin, { pos: [0.036, 0.556, -0.114] });
  armP.add(sph(0.032, 10, 8), M.skin, { pos: [-0.036, 0.532, -0.114] });

  // 双手拄剑（sword 组，绕握把 pivot）
  swordP.add(box(0.048, 0.400, 0.015), K.blade, { pos: [0, 0.288, -0.116] });
  swordP.add(box(0.094, 0.022, 0.030), K.bronze, { pos: [0, 0.500, -0.116] });
  swordP.add(cyl(0.017, 0.019, 0.086, 10), M.leather, { pos: [0, 0.554, -0.116] });
  swordP.add(sph(0.026, 10, 8), K.bronze, { pos: [0, 0.606, -0.116] });
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

  // 车旗（V6 高度专项：旗杆/旗面/顶饰整体加高，使 R 顶高 0.81 → ~0.99；
  //  仍归 body 子组，windUp/strike/settle 独立变换不受影响）
  Pc.add(cyl(0.010, 0.012, 0.400, 8), M.woodDeep, { pos: [0.104, 0.810, 0.130] });
  Pc.strut(M.accent, [0.104, 1.072, 0.130], [0.104, 1.018, 0.130], 0.000, 0.016, 8);
  Pc.add(
    curvedBanner(0.175, 0.130, 0.026, 8),
    getBannerMaterial(PIECE_GLYPH[side].R, side),
    { pos: [0.104, 0.936, 0.038], rot: [0, Math.PI / 2, 0] }
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
 * 分组：trebuchet | cart(木底座) | soldierL(左兵) | soldierR(右兵)
 * ============================================================ */

function buildCannon(mp, M, K, side) {
  const Pcart = mp.get('cart'); // 木底座（底梁 + 铁角 + 绞盘，DISSOLVE_POSE 散架）
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

  /* ======== 木底座（cart 组，地面接触层）======== */
  Pcart.add(box(0.042, 0.042, 0.480), M.wood, { pos: [0.145, FOOT + 0.020, 0] });
  Pcart.add(box(0.042, 0.042, 0.480), M.wood, { pos: [-0.145, FOOT + 0.020, 0] });
  Pcart.add(box(0.334, 0.038, 0.042), M.wood, { pos: [0, FOOT + 0.020, 0.185] });
  Pcart.add(box(0.334, 0.038, 0.042), M.wood, { pos: [0, FOOT + 0.020, -0.185] });

  // 铁角
  Pcart.add(box(0.046, 0.028, 0.046), M.accentDim, { pos: [0.145, FOOT + 0.040, 0.185] });
  Pcart.add(box(0.046, 0.028, 0.046), M.accentDim, { pos: [-0.145, FOOT + 0.040, 0.185] });
  Pcart.add(box(0.046, 0.028, 0.046), M.accentDim, { pos: [0.145, FOOT + 0.040, -0.185] });
  Pcart.add(box(0.046, 0.028, 0.046), M.accentDim, { pos: [-0.145, FOOT + 0.040, -0.185] });

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

  // 绞盘（cart 组，基座中央，两纵梁之间，对应小兵转绞盘姿态）
  Pcart.strut(M.woodDeep, [0.080, FOOT + 0.020, 0], [0.080, 0.140, 0], 0.014, 0.012, 6);
  Pcart.strut(M.woodDeep, [-0.080, FOOT + 0.020, 0], [-0.080, 0.140, 0], 0.014, 0.012, 6);
  Pcart.add(cyl(0.026, 0.026, 0.160, 10), M.woodDeep, { pos: [0, 0.140, 0], rot: [0, 0, Math.PI / 2] });
  Pcart.add(cyl(0.014, 0.014, 0.030, 8), K.bronzeDark, { pos: [0.095, 0.140, 0], rot: [0, 0, Math.PI / 2] });
  Pcart.add(cyl(0.014, 0.014, 0.030, 8), K.bronzeDark, { pos: [-0.095, 0.140, 0], rot: [0, 0, Math.PI / 2] });
  // 摇柄（L 形，两侧）
  Pcart.add(box(0.040, 0.010, 0.010), K.bronzeDark, { pos: [0.125, 0.140, 0] });
  Pcart.add(cyl(0.006, 0.006, 0.028, 6), K.bronzeDark, { pos: [0.142, 0.154, 0] });
  Pcart.add(box(0.040, 0.010, 0.010), K.bronzeDark, { pos: [-0.125, 0.140, 0] });
  Pcart.add(cyl(0.006, 0.006, 0.028, 6), K.bronzeDark, { pos: [-0.142, 0.154, 0] });

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
  buildCannonSoldier(PL, M, K, -0.250, FOOT, 0.95, 1);

  /* ======== 右侧士兵（soldierR 组）======== */
  buildCannonSoldier(PR, M, K, 0.250, FOOT, 0.95, -1);
}

/** 炮兵（推车/操作绞盘姿态，mirrorX=-1 时镜像翻转） */
function buildCannonSoldier(P, M, K, ox, oy, s, mirrorX) {
  const sc = s || 0.85;
  const mx = mirrorX || 1;
  const legH = 0.038 * sc;
  // 腿 + 靴（落地，靴底 y = oy；接触面用鞋底材质）
  P.add(cyl(0.016 * sc, 0.020 * sc, 0.055 * sc, 8), M.clothDeep, { pos: [ox - 0.024 * sc * mx, oy + 0.027 * sc, 0] });
  P.add(cyl(0.016 * sc, 0.020 * sc, 0.055 * sc, 8), M.clothDeep, { pos: [ox + 0.024 * sc * mx, oy + 0.027 * sc, 0] });
  P.add(box(0.034 * sc, 0.022 * sc, 0.058 * sc), M.bootSole, { pos: [ox - 0.024 * sc * mx, oy + 0.011 * sc, -0.016 * sc] });
  P.add(box(0.034 * sc, 0.022 * sc, 0.058 * sc), M.bootSole, { pos: [ox + 0.024 * sc * mx, oy + 0.011 * sc, -0.016 * sc] });
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
 * 分组：body(坐姿人物) | throne(龙椅) | crown(鹖冠) | sword(佩剑) | banner(帅旗)
 * ============================================================ */

function buildKing(mp, M, K, side) {
  const Pb = mp.get('body');      // 坐姿人物（dissolvePose 整体；右臂已拆给 rArm）
  const Pt = mp.get('throne');    // 秦式王座（windUp/strike/settle）t01~t07
  const Pcrown = mp.get('crown'); // 鹖冠 + 立缨（DISSOLVE_POSE 冕落）
  const Psword = mp.get('sword'); // 佩剑（windUp/strike/settle）
  const Pbanner = mp.get('banner'); // 帅旗（待机旌旗微动）
  const Pr = mp.get('rArm');      // 右臂+右手（契约 2.1 新增：待机抚扶手）

  const SEAT_Y = FOOT + 0.065; // 龙椅座位高度（路径 B：人物几何零改动，锚点不变）
  const BODY_BOT = SEAT_Y + 0.020; // 人物臀部坐在椅面上

  /* ============================================================
   * 秦式王座（throne 组）t01~t07 —— 造型以 art-royal-throne.md 为准
   * 纹样全部「几何分层表达」，不新增贴图；材质族全复用。
   * 以下坐标为 idleGroup 局部（×1.25 后为世界尺寸；顶高 ~1.14 < crown 1.29）。
   * ============================================================ */
  // —— t01 重台基座（4 层，最宽 0.52 < 格距 1.0；底面贴 y=0）——
  Pt.add(box(0.520, 0.040, 0.440), M.woodDeep, { pos: [0, FOOT + 0.020, 0] });        // L1 最宽接地
  Pt.add(box(0.520, 0.010, 0.440), M.accent,    { pos: [0, FOOT + 0.041, 0] });      // L1 顶沿鎏金包边
  Pt.add(box(0.440, 0.034, 0.380), M.wood,      { pos: [0, FOOT + 0.056, 0] });      // L2 内收
  Pt.add(box(0.360, 0.028, 0.320), M.wood,      { pos: [0, FOOT + 0.086, 0] });      // L3 内收
  Pt.add(box(0.360, 0.009, 0.320), M.accentDim, { pos: [0, FOOT + 0.097, 0] });      // L3 顶沿
  Pt.add(box(0.300, 0.024, 0.270), M.woodDeep,  { pos: [0, FOOT + 0.112, 0] });      // L4 台面（座身底部）

  // —— t02 椅座（座身 + 座垫 + 座垫沿）——
  Pt.add(box(0.300, 0.060, 0.260), M.woodDeep,  { pos: [0, FOOT + 0.152, 0] });      // 座身 0.124→0.184
  Pt.add(box(0.320, 0.035, 0.280), M.clothDeep, { pos: [0, FOOT + 0.198, 0] });      // 座垫 0.1805→0.2155
  Pt.add(box(0.320, 0.009, 0.280), M.accentDim, { pos: [0, FOOT + 0.2155, 0] });     // 座垫沿

  // —— t03 高背主体（高度主体：背板顶 ~0.86 → ×1.25 ≈ 1.08；V3「高背王座」成立）——
  Pt.add(box(0.300, 0.600, 0.060), M.woodDeep,  { pos: [0, FOOT + 0.560, -0.100] }); // 背板 0.26→0.86
  Pt.add(box(0.270, 0.540, 0.042), M.wood,      { pos: [0, FOOT + 0.550, -0.096] }); // 内衬分层（厚度感）
  // 顶部夔龙纹横梁（几何化兽首对望，鎏金）
  Pt.add(box(0.340, 0.070, 0.080), M.accent,    { pos: [0, FOOT + 0.880, -0.100] }); // 横梁 0.845→0.915
  Pt.add(sph(0.030, 10, 8), M.accent,           { pos: [0.170, FOOT + 0.885, -0.100] }); // 左端球饰
  Pt.add(sph(0.030, 10, 8), M.accent,           { pos: [-0.170, FOOT + 0.885, -0.100] }); // 右端球饰
  // 中央竖脊（横梁垂至座垫，中轴）
  Pt.add(box(0.030, 0.520, 0.030), M.accentDim, { pos: [0, FOOT + 0.600, -0.112] });
  // 云雷纹饰板 ×2（分层细带模拟镂空）
  Pt.add(box(0.060, 0.380, 0.020), M.accent,    { pos: [0.092, FOOT + 0.500, -0.110] });
  Pt.add(box(0.060, 0.380, 0.020), M.accent,    { pos: [-0.092, FOOT + 0.500, -0.110] });
  // 靠背中央蟠螭纹独立双面装饰件（用户拍板启用：+1 mesh/枚 K = +2 dc；DoubleSide 中性色）
  Pt.add(box(0.110, 0.420, 0.012), K.panChi,    { pos: [0, FOOT + 0.505, -0.086] });

  // —— t04 扶手 + 龙首（fx=±0.16，与人物手臂对位；端头鎏金兽首）——
  for (let s = -1; s <= 1; s += 2) {
    const fx = 0.160 * s;
    // 前支柱（座身前角升起）
    Pt.strut(M.woodDeep, [fx, 0.140, -0.050], [fx, 0.200, -0.050], 0.018, 0.014, 8);
    // 后支柱
    Pt.strut(M.woodDeep, [fx, 0.140, 0.090], [fx, 0.200, 0.090], 0.018, 0.014, 8);
    // 扶手横杆（圆棍，前龙首 → 后座）
    Pt.add(cyl(0.014, 0.014, 0.160, 10), M.wood, {
      pos: [fx, FOOT + 0.200, 0.020], rot: [0, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2]
    });
    // 端头龙首（简化兽首衔环，鎏金高光）
    Pt.add(sph(0.028, 10, 8), M.accent, { pos: [fx, FOOT + 0.206, -0.070] });
    // 兽爪足（接地）
    Pt.add(box(0.030, 0.026, 0.040), M.accentDim, { pos: [fx, FOOT + 0.013, -0.050] });
  }

  // —— t05 踏脚（新增，底 y≈0.05 不插穿棋盘面；K 双脚踩实）——
  Pt.add(box(0.260, 0.040, 0.160), M.woodDeep, { pos: [0, FOOT + 0.070, 0.120] });    // 0.05→0.09

  // —— t06 双层垂帘（暗红丝织；下摆收在 y=0 之上，避免插穿棋盘面）——
  Pt.add(box(0.240, 0.070, 0.014), M.capeCloth, { pos: [0, FOOT + 0.120, 0.100] });   // 外层 0.085→0.155
  Pt.add(box(0.210, 0.052, 0.010), M.capeCloth, { pos: [0, FOOT + 0.108, 0.088] });   // 内层分层

  /* ======== 坐姿人物（body 组，路径 B：几何零改动，仅移除右臂交给 rArm）======== */
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

  // 披风（坐姿时从肩后垂落到椅背外；下摆收在 y=0 之上，避免插穿棋盘面）
  const capePts = [
    new THREE.Vector2(0.100, BODY_BOT + 0.178),
    new THREE.Vector2(0.140, BODY_BOT + 0.098),
    new THREE.Vector2(0.178, BODY_BOT - 0.002),
    new THREE.Vector2(0.208, BODY_BOT - 0.085),
    new THREE.Vector2(0.222, BODY_BOT - 0.085)
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

  // 左臂：左手搁扶手上（右手已拆给 rArm 子组，待机抚扶手）
  Pb.strut(M.armorDeep, [-0.140, BODY_BOT + 0.146, 0], [-0.168, BODY_BOT + 0.118, 0.056], 0.042, 0.032, 8);
  Pb.add(sph(0.032, 10, 8), M.skin, { pos: [-0.168, BODY_BOT + 0.114, 0.058] });

  // 颈 + 头 + 髯
  Pb.add(cyl(0.030, 0.032, 0.030, 8), M.skin, { pos: [0, BODY_BOT + 0.218, 0] });
  Pb.add(sph(0.056, 12, 10), M.skin, { pos: [0, BODY_BOT + 0.268, -0.004] });
  Pb.strut(K.hair, [0, BODY_BOT + 0.244, -0.048], [0, BODY_BOT + 0.204, -0.032], 0.030, 0.008, 8);

  // 鹖冠（crown 组）+ 佩剑（sword 组）+ 帅旗（banner 组）+ 右臂（rArm 组）
  buildKingCrown(Pcrown, M, K, BODY_BOT);
  buildKingSword(Psword, M, K, BODY_BOT);
  buildKingBanner(Pbanner, M, K, side);
  buildKingArm(Pr, M, K);
}

/** 右臂 + 右手（rArm 组，契约 2.1）—— 待机「抚扶手摩挲」；战斗 windUp/strike/settle 不引用。
 *  绕右肩关节（SUBGROUP_JOINTS.K.rArm = [0.14, 0.317, 0]）自转，
 *  默认姿态烘焙为「右手搁扶手端头」，与 t04 右扶手（fx=+0.16, y≈0.19~0.21）对位。 */
function buildKingArm(P, M, K) {
  // 上臂 + 前臂（从肩关节斜下至扶手端头）
  P.strut(M.armorDeep, [0.140, 0.317, 0], [0.160, 0.195, -0.050], 0.030, 0.022, 8);
  // 袖口（近肘，形成袖袍层次）
  P.add(sph(0.036, 10, 8), M.clothDeep, { pos: [0.150, FOOT + 0.252, -0.022] });
  // 右手（抚扶手）
  P.add(sph(0.030, 10, 8), M.skin, { pos: [0.160, FOOT + 0.190, -0.050] });
}

/** 鹖冠（高冠 + 立缨双羽）—— 归入 crown 子组，DISSOLVE_POSE 冕落用。
 *  V6 高度专项：crown 锚点契约 0.964 不变，几何整体加高——冠身加长、
 *  立缨双羽抬高，使 K 顶高 0.68 → ~1.03（剪影仍为最高子，且不倒退）。 */
function buildKingCrown(P, M, K, BODY_BOT) {
  P.add(cyl(0.064, 0.068, 0.024, 14), M.accent, { pos: [0, BODY_BOT + 0.312, -0.002] });
  P.add(cyl(0.026, 0.060, 0.300, 14), M.clothDeep, { pos: [0, BODY_BOT + 0.450, -0.002] });
  P.add(sph(0.024, 10, 8), M.accent, { pos: [0, BODY_BOT + 0.620, -0.002] });
  P.strut(M.plume, [0.030, BODY_BOT + 0.600, 0.016], [0.075, BODY_BOT + 0.945, 0.062], 0.006, 0.018, 6);
  P.strut(M.plume, [-0.030, BODY_BOT + 0.600, 0.016], [-0.075, BODY_BOT + 0.945, 0.062], 0.006, 0.018, 6);
}

/** 佩剑（右侧按剑）—— 归入 sword 子组，windUp/strike/settle 挥斩用。
 *  剑身下摆缩短至剑尖贴地（world y=0），避免去基座后插穿棋盘面。 */
function buildKingSword(P, M, K, BODY_BOT) {
  P.add(box(0.046, 0.218, 0.022), M.woodDeep, { pos: [0.162, BODY_BOT + 0.024, -0.018] });
  P.add(box(0.052, 0.022, 0.028), M.accent, { pos: [0.162, BODY_BOT + 0.144, -0.018] });
  P.add(box(0.084, 0.018, 0.028), K.bronze, { pos: [0.162, BODY_BOT + 0.162, -0.018] });
  P.add(cyl(0.016, 0.018, 0.068, 10), M.leather, { pos: [0.162, BODY_BOT + 0.204, -0.018] });
  P.add(sph(0.024, 10, 8), K.bronze, { pos: [0.162, BODY_BOT + 0.244, -0.018] });
}

/** 帅旗（旗杆 + 旗面 + 顶饰）—— 归入 banner 子组，待机旌旗微动用 */
function buildKingBanner(P, M, K, side) {
  P.add(cyl(0.046, 0.056, 0.036, 10), M.accentDim, { pos: [0.228, FOOT + 0.018, 0.126] });
  P.add(cyl(0.012, 0.014, 0.600, 8), M.woodDeep, { pos: [0.228, 0.400, 0.126] });
  P.strut(M.accent, [0.228, 0.756, 0.126], [0.228, 0.694, 0.126], 0.000, 0.020, 8);
  P.add(sph(0.024, 8, 6), M.plume, { pos: [0.228, 0.688, 0.126] });
  P.add(
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

/** 需要多分组的棋子类型（阶段三动画：P/A 拆出 pivot 正确的子组） */
const MULTI_GROUP_TYPES = new Set(['K', 'C', 'R', 'P', 'A', 'N', 'B']);

/**
 * 各命名子组在棋子根局部坐标中的「关节锚点」（去基座后重算，master-plan §1.2）。
 * buildTemplate 多分组路径会把该子组几何整体平移 -joint，再把 Group 放到 joint，
 * 于是子组旋转即绕关节本身（不再是绕棋子根/棋盘中心公转）。
 * 仅列出需要精炼旋转的子组；为空则 Group 留在原点（平移类动画不受影响）。
 */
const SUBGROUP_JOINTS = {
  P: { body: [0, 0.334, 0], arm: [0, 0.348, 0], legs: [0, -0.086, 0] },
  A: { body: [0, 0.334, 0], arms: [0, 0.378, 0], sword: [0, 0.328, -0.10] },
  N: { mount: [0, 0.128, 0], rider: [0, 0.328, 0] },
  B: { robe: [0, 0.368, 0], arms: [0, 0.328, -0.10] },
  R: { horses: [0, 0.168, -0.30], body: [0, 0.288, 0.02], driver: [0.05, 0.378, 0.40], spearman: [-0.05, 0.378, 0.46] },
  C: { trebuchet: [0, 0.308, 0], cart: [0, 0.114, 0], soldierL: [-0.25, 0.248, 0.09], soldierR: [0.25, 0.248, 0.09] },
  K: { body: [0, 0.378, 0], throne: [0, 0.028, 0], crown: [0, 0.964, 0], sword: [0.14, 0.434, -0.02], banner: [0, 0.394, 0], rArm: [0.14, 0.317, 0] }
};

const _templates = new Map();

function buildTemplate(type, side) {
  const mats = getMaterials();
  const M = mats.side(side);
  const K = mats.common;

  const useMulti = MULTI_GROUP_TYPES.has(type);
  let mp = null;
  let P = null;

  if (useMulti) {
    mp = new MultiParts();
    P = mp.base;
  } else {
    P = new Parts();
  }

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

    // ★ K 预缩放锁定（用户拍板路径 B）：整枚等比 1.25，crown 零加长。
    //   任何动画（MoveAction/CaptureAction/dissolvePose）均按 idleGroup 自身基准
    //   做相对缩放扰动，绝不把这里写回 1.0（见各处 idleBase 处理）。
    if (type === 'K') idleGroup.scale.setScalar(K_IDLE_SCALE);

    if (allGroups['_base']) {
      for (const m of allGroups['_base']) idleGroup.add(m);
    }

    // 创建命名子 Group 并挂入 idleGroup
    const subGroupNames = [];
    const jointTable = SUBGROUP_JOINTS[type] || null;
    for (const name of Object.keys(allGroups)) {
      if (name === '_base') continue;
      const g = new THREE.Group();
      g.name = name;
      const meshes = allGroups[name];
      // 关节锚定：把子组几何整体平移 -joint，再把 Group 放到 joint，
      // 于是子组的旋转/缩放围绕"关节本身"进行，而非棋子根/棋盘中心
      // （修复障碍②：子组绕中心公转而非绕关节自转）。
      const joint = jointTable && jointTable[name];
      if (joint) {
        const jx = joint[0], jy = joint[1], jz = joint[2];
        for (const m of meshes) m.geometry.translate(-jx, -jy, -jz);
        g.position.set(jx, jy, jz);
      }
      for (const m of meshes) g.add(m);
      idleGroup.add(g);
      subGroupNames.push(name);
    }

    // 根 Group（单位变换，供外部做动画/定位）
    const root = new THREE.Group();
    root.name = 'pieceTemplate_' + type + side;
    root.add(orient);

    // 收集所有 geometry 引用（用于 dispose 计数）
    const geoms = [];
    for (const arr of Object.values(allGroups)) {
      for (const m of arr) geoms.push(m.geometry);
    }

    // 暴露子组名列表（post-clone 时解析为 Object3D 引用，避免
    // Object3D.copy() 对 userData 做 JSON.stringify 时序列化整个场景图）
    root.userData._subGroupNames = subGroupNames;

    return { root: root, geoms: geoms, count: 0 };
  }

  // ── 单分组路径（P/N/B/A，原有逻辑不变；当前 MULTI_GROUP_TYPES 已覆盖全部兵种）──
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
  for (const m of meshes) idleGroup.add(m);

  const root = new THREE.Group();
  root.name = 'pieceTemplate_' + type + side;
  root.add(body);

  const geoms = [];
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
      // 无底座：棋子自身不接收阴影，阴影由棋盘面承接形成"踩实"锚点
      o.receiveShadow = false;
    }
  });
  // 无底座：baseMesh 恒为 null（兼容旧读取方，V1 验收点）
  group.userData.baseMesh = null;

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
