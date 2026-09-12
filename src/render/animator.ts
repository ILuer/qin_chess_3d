/**
 * animator.js —— 基于 requestAnimationFrame 的补间系统 + 象棋专用动画
 *
 * 设计要点：
 *  - 所有补间集中在一个 Animator 实例里，主循环调用 updateTweens(dt) 统一推进
 *  - 需要锁输入的动画用 { lock: true } 标记，Animator.isBusy 为真时 input 层拒绝交互
 *  - 棋子移动走抛物线弧（升起 - 平移 - 落下），马走"日"字折线弧
 *  - 吃子：攻击方冲刺 → 被吃方下沉 + 缩小 + 旋转 + 透明消散 → 从场景移除
 */

import * as THREE from 'three';
import { TIMING, PT } from '../core/constants.ts';
import { applyDissolvePose } from './combat/PieceChoreography.ts';
import { IDLE_PIECE } from './combat/CombatConstants.ts';
import {
  evalVignette,
  variantBlend,
  variantAmp,
  IDLE_BASE_GAIN
} from './combat/vignette.ts';
// 战斗姿态现由 CombatDirector → CaptureAction/MoveAction → PieceChoreography 统一驱动；
// animator 仅保留纯通用回退（点头 / 前压 / 消散），不再依赖任何外部编排 stub。
// （历史 _getChoreoStub 已删除：其恒返回 null，真实编排走 CombatDirector 实时路径。）

// ---------------------------------------------------------------------------
// 待机 vignette 全局调参（R-2 重构）
// ---------------------------------------------------------------------------
// ★ 旧的 `IDLE_AMP_SCALE = 2.0` 已删除：那是「呼吸时代」的幅度口径（R-2 红线明令不沿用）。
//   vignette 幅度现由 VigCh.to / IDLE_BASE_GAIN / variantAmp 直接决定，不再有全局倍率。
// IDLE_BUSY_DEADMAN_S：_busy 卡死保险阈值（渲染帧时钟秒，仅主循环推进时累积，
//   后台标签页不误触）。若移动/吃子演出因异常序列器未收尾导致 _busy 永久为 true，
//   超过此阈值后自动释放，避免待机被永久压制。15s ≫ 任何真实走子/吃子时长。
const IDLE_BUSY_DEADMAN_S = 15;

/**
 * 朝向：棋子绕 Y 轴转向移动方向（本地 +Z/-Z 为前，由阵营决定）。
 *   red 本地前向 = -Z，black 本地前向 = +Z（orient 已 180°）。
 * 返回应施加到 root.rotation.y 的偏航角；配合 arcMove 的 spin 平滑转向。
 */
export function headingYaw(side: string, dx: number, dz: number): number {
  if (side === 'b') return Math.atan2(dx, dz);
  return Math.atan2(-dx, -dz);
}

// ---------------------------------------------------------------------------
// 缓动函数
// ---------------------------------------------------------------------------

export const Easing = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  easeOutBounce: (t: number) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};

// ---------------------------------------------------------------------------
// 阶段三分兵种移动风味（lift = 相对基准抛物线高度的倍率）
// ---------------------------------------------------------------------------
// 用户体验准则（2026-08-08 用户硬性约束）：所有棋子不得离地跳太高。
// liftHeight 基准 0.85，以下倍率将其压到 0.03~0.17 世界单位（贴地/极低弧）。
const MOVE_FLAVOR_DEFAULT = { liftMul: 0.12 };
const MOVE_FLAVOR = {
  [PT.PAWN]:     { liftMul: 0.18 },   // 兵：低伏前冲，贴地
  [PT.HORSE]:    { liftMul: 0.20 },   // 马：单段贴地冲刺（已删两跃，绝不腾空）
  [PT.ELEPHANT]: { liftMul: 0.20 },   // 象：低弧滑翔；clamp 0.20（峰值 0.17，严守贴地约束）
  [PT.ADVISOR]:  { liftMul: 0.15 },   // 士：稳步，几乎不离地
  [PT.ROOK]:     { liftMul: 0.07 },   // 车：轮行，车体基本不抬
  [PT.CANNON]:   { liftMul: 0.05 },   // 炮：推车拖行，绝腾空
  [PT.KING]:     { liftMul: 0.12 }    // 帅：起身移驾，龙椅隐现
};

// 移动时整枚棋子的"前压"幅度（仅作用于 idleGroup.rotation.x，由 _moveFlourish 施加；
// 子组随动交给编排 moveFlourish，二者写不同节点，互不冲突）。
// MOVE_LEAN 值已按 action-system §6 上调（2026-08-09 用户评审通过）
const MOVE_LEAN = {
  [PT.PAWN]: -0.18,
  [PT.HORSE]: -0.30,   // 骑兵单段冲刺，最强前压
  [PT.ELEPHANT]: -0.16,
  [PT.ADVISOR]: -0.10,
  [PT.ROOK]: -0.08,
  [PT.CANNON]: -0.06,
  [PT.KING]: -0.12
};

// ---------------------------------------------------------------------------
// 材质透明化辅助（吃子消散用；可回滚，供悔棋恢复）
// ---------------------------------------------------------------------------

/**
 * 把整棵子树的材质 clone 成可透明版本，返回备份用于恢复
 * @param {THREE.Object3D} root
 * @returns {Array<{mesh:THREE.Mesh, orig:*}>}
 */
export function cloneMaterialsForFade(root: any): Array<{ mesh: any, orig: any }> {
  const backup: Array<{ mesh: any, orig: any }> = [];
  root.traverse((o: any) => {
    if (!o.isMesh || !o.material) return;
    const orig = o.material;
    backup.push({ mesh: o, orig });
    if (Array.isArray(orig)) {
      o.material = orig.map((m: any) => {
        const c = m.clone();
        c.transparent = true; c.depthWrite = false; c.opacity = 1;
        return c;
      });
    } else {
      const c = orig.clone();
      c.transparent = true; c.depthWrite = false; c.opacity = 1;
      o.material = c;
    }
  });
  return backup;
}

/**
 * 把「世界 XZ 方向」归一化为单位向量（Y 恒 0）。缺省/零向量回退 +Z。
 * 用于 R-1 贴地败退的滑出方向（Caller 传「攻击者→受害者」向量）。
 */
function _normXZ(dir?: { x: number, z: number } | null): { x: number, z: number } {
  if (!dir) return { x: 0, z: 1 };
  const len = Math.hypot(dir.x, dir.z);
  if (!(len > 1e-6)) return { x: 0, z: 1 };
  return { x: dir.x / len, z: dir.z / len };
}

/** 设置整棵子树的不透明度（须先调用 cloneMaterialsForFade） */
export function setTreeOpacity(root: any, v: number) {
  root.traverse((o: any) => {
    if (!o.isMesh || !o.material) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (let i = 0; i < ms.length; i++) ms[i]!.opacity = v;
  });
}

/** 还原材质并释放 clone 出来的那份 */
export function restoreMaterials(backup: Array<{ mesh: any, orig: any }> | null | undefined) {
  if (!backup) return;
  for (const b of backup) {
    const cur = b.mesh.material;
    const arr = Array.isArray(cur) ? cur : [cur];
    for (const m of arr) { if (m && m !== b.orig && m.dispose) m.dispose(); }
    b.mesh.material = b.orig;
  }
}

// ---------------------------------------------------------------------------
// Animator
// ---------------------------------------------------------------------------

let _uid = 0;

/** 单个补间句柄 */
export interface TweenHandle {
  id: number;
  duration: number;
  delay: number;
  easing: (t: number) => number;
  onUpdate?: (t: number, raw: number) => void;
  onStart?: () => void;
  onComplete?: (...args: unknown[]) => void;
  lock: boolean;
  elapsed: number;
  started: boolean;
  dead: boolean;
  gap?: number;
}

/** 补间配置（add/seq 通用） */
export interface TweenConfig {
  duration?: number;
  delay?: number;
  easing?: (t: number) => number;
  onUpdate?: (t: number, raw: number) => void;
  onStart?: () => void;
  onComplete?: (...args: unknown[]) => void;
  lock?: boolean;
  gap?: number;
}

/** 弧线移动选项 */
export interface ArcMoveOpts {
  duration?: number;
  lift?: number;
  waypoints?: any[];
  lock?: boolean;
  delay?: number;
  easing?: (t: number) => number;
  spin?: number;
  onFlourish?: (t: number, raw: number, mesh: any) => void;
  onComplete?: () => void;
}

/** 消散选项 */
export interface DissolveOpts {
  duration?: number;
  delay?: number;
  lock?: boolean;
  onComplete?: (mesh: any, backup?: any) => void;
  /** ★ R-1 贴地败退：败退方向（世界 XZ，非单位向量亦可，内部归一化）。缺省 +Z。 */
  knockDir?: { x: number, z: number };
  /** ★ R-1 贴地败退：沿盘面的滑出距离（世界单位）。缺省 0.55。 */
  knockDist?: number;
}

export class Animator {
  tweens: TweenHandle[];
  _lockCount: number;
  timeScale: number;
  EASE: typeof Easing;

  constructor() {
    /** @type {Array<Object>} */
    this.tweens = [];
    this._lockCount = 0;
    this.timeScale = 1;
    /** 暴露缓动表，供编排模块调用（避免循环 import） */
    this.EASE = Easing;
  }

  /** 是否有锁输入的动画在跑 */
  get isBusy(): boolean { return this._lockCount > 0; }

  /** 当前补间数量 */
  get count(): number { return this.tweens.length; }

  /**
   * 通用补间
   * @param {Object} cfg
   * @param {number} cfg.duration 秒
   * @param {number} [cfg.delay] 秒
   * @param {Function} [cfg.easing]
   * @param {(t:number, raw:number)=>void} [cfg.onUpdate] t 为缓动后进度
   * @param {Function} [cfg.onStart]
   * @param {Function} [cfg.onComplete]
   * @param {boolean} [cfg.lock] 是否锁输入
   * @returns {Object} handle
   */
  add(cfg: TweenConfig): TweenHandle {
    const tw = {
      id: ++_uid,
      duration: Math.max(0.0001, cfg.duration || 0),
      delay: cfg.delay || 0,
      easing: cfg.easing || Easing.linear,
      onUpdate: cfg.onUpdate,
      onStart: cfg.onStart,
      onComplete: cfg.onComplete,
      lock: !!cfg.lock,
      elapsed: 0,
      started: false,
      dead: false
    };
    if (tw.lock) this._lockCount++;
    this.tweens.push(tw);
    return tw;
  }

  /** 纯延时回调 */
  delay(seconds: number, cb: () => void, lock = false): TweenHandle {
    return this.add({ duration: Math.max(0.0001, seconds), lock, onComplete: cb });
  }

  /**
   * 轻量编排器（满足 Wave A「sequencer」地基）：把若干阶段按顺序串成一条时间线。
   * steps: [{ delay?, duration, easing?, onStart?, onUpdate?, onComplete?, lock? }]
   * 各阶段时间默认首尾相接；可显式给 delay 制造留白；返回最后一个句柄。
   * 用法见 choreography/*.js 的 attack()。
   */
  seq(steps: TweenConfig[], opts: { onComplete?: () => void } = {}): TweenHandle | null {
    let cursor = 0;
    let last = null;
    for (const s of steps) {
      const dur = Math.max(0.0001, s.duration != null ? s.duration : 0.0001);
      const delay = s.delay != null ? s.delay : cursor;
      const tw = this.add({
        duration: dur, delay, easing: s.easing,
        lock: !!s.lock, onStart: s.onStart, onUpdate: s.onUpdate, onComplete: s.onComplete
      });
      last = tw;
      cursor = delay + dur + (s.gap || 0);
    }
    if (opts.onComplete && last) {
      const prev = last.onComplete;
      last.onComplete = () => { if (prev) prev(); opts.onComplete!(); };
    }
    return last;
  }

  /** 立即结束全部补间（Oil：演出可跳过；跳到终态而非瞬移消失） */
  finishAll() {
    for (const tw of this.tweens.slice()) {
      if (!tw.dead) this.finish(tw);
    }
  }

  /**
   * 位置补间（契约要求的签名）
   * @param {THREE.Object3D} object3D
   * @param {THREE.Vector3|{x:number,y:number,z:number}} targetPos
   * @param {number} duration 秒
   * @param {Function} [easing]
   * @param {Function} [onComplete]
   */
  tweenTo(object3D: any, targetPos: any, duration: number = TIMING.moveDuration, easing: (t: number) => number = Easing.easeInOutCubic, onComplete?: () => void): TweenHandle {
    const from = object3D.position.clone();
    const to = new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z);
    return this.add({
      duration, easing, lock: false,
      onUpdate: (t: number) => { object3D.position.lerpVectors(from, to, t); },
      onComplete: () => { object3D.position.copy(to); if (onComplete) onComplete(); }
    });
  }

  /** 数值补间 */
  tweenValue(from: number, to: number, duration: number, easing: (t: number) => number, onUpdate: (v: number) => void, onComplete?: () => void): TweenHandle {
    return this.add({
      duration, easing: easing || Easing.linear,
      onUpdate: (t: number) => onUpdate(from + (to - from) * t),
      onComplete
    });
  }

  /** 缩放补间 */
  tweenScale(object3D: any, target: any, duration: number, easing: (t: number) => number = Easing.easeOutCubic, onComplete?: () => void): TweenHandle {
    const from = object3D.scale.clone();
    const to = new THREE.Vector3(target.x, target.y, target.z);
    return this.add({
      duration, easing,
      onUpdate: (t: number) => object3D.scale.lerpVectors(from, to, t),
      onComplete: () => { object3D.scale.copy(to); if (onComplete) onComplete(); }
    });
  }

  // -------------------------------------------------------------------------
  // 象棋专用动画
  // -------------------------------------------------------------------------

  /**
   * 抛物线弧线移动：升起 - 平移 - 落下
   * @param {THREE.Object3D} mesh
   * @param {THREE.Vector3} to 目标位置（y 通常为 0）
   * @param {Object} [opts]
   * @param {number} [opts.duration]
   * @param {number} [opts.lift] 弧顶高度
   * @param {Array<THREE.Vector3>} [opts.waypoints] 折线路径（马走日）
   * @param {boolean} [opts.lock]
   * @param {Function} [opts.onComplete]
   */
  arcMove(mesh: any, to: any, opts: ArcMoveOpts = {}): TweenHandle {
    const duration = opts.duration != null ? opts.duration : TIMING.moveDuration;
    // ★ R-1（冻结红线·最高优先级）：root 离地一律禁止，故**缺省 lift = 0**。
    //   原缺省为 TIMING.liftHeight（0.85）——任何未显式传 lift 的调用都会把整枚棋子
    //   抬起 0.85 世界单位，是判定容差 0.02 的 42 倍，属严重违规（main.ts 曾踩中）。
    //   垂直观感请走「部件级关节旋转」（见 PieceChoreography.moveFlourish：蹄/足/轮）
    //   与 idleGroup.scale 的压扁回弹；确需整体抛物者必须在调用处显式传 lift 并写明豁免理由。
    const lift = opts.lift != null ? opts.lift : 0;
    const from = mesh.position.clone();
    const target = to.clone();
    const way = opts.waypoints && opts.waypoints.length
      ? [from.clone(), ...opts.waypoints.map(v => v.clone()), target.clone()]
      : null;
    const curve = way ? new THREE.CatmullRomCurve3(way, false, 'catmullrom', 0.35) : null;
    const tmp = new THREE.Vector3();
    const baseRotY = mesh.rotation.y;
    const spin = opts.spin || 0;

    return this.add({
      duration,
      delay: opts.delay || 0,
      easing: opts.easing || Easing.easeInOutCubic,
      lock: opts.lock !== false,
      onUpdate: (t: number, raw: number) => {
        if (curve) curve.getPoint(t, tmp); else tmp.lerpVectors(from, target, t);
        // 抛物线：4h·t·(1-t) 在 t=0.5 处取最大值 h
        tmp.y += lift * 4 * t * (1 - t);
        mesh.position.copy(tmp);
        if (spin) mesh.rotation.y = baseRotY + spin * t;
        // 轻微前倾，增加"被推动"的重量感
        const tilt = Math.sin(Math.PI * t) * 0.09;
        mesh.rotation.x = tilt * (target.z > from.z ? -1 : 1);
        // 兵种专属随动（子组摆臂 / 龙椅隐现等），由 movePiece 注入
        if (opts.onFlourish) opts.onFlourish(t, raw, mesh);
      },
      onComplete: () => {
        mesh.position.copy(target);
        mesh.rotation.x = 0;
        if (spin) mesh.rotation.y = baseRotY + spin; // 保留最终朝向（不再回正）
        if (opts.onComplete) opts.onComplete();
      }
    });
  }

  /**
   * 落子回弹：压扁 -> 回弹（squash & stretch）
   * @param {THREE.Object3D} mesh
   * @param {number} [strength]
   */
  squashLand(mesh: any, strength = 0.22): TweenHandle {
    const base = mesh.userData.__baseScale || (mesh.userData.__baseScale = mesh.scale.clone());
    const squashed = new THREE.Vector3(base.x * (1 + strength * 0.8), base.y * (1 - strength), base.z * (1 + strength * 0.8));
    return this.add({
      duration: TIMING.squashDuration,
      easing: Easing.easeOutQuad,
      onUpdate: t => mesh.scale.lerpVectors(base, squashed, t),
      onComplete: () => {
        this.add({
          duration: TIMING.squashDuration * 2.2,
          easing: Easing.easeOutElastic,
          onUpdate: t => mesh.scale.lerpVectors(squashed, base, t),
          onComplete: () => mesh.scale.copy(base)
        });
      }
    });
  }

  /** 棋盘受击下沉回弹 */
  boardImpact(boardGroup: any, amount = 0.055, duration = 0.34): TweenHandle | null {
    if (!boardGroup) return null;
    const baseY = boardGroup.userData.__baseY != null
      ? boardGroup.userData.__baseY
      : (boardGroup.userData.__baseY = boardGroup.position.y);
    return this.add({
      duration,
      easing: Easing.linear,
      onUpdate: t => {
        // 一次下沉 + 阻尼回弹
        const k = Math.sin(Math.PI * t) * Math.exp(-3.2 * t);
        boardGroup.position.y = baseY - amount * k * 3.2;
      },
      onComplete: () => { boardGroup.position.y = baseY; }
    });
  }

  /**
   * 被吃棋子的消散动画：下沉 + 缩小 + 旋转 + 透明
   * 完成后调用 onComplete（由调用方决定移除 / 保留以便悔棋）
   */
  dissolvePiece(mesh: any, opts: DissolveOpts = {}): TweenHandle {
    const duration = opts.duration != null ? opts.duration : TIMING.captureDissolve;
    const backup = cloneMaterialsForFade(mesh);
    mesh.userData.__fadeBackup = backup;
    const baseScale = mesh.userData.__baseScale || (mesh.userData.__baseScale = mesh.scale.clone());
    const startRotY = mesh.rotation.y;
    const tmp = new THREE.Vector3();
    // ★ R-1 贴地败退（设计原文：US-4 / 附录 A.4「受击方贴地败退，败退沿盘面滑出；root 恒贴地」）
    //   本方法原实现有**三处**违反 GLOBAL-1：
    //     ① `mesh.position.y = startY - t*0.75` —— 整枚棋子沉入盘面以下 0.75（穿透，容差 0.02，37 倍）；
    //     ② 因此 restorePiece 不还原 position.y → 悔棋复原后棋子**永久埋在地下**（可见 bug）；
    //     ③ `mesh.rotation.z = t*0.55` —— 绕形心倾倒，x<0 一侧顶点降到盘面下（穿透）。
    //   现改为「贴地败退 + 沿盘面滑出」：败退方向由调用方按「攻击者→受害者」向量传入，
    //   整枚棋子沿盘面平移滑出（root y 恒 0），配合缩小与淡出收束。
    //   ⚠️ 遗留待办：设计期望的「前缘铰接式倾倒」（绕朝败退方向那一侧的底边旋转，
    //      可保证无顶点低于盘面）尚未实现，当前整枚倾倒角为 0；已登记到「被击杀演出」阶段。
    const n = _normXZ(opts.knockDir);
    const slide = opts.knockDist != null ? opts.knockDist : 0.55;
    const basePos = mesh.position.clone();
    basePos.y = 0;
    // 记录消散前基准位，供 restorePiece（悔棋）完整还原位置
    if (!mesh.userData.__dissolveBasePos) mesh.userData.__dissolveBasePos = basePos.clone();
    // 被吃方专属附加（BK-14 等）：分兵种消散风味，由 PieceChoreography 的
    // applyDissolvePose 驱动（见下方 onUpdate），不再依赖外部编排 stub。

    return this.add({
      duration,
      delay: opts.delay || 0,
      easing: Easing.easeInQuad,
      lock: opts.lock !== false,
      onUpdate: (t: number, raw: number) => {
        // ① 贴地滑出：沿盘面（XZ）败退，root y 恒 0 —— 绝不沉降、绝不整体浮起
        mesh.position.set(basePos.x + n.x * slide * raw, 0, basePos.z + n.z * slide * raw);
        // ② 绕 Y 轴溃旋（纯平面旋转，不产生任何盘面以下几何）
        mesh.rotation.y = startRotY + t * Math.PI * 1.35;
        // ③ 缩小 + 淡出
        tmp.copy(baseScale).multiplyScalar(Math.max(0.02, 1 - t * 0.92));
        mesh.scale.copy(tmp);
        setTreeOpacity(mesh, Math.max(0, 1 - t * 1.05));
        // ④ 分兵种**部件级**崩解（DISSOLVE_POSE.subGroupActions）：
        //    K.crown 冕落 / C.trebuchet 折臂 + cart 散架 / A.sword 脱手 / R.horses 挣扎脉冲。
        //    ⚠️ 整体倾倒（DISSOLVE_POSE 的 rotX/rotZ）仍为 0，原因见上「遗留待办」。
        try { applyDissolvePose(mesh, mesh.userData.pieceType, t); } catch (e) { /* 安全兜底 */ }
      },
      onComplete: () => { if (opts.onComplete) opts.onComplete(mesh, backup); }
    });
  }

  /** 恢复被消散过的棋子（悔棋用） */
  restorePiece(mesh: any): void {
    const backup = mesh.userData.__fadeBackup;
    if (backup) { restoreMaterials(backup); mesh.userData.__fadeBackup = null; }
    const base = mesh.userData.__baseScale;
    if (base) mesh.scale.copy(base); else mesh.scale.set(1, 1, 1);
    mesh.rotation.set(0, mesh.userData.__baseRotY || 0, 0);
    // ★ R-1：消散期间棋子沿盘面滑出（dissolvePiece），复原必须一并还原位置，
    //   否则悔棋后棋子停留在滑出后的错格；原实现连沉降位移都不还原，
    //   棋子会永久埋进盘面以下 0.75（可见 bug）。
    const home = mesh.userData.__dissolveBasePos;
    if (home) { mesh.position.copy(home); mesh.userData.__dissolveBasePos = null; }
    else { mesh.position.y = 0; }
    // ★ 还原消散期对 idleGroup 的纵向压缩（applyDissolvePose 的 scaleY 通道）。
    //   原实现只还原 root scale，不动 idleGroup —— 兵/卒消散后 idleGroup.scale.y 恒为
    //   基准 ×0.7，悔棋复原的棋子会永久保持压扁态（可见 bug）。
    const orient = mesh.userData._orient || mesh.getObjectByName('orient') || mesh;
    const idleGroup = mesh.userData._idleGroup || orient.getObjectByName('idleGroup') || orient;
    const idleBase = idleGroup && idleGroup.userData ? idleGroup.userData.__dissolveBase : null;
    if (idleBase) {
      idleGroup.scale.set(idleBase.x, idleBase.y, idleBase.z);
      idleGroup.userData.__dissolveBase = null;
    }
  }

  /** 攻击方向目标冲刺一小段（吃子的第一拍） */
  lunge(mesh: any, towards: any, ratio = 0.24, duration = TIMING.captureLunge): TweenHandle {
    const from = mesh.position.clone();
    const to = from.clone().lerp(towards, ratio);
    // ★ R-1（冻结红线）：原实现 `to.y = from.y + 0.12` 会给整枚棋子加纵向弧，违反
    //   「禁止整体（root）离地」（0.12 是容差 0.02 的 6 倍）。改为**纯水平冲刺**：
    //   突击感由 horizontal 位移 + 调用方的部件级关节动作（挥戈/扬蹄）承担。
    //   本方法当前无调用方（Attack 演出已由 CaptureAction 的 A0 贴地冲锋取代）。
    to.y = 0;
    return this.add({
      duration,
      easing: Easing.easeOutQuad,
      lock: true,
      onUpdate: t => mesh.position.lerpVectors(from, to, t),
      onComplete: () => mesh.position.copy(to)
    });
  }

  // -------------------------------------------------------------------------
  // 阶段三：分兵种动画（待机 / 移动 / 吃子）
  //   设计约束：
  //   - 移动动画作用于棋子「根 Group」（arcMove 负责）；兵种风味作用于
  //     子 Group（throne / soldierL/R / horses / driver / spearman / body），
  //     二者分属不同节点、互不干扰，绝不发生跳变或穿模。
  //   - 待机微动由主循环每帧调用 tickIdle 驱动，无状态、可在任意时刻启停；
  //     移动 / 吃子期间 piece.userData._busy = true，tickIdle 自动让位。
  //   - 朝向：红方朝 -Z、黑方朝 +Z 已烘焙进 orient 的 180° 旋转，
  //     子组一律在「本地 +Z = 前」坐标系内建模，物理方向天然正确。
  // -------------------------------------------------------------------------

  /** 各兵种移动风味参数（lift 为相对基准的倍率） */
  get _moveFlavor() {
    return MOVE_FLAVOR;
  }

  /**
   * 每帧待机 vignette 序列器。必须在主循环里对每个棋子调用一次。
   *
   * 三级激活增益（主理人裁定 D2 / 系统设计.md §3.2.M5.20 IDLE 子状态机）：
   *   _busy            → 按 IDLE_PIECE[type].zeroChannels 幂等归零（保持现状，不改）
   *   !sel && far      → L1 IDLE_BASE：仅 baseline（静态基准），L2/L3 停写并冻结当前值
   *   !sel && !far     → 怠速层：全通道 × IDLE_BASE_GAIN（极小幅度机械怠速，无呼吸）
   *   sel（任意视距）  → L2/L3 全量 vignette：全部分段通道 + 机械层（C 炮），增益 1.0
   * 三档之间以 crossfadeSec 为时长的增益斜坡过渡（进入 / 取消选中 / 远景恢复均不跳变）。
   *
   * R-1 红线（冻结）：本函数**只写子组 rotation**（sg[sub].rotation[axis]），绝不写
   *   root/orient/idleGroup 的 position 或 rotation；idleGroup.position.y / rotation.z 恒置 0
   *   （旧 L0 呼吸层已删除）。子组缺失守卫：`sg[sub]` 不存在时 `continue` 跳过（建模段未补建的子组）。
   *
   * 防同步（D4）：起始相位分散 u0 = idlePhase/2π；周期抖动 loopSec_i = loopSec·(1+0.06·sin(idlePhase))。
   * 降级不跳变（D5）：进入 !sel && far 那帧起累加 _vigPause，u 从冻结处继续天然无跳变；
   *   恢复时以冻结值为起点做 crossfade（_vigResumeW 0→1）。
   *
   * @param {THREE.Object3D} group 棋子根 Group
   * @param {number} t 当前秒（performance.now()/1000）
   * @param {boolean} [selected] 是否选中（冻结降档保护）
   * @param {boolean} [farView] 是否远景（>12 单位；关 L2/L3）
   */
  tickIdle(group: any, t: number, selected?: boolean, farView?: boolean): void {
    if (!group || !group.userData) return;
    const ud = group.userData;
    try {
      // 防御：_busy 卡死保险（见 IDLE_BUSY_DEADMAN_S）。基于帧时钟 t（仅主循环运行时推进），
      // 后台标签页/暂停不会误触；超过阈值即释放 _busy，使该棋子待机恢复（绝不中途清战斗通道）。
      if (ud._busy) {
        if (ud._busySinceT == null) ud._busySinceT = t;
        else if (t - ud._busySinceT > IDLE_BUSY_DEADMAN_S) {
          ud._busy = false;
          ud._busySinceT = null;
        }
      } else {
        ud._busySinceT = null;
      }

      // H2：优先读 createPieceMesh 缓存的引用（热路径每帧 0 次 getObjectByName）；
      // 回退路径仅为未走 createPieceMesh 的旧实例/测试桩保留。
      const orient = ud._orient || group.getObjectByName('orient') || group;
      // idleGroup：整枚棋子的微动作用层。绝不写 orient 的 rotation/position，
      // 否则会触发欧拉→四元数重算，把黑方 Y=180° 的朝向翻成 X=180°（头朝下）。
      const idleGroup = ud._idleGroup || orient.getObjectByName('idleGroup') || orient;
      const cfg: any = IDLE_PIECE[ud.pieceType] || null;
      const sg: any = ud.subGroups;
      const def = cfg && cfg.vignette ? cfg.vignette : null;

      // R-1：idleGroup 纵向/侧倾恒 0（旧 L0 呼吸层已删除，root 恒贴地由 moveFlourish/包装层保证）。
      idleGroup.position.y = 0;
      idleGroup.rotation.z = 0;

      // L1（_busy 让位）：按 zeroChannels 幂等归零待机专属通道，绝不写战斗通道；保持现状不改。
      if (ud._busy) {
        if (cfg && cfg.zeroChannels && sg) {
          // 解析 "sub.axis"（2 段式）：sg[sub].rotation[axis] = 0。
          for (const ch of cfg.zeroChannels) {
            const dot = ch.indexOf('.');
            const sub = sg[ch.slice(0, dot)];
            const axis = ch.slice(dot + 1);
            if (!sub || !sub.rotation) continue;
            sub.rotation[axis] = 0;
          }
        }
        return;
      }

      const sel = !!selected;
      const far = !!farView;
      const ph = ud.idlePhase || 0;

      // 帧间隔（帧时钟，后台标签页/暂停不推进）。
      if (ud._vigLastT == null) ud._vigLastT = t;
      const dt = t - ud._vigLastT;
      ud._vigLastT = t;

      // 增益斜坡（D2 + 系统设计.md §3.2.M5.20 退出契约）：
      //   目标增益 sel → 1.0（全量 vignette）；!sel && !far → IDLE_BASE_GAIN（怠速层）；
      //   !sel && far → 0（远景降档 = 收束至 L1 基准）。
      // 以 crossfadeSec 为时长的线性斜坡实现「进入 / 退出 / 远景恢复均不跳变」：
      //   相位 u 始终随 t 连续推进，增益斜坡天然等价于「以当前值为起点 crossfade 到目标相位」。
      // ★ 曾用 _vigPause/_vigFrozen/_vigResumeW 三字段做「暂停累加 + 恢复淡入」，会在远景恢复时
      //   从 baseline 淡入（先回基准再回相位）产生下沉伪影，且状态字段过多易出错 —— 已弃用。
      const target = sel ? 1 : (far ? 0 : IDLE_BASE_GAIN);
      if (ud._vigGain == null) ud._vigGain = target;  // 首帧直接就位，不做入场淡入
      const cf = def ? def.crossfadeSec : 0.2;
      const step = cf > 0 ? dt / cf : 1;
      if (ud._vigGain < target) ud._vigGain = Math.min(target, ud._vigGain + step);
      else if (ud._vigGain > target) ud._vigGain = Math.max(target, ud._vigGain - step);
      const g = ud._vigGain;

      // L1 IDLE_BASE：静态基准姿态，任何非 _busy 档位恒写（选中 / 怠速 / 远景）。
      if (def) this._writeBaseline(def, sg, 1.0);

      // 完全降档（g≈0）：L2/L3 停写、通道冻结在当前值（不归零）；恢复由上面的增益斜坡接管。
      if (!def || g <= 0.001) return;

      const loop_i = def.loopSec * (1 + 0.06 * Math.sin(ph)); // D4 策略②：周期抖动（±6%）
      const u0 = ((ph / (2 * Math.PI)) % 1 + 1) % 1;          // D4 策略①：起始相位分散
      let u = (t / loop_i + u0) % 1;
      if (u < 0) u += 1;

      const out = evalVignette(def, u);

      if (sel) {
        // L2/L3 全量 vignette + 变体派生（D3）+ 机械层（C 炮）。
        const vb = variantBlend(def, ph, t);
        const effAmp = vb.w * variantAmp(ph, vb.idx) + (1 - vb.w) * variantAmp(ph, vb.next);
        const gain = effAmp * g;
        for (const [key, val] of out) this._writeChannel(sg, key, val * gain);
      } else {
        // 怠速层：全盘同一套波形、幅度 ×IDLE_BASE_GAIN（极小幅度机械怠速，无呼吸）。
        // ★ 写「全部」通道而非子集：若只写子集，上一帧全量档位遗留的非子集通道会被冻结在半途
        //   姿态（可见残留）。全写为 32 枚 × ~4 通道 ≈ 130 次/帧，仍在预算内。
        for (const [key, val] of out) this._writeChannel(sg, key, val * g);
      }
      if (def.mech) this._writeMech(def, sg, ph, t);
    } catch (e) {
      console.error('[ANIM:animator] tickIdle 待机 vignette 异常（已跳过本帧）', { pieceType: group?.userData?.pieceType }, e);
    }
  }

  /** 写 baseline（静态基准，增益 gain）。 */
  private _writeBaseline(def: any, sg: any, gain: number): void {
    if (!sg || !def || !def.baseline) return;
    for (const ch of def.baseline) this._writeChannel(sg, ch.sub + '.' + ch.axis, ch.to * gain);
  }

  /** 写单通道：sg[sub].rotation[axis] = value（sub 缺失则跳过，R-1 安全）。key 格式 `sub.axis`。 */
  private _writeChannel(sg: any, key: string, value: number): void {
    if (!sg) return;
    const dot = key.indexOf('.');
    const sub = sg[key.slice(0, dot)];
    const axis = key.slice(key.lastIndexOf('.') + 1);
    if (!sub || !sub.rotation) return;
    sub.rotation[axis] = value;
  }

  /**
   * 机械层（C 炮 winch/gear）：匀速连续转动、位置独立于肢体分段、周期整除 loopSec（D4 策略⑤）。
   *
   * 角度 = 2π·(t / loop_i)·periodRatio + ph_mech —— 关于 t **连续**（远景降档期间停写也不会
   * 造成恢复跳变，因为恢复时角度仍等于同一函数在该 t 的取值），且每过一个 loop_i 恰好转
   * periodRatio 整圈 → 回环无缝闭合。机械相位 ph_mech = idlePhase × 0.5 与肢体相位解耦
   * （多枚炮齿轮起始角度不同，但整除关系不受种子影响，逐枚仍各自闭合）。
   * 子组缺失（`winch`/`gear` 属建模段新增，当前未注册）时安全跳过。
   */
  private _writeMech(def: any, sg: any, ph: number, t: number): void {
    if (!sg || !def.mech) return;
    const phMech = ph * 0.5;                                       // 机械相位解耦
    const loop_i = def.loopSec * (1 + 0.06 * Math.sin(ph));
    for (const m of def.mech) {
      const s = sg[m.sub];
      if (!s || !s.rotation) continue;                             // 子组缺失（建模段）则跳过
      s.rotation.y = 2 * Math.PI * (t / loop_i) * m.periodRatio + phMech;
    }
  }

  /**
   * 分兵种移动：贴地位移（root 恒 y=0）+ 兵种专属风味（子组随动）。
   * @param {THREE.Object3D} piece
   * @param {THREE.Vector3} target 目标世界坐标
   * @param {string} type  PT.* 之一
   * @param {string} side  'r'|'b'
   * @param {Object} opts { duration, waypoints, onLand }
   */
  movePiece(piece: any, target: any, type: string, side: string, opts: any = {}): TweenHandle {
    const flavor = MOVE_FLAVOR[type] || MOVE_FLAVOR_DEFAULT;
    // ★ R-1（冻结红线）：原实现 lift = TIMING.liftHeight × flavor.liftMul（0.0425~0.17）
    //   会给整枚棋子加抛物弧，违反「禁止整体（root）离地」（容差 0.02）。
    //   本方法当前无调用方（走子演出已由 render/combat/MoveAction.ts 的贴地位移取代）；
    //   保留 API 但 lift 恒置 0，`flavor.liftMul` 仅作历史记录不再参与位移。
    void flavor;
    // 朝向：平滑转向移动方向（绕 Y，配合 orient 的 180° 阵营基调）—— 偏航非位移，不涉 R-1
    const dx = target.x - piece.position.x;
    const dz = target.z - piece.position.z;
    const spin = headingYaw(side, dx, dz) - piece.rotation.y;
    return this.arcMove(piece, target, {
      duration: opts.duration,
      lift: 0,
      waypoints: opts.waypoints,
      spin,
      easing: opts.easing,
      onFlourish: (t, raw, mesh) => {
        try { this._moveFlourish(mesh, type, t, raw); } catch (e) { /* 安全兜底 */ }
      },
      onComplete: () => { if (opts.onLand) opts.onLand(); }
    });
  }

  /** 移动过程中的整体前压（仅作用于 idleGroup；子组随动交给编排 moveFlourish） */
  _moveFlourish(mesh: any, type: string, t: number, raw?: number): void {
    // H2：读缓存引用（热路径），回退为旧查找
    const ud = mesh.userData || {};
    const orient = ud._orient || mesh.getObjectByName('orient') || mesh;
    const idleGroup = ud._idleGroup || orient.getObjectByName('idleGroup') || orient;
    const k = Math.sin(Math.PI * t);
    const lean = MOVE_LEAN[type] || 0;
    idleGroup.rotation.x = lean * k;
  }

  /**
   * 吃子时攻击方的「斩杀」姿态（非炮）。短促前刺 + 复位；
   * 拥有可动子组的兵种额外做专属挥击。
   * @returns {Object} 主补间句柄
   */
  captureStrike(piece: any, type: string, side: string, opts: any = {}): TweenHandle {
    const sub = piece.userData.subGroups || {};
    // —— 通用斩杀点头 + 有可动子组则挥击（分兵种编排由 CombatDirector/PieceChoreography 统一驱动）——
    const ud = piece.userData;
    // H2：读缓存引用（热路径），回退为旧查找
    const orient = ud._orient || piece.getObjectByName('orient') || piece;
    const idleGroup = ud._idleGroup || orient.getObjectByName('idleGroup') || orient;
    const dur = TIMING.strikeRecoil != null ? TIMING.strikeRecoil : 0.18;
    const nod = type === PT.ADVISOR ? 0.40 : (type === PT.KING ? 0.22 : 0.28);
    const a = this.add({
      duration: dur, easing: Easing.easeOutQuad,
      onUpdate: (t: number) => { idleGroup.rotation.x = -nod * Math.sin(Math.PI * t); },
      onComplete: () => { idleGroup.rotation.x = 0; }
    });
    if (sub && sub.spearman) {
      this.add({ duration: dur, easing: Easing.easeOutCubic,
        onUpdate: (t: number) => { sub.spearman.rotation.x = -0.6 * Math.sin(Math.PI * t); },
        onComplete: () => { sub.spearman.rotation.x = 0; } });
    }
    return a;
  }

  /**
   * 炮吃子：抛石命中 + 攻击者原位消失、目标位出现、警戒后复位。
   * 与「滑行动画」不同，炮是远程攻击，本体不沿格线平移。
   * @param {THREE.Object3D} attacker 炮（仍在 from 处）
   * @param {THREE.Object3D} victim 被吃子（在 to 处）
   * @param {THREE.Vector3} fromVec 起点世界坐标
   * @param {THREE.Vector3} toVec 落点世界坐标
   * @param {string} side
   * @param {Object} opts { onHit(victim), onLand() }
   */
  cannonCapture(attacker: any, victim: any, fromVec: any, toVec: any, side: string, opts: any = {}): void {
    const ud = attacker.userData;
    const sg = ud.subGroups;
    const scene = attacker.parent;
    const topY = ud.topY || 1.0;

    // 全程输入锁：覆盖「抛石 → 命中 → 原位消失 → 目标位出现 → 警戒复位」
    // 整段结束才解锁并回调收尾，避免待机微动抢拍、或回合在播片中途流转。
    this.add({ duration: 1.25, lock: true, onComplete: () => { if (opts.onLand) opts.onLand(); } });

    // ① 抛石机甩臂 + 士兵推车
    const throwDur = 0.34;
    if (sg && sg.trebuchet) {
      // 幅度 0.48：子组已锚定到机身中枢（SUBGROUP_JOINTS.C.trebuchet），
      // 旋转是绕机器自身而非绕棋子原点，原先的 0.9 会变成整机翻倒。
      this.add({ duration: throwDur, easing: Easing.easeOutCubic,
        onUpdate: (t: number) => { sg.trebuchet.rotation.z = -0.48 * Math.sin(Math.PI * Math.min(1, t * 1.4)); },
        onComplete: () => { if (sg.trebuchet) sg.trebuchet.rotation.z = 0; } });
    }
    if (sg && sg.soldierL && sg.soldierR) {
      this.add({ duration: throwDur, easing: Easing.easeOutCubic,
        onUpdate: (t: number) => { const k = Math.sin(Math.PI * t) * 0.4; sg.soldierL.rotation.x = k; sg.soldierR.rotation.x = k; },
        onComplete: () => { sg.soldierL.rotation.x = 0; sg.soldierR.rotation.x = 0; } });
    }

    // ② 抛石弹道（自抛石机飞向目标）
    const proj = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x6f7d63, emissive: 0x241f15, emissiveIntensity: 0.45, roughness: 0.9, metalness: 0.1 })
    );
    proj.castShadow = true;
    const start = fromVec.clone(); start.y = topY * 0.6 + 0.2;
    proj.position.copy(start);
    if (scene) scene.add(proj);
    const mid = new THREE.Vector3((start.x + toVec.x) / 2, Math.max(start.y, toVec.y) + 0.95, (start.z + toVec.z) / 2);
    const arc = new THREE.CatmullRomCurve3([start, mid, toVec.clone()]);
    const tmp = new THREE.Vector3();
    this.add({ duration: 0.36, delay: 0.12, easing: Easing.linear,
      onUpdate: (t: number) => { arc.getPoint(Math.min(1, t), tmp); proj.position.copy(tmp); proj.rotation.x += 0.32; },
      onComplete: () => {
        if (scene) scene.remove(proj);
        proj.geometry.dispose(); proj.material.dispose();
        if (opts.onHit) opts.onHit(victim);   // 命中：消散被吃子 + 粒子 + 震屏
      }
    });

    // ③ 命中后：攻击者原位消失 → 目标位出现 → 警戒复位
    this.delay(0.56, () => {
      const fadeOut = cloneMaterialsForFade(attacker);
      this.add({ duration: 0.16, easing: Easing.easeInQuad,
        onUpdate: (t: number) => setTreeOpacity(attacker, 1 - t),
        onComplete: () => {
          attacker.position.copy(toVec);
          this.add({ duration: 0.18, easing: Easing.easeOutQuad,
            onUpdate: (t: number) => setTreeOpacity(attacker, t),
            onComplete: () => {
              restoreMaterials(fadeOut);
              attacker.userData.__fadeBackup = null;
              // 警戒姿态：抛石机后坐 + 士兵戒备，随复位
              if (sg) {
                this.add({ duration: 0.3, easing: Easing.easeOutCubic,
                  onUpdate: (t: number) => {
                    const k = Math.sin(Math.PI * t);
                    if (sg.trebuchet) sg.trebuchet.rotation.z = 0.18 * k;
                    if (sg.soldierL) sg.soldierL.rotation.x = -0.20 * k;
                    if (sg.soldierR) sg.soldierR.rotation.x = -0.20 * k;
                  },
                  onComplete: () => {
                    if (sg.trebuchet) sg.trebuchet.rotation.z = 0;
                    sg.soldierL.rotation.x = 0; sg.soldierR.rotation.x = 0;
                  }
                });
              }
              // 收尾（清 _busy + 走子完成）由开头的全程输入锁 onComplete 统一接管
            }
          });
        }
      });
    });
  }

  /** 非法操作时的左右抖动（Oil：明确的拒绝反馈） */
  shakeMesh(mesh: any, amplitude = 0.13, duration = 0.32): TweenHandle {
    const base = mesh.userData.__homePos ? mesh.userData.__homePos.clone() : mesh.position.clone();
    return this.add({
      duration,
      easing: Easing.linear,
      onUpdate: t => {
        const k = (1 - t) * Math.sin(t * Math.PI * 7);
        mesh.position.x = base.x + amplitude * k;
      },
      onComplete: () => { mesh.position.x = base.x; }
    });
  }

  /** 悬停确认（R-1：禁止整体浮起，故改为绕 root 原点的**压扁脉冲** —— 纯缩放、零位移） */
  hover(mesh: any, strength = 0.12, duration = 0.18): TweenHandle {
    // ★ R-1（冻结红线）：原实现 `to.y = (__homeY||0) + height`（缺省上浮 0.16）在
    //   悬停时把整枚棋子抬起，直撞 US-8「悬停/拖拽/落子反馈/取消选中 → 全程零整体离地，
    //   无拿起、无浮空、无跳起」与 O1「选中/悬停/拖拽整体浮起」否决项。
    //   改为压扁脉冲：以 root 原点（y=0 即盘面）为缩放中心，底面恒贴地、无穿透。
    const base = mesh.userData.__baseScale || (mesh.userData.__baseScale = mesh.scale.clone());
    const sq = new THREE.Vector3(
      base.x * (1 + strength * 0.5),
      base.y * (1 - strength),
      base.z * (1 + strength * 0.5)
    );
    return this.add({
      duration, easing: Easing.easeOutCubic,
      onUpdate: t => mesh.scale.lerpVectors(base, sq, t)
    });
  }

  /** 解除悬停：缩放复位（与 hover 的压扁脉冲配对） */
  unhover(mesh: any, duration = 0.16): TweenHandle {
    const base = mesh.userData.__baseScale || (mesh.userData.__baseScale = mesh.scale.clone());
    const from = mesh.scale.clone();
    return this.add({
      duration, easing: Easing.easeOutCubic,
      onUpdate: t => mesh.scale.lerpVectors(from, base, t),
      onComplete: () => mesh.scale.copy(base)
    });
  }

  // -------------------------------------------------------------------------
  // 推进 / 清理
  // -------------------------------------------------------------------------

  /** 主循环调用 */
  update(dt: number): void {
    if (!this.tweens.length) return;
    const step = dt * this.timeScale;
    // 用副本遍历，允许回调中新增补间
    const list = this.tweens.slice();
    for (let i = 0; i < list.length; i++) {
      const tw = list[i]!;
      if (tw.dead) continue;
      try {
        if (tw.delay > 0) { tw.delay -= step; if (tw.delay > 0) continue; }
        if (!tw.started) { tw.started = true; if (tw.onStart) tw.onStart(); }
        tw.elapsed += step;
        const raw = Math.min(1, tw.elapsed / tw.duration);
        const eased = tw.easing(raw);
        if (tw.onUpdate) tw.onUpdate(eased, raw);
        if (raw >= 1) {
          tw.dead = true;
          if (tw.lock) this._lockCount = Math.max(0, this._lockCount - 1);
          if (tw.onComplete) tw.onComplete();
        }
      } catch (e) {
        // 单条补间回调异常：标记 dead 防止每帧重复抛错刷屏，并解除输入锁
        tw.dead = true;
        if (tw.lock) this._lockCount = Math.max(0, this._lockCount - 1);
        console.error('[ANIM:animator] update 补间回调异常（已标记 dead）', e);
      }
    }
    // 清理
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      if (this.tweens[i]!.dead) this.tweens.splice(i, 1);
    }
  }

  /** 立即结束某个补间（跳到终点） */
  finish(handle: TweenHandle): void {
    if (!handle || handle.dead) return;
    handle.elapsed = handle.duration;
    handle.delay = 0;
    if (handle.onUpdate) handle.onUpdate(handle.easing(1), 1);
    handle.dead = true;
    if (handle.lock) this._lockCount = Math.max(0, this._lockCount - 1);
    if (handle.onComplete) handle.onComplete();
  }

  /** 取消某个补间（不跳终点） */
  kill(handle: TweenHandle): void {
    if (!handle || handle.dead) return;
    handle.dead = true;
    if (handle.lock) this._lockCount = Math.max(0, this._lockCount - 1);
  }

  /** 清空全部补间（重开局） */
  killAll(runComplete = false): void {
    const list = this.tweens.slice();
    this.tweens.length = 0;
    this._lockCount = 0;
    if (runComplete) {
      for (const tw of list) { if (!tw.dead && tw.onComplete) { tw.dead = true; tw.onComplete(); } }
    }
  }
}

// ---------------------------------------------------------------------------
// 默认全局实例
// ---------------------------------------------------------------------------

export const animator = new Animator();

/** 主循环调用：推进所有补间 */
export function updateTweens(dt: number): void {
  animator.update(dt);
}

/** 契约风格的独立函数封装 */
export function tweenTo(object3D: any, targetPos: any, duration?: number, easing?: (t: number) => number, onComplete?: () => void): TweenHandle {
  return animator.tweenTo(object3D, targetPos, duration, easing, onComplete);
}

export default animator;
