/**
 * PieceChoreography.js — 兵种编排入口（替代旧 choreography/ 目录）
 *
 * 提供统一的兵种姿态调度：
 *   windUp(piece, type, t)           — A1 蓄势姿态
 *   strike(piece, type, victimPos, t) — A2 武器挥击
 *   settle(piece, type, t)           — A5 收势复位
 *   capturedFlourish(attacker, victim, type, victimType) — A4 受害者崩姿
 *   getDissolvePose(victimType)      → 受害者崩解姿态参数
 *
 * 数据来源：action-system §3.3（受害者被吃姿态表）和 §4.4（待机姿态表）
 */

import { PT } from '../../core/constants.ts';
import { DISSOLVE_POSE, POSE_TABLE } from './CombatConstants.ts';

// ═══════════════════════════════════════════════════════════════
// 内部工具
// ═══════════════════════════════════════════════════════════════

/**
 * 获取棋子的 orient → idleGroup 链
 * @param {THREE.Object3D} piece
 * @returns {{ orient: THREE.Object3D, idleGroup: THREE.Object3D, sub: Object }}
 */
function _getGroups(piece: any): { orient: any, idleGroup: any, sub: Record<string, any> } {
  const orient = piece.getObjectByName('orient') || piece;
  const idleGroup = orient.getObjectByName('idleGroup') || orient;
  const sub = piece.userData && piece.userData.subGroups ? piece.userData.subGroups : {};
  return { orient, idleGroup, sub };
}

/**
 * 查数据驱动姿态表（Phase A3 / ADR-1）：POSE_TABLE[type][state][stage]。
 * 缺失/未知兵种/未知状态一律返回 null —— 由调用方走 switch 回退。
 */
function _lookupPose(type: string, state: string, stage: string): any {
  const entry = POSE_TABLE[type];
  if (!entry || !entry[state]) return null;
  return entry[state][stage] || null;
}

/**
 * 通用：按线性包络应用姿态峰值（windUp 蓄势）：v = peak * t。
 * sub 缺失/未知子组安全跳过（§4.3 纪律 + A4 新子组单独注册）。
 */
function _applyPoseLinear(sub: Record<string, any>, poseSub: any, t: number): void {
  if (!poseSub || typeof poseSub !== 'object') return;
  for (const [subName, props] of Object.entries(poseSub)) {
    const sg = sub[subName];
    if (!sg) continue;
    if (!props || typeof props !== 'object') continue;
    for (const [prop, axes] of Object.entries(props)) {
      if (prop !== 'rotation' && prop !== 'position' && prop !== 'scale') continue;
      if (!sg[prop]) continue;
      for (const [axis, peak] of Object.entries(axes)) {
        if (typeof peak !== 'number') continue;
        sg[prop][axis] = peak * t;
      }
    }
  }
}

/**
 * 通用：按 sin(πt) 包络应用姿态峰值（strike 挥击 / moveFlourish 巡航）：v = peak * sin(πt)。
 * 起止归零，与待机/复位无缝衔接（设计 §3 envelope 约定）。
 */
function _applyPoseSin(sub: Record<string, any>, poseSub: any, t: number): void {
  if (!poseSub || typeof poseSub !== 'object') return;
  const k = Math.sin(Math.PI * t);
  for (const [subName, props] of Object.entries(poseSub)) {
    const sg = sub[subName];
    if (!sg) continue;
    if (!props || typeof props !== 'object') continue;
    for (const [prop, axes] of Object.entries(props)) {
      if (prop !== 'rotation' && prop !== 'position' && prop !== 'scale') continue;
      if (!sg[prop]) continue;
      for (const [axis, peak] of Object.entries(axes)) {
        if (typeof peak !== 'number') continue;
        sg[prop][axis] = peak * k;
      }
    }
  }
}

/**
 * P3：strike 打击包络 —— v = peak * sin(πt/2)（0 → 峰值，**峰值落在 t=1 = 命中帧**）。
 *
 * ★ 修复用户实机反馈「进攻动作呆」的核心根因：
 *   原实现 strike 用 _applyPoseSin（sin(πt)），峰值在 t=0.5、**t=1 归零**。
 *   而 A2 打击拍仅 70~80ms（60fps 下 4~5 帧），拍末紧接 hitstop 定格 —— 也就是
 *   「最该看清的命中定格帧」定住的是一个已经回到中位的空姿态，武器根本没停在
 *   受害者身上。玩家看到的只是一两帧模糊摆动 → 读不出攻击。
 *
 *   改为 sin(πt/2) 后：武器一路推进到命中帧达到最大伸展并**保持**，hitstop 定格
 *   住这个「戈刺入 / 剑斩下 / 长戈碾压」的极限姿态，随后由 settle 的阻尼包络
 *   （_applyPoseDamp 从当前值起算）自然收回 —— 蓄势→命中→收势三段真正可读。
 *
 *   注意：moveFlourish 仍用 _applyPoseSin（巡航需起止归零、无缝衔接待机），
 *   只有 capture.action 换用本包络。
 */
function _applyPoseStrike(sub: Record<string, any>, poseSub: any, t: number): void {
  if (!poseSub || typeof poseSub !== 'object') return;
  const k = Math.sin(Math.PI * t / 2);
  for (const [subName, props] of Object.entries(poseSub)) {
    const sg = sub[subName];
    if (!sg) continue;
    if (!props || typeof props !== 'object') continue;
    for (const [prop, axes] of Object.entries(props)) {
      if (prop !== 'rotation' && prop !== 'position' && prop !== 'scale') continue;
      if (!sg[prop]) continue;
      for (const [axis, peak] of Object.entries(axes)) {
        if (typeof peak !== 'number') continue;
        sg[prop][axis] = peak * k;
      }
    }
  }
}

/**
 * B4：settle 阻尼式随动 —— 对 recovery 姿态列出的每个通道做
 *   v = v_current * (1-t)·cos(πt/2)
 * （t=0 保持现值，t=1 归零；带 1 次阻尼回摆，替换旧线性 (1-t) 归零，制造随动感）。
 */
function _applyPoseDamp(sub: Record<string, any>, poseSub: any, t: number): void {
  if (!poseSub || typeof poseSub !== 'object') return;
  const damp = (1 - t) * Math.cos(Math.PI * t / 2);
  for (const [subName, props] of Object.entries(poseSub)) {
    const sg = sub[subName];
    if (!sg) continue;
    if (!props || typeof props !== 'object') continue;
    for (const [prop, axes] of Object.entries(props)) {
      if (prop !== 'rotation' && prop !== 'position' && prop !== 'scale') continue;
      if (!sg[prop]) continue;
      for (const [axis] of Object.entries(axes)) {
        if (typeof sg[prop][axis] === 'number') {
          sg[prop][axis] = sg[prop][axis] * damp;
        }
      }
    }
  }
}

/**
 * P3 辅助：把「只在 prevPose 出现、nextPose 不再涉及」的通道按 k 线性淡出。
 * 用于 move 蓄势→冲锋的交接：蓄势写过 arm.x，若冲锋段不写它，就会冻在蓄势峰值。
 */
function _fadeResidualChannels(
  sub: Record<string, any>, prevPose: any, nextPose: any, k: number
): void {
  if (!prevPose || typeof prevPose !== 'object') return;
  for (const [subName, props] of Object.entries(prevPose)) {
    const sg = sub[subName];
    if (!sg || !props || typeof props !== 'object') continue;
    for (const [prop, axes] of Object.entries(props)) {
      if (prop !== 'rotation' && prop !== 'position' && prop !== 'scale') continue;
      if (!sg[prop]) continue;
      for (const [axis, peak] of Object.entries(axes)) {
        if (typeof peak !== 'number') continue;
        // next 里已有同通道 → 交给 next 的包络，不淡出
        const nx = nextPose && nextPose[subName] && nextPose[subName][prop];
        if (nx && typeof nx[axis] === 'number') continue;
        sg[prop][axis] = peak * k;
      }
    }
  }
}

/**
 * P3 辅助：收集一个姿态段涉及的所有通道键（'sub.prop.axis'），用于快照/收势。
 */
function _collectChannels(poseSub: any, out: Set<string>): void {
  if (!poseSub || typeof poseSub !== 'object') return;
  for (const [subName, props] of Object.entries(poseSub)) {
    if (!props || typeof props !== 'object') continue;
    for (const [prop, axes] of Object.entries(props)) {
      if (prop !== 'rotation' && prop !== 'position' && prop !== 'scale') continue;
      for (const [axis, peak] of Object.entries(axes as Record<string, unknown>)) {
        if (typeof peak !== 'number') continue;
        out.add(`${subName}.${prop}.${axis}`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 兵种编排方法
// ═══════════════════════════════════════════════════════════════

/**
 * A1 蓄势姿态：攻击者整体后仰 + 子组收势
 * @param {THREE.Object3D} piece  攻击方棋子 Group
 * @param {string} type    PT 值
 * @param {number} t       缓动后进度 0..1
 */
export function windUp(piece: any, type: string, t: number): void {
  const { idleGroup, sub } = _getGroups(piece);
  // 整体由 CaptureAction 控制 idleGroup.rotation.x，这里只操作子组

  // ★ 数据驱动：查 POSE_TABLE[type].capture.anticipation（A3 / ADR-1）。
  //   查表成功则按线性包络应用峰值（蓄势段），未知子组安全跳过；失败回退 switch。
  const entry = _lookupPose(type, 'capture', 'anticipation');
  if (entry && entry.sub) {
    _applyPoseLinear(sub, entry.sub, t);
    return;
  }

  // 各兵种子组收势（switch 回退）
  switch (type) {
    case PT.PAWN:
      if (sub.arm) sub.arm.rotation.x = -0.25 * t;  // 戈后收
      break;
    case PT.HORSE:
      if (sub.mount) sub.mount.rotation.x = 0.1 * t;  // 马首微扬
      if (sub.rider) sub.rider.rotation.x = -0.2 * t; // 骑手提戟
      break;
    case PT.ELEPHANT:
      if (sub.arms) sub.arms.rotation.z = -0.3 * t;   // 袖收紧
      if (sub.robe) sub.robe.rotation.x = 0.15 * t;   // 袍角张开
      break;
    case PT.ADVISOR:
      if (sub.sword) sub.sword.rotation.z = -0.4 * t; // 拔剑预位
      break;
    case PT.ROOK:
      if (sub.spearman) sub.spearman.rotation.x = -0.3 * t;
      if (sub.driver) sub.driver.rotation.x = -0.15 * t;
      break;
    case PT.CANNON:
      if (sub.trebuchet) sub.trebuchet.rotation.z = -0.4 * t; // 抛臂后拉
      if (sub.soldierL) { sub.soldierL.rotation.x = -0.3 * t; sub.soldierR.rotation.x = -0.3 * t; }
      break;
    case PT.KING:
      if (sub.sword) sub.sword.rotation.z = -0.25 * t;
      if (sub.throne) sub.throne.rotation.x = -0.1 * t;
      break;
    default: break;
  }
}

/**
 * A2 武器挥击：攻击者前压突进 + 武器挥向受害者
 * @param {THREE.Object3D} piece      攻击方棋子 Group
 * @param {string} type                PT 值
 * @param {{x:number,y:number,z:number}|THREE.Vector3} victimPos  受害者世界位置
 * @param {number} t                   缓动后进度 0..1
 */
export function strike(piece: any, type: string, victimPos: any, t: number): void {
  const { sub } = _getGroups(piece);
  // ★ 数据驱动：查 POSE_TABLE[type].capture.action。
  //   P3：包络改为 sin(πt/2) —— **峰值落在 t=1（命中帧）并保持**，让 hitstop
  //   定格住武器伸展到位的极限姿态（原 sin(πt) 在命中帧归零，定格空姿态 = 「呆」）。
  const entry = _lookupPose(type, 'capture', 'action');
  if (entry && entry.sub) {
    _applyPoseStrike(sub, entry.sub, t);
    return;
  }
  // 各兵种武器挥击（switch 回退；同样改为命中帧保持峰值的 sin(πt/2)）
  const k = Math.sin(Math.PI * t / 2);
  switch (type) {
    case PT.PAWN:
      if (sub.arm) sub.arm.rotation.x = -0.55 * k;  // 戈直刺
      break;
    case PT.HORSE:
      if (sub.rider) sub.rider.rotation.x = -0.75 * k; // 骑手长戟下劈
      if (sub.mount) sub.mount.rotation.x = -0.35 * k;  // 马身前扑
      break;
    case PT.ELEPHANT:
      if (sub.arms) sub.arms.rotation.z = 0.75 * k;   // 宽袖横扫
      if (sub.robe) sub.robe.rotation.z = 0.40 * k;   // 袍角翻飞
      break;
    case PT.ADVISOR:
      if (sub.sword) sub.sword.rotation.z = -0.85 * k; // 拔剑下斩
      break;
    case PT.ROOK:
      if (sub.spearman) sub.spearman.rotation.x = -0.70 * k; // 长戈碾压
      if (sub.horses) sub.horses.rotation.x = -0.35 * k;     // 双马前冲
      if (sub.driver) sub.driver.rotation.x = -0.25 * k;
      break;
    case PT.KING:
      if (sub.sword) sub.sword.rotation.z = -0.4 * k;  // 短促前压
      if (sub.throne) sub.throne.rotation.x = -0.15 * k;
      break;
    default: break;
  }
}

/**
 * A5 收势复位：攻击者踏占受害者格 + 武器复位
 * @param {THREE.Object3D} piece  攻击方棋子 Group
 * @param {string} type            PT 值
 * @param {number} t               缓动后进度 0..1
 */
export function settle(piece: any, type: string, t: number): void {
  const { idleGroup, sub } = _getGroups(piece);
  // idleGroup 由 CaptureAction 控制归零，这里复位子组
  // ★ 数据驱动：查 POSE_TABLE[type].capture.recovery，对列出通道做阻尼式随动
  //   v = v·(1-t)·cos(πt/2)（B4：替换线性归零，全兵种统一阻尼）。
  const entry = _lookupPose(type, 'capture', 'recovery');
  if (entry && entry.sub) {
    _applyPoseDamp(sub, entry.sub, t);
    return;
  }
  // switch 回退（同样使用阻尼式）
  const damp = (1 - t) * Math.cos(Math.PI * t / 2);
  switch (type) {
    case PT.PAWN:
      if (sub.arm) sub.arm.rotation.x = sub.arm.rotation.x * damp;  // 阻尼归零
      break;
    case PT.HORSE:
      if (sub.rider) sub.rider.rotation.x = sub.rider.rotation.x * damp;
      if (sub.mount) sub.mount.rotation.x = sub.mount.rotation.x * damp;
      break;
    case PT.ELEPHANT:
      if (sub.arms) sub.arms.rotation.z = sub.arms.rotation.z * damp;
      if (sub.robe) { sub.robe.rotation.z = sub.robe.rotation.z * damp; sub.robe.rotation.x = sub.robe.rotation.x * damp; }
      break;
    case PT.ADVISOR:
      if (sub.sword) sub.sword.rotation.z = sub.sword.rotation.z * damp;
      break;
    case PT.ROOK:
      if (sub.spearman) sub.spearman.rotation.x = sub.spearman.rotation.x * damp;
      if (sub.driver) sub.driver.rotation.x = sub.driver.rotation.x * damp;
      break;
    case PT.CANNON:
      if (sub.trebuchet) sub.trebuchet.rotation.z = sub.trebuchet.rotation.z * damp;
      if (sub.soldierL) { sub.soldierL.rotation.x = sub.soldierL.rotation.x * damp; sub.soldierR.rotation.x = sub.soldierR.rotation.x * damp; }
      break;
    case PT.KING:
      if (sub.sword) sub.sword.rotation.z = sub.sword.rotation.z * damp;
      if (sub.throne) sub.throne.rotation.x = sub.throne.rotation.x * damp;
      break;
    default: break;
  }
}

/**
 * P3 新增：移动**起步蓄势**（M0 CHARGE + M1 LAUNCH）的兵种子组随动。
 *
 * ★ 修复用户实机反馈「移动动作呆呆的」根因之一：
 *   原 MoveAction 的 M0/M1 两拍（合计 140~170ms）**只写 idleGroup 的整体后仰 + scale 压扁**，
 *   POSE_TABLE[type].move.anticipation（兵戈后收 / 骑手勒缰 / 士敛袖…）明明配好了，
 *   却从头到尾没有任何调用方读取 —— 起步段的子组完全静止。
 *   现由本函数按线性包络驱动（v = peak * t），补齐设计 §4.2「预备·蓄力起步」。
 *
 * @param {THREE.Object3D} piece
 * @param {string} type  PT 值
 * @param {number} t     M0+M1 合并进度 0..1（由 MoveAction 换算跨拍累计值）
 */
export function moveCharge(piece: any, type: string, t: number): void {
  const { sub } = _getGroups(piece);
  const entry = _lookupPose(type, 'move', 'anticipation');
  if (entry && entry.sub) {
    _applyPoseLinear(sub, entry.sub, t);
    return;
  }
  // switch 回退（与 POSE_TABLE move.anticipation 数值保持一致）
  switch (type) {
    case PT.PAWN:
      if (sub.arm) sub.arm.rotation.x = -0.15 * t;      // 戈后收蓄力
      break;
    case PT.HORSE:
      if (sub.rider) sub.rider.rotation.x = -0.10 * t;  // 骑手勒缰
      break;
    case PT.ELEPHANT:
      if (sub.arms) sub.arms.rotation.z = -0.10 * t;    // 宽袖敛起
      break;
    case PT.ADVISOR:
      if (sub.sword) sub.sword.rotation.z = -0.08 * t;  // 剑归中
      break;
    case PT.ROOK:
      if (sub.driver) sub.driver.rotation.x = -0.15 * t; // 御者伏身
      break;
    case PT.CANNON:
      if (sub.soldierL) sub.soldierL.rotation.x = -0.15 * t; // 左兵蹬地
      break;
    case PT.KING:
      if (sub.throne) sub.throne.rotation.x = 0.06 * t;  // 龙椅后坐
      break;
    default: break;
  }
}

/**
 * 移动巡航（M2 DASH）时的兵种子组随动：让各兵种在贴地冲锋时呈现可辨识姿态。
 * 由 MoveAction 的 M2 onUpdate 调用。
 *
 * ★ P3 包络改造：sin(πt) → **sin(πt/2)**（0 → 峰值，峰值落在 t=1 = 落点刹那并保持）。
 *   原因：M2 巡航按设计只有 80~220ms，用 sin(πt) 时姿态在 40~110ms 就已回到中位，
 *   而随后 M3+M4+M5「急停收势」有 260~320ms（占整个移动 55%~62%）——那段里子组
 *   一动不动。玩家看到的是「一闪而过的抖动 + 半秒静止滑行落地」，正是「呆」的观感。
 *   改为 sin(πt/2) 后冲锋姿态一路推进到落点达最大伸展，再由 settleMovePose 在
 *   M3~M5 做阻尼回摆收势，全程 580ms 都有可读的子组运动。
 *
 * ★ 通道避让约定：MoveAction 期间 piece.userData._busy=true，主循环 tickIdle 会在
 *   updateTweens 之后把 IDLE_PIECE.zeroChannels 列出的通道每帧归零。因此本函数
 *   绝不写那些「待机专属且被 busy 归零」的通道（如 P.body.x / N.rider.z / K.banner.z），
 *   否则随动会被同一帧的 tickIdle 覆盖成 0，视觉无效。
 * @param {THREE.Object3D} piece
 * @param {string} type  PT 值
 * @param {number} t     巡航缓动进度 0..1
 */
export function moveFlourish(piece: any, type: string, t: number): void {
  const { sub } = _getGroups(piece);
  // ★ 数据驱动：查 POSE_TABLE[type].move.action；sin(πt/2) 包络（0 → 峰值，落点保持）。
  const entry = _lookupPose(type, 'move', 'action');
  if (entry && entry.sub) {
    _applyPoseStrike(sub, entry.sub, t);
    // 蓄势段写过、但 action 段不再涉及的通道 → 线性淡出，避免冻在蓄势峰值
    const ant = _lookupPose(type, 'move', 'anticipation');
    if (ant && ant.sub) _fadeResidualChannels(sub, ant.sub, entry.sub, 1 - t);
    return;
  }
  const k = Math.sin(Math.PI * t / 2);   // 0 → 峰值（落点保持）
  switch (type) {
    case PT.PAWN:
      if (sub.arm) sub.arm.rotation.x = -0.32 * k;   // 戈前指
      if (sub.legs) sub.legs.rotation.x = 0.16 * k;  // 踏步摆腿
      break;
    case PT.HORSE:
      if (sub.mount) sub.mount.rotation.x = -0.22 * k;  // 马身前扑
      if (sub.rider) sub.rider.rotation.x = -0.25 * k;  // 骑手压身
      break;
    case PT.ELEPHANT:
      if (sub.arms) sub.arms.rotation.z = 0.22 * k;     // 宽袖摆动
      if (sub.robe) sub.robe.rotation.x = 0.15 * k;     // 袍角微扬
      break;
    case PT.ADVISOR:
      if (sub.sword) sub.sword.rotation.z = -0.12 * k;  // 稳剑于前
      break;
    case PT.ROOK:
      if (sub.driver) sub.driver.rotation.x = -0.20 * k;    // 御者勒缰
      if (sub.spearman) sub.spearman.rotation.x = -0.25 * k; // 长戈前压
      break;
    case PT.CANNON:
      if (sub.soldierL) sub.soldierL.rotation.x = -0.30 * k; // 双兵推车
      if (sub.soldierR) sub.soldierR.rotation.x = -0.30 * k;
      if (sub.trebuchet) sub.trebuchet.rotation.z = 0.15 * k; // 抛臂随车颠簸
      break;
    case PT.KING:
      if (sub.throne) sub.throne.rotation.x = -0.06 * k;  // 龙椅微倾
      if (sub.sword) sub.sword.rotation.z = -0.10 * k;    // 王剑前压
      break;
    default: break;
  }
}

/** switch 回退用的移动通道清单（与 resetMovePose 的归零集合一致） */
const _MOVE_FALLBACK_CHANNELS: Record<string, string[]> = {
  [PT.PAWN]:     ['arm.rotation.x', 'legs.rotation.x'],
  [PT.HORSE]:    ['mount.rotation.x', 'rider.rotation.x'],
  [PT.ELEPHANT]: ['arms.rotation.z', 'robe.rotation.x'],
  [PT.ADVISOR]:  ['sword.rotation.z', 'shield.rotation.x'],
  [PT.ROOK]:     ['driver.rotation.x', 'spearman.rotation.x', 'wheelL.rotation.x', 'wheelR.rotation.x'],
  [PT.CANNON]:   ['soldierL.rotation.x', 'soldierR.rotation.x', 'trebuchet.rotation.z'],
  [PT.KING]:     ['throne.rotation.x', 'sword.rotation.z']
};

/**
 * P3 新增：在 M2 巡航结束（落点刹那）对移动姿态做**快照**。
 * 由 MoveAction 的 M3 onStart 调用一次，返回 { 'sub.prop.axis': 当前值 }。
 *
 * 用快照而非「每帧乘阻尼系数」（旧 _applyPoseDamp 的做法）是为了让收势
 * **与帧率无关**：60fps 和 30fps 下收势曲线完全一致，不会因帧数差异衰减快慢不同。
 */
export function snapshotMovePose(piece: any, type: string): Record<string, number> {
  const { sub } = _getGroups(piece);
  const keys = new Set<string>();
  const ant = _lookupPose(type, 'move', 'anticipation');
  const act = _lookupPose(type, 'move', 'action');
  if (ant && ant.sub) _collectChannels(ant.sub, keys);
  if (act && act.sub) _collectChannels(act.sub, keys);
  if (keys.size === 0) {
    for (const k of (_MOVE_FALLBACK_CHANNELS[type] || [])) keys.add(k);
  }
  const snap: Record<string, number> = {};
  for (const key of keys) {
    const parts = key.split('.');
    if (parts.length !== 3) continue;
    const subName = parts[0] as string, prop = parts[1] as string, axis = parts[2] as string;
    const sg = sub[subName];
    if (!sg || !sg[prop]) continue;
    const v = sg[prop][axis];
    if (typeof v === 'number' && v !== 0) snap[key] = v;
  }
  return snap;
}

/**
 * P3 新增：移动**急停收势**（M3 BRAKE + M4 IMPACT + M5 RECOVERY）的子组阻尼回摆。
 *
 * v = v_snapshot * (1-t)·cos(πt/2) —— t=0 保持落点极限姿态，中途带一次回摆，t=1 精确归零。
 * 补齐设计 §4.2「复位·急停收势（过冲回弹 + 落点顿挫 + 复位）」在子组层的缺失：
 * 原实现这 260~320ms 内子组零运动，是「移动呆」的最大单一成因。
 *
 * @param {number} t  M3+M4+M5 合并进度 0..1（由 MoveAction 换算跨拍累计值）
 */
export function settleMovePose(
  piece: any, type: string, snap: Record<string, number> | null, t: number
): void {
  if (!snap) return;
  const { sub } = _getGroups(piece);
  const damp = (1 - t) * Math.cos(Math.PI * t / 2);
  for (const [key, v0] of Object.entries(snap)) {
    const parts = key.split('.');
    if (parts.length !== 3) continue;
    const subName = parts[0] as string, prop = parts[1] as string, axis = parts[2] as string;
    const sg = sub[subName];
    if (!sg || !sg[prop]) continue;
    if (typeof sg[prop][axis] !== 'number') continue;
    sg[prop][axis] = v0 * damp;
  }
}

/**
 * 复位移动随动的兵种子组（MoveAction M5 onComplete 调用）。
 * 只归零 moveFlourish 写过的通道，确保子组回到待机基线，避免 tickIdle 接管时残留非零姿态。
 * @param {THREE.Object3D} piece
 * @param {string} type  PT 值
 */
export function resetMovePose(piece: any, type: string): void {
  const { sub } = _getGroups(piece);
  switch (type) {
    case PT.PAWN:
      if (sub.arm) sub.arm.rotation.x = 0;
      if (sub.legs) sub.legs.rotation.x = 0;
      break;
    case PT.HORSE:
      if (sub.mount) sub.mount.rotation.x = 0;
      if (sub.rider) sub.rider.rotation.x = 0;
      break;
    case PT.ELEPHANT:
      if (sub.arms) sub.arms.rotation.z = 0;
      if (sub.robe) sub.robe.rotation.x = 0;
      break;
    case PT.ADVISOR:
      if (sub.sword) sub.sword.rotation.z = 0;
      if (sub.shield) sub.shield.rotation.x = 0;   // P3：move.action 已含盾，补归零
      break;
    case PT.ROOK:
      if (sub.driver) sub.driver.rotation.x = 0;
      if (sub.spearman) sub.spearman.rotation.x = 0;
      if (sub.wheelL) sub.wheelL.rotation.x = 0;   // P3：move.action 已含车轮，补归零
      if (sub.wheelR) sub.wheelR.rotation.x = 0;
      break;
    case PT.CANNON:
      if (sub.soldierL) sub.soldierL.rotation.x = 0;
      if (sub.soldierR) sub.soldierR.rotation.x = 0;
      if (sub.trebuchet) sub.trebuchet.rotation.z = 0;
      break;
    case PT.KING:
      if (sub.throne) sub.throne.rotation.x = 0;
      if (sub.sword) sub.sword.rotation.z = 0;
      break;
    default: break;
  }
}

/**
 * A4 受害者崩姿：在 dissolvePiece 的 onUpdate 中每帧调用
 * @param {THREE.Object3D} attacker
 * @param {THREE.Object3D} victim
 * @param {string} type          攻击方兵种
 * @param {string} victimType    受害方兵种
 */
export function capturedFlourish(attacker: any, victim: any, type: string, victimType: string): void {
  // 受害者崩姿在 dissolvePiece 的 onUpdate 中已经由 _applyDissolvePose 驱动
  // 这里可供将来做攻击方受击反冲姿态
}

/**
 * 在 dissolvePiece 的 onUpdate 中施加分兵种崩解姿态
 * @param {THREE.Object3D} victim
 * @param {string} victimType
 * @param {number} t   dissolvePiece 的缓动进度 0..1
 */
export function applyDissolvePose(victim: any, victimType: string, t: number): void {
  const pose = DISSOLVE_POSE[victimType];
  if (!pose) return;

  const { idleGroup, sub } = _getGroups(victim);

  // 主体姿态
  if (pose.rotX && !pose.subGroupActions) {
    idleGroup.rotation.x = pose.rotX * t;
  }
  if (pose.rotZ) {
    const dir = pose.rotZDir === 'random' ? _pieceRandomDir(victim) : 1;
    idleGroup.rotation.z = pose.rotZ * dir * t;
  }
  if (pose.scaleY && t > 0.5) {
    const s = (t - 0.5) * 2; // 后半段
    // ★ K 预缩放锁定：相对 idleGroup 自身基准（K=1.25）做压缩，绝不写回 1.0。
    if (idleGroup.userData.__dissolveBase == null) {
      idleGroup.userData.__dissolveBase = { x: idleGroup.scale.x, y: idleGroup.scale.y, z: idleGroup.scale.z };
    }
    const base = idleGroup.userData.__dissolveBase;
    idleGroup.scale.y = base.y * (1 - (1 - pose.scaleY) * s);
    idleGroup.scale.x = base.x;
    idleGroup.scale.z = base.z;
  }

  // 子组姿态
  if (pose.subGroupActions) {
    for (const [key, action] of Object.entries(pose.subGroupActions)) {
      if (!sub[key]) continue;
      const sg = sub[key];

      if (action.rotX) {
        if (action.rotX === 'pulse') {
          sg.rotation.x = 0.3 * Math.sin(Math.PI * t * 3) * (1 - t);
        } else {
          sg.rotation.x = action.rotX * t;
        }
      }
      if (action.rotZ) {
        const dir = action.dir === 'match' ? _pieceRandomDir(victim) : 1;
        sg.rotation.z = action.rotZ * dir * t;
      }
      if (action.translateY !== undefined) {
        if (action.then && action.then.translateY !== undefined) {
          // 两段式位移：先线性上抛到 t0，再「重力」加速下落至 t1（easeInQuad）。
          // 用于 K.crown 冕落：crown { translateY: +0.25, then: { translateY: -0.35, mode: 'gravity' } }
          const SPLIT = 0.30;                 // 上抛段占比
          const t0 = action.translateY;
          const t1 = action.then.translateY;
          if (t < SPLIT) {
            sg.position.y = t0 * (t / SPLIT);
          } else {
            const rel = (t - SPLIT) / (1 - SPLIT);
            const ease = action.then.mode === 'gravity' ? (u: number) => u * u : (u: number) => u;
            sg.position.y = t0 + (t1 - t0) * ease(rel);
          }
        } else {
          sg.position.y = action.translateY * t;
        }
      }
    }
  }
}

/** 按棋子 userData 生成稳定的方向系数 ±1 */
const _dirCache = new WeakMap();
function _pieceRandomDir(piece: any): number {
  if (_dirCache.has(piece)) return _dirCache.get(piece);
  const dir = (piece.userData.idlePhase || Math.random() * Math.PI * 2) % 2 < 1 ? 1 : -1;
  _dirCache.set(piece, dir);
  return dir;
}

/**
 * 获取受害者崩解姿态参数
 * @param {string} victimType  PT 值
 * @returns {Object|null}  DISSOLVE_POSE 条目
 */
export function getDissolvePose(victimType: string): any {
  return DISSOLVE_POSE[victimType] || null;
}
