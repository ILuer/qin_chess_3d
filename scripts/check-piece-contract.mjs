#!/usr/bin/env node
/**
 * scripts/check-piece-contract.mjs
 * ------------------------------------------------------------
 * S0 护栏（M-08a）· 棋子结构契约的**纯 Node CI 断言**（L1 层，无浏览器 / 无 GPU）。
 * ★ S0.1（M-08a2）：DP-4 派生范围扩到 move ∪ 编排层直写；move 冲突由告警升级为硬断言 ⑦。
 *
 * 运行：`npm run check:contract`（= `node --experimental-strip-types scripts/check-piece-contract.mjs`）
 *
 * 覆盖（09 §10.1）：
 *   ① anchor 一致性：`accessories.SLOT_TABLE[*].anchor ≡ pieceJoints.SUBGROUP_JOINTS[type][subgroups[0]]`（11 槽位/14 子组）
 *   ② 黄金值：搬移前后的关节锚点**逐位相同**（14 槽位子组 + 全表 40 关节）
 *   ③ 父链完整性：父存在于同型 joints，且**无环**
 *   ④ 子组名规范：小驼峰、无下划线、无 `__` 前缀（`__` 为 §7.3 乘员命名预留，本轮不应出现）
 *   ⑤ `PIECE_TOP_Y` 梯度：`P < B < A < N < C < R < K` 严格递增 + 与声明值一致
 *   ⑥ DP-4：`zeroChannels(type) ∩ deriveCombatChannels(type) === ∅`（逐型逐通道）；K 无 `banner.z`
 *   ⑦ DP-4（S0.1 硬门）：`zeroChannels ∩ (move ∪ capture ∪ dissolve ∪ 编排层直写) === ∅`（逐型逐通道）
 *      + move 派生证据（P 的 armL/legL/legR、A 的 arms 已排除出 zeroChannels）；POSE_TABLE.move 三段齐备
 *   ⑧ S1（M-08c）人形抽象契约 I1–I6（DP-5）：
 *      I1 标准骨链 16 关节 + 逐型声明树（父存在 + 无环）；I2 已物化 ⊆ 已声明 + P/A spec 子组集零增减
 *      + spec anchor ≡ SUBGROUP_JOINTS；I3 `JOINT_DOF`（human 16）+ JSON 同源；I4 `drivableChannels` 派生；
 *      I5 `deriveBindPose` ≡ `VIGNETTE.baseline`。I6（pivot 校正）需渲染几何 → 不在 CI。
 *
 * ⚠ 绝不 import `pieceFactory.ts`（three 走 vendor 别名，纯 Node 下 `Cannot find package 'three'`）。
 *   本脚本仅 import **传递零依赖**的模块（pieceJoints / accessories / CombatConstants / humanoid /
 *   jointDof / vignette）。
 *
 * 任一断言失败 → 打印中文期望/实际并 `process.exit(1)`。
 */

import { SUBGROUP_JOINTS, SUBGROUP_PARENTS, PIECE_TOP_Y } from '../src/render/pieceJoints.ts';
import { SLOT_TABLE } from '../src/render/accessories.ts';
import {
  deriveCombatChannels, deriveZeroChannels, POSE_TABLE,
  DISSOLVE_POSE, CHOREO_WRITE_CHANNELS
} from '../src/render/combat/CombatConstants.ts';
// ★ S1（M-08c）：人形抽象接口契约（DP-5 · I1–I5）的数据源，全部零依赖、可纯 Node import。
import {
  HUMAN_RIG_STD, RIG_TIER, RIG_SEMANTIC, HUMAN_RIG_TREE, POSE_PRESETS,
  PAWN_SPEC, ADVISOR_SPEC, FOOT as HUMANOID_FOOT
} from '../src/render/humanoid.ts';
import { JOINT_DOF, JOINT_DOF_JSON, drivableChannels, deriveBindPose } from '../src/render/jointDof.ts';
import { VIGNETTE } from '../src/render/combat/vignette.ts';

const TYPES = ['P', 'A', 'B', 'N', 'R', 'C', 'K'];

let pass = 0;
const fails = [];
const warns = [];

function chk(cond, msg) {
  if (cond) { pass++; return true; }
  fails.push(msg);
  return false;
}
function section(t) { console.log(`\n── ${t} ──`); }
const j = (v) => JSON.stringify(v);

/* ═══════════════════════════════════════════════════════════════
 * ① anchor 一致性（11 槽位 / 14 子组）
 * ═══════════════════════════════════════════════════════════════ */
section('① anchor 一致性（SLOT_TABLE.anchor ≡ SUBGROUP_JOINTS）');
let slotCount = 0;
const seenSubgroups = new Set();
for (const type of Object.keys(SLOT_TABLE)) {
  const joints = SUBGROUP_JOINTS[type];
  chk(!!joints, `[①] ${type}: SUBGROUP_JOINTS 缺少该型`);
  for (const slot of Object.keys(SLOT_TABLE[type])) {
    const spec = SLOT_TABLE[type][slot];
    slotCount++;
    const sg0 = spec.subgroups[0];
    const want = joints && joints[sg0];
    chk(JSON.stringify(spec.anchor) === JSON.stringify(want),
      `[①] ${type}.${slot}: anchor=${j(spec.anchor)} ≠ SUBGROUP_JOINTS.${type}.${sg0}=${j(want)}`);
    for (const sg of spec.subgroups) {
      seenSubgroups.add(`${type}.${sg}`);
      chk(!!(joints && joints[sg]), `[①] ${type}.${slot}: 子组 ${sg} 未在 SUBGROUP_JOINTS.${type} 注册`);
    }
  }
}
chk(slotCount === 11, `[①] 槽位数应为 11，实际 ${slotCount}`);
chk(seenSubgroups.size === 14, `[①] 覆盖子组数应为 14，实际 ${seenSubgroups.size}`);
console.log(`  槽位 ${slotCount} 个 / 覆盖子组 ${seenSubgroups.size} 个`);

/* ═══════════════════════════════════════════════════════════════
 * ② 黄金值（M-06 基线，逐位相同）
 * ═══════════════════════════════════════════════════════════════ */
section('② 黄金值（搬移前后逐位相同）');
// 14 个「槽位引用的子组」锚点（任务书要求）
const GOLD_14 = {
  'P.spear': [0.170, 0.440, -0.020], 'P.shield': [-0.176, 0.400, -0.058],
  'A.sword': [0, 0.328, -0.126], 'A.shield': [0, 0.45, -0.20],
  'K.crown': [0, 0.688, 0], 'K.banner': [0.228, 0.394, 0.126], 'K.capeHem': [0, 0.420, -0.010],
  'R.wheelL': [-0.26, 0.330, 0], 'R.wheelR': [0.26, 0.330, 0], 'R.spearman': [-0.050, 0.451, 0.080],
  'C.wheelL': [-0.145, 0.160, 0.000], 'C.wheelR': [0.145, 0.160, 0.000],
  'C.soldierL': [-0.25, 0.248, 0.09], 'C.soldierR': [0.25, 0.248, 0.09]
};
for (const key of Object.keys(GOLD_14)) {
  const [type, sub] = key.split('.');
  const got = SUBGROUP_JOINTS[type] && SUBGROUP_JOINTS[type][sub];
  chk(JSON.stringify(got) === JSON.stringify(GOLD_14[key]),
    `[②] 黄金值漂移 ${key}: 期望 ${j(GOLD_14[key])} 实际 ${j(got)}`);
}
// 全表 40 关节（更强证据：证明整表搬移未改数）
const GOLD_ALL = {
  P: { body: [0, 0.334, 0], armR: [0.096, 0.419, 0], armL: [-0.096, 0.419, 0], legR: [0.055, 0.300, 0], legL: [-0.055, 0.300, 0], shield: [-0.176, 0.400, -0.058], spear: [0.170, 0.440, -0.020] },
  A: { body: [0, 0.334, 0], arms: [0, 0.474, 0], sword: [0, 0.328, -0.126], shield: [0, 0.45, -0.20] },
  N: { bodyHorse: [0, 0.128, 0], legFL: [0.076, 0.214, -0.140], legFR: [-0.076, 0.214, -0.140], legBL: [0.080, 0.214, 0.165], legBR: [-0.080, 0.214, 0.165], rider: [0, 0.328, 0] },
  B: { bodyRobe: [0, 0.368, 0], hem: [0, 0.110, 0], arms: [0, 0.328, -0.10] },
  R: { horses: [0, 0.168, -0.24], body: [0, 0.288, 0.02], driver: [0.050, 0.4465, -0.050], spearman: [-0.050, 0.451, 0.080], wheelL: [-0.26, 0.330, 0], wheelR: [0.26, 0.330, 0] },
  C: { trebuchet: [0, 0.308, 0], cart: [0, 0.041, 0], soldierL: [-0.25, 0.248, 0.09], soldierR: [0.25, 0.248, 0.09], counterweight: [0, 0.182, -0.105], wheelL: [-0.145, 0.160, 0.000], wheelR: [0.145, 0.160, 0.000] },
  K: { body: [0, 0.378, 0], throne: [0, 0.028, 0], crown: [0, 0.688, 0], sword: [0.162, 0.289, -0.018], banner: [0.228, 0.394, 0.126], rArm: [0.140, 0.480, 0.000], capeHem: [0, 0.420, -0.010] }
};
let goldenAllN = 0;
for (const type of Object.keys(GOLD_ALL)) {
  for (const sub of Object.keys(GOLD_ALL[type])) {
    goldenAllN++;
    const got = SUBGROUP_JOINTS[type] && SUBGROUP_JOINTS[type][sub];
    chk(JSON.stringify(got) === JSON.stringify(GOLD_ALL[type][sub]),
      `[②] 全表黄金值漂移 ${type}.${sub}: 期望 ${j(GOLD_ALL[type][sub])} 实际 ${j(got)}`);
  }
}
chk(goldenAllN === 40, `[②] 全表关节数应为 40，实际 ${goldenAllN}`);
// 反向：不得有新增/缺失关节
for (const type of Object.keys(SUBGROUP_JOINTS)) {
  const gotKeys = Object.keys(SUBGROUP_JOINTS[type]).sort();
  const wantKeys = Object.keys(GOLD_ALL[type] || {}).sort();
  chk(gotKeys.join(',') === wantKeys.join(','),
    `[②] ${type} 关节键集合变化：实际 [${gotKeys}] 期望 [${wantKeys}]`);
}
console.log(`  14 槽位子组锚点 + 全表 ${goldenAllN} 关节逐位校验`);

/* ═══════════════════════════════════════════════════════════════
 * ③ 父链完整性（存在 + 无环）
 * ═══════════════════════════════════════════════════════════════ */
section('③ 父链完整性（父存在 + 无环）');
let edgeCount = 0;
const GOLD_PARENTS = { P: { spear: 'armR' } };
chk(JSON.stringify(SUBGROUP_PARENTS) === JSON.stringify(GOLD_PARENTS),
  `[③] SUBGROUP_PARENTS 全集变化：实际 ${j(SUBGROUP_PARENTS)} 期望 ${j(GOLD_PARENTS)}`);
for (const type of Object.keys(SUBGROUP_PARENTS)) {
  const joints = SUBGROUP_JOINTS[type] || {};
  const parents = SUBGROUP_PARENTS[type] || {};
  for (const child of Object.keys(parents)) {
    edgeCount++;
    const parent = parents[child];
    chk(!!joints[child], `[③] ${type}: 子组 ${child} 自身未注册`);
    chk(!!joints[parent], `[③] ${type}.${child}: 父组 ${parent} 不存在于同型 joints`);
  }
  // 无环检测（沿父链走，seen 去重）
  for (const start of Object.keys(parents)) {
    const seen = new Set();
    let cur = start;
    let acyclic = true;
    while (cur && parents[cur]) {
      if (seen.has(cur)) { acyclic = false; break; }
      seen.add(cur);
      cur = parents[cur];
    }
    chk(acyclic, `[③] ${type}: 父链成环，起点 ${start}`);
  }
}
console.log(`  父链 ${edgeCount} 条，父存在 + 无环校验通过`);

/* ═══════════════════════════════════════════════════════════════
 * ④ 子组名规范（小驼峰、无下划线、无 __ 前缀）
 * ═══════════════════════════════════════════════════════════════ */
section('④ 子组名规范（小驼峰 / 无下划线 / 无 __ 前缀）');
const NAME_RE = /^[a-z][A-Za-z0-9]*$/;
let nameN = 0;
for (const type of Object.keys(SUBGROUP_JOINTS)) {
  for (const sub of Object.keys(SUBGROUP_JOINTS[type])) {
    nameN++;
    chk(NAME_RE.test(sub), `[④] ${type}.${sub}: 子组名非小驼峰 / 含非法字符`);
    chk(sub.indexOf('_') < 0, `[④] ${type}.${sub}: 子组名含下划线（禁止）`);
    chk(!sub.startsWith('__'), `[④] ${type}.${sub}: 子组名以 __ 前缀（§7.3 乘员命名预留，本轮不应出现）`);
  }
}
for (const type of Object.keys(SLOT_TABLE)) {
  for (const slot of Object.keys(SLOT_TABLE[type])) {
    for (const sg of SLOT_TABLE[type][slot].subgroups) {
      chk(NAME_RE.test(sg) && sg.indexOf('_') < 0, `[④] 槽位子组名违规 ${type}.${sg}`);
    }
  }
}
console.log(`  子组名 ${nameN} 个合规；零件名 r.* 规范需构建器几何 → 不在本脚本（CI 无 GPU）范围`);

/* ═══════════════════════════════════════════════════════════════
 * ⑤ PIECE_TOP_Y 梯度（严格递增 + 与声明一致）
 * ═══════════════════════════════════════════════════════════════ */
section('⑤ PIECE_TOP_Y 梯度（P<B<A<N<C<R<K）');
const GOLD_TOP_Y = { P: 0.70, N: 0.86, B: 0.74, A: 0.79, R: 0.99, C: 0.90, K: 1.00 };
for (const type of Object.keys(GOLD_TOP_Y)) {
  chk(PIECE_TOP_Y[type] === GOLD_TOP_Y[type],
    `[⑤] PIECE_TOP_Y.${type} 漂移：期望 ${GOLD_TOP_Y[type]} 实际 ${PIECE_TOP_Y[type]}`);
}
const order = ['P', 'B', 'A', 'N', 'C', 'R', 'K'];
for (let i = 1; i < order.length; i++) {
  const a = PIECE_TOP_Y[order[i - 1]];
  const b = PIECE_TOP_Y[order[i]];
  chk(typeof a === 'number' && typeof b === 'number' && a < b,
    `[⑤] 梯度断裂：${order[i - 1]}(${a}) 应 < ${order[i]}(${b})`);
}
console.log(`  梯度 ${order.map((t) => `${t}=${PIECE_TOP_Y[t]}`).join(' < ')}`);

/* ═══════════════════════════════════════════════════════════════
 * ⑥ DP-4 · zeroChannels 派生 + 战斗通道避让
 * ═══════════════════════════════════════════════════════════════ */
section('⑥ DP-4 · zeroChannels ∩ 战斗通道 = ∅（逐型逐通道）');
// S0.1 后 zeroChannels 期望值（集合，排序）。
const GOLD_ZERO = {
  P: ['armR.z', 'body.x', 'body.y'],           // ★ S0.1：剔除 move 驱动的 armL.x / legL.x / legR.x
  A: ['body.y', 'body.z'],                     // ★ S0.1：剔除 move 驱动的 arms.x（body.y 为 S0 修复项）
  B: ['arms.x'],
  N: ['bodyHorse.y', 'legFL.x'],
  R: ['body.x', 'spearman.y', 'spearman.z'],
  C: [],
  K: ['body.x', 'rArm.x']                       // S0：剔除越界的 banner.z
};
// S0.1 前（= S0 派生值）基线，用于登记 S0.1 的差异
const PRE_S0_1 = {
  P: ['armL.x', 'armR.z', 'body.x', 'body.y', 'legL.x', 'legR.x'],
  A: ['arms.x', 'body.y', 'body.z'],
  B: ['arms.x'],
  N: ['bodyHorse.y', 'legFL.x'],
  R: ['body.x', 'spearman.y', 'spearman.z'],
  C: [],
  K: ['body.x', 'rArm.x']
};
// S0 前「手抄表」基线（历史），仅用于 S0 差异登记（A +body.y / K −banner.z）
const PRE_S0_HAND = {
  P: ['armL.x', 'armR.z', 'body.x', 'body.y', 'legL.x', 'legR.x'],
  A: ['arms.x', 'body.z'],
  B: ['arms.x'],
  N: ['bodyHorse.y', 'legFL.x'],
  R: ['body.x', 'spearman.y', 'spearman.z'],
  C: [],
  K: ['body.x', 'banner.z', 'rArm.x']
};
const sortJoin = (a) => [...a].sort().join(',');
const diffOf = (a, b) => {
  const d = [];
  for (const ch of new Set([...a, ...b])) {
    const ia = a.includes(ch), ib = b.includes(ch);
    if (ia && !ib) d.push(`+${ch}`);
    if (!ia && ib) d.push(`-${ch}`);
  }
  return d;
};
for (const type of TYPES) {
  const zero = deriveZeroChannels(type);
  const combat = deriveCombatChannels(type);
  // ① 核心避让断言（R-Z2）
  for (const ch of zero) {
    chk(!combat.has(ch), `[⑥] ${type}: zeroChannels 含战斗通道 ${ch}（违反 R-Z2）`);
  }
  // ② 期望值（严格 pin，不放宽）
  chk(sortJoin(zero) === sortJoin(GOLD_ZERO[type]),
    `[⑥] ${type}.zeroChannels 派生值异常：实际 ${j([...zero].sort())} 期望 ${j([...GOLD_ZERO[type]].sort())}`);
  // ③ 登记：S0.1 差异（相对 S0 派生值）
  const d1 = diffOf(zero, PRE_S0_1[type]);
  if (d1.length) warns.push(`[⑥-登记 S0.1] ${type}.zeroChannels：${d1.join(' ')}`);
  // ④ 登记：S0 差异（相对 S0 前手抄表）
  const d0 = diffOf(zero, PRE_S0_HAND[type]);
  if (d0.length) warns.push(`[⑥-登记 S0] ${type}.zeroChannels：${d0.join(' ')}`);
}
// K 不含 banner.z
chk(!deriveZeroChannels('K').includes('banner.z'), `[⑥] K.zeroChannels 仍含 banner.z（DP-4 未修）`);
chk(deriveCombatChannels('K').has('banner.z'), `[⑥] K 战斗通道集应含 banner.z（POSE_TABLE.K 四态均驱动）`);
// POSE_TABLE 完整性：7 型均有 capture + move 三段（保证 PieceChoreography switch 回退不可达）
for (const type of TYPES) {
  const cap = POSE_TABLE[type] && POSE_TABLE[type].capture;
  const mv = POSE_TABLE[type] && POSE_TABLE[type].move;
  chk(!!(cap && cap.anticipation && cap.action && cap.recovery),
    `[⑥] POSE_TABLE.${type}.capture 三段不完整（PieceChoreography 回退分支将被触发）`);
  chk(!!(mv && mv.anticipation && mv.action && mv.recovery),
    `[⑥] POSE_TABLE.${type}.move 三段不完整（PieceChoreography 移动回退分支将被触发）`);
}
console.log('  ' + TYPES.map((t) => `${t}=[${[...deriveZeroChannels(t)].sort().join(' ')}]`).join('\n  '));

/* ═══════════════════════════════════════════════════════════════
 * ⑦ DP-4（S0.1 硬门）· move ∪ capture ∪ dissolve ∪ 编排层直写 与 zeroChannels 不相交
 *   —— 取代 S0 的「move 冲突仅告警」；根因已修，不再有信息性豁免。
 * ═══════════════════════════════════════════════════════════════ */
section('⑦ DP-4（S0.1）· zeroChannels ∩ (move ∪ capture ∪ dissolve ∪ 编排层直写) = ∅');
const normCh = (c) => { const p = String(c).split('.'); return p.length === 3 ? `${p[0]}.${p[2]}` : String(c); };
const combatSources = (type) => {
  const rhs = new Set();
  const entry = POSE_TABLE[type];
  for (const state of ['move', 'capture']) {
    const st = entry && entry[state];
    if (!st) continue;
    for (const stage of ['anticipation', 'action', 'recovery']) {
      const seg = st[stage];
      if (seg && Array.isArray(seg.channels)) for (const c of seg.channels) rhs.add(normCh(c));
    }
  }
  const sga = DISSOLVE_POSE[type] && DISSOLVE_POSE[type].subGroupActions;
  if (sga) for (const sub of Object.keys(sga)) {
    const a = sga[sub];
    if (a && a.rotX !== undefined) rhs.add(`${sub}.x`);
    if (a && a.rotZ !== undefined) rhs.add(`${sub}.z`);
  }
  for (const c of (CHOREO_WRITE_CHANNELS[type] || [])) rhs.add(normCh(c));
  return rhs;
};
for (const type of TYPES) {
  const zero = new Set(deriveZeroChannels(type));
  for (const ch of combatSources(type)) {
    chk(!zero.has(ch), `[⑦] ${type}: zeroChannels 含战斗/编排通道 ${ch}（违反 R-Z2 硬门）`);
  }
}
// S0.1 修复证据：P 的移动左臂/双腿、A 的移动摆臂 已排除出 zeroChannels
for (const ch of ['armL.x', 'legR.x', 'legL.x']) {
  chk(!deriveZeroChannels('P').includes(ch), `[⑦] P.zeroChannels 仍含 move 通道 ${ch}（S0.1 未修）`);
  chk(deriveCombatChannels('P').has(ch), `[⑦] P 战斗通道集应含 move 通道 ${ch}`);
}
chk(!deriveZeroChannels('A').includes('arms.x'), `[⑦] A.zeroChannels 仍含 move 通道 arms.x（S0.1 未修）`);
chk(deriveCombatChannels('A').has('arms.x'), `[⑦] A 战斗通道集应含 move 通道 arms.x`);
// 编排层直写覆盖证据（C 炮 executeCannon counterweight.z 此前完全遗漏）
chk(deriveCombatChannels('C').has('counterweight.z'), `[⑦] C 战斗通道集应含编排层直写 counterweight.z`);
chk(deriveCombatChannels('C').has('cart.x'), `[⑦] C 战斗通道集应含编排层直写 cart.x`);
// S0.1 只应改 P/A：其余 5 型与 S0 派生值逐项相同
for (const type of ['B', 'N', 'R', 'C', 'K']) {
  chk(sortJoin(deriveZeroChannels(type)) === sortJoin(PRE_S0_1[type]),
    `[⑦] ${type}.zeroChannels 发生预期外变化（S0.1 只应改 P/A）：实际 ${j([...deriveZeroChannels(type)].sort())}`);
}
console.log('  ' + TYPES.map((t) => `${t}=[${[...deriveZeroChannels(t)].sort().join(' ')}]`).join('\n  '));

/* ═══════════════════════════════════════════════════════════════
 * ℹ 登记（信息性，不判失败）
 * ═══════════════════════════════════════════════════════════════ */
section('ℹ 登记（信息性，不判失败）');
if (warns.length) { for (const w of warns) console.log('  ' + w); } else { console.log('  无 zeroChannels 差异。'); }
// S0.1 发现：POSE_TABLE.N.move 未声明四腿 —— 与「声明通道」漂移（未处置，登记待 S1+）
const nMoveChs = (() => {
  const s = new Set();
  const mv = POSE_TABLE.N && POSE_TABLE.N.move;
  if (mv) for (const stage of ['anticipation', 'action', 'recovery']) {
    const seg = mv[stage];
    if (seg && Array.isArray(seg.channels)) for (const c of seg.channels) s.add(normCh(c));
  }
  return s;
})();
const N_LEG_DECLARED = ['legFL.x', 'legFR.x', 'legBL.x', 'legBR.x'];
const nDrift = N_LEG_DECLARED.filter((c) => !nMoveChs.has(c));
console.log('  ⚠ S0.1 发现（登记待 S1+）：POSE_TABLE.N.move 未声明四腿通道 ' + nDrift.join('/'));
console.log('     —— PieceChoreography.moveFlourish[N] 的 switch 回退 + resetMovePose 声明了它们，');
console.log('        但回退分支在 POSE_TABLE 齐备时不可达（死代码）→ Sprint-3「四腿 trot」实为未生效。');
console.log('        CHOREO_WRITE_CHANNELS 刻意不收录，以免把 N.legFL.x 挤出 zeroChannels（冻结抬腿）。');

/* ═══════════════════════════════════════════════════════════════
 * ⑧ S1（M-08c）· 人形抽象接口契约 I1–I6（DP-5）
 *   I1 关节命名表 / 父子链（声明式完整骨架树）
 *   I2 已物化 ⊆ 已声明 + spec 锚点 ≡ SUBGROUP_JOINTS
 *   I3 关节可动域总表（JOINT_DOF + JSON 快照）
 *   I4 可驱动通道清单（由 I3 派生）
 *   I5 缺省姿态（派生自 VIGNETTE.baseline）
 *   I6 pivot 校正清单（需渲染几何 → 不在 CI）
 * ═══════════════════════════════════════════════════════════════ */
section('⑧ S1 人形抽象契约 I1–I6（DP-5）');
const RIG_ROOT = 'idleGroup';

// ── I1 · 关节命名表 + 父子链 ──
const stdNames = Object.keys(HUMAN_RIG_STD);
chk(stdNames.length === 16, `[⑧-I1] HUMAN_RIG_STD 应为 16 关节，实际 ${stdNames.length}`);
for (const n of stdNames) {
  const p = HUMAN_RIG_STD[n];
  chk(p === RIG_ROOT || stdNames.includes(p), `[⑧-I1] ${n} 的父 ${p} 不在标准表且非根`);
  chk(!!RIG_TIER[n], `[⑧-I1] ${n} 缺 RIG_TIER`);
  chk(!!RIG_SEMANTIC[n], `[⑧-I1] ${n} 缺 RIG_SEMANTIC`);
  chk(['T0', 'T1', 'T2', 'attach'].includes(RIG_TIER[n]), `[⑧-I1] ${n} tier 非法：${RIG_TIER[n]}`);
}
for (const start of stdNames) {
  const seen = new Set(); let cur = start; let ok = true;
  while (cur && cur !== RIG_ROOT) {
    if (seen.has(cur)) { ok = false; break; }
    seen.add(cur); cur = HUMAN_RIG_STD[cur];
  }
  chk(ok, `[⑧-I1] 标准骨链成环，起点 ${start}`);
}
for (const type of Object.keys(HUMAN_RIG_TREE)) {
  const tree = HUMAN_RIG_TREE[type];
  const names = Object.keys(tree);
  for (const n of stdNames) chk(names.includes(n), `[⑧-I1] ${type} 声明树缺标准关节 ${n}`);
  for (const n of names) {
    const p = tree[n];
    chk(p === RIG_ROOT || names.includes(p), `[⑧-I1] ${type}.${n} 父 ${p} 未声明`);
  }
}
chk(!!HUMAN_RIG_TREE.P && !!HUMAN_RIG_TREE.A, '[⑧-I1] HUMAN_RIG_TREE 应含 P/A');
console.log(`  标准骨链 ${stdNames.length} 关节；声明树 P=${Object.keys(HUMAN_RIG_TREE.P).length} A=${Object.keys(HUMAN_RIG_TREE.A).length}`);

// ── I2 · 已物化 ⊆ 已声明 + spec 锚点 ≡ SUBGROUP_JOINTS ──
const SPECS = { P: PAWN_SPEC, A: ADVISOR_SPEC };
for (const type of Object.keys(SPECS)) {
  const tree = HUMAN_RIG_TREE[type];
  chk(!!tree, `[⑧-I2] ${type} 无声明树`);
  const materialized = Object.keys(SUBGROUP_JOINTS[type] || {});
  for (const sg of materialized) chk(!!(tree && tree[sg]), `[⑧-I2] ${type}.${sg} 已物化但未在声明树`);
  const spec = SPECS[type];
  const jointNames = spec.joints.map((jt) => jt.name);
  chk(sortJoin(jointNames) === sortJoin(Object.keys(spec.grouping)), `[⑧-I2] ${type} grouping 键与 joints 名不一致`);
  const targetGroups = new Set(jointNames.map((n) => spec.grouping[n] || n));
  chk(sortJoin([...targetGroups]) === sortJoin(materialized),
    `[⑧-I2] ${type} spec 子组集 [${[...targetGroups]}] ≠ 物化 [${materialized}]（S1 零子组增减）`);
  for (const jt of spec.joints) {
    const g = spec.grouping[jt.name] || jt.name;
    const want = SUBGROUP_JOINTS[type][g];
    chk(JSON.stringify(jt.anchor) === JSON.stringify(want),
      `[⑧-I2] ${type}.${jt.name} anchor=${j(jt.anchor)} ≠ joint.${g}=${j(want)}`);
  }
}
chk(HUMANOID_FOOT === 0.086, `[⑧-I2] humanoid.FOOT 漂移：${HUMANOID_FOOT}（应 0.086 = pieceFactory.FOOT）`);
console.log('  I2：P/A spec 子组集 = 物化子组集（零增减）；anchor 逐项 ≡ SUBGROUP_JOINTS');

// ── I3 · 关节可动域总表 + JSON 快照 ──
const dofNames = Object.keys(JOINT_DOF);
const dofHuman = dofNames.filter((n) => JOINT_DOF[n].group === 'human');
chk(dofHuman.length === 16, `[⑧-I3] JOINT_DOF human 组应 16，实际 ${dofHuman.length}`);
for (const n of dofNames) {
  const d = JOINT_DOF[n];
  chk(d.name === n, `[⑧-I3] ${n} name 字段不一致`);
  chk(typeof d.parent === 'string' && d.parent.length > 0, `[⑧-I3] ${n} 缺 parent`);
  chk(typeof d.isObject3D === 'boolean' && typeof d.drivable === 'boolean', `[⑧-I3] ${n} 布尔字段缺失`);
  for (const ax of Object.keys(d.axisLimits || {})) {
    chk(['x', 'y', 'z'].includes(ax), `[⑧-I3] ${n} 非法轴 ${ax}`);
    const lim = d.axisLimits[ax];
    chk(Array.isArray(lim) && lim.length === 2 && lim[0] <= lim[1], `[⑧-I3] ${n}.${ax} 限位非法 ${j(lim)}`);
  }
}
chk(JSON.stringify(JSON.parse(JOINT_DOF_JSON)) === JSON.stringify(JOINT_DOF), '[⑧-I3] JOINT_DOF_JSON 与 JOINT_DOF 不同源');
console.log(`  I3：JOINT_DOF ${dofNames.length} 关节（human ${dofHuman.length} / horse ${dofNames.filter((n) => JOINT_DOF[n].group === 'horse').length} / chassis ${dofNames.filter((n) => JOINT_DOF[n].group === 'chassis').length}）`);

// ── I4 · 可驱动通道清单（由 I3 派生）──
const chans = drivableChannels();
chk(Array.isArray(chans) && chans.length > 0, '[⑧-I4] drivableChannels 为空');
const allChanSet = new Set();
for (const n of dofNames) for (const ax of Object.keys(JOINT_DOF[n].axisLimits || {})) allChanSet.add(`${n}.${ax}`);
for (const c of chans) {
  chk(/^[A-Za-z][A-Za-z0-9]*\.(x|y|z)$/.test(c), `[⑧-I4] 通道格式非法：${c}`);
  chk(allChanSet.has(c), `[⑧-I4] 通道 ${c} 不在 axisLimits 并集`);
}
console.log(`  I4：可驱动通道 ${chans.length} 条（格式合法且 ⊆ axisLimits 并集 ${allChanSet.size} 条）`);

// ── I5 · 缺省姿态（派生自 VIGNETTE.baseline）──
for (const type of TYPES) {
  const bp = deriveBindPose(type);
  const def = VIGNETTE[type];
  const want = {};
  if (def && Array.isArray(def.baseline)) for (const b of def.baseline) want[`${b.sub}.${b.axis}`] = b.to;
  chk(JSON.stringify(bp) === JSON.stringify(want), `[⑧-I5] ${type} bindPose ≠ VIGNETTE.baseline：${j(bp)} vs ${j(want)}`);
}
for (const pn of ['stand', 'walk', 'ride', 'sit', 'operate']) chk(!!POSE_PRESETS[pn], `[⑧-I5] POSE_PRESETS 缺 ${pn}`);
console.log('  I5：7 型 bindPose 派生自 VIGNETTE.baseline；5 个姿态预设齐备');

// ── I6 · pivot 校正清单（需渲染几何 → 不在 CI）──
console.log('  I6：pivot 校正需渲染几何（GPU/CDP）→ 不在本 CI；基线由 devtools/audit-pieces.mjs（_m06-audit.json）承担，');

/* ═══════════════════════════════════════════════════════════════
 * 汇总
 * ═══════════════════════════════════════════════════════════════ */
console.log('\n════════════════════════════════════════════');
if (fails.length) {
  console.log(`✗ check-piece-contract 失败：${fails.length} 项（通过 ${pass} 项）`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`✓ check-piece-contract 通过：${pass} 项断言全绿`);
console.log(`  锚点 ${slotCount} 槽位/${seenSubgroups.size} 子组 · 关节 ${goldenAllN} 个 · 父链 ${edgeCount} 条 · 子组名 ${nameN} 个`);
console.log(`  zeroChannels：${TYPES.map((t) => t + '=' + deriveZeroChannels(t).length).join(' ')}（S0.1：P/A 已剔除 move 通道；K 已剔除 banner.z）`);
console.log(`  S1 人形契约：I1 骨链 ${stdNames.length} · I2 物化⊆声明（P/A）· I3 DOF ${dofNames.length} · I4 通道 ${chans.length} · I5 bindPose 7 型 · I6 见 audit-pieces`);
