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

import { PT } from '../../core/constants.js';
import { DISSOLVE_POSE } from './CombatConstants.js';

// ═══════════════════════════════════════════════════════════════
// 内部工具
// ═══════════════════════════════════════════════════════════════

/**
 * 获取棋子的 orient → idleGroup 链
 * @param {THREE.Object3D} piece
 * @returns {{ orient: THREE.Object3D, idleGroup: THREE.Object3D, sub: Object }}
 */
function _getGroups(piece) {
  const orient = piece.getObjectByName('orient') || piece;
  const idleGroup = orient.getObjectByName('idleGroup') || orient;
  const sub = piece.userData && piece.userData.subGroups ? piece.userData.subGroups : {};
  return { orient, idleGroup, sub };
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
export function windUp(piece, type, t) {
  const { idleGroup, sub } = _getGroups(piece);
  // 整体由 CaptureAction 控制 idleGroup.rotation.x，这里只操作子组

  // 各兵种子组收势
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
export function strike(piece, type, victimPos, t) {
  const { sub } = _getGroups(piece);
  // 各兵种武器挥击
  switch (type) {
    case PT.PAWN:
      if (sub.arm) sub.arm.rotation.x = -0.55 * Math.sin(Math.PI * t);  // 戈直刺
      break;
    case PT.HORSE:
      if (sub.rider) sub.rider.rotation.x = -0.7 * Math.sin(Math.PI * t); // 长戟下劈
      if (sub.mount) sub.mount.rotation.x = -0.15 * Math.sin(Math.PI * t);
      break;
    case PT.ELEPHANT:
      if (sub.arms) sub.arms.rotation.z = 0.7 * Math.sin(Math.PI * t);   // 宽袖横扫
      if (sub.robe) sub.robe.rotation.z = 0.35 * Math.sin(Math.PI * t);
      break;
    case PT.ADVISOR:
      if (sub.sword) sub.sword.rotation.z = -0.8 * Math.sin(Math.PI * t); // 拔剑下斩
      break;
    case PT.ROOK:
      if (sub.spearman) sub.spearman.rotation.x = -0.65 * Math.sin(Math.PI * t); // 长戈碾压
      if (sub.driver) sub.driver.rotation.x = -0.25 * Math.sin(Math.PI * t);
      break;
    case PT.KING:
      if (sub.sword) sub.sword.rotation.z = -0.4 * Math.sin(Math.PI * t);  // 短促前压
      if (sub.throne) sub.throne.rotation.x = -0.15 * Math.sin(Math.PI * t);
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
export function settle(piece, type, t) {
  const { idleGroup, sub } = _getGroups(piece);
  // idleGroup 由 CaptureAction 控制归零，这里复位子组
  switch (type) {
    case PT.PAWN:
      if (sub.arm) sub.arm.rotation.x = sub.arm.rotation.x * (1 - t);  // lerp 到 0
      break;
    case PT.HORSE:
      if (sub.rider) sub.rider.rotation.x = sub.rider.rotation.x * (1 - t);
      if (sub.mount) sub.mount.rotation.x = sub.mount.rotation.x * (1 - t);
      break;
    case PT.ELEPHANT:
      if (sub.arms) sub.arms.rotation.z = sub.arms.rotation.z * (1 - t);
      if (sub.robe) { sub.robe.rotation.z = sub.robe.rotation.z * (1 - t); sub.robe.rotation.x = sub.robe.rotation.x * (1 - t); }
      break;
    case PT.ADVISOR:
      if (sub.sword) sub.sword.rotation.z = sub.sword.rotation.z * (1 - t);
      break;
    case PT.ROOK:
      if (sub.spearman) sub.spearman.rotation.x = sub.spearman.rotation.x * (1 - t);
      if (sub.driver) sub.driver.rotation.x = sub.driver.rotation.x * (1 - t);
      break;
    case PT.CANNON:
      if (sub.trebuchet) sub.trebuchet.rotation.z = sub.trebuchet.rotation.z * (1 - t);
      if (sub.soldierL) { sub.soldierL.rotation.x = sub.soldierL.rotation.x * (1 - t); sub.soldierR.rotation.x = sub.soldierR.rotation.x * (1 - t); }
      break;
    case PT.KING:
      if (sub.sword) sub.sword.rotation.z = sub.sword.rotation.z * (1 - t);
      if (sub.throne) sub.throne.rotation.x = sub.throne.rotation.x * (1 - t);
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
export function capturedFlourish(attacker, victim, type, victimType) {
  // 受害者崩姿在 dissolvePiece 的 onUpdate 中已经由 _applyDissolvePose 驱动
  // 这里可供将来做攻击方受击反冲姿态
}

/**
 * 在 dissolvePiece 的 onUpdate 中施加分兵种崩解姿态
 * @param {THREE.Object3D} victim
 * @param {string} victimType
 * @param {number} t   dissolvePiece 的缓动进度 0..1
 */
export function applyDissolvePose(victim, victimType, t) {
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
    idleGroup.scale.y = 1 - (1 - pose.scaleY) * s;
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
      if (action.translateY) {
        sg.position.y = action.translateY * t;
      }
    }
  }
}

/** 按棋子 userData 生成稳定的方向系数 ±1 */
const _dirCache = new WeakMap();
function _pieceRandomDir(piece) {
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
export function getDissolvePose(victimType) {
  return DISSOLVE_POSE[victimType] || null;
}
