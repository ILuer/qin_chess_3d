/**
 * src/render/boardMesh.js
 * ------------------------------------------------------------
 * 秦式棋盘 + 环境装饰。100% 程序化，零外部资源。
 *
 * 契约导出：
 *   createBoard()        -> THREE.Group  台面顶部恰好 y = 0
 *   createEnvironment()  -> THREE.Group  秦式环境（不遮挡棋盘与相机轨道）
 *
 * 坐标系（与 CONTRACT.md 一致）：
 *   worldX = (file - 4) * 1.0     file 0..8   -> -4 .. +4
 *   worldZ = (rank - 4.5) * 1.0   rank 0..9   -> -4.5 .. +4.5
 *   河界位于 rank4 / rank5 之间，即 worldZ ∈ [-0.5, +0.5]
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMaterials, getBannerMaterial } from './materials.js';

/* ---------------- 尺寸常量 ---------------- */
const GRID = 1.0;
const HALF_W = 4.0;          // 落子区半宽（file）
const HALF_D = 4.5;          // 落子区半深（rank）
const TOP_W = 9.70;          // 台面宽
const TOP_D = 10.70;         // 台面深
const TOP_TH = 0.32;         // 台面厚
const LINE_Y = 0.005;        // 棋盘线中心高
const LINE_H = 0.012;        // 棋盘线厚（露出 0.011）
const LINE_W = 0.026;        // 普通线宽
const EDGE_W = 0.042;        // 外框线宽
const RIVER_Z = 0.5;         // 河界半宽

const wx = (file) => (file - 4) * GRID;
const wz = (rank) => (rank - 4.5) * GRID;

/* ---------------- 合并收集器 ---------------- */

class Bin {
  constructor() { this.geoms = []; }
  push(g) { this.geoms.push(g); return this; }
  /** 轴对齐线段盒 */
  seg(x1, z1, x2, z2, w) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) return this;
    const g = new THREE.BoxGeometry(len, LINE_H, w);
    const ang = Math.atan2(-dz, dx);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3((x1 + x2) / 2, LINE_Y, (z1 + z2) / 2),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ang, 0)),
      new THREE.Vector3(1, 1, 1)
    ));
    this.geoms.push(g);
    return this;
  }
  merge() {
    if (this.geoms.length === 0) return null;
    if (this.geoms.length === 1) return this.geoms[0];
    const m = mergeGeometries(this.geoms, false);
    if (m) { for (const g of this.geoms) g.dispose(); return m; }
    return this.geoms[0];
  }
}

/** 传统"十"字直角位标（炮位 / 兵位） */
function addPositionMark(bin, file, rank) {
  const px = wx(file), pz = wz(rank);
  const gap = 0.095, arm = 0.20, t = LINE_W;
  const xs = [];
  if (file > 0) xs.push(-1);
  if (file < 8) xs.push(1);
  for (const sx of xs) {
    for (const sz of [-1, 1]) {
      // 横臂
      bin.push(new THREE.BoxGeometry(arm, LINE_H, t).translate(
        px + sx * (gap + arm / 2), LINE_Y, pz + sz * gap
      ));
      // 竖臂
      bin.push(new THREE.BoxGeometry(t, LINE_H, arm).translate(
        px + sx * gap, LINE_Y, pz + sz * (gap + arm / 2)
      ));
    }
  }
}

/* ============================================================
 * createBoard()
 * ============================================================ */

export function createBoard() {
  const mats = getMaterials();
  const B = mats.board;
  const group = new THREE.Group();
  group.name = 'board';

  /* ---- 1. 木质厚板台面（顶面恰好 y = 0） ----
   * 原实现为 6 材质数组 BoxGeometry = 6 个 draw call；改为
   * 「顶面平面(woodTop) + 侧面盒(woodEdge)」= 2 个 draw call，视觉不变。 */
  const topPlaneGeo = new THREE.PlaneGeometry(TOP_W, TOP_D);
  topPlaneGeo.rotateX(-Math.PI / 2);
  topPlaneGeo.translate(0, 0, 0);
  const topPlane = new THREE.Mesh(topPlaneGeo, B.top);
  topPlane.name = 'boardTop';
  topPlane.receiveShadow = true;
  topPlane.castShadow = false;
  group.add(topPlane);

  const sideGeo = new THREE.BoxGeometry(TOP_W, TOP_TH, TOP_D);
  sideGeo.translate(0, -TOP_TH / 2 - 0.002, 0); // 顶面比顶面平面低 2mm，避免 z-fight
  // 单材质盒：顶面被 topPlane 盖住、底面不可见，仅 4 侧面参与绘制（1 draw call）
  const sideMesh = new THREE.Mesh(sideGeo, B.edge);
  sideMesh.name = 'boardSide';
  sideMesh.receiveShadow = true;
  sideMesh.castShadow = false;
  group.add(sideMesh);

  /* ---- 2. 河界暗色嵌板（微浮雕） ---- */
  const riverGeo = new THREE.BoxGeometry(HALF_W * 2 + 0.02, 0.010, RIVER_Z * 2 - 0.03);
  riverGeo.translate(0, 0.003, 0);
  const river = new THREE.Mesh(riverGeo, B.edge);
  river.name = 'river';
  river.receiveShadow = true;
  group.add(river);

  /* ---- 3. 棋盘线（全部合并为 1 个 Mesh） ---- */
  const bin = new Bin();

  // 横线 10 条（rank 0..9）
  for (let r = 0; r < 10; r++) {
    const w = (r === 0 || r === 9) ? EDGE_W : LINE_W;
    bin.seg(-HALF_W, wz(r), HALF_W, wz(r), w);
  }
  // 竖线 9 条（file 0..8）—— 中间 7 条在河界处中断
  for (let f = 0; f < 9; f++) {
    const x = wx(f);
    if (f === 0 || f === 8) {
      bin.seg(x, -HALF_D, x, HALF_D, EDGE_W);
    } else {
      bin.seg(x, -HALF_D, x, -RIVER_Z, LINE_W);
      bin.seg(x, RIVER_Z, x, HALF_D, LINE_W);
    }
  }
  // 九宫对角斜线（黑方 rank0..2 / 红方 rank7..9）
  bin.seg(wx(3), wz(0), wx(5), wz(2), LINE_W);
  bin.seg(wx(5), wz(0), wx(3), wz(2), LINE_W);
  bin.seg(wx(3), wz(7), wx(5), wz(9), LINE_W);
  bin.seg(wx(5), wz(7), wx(3), wz(9), LINE_W);
  // 炮位
  addPositionMark(bin, 1, 2); addPositionMark(bin, 7, 2);
  addPositionMark(bin, 1, 7); addPositionMark(bin, 7, 7);
  // 兵/卒位
  for (const f of [0, 2, 4, 6, 8]) {
    addPositionMark(bin, f, 3);
    addPositionMark(bin, f, 6);
  }
  // 内框描边（比外边线略外一圈，装饰用）
  bin.seg(-HALF_W - 0.22, -HALF_D - 0.22, HALF_W + 0.22, -HALF_D - 0.22, 0.018);
  bin.seg(-HALF_W - 0.22, HALF_D + 0.22, HALF_W + 0.22, HALF_D + 0.22, 0.018);
  bin.seg(-HALF_W - 0.22, -HALF_D - 0.22, -HALF_W - 0.22, HALF_D + 0.22, 0.018);
  bin.seg(HALF_W + 0.22, -HALF_D - 0.22, HALF_W + 0.22, HALF_D + 0.22, 0.018);
  // 河界两侧金色水波细线
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      bin.seg(sx * 2.55, sz * 0.34, sx * 3.75, sz * 0.34, 0.014);
    }
  }

  const lineGeo = bin.merge();
  const lines = new THREE.Mesh(lineGeo, B.line);
  lines.name = 'boardLines';
  lines.receiveShadow = true;
  lines.castShadow = false;
  group.add(lines);

  /* ---- 4. 河界文字：楚河 / 漢界 ---- */
  const mkText = (mat, x) => {
    const g = new THREE.PlaneGeometry(1.72, 0.86);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, 0.013, 0);
    m.renderOrder = 2;
    m.receiveShadow = false;
    m.castShadow = false;
    return m;
  };
  const t1 = mkText(B.riverText, -1.95);   // 楚河（红方视角左）
  const t2 = mkText(B.riverText2, 1.95);   // 漢界（红方视角右）
  t1.name = 'riverTextChu';
  t2.name = 'riverTextHan';
  group.add(t1, t2);

  /* ---- 5. 朱漆外框 + 鎏金角 ---- */
  const fw = 0.35, fh = 0.055;
  const innerX = HALF_W + 0.50;   // 4.50
  const innerZ = HALF_D + 0.50;   // 5.00
  const frameBin = new Bin();
  frameBin.push(new THREE.BoxGeometry(TOP_W, fh, fw).translate(0, fh / 2, innerZ + fw / 2));
  frameBin.push(new THREE.BoxGeometry(TOP_W, fh, fw).translate(0, fh / 2, -(innerZ + fw / 2)));
  frameBin.push(new THREE.BoxGeometry(fw, fh, innerZ * 2).translate(innerX + fw / 2, fh / 2, 0));
  frameBin.push(new THREE.BoxGeometry(fw, fh, innerZ * 2).translate(-(innerX + fw / 2), fh / 2, 0));
  const frame = new THREE.Mesh(frameBin.merge(), B.frame);
  frame.name = 'boardFrame';
  frame.receiveShadow = true;
  frame.castShadow = false;
  group.add(frame);

  const cornerBin = new Bin();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cornerBin.push(new THREE.BoxGeometry(fw + 0.06, fh + 0.022, fw + 0.06).translate(
        sx * (innerX + fw / 2), (fh + 0.022) / 2, sz * (innerZ + fw / 2)
      ));
    }
  }
  const corners = new THREE.Mesh(cornerBin.merge(), B.frameGold);
  corners.name = 'boardCorners';
  corners.receiveShadow = true;
  corners.castShadow = false;
  group.add(corners);

  /* ---- dispose ---- */
  group.userData.dispose = function () {
    group.traverse(function (o) {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    if (group.parent) group.parent.remove(group);
  };

  return group;
}

/* ============================================================
 * createEnvironment()
 *   —— 所有装饰物均在棋盘外围（|x| > 5.6 或 |z| > 6.0），
 *      且高度受控，不遮挡棋盘与相机轨道。
 * ============================================================ */

function buildBrazier(mats, bin, flames, x, z) {
  const B = mats.board;
  const K = mats.common;
  // 础
  bin.push(new THREE.BoxGeometry(0.62, 0.14, 0.62).translate(x, 0.07, z));
  // 柱（青铜）
  bin.push(new THREE.CylinderGeometry(0.10, 0.16, 1.12, 10, 1).translate(x, 0.70, z));
  // 箍
  const ring = new THREE.TorusGeometry(0.135, 0.024, 6, 14);
  ring.rotateX(Math.PI / 2);
  ring.translate(x, 0.72, z);
  bin.push(ring);
  // 灯盘
  bin.push(new THREE.CylinderGeometry(0.32, 0.13, 0.24, 14, 1).translate(x, 1.36, z));

  // 火焰（单独 Mesh，供动画抖动）
  const fg = new THREE.ConeGeometry(0.16, 0.42, 8, 1);
  const flame = new THREE.Mesh(fg, K.flame);
  flame.position.set(x, 1.68, z);
  flame.castShadow = false;
  flame.receiveShadow = false;
  flame.name = 'brazierFlame';
  flames.push(flame);
  return flame;
}

function buildBanner(mats, side, x, z, bins) {
  const M = mats.side(side);
  const g = new THREE.Group();
  g.name = 'qinBanner_' + side;

  // 旗面正对棋盘中心：整组位置 + 绕 Y 旋转（在末尾统一烘焙进各零件几何）
  g.position.set(x, 0, z);
  g.rotation.y = Math.atan2(-x, -z);
  g.updateMatrix();

  // 零件并入合并收集器（跨 4 面旗帜按材质合并，见 createEnvironment 末尾）
  const baseBin = bins.base;   // platform 材质（红黑共用）
  const poleBin = bins.pole[side];   // woodDeep（红/黑分属）
  const tipBin = bins.tip[side];     // plume（红/黑分属）
  const flagBin = bins.flag[side];   // banner 材质（红/黑分属）
  const pushGeom = (bin, geo) => {
    geo.applyMatrix4(g.matrix);   // 烘焙组变换
    bin.geoms.push(geo);
  };

  const b0g = new THREE.CylinderGeometry(0.34, 0.44, 0.24, 12, 1);
  b0g.translate(0, 0.12, 0);
  pushGeom(baseBin, b0g);

  const poleBinLocal = new Bin();
  poleBinLocal.push(new THREE.CylinderGeometry(0.042, 0.055, 2.30, 10, 1).translate(0, 1.30, 0));
  poleBinLocal.push(new THREE.ConeGeometry(0.072, 0.24, 8, 1).translate(0, 2.57, 0));
  const r1 = new THREE.TorusGeometry(0.058, 0.016, 5, 12); r1.rotateX(Math.PI / 2); r1.translate(0, 0.95, 0);
  const r2 = new THREE.TorusGeometry(0.052, 0.016, 5, 12); r2.rotateX(Math.PI / 2); r2.translate(0, 2.05, 0);
  poleBinLocal.push(r1); poleBinLocal.push(r2);
  for (const geo of poleBinLocal.geoms) pushGeom(poleBin, geo);

  const tipGeo = new THREE.SphereGeometry(0.075, 10, 8);
  tipGeo.translate(0, 2.42, 0);
  pushGeom(tipBin, tipGeo);

  // 旗面（云雷纹 + "秦"）
  const pg = new THREE.PlaneGeometry(0.86, 1.26, 10, 3);
  const p = pg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getX(i) / 0.86 + 0.5;
    const v = p.getY(i) / 1.26 + 0.5;
    p.setZ(i, Math.sin(t * Math.PI * 1.6) * 0.13 * (0.3 + 0.7 * t) + Math.sin(v * Math.PI * 2.2) * 0.05 * t);
  }
  p.needsUpdate = true;
  pg.computeVertexNormals();
  pg.translate(0.47, 1.72, 0);
  pushGeom(flagBin, pg);

  return g;
}

export function createEnvironment() {
  const mats = getMaterials();
  const B = mats.board;
  const group = new THREE.Group();
  group.name = 'environment';

  /* ---- 雾化地面 ---- */
  const groundGeo = new THREE.CircleGeometry(34, 48);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(0, -0.90, 0);
  const ground = new THREE.Mesh(groundGeo, B.ground);
  ground.name = 'ground';
  ground.receiveShadow = true;
  group.add(ground);

  /* ---- 深色石质地台（承托棋盘） ---- */
  const platGeo = new THREE.BoxGeometry(11.9, 0.56, 12.9);
  platGeo.translate(0, -TOP_TH - 0.28, 0);
  const plat = new THREE.Mesh(platGeo, B.platform);
  plat.name = 'platform';
  plat.receiveShadow = true;
  plat.castShadow = false;
  group.add(plat);

  // 地台压边（鎏金细线）
  const edgeBin = new Bin();
  const ex = 11.9 / 2 + 0.02, ez = 12.9 / 2 + 0.02;
  edgeBin.push(new THREE.BoxGeometry(ex * 2, 0.035, 0.05).translate(0, -TOP_TH - 0.02, ez));
  edgeBin.push(new THREE.BoxGeometry(ex * 2, 0.035, 0.05).translate(0, -TOP_TH - 0.02, -ez));
  edgeBin.push(new THREE.BoxGeometry(0.05, 0.035, ez * 2).translate(ex, -TOP_TH - 0.02, 0));
  edgeBin.push(new THREE.BoxGeometry(0.05, 0.035, ez * 2).translate(-ex, -TOP_TH - 0.02, 0));
  const edging = new THREE.Mesh(edgeBin.merge(), B.frameGold);
  edging.name = 'platformEdge';
  group.add(edging);

  /* ---- 四角青铜灯柱（火焰可动画） ---- */
  const flames = [];
  const brazierBin = new Bin();
  const BX = 6.35, BZ = 6.85;
  buildBrazier(mats, brazierBin, flames, BX, BZ);
  buildBrazier(mats, brazierBin, flames, -BX, BZ);
  buildBrazier(mats, brazierBin, flames, BX, -BZ);
  buildBrazier(mats, brazierBin, flames, -BX, -BZ);
  const braziers = new THREE.Mesh(brazierBin.merge(), mats.common.bronzeDark);
  braziers.name = 'braziers';
  braziers.castShadow = false;
  braziers.receiveShadow = true;
  group.add(braziers);
  for (const f of flames) group.add(f);

  /* ---- 秦军旗帜（红方 +Z / 黑方 -Z，各两面） ----
   * 四面旗帜的静态零件按材质合并：底座×4 → 1、旗杆×4 → 红/黑各 1、
   * 顶饰×4 → 红/黑各 1、旗面×4 → 红/黑各 1。合计 7 个 draw call（原 16）。 */
  const bannerBins = {
    base: new Bin(),
    pole: { r: new Bin(), b: new Bin() },
    tip: { r: new Bin(), b: new Bin() },
    flag: { r: new Bin(), b: new Bin() }
  };
  const mkBannerGroup = (side, x, z) => buildBanner(mats, side, x, z, bannerBins);
  mkBannerGroup('r', -6.10, 3.60);
  mkBannerGroup('r', 6.10, 3.60);
  mkBannerGroup('b', -6.10, -3.60);
  mkBannerGroup('b', 6.10, -3.60);

  const mergedBannerMeshes = [];
  const mkMerged = (bin, material, receiveShadow) => {
    const geo = bin.merge();
    if (!geo) return;
    const m = new THREE.Mesh(geo, material);
    m.castShadow = false;
    m.receiveShadow = !!receiveShadow;
    mergedBannerMeshes.push(m);
  };
  mkMerged(bannerBins.base, mats.board.platform, true);
  mkMerged(bannerBins.pole.r, mats.r.woodDeep, false);
  mkMerged(bannerBins.pole.b, mats.b.woodDeep, false);
  mkMerged(bannerBins.tip.r, mats.r.plume, false);
  mkMerged(bannerBins.tip.b, mats.b.plume, false);
  mkMerged(bannerBins.flag.r, getBannerMaterial('秦', 'r'), false);
  mkMerged(bannerBins.flag.b, getBannerMaterial('秦', 'b'), false);
  for (const m of mergedBannerMeshes) group.add(m);

  /* ---- 动画钩子：火焰呼吸 ---- */
  const base = flames.map((f) => f.scale.y);
  group.userData.flames = flames;
  group.userData.update = function (t) {
    for (let i = 0; i < flames.length; i++) {
      const f = flames[i];
      const k = 1 + Math.sin(t * 6.1 + i * 1.7) * 0.13 + Math.sin(t * 11.3 + i * 3.1) * 0.07;
      f.scale.set(1 + (k - 1) * 0.4, base[i] * k, 1 + (k - 1) * 0.4);
      f.material.emissiveIntensity = 2.1 + Math.sin(t * 8.3 + i) * 0.45;
    }
  };

  group.userData.dispose = function () {
    group.traverse(function (o) {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    if (group.parent) group.parent.remove(group);
  };

  return group;
}

/**
 * scene.js is the sole authority for lighting. This preset mirrors scene.js's
 * shipped values (see src/render/scene.js) for documentation only; scene.js does
 * NOT consume it. To change the look, edit scene.js or PALETTE in src/core/constants.js.
 */
export const LIGHT_PRESET = {
  ambient:     { color: 0xffffff, intensity: 0.52 },
  hemisphere:  { sky: 0x8da0b8, ground: 0x241a11, intensity: 0.98 },
  key:         { color: 0xfff2dc, intensity: 1.95, position: [6.5, 13.5, 7.5], castShadow: true },
  fill:        { color: 0x3f6ea8, intensity: 0.95, position: [-8.0, 6.5, -8.0] },
  rim:         { color: 0xffb45c, intensity: 22, distance: 30, decay: 2, position: [0, 3.2, -8.5] },
  under:       { color: 0xb0281f, intensity: 12, distance: 22, decay: 2, position: [0, 2.4, 8.5] },
  shadow:      { mapSize: 2048, near: 1, far: 42, left: -9, right: 9, top: 9, bottom: -9, bias: -0.0006, normalBias: 0.022, radius: 1.6 },
  fog:         { type: 'exp2', color: 0x232b38, density: 0.009 },
  background:  0x1a2230,
  toneMapping: 'Neutral',
  exposure:    1.14,
  controls:    { minPolarAngle: 0.15, maxPolarAngle: 1.35, minDistance: 6.5, maxDistance: 26 }
};
