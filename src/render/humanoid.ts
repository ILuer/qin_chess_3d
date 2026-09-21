/**
 * src/render/humanoid.ts —— 标准人身骨架（STD-BODY）的 **spec 驱动构建器**（S1 · M-08c）
 * ------------------------------------------------------------
 * 目标（09 §8.5 S1）：把「人形由一堆硬编码 cyl/strut 拼出」重构为「**一套 Rig + 逐型 spec**」，
 * 使得 S2–S5 能对 N 骑手 / R 乘员 / C 操作兵 / K 坐姿复用同一套骨架，只换 spec。
 *
 * **本文件零运行期依赖**（不 import `three`、不 import 任何项目模块）：
 *   - 基本体工厂由调用方（`pieceFactory.ts`）经 `PrimFactory` **注入**（从而复用其 LOD 段数表）；
 *   - 材质对象由调用方经 `M`/`K` + `spec.materialMap` 注入；
 *   - 子组收集器 `mp`（`MultiParts`）由调用方注入。
 * 因此本文件可被 `scripts/check-piece-contract.mjs` 在**纯 Node** 下 import（CI 断言 I1/I2 用）。
 *
 * 设计要点（S1 关键）：
 *  1. **`grouping`** 决定「哪些关节成为独立 Object3D 子组」——
 *     - P：腿/臂各自独立子组 → `{ torso:'body', armR:'armR', armL:'armL', legR:'legR', legL:'legL' }`
 *     - A：双腿并入 body、双臂并入单个 arms → `{ torso:'body', legR:'body', legL:'body', armR:'arms', armL:'arms' }`
 *     S1 用它**复刻现状**（零子组增减）；S2 起改为拆分（grouping 改成各 limb 独立）。
 *  2. `segments` 是**有序**列表，骨架件（`role:'bone'`）与服饰/装备件（`role:'apparel'`）同列 ——
 *     服饰件挂在所属骨骼下，由 `buildHumanoid` 按 `grouping` 路由到子组（即「注入点」）。
 *  3. S1 的 spec 数值**逐点等于现状**（`morph` 恒等），故几何逐项不变（由 `devtools/compare-humanoid-rig.mjs` 证明）。
 *
 * ⚠ 本文件**不含** `three` 类型；`Group`/`Mesh` 一律 `any`（与 `Parts`/`MultiParts` 同口径）。
 */

/**
 * S1 开关（esbuild `define` 注入，默认 true）。
 *
 * 用法：`build.mjs` 的 `define: { __HUMANOID_RIG__: 'true' }`。
 *   - `true`  → PROD 常量折叠 + 死代码消除（**旧内联路径不进产物**）；
 *   - `false` → 保留旧内联路径（等价性验证用：`devtools/compare-humanoid-rig.mjs` 各打一份比对）。
 *
 * ⚠ 判定写法说明：**不用** `typeof __HUMANOID_RIG__ !== 'undefined'`（define 替换后
 *   `typeof true !== 'undefined'` 恒真，`false` 档会判错）。此处用 `typeof … === 'boolean'`：
 *   define=true → `typeof true === 'boolean'` → true；define=false → false；
 *   纯 Node（无 define）→ `typeof undefined === 'boolean'` → 回退默认 `true`（不崩）。
 */
declare const __HUMANOID_RIG__: boolean;
export const HUMANOID_RIG: boolean = (typeof __HUMANOID_RIG__ === 'boolean') ? __HUMANOID_RIG__ : true;

/** 三维向量（piece-local 作者坐标；`Parts.add` 会统一减 `FOOT`） */
export type Vec3 = readonly [number, number, number];

/** 关节语义（对齐 09 §3.1 标准人身 16 关节） */
export type Semantic =
  | 'torso' | 'pelvis' | 'abdomen' | 'chest' | 'waist'
  | 'neck' | 'head'
  | 'shoulder' | 'elbow' | 'wrist'
  | 'hip' | 'knee' | 'ankle';

/** 姿态预设名（S1 只落 `stand`；其余为 S2 的类型占位） */
export type PoseName = 'stand' | 'walk' | 'ride' | 'sit' | 'operate';

/** 基本体工厂（由 `pieceFactory.ts` 注入其 LOD 感知版本） */
export interface PrimFactory {
  cyl(rt: number, rb: number, h: number, seg?: number): any;
  box(w: number, h: number, d: number): any;
  sph(r: number, w?: number, h?: number): any;
  dome(r: number, w?: number, h?: number, frac?: number): any;
  tor(R: number, t: number, rs?: number, ts?: number): any;
}

/**
 * 单个零件规格。
 * `role` 区分「骨架件」（humanoid 本体）与「服饰/装备件」（调用方注入，挂在所属骨骼下）。
 * 参数按 `prim` 取用：cyl→rt/rb/h/seg；box→w/h/d；sph→r/sw/sh；dome→r/sw/sh/frac；
 * tor→R/t/rs/ts；strut→a/b/rTop/rBot/seg。
 */
export interface SegmentSpec {
  role?: 'bone' | 'apparel';
  prim: 'cyl' | 'box' | 'sph' | 'dome' | 'tor' | 'strut';
  /** 材质**逻辑键**（经 `spec.materialMap` → `M[key]` → `K[key]` 解析） */
  material: string;
  // cyl
  rt?: number; rb?: number; h?: number; seg?: number;
  // box
  w?: number; d?: number;
  // sph / dome
  r?: number; sw?: number; sh?: number; frac?: number;
  // tor
  R?: number; t?: number; rs?: number; ts?: number;
  // strut
  a?: Vec3; b?: Vec3; rTop?: number; rBot?: number;
  // transform（作者坐标，含 FOOT）
  pos?: Vec3; rot?: Vec3; scale?: Vec3;
}

/**
 * 一个关节 = 一个**发射单元**（其 `segments` 全量路由到 `grouping[name]` 指定的子组）。
 * `anchor` 为该关节的 piece-local 作者坐标（应与 `SUBGROUP_JOINTS[type][subgroup]` 一致）。
 */
export interface JointSpec {
  /** 关节名（grouping 的键） */
  name: string;
  semantic?: Semantic;
  /** 父关节名（构建 Rig 树 / I1-I2 用；`'idleGroup'` 为根） */
  parent?: string;
  anchor: Vec3;
  segments: SegmentSpec[];
}

/** 人形规格：一套骨架参数 + 逐关节零件表 */
export interface HumanoidSpec {
  /** 等比缩放（S1 恒 1） */
  scale?: number;
  side?: 'r' | 'b';
  /** 定向形变（S1 恒等；如 P 躯干横向 ×0.95 —— 预留 S2） */
  morph?: { torsoX?: number };
  /** 关节名 → 子组名（决定哪些关节成为独立 Object3D） */
  grouping: Record<string, string>;
  /** 材质逻辑键 → 材质对象覆盖（缺省走 M/K） */
  materialMap?: Record<string, any>;
  /** 姿态预设（S1 只 `stand`） */
  pose?: PoseName;
  joints: JointSpec[];
}

/** 姿态预设 → 关节初始旋转（S1 仅声明；实际发射见 `buildHumanoid`）。 */
export const POSE_PRESETS: Record<PoseName, Record<string, Vec3>> = {
  stand: {},
  walk: {},
  ride: {},
  sit: {},
  operate: {}
};

/**
 * 把 spec 发射进 `mp`（`MultiParts`）。**只按 spec 路由**，不做任何隐藏语义。
 *
 * @param mp   `MultiParts`（或兼容对象：`get(name) -> Parts` 收集器）
 * @param M    side 材质表（`mats.side(side)`）
 * @param K    common 材质表（`mats.common`）
 * @param spec 人形规格
 * @param P    基本体工厂（`pieceFactory` 的 LOD 感知 prims）
 */
export function buildHumanoid(mp: any, M: any, K: any, spec: HumanoidSpec, P: PrimFactory): void {
  const morphX = (spec.morph && typeof spec.morph.torsoX === 'number') ? spec.morph.torsoX : 1;
  const resolveMat = (key: string): any =>
    (spec.materialMap && spec.materialMap[key]) || (M && M[key]) || (K && K[key]);
  const sx = (v: Vec3 | undefined): any => {
    if (!v) return undefined;
    if (morphX === 1) return v;
    return [v[0] * morphX, v[1], v[2]];
  };

  for (const joint of spec.joints) {
    const gname = spec.grouping[joint.name] || joint.name;
    const parts: any = mp.get(gname);
    for (const s of joint.segments) {
      const mat = resolveMat(s.material);
      switch (s.prim) {
        case 'cyl':
          parts.add(P.cyl(s.rt as number, s.rb as number, s.h as number, s.seg), mat, { pos: sx(s.pos), rot: s.rot ?? undefined, scale: s.scale ?? undefined });
          break;
        case 'box':
          parts.add(P.box(s.w as number, s.h as number, s.d as number), mat, { pos: sx(s.pos), rot: s.rot ?? undefined, scale: s.scale ?? undefined });
          break;
        case 'sph':
          parts.add(P.sph(s.r as number, s.sw, s.sh), mat, { pos: sx(s.pos), rot: s.rot ?? undefined, scale: s.scale ?? undefined });
          break;
        case 'dome':
          parts.add(P.dome(s.r as number, s.sw, s.sh, s.frac), mat, { pos: sx(s.pos), rot: s.rot ?? undefined, scale: s.scale ?? undefined });
          break;
        case 'tor':
          parts.add(P.tor(s.R as number, s.t as number, s.rs, s.ts), mat, { pos: sx(s.pos), rot: s.rot ?? undefined, scale: s.scale ?? undefined });
          break;
        case 'strut':
          parts.strut(mat, s.a, s.b, s.rTop as number, s.rBot as number, s.seg as number);
          break;
      }
    }
  }
}

/* ============================================================
 * I1 / I2 —— 关节命名表 + 父子链表（**声明式完整骨架树**）
 * ------------------------------------------------------------
 * S1 纪律：`SUBGROUP_JOINTS` / `SUBGROUP_PARENTS` 保持为「**已物化**」集合（S1 不动，40 关节黄金值仍绿）；
 *   本表为「**已声明**」的完整树（含 T1/T2 空节点 waist/neck/head、hand 系列、foot 系列、forearm 系列、shin 系列）。
 *   契约断言：**已物化 ⊆ 已声明**（`check-piece-contract.mjs` ⑦-8）→ 黄金值稳定在 40，同时契约前置于 S2/S4。
 *
 * `tier`：T0（已物化，承载几何） / T1（+1 mesh 增量，肘/膝） / T2（纯变换节点，0 mesh） / attach（配件挂点）。
 * ============================================================ */

export interface RigNode {
  name: string;
  parent: string;
  semantic: Semantic | 'attach';
  tier: 'T0' | 'T1' | 'T2' | 'attach';
}

/** 标准人身骨架的**声明式**父链（name → parent）。P/A 共用；逐型差异见 HUMAN_RIG_TREE。 */
export const HUMAN_RIG_STD: Record<string, string> = {
  torso: 'idleGroup',
  waist: 'torso',
  neck: 'torso',
  head: 'neck',
  armR: 'torso',
  armL: 'torso',
  forearmR: 'armR',
  forearmL: 'armL',
  handR: 'forearmR',
  handL: 'forearmL',
  legR: 'waist',
  legL: 'waist',
  shinR: 'legR',
  shinL: 'legL',
  footR: 'shinR',
  footL: 'shinL'
};

/** 关节 tier 表（决定 mesh 代价）。 */
export const RIG_TIER: Record<string, RigNode['tier']> = {
  torso: 'T0', waist: 'T2', neck: 'T2', head: 'T2',
  armR: 'T0', armL: 'T0', forearmR: 'T1', forearmL: 'T1', handR: 'T2', handL: 'T2',
  legR: 'T0', legL: 'T0', shinR: 'T1', shinL: 'T1', footR: 'T2', footL: 'T2'
};

/** 关节语义表。 */
export const RIG_SEMANTIC: Record<string, Semantic | 'attach'> = {
  torso: 'torso', waist: 'waist', neck: 'neck', head: 'head',
  armR: 'shoulder', armL: 'shoulder', forearmR: 'elbow', forearmL: 'elbow', handR: 'wrist', handL: 'wrist',
  legR: 'hip', legL: 'hip', shinR: 'knee', shinL: 'knee', footR: 'ankle', footL: 'ankle',
  shield: 'attach', spear: 'attach', sword: 'attach', arms: 'shoulder'
};

/**
 * 逐型的**声明式**完整骨架树（name → parent）。含已物化（T0）与未物化（T1/T2/attach）节点。
 * S1 只声明 P/A（人形）；S2+ 补 N/R/C/K。
 */
export const HUMAN_RIG_TREE: Record<string, Record<string, string>> = {
  P: {
    ...HUMAN_RIG_STD,
    // P 的 `body` 子组 = torso（已物化）；配件挂点
    body: 'idleGroup',
    shield: 'forearmL',
    spear: 'handR'
  },
  A: {
    ...HUMAN_RIG_STD,
    body: 'idleGroup',
    // A 现状：双臂共享单一 pivot（`arms` 子组）；腿/头并入 `body`
    arms: 'torso',
    sword: 'handR',
    shield: 'forearmL'
  }
};

/* ============================================================
 * §3 逐型 spec 数据（S1：仅 P / A）
 * ------------------------------------------------------------
 * ★ S1「等价」纪律（09 §8.5）：每个数值**逐点等于** `pieceFactory.buildPawn` /
 *   `buildAdvisor` 现状 —— 含 `FOOT + x` 的**表达式形式**（保证与内联路径同一套
 *   IEEE-754 运算顺序 → 结果 bit 级一致）。
 *   `grouping` **复刻现状子组切分**：
 *     P → 四肢各自独立子组（body/armR/armL/legR/legL/shield/spear）；
 *     A → 双腿并入 body、双臂并入单一 arms（A 现状无 per-limb 关节）。
 *   `joints` 顺序 = `mp.get()` 调用顺序（复刻 `_subGroupNames` → idleGroup 挂载顺序）。
 *   等价性由 `devtools/compare-humanoid-rig.mjs`（零件级 diff，define 双档对拍）
 *   + `scripts/check-piece-contract.mjs` I1/I2 双重守护。
 * ============================================================ */

/** 作者坐标系下「去基座」统一下降量。**必须 = `pieceFactory.FOOT`（0.086）**：
 *  pieceFactory 的 RIG 分支入口做一次 `!==` 断言自守（define=true 折叠后零成本）。 */
export const FOOT = 0.086;

/** 'P' 兵/卒 —— 秦步兵（持戈 + 圆盾）。数值逐点等于 `buildPawn` 内联路径。 */
export const PAWN_SPEC: HumanoidSpec = {
  scale: 1,
  side: 'r',
  pose: 'stand',
  grouping: {
    torso: 'body', armR: 'armR', armL: 'armL',
    legR: 'legR', legL: 'legL', shield: 'shield', spear: 'spear'
  },
  joints: [
    {
      name: 'torso', semantic: 'torso', parent: 'idleGroup', anchor: [0, 0.334, 0],
      segments: [
        { role: 'bone', prim: 'cyl', material: 'cloth', rt: 0.105, rb: 0.155, h: 0.235, seg: 14, pos: [0, FOOT + 0.118, 0] },
        { role: 'bone', prim: 'tor', material: 'clothDeep', R: 0.150, t: 0.012, rs: 5, ts: 16, pos: [0, FOOT + 0.024, 0], rot: [Math.PI / 2, 0, 0] },
        { role: 'apparel', prim: 'tor', material: 'leather', R: 0.108, t: 0.016, rs: 5, ts: 16, pos: [0, 0.345, 0], rot: [Math.PI / 2, 0, 0] },
        { role: 'bone', prim: 'cyl', material: 'clothDeep', rt: 0.100, rb: 0.112, h: 0.185, seg: 14, pos: [0, 0.437, 0] },
        { role: 'bone', prim: 'cyl', material: 'clothDeep', rt: 0.110, rb: 0.118, h: 0.060, seg: 14, pos: [0, 0.378, 0] },
        { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.118, rb: 0.122, h: 0.022, seg: 14, pos: [0, 0.375, 0] },
        { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.118, rb: 0.122, h: 0.022, seg: 14, pos: [0, 0.435, 0] },
        { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.116, rb: 0.120, h: 0.022, seg: 14, pos: [0, 0.492, 0] },
        { role: 'apparel', prim: 'sph', material: 'armorDeep', r: 0.050, sw: 10, sh: 8, pos: [0.098, 0.523, 0] },
        { role: 'apparel', prim: 'sph', material: 'armorDeep', r: 0.050, sw: 10, sh: 8, pos: [-0.098, 0.523, 0] },
        { role: 'apparel', prim: 'cyl', material: 'accentDim', rt: 0.062, rb: 0.080, h: 0.024, seg: 12, pos: [0, 0.542, 0] },
        { role: 'bone', prim: 'cyl', material: 'skin', rt: 0.030, rb: 0.032, h: 0.038, seg: 8, pos: [0, 0.566, 0] },
        { role: 'bone', prim: 'sph', material: 'skin', r: 0.056, sw: 12, sh: 10, pos: [0, 0.618, -0.006] },
        { role: 'apparel', prim: 'cyl', material: 'clothDeep', rt: 0.072, rb: 0.076, h: 0.012, seg: 14, pos: [0, 0.657, -0.004] },
        { role: 'apparel', prim: 'tor', material: 'leather', R: 0.062, t: 0.008, rs: 5, ts: 14, pos: [0, 0.664, -0.004], rot: [Math.PI / 2, 0, 0] },
        { role: 'apparel', prim: 'cyl', material: 'cloth', rt: 0.022, rb: 0.068, h: 0.070, seg: 12, pos: [0, 0.700, -0.004], rot: [-0.12, 0, 0] }
      ]
    },
    {
      name: 'armR', semantic: 'shoulder', parent: 'torso', anchor: [0.096, 0.419, 0],
      segments: [
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [0.096, 0.505, 0.000], b: [0.122, 0.438, -0.006], rTop: 0.030, rBot: 0.026, seg: 8 },
        { role: 'bone', prim: 'sph', material: 'clothDeep', r: 0.026, sw: 9, sh: 7, pos: [0.122, 0.438, -0.006] },
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [0.122, 0.438, -0.006], b: [0.150, 0.372, -0.012], rTop: 0.026, rBot: 0.022, seg: 8 },
        { role: 'bone', prim: 'sph', material: 'skin', r: 0.032, sw: 10, sh: 8, pos: [0.156, 0.366, -0.014] }
      ]
    },
    {
      name: 'armL', semantic: 'shoulder', parent: 'torso', anchor: [-0.096, 0.419, 0],
      segments: [
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [-0.096, 0.505, 0.000], b: [-0.122, 0.454, -0.020], rTop: 0.030, rBot: 0.026, seg: 8 },
        { role: 'bone', prim: 'sph', material: 'clothDeep', r: 0.026, sw: 9, sh: 7, pos: [-0.122, 0.454, -0.020] },
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [-0.122, 0.454, -0.020], b: [-0.148, 0.402, -0.040], rTop: 0.026, rBot: 0.022, seg: 8 },
        { role: 'bone', prim: 'sph', material: 'skin', r: 0.032, sw: 10, sh: 8, pos: [-0.152, 0.398, -0.046] }
      ]
    },
    {
      name: 'legR', semantic: 'hip', parent: 'waist', anchor: [0.055, 0.300, 0],
      segments: [
        { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.075, h: 0.045, d: 0.115, pos: [0.055, FOOT + 0.022, -0.028] },
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [0.055, 0.430, -0.010], b: [0.055, 0.230, -0.018], rTop: 0.034, rBot: 0.030, seg: 8 },
        { role: 'bone', prim: 'sph', material: 'clothDeep', r: 0.026, sw: 8, sh: 6, pos: [0.055, 0.230, -0.018] },
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [0.055, 0.230, -0.018], b: [0.055, FOOT + 0.045, -0.025], rTop: 0.028, rBot: 0.024, seg: 8 }
      ]
    },
    {
      name: 'legL', semantic: 'hip', parent: 'waist', anchor: [-0.055, 0.300, 0],
      segments: [
        { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.075, h: 0.045, d: 0.115, pos: [-0.055, FOOT + 0.022, -0.028] },
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [-0.055, 0.430, -0.010], b: [-0.055, 0.230, -0.018], rTop: 0.034, rBot: 0.030, seg: 8 },
        { role: 'bone', prim: 'sph', material: 'clothDeep', r: 0.026, sw: 8, sh: 6, pos: [-0.055, 0.230, -0.018] },
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [-0.055, 0.230, -0.018], b: [-0.055, FOOT + 0.045, -0.025], rTop: 0.028, rBot: 0.024, seg: 8 }
      ]
    },
    {
      name: 'shield', parent: 'armL', anchor: [-0.176, 0.400, -0.058],
      segments: [
        { role: 'apparel', prim: 'cyl', material: 'leather', rt: 0.094, rb: 0.094, h: 0.018, seg: 14, pos: [-0.176, 0.400, -0.058], rot: [Math.PI / 2, 0, 0] },
        { role: 'apparel', prim: 'tor', material: 'accentDim', R: 0.094, t: 0.012, rs: 5, ts: 16, pos: [-0.176, 0.400, -0.058] },
        { role: 'apparel', prim: 'sph', material: 'bronze', r: 0.030, sw: 10, sh: 8, pos: [-0.176, 0.400, -0.076] }
      ]
    },
    {
      name: 'spear', parent: 'armR', anchor: [0.170, 0.440, -0.020],
      segments: [
        { role: 'apparel', prim: 'cyl', material: 'woodDeep', rt: 0.011, rb: 0.013, h: 0.600, seg: 8, pos: [0.170, 0.440, -0.020], rot: [-0.055, 0, 0] },
        { role: 'apparel', prim: 'box', material: 'bronze', w: 0.118, h: 0.028, d: 0.011, pos: [0.226, 0.700, -0.030], rot: [0, 0, -0.10] },
        { role: 'apparel', prim: 'box', material: 'bronze', w: 0.052, h: 0.020, d: 0.011, pos: [0.126, 0.686, -0.030] },
        { role: 'apparel', prim: 'cyl', material: 'bronze', rt: 0.000, rb: 0.018, h: 0.050, seg: 8, pos: [0.170, 0.765, -0.030] }
      ]
    }
  ]
};

/** 'A' 士/仕 —— 卫兵（武弁 + 筒袖铠，双手拄剑 + 圆盾）。数值逐点等于 `buildAdvisor` 内联路径。
 *  现状结构：双腿在 body 内联、双臂共享单一 `arms` pivot → spec 忠实建模为 4 关节
 *  （torso→body / arms→arms / sword / shield），零子组增减；per-limb 拆分属 S2。 */
export const ADVISOR_SPEC: HumanoidSpec = {
  scale: 1,
  side: 'r',
  pose: 'stand',
  grouping: { torso: 'body', arms: 'arms', sword: 'sword', shield: 'shield' },
  joints: [
    {
      name: 'torso', semantic: 'torso', parent: 'idleGroup', anchor: [0, 0.334, 0],
      segments: [
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [0.040, 0.150, 0.000], b: [0.040, FOOT + 0.080, 0.000], rTop: 0.028, rBot: 0.024, seg: 8 },
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [-0.040, 0.150, 0.000], b: [-0.040, FOOT + 0.080, 0.000], rTop: 0.028, rBot: 0.024, seg: 8 },
        { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.054, h: 0.024, d: 0.078, pos: [0.040, FOOT + 0.012, 0.008] },
        { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.054, h: 0.024, d: 0.078, pos: [-0.040, FOOT + 0.012, 0.008] },
        { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.070, h: 0.040, d: 0.100, pos: [0.050, FOOT + 0.020, -0.024] },
        { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.070, h: 0.040, d: 0.100, pos: [-0.050, FOOT + 0.020, -0.024] },
        { role: 'apparel', prim: 'cyl', material: 'armorDeep', rt: 0.128, rb: 0.168, h: 0.254, seg: 14, pos: [0, FOOT + 0.127, 0] },
        { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.152, rb: 0.158, h: 0.022, seg: 14, pos: [0, 0.160, 0] },
        { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.143, rb: 0.148, h: 0.022, seg: 14, pos: [0, 0.252, 0] },
        { role: 'apparel', prim: 'tor', material: 'leather', R: 0.130, t: 0.017, rs: 5, ts: 18, pos: [0, 0.346, 0], rot: [Math.PI / 2, 0, 0] },
        { role: 'bone', prim: 'cyl', material: 'armorDeep', rt: 0.124, rb: 0.134, h: 0.070, seg: 14, pos: [0, 0.400, 0] },
        { role: 'bone', prim: 'cyl', material: 'armorDeep', rt: 0.116, rb: 0.132, h: 0.262, seg: 14, pos: [0, 0.472, 0] },
        { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.136, rb: 0.140, h: 0.023, seg: 14, pos: [0, 0.382, 0] },
        { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.134, rb: 0.138, h: 0.023, seg: 14, pos: [0, 0.446, 0] },
        { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.131, rb: 0.135, h: 0.023, seg: 14, pos: [0, 0.510, 0] },
        { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.127, rb: 0.131, h: 0.023, seg: 14, pos: [0, 0.572, 0] },
        { role: 'apparel', prim: 'cyl', material: 'armorDeep', rt: 0.050, rb: 0.060, h: 0.180, seg: 10, pos: [0.146, 0.472, -0.006] },
        { role: 'apparel', prim: 'cyl', material: 'armorDeep', rt: 0.050, rb: 0.060, h: 0.180, seg: 10, pos: [-0.146, 0.472, -0.006] },
        { role: 'apparel', prim: 'dome', material: 'armor', r: 0.072, sw: 12, sh: 7, frac: 0.60, pos: [0.140, 0.582, 0] },
        { role: 'apparel', prim: 'dome', material: 'armor', r: 0.072, sw: 12, sh: 7, frac: 0.60, pos: [-0.140, 0.582, 0] },
        { role: 'apparel', prim: 'cyl', material: 'accentDim', rt: 0.064, rb: 0.086, h: 0.030, seg: 12, pos: [0, 0.615, 0] },
        { role: 'bone', prim: 'cyl', material: 'skin', rt: 0.028, rb: 0.030, h: 0.030, seg: 8, pos: [0, 0.648, 0] },
        { role: 'bone', prim: 'sph', material: 'skin', r: 0.056, sw: 12, sh: 10, pos: [0, 0.715, -0.004] },
        { role: 'apparel', prim: 'cyl', material: 'accentDim', rt: 0.062, rb: 0.068, h: 0.024, seg: 12, pos: [0, 0.756, -0.002] },
        { role: 'apparel', prim: 'cyl', material: 'leather', rt: 0.028, rb: 0.062, h: 0.086, seg: 12, pos: [0, 0.810, -0.002] },
        { role: 'apparel', prim: 'sph', material: 'accent', r: 0.020, sw: 10, sh: 8, pos: [0, 0.860, -0.002] },
        { role: 'apparel', prim: 'box', material: 'cloth', w: 0.012, h: 0.088, d: 0.008, pos: [0.052, 0.716, 0.040], rot: [0.16, 0, 0.08] },
        { role: 'apparel', prim: 'box', material: 'cloth', w: 0.012, h: 0.088, d: 0.008, pos: [-0.052, 0.716, 0.040], rot: [0.16, 0, -0.08] }
      ]
    },
    {
      name: 'arms', semantic: 'shoulder', parent: 'torso', anchor: [0, 0.474, 0],
      segments: [
        { role: 'bone', prim: 'strut', material: 'armorDeep', a: [0.140, 0.560, -0.006], b: [0.094, 0.556, -0.052], rTop: 0.032, rBot: 0.028, seg: 8 },
        { role: 'bone', prim: 'sph', material: 'armorDeep', r: 0.026, sw: 9, sh: 7, pos: [0.094, 0.556, -0.052] },
        { role: 'bone', prim: 'strut', material: 'armorDeep', a: [0.094, 0.556, -0.052], b: [0.048, 0.556, -0.154], rTop: 0.028, rBot: 0.024, seg: 8 },
        { role: 'bone', prim: 'strut', material: 'armorDeep', a: [-0.140, 0.560, -0.006], b: [-0.094, 0.544, -0.052], rTop: 0.032, rBot: 0.028, seg: 8 },
        { role: 'bone', prim: 'sph', material: 'armorDeep', r: 0.026, sw: 9, sh: 7, pos: [-0.094, 0.544, -0.052] },
        { role: 'bone', prim: 'strut', material: 'armorDeep', a: [-0.094, 0.544, -0.052], b: [-0.048, 0.534, -0.154], rTop: 0.028, rBot: 0.024, seg: 8 },
        { role: 'bone', prim: 'sph', material: 'skin', r: 0.032, sw: 10, sh: 8, pos: [0.036, 0.556, -0.168] },
        { role: 'bone', prim: 'sph', material: 'skin', r: 0.032, sw: 10, sh: 8, pos: [-0.036, 0.532, -0.168] }
      ]
    },
    {
      name: 'sword', parent: 'handR', anchor: [0, 0.328, -0.126],
      segments: [
        { role: 'apparel', prim: 'box', material: 'blade', w: 0.048, h: 0.400, d: 0.015, pos: [0, 0.288, -0.126] },
        { role: 'apparel', prim: 'box', material: 'bronze', w: 0.094, h: 0.022, d: 0.030, pos: [0, 0.500, -0.126] },
        { role: 'apparel', prim: 'cyl', material: 'leather', rt: 0.017, rb: 0.019, h: 0.086, seg: 10, pos: [0, 0.554, -0.126] },
        { role: 'apparel', prim: 'sph', material: 'bronze', r: 0.026, sw: 10, sh: 8, pos: [0, 0.606, -0.126] }
      ]
    },
    {
      name: 'shield', parent: 'forearmL', anchor: [0, 0.45, -0.20],
      segments: [
        { role: 'apparel', prim: 'cyl', material: 'leather', rt: 0.112, rb: 0.112, h: 0.022, seg: 14, pos: [0, 0.45, -0.20], rot: [Math.PI / 2, 0, 0] },
        { role: 'apparel', prim: 'tor', material: 'accentDim', R: 0.112, t: 0.012, rs: 5, ts: 16, pos: [0, 0.45, -0.20] },
        { role: 'apparel', prim: 'cyl', material: 'wood', rt: 0.096, rb: 0.096, h: 0.012, seg: 14, pos: [0, 0.45, -0.194], rot: [Math.PI / 2, 0, 0] },
        { role: 'apparel', prim: 'sph', material: 'bronze', r: 0.030, sw: 10, sh: 8, pos: [0, 0.45, -0.186] }
      ]
    }
  ]
};
