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

/**
 * 姿态预设 → 关节初始旋转（S1 起仅**声明**；S2 为各型 spec 标注姿态来源）。
 * 逐型归口（S2 · M-08d）：
 *   stand   → P/A（立姿）+ R 乘员（御手/持戈兵，立姿）
 *   ride    → N 骑手（骑姿）
 *   operate → C 操作兵（推车/绞盘姿态）
 *   sit     → K 坐姿人物
 *   walk    → 通用踏步（预留）
 * ⚠ S2 **仍为零几何改动**：本表只记录意图，不产生任何初始旋转（发射仍见 §3/§4 spec 数值）。
 */
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
 *   S1 声明 P/A（人形）；S2（M-08d）补 N/R/C/K/B。
 *
 * ★ S2 纪律：**已物化 ⊆ 已声明**（`check-piece-contract.mjs` ⑧-I2）对全部 7 型成立。
 *   逐型的「子组名」在此声明其语义父链；具体映射（哪个 spec 关节 → 哪个子组）见 §4。
 *   父子仅作**语义血统**用，不参与几何（几何锚定仍走 `SUBGROUP_JOINTS`，红线 JOINT）。
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
  },
  // N 骑兵（马 + 骑手）：骑手挂在马身下（语义），四腿挂马身。
  N: {
    ...HUMAN_RIG_STD,
    bodyHorse: 'idleGroup',
    rider: 'bodyHorse',
    legFL: 'bodyHorse', legFR: 'bodyHorse', legBL: 'bodyHorse', legBR: 'bodyHorse'
  },
  // R 战车（双马 + 车体 + 御手 + 持戈兵 + 轮）。
  R: {
    ...HUMAN_RIG_STD,
    horses: 'idleGroup', body: 'idleGroup',
    driver: 'body', spearman: 'body',
    wheelL: 'body', wheelR: 'body'
  },
  // C 抛石车（器械 + 两名操作兵）。
  C: {
    ...HUMAN_RIG_STD,
    trebuchet: 'idleGroup', cart: 'trebuchet',
    soldierL: 'cart', soldierR: 'cart',
    counterweight: 'trebuchet', wheelL: 'cart', wheelR: 'cart'
  },
  // K 主帅（坐姿人物 body + 右臂 rArm + 王座/冠/剑/旗/披风）。
  K: {
    ...HUMAN_RIG_STD,
    body: 'idleGroup', throne: 'idleGroup',
    crown: 'head', sword: 'handR', banner: 'torso', rArm: 'torso', capeHem: 'torso'
  },
  // B 象/相（书生）：★ S2 实测**无独立人形骨架**（躯干为 Lathe 车削深衣单体，
  //   无 per-limb 骨段）→ 不接 spec（详见 §4 末「B 判定」）。此处仅补声明树，
  //   保证「已物化 ⊆ 已声明」对 B 亦成立。
  B: {
    ...HUMAN_RIG_STD,
    bodyRobe: 'idleGroup', hem: 'waist', arms: 'torso'
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

/* ============================================================
 * §4 逐型 spec 数据（S2 · M-08d：N 骑手 / R 乘员 / C 操作兵 / K 坐姿接入同一 Rig）
 * ------------------------------------------------------------
 * ★ S2「等价」纪律（09 §8.5 S2）：几何判据与 S1 **完全一致 —— 逐零件等同**。
 *   ① 参数化类型（R 御手/持戈兵、C 操作兵）用 **spec 工厂**（runtime 变量同源），
 *      保证 `ox/oz/sc/oy/mx` 参与的运算**与内联同一套 IEEE-754 顺序**（bit 级一致）；
 *      常量类型（N 骑手 / K 坐姿）用**字面量 spec**。
 *   ② `grouping` **只路由到该型已物化的真实子组**（零新子组）：单子组类型（N.rider、
 *      R.driver/spearman、C.soldierL/R）的多个关节全映射到同一子组；K 映射 body/rArm。
 *   ③ `anchor` = 该关节所属子组的 `SUBGROUP_JOINTS[type][group]`（供契约 I2 断言；
 *      `buildHumanoid` 不消费 anchor —— 几何锚定仍走 `SUBGROUP_JOINTS`）。
 *   ④ **武器/甲裙/头饰/旗一律继续内联**（长戟 N、长戈 R、介帻/兜鍪等归类保留）。
 *   ⑤ `grouping` 键 = `joints[].name`（契约 I2 断言）。
 *
 * ⚠ 与 P/A（§3）唯一差异：单子组类型的多个关节共享一个 `Parts` 收集器 →
 *   子组内**发射顺序**可能与本文件旧内联路径不同（如 R 持戈兵的长戈居中），
 *   但**零件集合与每个零件的几何逐项相同**（等价判据 = 零件级无序比对，
 *   见 `devtools/compare-humanoid-rig.mjs`；S1 起即按无序集合比对）。
 * ============================================================ */

/** 'N' 骑手（`buildHorse` 的 `rider` 子组）—— 骑姿。字面量 spec，逐点等于 rider 内联。
 *  不含**长戟**（武器，`pieceFactory` 内联续写）。 */
export const RIDER_SPEC: HumanoidSpec = {
  scale: 1,
  side: 'r',
  pose: 'ride',
  grouping: { legs: 'rider', torso: 'rider', arms: 'rider' },
  joints: [
    {
      name: 'legs', semantic: 'hip', parent: 'torso', anchor: [0, 0.328, 0],
      segments: [
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [0.062, 0.430, 0.005], b: [0.078, 0.300, -0.020], rTop: 0.034, rBot: 0.030, seg: 8 },
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [-0.062, 0.430, 0.005], b: [-0.078, 0.300, -0.020], rTop: 0.034, rBot: 0.030, seg: 8 },
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [0.078, 0.300, -0.020], b: [0.072, 0.180, -0.018], rTop: 0.028, rBot: 0.024, seg: 8 },
        { role: 'bone', prim: 'strut', material: 'clothDeep', a: [-0.078, 0.300, -0.020], b: [-0.072, 0.180, -0.018], rTop: 0.028, rBot: 0.024, seg: 8 },
        { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.052, h: 0.030, d: 0.080, pos: [0.072, 0.150, -0.018] },
        { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.052, h: 0.030, d: 0.080, pos: [-0.072, 0.150, -0.018] }
      ]
    },
    {
      name: 'torso', semantic: 'torso', parent: 'idleGroup', anchor: [0, 0.328, 0],
      segments: [
        { role: 'apparel', prim: 'sph', material: 'cloth', r: 0.070, sw: 10, sh: 8, pos: [0, 0.490, 0.020] },
        { role: 'bone', prim: 'cyl', material: 'clothDeep', rt: 0.080, rb: 0.092, h: 0.080, seg: 12, pos: [0, 0.510, 0.012] },
        { role: 'bone', prim: 'strut', material: 'cloth', a: [0.078, 0.482, 0.005], b: [0.116, 0.338, -0.098], rTop: 0.034, rBot: 0.026, seg: 8 },
        { role: 'bone', prim: 'strut', material: 'cloth', a: [-0.078, 0.482, 0.005], b: [-0.116, 0.338, -0.098], rTop: 0.034, rBot: 0.026, seg: 8 },
        { role: 'apparel', prim: 'cyl', material: 'armorDeep', rt: 0.082, rb: 0.096, h: 0.160, seg: 12, pos: [0, 0.580, 0.010] },
        { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.101, rb: 0.104, h: 0.020, seg: 12, pos: [0, 0.548, 0.010] },
        { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.099, rb: 0.102, h: 0.020, seg: 12, pos: [0, 0.608, 0.010] },
        { role: 'apparel', prim: 'sph', material: 'armorDeep', r: 0.045, sw: 10, sh: 8, pos: [0.086, 0.652, 0.010] },
        { role: 'apparel', prim: 'sph', material: 'armorDeep', r: 0.045, sw: 10, sh: 8, pos: [-0.086, 0.652, 0.010] },
        { role: 'bone', prim: 'cyl', material: 'skin', rt: 0.026, rb: 0.028, h: 0.030, seg: 8, pos: [0, 0.676, 0.008] },
        { role: 'bone', prim: 'sph', material: 'skin', r: 0.050, sw: 12, sh: 10, pos: [0, 0.716, 0.002] },
        { role: 'apparel', prim: 'cyl', material: 'armorDeep', rt: 0.058, rb: 0.070, h: 0.032, seg: 12, pos: [0, 0.704, 0.002] },
        { role: 'apparel', prim: 'dome', material: 'armor', r: 0.056, sw: 12, sh: 7, frac: 0.58, pos: [0, 0.732, 0.002] },
        { role: 'apparel', prim: 'cyl', material: 'plume', rt: 0.000, rb: 0.020, h: 0.062, seg: 8, pos: [0, 0.796, 0.002] }
      ]
    },
    {
      name: 'arms', semantic: 'shoulder', parent: 'torso', anchor: [0, 0.328, 0],
      segments: [
        { role: 'bone', prim: 'strut', material: 'armorDeep', a: [0.088, 0.638, 0.005], b: [0.110, 0.590, -0.040], rTop: 0.030, rBot: 0.026, seg: 8 },
        { role: 'bone', prim: 'sph', material: 'armorDeep', r: 0.024, sw: 8, sh: 6, pos: [0.110, 0.590, -0.040] },
        { role: 'bone', prim: 'strut', material: 'armorDeep', a: [0.110, 0.590, -0.040], b: [0.132, 0.548, -0.086], rTop: 0.024, rBot: 0.020, seg: 8 },
        { role: 'bone', prim: 'strut', material: 'armorDeep', a: [-0.088, 0.638, 0.005], b: [-0.104, 0.598, 0.020], rTop: 0.030, rBot: 0.026, seg: 8 },
        { role: 'bone', prim: 'sph', material: 'armorDeep', r: 0.024, sw: 8, sh: 6, pos: [-0.104, 0.598, 0.020] },
        { role: 'bone', prim: 'strut', material: 'armorDeep', a: [-0.104, 0.598, 0.020], b: [-0.120, 0.556, 0.060], rTop: 0.024, rBot: 0.020, seg: 8 },
        { role: 'bone', prim: 'sph', material: 'skin', r: 0.030, sw: 10, sh: 8, pos: [0.136, 0.542, -0.094] }
      ]
    }
  ]
};

/** 御手 spec 工厂（R `driver` 子组）—— 立姿，双手握缰。参数与 `buildDriver` 同序，
 *  数值逐点等于内联（`sc = s||1`、全部 `×sc` + `oy`）。无武器 → 全量 spec。 */
export function driverSpec(ox: number, oz: number, s: number, oy = 0.086): HumanoidSpec {
  const sc = s || 1.0;
  return {
    scale: 1,
    side: 'r',
    pose: 'stand',
    grouping: { legs: 'driver', torso: 'driver', arms: 'driver' },
    joints: [
      {
        name: 'legs', semantic: 'hip', parent: 'torso', anchor: [0.050, 0.4465, -0.050],
        segments: [
          { role: 'bone', prim: 'strut', material: 'clothDeep', a: [ox, 0.150 * sc + oy, oz], b: [ox, 0.080 * sc + oy, oz], rTop: 0.034, rBot: 0.030, seg: 8 },
          { role: 'bone', prim: 'strut', material: 'clothDeep', a: [ox + 0.020 * sc, 0.150 * sc + oy, oz], b: [ox + 0.022 * sc, 0.080 * sc + oy, oz], rTop: 0.028, rBot: 0.024, seg: 8 },
          { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.052 * sc, h: 0.024 * sc, d: 0.084 * sc, pos: [ox + 0.010 * sc, 0.012 * sc + oy, oz + 0.012 * sc] }
        ]
      },
      {
        name: 'torso', semantic: 'torso', parent: 'idleGroup', anchor: [0.050, 0.4465, -0.050],
        segments: [
          { role: 'apparel', prim: 'cyl', material: 'clothDeep', rt: 0.058 * sc, rb: 0.080 * sc, h: 0.160 * sc, seg: 10, pos: [ox, 0.080 * sc + oy, oz] },
          { role: 'apparel', prim: 'tor', material: 'leather', R: 0.080 * sc, t: 0.012 * sc, rs: 4, ts: 12, pos: [ox, 0.156 * sc + oy, oz], rot: [Math.PI / 2, 0, 0] },
          { role: 'bone', prim: 'cyl', material: 'clothDeep', rt: 0.066 * sc, rb: 0.072 * sc, h: 0.060 * sc, seg: 10, pos: [ox, 0.205 * sc + oy, oz] },
          { role: 'apparel', prim: 'cyl', material: 'armorDeep', rt: 0.056 * sc, rb: 0.066 * sc, h: 0.140 * sc, seg: 10, pos: [ox, 0.256 * sc + oy, oz] },
          { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.068 * sc, rb: 0.072 * sc, h: 0.018 * sc, seg: 10, pos: [ox, 0.216 * sc + oy, oz] },
          { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.066 * sc, rb: 0.070 * sc, h: 0.018 * sc, seg: 10, pos: [ox, 0.264 * sc + oy, oz] },
          { role: 'apparel', prim: 'sph', material: 'armorDeep', r: 0.038 * sc, sw: 9, sh: 7, pos: [ox + 0.072 * sc, 0.308 * sc + oy, oz] },
          { role: 'apparel', prim: 'sph', material: 'armorDeep', r: 0.038 * sc, sw: 9, sh: 7, pos: [ox - 0.072 * sc, 0.308 * sc + oy, oz] },
          { role: 'apparel', prim: 'cyl', material: 'accentDim', rt: 0.026 * sc, rb: 0.028 * sc, h: 0.024 * sc, seg: 8, pos: [ox, 0.350 * sc + oy, oz] },
          { role: 'bone', prim: 'cyl', material: 'skin', rt: 0.024 * sc, rb: 0.026 * sc, h: 0.028 * sc, seg: 8, pos: [ox, 0.376 * sc + oy, oz] },
          { role: 'bone', prim: 'sph', material: 'skin', r: 0.044 * sc, sw: 10, sh: 8, pos: [ox, 0.416 * sc + oy, oz - 0.004 * sc] },
          { role: 'apparel', prim: 'dome', material: 'armor', r: 0.042 * sc, sw: 10, sh: 6, frac: 0.56, pos: [ox, 0.436 * sc + oy, oz - 0.004 * sc] }
        ]
      },
      {
        name: 'arms', semantic: 'shoulder', parent: 'torso', anchor: [0.050, 0.4465, -0.050],
        segments: [
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [ox + 0.068 * sc, 0.304 * sc + oy, oz], b: [ox + 0.072 * sc, 0.278 * sc + oy, oz - 0.040 * sc], rTop: 0.026 * sc, rBot: 0.022 * sc, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'armorDeep', r: 0.022 * sc, sw: 8, sh: 6, pos: [ox + 0.072 * sc, 0.278 * sc + oy, oz - 0.040 * sc] },
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [ox + 0.072 * sc, 0.278 * sc + oy, oz - 0.040 * sc], b: [ox + 0.075 * sc, 0.248 * sc + oy, oz - 0.080 * sc], rTop: 0.022 * sc, rBot: 0.018 * sc, seg: 8 },
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [ox - 0.068 * sc, 0.304 * sc + oy, oz], b: [ox - 0.066 * sc, 0.280 * sc + oy, oz - 0.034 * sc], rTop: 0.026 * sc, rBot: 0.022 * sc, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'armorDeep', r: 0.022 * sc, sw: 8, sh: 6, pos: [ox - 0.066 * sc, 0.280 * sc + oy, oz - 0.034 * sc] },
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [ox - 0.066 * sc, 0.280 * sc + oy, oz - 0.034 * sc], b: [ox - 0.065 * sc, 0.252 * sc + oy, oz - 0.070 * sc], rTop: 0.022 * sc, rBot: 0.018 * sc, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'skin', r: 0.026 * sc, sw: 9, sh: 7, pos: [ox + 0.077 * sc, 0.244 * sc + oy, oz - 0.082 * sc] },
          { role: 'bone', prim: 'sph', material: 'skin', r: 0.026 * sc, sw: 9, sh: 7, pos: [ox - 0.067 * sc, 0.248 * sc + oy, oz - 0.072 * sc] }
        ]
      }
    ]
  };
}

/** 持戈兵 spec 工厂（R `spearman` 子组）—— 立姿，右臂持戈、左臂垂放。
 *  数值逐点等于内联（`sc = s||1`）。**长戈为武器 → 由 `pieceFactory` 内联续写**，
 *  故本 spec 到左臂为止（`armR`/`armL` 两关节；长戈旧位置在两臂之间）。 */
export function spearmanSpec(ox: number, oz: number, s: number, oy = 0.086): HumanoidSpec {
  const sc = s || 1.0;
  return {
    scale: 1,
    side: 'r',
    pose: 'stand',
    grouping: { legs: 'spearman', torso: 'spearman', armR: 'spearman', armL: 'spearman' },
    joints: [
      {
        name: 'legs', semantic: 'hip', parent: 'torso', anchor: [-0.050, 0.451, 0.080],
        segments: [
          { role: 'bone', prim: 'strut', material: 'clothDeep', a: [ox, 0.150 * sc + oy, oz], b: [ox, 0.080 * sc + oy, oz], rTop: 0.034, rBot: 0.030, seg: 8 },
          { role: 'bone', prim: 'strut', material: 'clothDeep', a: [ox + 0.020 * sc, 0.150 * sc + oy, oz], b: [ox + 0.022 * sc, 0.080 * sc + oy, oz], rTop: 0.028, rBot: 0.024, seg: 8 },
          { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.052 * sc, h: 0.024 * sc, d: 0.084 * sc, pos: [ox + 0.010 * sc, 0.012 * sc + oy, oz + 0.012 * sc] }
        ]
      },
      {
        name: 'torso', semantic: 'torso', parent: 'idleGroup', anchor: [-0.050, 0.451, 0.080],
        segments: [
          { role: 'apparel', prim: 'cyl', material: 'clothDeep', rt: 0.060 * sc, rb: 0.082 * sc, h: 0.165 * sc, seg: 10, pos: [ox, 0.082 * sc + oy, oz] },
          { role: 'apparel', prim: 'tor', material: 'leather', R: 0.082 * sc, t: 0.012 * sc, rs: 4, ts: 12, pos: [ox, 0.162 * sc + oy, oz], rot: [Math.PI / 2, 0, 0] },
          { role: 'bone', prim: 'cyl', material: 'clothDeep', rt: 0.068 * sc, rb: 0.074 * sc, h: 0.060 * sc, seg: 10, pos: [ox, 0.208 * sc + oy, oz] },
          { role: 'apparel', prim: 'cyl', material: 'armorDeep', rt: 0.058 * sc, rb: 0.068 * sc, h: 0.145 * sc, seg: 10, pos: [ox, 0.258 * sc + oy, oz] },
          { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.070 * sc, rb: 0.074 * sc, h: 0.018 * sc, seg: 10, pos: [ox, 0.218 * sc + oy, oz] },
          { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.068 * sc, rb: 0.072 * sc, h: 0.018 * sc, seg: 10, pos: [ox, 0.266 * sc + oy, oz] },
          { role: 'apparel', prim: 'sph', material: 'armorDeep', r: 0.040 * sc, sw: 9, sh: 7, pos: [ox + 0.074 * sc, 0.310 * sc + oy, oz] },
          { role: 'apparel', prim: 'sph', material: 'armorDeep', r: 0.040 * sc, sw: 9, sh: 7, pos: [ox - 0.074 * sc, 0.310 * sc + oy, oz] },
          { role: 'apparel', prim: 'cyl', material: 'accentDim', rt: 0.026 * sc, rb: 0.028 * sc, h: 0.024 * sc, seg: 8, pos: [ox, 0.352 * sc + oy, oz] },
          { role: 'bone', prim: 'cyl', material: 'skin', rt: 0.024 * sc, rb: 0.026 * sc, h: 0.028 * sc, seg: 8, pos: [ox, 0.378 * sc + oy, oz] },
          { role: 'bone', prim: 'sph', material: 'skin', r: 0.044 * sc, sw: 10, sh: 8, pos: [ox, 0.418 * sc + oy, oz - 0.004 * sc] },
          { role: 'apparel', prim: 'dome', material: 'armor', r: 0.042 * sc, sw: 10, sh: 6, frac: 0.56, pos: [ox, 0.438 * sc + oy, oz - 0.004 * sc] }
        ]
      },
      {
        name: 'armR', semantic: 'shoulder', parent: 'torso', anchor: [-0.050, 0.451, 0.080],
        segments: [
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [ox + 0.070 * sc, 0.306 * sc + oy, oz], b: [ox + 0.098 * sc, 0.288 * sc + oy, oz - 0.040 * sc], rTop: 0.026 * sc, rBot: 0.022 * sc, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'armorDeep', r: 0.022 * sc, sw: 8, sh: 6, pos: [ox + 0.098 * sc, 0.288 * sc + oy, oz - 0.040 * sc] },
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [ox + 0.098 * sc, 0.288 * sc + oy, oz - 0.040 * sc], b: [ox + 0.124 * sc, 0.272 * sc + oy, oz - 0.084 * sc], rTop: 0.022 * sc, rBot: 0.018 * sc, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'skin', r: 0.026 * sc, sw: 9, sh: 7, pos: [ox + 0.126 * sc, 0.268 * sc + oy, oz - 0.086 * sc] }
        ]
      },
      {
        name: 'armL', semantic: 'shoulder', parent: 'torso', anchor: [-0.050, 0.451, 0.080],
        segments: [
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [ox - 0.070 * sc, 0.306 * sc + oy, oz], b: [ox - 0.088 * sc, 0.260 * sc + oy, oz - 0.022 * sc], rTop: 0.026 * sc, rBot: 0.022 * sc, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'armorDeep', r: 0.022 * sc, sw: 8, sh: 6, pos: [ox - 0.088 * sc, 0.260 * sc + oy, oz - 0.022 * sc] },
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [ox - 0.088 * sc, 0.260 * sc + oy, oz - 0.022 * sc], b: [ox - 0.102 * sc, 0.210 * sc + oy, oz - 0.044 * sc], rTop: 0.022 * sc, rBot: 0.018 * sc, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'skin', r: 0.026 * sc, sw: 9, sh: 7, pos: [ox - 0.104 * sc, 0.206 * sc + oy, oz - 0.046 * sc] }
        ]
      }
    ]
  };
}

/** 操作兵 spec 工厂（C `soldierL`/`soldierR` 子组）—— 推车/转绞盘姿态。
 *  `group` 决定 grouping 目标（`soldierL` 或 `soldierR`）。数值逐点等于内联
 *  （`sc = s||0.85`、`mx = mirrorX||1`、`legH = 0.038*sc`）。无武器 → 全量 spec。 */
export function cannonSoldierSpec(group: string, ox: number, oy: number, s: number, mirrorX: number): HumanoidSpec {
  const sc = s || 0.85;
  const mx = mirrorX || 1;
  const legH = 0.038 * sc;
  const anchor: Vec3 = group === 'soldierR' ? [0.25, 0.248, 0.09] : [-0.25, 0.248, 0.09];
  return {
    scale: 1,
    side: 'r',
    pose: 'operate',
    grouping: { legs: group, torso: group, arms: group },
    joints: [
      {
        name: 'legs', semantic: 'hip', parent: 'torso', anchor,
        segments: [
          { role: 'bone', prim: 'strut', material: 'clothDeep', a: [ox - 0.024 * sc * mx, oy + legH + 0.130 * sc, 0], b: [ox - 0.024 * sc * mx, oy + legH + 0.060 * sc, 0], rTop: 0.028 * sc, rBot: 0.024 * sc, seg: 8 },
          { role: 'bone', prim: 'strut', material: 'clothDeep', a: [ox + 0.024 * sc * mx, oy + legH + 0.130 * sc, 0], b: [ox + 0.024 * sc * mx, oy + legH + 0.060 * sc, 0], rTop: 0.028 * sc, rBot: 0.024 * sc, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'clothDeep', r: 0.020 * sc, sw: 8, sh: 6, pos: [ox - 0.024 * sc * mx, oy + legH + 0.060 * sc, 0] },
          { role: 'bone', prim: 'sph', material: 'clothDeep', r: 0.020 * sc, sw: 8, sh: 6, pos: [ox + 0.024 * sc * mx, oy + legH + 0.060 * sc, 0] },
          { role: 'bone', prim: 'strut', material: 'clothDeep', a: [ox - 0.024 * sc * mx, oy + legH + 0.060 * sc, 0], b: [ox - 0.024 * sc * mx, oy + legH + 0.020 * sc, 0], rTop: 0.024 * sc, rBot: 0.020 * sc, seg: 8 },
          { role: 'bone', prim: 'strut', material: 'clothDeep', a: [ox + 0.024 * sc * mx, oy + legH + 0.060 * sc, 0], b: [ox + 0.024 * sc * mx, oy + legH + 0.020 * sc, 0], rTop: 0.024 * sc, rBot: 0.020 * sc, seg: 8 },
          { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.034 * sc, h: 0.022 * sc, d: 0.058 * sc, pos: [ox - 0.024 * sc * mx, oy + 0.011 * sc, -0.016 * sc] },
          { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.034 * sc, h: 0.022 * sc, d: 0.058 * sc, pos: [ox + 0.024 * sc * mx, oy + 0.011 * sc, -0.016 * sc] }
        ]
      },
      {
        name: 'torso', semantic: 'torso', parent: 'idleGroup', anchor,
        segments: [
          { role: 'apparel', prim: 'cyl', material: 'clothDeep', rt: 0.052 * sc, rb: 0.072 * sc, h: 0.140 * sc, seg: 10, pos: [ox, oy + legH + 0.070 * sc, 0] },
          { role: 'apparel', prim: 'tor', material: 'leather', R: 0.072 * sc, t: 0.010 * sc, rs: 4, ts: 10, pos: [ox, oy + legH + 0.138 * sc, 0], rot: [Math.PI / 2, 0, 0] },
          { role: 'bone', prim: 'cyl', material: 'clothDeep', rt: 0.058 * sc, rb: 0.064 * sc, h: 0.050 * sc, seg: 10, pos: [ox, oy + legH + 0.170 * sc, 0.016 * mx] },
          { role: 'apparel', prim: 'cyl', material: 'armorDeep', rt: 0.050 * sc, rb: 0.060 * sc, h: 0.130 * sc, seg: 10, pos: [ox, oy + legH + 0.222 * sc, 0.016 * mx] },
          { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.062 * sc, rb: 0.066 * sc, h: 0.016 * sc, seg: 10, pos: [ox, oy + legH + 0.186 * sc, 0.016 * mx] },
          { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.060 * sc, rb: 0.064 * sc, h: 0.016 * sc, seg: 10, pos: [ox, oy + legH + 0.228 * sc, 0.016 * mx] },
          { role: 'apparel', prim: 'sph', material: 'armorDeep', r: 0.034 * sc, sw: 9, sh: 7, pos: [ox + 0.062 * sc * mx, oy + legH + 0.268 * sc, 0.016 * mx] },
          { role: 'apparel', prim: 'sph', material: 'armorDeep', r: 0.034 * sc, sw: 9, sh: 7, pos: [ox - 0.062 * sc * mx, oy + legH + 0.268 * sc, 0.016 * mx] },
          { role: 'apparel', prim: 'cyl', material: 'accentDim', rt: 0.024 * sc, rb: 0.026 * sc, h: 0.022 * sc, seg: 8, pos: [ox, oy + legH + 0.304 * sc, 0.018 * mx] },
          { role: 'bone', prim: 'cyl', material: 'skin', rt: 0.022 * sc, rb: 0.024 * sc, h: 0.026 * sc, seg: 8, pos: [ox, oy + legH + 0.326 * sc, 0.018 * mx] },
          { role: 'bone', prim: 'sph', material: 'skin', r: 0.040 * sc, sw: 10, sh: 8, pos: [ox, oy + legH + 0.362 * sc, 0.014 * mx] },
          { role: 'apparel', prim: 'cyl', material: 'clothDeep', rt: 0.056 * sc, rb: 0.060 * sc, h: 0.010 * sc, seg: 12, pos: [ox, oy + legH + 0.392 * sc, 0.014 * mx] },
          { role: 'apparel', prim: 'tor', material: 'leather', R: 0.048 * sc, t: 0.007 * sc, rs: 4, ts: 12, pos: [ox, oy + legH + 0.398 * sc, 0.014 * mx], rot: [Math.PI / 2, 0, 0] }
        ]
      },
      {
        name: 'arms', semantic: 'shoulder', parent: 'torso', anchor,
        segments: [
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [ox + 0.058 * sc * mx, oy + legH + 0.264 * sc, 0.016 * mx], b: [ox + 0.084 * sc * mx, oy + legH + 0.244 * sc, -0.020 * sc], rTop: 0.024 * sc, rBot: 0.020 * sc, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'armorDeep', r: 0.020 * sc, sw: 8, sh: 6, pos: [ox + 0.084 * sc * mx, oy + legH + 0.244 * sc, -0.020 * sc] },
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [ox + 0.084 * sc * mx, oy + legH + 0.244 * sc, -0.020 * sc], b: [ox + 0.110 * sc * mx, oy + legH + 0.218 * sc, -0.048 * sc], rTop: 0.020 * sc, rBot: 0.016 * sc, seg: 8 },
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [ox - 0.058 * sc * mx, oy + legH + 0.264 * sc, 0.016 * mx], b: [ox - 0.078 * sc * mx, oy + legH + 0.246 * sc, -0.020 * sc], rTop: 0.024 * sc, rBot: 0.020 * sc, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'armorDeep', r: 0.020 * sc, sw: 8, sh: 6, pos: [ox - 0.078 * sc * mx, oy + legH + 0.246 * sc, -0.020 * sc] },
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [ox - 0.078 * sc * mx, oy + legH + 0.246 * sc, -0.020 * sc], b: [ox - 0.096 * sc * mx, oy + legH + 0.222 * sc, -0.038 * sc], rTop: 0.020 * sc, rBot: 0.016 * sc, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'skin', r: 0.024 * sc, sw: 9, sh: 7, pos: [ox + 0.112 * sc * mx, oy + legH + 0.214 * sc, -0.050 * sc] },
          { role: 'bone', prim: 'sph', material: 'skin', r: 0.024 * sc, sw: 9, sh: 7, pos: [ox - 0.098 * sc * mx, oy + legH + 0.218 * sc, -0.040 * sc] }
        ]
      }
    ]
  };
}

/** 坐姿 spec 工厂（K `body` + `rArm` 子组）—— 主帅端坐。字面量，逐点等于
 *  `buildKing` 的 body 段（`PY(y)=y+FOOT`）+ `buildKingArm` 的右臂段。
 *  **甲裙/鹖冠/佩剑/帅旗/披风/王座一律内联**（不入 spec）。 */
export function kingSpec(): HumanoidSpec {
  const PY = (yPiece: number): number => yPiece + FOOT;
  return {
    scale: 1,
    side: 'r',
    pose: 'sit',
    grouping: { torso: 'body', armR: 'rArm' },
    joints: [
      {
        name: 'torso', semantic: 'torso', parent: 'idleGroup', anchor: [0, 0.378, 0],
        segments: [
          { role: 'apparel', prim: 'sph', material: 'clothDeep', r: 0.088, sw: 10, sh: 8, pos: [0, PY(0.171), 0.010], scale: [1.10, 0.55, 0.85] },
          { role: 'bone', prim: 'strut', material: 'clothDeep', a: [0.045, PY(0.180), 0.000], b: [0.050, PY(0.180), -0.115], rTop: 0.052, rBot: 0.048, seg: 10 },
          { role: 'bone', prim: 'strut', material: 'clothDeep', a: [-0.045, PY(0.180), 0.000], b: [-0.050, PY(0.180), -0.115], rTop: 0.052, rBot: 0.048, seg: 10 },
          { role: 'bone', prim: 'sph', material: 'clothDeep', r: 0.038, sw: 10, sh: 8, pos: [0.050, PY(0.180), -0.115] },
          { role: 'bone', prim: 'sph', material: 'clothDeep', r: 0.038, sw: 10, sh: 8, pos: [-0.050, PY(0.180), -0.115] },
          { role: 'bone', prim: 'strut', material: 'clothDeep', a: [0.050, PY(0.180), -0.115], b: [0.050, PY(0.098), -0.115], rTop: 0.034, rBot: 0.030, seg: 8 },
          { role: 'bone', prim: 'strut', material: 'clothDeep', a: [-0.050, PY(0.180), -0.115], b: [-0.050, PY(0.098), -0.115], rTop: 0.034, rBot: 0.030, seg: 8 },
          { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.060, h: 0.032, d: 0.095, pos: [0.050, PY(0.054), -0.120] },
          { role: 'apparel', prim: 'box', material: 'bootSole', w: 0.060, h: 0.032, d: 0.095, pos: [-0.050, PY(0.054), -0.120] },
          { role: 'bone', prim: 'cyl', material: 'clothDeep', rt: 0.110, rb: 0.118, h: 0.120, seg: 14, pos: [0, PY(0.280), -0.005] },
          { role: 'apparel', prim: 'tor', material: 'accent', R: 0.108, t: 0.014, rs: 5, ts: 16, pos: [0, PY(0.310), 0], rot: [Math.PI / 2, 0, 0] },
          { role: 'bone', prim: 'cyl', material: 'armorDeep', rt: 0.122, rb: 0.132, h: 0.150, seg: 14, pos: [0, PY(0.415), 0.010] },
          { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.138, rb: 0.146, h: 0.022, seg: 14, pos: [0, PY(0.348), 0.010] },
          { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.136, rb: 0.144, h: 0.022, seg: 14, pos: [0, PY(0.392), 0.010] },
          { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.134, rb: 0.142, h: 0.022, seg: 14, pos: [0, PY(0.436), 0.010] },
          { role: 'apparel', prim: 'cyl', material: 'armor', rt: 0.132, rb: 0.140, h: 0.022, seg: 14, pos: [0, PY(0.480), 0.010] },
          { role: 'apparel', prim: 'dome', material: 'armor', r: 0.063, sw: 12, sh: 7, frac: 0.62, pos: [0.142, PY(0.480), 0] },
          { role: 'apparel', prim: 'dome', material: 'armor', r: 0.063, sw: 12, sh: 7, frac: 0.62, pos: [-0.142, PY(0.480), 0] },
          { role: 'apparel', prim: 'box', material: 'accent', w: 0.052, h: 0.040, d: 0.038, pos: [0.168, PY(0.480), -0.020] },
          { role: 'apparel', prim: 'box', material: 'accent', w: 0.052, h: 0.040, d: 0.038, pos: [-0.168, PY(0.480), -0.020] },
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [-0.140, PY(0.480), 0.000], b: [-0.160, PY(0.360), 0.040], rTop: 0.034, rBot: 0.030, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'armorDeep', r: 0.030, sw: 10, sh: 8, pos: [-0.160, PY(0.360), 0.040] },
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [-0.160, PY(0.360), 0.040], b: [-0.160, PY(0.275), 0.020], rTop: 0.030, rBot: 0.026, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'skin', r: 0.030, sw: 10, sh: 8, pos: [-0.160, PY(0.275), 0.020] },
          { role: 'bone', prim: 'cyl', material: 'skin', rt: 0.030, rb: 0.032, h: 0.040, seg: 8, pos: [0, PY(0.520), -0.005] },
          { role: 'bone', prim: 'sph', material: 'skin', r: 0.060, sw: 12, sh: 10, pos: [0, PY(0.580), -0.010] },
          { role: 'apparel', prim: 'strut', material: 'hair', a: [0, PY(0.560), -0.040], b: [0, PY(0.498), -0.020], rTop: 0.026, rBot: 0.008, seg: 6 }
        ]
      },
      {
        name: 'armR', semantic: 'shoulder', parent: 'torso', anchor: [0.140, 0.480, 0.000],
        segments: [
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [0.140, FOOT + 0.480, 0.000], b: [0.160, FOOT + 0.360, 0.040], rTop: 0.034, rBot: 0.030, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'armorDeep', r: 0.030, sw: 10, sh: 8, pos: [0.160, FOOT + 0.360, 0.040] },
          { role: 'bone', prim: 'strut', material: 'armorDeep', a: [0.160, FOOT + 0.360, 0.040], b: [0.160, FOOT + 0.275, 0.020], rTop: 0.030, rBot: 0.026, seg: 8 },
          { role: 'bone', prim: 'sph', material: 'skin', r: 0.030, sw: 10, sh: 8, pos: [0.160, FOOT + 0.275, 0.020] }
        ]
      }
    ]
  };
}
