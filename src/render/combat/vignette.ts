/**
 * vignette.ts —— R-2 待机 vignette 序列器（纯数据 + 纯函数求值器）
 *
 * 设计依据：.workbuddy/output/系统设计.md §3.2.M5.19（L1222–L1391）七兵种分步流程。
 * 本文件是「分步、闭合、兵种特性化」待机的数据真相源，取代旧的「sum of sines 呼吸 +
 * 正弦微颤 + 门控脉冲」假待机。
 *
 * 通道纪律（R-1 红线 / 主理人裁定 D1）：
 *   - VigCh 只写子组 rotation（sg[sub].rotation[axis]），axis ∈ {x,y,z}。
 *   - 禁写 sub ∈ {root, orient, idleGroup}；禁写任何 position。
 *   - 部件级离地（蹄/靴/甲片 y 抬升）由绕关节的 rotation 自然产生，不写 position。
 *
 * 通道避让纪律（§4.3，最易踩的坑）：
 *   zeroChannels 只能收录「待机写入 ∩ 战斗不写」的通道。**战斗通道严禁进 zeroChannels**，
 *   否则 _busy 期间每帧归零会把战斗动作吞掉（历史 ROOK `horses.rotation.x` 即此类 bug）。
 *   ★ S0 护栏（M-08a · DP-4）：原先散落在各兵种定义里的「战斗通道黑名单」已**删除**，
 *     改由 `CombatConstants.deriveZeroChannels(type)` **程序化派生**
 *     （= `writtenChannels(VIGNETTE[type]) − deriveCombatChannels(type)`），
 *     战斗通道集由 `POSE_TABLE[type].move ∪ capture` ∪ `DISSOLVE_POSE[type]` ∪
 *     `CHOREO_WRITE_CHANNELS[type]`（编排层直写）自动演化（R-Z2）。
 *     ★ S0.1（M-08a2）：`deriveCombatChannels` 的语义边界扩到 **move ∪ capture**（原只 capture）。
 *     健康度由 `scripts/check-piece-contract.mjs` 逐型断言（`zeroChannels ∩ 战斗通道 = ∅`）。
 *
 * 建模段缺失子组处理（主理人裁定 §3 末尾）：
 *   §3.2.M5.19.8 标注「建模段新增」的子组，绝大多数**尚未**在 pieceFactory.SUBGROUP_JOINTS
 *   注册（实测：仅 P 的 legL/legR/armL、N 的 legFL、B 的 hem/bodyRobe、C 的 counterweight、
 *   R 的 spearman/driver 存在）。本文件**不新建 3D 子组**（属建模段职责，且受 draw-call
 *   预算约束），也不降解去占用战斗通道：
 *     - 概念通道（`scroll` / `winch` / `gear`）如实声明 → animator 因 sg[sub] 缺失而安全跳过，
 *       留 TODO 待建模段补建后自动生效。
 *     - 无合适替代者且原始子组缺失的动作（A 移步抬脚 legL/legR、N 甩鬃 mane、R 双马前蹄
 *       horses.legF / 瞭望抬手 armL / 挥戈 armR、C 擦拭 cloth / 上油 oiler）**如实缺省**，
 *       不用「摆动盾牌/后腿」之类的错肢替代（会说谎观感且可能撞战斗通道）。
 *
 * 求值模型（闭合保证）：
 *   - loopStart[key] =（该通道首关键帧位于分段 0）? 首关键帧 to : (baseline[key] ?? 0)
 *   - 普通关键帧：value = lerp(prevTo, to, easeInOutCubic(e))
 *   - osc 关键帧：value = to + swing·(1 − cos(2π·reps·ease(e)))/2（起止均为 to，整数次往复）
 *   - 通道在某段未出现 → 保持上一段末值（不自作归零），闭合由数据显式写出。
 *   - 末关键帧 to / osc 中心必须等于 loopStart，故 evalVignette(def,0) ≡ evalVignette(def,1⁻)
 *     （闭合误差 ≤0.005 rad，由 qa/tests/node/idle-vignette.test.js 断言）。
 */

export type VigAxis = 'x' | 'y' | 'z';

export interface VigCh {
  sub: string;        // 子组名（必须存在于该兵种 ud.subGroups；缺失则 animator 跳过）
  axis: VigAxis;      // 只允许 rotation
  to: number;         // 段末目标值（rad）；osc 通道时为「往复中心值」
  osc?: boolean;      // true = 本段内往复振荡
  swing?: number;     // osc 时的偏移量（在 to 与 to+swing 之间往复；= 振幅）
  reps?: number;      // osc 往复「整数次」（未给则 1）
}

export interface VigSeg {
  name: string;       // 对应文档分步名
  weight: number;     // 占比，Σ = 1
  channels: VigCh[];
}

export interface VigMech { sub: string; periodRatio: number }  // periodSec = loopSec_i / periodRatio

export interface VignetteDef {
  loopSec: number;            // 3–8s，逐兵种见 §3.2.M5.19.8
  crossfadeSec: number;       // 0.15–0.25，逐兵种见 §3.2.M5.19.8
  variantCount: number;       // 2–4（§9.5.3）
  baseline: VigCh[];          // 静态基准（L1 IDLE_BASE；1–3 条，取自文档「点选激活」的 L1 基准）
  segments: VigSeg[];         // 5 段（R 车 6 段）
  mech?: VigMech[];           // C 炮：winch(ratio 2) / gear(ratio 8)（待建模段）
  // ★ S0 护栏（M-08a · DP-4）：`zeroChannels` 字段已**移除** —— 原为逐兵种手工维护的
  //   「战斗通道黑名单」，M-07 复核确认其中的 `K.banner.z` 越界（该通道亦被 POSE_TABLE.K 四态驱动）。
  //   现由 `CombatConstants.ts` 的 `deriveZeroChannels(type)` **程序化派生**
  //   （`writtenChannels(VIGNETTE[type]) − deriveCombatChannels(type)`），杜绝手工维护漏项。
}

/** 怠速层增益（「折中」激活：全盘极小幅度微动，仅选中播全量）。 */
export const IDLE_BASE_GAIN = 0.25;
/** 变体驻留系数：dwellSec = max(8, loopSec × 此值)（打破 ~90s 可察觉重复）。 */
export const IDLE_VARIANT_DWELL_FACTOR = 3;

// ---------------------------------------------------------------------------
// 缓动（本地副本：避免与 animator 循环依赖；vignette 被测试直接 import）
// 项目现有 easeInOutCubic 语义，保持与战斗包络一致。
// ---------------------------------------------------------------------------
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------------
// 数据构建辅助
// ---------------------------------------------------------------------------
function ch(sub: string, axis: VigAxis, to: number, extra?: Partial<VigCh>): VigCh {
  return { sub, axis, to, ...extra };
}
function seg(name: string, weight: number, channels: VigCh[]): VigSeg {
  return { name, weight, channels };
}

// ===========================================================================
// §3.2.M5.19.8 七兵种待机参数汇总 + 逐兵种分步流程数据
// ===========================================================================

// --- K 帅/将（loop 7.0s, crossfade 0.25s, 5 段, 2 变体）---------------------
// L1 基准：sword.z=0.05, body.x=0.04（坐于席位）
// 交付：按剑凝思 ✓ / 手指示意 ✓（rArm.x）/ 收手 ✓ / 帅旗微扬 ✓（banner.z）
//       展阅简牍 —— `scroll` 待建模段，通道如实声明但当前被 animator 跳过
const KING: VignetteDef = {
  loopSec: 7.0, crossfadeSec: 0.25, variantCount: 2,
  baseline: [ch('sword', 'z', 0.05), ch('body', 'x', 0.04)],
  // zeroChannels 由 deriveZeroChannels() 派生（S0 · DP-4）→ 本表不再手工维护
  segments: [
    seg('按剑凝思', 0.18, [
      ch('sword', 'z', 0.05),   // 微沉 +0.05（坐姿凝思）
      ch('body', 'x', 0.04)     // 前倾 +0.04
    ]),
    seg('手指示意', 0.22, [
      ch('rArm', 'x', -0.30),   // 抬起 −0.30 指向前方阵列
      ch('banner', 'z', 0.06, { osc: true, swing: 0.06, reps: 1 }) // 帅旗受风微扬（te=1 回 0.06）
    ]),
    seg('收手回按剑', 0.14, [
      ch('rArm', 'x', -0.06),   // 回落 −0.06
      ch('sword', 'z', 0.05)    // 归 +0.05
    ]),
    seg('展阅简牍', 0.26, [
      // TODO(建模段补齐): 'scroll' 子组未在 pieceFactory.SUBGROUP_JOINTS 注册；
      //   补建后本通道自动生效（animator 现因其 sg['scroll'] 缺失而安全跳过）。
      ch('scroll', 'z', 0.55),  // 展卷 0 → 0.55
      ch('rArm', 'x', -0.18),   // 托持 −0.18
      ch('body', 'x', 0.06)     // 低头阅 +0.06
    ]),
    seg('卷收归位', 0.20, [
      ch('scroll', 'z', 0),     // 卷收 0.55 → 0
      ch('rArm', 'x', 0),       // → 0（首帧基准）
      ch('body', 'x', 0.04),    // 闭合首帧 +0.04
      ch('banner', 'z', 0)      // 闭合 → 0
    ])
  ]
};

// --- A 仕/士（loop 4.5s, crossfade 0.20s, 5 段, 2 变体）---------------------
// L1 基准：sword.z=0.055, arms.x=−0.035（全场最静）
// 交付：按剑戒备 ✓ / 整饬甲胄 ✓（arms.x）/ 手回按剑 ✓
//       移步护卫左·右 —— `legL`/`legR`/`armor` 待建模段。**不用 shield.x 替代**
//       （shield 是战斗相关子组，摆动盾牌既非「抬脚」也易与 windUp 打架）→ 该步如实缺省，
//       仅保留 body.y 上身微扫（±0.08）。
const ADVISOR: VignetteDef = {
  loopSec: 4.5, crossfadeSec: 0.20, variantCount: 2,
  baseline: [ch('sword', 'z', 0.055), ch('arms', 'x', -0.035)],
  segments: [
    seg('按剑戒备', 0.20, [
      ch('sword', 'z', 0.055),  // +0.055
      ch('arms', 'x', -0.035),  // −0.035
      ch('body', 'z', 0)        // 正身 0
    ]),
    seg('小幅移步护卫·左', 0.22, [
      // TODO(建模段补齐): 'legL' 子组未注册 → 抬脚动作缺省（不用 shield 替代）。
      ch('body', 'y', -0.08)    // 上身微扫 −0.08（root 不位移）
    ]),
    seg('小幅移步护卫·右回位', 0.22, [
      // TODO(建模段补齐): 'legR' 子组未注册 → 抬脚动作缺省。
      ch('body', 'y', 0)        // 回中
    ]),
    seg('举手整饬甲胄', 0.24, [
      ch('arms', 'x', -0.16)    // 抬手扶肩甲 −0.16
      // TODO(建模段补齐): 'armor' 为部件 y 微移（+0.01），VigCh 仅支持 rotation，略去。
    ]),
    seg('手回按剑', 0.12, [
      ch('arms', 'x', -0.035),  // → −0.035（闭合首帧）
      ch('sword', 'z', 0.055)   // → +0.055（闭合首帧）
    ])
  ]
};

// --- B 相/象（loop 6.0s, crossfade 0.22s, 5 段, 2 变体）---------------------
// L1 基准：arms.z=+0.06（执物基准）
// 交付：执笏秉笔 ✓（arms.z）/ 谋士揖礼 ✓（arms.x + bodyRobe.x 微躬）/ 起身回中 ✓
//       摇扇沉思 —— `fan` 待建模段。近似为 `arms.z` 往复（手执扇/笏摆动，非摆下摆）
//       ±0.30 × 3 整数次，中心取执笏值 0.12 以闭合；`robe` 未注册 → 改用真实子组 `bodyRobe`。
const ELEPHANT: VignetteDef = {
  loopSec: 6.0, crossfadeSec: 0.22, variantCount: 2,
  baseline: [ch('arms', 'z', 0.06)],
  segments: [
    seg('执笏秉笔', 0.20, [
      ch('arms', 'z', 0.12)     // 执笏 +0.12
      // TODO(建模段补齐): 'brush' 为部件微移（position），VigCh 仅支持 rotation，略去。
    ]),
    seg('摇扇沉思', 0.26, [
      // TODO(建模段补齐): 'fan' 未注册 → 以 arms.z 往复近似（±0.30，3 整数次，中心=执笏值）。
      ch('arms', 'z', 0.12, { osc: true, swing: 0.30, reps: 3 }),
      ch('bodyRobe', 'x', 0.03) // 袍身 +0.03
    ]),
    seg('收扇', 0.12, [
      ch('arms', 'z', 0.06)     // → +0.06
    ]),
    seg('谋士揖礼', 0.28, [
      ch('arms', 'x', -0.22),   // 双手前拱 −0.22
      ch('bodyRobe', 'x', 0.05) // 微躬 +0.05（由子组承担，root 恒 0 不前倾）
    ]),
    seg('起身回中', 0.14, [
      ch('arms', 'x', 0),       // → 0
      ch('arms', 'z', 0.12),    // → +0.12
      ch('bodyRobe', 'x', 0)    // → 0（闭合首帧）
    ])
  ]
};

// --- N 马（loop 4.0s, crossfade 0.15s, 5 段, 3 变体）-------------------------
// L1 基准：bodyHorse.x=−0.04, rider.x=+0.05
// 交付（**本兵种核心动作全数落地**）：昂首 ✓ / 前蹄扬起 ✓ / 刨地 ✓ / 前蹄落回 ✓（legFL 真实存在）
//       甩鬃 —— `mane` 待建模段 → 缺省（**不用 legBL 后腿替代**，那会摆动错肢）；保留 bodyHorse.y 头微甩 ±0.06
const HORSE: VignetteDef = {
  loopSec: 4.0, crossfadeSec: 0.15, variantCount: 3,
  baseline: [ch('bodyHorse', 'x', -0.04), ch('rider', 'x', 0.05)],
  segments: [
    seg('昂首', 0.18, [
      ch('bodyHorse', 'x', -0.10), // 扬首 −0.10（首帧入口值）
      ch('rider', 'x', 0.05)       // 对位压身 +0.05
    ]),
    seg('前蹄扬起', 0.20, [
      ch('legFL', 'x', -0.45)      // 前蹄扬起 −0.45（部件级离地，root 恒 0）
    ]),
    seg('刨地', 0.24, [
      ch('legFL', 'x', -0.45, { osc: true, swing: 0.25, reps: 2 }) // −0.45↔−0.20 刮擦 2 整数次
    ]),
    seg('前蹄落回', 0.14, [
      ch('legFL', 'x', 0)          // 落回 0
    ]),
    seg('甩鬃', 0.24, [
      // TODO(建模段补齐): 'mane' 未注册 → 甩鬃缺省（不用 legBL 替代）。
      ch('bodyHorse', 'y', 0, { osc: true, swing: 0.06, reps: 1 }) // 头微甩 ±0.06
    ])
  ]
};

// --- R 车（loop 5.5s, crossfade 0.20s, 6 段, 4 变体）-------------------------
// L1 基准：driver.x=+0.03（御者持缰）；持戈兵立姿
// 交付：御马兵控缰 ✓（driver.x）/ 车舆滞后颠簸 ✓（body.x）/ 瞭望左右扫视 ✓（spearman.y）
//       挥戈 —— 近似为 `spearman.z` 整体扭转 1 次（armR 未注册；不用 spearman.x 战斗通道）
//       双马前蹄扬起 / 刨地 —— `horses.legF` 待建模段，缺省（horses.x 是战斗通道不可占用）
// 机械层：wheelL/R 待机锁定、rotation.x 增量恒 0（禁空转，避免视觉打滑）—— 本文件不写该通道。
const ROOK: VignetteDef = {
  loopSec: 5.5, crossfadeSec: 0.20, variantCount: 4,
  baseline: [ch('driver', 'x', 0.03)],
  // 纪律：horses.x / driver.x / spearman.x 均为战斗通道 → 由派生天然排除。
  segments: [
    seg('御马兵控缰', 0.18, [
      ch('driver', 'x', 0.07)      // 收缰 +0.07
    ]),
    seg('双马前蹄扬起', 0.16, [
      // TODO(建模段补齐): 'horses.legF' 未注册；horses.x 是战斗通道（A2 双马前冲由 strike 写）
      //   不可占用、亦无空闲子组可近似 → 双马扬蹄如实缺省，仅保留车舆同步点。
      ch('body', 'x', 0.04)        // 车舆起势 +0.04
    ]),
    seg('双马刨地', 0.20, [
      ch('body', 'x', 0.04, { osc: true, swing: 0.03, reps: 2 }) // 车舆滞后颠簸 2 次
    ]),
    seg('前蹄落回+稳缰', 0.14, [
      ch('driver', 'x', 0.07),     // 稳缰 → +0.07（闭合首帧）
      ch('body', 'x', 0)           // 车舆落定 → 0（闭合）
    ]),
    seg('持戈兵瞭望', 0.20, [
      // TODO(建模段补齐): 'spearman.armL' 未注册 → 抬手遮目缺省（不用 spearman.x 战斗通道）。
      ch('spearman', 'y', 0, { osc: true, swing: 0.14, reps: 1 }) // 左右扫视 ±0.14
    ]),
    seg('挥戈', 0.12, [
      // TODO(建模段补齐): 'spearman.armR'/'ge' 未注册 → 以 spearman.z 整体扭转近似挥戈 1 次。
      ch('spearman', 'z', 0, { osc: true, swing: 0.35, reps: 1 })
    ])
  ]
};

// --- C 炮（loop 8.0s, crossfade 0.25s, 5 段, 4 变体，含机械层）---------------
// L1 基准：soldierL.x=−0.04, soldierR.x=−0.04, trebuchet.z=0
// 交付：校正瞄准 ✓（trebuchet.z 三次递减微步）/ 双兵扶架往复 ✓（soldierL.x 擦拭、soldierR.x 上油）
//       齿轮·绞盘联动 —— `winch`/`gear` 待建模段（通道如实声明，animator 跳过）；
//         `cloth`/`oiler`/`rope` 同为待建模段 → 缺省；
//         **counterweight 待机不写**（§3.2.M5.19.6 明确「待机静置，仅 FIRE 段参与」）。
// 机械层：winch(rotation.y, T=loopSec/2) + gear(rotation.y, T=loopSec/8)，相位 ph_mech = idlePhase×0.5，
//   匀速连续、独立于肢体相位、周期整除 loopSec_i（逐枚仍无缝闭合）。
const CANNON: VignetteDef = {
  loopSec: 8.0, crossfadeSec: 0.25, variantCount: 4,
  baseline: [ch('soldierL', 'x', -0.04), ch('soldierR', 'x', -0.04), ch('trebuchet', 'z', 0)],
  // 全部肢体通道均被 windUp/strike 覆盖，settle 会复位 → 派生结果为零集。
  mech: [
    { sub: 'winch', periodRatio: 2 }, // T_w = loopSec_i / 2
    { sub: 'gear', periodRatio: 8 }   // T_g = loopSec_i / 8
  ],
  segments: [
    seg('擦拭抛臂', 0.18, [
      ch('soldierL', 'x', -0.04, { osc: true, swing: 0.12, reps: 2 }), // 沿臂来回擦拭 2 整数次（中心=基准）
      // TODO(建模段补齐): 'cloth' 未注册（部件微移）。
    ]),
    seg('上油', 0.16, [
      ch('soldierR', 'x', -0.14)    // 靠近绞盘 −0.14
      // TODO(建模段补齐): 'oiler' 未注册 → 油壶倾倒缺省（counterweight 属 FIRE 通道，待机不写）。
    ]),
    seg('齿轮·绞盘联动', 0.22, [
      // 机械层（winch/gear）由 animator._writeMech 独立匀速驱动，见本文件 mech。
      // TODO(建模段补齐): 'rope' 软体随动（position ≤0.02）VigCh 不支持。
    ]),
    seg('校正瞄准', 0.24, [
      ch('trebuchet', 'z', 0, { osc: true, swing: 0.05, reps: 3 }) // 三次递减微步（近似，闭合回 0）
    ]),
    seg('退后端详', 0.20, [
      ch('soldierL', 'x', -0.04),   // 端详（回基准）
      ch('soldierR', 'x', -0.04)    // 回基准
    ])
  ]
};

// --- P 兵/卒（loop 3.5s, crossfade 0.18s, 5 段, 3 变体）---------------------
// L1 基准：armR.z=+0.08（持矛）, body.x=0（立正）
// 交付（**本兵种核心动作全数落地**）：持矛挺立 ✓ / 举目远眺瞭望 ✓（armL.x）/
//   收手 ✓ / 小幅踏步 ✓（legR→legL 错相）/ 矛尖顿地 ✓（armR.z 0.08→0.02→0.08）
const PAWN: VignetteDef = {
  loopSec: 3.5, crossfadeSec: 0.18, variantCount: 3,
  baseline: [ch('armR', 'z', 0.08), ch('body', 'x', 0)],
  segments: [
    seg('持矛挺立', 0.20, [
      ch('armR', 'z', 0.08),    // 持矛 +0.08
      ch('body', 'x', 0)        // 立正 0
    ]),
    seg('举目远眺瞭望', 0.26, [
      ch('armL', 'x', -0.38),   // 抬手遮目 −0.38（部件级离地）
      ch('body', 'y', 0.12)     // 扫视 +0.12
    ]),
    seg('收手', 0.12, [
      ch('armL', 'x', 0),       // → 0
      ch('body', 'y', 0)        // → 0
    ]),
    seg('小幅踏步', 0.30, [
      // P 的 legR/legL 已在 SUBGROUP_JOINTS.P 注册（真实子组）；双脚不同时离地
      //   （按错相 π 分置于两段内，此处各 1 次、由分段顺序天然错开）。
      ch('legR', 'x', 0, { osc: true, swing: 0.16, reps: 1 }), // 抬脚→落
      ch('legL', 'x', 0, { osc: true, swing: 0.16, reps: 1 })  // 抬脚→落
    ]),
    seg('矛尖顿地', 0.12, [
      ch('armR', 'z', 0.08, { osc: true, swing: -0.06, reps: 1 }), // 0.08→0.02→0.08 轻叩（闭合回 0.08）
      ch('legR', 'x', 0),       // 闭合 0
      ch('legL', 'x', 0)        // 闭合 0
    ])
  ]
};

// 以 PT 键导出的待机 vignette 表（供 CombatConstants.IDLE_PIECE[type].vignette 引用）
export const VIGNETTE: { K: VignetteDef; A: VignetteDef; B: VignetteDef; N: VignetteDef; R: VignetteDef; C: VignetteDef; P: VignetteDef } = {
  K: KING, A: ADVISOR, B: ELEPHANT, N: HORSE, R: ROOK, C: CANNON, P: PAWN
};

// ===========================================================================
// 求值器（纯函数）
// ===========================================================================

interface Prep {
  weights: number[];
  segCh: VigCh[][];       // 各段通道列表
  firstKF: Record<string, { seg: number; to: number }>;
}

const _prepCache = new WeakMap<VignetteDef, Prep>();

function _prep(def: VignetteDef): Prep {
  let p = _prepCache.get(def);
  if (p) return p;
  const weights: number[] = [];
  const segCh: VigCh[][] = [];
  const firstKF: Record<string, { seg: number; to: number }> = {};
  def.segments.forEach((s, i) => {
    weights.push(s.weight);
    segCh.push(s.channels);
    for (const c of s.channels) {
      const key = c.sub + '.' + c.axis;
      if (!(key in firstKF)) firstKF[key] = { seg: i, to: c.to };
    }
  });
  p = { weights, segCh, firstKF };
  _prepCache.set(def, p);
  return p;
}

function baselineValue(def: VignetteDef, key: string): number | undefined {
  for (const b of def.baseline) {
    if (b.sub + '.' + b.axis === key) return b.to;
  }
  return undefined;
}

/** 段定位：u ∈ [0,1) → {idx, e}（e 为段内归一化进度，未缓动）。 */
export function activeSegment(def: VignetteDef, u: number): { idx: number; e: number } {
  const prep = _prep(def);
  const n = prep.weights.length;
  const uu = u - Math.floor(u); // 归一化到 [0,1)
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const w = prep.weights[i] ?? 0;
    if (uu < acc + w || i === n - 1) {
      const e = w > 0 ? (uu - acc) / w : 0;
      return { idx: i, e: Math.min(1, Math.max(0, e)) };
    }
    acc += w;
  }
  return { idx: n - 1, e: 1 };
}

/**
 * 纯函数：u → 每通道值，写入 out（可复用传入 Map）。
 * 不变量：evalVignette(def, 0) 与 evalVignette(def, 1⁻) 必须一致（回环闭合）。
 */
export function evalVignette(def: VignetteDef, u: number, out?: Map<string, number>): Map<string, number> {
  const prep = _prep(def);
  const result = out ?? new Map<string, number>();
  // loopStart：首关键帧位于分段 0 → 取首关键帧 to（绝对首姿态 / osc 中心）；否则取 baseline ?? 0
  const loopStart: Record<string, number> = {};
  for (const key in prep.firstKF) {
    const fk = prep.firstKF[key];
    if (!fk) continue;
    loopStart[key] = (fk.seg === 0) ? fk.to : (baselineValue(def, key) ?? 0);
  }
  for (const b of def.baseline) {
    const k = b.sub + '.' + b.axis;
    if (loopStart[k] === undefined) loopStart[k] = b.to;
  }
  const cur: Record<string, number> = Object.assign({}, loopStart);

  const { idx, e } = activeSegment(def, u);
  for (let i = 0; i <= idx; i++) {
    const e_i = i < idx ? 1 : e;          // 已完成段 e=1；当前段用 e
    const ee = easeInOutCubic(e_i);
    const segCh = prep.segCh[i];
    if (!segCh) continue;
    for (const c of segCh) {
      const key = c.sub + '.' + c.axis;
      let val: number;
      if (c.osc) {
        // 起止均为 c.to（整数次往复）→ 天然闭合。
        // ★ 往复中心必须从「进入本段时的当前值」平滑过渡到 c.to：原实现直接取
        //   `c.to + swing·(1−cos)/2`，当该通道在本段之前已有值（首个关键帧不在第 0 段，
        //   或上一段末值 ≠ c.to）时，段首会**瞬间跳到 c.to** —— K 的 banner.z 即因此
        //   每到 u=0.18（段 0→1 边界）跳 0.06 rad（L2 探针 E.K 实测 maxStep 0.06696
        //   = 0.06 × 变体幅度，每 7.27s 一次）。中心插值后 ee=0 ⇒ val=prevTo（无跳变）、
        //   ee=1 ⇒ val=c.to（回环闭合），与下方非 osc 分支同构；对 prevTo===c.to 的
        //   通道行为完全不变（无回归）。
        const reps = c.reps ?? 1;
        const prevTo = cur[key] ?? 0;
        const center = prevTo + (c.to - prevTo) * ee;
        val = center + (c.swing ?? 0) * (1 - Math.cos(2 * Math.PI * reps * ee)) / 2;
      } else {
        const prevTo = cur[key] ?? 0;
        val = prevTo + (c.to - prevTo) * ee;
      }
      cur[key] = val;
    }
  }
  for (const key in cur) result.set(key, cur[key] ?? 0);
  return result;
}

/** 本兵种实际写入的通道集合（segments / baseline / mech 的并集）。 */
export function writtenChannels(def: VignetteDef): Set<string> {
  const s = new Set<string>();
  for (const b of def.baseline) s.add(b.sub + '.' + b.axis);
  for (const seg0 of def.segments) for (const c of seg0.channels) s.add(c.sub + '.' + c.axis);
  if (def.mech) for (const m of def.mech) s.add(m.sub + '.y');
  return s;
}

/**
 * 变体选择 + 混合权重（§9.5.1 / 主理人裁定 D3）。
 * 变体由主 vignette 骨架 + per-piece idlePhase 确定性派生（不手抄数据）。
 * 随时间轮转（打破 ~90s 可察觉重复，AC-17-3）：dwellSec = max(8, loopSec×3)，
 * 每 dwellSec 前进一个变体，末 crossfadeSec 内 w 由 1→0（与下一变体混合）。
 */
export function variantBlend(def: VignetteDef, idlePhase: number, tSec: number): { idx: number; next: number; w: number } {
  const vc = def.variantCount;
  const base = Math.floor((idlePhase / (2 * Math.PI)) * vc) % vc;
  const dwell = Math.max(8, def.loopSec * IDLE_VARIANT_DWELL_FACTOR);
  const totalIdx = Math.floor(tSec / dwell);
  const curVar = ((base + totalIdx) % vc + vc) % vc;
  const nextVar = (curVar + 1) % vc;
  const within = tSec - totalIdx * dwell;
  const cf = def.crossfadeSec;
  let w = 1; // 当前变体权重（1=全当前，0=全下一）
  if (within > dwell - cf) {
    w = Math.max(0, (dwell - within) / cf);
  }
  return { idx: curVar, next: nextVar, w };
}

/** 变体幅度系数（D3 派生）：黄金角步进避免谐波重合。 */
export function variantAmp(idlePhase: number, k: number): number {
  const phk = idlePhase + k * 2.399963;
  return 1 + 0.18 * Math.sin(phk);
}
