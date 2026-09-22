/**
 * src/render/jointDof.ts —— 关节可动域契约（DP-5 · I3 / I4 / I5）（S1 · M-08c）
 * ------------------------------------------------------------
 * 数据来源：`docs/piece-modeling/09-棋子重建总体规划.md` §7.2「关节可动域规格表」（人形 / 马 / 器械三组）。
 * 角度单位 = rad。
 *
 * **零 three 依赖**（可被 `scripts/check-piece-contract.mjs` 纯 Node import）：
 *   仅 import `./combat/vignette.ts`（其自身零依赖）以派生 I5 缺省姿态。
 *
 * 交付物：
 *   I3 `JOINT_DOF`         —— 逐关节 `{ name,parent,semantic,axisLimits,drivable,consumedBy,isObject3D }`
 *   I3 `JOINT_DOF_JSON`    —— 同一数据的 JSON 快照（供下游「动作重构」直接消费）
 *   I4 `drivableChannels()` —— 由 I3 派生的 `sub.axis` 通道清单（供 `deriveCombatChannels` / 断言复用）
 *   I5 `deriveBindPose(type)` —— 每型静态 rest 姿态（全零 + `VIGNETTE.baseline`），**派生而非手抄**
 *
 * ⚠ I6（pivot 校正清单）需**渲染几何**，进不了纯 Node CI —— 由 `devtools/audit-pieces.mjs`（CDP）产出。
 */

import { VIGNETTE, type VignetteDef } from './combat/vignette.ts';

export interface AxisLimits {
  x?: readonly [number, number];
  y?: readonly [number, number];
  z?: readonly [number, number];
}

export interface JointDof {
  name: string;
  parent: string;
  semantic: string;
  /** 'human' | 'horse' | 'chassis' —— 分组（09 §7.2 三张子表） */
  group: 'human' | 'horse' | 'chassis';
  axisLimits: AxisLimits;
  /** 是否可被动作驱动（有可动域 + 有消费方） */
  drivable: boolean;
  /** 被哪些动作消费（自由文本标签，供人读） */
  consumedBy: string[];
  /** 是否已物化为独立 Object3D（T0/T1 = true；T2 纯变换节点 = false） */
  isObject3D: boolean;
}

const H = (
  name: string, parent: string, semantic: string, axisLimits: AxisLimits,
  consumedBy: string[], isObject3D: boolean
): JointDof => ({ name, parent, semantic, group: 'human', axisLimits, drivable: Object.keys(axisLimits).length > 0 && consumedBy.length > 0, consumedBy, isObject3D });

const HS = (
  name: string, parent: string, semantic: string, axisLimits: AxisLimits, consumedBy: string[]
): JointDof => ({ name, parent, semantic, group: 'horse', axisLimits, drivable: Object.keys(axisLimits).length > 0, consumedBy, isObject3D: true });

const CH = (
  name: string, parent: string, semantic: string, axisLimits: AxisLimits, consumedBy: string[], isObject3D = true
): JointDof => ({ name, parent, semantic, group: 'chassis', axisLimits, drivable: Object.keys(axisLimits).length > 0, consumedBy, isObject3D });

/**
 * I3 · 关节可动域总表（09 §7.2 逐值转录）。
 * 人形 16 关节 + 马匹腿链/颈/头/尾 + 器械（轮/抛臂/机架/配重/车架）。
 */
export const JOINT_DOF: Record<string, JointDof> = {
  // ── 标准人身（§7.2 人形）──
  body: H('body', 'idleGroup', 'torso', { x: [-0.25, 0.35], y: [-0.45, 0.45], z: [-0.20, 0.20] }, ['全部'], true),
  waist: H('waist', 'body', 'waist', { x: [-0.25, 0.25], y: [-0.35, 0.35], z: [-0.18, 0.18] }, ['移动', '吃子', '受击'], true),
  neck: H('neck', 'body', 'neck', { x: [-0.30, 0.30], y: [-0.60, 0.60], z: [-0.25, 0.25] }, ['待机瞭望', '转向', '受击'], true),
  head: H('head', 'neck', 'head', { x: [-0.25, 0.30], y: [-0.50, 0.50], z: [-0.20, 0.20] }, ['待机', '移动', '吃子', '受击'], true),
  armR: H('armR', 'body', 'shoulder', { x: [-1.60, 1.20], y: [-0.50, 0.50], z: [-1.50, 0.20] }, ['全部'], true),
  armL: H('armL', 'body', 'shoulder', { x: [-1.60, 1.20], y: [-0.50, 0.50], z: [-1.50, 0.20] }, ['全部'], true),
  forearmR: H('forearmR', 'armR', 'elbow', { x: [-2.40, 0], y: [-1.20, 1.20] }, ['吃子', '待机按剑', '崩解'], true),
  forearmL: H('forearmL', 'armL', 'elbow', { x: [-2.40, 0], y: [-1.20, 1.20] }, ['吃子', '待机按剑', '崩解'], true),
  handR: H('handR', 'forearmR', 'wrist', { x: [-0.80, 0.80], y: [-1.20, 1.20], z: [-0.60, 0.60] }, ['吃子刃向', '待机'], true),
  handL: H('handL', 'forearmL', 'wrist', { x: [-0.80, 0.80], y: [-1.20, 1.20], z: [-0.60, 0.60] }, ['吃子刃向', '待机'], true),
  legR: H('legR', 'waist', 'hip', { x: [-1.20, 0.70], y: [-0.50, 0.50], z: [-0.50, 0.50] }, ['移动踏步', '受击踉跄'], true),
  legL: H('legL', 'waist', 'hip', { x: [-1.20, 0.70], y: [-0.50, 0.50], z: [-0.50, 0.50] }, ['移动踏步', '受击踉跄'], true),
  shinR: H('shinR', 'legR', 'knee', { x: [-2.30, 0] }, ['移动', '受击跪倒'], true),
  shinL: H('shinL', 'legL', 'knee', { x: [-2.30, 0] }, ['移动', '受击跪倒'], true),
  footR: H('footR', 'shinR', 'ankle', { x: [-0.60, 0.70], z: [-0.30, 0.30] }, ['移动落步'], true),
  footL: H('footL', 'shinL', 'ankle', { x: [-0.60, 0.70], z: [-0.30, 0.30] }, ['移动落步'], true),

  // ★ S2b（M-08d2）：御手头颈独立子组（限位沿用 head；spearman/soldier 头未物化，见 pieceJoints.ts）。
  driverHead: H('driverHead', 'driver', 'head', { x: [-0.25, 0.30], y: [-0.50, 0.50], z: [-0.20, 0.20] }, ['待机', '移动', '吃子', '受击'], true),

  // ── 马匹（§7.2 马匹行）──
  bodyHorse: HS('bodyHorse', 'idleGroup', 'horseBody', { x: [-0.60, 0.60], y: [-0.40, 0.40], z: [-0.35, 0.35] }, ['待机', '移动', '吃子', '崩解']),
  horseNeck: HS('horseNeck', 'bodyHorse', 'horseNeck', { x: [-0.70, 0.50] }, ['待机', '人立']),
  horseHead: HS('horseHead', 'horseNeck', 'horseHead', { x: [-0.50, 0.40] }, ['待机', '受击']),
  tail: HS('tail', 'bodyHorse', 'horseTail', { x: [-0.60, 0.60] }, ['待机']),
  legF: HS('legF', 'bodyHorse', 'horseForeleg', { x: [-1.40, 0.90], z: [-0.30, 0.30] }, ['待机扬蹄', '移动步态', '受击']),
  legB: HS('legB', 'bodyHorse', 'horseHindleg', { x: [-1.10, 0.80] }, ['移动步态', '受击']),
  shin: HS('shin', 'legF', 'horseShin', { x: [-2.40, 0] }, ['移动步态']),
  hoof: HS('hoof', 'shin', 'horseHoof', { x: [-0.90, 1.20] }, ['移动落蹄']),

  // ── 器械（§7.2 器械行）──
  wheel: CH('wheel', 'chassis', 'wheel', { x: [-Math.PI * 2, Math.PI * 8] }, ['移动轮转']),
  throwArm: CH('throwArm', 'chassis', 'throwArm', { z: [-1.20, 0.80] }, ['吃子抛射']),
  trebuchet: CH('trebuchet', 'chassis', 'chassisFrame', { x: [-0.10, 0.10], z: [-0.06, 0.06] }, [], true),
  counterweight: CH('counterweight', 'throwArm', 'counterweight', { x: [-0.40, 0.40], z: [-0.40, 0.40] }, ['抛臂反向耦合']),
  cart: CH('cart', 'chassis', 'cart', { x: [-0.10, 0.10] }, ['移动', '吃子'])
};

/** I3 · JSON 快照（供下游动作重构直接消费；与 `JOINT_DOF` 同源，避免手抄漂移）。 */
export const JOINT_DOF_JSON: string = JSON.stringify(JOINT_DOF, null, 2);

/**
 * I4 · 通道清单：由 I3 派生的 `sub.axis` 可驱动通道表（`Record<joint, axis[]>`）。
 * 供 `deriveCombatChannels` 与契约断言复用（判定粒度 = `sub.axis`，R-Z3）。
 */
export function drivableChannels(): string[] {
  const out: string[] = [];
  for (const j of Object.values(JOINT_DOF)) {
    if (!j.drivable) continue;
    for (const axis of ['x', 'y', 'z'] as const) {
      if (j.axisLimits[axis]) out.push(`${j.name}.${axis}`);
    }
  }
  return out;
}

/**
 * I5 · 缺省姿态（bind pose）：每型静态 rest = 全零 + `VIGNETTE[type].baseline` 的静态基准。
 * **派生而非手抄** —— baseline 一变这里自动跟随。
 * @returns `Record<'sub.axis', number>`（无基准的通道即视为 0，不列出）
 */
export function deriveBindPose(type: string): Record<string, number> {
  const out: Record<string, number> = {};
  const def = (VIGNETTE as Record<string, VignetteDef | undefined>)[type];
  if (def) {
    for (const b of def.baseline) out[`${b.sub}.${b.axis}`] = b.to;
  }
  return out;
}
