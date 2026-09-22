/**
 * CombatConstants.js — 战场演出参数表（纯数据模块）
 *
 * 所有数值的唯一真相源。来源：
 *   docs/design/action-system.md §2 §3 §4
 *   docs/design/combat-feel-spec.md §5 §6
 *   docs/design/audio-system-v2.md §2.2
 *
 * 此文件零依赖，被所有 combat/ 模块 import。
 */

import { PT, PALETTE } from '../../core/constants.ts';
import { VIGNETTE, writtenChannels, type VignetteDef } from './vignette.ts';
// ★ S0 护栏（M-08a · DP-4）：关节 SSOT（零依赖）—— 供 zeroChannels 派生时判定
//   「该通道所属子组是否已注册」。本文件（经 core/constants.ts + vignette.ts）保持
//   **传递零依赖**（无 three），故可被 `scripts/check-piece-contract.mjs` 在纯 Node 下 import。
import { SUBGROUP_JOINTS } from '../pieceJoints.ts';

// ═══════════════════════════════════════════════════════════════
// §0 性能预算常量
// ═══════════════════════════════════════════════════════════════

/**
 * 全盘 draw call 预算上限（Phase D4 / 验收 V8）。
 *
 * ★ M-06 重立（2026-09-21，**由纸面值改为实测基线**）：
 *   旧值 155 出自 docs/design/piece-animation-spec.md §5.2，早于 M-03 的「子组重构 +
 *   配件白名单（ADR-α）」—— 该白名单以「+~60 dc 换金属高光」为代价，155 已与现状脱节。
 *   现按**真实游戏场景实测基线**重立：
 *     M-03(5abc72e) 239 → M-05(de70082) 279 → **M-06 = 271**（车轮白名单回退回收 8 dc）。
 *   口径：GL 层 draw* 计数与 renderer.info.render.calls 双路，取默认开局相机稳态中位数。
 *
 * 防劣化机制（CI 不可行 — 项目 CI 仅 npm ci + typecheck + build，**无浏览器/GPU**，
 *   直接测 draw call 不可行；且包体红线禁新增依赖、禁 PROD 产物变大）：
 *     - 本常量 + DRAW_CALL_BUDGET_META 为唯一真相源（纯数据，未被运行时代码 import，
 *       bundle 里被 tree-shake → **零 PROD 产物体积**）；
 *     - 判定入口 drawCallBudgetVerdict() 供 devtools/game-dc-probe.mjs 复跑比对；
 *     - 发布前人工闸门：`node devtools/game-dc-probe.mjs`（复用真实 index.html）→ 与
 *       DRAW_CALL_BUDGET 比对，超阈值即失败并在验收报告登记（见 08 文档 §③）。
 *   ⚠ 未选「dev 档运行时 console.warn」：无 build define 可用，强行内联会在 PROD 增字节，
 *     违反红线，故降级为「零体积的常量+判定入口 + 人工探针闸门」。
 */
export const DRAW_CALL_BUDGET = 310;

/** draw call 预算的实测溯源元数据（纯数据，供探针/报告引用；不参与运行时逻辑）。
 *  ★ S2b（M-08d2 · 2026-09-22）：head 物化 +28 dc（271→299）；step2 A.arms→armR/armL +4（→303）。
 *  ★ S2b-step3：P/A/K.forearmR 持械臂肘 +16 dc（P 10 枚 + A 4 枚 + K 2 枚，各 ×+1 mesh）。
 *  ★ S2b-step4：关节链建齐 —— B.forearmR/L + R.crew(spearmanHead/spearmanForearmR)
 *    + C.crew(soldierL/RHead) +24 dc（B 4 枚×+2、R 4 枚×+2、C 4 枚×+2；pieceMeshes 322，
 *    infoTris 110786 不变 = 几何零改动，纯子组拆分）。
 *  ★ **用户裁定（2026-09-22）：真实战场效果优先，dc 优化后置** —— 上限 310→330 放行
 *  效果路线（S3 器械/S4 马腿照此推进）；S5 低模收口（删隐藏件/收编回收池 −36）时再回收。
 *  step4 实测 343 超 330 → 常量对齐实测基线 343，budgetCap 330→350（待用户追认）。 */
export const DRAW_CALL_BUDGET_META = {
  unit: 'GL draw* calls / 帧（真实游戏场景，默认开局相机，稳态中位数）',
  baseline: 343,
  budgetCap: 350,
  measuredAt: '2026-09-22',
  measuredBy: 'devtools/game-dc-probe.mjs（CDP 注入真实 index.html，非合成子场景；⚠ 探针已补 Network.setBypassServiceWorker —— 游戏 sw.js 会用缓存旧 bundle 污染实测）',
  commit: 'M-08d2 S2b-step4 (62df7bac→)',
  history: { m03: 239, m05: 279, m06: 271, s2b: 299, s2b2: 303, s2b3: 319, s2b4: 343 },
  accounting: '271 + 28（head 物化） + 4（A.arms→armR/armL） + 16（P/A/K.forearmR） + 24（B.forearmR/L、R.crew head/肘、C.crew head ×4 枚各 +2；pieceMeshes 322，infoTris 110786 不变）',
  headroom: '低模 LOD 未启用；满盘 32 枚全部入视锥 → 该值为上界。'
} as const;

/**
 * draw call 预算单一判定入口（纯函数、无副作用）。
 * @param calls 实测 GL draw* 帧计数（或 renderer.info.render.calls）
 * @returns ok=false 表示超预算（over>0）
 */
export function drawCallBudgetVerdict(calls: number): { calls: number; budget: number; ok: boolean; over: number; ratio: number } {
  const over = calls - DRAW_CALL_BUDGET;
  return {
    calls, budget: DRAW_CALL_BUDGET, ok: over <= 0, over,
    ratio: DRAW_CALL_BUDGET > 0 ? calls / DRAW_CALL_BUDGET : 0
  };
}

// ═══════════════════════════════════════════════════════════════
// §0.5 全局速度可调框架（Sprint 1：决策 2 + 5 的钩子）
// ═══════════════════════════════════════════════════════════════
//
// 设计意图（用户拍板）：
//   - 决策 2：所有棋子的所有动作时长均可调。核心第一优先级 = 战场真实效果（非节奏整齐）。
//   - 决策 5：速度按兵种特性（马/车快、炮慢、其余稳重），且考虑距离——
//             不同距离动作时长按现实距离调（远距覆盖更长时间）。
//
// 正交性纪律（务必遵守，避免回归）：
//   - 本框架是「beat 时长缩放系数」——作用于 MOVE_TOTAL / CAPTURE_TOTAL 的预计算值。
//   - animator.update 的 `timeScale`（headless 下被置 0、探针强制 1）是「dt 缩放」，
//     二者在动画推进上是**相乘**关系（timeScale×本系数），互不冲突。
//   - AI_SPEED_MUL 仍作为独立因子在 MoveAction/CaptureAction 里与本系数**相乘**（见各 Action）。
//   - hitstop 逻辑完全不被本框架触碰（冻结的是 dt 流，不是 beat 时长）。

/**
 * 全局速度系数。1 = 基准；<1 更慢更真实；>1 更快。
 * 单一总闸，调它即可全局统一加速/减速，无需改逐兵种表。
 */
export const ANIM_SPEED = 1.0;

/**
 * 各兵种速度系数初值（决策 5）。
 * 键 = PT 单字符。马/车快、炮慢（推着走）、兵/卒/相/象/仕/士/将/帅稳重。
 *   P=1.0（兵/卒，稳重）   N=1.1（马，快）
 *   B=0.9（象/相，文官迟缓） A=1.0（士/仕，稳重）
 *   R=0.95（车，略快但车体重） C=0.9（炮，推着走最慢）
 *   K=0.85（将/帅，最稳重 —— 决策 5 用户给的初值）
 * 数值越大 = 动作越快（时长越短）。
 */
export const SPEED_MUL: Record<string, number> = {
  P: 1.0, N: 1.1, B: 0.9, A: 1.0, R: 0.95, C: 0.9, K: 0.85
};

/** 远距时长增长系数上限（封顶 1.8，防止跨全盘移动时长爆炸） */
export const DIST_SCALE_CAP = 1.8;

/**
 * 距离因子 → 时长缩放系数（distScale）。
 * 现实：速度恒定则时长 ∝ 距离；远距（≥4 格）需要更长时间覆盖。
 * 映射：近距(1 格)略快（distScale=1），远距线性增长，封顶 DIST_SCALE_CAP。
 *   distScale = clamp(1 + (distanceFactor - 1) * 0.12, 1, DIST_SCALE_CAP)
 * @param {number} distanceFactor  移动格数（曼哈顿或直线，1~N），由 cellDistance 计算
 * @returns {number}
 */
export function distScaleFor(distanceFactor: number): number {
  const df = Math.max(1, distanceFactor);
  const raw = 1 + (df - 1) * 0.12;
  return Math.max(1, Math.min(DIST_SCALE_CAP, raw));
}

/**
 * 把「兵种 + 距离」折算成一个**总速度系数**（与 MOVE_TOTAL/CAPTURE_TOTAL 相除即得到实际时长）。
 * = ANIM_SPEED × SPEED_MUL[pt] × distScale。
 * 未知兵种回退 SPEED_MUL.P / distScale=1。
 * @param {string} pt   PT 单字符（'P'|'N'|'B'|'A'|'R'|'C'|'K'）
 * @param {number} distanceFactor  移动格数（1~N）
 * @returns {number}
 */
export function perTypeSpeedMul(pt: string, distanceFactor = 1): number {
  const base = SPEED_MUL[pt] ?? SPEED_MUL.P ?? 1.0;
  return ANIM_SPEED * base * distScaleFor(distanceFactor);
}

/**
 * 不含距离的「兵种速度系数」（仅 ANIM_SPEED × SPEED_MUL[pt]）。
 * 供 MoveAction / CaptureAction 逐拍时长缩放用：beat 时长 = 原拍长 / beatSpeedMul(pt) × distScale(df)。
 * 与 perTypeSpeedMul 的区别：本函数不含距离因子，距离增长由调用方单独 × distScaleFor(df) 实现，
 * 以保证「远距时长更长」（决策 5 物理真实：远距需要更长时间覆盖）。
 */
export function beatSpeedMul(pt: string): number {
  const base = SPEED_MUL[pt] ?? SPEED_MUL.P ?? 1.0;
  return ANIM_SPEED * base;
}

// ═══════════════════════════════════════════════════════════════
// §1 移动节拍参数 MOVE_BEAT（替代单一 TIMING.moveDuration）
// ═══════════════════════════════════════════════════════════════

/** 固定拍长（秒），按兵种差异化 */
export const MOVE_BEAT = {
  M0: { default: 0.09, R: 0.12, B: 0.10 },
  M1: { default: 0.05 },
  M3: { default: 0.05, R: 0.07, C: 0.06 },
  M4: { default: 0.15, A: 0.13 },
  M5: { default: 0.10, A: 0.08 }
};

/** M2 巡航时长（秒），按兵种键（PT 单字符） */
export const MOVE_CRUISE = {
  P: 0.14, N: 0.08, B: 0.16, A: 0.08,
  R: 0.22, C: 0.18, K: 0.12
};

/** 移动总时长（秒）= M0+M1+M2+M3+M4+M5，预计算 */
export const MOVE_TOTAL = {
  P: 0.58, N: 0.52, B: 0.61, A: 0.48,
  R: 0.71, C: 0.63, K: 0.56
};

// ═══════════════════════════════════════════════════════════════
// §2 移动风味参数 MOVE_FLAVOR / MOVE_LEAN
// ═══════════════════════════════════════════════════════════════

/** liftMul = 相对基准抛物线高度的倍率（基准 liftHeight = 0.85） */
const _FLAVOR = {
  [PT.PAWN]:     { liftMul: 0.18 },
  [PT.HORSE]:    { liftMul: 0.20 },
  [PT.ELEPHANT]: { liftMul: 0.20 },
  [PT.ADVISOR]:  { liftMul: 0.15 },
  [PT.ROOK]:     { liftMul: 0.07 },
  [PT.CANNON]:   { liftMul: 0.05 },
  [PT.KING]:     { liftMul: 0.12 }
};

/** M2–M3 前压角（idleGroup.rotation.x），已上调 */
export const MOVE_LEAN = {
  [PT.PAWN]:     -0.18,
  [PT.HORSE]:    -0.30,
  [PT.ELEPHANT]: -0.16,
  [PT.ADVISOR]:  -0.10,
  [PT.ROOK]:     -0.08,
  [PT.CANNON]:   -0.06,
  [PT.KING]:     -0.12
};

/** M0 后仰角（idleGroup.rotation.x 正向） */
export const M0_LEAN_BACK = {
  [PT.PAWN]:     +0.06,
  [PT.HORSE]:    +0.10,
  [PT.ELEPHANT]: +0.12,
  [PT.ADVISOR]:  +0.06,
  [PT.ROOK]:     +0.12,
  [PT.CANNON]:   +0.10,
  [PT.KING]:     +0.08
};

/** M0 scale.y 压缩值 */
export const M0_SQUASH = {
  [PT.PAWN]:     0.97,
  [PT.HORSE]:    0.96,
  [PT.ELEPHANT]: 0.95,
  [PT.ADVISOR]:  0.97,
  [PT.ROOK]:     0.95,
  [PT.CANNON]:   0.96,
  [PT.KING]:     0.97
};

/** M3 过冲峰值 scale */
export const M3_OVERSHOOT = {
  [PT.PAWN]:     1.04,
  [PT.HORSE]:    1.04,
  [PT.ELEPHANT]: 1.04,
  [PT.ADVISOR]:  1.04,
  [PT.ROOK]:     1.05,
  [PT.CANNON]:   1.04,
  [PT.KING]:     1.04
};

/** M4 squashLand 强度 */
export const M4_SQUASH = {
  [PT.PAWN]:     0.20,
  [PT.HORSE]:    0.24,
  [PT.ELEPHANT]: 0.28,
  [PT.ADVISOR]:  0.18,
  [PT.ROOK]:     0.30,
  [PT.CANNON]:   0.22,
  [PT.KING]:     0.20
};

/** liftMul 获取 */
export function getLiftMul(pieceType: string): number {
  return (_FLAVOR as Record<string, { liftMul: number }>)[pieceType]?.liftMul ?? 0.12;
}

// ═══════════════════════════════════════════════════════════════
// §3 吃子节拍参数 CAPTURE_BEAT
// ═══════════════════════════════════════════════════════════════

/** 吃子各拍时长（秒），按兵种键 */
export const CAPTURE_BEAT = {
  P: { A0_clamp: [0.10, 0.14], A1: 0.13, A2: 0.09, A3: 0.09, A5: 0.24 },
  N: { A0_clamp: [0.08, 0.08], A1: 0.15, A2: 0.09, A3: 0.10, A5: 0.28 },
  B: { A0_clamp: [0.10, 0.16], A1: 0.18, A2: 0.09, A3: 0.11, A5: 0.32 },
  A: { A0_clamp: [0.08, 0.08], A1: 0.13, A2: 0.08, A3: 0.09, A5: 0.26 },
  R: { A0_clamp: [0.10, 0.22], A1: 0.16, A2: 0.09, A3: 0.11, A5: 0.30 },
  C: { A0_clamp: [0.10, 0.18], A1: 0.22, A2: 0.07, A3: 0.09, A5: 0.36 },
  K: { A0_clamp: [0.10, 0.12], A1: 0.17, A2: 0.08, A3: 0.12, A5: 0.30 }
};

/** A4 崩塌固定时长（秒） */
export const A4_COLLAPSE = 0.42;

/** 吃子总时长（秒）预计算 = A0(取中值)+A1+A2+A3+A4+A5 */
export const CAPTURE_TOTAL = {
  P: 1.07, N: 1.11, B: 1.27, A: 1.05,
  R: 1.27, C: 1.25, K: 1.18
};

/** A0 巡航时长按距离 clamp */
export function clampA0(pieceTypeKey: string, distanceFactor: number): number {
  const beat = (CAPTURE_BEAT as unknown as Record<string, { A0_clamp: [number, number] }>)[pieceTypeKey]
    || (CAPTURE_BEAT.P as unknown as { A0_clamp: [number, number] });
  const [lo, hi] = beat.A0_clamp;
  return Math.max(lo, Math.min(hi, distanceFactor * (hi + lo) / 2));
}

// ═══════════════════════════════════════════════════════════════
// §4 Hitstop 参数
// ═══════════════════════════════════════════════════════════════

/** Hitstop 时长（秒），按冲击级 */
export const HITSTOP = {
  L0: 0,
  L1: 0,
  L2: 0,      // 普通走子
  L3: 0.09,   // 吃普通子
  L4: 0.14,   // 吃大子+将军
  L5: 0.22    // 将死
};

/** 恢复 ramp 时长（秒） */
export const HITSTOP_RAMP = 0.03;

// ═══════════════════════════════════════════════════════════════
// §5 冲击分级表 IMPACT_LEVELS
// ═══════════════════════════════════════════════════════════════

/** 冲击分级参数：震屏强度/时长、粒子个数/颜色、hitstop时长 */
export const IMPACT_LEVELS = {
  L0: { shakeIntensity: 0,    shakeDuration: 0,    particleCount: 0,   particleColor: PALETTE.liuJin, hitstop: 0 },
  L1: { shakeIntensity: 0,    shakeDuration: 0,    particleCount: 0,   particleColor: PALETTE.liuJin, hitstop: 0 },
  L2: { shakeIntensity: 0.03, shakeDuration: 0.18, particleCount: 42,  particleColor: PALETTE.liuJin, hitstop: 0 },
  L3: { shakeIntensity: 0.06, shakeDuration: 0.26, particleCount: 60,  particleColor: PALETTE.chiHong, hitstop: 0.09 },
  L4: { shakeIntensity: 0.12, shakeDuration: 0.30, particleCount: 80,  particleColor: PALETTE.chiHong, hitstop: 0.14 },
  L5: { shakeIntensity: 0.22, shakeDuration: 0.34, particleCount: 120, particleColor: PALETTE.chiHong, hitstop: 0.22 }
};

/** 兵种默认冲击级 */
export const PIECE_IMPACT = {
  [PT.PAWN]:     'L3',
  [PT.HORSE]:    'L3',
  [PT.ELEPHANT]: 'L3',
  [PT.ADVISOR]:  'L3',
  [PT.ROOK]:     'L4',
  [PT.CANNON]:   'L4',
  [PT.KING]:     'L4'
};

/** 大子（决定 L4 冲击） */
const MAJOR_PIECES = new Set([PT.ROOK, PT.CANNON, PT.HORSE, PT.ELEPHANT, PT.ADVISOR]);

/**
 * 判定冲击级
 * @param {Object} rec  来自 gs.move() 的 record
 * @param {boolean} rec.captured
 * @param {string} rec.status    'check'|'checkmate'|...
 * @param {string} [victimType]  被吃方兵种类型
 * @returns {'L2'|'L3'|'L4'|'L5'}
 */
export function getImpactLevel(rec: { captured: unknown, status: string }, victimType?: string): 'L2' | 'L3' | 'L4' | 'L5' {
  if (!rec.captured) return 'L2';
  if (rec.status === 'checkmate') return 'L5';
  if (rec.status === 'check' || (victimType && MAJOR_PIECES.has(victimType))) return 'L4';
  return 'L3';
}

// ═══════════════════════════════════════════════════════════════
// §6 张力参数
// ═══════════════════════════════════════════════════════════════

/** 各张力阶段的 timeScale 基调 */
export const TENSION_TIMESCALE = {
  opening:             1.00,
  midgame:             0.96,
  'endgame-balanced':  0.90,
  'endgame-one-sided': 0.95
};

/** hitstop 倍率（按张力阶段） */
export const TENSION_HITSTOP_MUL = {
  opening:             1.00,
  midgame:             1.00,
  'endgame-balanced':  1.05,
  'endgame-one-sided': 1.00
};

// ═══════════════════════════════════════════════════════════════
// §7 受害者崩解姿态参数
// ═══════════════════════════════════════════════════════════════

/**
 * 受害者崩解姿态参数。
 *
 * ★ R-1（冻结红线 · GLOBAL-1 双层口径）改造说明：
 *   本表原先含**整体倾倒**参数 `rotX` / `rotZ`（P −0.6、B ±0.35、A +0.5、R ±0.55、K +0.4），
 *   由 applyDissolvePose 写到 idleGroup.rotation 上。而 idleGroup 的原点位于盘面（y=0）形心，
 *   绕形心倾倒必然把朝倾倒侧的顶点压到盘面**以下**（例：R 半宽 ≈0.26 时倾 0.55 rad
 *   → |Δy| ≈ 0.14，是 GLOBAL-1 容差 0.02 的 7 倍）→ 违反「整体 Box3 底面 穿透=0 且 悬空=0」。
 *   故本表**整体倾倒角一律置 0**，「贴地败退」改由两条合规通道表达：
 *     ① 整枚棋子沿盘面**滑出**（`animator.dissolvePiece` 的 `knockDir`/`knockDist`，root y 恒 0）；
 *     ② 本表 `subGroupActions` 的**部件级**崩解（K 冕落 / C 折臂散架 / A 脱剑 / R 马蹄挣扎 / B 袖摆 / N 前扑）。
 *   ⚠️ 遗留待办（登记到「被击杀演出」阶段）：设计期望的「**前缘铰接式倾倒**」——
 *     绕「朝败退方向那一侧的底边」旋转；该边是棋子沿该方向的极值边，绕它旋转时其余顶点
 *     只会抬起、恒不低于盘面，可实现无穿透的倒地。实现后可以**铰接口径**重新启用 rotX/rotZ。
 *     **在那之前绝不可把这里的 0 改回非 0** —— 改回即重新引入穿透违规。
 */
export const DISSOLVE_POSE = {
  [PT.PAWN]: {
    desc: '瘫软前倒',
    rotX: 0, rotXDuration: 0.3,   // R-1：整体倾倒禁用，见上方说明
    scaleY: 0.7,                   // 绕盘面原点纵向压缩 → 不产生穿透（合规保留）
    subGroupActions: null
  },
  [PT.HORSE]: {
    desc: '前扑',
    rotX: 0,
    subGroupActions: {
      bodyHorse:  { rotX: +0.5 },
      rider:  { rotX: +0.4 }
    }
  },
  [PT.ELEPHANT]: {
    desc: '侧倾',
    rotZ: 0,                       // R-1：整体侧倾禁用
    subGroupActions: {
      arms: { rotZ: 0.5, dir: 'match' }
    }
  },
  [PT.ADVISOR]: {
    desc: '后仰脱剑',
    rotX: 0,
    subGroupActions: {
      sword: { translateY: -0.3 }
    }
  },
  [PT.ROOK]: {
    desc: '侧翻',
    rotZ: 0,                       // R-1：整体侧翻禁用
    subGroupActions: {
      horses: { rotX: 'pulse' }
    }
  },
  [PT.CANNON]: {
    desc: '折臂散架',
    subGroupActions: {
      trebuchet: { rotZ: -0.8 },
      cart:      { translateY: -0.15 }
    }
  },
  [PT.KING]: {
    desc: '冕落',
    rotX: 0,
    subGroupActions: {
      crown: { translateY: +0.25, then: { translateY: -0.35, mode: 'gravity' } }
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// §8 待机参数
// ═══════════════════════════════════════════════════════════════

export const IDLE = {
  I0: {
    actionInterval: [4, 6],
    actionProb: 0.18
  },
  I1: {
    ampMul: 1.8,
    actionInterval: [2, 3],
    actionProb: 0.30,
    transitionDuration: 0.20
  }
};

/** 武器戒备偏置（I1选中时子组 rotation 偏置） */
export const IDLE_WEAPON_BIAS = {
  [PT.PAWN]:     +0.08,
  [PT.HORSE]:    +0.10,
  [PT.ELEPHANT]: +0.06,
  [PT.ADVISOR]:  +0.08,
  [PT.ROOK]:     +0.10,
  [PT.CANNON]:   +0.06,
  [PT.KING]:     +0.06
};

// ★ S0 护栏（M-08a · DP-4）：`IDLE_PIECE` 已**下移**至本文件 `POSE_TABLE` 之后，
//   其 `zeroChannels` 改为**自动派生**（见下方 deriveCombatChannels / deriveZeroChannels）。
//   说明：派生需读取 `POSE_TABLE`（定义在本位置之后），故数据块必须后置以避免 const TDZ。

// ═══════════════════════════════════════════════════════════════
// §8.5 数据驱动姿态表 POSE_TABLE（Phase A3 + B1-B5）
// ═══════════════════════════════════════════════════════════════

/**
 * 兵种姿态四元组数据表：每兵种 × 三态（idle/move/capture）× 三段式（anticipation/action/recovery）。
 *
 * 来源：docs/design/piece-animation-spec.md §3（每兵种关键帧/时长/缓动/子组四元组）、§4.3（子组命名）、
 *       docs/design/piece-combat-action-design.md §4（节奏表，总长锚定 MOVE_TOTAL/CAPTURE_TOTAL）。
 *
 * 字段约定（A3 验收：姿态/时长/缓动/子组通道 四元组）：
 *   sub        —— 子组通道峰值（rotation/position/scale，数值=峰值幅度，动画按阶段包络应用）
 *   duration   —— 时长（秒，与现有 MOVE_BEAT/CAPTURE_BEAT/IDLE 锚点一致）
 *   easing     —— 缓动名（引用 animator.EASE.* 键名，字符串）
 *   channels   —— 'sub.prop.axis' 通道串（供 zeroChannels 交叉检查，§4.3 通道避让纪律）
 *
 * 总长硬规则（P5）：move.action.duration = MOVE_CRUISE；capture.anticipation/action/recovery
 *   = CAPTURE_BEAT.A1/A2/A5 —— 写实只做内部时间重分配，不改拍长。
 */
export const POSE_TABLE: Record<string, Record<string, any>> = {
  [PT.PAWN]: {
    // ★ Sprint 1 重构：子组已拆 armR/armL/legR/legL/shield/spear（见 SUBGROUP_JOINTS.P）。
    //   戈叩盾节律用 armR + shield 表达；负重微换腿用 legL/legR 错相位。
    //   逐级加速（肩→大臂→小臂→戈）留待后续骨骼精细化，本 Sprint 用单峰值 + 现有包络保证「可读动作」。
    idle: {
      anticipation: { sub: { armR: { rotation: { x: 0.020 } } }, duration: 0.87, ease: 'easeOutQuad', channels: ['armR.rotation.x'] },
      action: { sub: { armR: { rotation: { x: 0.045 } }, shield: { rotation: { z: 0.030 } }, legL: { rotation: { x: 0.012 } } }, duration: 5.0, ease: 'easeOutQuad', channels: ['armR.rotation.x', 'shield.rotation.z', 'legL.rotation.x'] },
      recovery: { sub: { armR: { rotation: { x: 0 } }, shield: { rotation: { z: 0 } }, legL: { rotation: { x: 0 } } }, duration: 0.5, ease: 'easeInOutQuad', channels: ['armR.rotation.x', 'shield.rotation.z', 'legL.rotation.x'] }
    },
    move: {
      anticipation: { sub: { armR: { rotation: { x: -0.15 } }, armL: { rotation: { x: -0.10 } } }, duration: 0.14, ease: 'easeOutQuad', channels: ['armR.rotation.x', 'armL.rotation.x'] },
      action: { sub: { armR: { rotation: { x: -0.32 } }, armL: { rotation: { x: -0.22 } }, legR: { rotation: { x: 0.16 } }, legL: { rotation: { x: -0.16 } } }, duration: 0.14, ease: 'easeInCubic', channels: ['armR.rotation.x', 'armL.rotation.x', 'legR.rotation.x', 'legL.rotation.x'] },
      recovery: { sub: { armR: { rotation: { x: 0 } }, armL: { rotation: { x: 0 } }, legR: { rotation: { x: 0 } }, legL: { rotation: { x: 0 } } }, duration: 0.30, ease: 'easeInOutQuad', channels: ['armR.rotation.x', 'armL.rotation.x', 'legR.rotation.x', 'legL.rotation.x'] }
    },
    capture: {
      anticipation: { sub: { armR: { rotation: { x: -0.25 } }, shield: { rotation: { x: -0.12 } } }, duration: 0.13, ease: 'easeOutQuad', channels: ['armR.rotation.x', 'shield.rotation.x'] },
      action: { sub: { armR: { rotation: { x: -0.58 } }, spear: { rotation: { z: -0.20 } }, shield: { rotation: { x: -0.25 } } }, duration: 0.09, ease: 'easeInCubic', channels: ['armR.rotation.x', 'spear.rotation.z', 'shield.rotation.x'] },
      recovery: { sub: { armR: { rotation: { x: 0 } }, spear: { rotation: { z: 0 } }, shield: { rotation: { x: 0 } } }, duration: 0.24, ease: 'easeInOutQuad', channels: ['armR.rotation.x', 'spear.rotation.z', 'shield.rotation.x'] }
    }
  },
  [PT.HORSE]: {
    idle: {
      anticipation: { sub: { bodyHorse: { rotation: { x: -0.048 } } }, duration: 0.87, ease: 'easeOutQuad', channels: ['bodyHorse.rotation.x'] },
      action: { sub: { bodyHorse: { rotation: { x: -0.040 } } }, duration: 6.5, ease: 'easeOutQuad', channels: ['bodyHorse.rotation.x'] },
      recovery: { sub: { rider: { rotation: { z: 0 } } }, duration: 0.5, ease: 'easeInOutQuad', channels: ['rider.rotation.z'] }
    },
    move: {
      anticipation: { sub: { rider: { rotation: { x: -0.10 } } }, duration: 0.14, ease: 'easeOutQuad', channels: ['rider.rotation.x'] },
      action: { sub: { bodyHorse: { rotation: { x: -0.22 } }, rider: { rotation: { x: -0.25 } } }, duration: 0.08, ease: 'easeInCubic', channels: ['bodyHorse.rotation.x', 'rider.rotation.x'] },
      recovery: { sub: { bodyHorse: { rotation: { x: 0 } }, rider: { rotation: { x: 0 } } }, duration: 0.30, ease: 'easeInOutQuad', channels: ['bodyHorse.rotation.x', 'rider.rotation.x'] }
    },
    capture: {
      anticipation: { sub: { bodyHorse: { rotation: { x: 0.1 } }, rider: { rotation: { x: -0.2 } } }, duration: 0.15, ease: 'easeOutQuad', channels: ['bodyHorse.rotation.x', 'rider.rotation.x'] },
      action: { sub: { rider: { rotation: { x: -0.75 } }, bodyHorse: { rotation: { x: -0.35 } } }, duration: 0.09, ease: 'easeInCubic', channels: ['rider.rotation.x', 'bodyHorse.rotation.x'] },
      recovery: { sub: { rider: { rotation: { x: 0 } }, bodyHorse: { rotation: { x: 0 } } }, duration: 0.28, ease: 'easeInOutQuad', channels: ['rider.rotation.x', 'bodyHorse.rotation.x'] }
    }
  },
  [PT.ELEPHANT]: {
    idle: {
      anticipation: { sub: { arms: { rotation: { z: 0.060 } } }, duration: 0.87, ease: 'easeOutQuad', channels: ['arms.rotation.z'] },
      action: { sub: { arms: { rotation: { x: 0.050 } } }, duration: 6.0, ease: 'easeOutQuad', channels: ['arms.rotation.x'] },
      recovery: { sub: { arms: { rotation: { z: 0 } } }, duration: 0.5, ease: 'easeInOutQuad', channels: ['arms.rotation.z'] }
    },
    move: {
      anticipation: { sub: { arms: { rotation: { z: -0.10 } } }, duration: 0.15, ease: 'easeOutQuad', channels: ['arms.rotation.z'] },
      action: { sub: { arms: { rotation: { z: 0.22 } }, bodyRobe: { rotation: { x: 0.15 } } }, duration: 0.16, ease: 'easeInCubic', channels: ['arms.rotation.z', 'bodyRobe.rotation.x'] },
      recovery: { sub: { arms: { rotation: { z: 0 } }, bodyRobe: { rotation: { x: 0 } } }, duration: 0.30, ease: 'easeInOutQuad', channels: ['arms.rotation.z', 'bodyRobe.rotation.x'] }
    },
    capture: {
      anticipation: { sub: { arms: { rotation: { z: -0.3 } }, bodyRobe: { rotation: { x: 0.15 } } }, duration: 0.18, ease: 'easeOutQuad', channels: ['arms.rotation.z', 'bodyRobe.rotation.x'] },
      action: { sub: { arms: { rotation: { z: 0.75 } }, bodyRobe: { rotation: { z: 0.40 } } }, duration: 0.09, ease: 'easeInCubic', channels: ['arms.rotation.z', 'bodyRobe.rotation.z'] },
      // ★ P1（M-08d2-b）：`sub` 驱动 `bodyRobe.{z,x}`，但 `channels` 原仅列 `z` ——
      //   由 ⑨-I3b 双向集合等式捕获（「加 sub 忘加 channels」缺陷类）。已补 `bodyRobe.rotation.x`。
      recovery: { sub: { arms: { rotation: { z: 0 } }, bodyRobe: { rotation: { z: 0, x: 0 } } }, duration: 0.32, ease: 'easeInOutQuad', channels: ['arms.rotation.z', 'bodyRobe.rotation.z', 'bodyRobe.rotation.x'] }
    }
  },
  [PT.ADVISOR]: {
    // ★ Sprint 1：A 防御姿态（双手拄剑身前 + shield 微抬）/ 护卫碎步 / 战吼劈砍。
    // ★ S2b-step2（M-08d2 · §7.3 #1）：A.arms 拆为 armR/armL —— 原 `arms.rotation.x`
    //   等值镜像到 armR.x + armL.x（双臂同步；pivot 已校准至真肩点）。capture 段本不含 arms，不动。
    idle: {
      anticipation: { sub: { body: { rotation: { z: 0.014 } } }, duration: 0.87, ease: 'easeOutQuad', channels: ['body.rotation.z'] },
      action: { sub: { sword: { rotation: { z: 0.024 } }, shield: { rotation: { x: 0.030 } }, armR: { rotation: { x: 0.012 } }, armL: { rotation: { x: 0.012 } } }, duration: 2.5, ease: 'easeOutQuad', channels: ['sword.rotation.z', 'shield.rotation.x', 'armR.rotation.x', 'armL.rotation.x'] },
      recovery: { sub: { body: { rotation: { z: 0 } }, shield: { rotation: { x: 0 } }, armR: { rotation: { x: 0 } }, armL: { rotation: { x: 0 } } }, duration: 0.5, ease: 'easeInOutQuad', channels: ['body.rotation.z', 'shield.rotation.x', 'armR.rotation.x', 'armL.rotation.x'] }
    },
    move: {
      anticipation: { sub: { sword: { rotation: { z: -0.08 } }, shield: { rotation: { x: -0.06 } } }, duration: 0.14, ease: 'easeOutQuad', channels: ['sword.rotation.z', 'shield.rotation.x'] },
      action: { sub: { sword: { rotation: { z: -0.12 } }, shield: { rotation: { x: -0.10 } }, armR: { rotation: { x: -0.06 } }, armL: { rotation: { x: -0.06 } } }, duration: 0.08, ease: 'easeInCubic', channels: ['sword.rotation.z', 'shield.rotation.x', 'armR.rotation.x', 'armL.rotation.x'] },
      recovery: { sub: { sword: { rotation: { z: 0 } }, shield: { rotation: { x: 0 } }, armR: { rotation: { x: 0 } }, armL: { rotation: { x: 0 } } }, duration: 0.26, ease: 'easeInOutQuad', channels: ['sword.rotation.z', 'shield.rotation.x', 'armR.rotation.x', 'armL.rotation.x'] }
    },
    capture: {
      anticipation: { sub: { sword: { rotation: { z: -0.4 } }, shield: { rotation: { x: -0.15 } }, body: { rotation: { x: -0.05 } } }, duration: 0.13, ease: 'easeOutQuad', channels: ['sword.rotation.z', 'shield.rotation.x', 'body.rotation.x'] },
      action: { sub: { sword: { rotation: { z: -0.85 } }, shield: { rotation: { x: -0.25 } }, body: { rotation: { x: -0.12 } } }, duration: 0.08, ease: 'easeInCubic', channels: ['sword.rotation.z', 'shield.rotation.x', 'body.rotation.x'] },
      recovery: { sub: { sword: { rotation: { z: 0 } }, shield: { rotation: { x: 0 } }, body: { rotation: { x: 0 } } }, duration: 0.26, ease: 'easeInOutQuad', channels: ['sword.rotation.z', 'shield.rotation.x', 'body.rotation.x'] }
    }
  },
  [PT.ROOK]: {
    idle: {
      anticipation: { sub: { horses: { rotation: { x: 0.040 } } }, duration: 0.87, ease: 'easeOutQuad', channels: ['horses.rotation.x'] },
      action: { sub: { horses: { rotation: { x: 0.045 } } }, duration: 7.0, ease: 'easeOutQuad', channels: ['horses.rotation.x'] },
      recovery: { sub: { horses: { rotation: { x: 0 } } }, duration: 0.5, ease: 'easeInOutQuad', channels: ['horses.rotation.x'] }
    },
    move: {
      anticipation: { sub: { driver: { rotation: { x: -0.15 } } }, duration: 0.17, ease: 'easeOutQuad', channels: ['driver.rotation.x'] },
      action: { sub: { driver: { rotation: { x: -0.20 } }, spearman: { rotation: { x: -0.25 } }, wheelL: { rotation: { x: 0.80 } }, wheelR: { rotation: { x: 0.80 } } }, duration: 0.22, ease: 'easeInCubic', channels: ['driver.rotation.x', 'spearman.rotation.x', 'wheelL.rotation.x', 'wheelR.rotation.x'] },
      recovery: { sub: { driver: { rotation: { x: 0 } }, spearman: { rotation: { x: 0 } }, wheelL: { rotation: { x: 0 } }, wheelR: { rotation: { x: 0 } } }, duration: 0.32, ease: 'easeInOutQuad', channels: ['driver.rotation.x', 'spearman.rotation.x', 'wheelL.rotation.x', 'wheelR.rotation.x'] }
    },
    capture: {
      anticipation: { sub: { spearman: { rotation: { x: -0.30 } }, driver: { rotation: { x: -0.15 } } }, duration: 0.16, ease: 'easeOutQuad', channels: ['spearman.rotation.x', 'driver.rotation.x'] },
      action: { sub: { spearman: { rotation: { x: -0.70 } }, horses: { rotation: { x: -0.35 } }, driver: { rotation: { x: -0.25 } }, wheelL: { rotation: { x: 1.20 } }, wheelR: { rotation: { x: 1.20 } } }, duration: 0.09, ease: 'easeInCubic', channels: ['spearman.rotation.x', 'horses.rotation.x', 'driver.rotation.x', 'wheelL.rotation.x', 'wheelR.rotation.x'] },
      recovery: { sub: { spearman: { rotation: { x: 0 } }, driver: { rotation: { x: 0 } }, wheelL: { rotation: { x: 0 } }, wheelR: { rotation: { x: 0 } } }, duration: 0.30, ease: 'easeInOutQuad', channels: ['spearman.rotation.x', 'driver.rotation.x', 'wheelL.rotation.x', 'wheelR.rotation.x'] }
    }
  },
  [PT.CANNON]: {
    idle: {
      anticipation: { sub: { soldierL: { rotation: { x: 0.045 } } }, duration: 0.87, ease: 'easeOutQuad', channels: ['soldierL.rotation.x'] },
      action: { sub: { soldierL: { rotation: { x: 0.042 } } }, duration: 6.0, ease: 'easeOutQuad', channels: ['soldierL.rotation.x'] },
      recovery: { sub: { soldierR: { rotation: { x: 0 } } }, duration: 0.5, ease: 'easeInOutQuad', channels: ['soldierR.rotation.x'] }
    },
    move: {
      anticipation: { sub: { soldierL: { rotation: { x: -0.15 } } }, duration: 0.14, ease: 'easeOutQuad', channels: ['soldierL.rotation.x'] },
      action: { sub: { soldierL: { rotation: { x: -0.30 } }, soldierR: { rotation: { x: -0.30 } }, trebuchet: { rotation: { z: 0.15 } } }, duration: 0.18, ease: 'easeInCubic', channels: ['soldierL.rotation.x', 'soldierR.rotation.x', 'trebuchet.rotation.z'] },
      recovery: { sub: { soldierL: { rotation: { x: 0 } }, soldierR: { rotation: { x: 0 } }, trebuchet: { rotation: { z: 0 } } }, duration: 0.31, ease: 'easeInOutQuad', channels: ['soldierL.rotation.x', 'soldierR.rotation.x', 'trebuchet.rotation.z'] }
    },
    capture: {
      anticipation: { sub: { trebuchet: { rotation: { z: -0.48 } }, soldierL: { rotation: { x: -0.45 } }, soldierR: { rotation: { x: 0.35 } } }, duration: 0.22, ease: 'easeOutCubic', channels: ['trebuchet.rotation.z', 'soldierL.rotation.x', 'soldierR.rotation.x'] },
      action: { sub: { trebuchet: { rotation: { z: 0.40 } } }, duration: 0.07, ease: 'easeInCubic', channels: ['trebuchet.rotation.z'] },
      recovery: { sub: { trebuchet: { rotation: { z: 0 } }, cart: { rotation: { x: -0.10 } }, soldierL: { rotation: { x: -0.20 } }, soldierR: { rotation: { x: -0.20 } } }, duration: 0.36, ease: 'easeOutQuad', channels: ['trebuchet.rotation.z', 'cart.rotation.x', 'soldierL.rotation.x', 'soldierR.rotation.x'] }
    }
  },
  [PT.KING]: {
    // ★ Sprint 1：K 龙椅微浮（throne 微沉）/ 帅旗猎猎（banner）/ 步辇位移 + 旗扬 / 帅旗前指 + 剑指一喝（rArm）。
    idle: {
      anticipation: { sub: { rArm: { rotation: { z: 0.058 } }, throne: { rotation: { y: 0.010 } } }, duration: 0.87, ease: 'easeOutQuad', channels: ['rArm.rotation.z', 'throne.rotation.y'] },
      action: { sub: { banner: { rotation: { z: 0.034 } }, throne: { rotation: { y: 0.020 } } }, duration: 2.5, ease: 'easeOutQuad', channels: ['banner.rotation.z', 'throne.rotation.y'] },
      recovery: { sub: { rArm: { rotation: { z: 0 } }, throne: { rotation: { y: 0 } } }, duration: 0.5, ease: 'easeInOutQuad', channels: ['rArm.rotation.z', 'throne.rotation.y'] }
    },
    move: {
      anticipation: { sub: { throne: { rotation: { x: 0.06 } }, banner: { rotation: { z: 0.04 } } }, duration: 0.14, ease: 'easeOutQuad', channels: ['throne.rotation.x', 'banner.rotation.z'] },
      action: { sub: { throne: { rotation: { x: -0.06 } }, sword: { rotation: { z: -0.10 } }, banner: { rotation: { z: 0.06 } }, capeHem: { rotation: { z: 0.10 } } }, duration: 0.12, ease: 'easeInCubic', channels: ['throne.rotation.x', 'sword.rotation.z', 'banner.rotation.z', 'capeHem.rotation.z'] },
      recovery: { sub: { throne: { rotation: { x: 0 } }, sword: { rotation: { z: 0 } }, banner: { rotation: { z: 0 } }, capeHem: { rotation: { z: 0 } } }, duration: 0.30, ease: 'easeInOutQuad', channels: ['throne.rotation.x', 'sword.rotation.z', 'banner.rotation.z', 'capeHem.rotation.z'] }
    },
    capture: {
      anticipation: { sub: { sword: { rotation: { z: -0.25 } }, throne: { rotation: { x: -0.10 } }, banner: { rotation: { z: -0.12 } } }, duration: 0.17, ease: 'easeOutQuad', channels: ['sword.rotation.z', 'throne.rotation.x', 'banner.rotation.z'] },
      action: { sub: { sword: { rotation: { z: -0.40 } }, throne: { rotation: { x: -0.15 } }, banner: { rotation: { z: -0.30 } }, rArm: { rotation: { z: -0.10 } }, capeHem: { rotation: { z: 0.14 } } }, duration: 0.08, ease: 'easeInCubic', channels: ['sword.rotation.z', 'throne.rotation.x', 'banner.rotation.z', 'rArm.rotation.z', 'capeHem.rotation.z'] },
      recovery: { sub: { sword: { rotation: { z: 0 } }, throne: { rotation: { x: 0 } }, banner: { rotation: { z: 0 } }, rArm: { rotation: { z: 0 } }, capeHem: { rotation: { z: 0 } } }, duration: 0.30, ease: 'easeInOutQuad', channels: ['sword.rotation.z', 'throne.rotation.x', 'banner.rotation.z', 'rArm.rotation.z', 'capeHem.rotation.z'] }
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// §8.6 战斗通道自动派生 + zeroChannels 派生（S0 护栏 · DP-4，09 §7.4 R-Z2/R-Z3/R-Z7）
//   ★ S0.1（M-08a2）：派生范围由 capture 扩到 move ∪ capture ∪ dissolve ∪ 编排层直写。
// ═══════════════════════════════════════════════════════════════

/**
 * 归一化通道键：`'sub.rotation.x'` → `'sub.x'`；已是 `'sub.axis'` 形状则原样返回。
 * 仅保留 **rotation** 通道 —— `zeroChannels` 在 animator 中只写 `sg[sub].rotation[axis]`，
 * 故 position / scale 通道（如 `DISSOLVE_POSE` 的 `translateY`）与之**不可能冲突**，不入集。
 */
function _normRotationChannel(c: string): string | null {
  const p = c.split('.');
  if (p.length === 2) return c;
  if (p.length === 3 && p[1] === 'rotation') return `${p[0]}.${p[2]}`;
  return null;
}

/**
 * ★ S0.1 补刀（M-08a2 · DP-4 派生范围扩到 move + 编排层直写）
 *
 * **编排层直写通道**（声明式数据 = R-Z2 第三项）。
 *
 * 定义：**动作/编排层**（`combat/CaptureAction.ts` 的 `executeCannon`、`animator.ts` 的
 * `cannonCapture`）**绕过 `POSE_TABLE`**、直接 `sg[sub].rotation[axis] = …` 写入的子组·轴。
 * 判定粒度仍是通道键 `sub.axis`（R-Z3）；只登记 **rotation** 通道（`zeroChannels` 只写 rotation）。
 *
 * 声明纪律（**为什么是纯数据、不是运行时扫描**）：
 *   - `CaptureAction` / `PieceChoreography` 与本文件相互 import → 派生前不能 import 它们
 *     （循环依赖）；CI 无浏览器/GPU 无法运行时观测。故以**声明式常量**登记，并由
 *     `scripts/check-piece-contract.mjs` 断言 `zeroChannels ∩ (move∪capture∪dissolve∪本表) = ∅`。
 *   - 非 C 兵种**没有**任何绕过 POSE_TABLE 的直写（统一走 `windUp/strike/settle` 数据驱动分支），
 *     故除 C 外为空。**维护提示**：新增「绕过 POSE_TABLE 的直写」必须同步本表。
 *
 * ⚠ **刻意不收录**两处「看似直写、实则不构成战斗位移」的通道：
 *   - `PieceChoreography` 的 `switch` 回退分支（含 `moveFlourish[N]` 的四腿 trot）：在 7 型
 *     `POSE_TABLE.move/capture` 三段**齐备时不可达**（该完整性由 contract 断言）→ 其声明的
 *     `legFL.x`/`legFR.x`/`legBL.x`/`legBR.x` 在运行时**不会被写**。若误收，会把 `N.legFL.x`
 *     挤出 `zeroChannels` → 行进中「待机抬起的马腿」被**冻结**（既不归零、也无人写）= 新缺陷。
 *   - `resetMovePose` 只写 **0**（幂等复位），不承载战斗位移 → 不构成「战斗通道」。
 */
export const CHOREO_WRITE_CHANNELS: Record<string, string[]> = {
  // C 炮：executeCannon 六步（装填→瞄准→射击→后坐→淡出→淡入）直接驱动。
  //   trebuchet.z / soldierL.x / soldierR.x / cart.x 已被 POSE_TABLE.C.capture 覆盖（冗余登记）；
  //   **counterweight.z 此前完全遗漏**（POSE_TABLE 无此项）→ 本表补全。
  C: ['trebuchet.z', 'counterweight.z', 'cart.x', 'soldierL.x', 'soldierR.x']
};

/**
 * **程序化派生**某兵种的「战斗通道」集合（判定粒度 = 通道键 `sub.axis`，R-Z3）。
 * **禁止手工维护零散黑名单**（R-Z2）—— 战斗通道必须随数据自动演化。
 *
 * 来源（任一命中即入集）：
 *   ① `POSE_TABLE[type].move ∪ capture` 的**全部** stage 的 `channels`（**非 idle 态**；
 *      idle 是待机侧、正是要被 `_busy` 归零的集合）；
 *   ② `DISSOLVE_POSE[type].subGroupActions` 的旋转通道（`rotX` → `sub.x`，`rotZ` → `sub.z`；
 *      `translateY` 是 position 通道，不入集 —— `zeroChannels` 只写 rotation）；
 *   ③ `CHOREO_WRITE_CHANNELS[type]`（编排层绕过 POSE_TABLE 的直写）。
 *
 * ★ S0.1 修正：原实现只取 `capture`，**漏了 `move` 与编排层直写** —— 语义上偏离 R-Z2 字面要求。
 *   后果：`P.armL.x`/`P.legL.x`/`P.legR.x`/`A.arms.x` 被误收进 `zeroChannels`，
 *   `_busy` 期间（animator.tickIdle）每帧被归零 → **吞掉 P 的移动左臂/双腿随动、
 *   A 的移动摆臂**（与历史 `ROOK.horses.rotation.x` 同类缺陷）。本轮修回。
 */
export function deriveCombatChannels(type: string): Set<string> {
  const out = new Set<string>();
  const entry = (POSE_TABLE as Record<string, any>)[type];
  if (entry) {
    for (const state of ['move', 'capture'] as const) {
      const st = entry[state];
      if (!st) continue;
      for (const stage of ['anticipation', 'action', 'recovery'] as const) {
        const seg = st[stage];
        // ★ P1（M-08d2-b）· 通道定义源 = `seg.sub`（**真正的驱动源**）：
        //   运行时 `PieceChoreography._applyPose*` 按 `sub` 写 `sg[sub].rotation[axis]`，
        //   故 `sub` 才是事实来源；`seg.channels` 只是**手工并行维护的冗余副本**。
        //   历史缺陷：本函数原先只读 `channels` → 有人加 `sub` 忘加 `channels` 时，
        //   该通道漏出派生集 → 留在 `deriveZeroChannels` 差集 → `_busy` 每帧归零 →
        //   `POSE_TABLE` 同时在写 ⇒ **动作静默失效**（同类：历史 `ROOK.horses.rotation.x`）。
        //   改读 `sub` 后，漏同步 `channels` 会被契约 I3b（双向集合等式）当场抓住。
        //   ⚠ 纪律：`zeroChannels` 只写 rotation —— 经 `_normRotationChannel` 过滤，
        //   position/scale（如 `DISSOLVE_POSE.translateY`）自动排除，不入集。
        if (!seg || !seg.sub) continue;
        for (const sub of Object.keys(seg.sub)) {
          const props = seg.sub[sub];
          if (!props || typeof props !== 'object') continue;
          for (const prop of Object.keys(props)) {
            const axes = props[prop];
            if (!axes || typeof axes !== 'object') continue;
            for (const ax of Object.keys(axes)) {
              const k = _normRotationChannel(`${sub}.${prop}.${ax}`);
              if (k) out.add(k);
            }
          }
        }
      }
    }
  }
  const dis = (DISSOLVE_POSE as Record<string, any>)[type];
  const sga = dis && dis.subGroupActions;
  if (sga && typeof sga === 'object') {
    for (const sub of Object.keys(sga)) {
      const a = (sga as Record<string, any>)[sub];
      if (!a || typeof a !== 'object') continue;
      if (a.rotX !== undefined) out.add(`${sub}.x`);
      if (a.rotZ !== undefined) out.add(`${sub}.z`);
    }
  }
  for (const c of CHOREO_WRITE_CHANNELS[type] || []) out.add(c);
  return out;
}

const _zeroCache = new Map<string, string[]>();

/**
 * 派生某兵种的 `zeroChannels`（`_busy` 期间幂等归零的**待机专属**通道）：
 *
 *   `zeroChannels(type) = writtenChannels(VIGNETTE[type]) − deriveCombatChannels(type)`
 *
 * 并**过滤到已注册子组**：未在 `SUBGROUP_JOINTS[type]` 注册的子组（概念通道 `scroll`/`winch`/`gear`）
 * 在 animator 中本就安全跳过，收录无意义 —— 与既有手抄表的做法一致（这也是 DP-4 修复
 * `K.banner.z` 越界后，`K` 恰好收敛为 `['body.x','rArm.x']` 的原因）。
 *
 * 不变量（由 `check-piece-contract.mjs` 逐型逐通道断言）：`zeroChannels ∩ deriveCombatChannels === ∅`。
 */
export function deriveZeroChannels(type: string): string[] {
  const hit = _zeroCache.get(type);
  if (hit) return hit;
  const def = (VIGNETTE as Record<string, VignetteDef | undefined>)[type];
  const out: string[] = [];
  if (def) {
    const combat = deriveCombatChannels(type);
    const joints = SUBGROUP_JOINTS[type];
    for (const ch of writtenChannels(def)) {
      if (combat.has(ch)) continue;
      const dot = ch.indexOf('.');
      const sub = dot >= 0 ? ch.slice(0, dot) : ch;
      if (!joints || !joints[sub]) continue;
      out.push(ch);
    }
  }
  _zeroCache.set(type, out);
  return out;
}

/**
 * 七兵种个性化待机 vignette 参数（R-2 重构；数据唯一真相源，animator.tickIdle 读取）。
 *
 * 模型（取代旧「sum of sines 呼吸 + 正弦微颤 + 门控脉冲」假待机）：
 *   - 每兵种一套**分步、闭合、兵种特性化** vignette 序列（见 src/render/combat/vignette.ts
 *     的 VIGNETTE 表，权威口径为系统设计.md §3.2.M5.19）。
 *   - 通道纪律（R-1 红线）：VigCh 只写子组 rotation（sg[sub].rotation[axis]）；
 *     禁写 root / orient / idleGroup，禁写任何 position。
 *
 * 三级激活增益（animator.tickIdle 实现，主理人裁定 D2）：
 *   - _busy            → 按 zeroChannels 幂等归零（保持现状，不改）
 *   - !sel && far      → L1 IDLE_BASE：仅 baseline（静态基准），L2/L3 停写并冻结当前值
 *   - !sel && !far     → 怠速层：全通道 × IDLE_BASE_GAIN = 0.25（极小幅度机械怠速，无呼吸）
 *   - sel（任意视距）  → L2/L3 全量 vignette：全部分段通道 + 机械层，增益 1.0
 * 三档之间以 crossfadeSec 为时长的增益斜坡过渡，进入 / 退出 / 远景恢复均不跳变。
 *
 * 性能预算：!sel && far → 32 枚 × 1–3 条 baseline ≈ 64 次/帧；!sel && !far → 32 × ~4 ≈ 130；
 *   sel → +~5（外加 C 炮机械层 2 条）。
 *
 * ★ S0 护栏（M-08a · DP-4）：`zeroChannels` 由**自动派生**（`deriveZeroChannels`）生成，
 *   **不再手工维护**（R-Z2）。纪律：`zeroChannels` 只能收录「待机写入 ∩ 战斗不写」的通道，
 *   否则 `_busy` 期间每帧归零会吞掉战斗动作（历史 bug：`ROOK.horses.rotation.x` 被吞；
 *   以及 M-07 复核确认的 `K.banner.z` 越界 —— 该通道既是待机通道又是 `POSE_TABLE.K` 四态
 *   都在驱动的战斗通道，本轮由派生自动剔除）。
 */
export const IDLE_PIECE = {
  [PT.PAWN]: {
    desc: '持矛挺立 → 举目远眺瞭望 → 收手 → 小幅踏步 → 矛尖顿地（P）',
    vignette: VIGNETTE.P,
    zeroChannels: deriveZeroChannels(PT.PAWN)
  },
  [PT.HORSE]: {
    desc: '昂首 → 前蹄扬起 → 刨地 → 前蹄落回 → 甩鬃（N，root 贴地）',
    vignette: VIGNETTE.N,
    zeroChannels: deriveZeroChannels(PT.HORSE)
  },
  [PT.ELEPHANT]: {
    desc: '执笏秉笔 → 摇扇沉思 → 收扇 → 谋士揖礼 → 起身回中（B）',
    vignette: VIGNETTE.B,
    zeroChannels: deriveZeroChannels(PT.ELEPHANT)
  },
  [PT.ADVISOR]: {
    desc: '按剑戒备 → 小幅移步护卫 → 举手整饬甲胄 → 手回按剑（A，全场最静）',
    vignette: VIGNETTE.A,
    zeroChannels: deriveZeroChannels(PT.ADVISOR)
  },
  [PT.ROOK]: {
    desc: '御马兵控缰 → 双马刨地 → 持戈兵瞭望挥戈（R，车轮待机锁定禁空转）',
    vignette: VIGNETTE.R,
    zeroChannels: deriveZeroChannels(PT.ROOK)
  },
  [PT.CANNON]: {
    desc: '双兵检修投石机：擦拭 → 上油 → 齿轮绞盘联动 → 校正瞄准 → 退后端详（C，含机械层）',
    vignette: VIGNETTE.C,
    zeroChannels: deriveZeroChannels(PT.CANNON)
  },
  [PT.KING]: {
    desc: '按剑凝思 → 手指示意 → 收手 → 展阅简牍 → 卷收归位（K，坐于席位）',
    vignette: VIGNETTE.K,
    zeroChannels: deriveZeroChannels(PT.KING)
  }
};

// ═══════════════════════════════════════════════════════════════
// §9 AI 加速倍率
// ═══════════════════════════════════════════════════════════════

export const AI_SPEED_MUL = 0.7;

// ═══════════════════════════════════════════════════════════════
// §10 粒子/尘土/残影间隔
// ═══════════════════════════════════════════════════════════════

export const VFX_INTERVAL = {
  dustTrail:      0.04,   // 尘土 puff 间隔（秒）
  afterimage:     0.05,   // 残影 间隔（秒）
  dustPuffCount:  200,    // 尘土粒子池上限
  afterimageCount: 6      // 同时最多残影数
};

// ═══════════════════════════════════════════════════════════════
// §11 工具：取某兵种的拍长
// ═══════════════════════════════════════════════════════════════

/**
 * 取某兵种某个节拍的时长
 * @param {'M0'|'M1'|'M2'|'M3'|'M4'|'M5'} beat
 * @param {string} pieceType  PT 值
 * @returns {number}
 */
export function getBeatDuration(beat: string, pieceType: string): number {
  if (beat === 'M2') {
    const key = pieceType;
    return (MOVE_CRUISE as Record<string, number>)[key] || 0.14;
  }
  const b = (MOVE_BEAT as Record<string, Record<string, number>>)[beat];
  if (!b) return 0.15;
  return b[pieceType] || b.default || 0.1;
}

/**
 * 取某兵种 A 序列拍长
 * @param {'A0'|'A1'|'A2'|'A3'|'A5'} beat
 * @param {string} pieceTypeKey  兵种单字符键
 * @param {number} [distanceFactor] 仅 A0 需要（0..1）
 * @returns {number}
 */
export function getCaptureBeat(beat: string, pieceTypeKey: string, distanceFactor = 1): number {
  const cb = (CAPTURE_BEAT as unknown as Record<string, Record<string, number>>)[pieceTypeKey] || (CAPTURE_BEAT.P as unknown as Record<string, number>);
  if (beat === 'A0') return clampA0(pieceTypeKey, distanceFactor);
  if (beat === 'A4') return A4_COLLAPSE;
  return cb[beat] || 0.42;
}

// ═══════════════════════════════════════════════════════════════
// §11.5 速度可调框架出口函数（Sprint 1：决策 2 + 5）
// ═══════════════════════════════════════════════════════════════
//
// ★ 决策 5 公式方向修正说明（重要）：
//   任务原型写 moveDurationFor = MOVE_TOTAL / (ANIM_SPEED × SPEED_MUL × distScale)，
//   但决策 5 文字明确要求「近距略快、远距略慢」「远距需要更长时间覆盖」
//   （物理真实：速度恒定则时长 ∝ 距离）。若 distScale 置分母（>1 时），时长反而更短，
//   与决策意图矛盾。distScale 系数 1+(df-1)*0.12（>1）显然是「时长增长倍数」。
//   故本实现将 distScale 置于**分子**（时长缩放）：
//     moveDurationFor(pt, df)   = MOVE_TOTAL[pt] / (ANIM_SPEED × SPEED_MUL[pt]) × distScaleFor(df)
//     captureDurationFor(pt,df) = CAPTURE_TOTAL[pt] / (ANIM_SPEED × SPEED_MUL[pt]) × distScaleFor(df)
//   近距(df=1, distScale=1) 时长=基准/SPEED_MUL；远距(df≥4, distScale>1) 时长线性增长（封顶 1.8×）。
//   此为遵循决策物理意图的唯一自洽解；perTypeSpeedMul（含距离）保留供参考/测试，但
//   Action 集成改用 beatSpeedMul（不含距离）× distScaleFor 分开，确保远距更长。
//
// 与现有逐拍架构对齐：MoveAction/CaptureAction 按拍拼接总时长，故在 Action 层把每拍
// 时长 = 原拍长 / beatSpeedMul(pt) × distScaleFor(df)，与上式数学等价，且保留逐拍结构、
// 与 AI_SPEED_MUL 正交相乘、与 timeScale(dt 缩放) 正交不冲突。hitstop(A3) 不缩放。

/**
 * 某兵种「移动总时长」经全局速度框架缩放后的结果（秒）。
 * = MOVE_TOTAL[pt] / (ANIM_SPEED × SPEED_MUL[pt]) × distScaleFor(distanceFactor)
 * @param {string} pt  PT 单字符
 * @param {number} distanceFactor  移动格数（1~N）
 * @returns {number}
 */
export function moveDurationFor(pt: string, distanceFactor = 1): number {
  const total = (MOVE_TOTAL as Record<string, number>)[pt] ?? MOVE_TOTAL.P;
  return (total / beatSpeedMul(pt)) * distScaleFor(distanceFactor);
}

/**
 * 某兵种「吃子总时长」经全局速度框架缩放后的结果（秒）。
 * = CAPTURE_TOTAL[pt] / (ANIM_SPEED × SPEED_MUL[pt]) × distScaleFor(distanceFactor)
 * 注意：仅覆盖 A0..A2/A4/A5 的 beat 时长缩放；hitstop(A3) 由冲击级决定、不在此缩放。
 * @param {string} pt  PT 单字符
 * @param {number} distanceFactor  移动格数（1~N）
 * @returns {number}
 */
export function captureDurationFor(pt: string, distanceFactor = 1): number {
  const total = (CAPTURE_TOTAL as Record<string, number>)[pt] ?? CAPTURE_TOTAL.P;
  return (total / beatSpeedMul(pt)) * distScaleFor(distanceFactor);
}
