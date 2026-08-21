/**
 * CombatConstants.js — 战场演出参数表（纯数据模块）
 *
 * 所有数值的唯一真相源。来源：
 *   design/action-system.md §2 §3 §4
 *   design/combat-feel-spec.md §5 §6
 *   design/audio-system-v2.md §2.2
 *
 * 此文件零依赖，被所有 combat/ 模块 import。
 */

import { PT, PALETTE } from '../../core/constants.ts';

// ═══════════════════════════════════════════════════════════════
// §0 性能预算常量
// ═══════════════════════════════════════════════════════════════

/**
 * 全盘 draw call 预算上限（Phase D4 / 验收 V8）。
 * 依据：design/art/piece-animation-spec.md §5.2 性能预算（新增子组后总 draw call ≤155，现 141~145）。
 * 用途：性能剖析门禁（tests/node/perf-contract.test.js PERF-001）+ 浏览器 profiling 对照基准。
 */
export const DRAW_CALL_BUDGET = 155;

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

export const DISSOLVE_POSE = {
  [PT.PAWN]: {
    desc: '瘫软前倒',
    rotX: -0.6, rotXDuration: 0.3,
    scaleY: 0.7,
    subGroupActions: null
  },
  [PT.HORSE]: {
    desc: '前扑',
    rotX: 0, liftY: 0.03,
    subGroupActions: {
      mount:  { rotX: +0.5 },
      rider:  { rotX: +0.4 }
    }
  },
  [PT.ELEPHANT]: {
    desc: '侧倾',
    rotZ: 0.35, rotZDir: 'random',
    subGroupActions: {
      arms: { rotZ: 0.5, dir: 'match' }
    }
  },
  [PT.ADVISOR]: {
    desc: '后仰脱剑',
    rotX: +0.5,
    subGroupActions: {
      sword: { translateY: -0.3 }
    }
  },
  [PT.ROOK]: {
    desc: '侧翻',
    rotZ: 0.55, rotZDir: 'random',
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
    rotX: +0.4,
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
    breatheAmp: 0.012,
    swayAmp: 0.014,
    breatheHz: 1.15,
    actionInterval: [4, 6],
    actionProb: 0.18
  },
  I1: {
    ampMul: 1.8,
    breatheHz: 1.15,
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

/**
 * 七兵种个性化待机参数（piece-image-v4 §3.2~3.8，数据唯一真相源；animator.tickIdle 读取）。
 *
 * 波形定义：
 *   正弦  S(freqHz, phOff, amp) = amp * sin(2π·freqHz·t + ph + phOff)
 *   脉冲  pulse(u) = sin(πu)²,  u = fract(t/T + ph/2π)   —— 确定性门控，每 T 秒一次光滑凸起
 *
 * 字段：
 *   breathe / sway  —— L0 呼吸层幅度（idleGroup.position.y / rotation.z；K/A 最稳）
 *   l1  [sub, axis, amp, freqHz, phOff]  —— L1 子组微动层（个性化主体）
 *   l2  [sub, axis, amp, period, phOff, gate?]  —— L2 偶发脉冲层；gate: 'phPlus'(sin(ph)>0)/'phMinus'
 *   zeroChannels    —— _busy 时幂等归零的通道（= 待机写入 ∩ 战斗未写入；绝不与 windUp/strike/settle 打架）
 *
 * 幅度边界（P3 「战场活气」上调 —— 修复用户实机反馈「棋子呆呆的」）：
 *   ★ 根因：原表 L1 峰值 ≤0.06 rad（≈3.4°）、频率 0.18~0.40Hz（周期 2.5~5.6s），
 *     在正常观战距离下人眼几乎无法察觉 → 视觉上等同静止（「呆」）。
 *   ★ 修法：L1 幅度整体 ×1.9~2.2、频率 ×2.0~2.3（设计稿 §120 明确要求马摆频 ≥0.45Hz，
 *     原实现 0.26 违规）；L2 脉冲周期从 5~7s 压到 3~3.8s（叩击/刨蹄要成为可感知节律）。
 *   新边界：待机 rotation 峰值（未选中）≤ 0.13、position.y ≤ 0.026；
 *     选中放大系数由 1.8 降到 1.4（补偿基数上调，选中峰值 ≤ ~0.18 防穿模）。
 */
export const IDLE_PIECE = {
  [PT.PAWN]: {
    desc: '戈叩盾：缓摆 + 叩击脉冲（P）',
    breathe: 0.020, sway: 0.026,
    l1: [
      ['arm', 'z', 0.115, 0.62, 0],
      ['arm', 'x', 0.075, 0.62, 0.6],
      ['body', 'x', 0.052, 0.62, Math.PI]
    ],
    l2: [
      ['arm', 'x', 0.130, 3.2],
      ['body', 'x', -0.050, 3.2]
    ],
    // windUp 写 arm.x → 只归零 arm.z / body.x
    zeroChannels: ['arm.rotation.z', 'body.rotation.x']
  },
  [PT.HORSE]: {
    desc: '扬前身 + 骑手对位后仰（N）',
    breathe: 0.020, sway: 0.026,
    l1: [
      // 设计稿 §120：mount.x 摆频须提升至 0.45Hz 以上近似奔跑感（原 0.26 违规）
      ['mount', 'x', -0.105, 0.58, 0],
      ['rider', 'x', 0.062, 0.58, 0],
      ['rider', 'z', 0.048, 0.58, 1.0]
    ],
    l2: [
      ['mount', 'x', -0.090, 3.6]
    ],
    // windUp 写 mount.x / rider.x → 只归零 rider.z
    zeroChannels: ['rider.rotation.z']
  },
  [PT.ELEPHANT]: {
    desc: '展卷吟诵：简牍微举复落（B）',
    breathe: 0.020, sway: 0.024,
    l1: [
      ['arms', 'z', 0.125, 0.54, 0],
      ['arms', 'x', 0.058, 0.54, 0.8],
      ['robe', 'x', 0.050, 0.54, Math.PI]
    ],
    l2: [
      ['arms', 'x', 0.110, 3.8]
    ],
    // windUp/strike 写 arms.z / robe.x(/z) → 只归零 arms.x
    zeroChannels: ['arms.rotation.x']
  },
  [PT.ADVISOR]: {
    desc: '蓄势警戒：全场最静、无脉冲（A）',
    breathe: 0.015, sway: 0.016,
    l1: [
      ['body', 'z', 0.030, 0.72, 0],
      ['sword', 'z', 0.055, 0.72, 0.5],
      ['arms', 'x', 0.035, 0.72, Math.PI]
    ],
    l2: [],
    // windUp 写 sword.z → 只归零 body.z / arms.x
    zeroChannels: ['body.rotation.z', 'arms.rotation.x']
  },
  [PT.ROOK]: {
    desc: '双马刨蹄 + 御者勒缰 + 车舆滞后（R）',
    breathe: 0.018, sway: 0.022,
    l1: [
      ['horses', 'x', 0.095, 0.56, 0],
      ['body', 'x', 0.040, 0.56, -0.8],
      ['driver', 'x', 0.070, 0.56, 1.2]
    ],
    l2: [
      ['horses', 'x', 0.100, 3.0]
    ],
    // windUp/strike 写 spearman.x / driver.x / horses.x → 只归零 body.x
    // （horses.rotation.x 是战斗通道：A2 双马前冲由 strike 写，若被 busy 每帧归零则视觉无效 —— §4.3 纪律；
    //   body.rotation.x 仅待机 L1 写、战斗不写，仍为合法 zeroChannel）
    zeroChannels: ['body.rotation.x']
  },
  [PT.CANNON]: {
    desc: '双兵左右反相检修 + 脉冲侧向交替（C）',
    breathe: 0.018, sway: 0.022,
    l1: [
      ['soldierL', 'x', 0.100, 0.52, 0],
      ['soldierR', 'x', 0.100, 0.52, Math.PI],
      ['trebuchet', 'z', 0.040, 0.52, 0.5]
    ],
    l2: [
      ['soldierL', 'x', 0.095, 3.4, 0, 'phPlus'],
      ['soldierR', 'x', 0.095, 3.4, 0, 'phMinus']
    ],
    // 全部通道均被 windUp/strike 覆盖 → 无需额外归零（settle 会复位）
    zeroChannels: []
  },
  [PT.KING]: {
    desc: '抚椅：rArm 抚扶手摩挲 + body 微沉肩 + 王座如磐 + 帅旗微扬（K）',
    breathe: 0.015, sway: 0.016,
    l1: [
      ['rArm', 'z', 0.115, 0.40, 0],
      ['rArm', 'x', 0.070, 0.40, 1.2],
      ['body', 'x', 0.050, 0.40, 0.6],
      ['throne', 'x', 0.014, 0.40, 0],
      // 设计稿 §224：帅旗用最低频制造「风吹旗角」而非「摆动」→ 频率保持 0.30，只加幅度
      ['banner', 'z', 0.095, 0.30, 2.0]
    ],
    l2: [],
    // windUp 写 sword.z / throne.x → 只归零 rArm.z / rArm.x / body.x / banner.z
    zeroChannels: ['rArm.rotation.z', 'rArm.rotation.x', 'body.rotation.x', 'banner.rotation.z']
  }
};

// ═══════════════════════════════════════════════════════════════
// §8.5 数据驱动姿态表 POSE_TABLE（Phase A3 + B1-B5）
// ═══════════════════════════════════════════════════════════════

/**
 * 兵种姿态四元组数据表：每兵种 × 三态（idle/move/capture）× 三段式（anticipation/action/recovery）。
 *
 * 来源：design/art/piece-animation-spec.md §3（每兵种关键帧/时长/缓动/子组四元组）、§4.3（子组命名）、
 *       design/gameplay/piece-combat-action-design.md §4（节奏表，总长锚定 MOVE_TOTAL/CAPTURE_TOTAL）。
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
    idle: {
      anticipation: { sub: { body: { rotation: { x: 0.028 } } }, duration: 0.87, ease: 'easeOutQuad', channels: ['body.rotation.x'] },
      action: { sub: { arm: { rotation: { x: 0.055 } } }, duration: 5.0, ease: 'easeOutQuad', channels: ['arm.rotation.x'] },
      recovery: { sub: { arm: { rotation: { z: 0 } } }, duration: 0.5, ease: 'easeInOutQuad', channels: ['arm.rotation.z'] }
    },
    move: {
      anticipation: { sub: { arm: { rotation: { x: -0.15 } } }, duration: 0.14, ease: 'easeOutQuad', channels: ['arm.rotation.x'] },
      action: { sub: { arm: { rotation: { x: -0.32 } }, legs: { rotation: { x: 0.16 } } }, duration: 0.14, ease: 'easeInCubic', channels: ['arm.rotation.x', 'legs.rotation.x'] },
      recovery: { sub: { arm: { rotation: { x: 0 } }, legs: { rotation: { x: 0 } } }, duration: 0.30, ease: 'easeInOutQuad', channels: ['arm.rotation.x', 'legs.rotation.x'] }
    },
    capture: {
      anticipation: { sub: { arm: { rotation: { x: -0.25 } } }, duration: 0.13, ease: 'easeOutQuad', channels: ['arm.rotation.x'] },
      action: { sub: { arm: { rotation: { x: -0.55 } } }, duration: 0.09, ease: 'easeInCubic', channels: ['arm.rotation.x'] },
      recovery: { sub: { arm: { rotation: { x: 0 } } }, duration: 0.24, ease: 'easeInOutQuad', channels: ['arm.rotation.x'] }
    }
  },
  [PT.HORSE]: {
    idle: {
      anticipation: { sub: { mount: { rotation: { x: -0.048 } } }, duration: 0.87, ease: 'easeOutQuad', channels: ['mount.rotation.x'] },
      action: { sub: { mount: { rotation: { x: -0.040 } } }, duration: 6.5, ease: 'easeOutQuad', channels: ['mount.rotation.x'] },
      recovery: { sub: { rider: { rotation: { z: 0 } } }, duration: 0.5, ease: 'easeInOutQuad', channels: ['rider.rotation.z'] }
    },
    move: {
      anticipation: { sub: { rider: { rotation: { x: -0.10 } } }, duration: 0.14, ease: 'easeOutQuad', channels: ['rider.rotation.x'] },
      action: { sub: { mount: { rotation: { x: -0.22 } }, rider: { rotation: { x: -0.25 } } }, duration: 0.08, ease: 'easeInCubic', channels: ['mount.rotation.x', 'rider.rotation.x'] },
      recovery: { sub: { mount: { rotation: { x: 0 } }, rider: { rotation: { x: 0 } } }, duration: 0.30, ease: 'easeInOutQuad', channels: ['mount.rotation.x', 'rider.rotation.x'] }
    },
    capture: {
      anticipation: { sub: { mount: { rotation: { x: 0.1 } }, rider: { rotation: { x: -0.2 } } }, duration: 0.15, ease: 'easeOutQuad', channels: ['mount.rotation.x', 'rider.rotation.x'] },
      action: { sub: { rider: { rotation: { x: -0.75 } }, mount: { rotation: { x: -0.35 } } }, duration: 0.09, ease: 'easeInCubic', channels: ['rider.rotation.x', 'mount.rotation.x'] },
      recovery: { sub: { rider: { rotation: { x: 0 } }, mount: { rotation: { x: 0 } } }, duration: 0.28, ease: 'easeInOutQuad', channels: ['rider.rotation.x', 'mount.rotation.x'] }
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
      action: { sub: { arms: { rotation: { z: 0.22 } }, robe: { rotation: { x: 0.15 } } }, duration: 0.16, ease: 'easeInCubic', channels: ['arms.rotation.z', 'robe.rotation.x'] },
      recovery: { sub: { arms: { rotation: { z: 0 } }, robe: { rotation: { x: 0 } } }, duration: 0.30, ease: 'easeInOutQuad', channels: ['arms.rotation.z', 'robe.rotation.x'] }
    },
    capture: {
      anticipation: { sub: { arms: { rotation: { z: -0.3 } }, robe: { rotation: { x: 0.15 } } }, duration: 0.18, ease: 'easeOutQuad', channels: ['arms.rotation.z', 'robe.rotation.x'] },
      action: { sub: { arms: { rotation: { z: 0.75 } }, robe: { rotation: { z: 0.40 } } }, duration: 0.09, ease: 'easeInCubic', channels: ['arms.rotation.z', 'robe.rotation.z'] },
      recovery: { sub: { arms: { rotation: { z: 0 } }, robe: { rotation: { z: 0, x: 0 } } }, duration: 0.32, ease: 'easeInOutQuad', channels: ['arms.rotation.z', 'robe.rotation.z'] }
    }
  },
  [PT.ADVISOR]: {
    idle: {
      anticipation: { sub: { body: { rotation: { z: 0.014 } } }, duration: 0.87, ease: 'easeOutQuad', channels: ['body.rotation.z'] },
      action: { sub: { sword: { rotation: { z: 0.024 } } }, duration: 2.5, ease: 'easeOutQuad', channels: ['sword.rotation.z'] },
      recovery: { sub: { body: { rotation: { z: 0 } } }, duration: 0.5, ease: 'easeInOutQuad', channels: ['body.rotation.z'] }
    },
    move: {
      anticipation: { sub: { sword: { rotation: { z: -0.08 } } }, duration: 0.14, ease: 'easeOutQuad', channels: ['sword.rotation.z'] },
      action: { sub: { sword: { rotation: { z: -0.12 } }, shield: { rotation: { x: -0.10 } } }, duration: 0.08, ease: 'easeInCubic', channels: ['sword.rotation.z', 'shield.rotation.x'] },
      recovery: { sub: { sword: { rotation: { z: 0 } }, shield: { rotation: { x: 0 } } }, duration: 0.26, ease: 'easeInOutQuad', channels: ['sword.rotation.z', 'shield.rotation.x'] }
    },
    capture: {
      anticipation: { sub: { sword: { rotation: { z: -0.4 } }, shield: { rotation: { x: -0.15 } } }, duration: 0.13, ease: 'easeOutQuad', channels: ['sword.rotation.z', 'shield.rotation.x'] },
      action: { sub: { sword: { rotation: { z: -0.85 } }, shield: { rotation: { x: -0.25 } } }, duration: 0.08, ease: 'easeInCubic', channels: ['sword.rotation.z', 'shield.rotation.x'] },
      recovery: { sub: { sword: { rotation: { z: 0 } }, shield: { rotation: { x: 0 } } }, duration: 0.26, ease: 'easeInOutQuad', channels: ['sword.rotation.z', 'shield.rotation.x'] }
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
    idle: {
      anticipation: { sub: { rArm: { rotation: { z: 0.058 } } }, duration: 0.87, ease: 'easeOutQuad', channels: ['rArm.rotation.z'] },
      action: { sub: { banner: { rotation: { z: 0.034 } } }, duration: 2.5, ease: 'easeOutQuad', channels: ['banner.rotation.z'] },
      recovery: { sub: { rArm: { rotation: { z: 0 } } }, duration: 0.5, ease: 'easeInOutQuad', channels: ['rArm.rotation.z'] }
    },
    move: {
      anticipation: { sub: { throne: { rotation: { x: 0.06 } } }, duration: 0.14, ease: 'easeOutQuad', channels: ['throne.rotation.x'] },
      action: { sub: { throne: { rotation: { x: -0.06 } }, sword: { rotation: { z: -0.10 } } }, duration: 0.12, ease: 'easeInCubic', channels: ['throne.rotation.x', 'sword.rotation.z'] },
      recovery: { sub: { throne: { rotation: { x: 0 } }, sword: { rotation: { z: 0 } } }, duration: 0.30, ease: 'easeInOutQuad', channels: ['throne.rotation.x', 'sword.rotation.z'] }
    },
    capture: {
      anticipation: { sub: { sword: { rotation: { z: -0.25 } }, throne: { rotation: { x: -0.10 } } }, duration: 0.17, ease: 'easeOutQuad', channels: ['sword.rotation.z', 'throne.rotation.x'] },
      action: { sub: { sword: { rotation: { z: -0.40 } }, throne: { rotation: { x: -0.15 } } }, duration: 0.08, ease: 'easeInCubic', channels: ['sword.rotation.z', 'throne.rotation.x'] },
      recovery: { sub: { sword: { rotation: { z: 0 } }, throne: { rotation: { x: 0 } } }, duration: 0.30, ease: 'easeInOutQuad', channels: ['sword.rotation.z', 'throne.rotation.x'] }
    }
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
