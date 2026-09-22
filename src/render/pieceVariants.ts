/**
 * src/render/pieceVariants.ts
 * ------------------------------------------------------------
 * Task M-05 · 变体几何构建函数（纯程序化 box/cyl/sph/torus）。
 *
 * 纪律（用户红线 / 03-资产化分层规格）：
 *   - DC-1 复用现有材质族（M.* / K.* / getBannerMaterial）—— **禁新材质族**；
 *   - DC-2 **禁新贴图 / 禁新 UV 集**（沿用既有顶点色烘焙路径与既有 PlaneGeometry UV）；
 *   - DC-5 变体三角数 ≤ 原槽位件 ×1.15（预算见 accessories.SLOT_TABLE.originalTri）；
 *   - 变体几何挂在**同一关节锚点**上：本文件只负责产出「作者坐标」几何，
 *     子组关节平移仍由 pieceFactory.buildTemplate 统一完成（旋转语义自动继承）。
 *   - 顶点作者坐标（Parts.add 会统一减 FOOT）与**原槽位件同源**，保证 pivot 相对关系不变。
 *
 * 与 accessories.ts 的分工：本文件 import three 并注册构建函数；accessories.ts 保持纯数据。
 */

import * as THREE from 'three';
import { getBannerMaterial } from './materials.ts';
import {
  registerVariant, resolveVariants,
  type VariantBuildCtx
} from './accessories.ts';

/* ============================================================
 * 局部几何简写（变体专供；非 LOD 段数表，段数按 DC-5 预算手工收敛）
 * ============================================================ */
const box = (w: number, h: number, d: number): any => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 10): any => new THREE.CylinderGeometry(rt, rb, h, seg, 1);
const sph = (r: number, w = 10, h = 8): any => new THREE.SphereGeometry(r, w, h);
const dome = (r: number, w = 12, h = 6, frac = 0.55): any => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI * frac);
const tor = (R: number, t: number, rs = 5, ts = 14): any => new THREE.TorusGeometry(R, t, rs, ts);

/** 去基座统一下降量（与 pieceFactory.FOOT 同源） */
const FOOT = 0.086;
/** K 坐姿人物 BODY_BOT（与 pieceFactory.buildKing 同源：SEAT_Y + 0.020） */
const K_BODY_BOT = FOOT + 0.065 + 0.020;

/**
 * 燕尾旌旗旗面：PlaneGeometry + 顶点位移（自由边开 V 形缺口）。
 * 复用既有 UV（PlaneGeometry 默认 UV 集），不新增贴图/UV —— DC-2 合规。
 */
function forkedPennant(w: number, h: number, notch: number, segs = 8, rows = 3): any {
  const g = new THREE.PlaneGeometry(w, h, segs, rows);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const t = x / w + 0.5;                 // 0 = 近旗杆侧，1 = 自由边
    const v = y / h + 0.5;
    const mid = 1 - Math.abs(v - 0.5) * 2; // 0 = 上下缘，1 = 中线
    const cut = t > 0.6 ? notch * mid * ((t - 0.6) / 0.4) : 0;
    const z = Math.sin(t * Math.PI * 1.25) * 0.028 * (0.3 + 0.7 * t) + Math.sin(v * Math.PI * 2) * 0.012 * t;
    p.setX(i, x - cut);
    p.setZ(i, z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/* ============================================================
 * 变体构建函数
 * ============================================================ */

/**
 * P.weapon · 戈 → **矛**（mao）。
 * 握把旋转中心不变；竖持长矛（圆锥矛头）替代横向戈援，剪影水平刃 → 垂直锋。
 */
function buildPawnSpearMao(P: any, M: any, K: any, ctx: VariantBuildCtx): void {
  const x = ctx.anchor[0];                 // 0.170
  const z = ctx.anchor[2] - 0.010;         // 杆中轴（≈ −0.030）
  P.add(cyl(0.011, 0.013, 0.560, 8), M.woodDeep, { pos: [x, 0.410, z + 0.010], rot: [-0.055, 0, 0] });
  P.add(cyl(0.015, 0.017, 0.038, 8), K.bronze, { pos: [x, 0.696, z], rot: [-0.055, 0, 0] });
  P.add(cyl(0.000, 0.026, 0.100, 8), K.bronze, { pos: [x, 0.750, z], rot: [-0.055, 0, 0] });
}

/**
 * P.shield · 圆盾 → **方盾**（fangdun）。
 * 盾心旋转中心不变；方形板面 + 四边鎏金包边 + 四角铆钉。
 */
function buildPawnShieldSquare(P: any, M: any, K: any, ctx: VariantBuildCtx): void {
  const [cx, cy, cz] = ctx.anchor;         // [−0.176, 0.400, −0.058]
  P.add(box(0.190, 0.210, 0.016), M.leather, { pos: [cx, cy, cz] });
  P.add(box(0.190, 0.016, 0.022), M.accentDim, { pos: [cx, cy + 0.097, cz] });
  P.add(box(0.190, 0.016, 0.022), M.accentDim, { pos: [cx, cy - 0.097, cz] });
  P.add(box(0.016, 0.210, 0.022), M.accentDim, { pos: [cx - 0.087, cy, cz] });
  P.add(box(0.016, 0.210, 0.022), M.accentDim, { pos: [cx + 0.087, cy, cz] });
  P.add(sph(0.030, 10, 8), K.bronze, { pos: [cx, cy, cz - 0.016] });
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      P.add(sph(0.011, 5, 4), K.bronze, { pos: [cx + 0.070 * sx, cy + 0.082 * sy, cz - 0.010] });
    }
  }
}

/**
 * A.weapon · 剑 → **环首刀**（huanshoudao）。
 * 握把旋转中心不变；单刃厚背 + 环首（圆环刀环）。
 */
function buildAdvisorSaber(P: any, M: any, K: any, ctx: VariantBuildCtx): void {
  const x = ctx.anchor[0];                 // 0
  const z = ctx.anchor[2];                 // −0.126
  P.add(box(0.042, 0.390, 0.014), K.blade, { pos: [x, 0.292, z] });
  P.add(box(0.010, 0.366, 0.010), K.blade, { pos: [x + 0.022, 0.298, z] });
  P.add(box(0.082, 0.018, 0.028), K.bronze, { pos: [x, 0.496, z] });
  P.add(cyl(0.015, 0.017, 0.082, 10), M.leather, { pos: [x, 0.552, z] });
  P.add(tor(0.026, 0.008, 5, 12), K.bronze, { pos: [x, 0.608, z] });
}

/**
 * A.shield · 圆盾 → **小圆盾**（xiaoyuandun）。
 * 盾心旋转中心不变；鼓面 + 包边 + 木心 + 中心凸刺。
 */
function buildAdvisorBuckler(P: any, M: any, K: any, ctx: VariantBuildCtx): void {
  const [cx, cy, cz] = ctx.anchor;         // [0, 0.45, −0.20]
  P.add(dome(0.088, 12, 6, 0.55), M.leather, { pos: [cx, cy, cz + 0.002], rot: [-Math.PI / 2, 0, 0] });
  P.add(tor(0.098, 0.011, 5, 14), M.accentDim, { pos: [cx, cy, cz + 0.004] });
  P.add(cyl(0.082, 0.082, 0.010, 12), M.wood, { pos: [cx, cy, cz + 0.008], rot: [Math.PI / 2, 0, 0] });
  P.add(sph(0.026, 8, 6), K.bronze, { pos: [cx, cy, cz - 0.012] });
}

/**
 * K.headgear · 鹖冠 → **变体冠式**（方冠 + 侧翼 + 单缨）。
 * 冕落（translateY）承接受体不变；顶高不超原版。
 */
function buildKingCrownAlt(P: any, M: any, K: any, _ctx: VariantBuildCtx): void {
  const b = K_BODY_BOT;
  P.add(cyl(0.070, 0.074, 0.022, 12), M.accent, { pos: [0, b + 0.512, -0.002] });
  P.add(box(0.120, 0.078, 0.110), M.clothDeep, { pos: [0, b + 0.554, -0.002] });
  P.add(box(0.132, 0.014, 0.122), M.accent, { pos: [0, b + 0.598, -0.002] });
  P.add(box(0.022, 0.046, 0.074), M.accentDim, { pos: [0.072, b + 0.554, 0.010] });
  P.add(box(0.022, 0.046, 0.074), M.accentDim, { pos: [-0.072, b + 0.554, 0.010] });
  P.add(box(0.040, 0.028, 0.012), M.accent, { pos: [0, b + 0.556, -0.058] });
  // 单缨：顶端对齐原版鹖冠（world ≈0.99），使 crown pivotOutside 不劣化（0.215 → ≤0.215）
  P.strut(M.plume, [0, b + 0.598, 0.006], [0.010, b + 0.708, 0.026], 0.006, 0.016, 6);
}

/**
 * K.backBanner · 帅旗 → **燕尾旌旗**（jingqi）。
 * 旗杆为转轴不变；旗面改燕尾（自由边 V 形缺口），旗面稍窄稍长。
 */
function buildKingBannerSwallowtail(P: any, M: any, K: any, ctx: VariantBuildCtx): void {
  const x = 0.228;
  const z = 0.126;
  P.add(cyl(0.046, 0.056, 0.036, 10), M.accentDim, { pos: [x, FOOT + 0.018, z] });
  P.add(cyl(0.012, 0.014, 0.600, 8), M.woodDeep, { pos: [x, 0.400, z] });
  P.strut(M.accent, [x, 0.756, z], [x, 0.694, z], 0.000, 0.020, 8);
  P.add(sph(0.024, 8, 6), M.plume, { pos: [x, 0.688, z] });
  P.add(forkedPennant(0.150, 0.235, 0.055, 8, 3), getBannerMaterial(ctx.glyph, ctx.side),
    { pos: [x, 0.556, 0.028], rot: [0, Math.PI / 2, 0] });
}

/**
 * R.wheel · 木辐条轮 → **6 辐轮**（futiaolun）。
 * 轮心为转轴不变；4 辐 → 6 辐、轮辋减薄，辐条结构保留（剪影底线）。
 */
function buildRookWheel6(P: any, M: any, K: any, ctx: VariantBuildCtx): void {
  const x = ctx.anchor[0];                 // ∓0.26
  const HUB = 0.330;                       // = FOOT + 外半径（与内容同源，关节 y 一致）
  const RR = 0.220;
  P.add(tor(RR, 0.020, 8, 18), M.wood, { pos: [x, HUB, 0], rot: [0, Math.PI / 2, 0] });
  P.add(tor(RR - 0.024, 0.009, 5, 16), M.woodDeep, { pos: [x, HUB, 0], rot: [0, Math.PI / 2, 0] });
  for (let k = 0; k < 6; k++) {
    P.add(box(0.016, (RR - 0.006) * 1.88, 0.016), M.wood, { pos: [x, HUB, 0], rot: [(k * Math.PI) / 6, 0, 0] });
  }
  P.add(cyl(0.040, 0.040, 0.062, 12), M.woodDeep, { pos: [x, HUB, 0], rot: [0, 0, Math.PI / 2] });
  P.add(sph(0.034, 10, 8), M.accentDim, { pos: [x * 1.12, HUB, 0] });
}

/**
 * C.wheel · 素木轮 → **包铁轮**（baotielun）。
 * 轮心为转轴不变；木轮外加铁箍（外径与轮底同规约，轮底仍触地）。
 */
function buildCannonWheelIron(P: any, M: any, K: any, ctx: VariantBuildCtx): void {
  const x = ctx.anchor[0];                 // ∓0.145
  const HUB = 0.160;                       // = FOOT + 外半径
  P.add(tor(0.058, 0.014, 5, 12), M.wood, { pos: [x, HUB, 0], rot: [0, Math.PI / 2, 0] });
  P.add(tor(0.066, 0.008, 5, 12), M.accentDim, { pos: [x, HUB, 0], rot: [0, Math.PI / 2, 0] });
  P.add(cyl(0.030, 0.030, 0.048, 8), M.woodDeep, { pos: [x, HUB, 0], rot: [0, 0, Math.PI / 2] });
  P.add(sph(0.020, 6, 5), M.accentDim, { pos: [x * 1.12, HUB, 0] });
}

/**
 * C.crew · 操作兵 → **尖顶笠工兵**（gongbing）。
 * 躯干质心旋转语义不变；介帻帽 → 尖顶笠，配手持撬棍（姿态/装备差异）。
 * ★ S2b-step4（M-08d2）：crew 头物化后的变体路径同步 —— C.crew 槽位扩为
 *   ['soldierL','soldierLHead','soldierR','soldierRHead']，本构建器按 ctx.subgroup 分支
 *   重建（不再叠加重复头部）；镜像符号 mx 改由子组名派生（原 ctx.index 语义随槽位扩容失效）。
 */
function buildCannonSoldierSapper(P: any, M: any, K: any, ctx: VariantBuildCtx): void {
  const ox = ctx.anchor[0];                // ∓0.250
  const mx = ctx.subgroup.startsWith('soldierL') ? 1 : -1;
  const oy = FOOT;
  const sc = 0.95;
  const legH = 0.038 * sc;
  // ── 头分支：头颈 + 尖顶笠 4 零件（集合同默认 spec；头颈表达式为变体自有值，逐字未改）──
  if (ctx.subgroup.endsWith('Head')) {
    P.add(cyl(0.022 * sc, 0.024 * sc, 0.026 * sc, 8), M.skin, { pos: [ox, oy + legH + 0.324 * sc, 0.018 * mx] });
    P.add(sph(0.040 * sc, 10, 8), M.skin, { pos: [ox, oy + legH + 0.340 * sc, 0.014 * mx] });
    // 尖顶笠（差异装备；顶高 ≤ 原版 0.421）
    P.add(cyl(0.000, 0.066 * sc, 0.048 * sc, 12), M.cloth, { pos: [ox, oy + legH + 0.372 * sc, 0.014 * mx] });
    P.add(tor(0.064 * sc, 0.007 * sc, 4, 12), M.leather, { pos: [ox, oy + legH + 0.352 * sc, 0.014 * mx], rot: [Math.PI / 2, 0, 0] });
    return;
  }
  // ── 躯干分支：腿 + 靴 ──
  P.strut(M.clothDeep, [ox - 0.024 * sc * mx, oy + legH + 0.130 * sc, 0], [ox - 0.024 * sc * mx, oy + legH + 0.060 * sc, 0], 0.028 * sc, 0.024 * sc, 8);
  P.strut(M.clothDeep, [ox + 0.024 * sc * mx, oy + legH + 0.130 * sc, 0], [ox + 0.024 * sc * mx, oy + legH + 0.060 * sc, 0], 0.028 * sc, 0.024 * sc, 8);
  P.add(box(0.034 * sc, 0.022 * sc, 0.058 * sc), M.bootSole, { pos: [ox - 0.024 * sc * mx, oy + 0.011 * sc, -0.016 * sc] });
  P.add(box(0.034 * sc, 0.022 * sc, 0.058 * sc), M.bootSole, { pos: [ox + 0.024 * sc * mx, oy + 0.011 * sc, -0.016 * sc] });
  // 裙甲 + 腰带
  P.add(cyl(0.052 * sc, 0.072 * sc, 0.140 * sc, 10), M.clothDeep, { pos: [ox, oy + legH + 0.070 * sc, 0] });
  P.add(tor(0.072 * sc, 0.010 * sc, 4, 10), M.leather, { pos: [ox, oy + legH + 0.138 * sc, 0], rot: [Math.PI / 2, 0, 0] });
  // 躯干 + 甲片
  P.add(cyl(0.050 * sc, 0.060 * sc, 0.130 * sc, 10), M.armorDeep, { pos: [ox, oy + legH + 0.222 * sc, 0.016 * mx] });
  P.add(cyl(0.062 * sc, 0.066 * sc, 0.016 * sc, 10), M.armor, { pos: [ox, oy + legH + 0.186 * sc, 0.016 * mx] });
  P.add(cyl(0.060 * sc, 0.064 * sc, 0.016 * sc, 10), M.armor, { pos: [ox, oy + legH + 0.228 * sc, 0.016 * mx] });
  // 肩
  P.add(sph(0.034 * sc, 9, 7), M.armorDeep, { pos: [ox + 0.062 * sc * mx, oy + legH + 0.268 * sc, 0.016 * mx] });
  P.add(sph(0.034 * sc, 9, 7), M.armorDeep, { pos: [ox - 0.062 * sc * mx, oy + legH + 0.268 * sc, 0.016 * mx] });
  // 颈（盆领；头颈 + 笠 4 零件 → Head 分支）
  P.add(cyl(0.024 * sc, 0.026 * sc, 0.022 * sc, 8), M.accentDim, { pos: [ox, oy + legH + 0.304 * sc, 0.018 * mx] });
  // 双臂前伸
  P.strut(M.armorDeep, [ox + 0.058 * sc * mx, oy + legH + 0.264 * sc, 0.016 * mx], [ox + 0.084 * sc * mx, oy + legH + 0.244 * sc, -0.020 * sc], 0.024 * sc, 0.020 * sc, 8);
  P.add(sph(0.020 * sc, 8, 6), M.armorDeep, { pos: [ox + 0.084 * sc * mx, oy + legH + 0.244 * sc, -0.020 * sc] });
  P.strut(M.armorDeep, [ox + 0.084 * sc * mx, oy + legH + 0.244 * sc, -0.020 * sc], [ox + 0.110 * sc * mx, oy + legH + 0.218 * sc, -0.048 * sc], 0.020 * sc, 0.016 * sc, 8);
  P.strut(M.armorDeep, [ox - 0.058 * sc * mx, oy + legH + 0.264 * sc, 0.016 * mx], [ox - 0.078 * sc * mx, oy + legH + 0.246 * sc, -0.020 * sc], 0.024 * sc, 0.020 * sc, 8);
  P.add(sph(0.020 * sc, 8, 6), M.armorDeep, { pos: [ox - 0.078 * sc * mx, oy + legH + 0.246 * sc, -0.020 * sc] });
  P.strut(M.armorDeep, [ox - 0.078 * sc * mx, oy + legH + 0.246 * sc, -0.020 * sc], [ox - 0.096 * sc * mx, oy + legH + 0.222 * sc, -0.038 * sc], 0.020 * sc, 0.016 * sc, 8);
  // 手
  P.add(sph(0.024 * sc, 9, 7), M.skin, { pos: [ox + 0.112 * sc * mx, oy + legH + 0.214 * sc, -0.050 * sc] });
  P.add(sph(0.024 * sc, 9, 7), M.skin, { pos: [ox - 0.098 * sc * mx, oy + legH + 0.218 * sc, -0.040 * sc] });
  // 撬棍（差异装备）
  P.add(cyl(0.010 * sc, 0.012 * sc, 0.230 * sc, 8), M.woodDeep, { pos: [ox + 0.120 * sc * mx, oy + legH + 0.150 * sc, -0.060 * sc], rot: [-0.35, 0, 0] });
  P.add(box(0.030 * sc, 0.020 * sc, 0.014 * sc), K.bronzeDark, { pos: [ox + 0.120 * sc * mx, oy + legH + 0.258 * sc, -0.104 * sc] });
}

/**
 * R.crew · 持戈兵 → **持戟兵**（chijibing）。
 * 躯干旋转语义不变；长戈 → 戟（矛尖 + 月牙侧刃）。
 * ★ S2b-step4（M-08d2）：crew 头 + 持械臂肘物化后的变体路径同步 —— R.crew 槽位扩为
 *   ['spearman','spearmanHead','spearmanForearmR']，本构建器按 ctx.subgroup 分支重建
 *   （applySlotOverrides 逐子组清空 + 调用本函数），**不再叠加重复头部/前臂**。
 *   分支间几何表达式逐字未改；头/肘零件集合与默认 spec（spearmanSpec）一致。
 */
function buildRookHalberdier(P: any, M: any, K: any, ctx: VariantBuildCtx): void {
  const ox = ctx.anchor[0];                // −0.050
  const oz = ctx.anchor[2];                // 0.080
  const oy = 0.405;
  const sc = 0.88;
  // ── 头分支：头颈 + 兜鍪 3 零件（默认 spec 同集合）──
  if (ctx.subgroup === 'spearmanHead') {
    P.add(cyl(0.024 * sc, 0.026 * sc, 0.028 * sc, 8), M.skin, { pos: [ox, 0.378 * sc + oy, oz] });
    P.add(sph(0.044 * sc, 10, 8), M.skin, { pos: [ox, 0.418 * sc + oy, oz - 0.004 * sc] });
    P.add(dome(0.042 * sc, 10, 6, 0.56), M.armor, { pos: [ox, 0.438 * sc + oy, oz - 0.004 * sc] });
    return;
  }
  // ── 肘分支：肘球 + 前臂 + 手 3 零件（默认 spec 同集合；持械臂 = 右臂）──
  if (ctx.subgroup === 'spearmanForearmR') {
    P.add(sph(0.022 * sc, 8, 6), M.armorDeep, { pos: [ox + 0.098 * sc, 0.288 * sc + oy, oz - 0.040 * sc] });
    P.strut(M.armorDeep, [ox + 0.098 * sc, 0.288 * sc + oy, oz - 0.040 * sc], [ox + 0.124 * sc, 0.272 * sc + oy, oz - 0.084 * sc], 0.022 * sc, 0.018 * sc, 8);
    P.add(sph(0.026 * sc, 9, 7), M.skin, { pos: [ox + 0.126 * sc, 0.268 * sc + oy, oz - 0.086 * sc] });
    return;
  }
  // ── 躯干分支（spearman）：腿/下身/躯干/肩/盆领 + 右大臂 + 戟 + 左臂全 ──
  // 腿 + 靴
  P.strut(M.clothDeep, [ox, 0.150 * sc + oy, oz], [ox, 0.080 * sc + oy, oz], 0.034, 0.030, 8);
  P.strut(M.clothDeep, [ox + 0.020 * sc, 0.150 * sc + oy, oz], [ox + 0.022 * sc, 0.080 * sc + oy, oz], 0.028, 0.024, 8);
  P.add(box(0.052 * sc, 0.024 * sc, 0.084 * sc), M.bootSole, { pos: [ox + 0.010 * sc, 0.012 * sc + oy, oz + 0.012 * sc] });
  // 下身 + 腰带
  P.add(cyl(0.060 * sc, 0.082 * sc, 0.165 * sc, 10), M.clothDeep, { pos: [ox, 0.082 * sc + oy, oz] });
  P.add(tor(0.082 * sc, 0.012 * sc, 4, 12), M.leather, { pos: [ox, 0.162 * sc + oy, oz], rot: [Math.PI / 2, 0, 0] });
  // 躯干 + 甲片
  P.add(cyl(0.058 * sc, 0.068 * sc, 0.145 * sc, 10), M.armorDeep, { pos: [ox, 0.258 * sc + oy, oz] });
  P.add(cyl(0.070 * sc, 0.074 * sc, 0.018 * sc, 10), M.armor, { pos: [ox, 0.218 * sc + oy, oz] });
  P.add(cyl(0.068 * sc, 0.072 * sc, 0.018 * sc, 10), M.armor, { pos: [ox, 0.266 * sc + oy, oz] });
  // 肩
  P.add(sph(0.040 * sc, 9, 7), M.armorDeep, { pos: [ox + 0.074 * sc, 0.310 * sc + oy, oz] });
  P.add(sph(0.040 * sc, 9, 7), M.armorDeep, { pos: [ox - 0.074 * sc, 0.310 * sc + oy, oz] });
  // 颈（盆领；头颈 3 零件 → spearmanHead 分支）
  P.add(cyl(0.026 * sc, 0.028 * sc, 0.024 * sc, 8), M.accentDim, { pos: [ox, 0.352 * sc + oy, oz] });
  // 右大臂（持戟；肘球 + 前臂 + 手 → spearmanForearmR 分支）
  P.strut(M.armorDeep, [ox + 0.070 * sc, 0.306 * sc + oy, oz], [ox + 0.098 * sc, 0.288 * sc + oy, oz - 0.040 * sc], 0.026 * sc, 0.022 * sc, 8);
  // 戟（杆 + 矛尖 + 月牙侧刃 + 反刃 + 铜箍）
  P.add(cyl(0.010 * sc, 0.012 * sc, 0.520 * sc, 8), M.woodDeep, { pos: [ox + 0.122 * sc, 0.350 * sc + oy, oz - 0.080 * sc], rot: [-0.55, 0, 0] });
  P.add(cyl(0.000, 0.022 * sc, 0.090 * sc, 8), K.bronze, { pos: [ox + 0.122 * sc, 0.640 * sc + oy, oz - 0.180 * sc], rot: [-0.55, 0, 0] });
  P.add(box(0.075 * sc, 0.020 * sc, 0.008 * sc), K.bronze, { pos: [ox + 0.166 * sc, 0.556 * sc + oy, oz - 0.146 * sc], rot: [-0.55, 0, -0.35] });
  P.add(box(0.048 * sc, 0.016 * sc, 0.008 * sc), K.bronze, { pos: [ox + 0.098 * sc, 0.545 * sc + oy, oz - 0.135 * sc], rot: [-0.55, 0, 0.30] });
  P.add(cyl(0.014 * sc, 0.014 * sc, 0.018 * sc, 8), M.accentDim, { pos: [ox + 0.122 * sc, 0.335 * sc + oy, oz - 0.070 * sc], rot: [-0.55, 0, 0] });
  // 左臂垂放
  P.strut(M.armorDeep, [ox - 0.070 * sc, 0.306 * sc + oy, oz], [ox - 0.088 * sc, 0.260 * sc + oy, oz - 0.022 * sc], 0.026 * sc, 0.022 * sc, 8);
  P.add(sph(0.022 * sc, 8, 6), M.armorDeep, { pos: [ox - 0.088 * sc, 0.260 * sc + oy, oz - 0.022 * sc] });
  P.strut(M.armorDeep, [ox - 0.088 * sc, 0.260 * sc + oy, oz - 0.022 * sc], [ox - 0.102 * sc, 0.210 * sc + oy, oz - 0.044 * sc], 0.022 * sc, 0.018 * sc, 8);
  P.add(sph(0.026 * sc, 9, 7), M.skin, { pos: [ox - 0.104 * sc, 0.206 * sc + oy, oz - 0.046 * sc] });
}

/**
 * K.cape · 长披风 → **短披 + 毛领**（duanpifeng）。
 * 腰部 pivot 不变；披身缩短至膝上，肩部加毛领，下摆开缝。
 */
function buildKingCapeShort(P: any, M: any, K: any, ctx: VariantBuildCtx): void {
  const jx = 0; const jy = FOOT + 0.420; const jz = -0.010;
  const PY = (y: number): number => y + FOOT;
  const pts = [
    new THREE.Vector2(0.132, PY(0.500)),
    new THREE.Vector2(0.176, PY(0.420)),
    new THREE.Vector2(0.208, PY(0.330)),
    new THREE.Vector2(0.226, PY(0.206))
  ];
  const g = new THREE.LatheGeometry(pts, 12, -Math.PI * 0.5, Math.PI * 1.0);
  g.translate(-jx, -jy, -jz);
  P.add(g, M.capeCloth, { pos: [jx, jy, jz] });
  // 毛领（同族双面材质，与披身合并为同一特殊件 → Δmesh 0）
  P.add(tor(0.148, 0.024, 4, 10), M.capeCloth, { pos: [0, PY(0.492), -0.010], rot: [Math.PI / 2, 0, 0] });
}

/* ============================================================
 * 注册（模块加载即完成；顺序无关）
 * ============================================================ */
registerVariant('P', 'weapon', 'v2', '矛', buildPawnSpearMao);
registerVariant('P', 'shield', 'v2', '方盾', buildPawnShieldSquare);
registerVariant('A', 'weapon', 'v2', '环首刀', buildAdvisorSaber);
registerVariant('A', 'shield', 'v2', '小圆盾', buildAdvisorBuckler);
registerVariant('K', 'headgear', 'v2', '变体冠式', buildKingCrownAlt);
registerVariant('K', 'backBanner', 'v2', '燕尾旌旗', buildKingBannerSwallowtail);
registerVariant('R', 'wheel', 'v2', '六辐轮', buildRookWheel6);
registerVariant('R', 'crew', 'v2', '持戟兵', buildRookHalberdier);
registerVariant('C', 'wheel', 'v2', '包铁轮', buildCannonWheelIron);
registerVariant('C', 'crew', 'v2', '尖顶笠工兵', buildCannonSoldierSapper);
registerVariant('K', 'cape', 'v2', '短披风', buildKingCapeShort);

/* ============================================================
 * 覆盖执行器（pieceFactory.buildTemplate 调用）
 * ============================================================ */

/**
 * 把装配表应用到 MultiParts：命中变体的子组**清空原几何并重建**为变体几何。
 * 未命中 / v1 / 未注册 → 原样保留（默认路径零改动）。
 *
 * @param mp          pieceFactory.MultiParts 实例
 * @param type        兵种
 * @param side        'r' | 'b'
 * @param variantSet  槽位 → 变体 id（undefined = 完全走原几何）
 * @param M           该阵营材质集
 * @param K           通用材质集
 * @param glyph       该兵种旗面汉字（banner 变体用）
 * @param jointTable  SUBGROUP_JOINTS[type]（提供成对子组各自的关节锚点）
 */
export function applySlotOverrides(
  mp: any, type: string, side: string, variantSet: Record<string, string> | undefined,
  M: any, K: any, glyph: string, jointTable: Record<string, any> | null
): void {
  if (!variantSet) return;
  const pairs = resolveVariants(type, variantSet);
  for (const { spec, variant } of pairs) {
    if (!variant.build) continue;
    const n = spec.subgroups.length;
    for (let i = 0; i < n; i++) {
      const sg = spec.subgroups[i]!;
      const parts = mp.get(sg);
      if (!parts || !Array.isArray(parts.list)) continue;
      parts.list.length = 0;   // 清空原槽位件几何（DC-4：同槽位同时最多 1 个变体实例）
      const anchor = (jointTable && jointTable[sg]) || spec.anchor;
      variant.build(parts, M, K, {
        type, side, slot: spec.slot, subgroup: sg, index: i, count: n,
        anchor: [anchor[0], anchor[1], anchor[2]], glyph
      });
    }
  }
}
