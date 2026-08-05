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
import { TIMING } from '../core/constants.js';

// ---------------------------------------------------------------------------
// 缓动函数
// ---------------------------------------------------------------------------

export const Easing = {
  linear: t => t,
  easeInQuad: t => t * t,
  easeOutQuad: t => t * (2 - t),
  easeInOutQuad: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: t => t * t * t,
  easeOutCubic: t => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutBack: t => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutElastic: t => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  easeOutBounce: t => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};

// ---------------------------------------------------------------------------
// 材质透明化辅助（吃子消散用；可回滚，供悔棋恢复）
// ---------------------------------------------------------------------------

/**
 * 把整棵子树的材质 clone 成可透明版本，返回备份用于恢复
 * @param {THREE.Object3D} root
 * @returns {Array<{mesh:THREE.Mesh, orig:*}>}
 */
export function cloneMaterialsForFade(root) {
  const backup = [];
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const orig = o.material;
    backup.push({ mesh: o, orig });
    if (Array.isArray(orig)) {
      o.material = orig.map(m => {
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

/** 设置整棵子树的不透明度（须先调用 cloneMaterialsForFade） */
export function setTreeOpacity(root, v) {
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (let i = 0; i < ms.length; i++) ms[i].opacity = v;
  });
}

/** 还原材质并释放 clone 出来的那份 */
export function restoreMaterials(backup) {
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

export class Animator {
  constructor() {
    /** @type {Array<Object>} */
    this.tweens = [];
    this._lockCount = 0;
    this.timeScale = 1;
  }

  /** 是否有锁输入的动画在跑 */
  get isBusy() { return this._lockCount > 0; }

  /** 当前补间数量 */
  get count() { return this.tweens.length; }

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
  add(cfg) {
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
  delay(seconds, cb, lock = false) {
    return this.add({ duration: Math.max(0.0001, seconds), lock, onComplete: cb });
  }

  /**
   * 位置补间（契约要求的签名）
   * @param {THREE.Object3D} object3D
   * @param {THREE.Vector3|{x:number,y:number,z:number}} targetPos
   * @param {number} duration 秒
   * @param {Function} [easing]
   * @param {Function} [onComplete]
   */
  tweenTo(object3D, targetPos, duration = TIMING.moveDuration, easing = Easing.easeInOutCubic, onComplete) {
    const from = object3D.position.clone();
    const to = new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z);
    return this.add({
      duration, easing, lock: false,
      onUpdate: t => { object3D.position.lerpVectors(from, to, t); },
      onComplete: () => { object3D.position.copy(to); if (onComplete) onComplete(); }
    });
  }

  /** 数值补间 */
  tweenValue(from, to, duration, easing, onUpdate, onComplete) {
    return this.add({
      duration, easing: easing || Easing.linear,
      onUpdate: t => onUpdate(from + (to - from) * t),
      onComplete
    });
  }

  /** 缩放补间 */
  tweenScale(object3D, target, duration, easing = Easing.easeOutCubic, onComplete) {
    const from = object3D.scale.clone();
    const to = new THREE.Vector3(target.x, target.y, target.z);
    return this.add({
      duration, easing,
      onUpdate: t => object3D.scale.lerpVectors(from, to, t),
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
  arcMove(mesh, to, opts = {}) {
    const duration = opts.duration != null ? opts.duration : TIMING.moveDuration;
    const lift = opts.lift != null ? opts.lift : TIMING.liftHeight;
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
      onUpdate: (t, raw) => {
        if (curve) curve.getPoint(t, tmp); else tmp.lerpVectors(from, target, t);
        // 抛物线：4h·t·(1-t) 在 t=0.5 处取最大值 h
        tmp.y += lift * 4 * t * (1 - t);
        mesh.position.copy(tmp);
        if (spin) mesh.rotation.y = baseRotY + spin * t;
        // 轻微前倾，增加"被推动"的重量感
        const tilt = Math.sin(Math.PI * t) * 0.09;
        mesh.rotation.x = tilt * (target.z > from.z ? -1 : 1);
      },
      onComplete: () => {
        mesh.position.copy(target);
        mesh.rotation.x = 0;
        if (spin) mesh.rotation.y = baseRotY;
        if (opts.onComplete) opts.onComplete();
      }
    });
  }

  /**
   * 落子回弹：压扁 -> 回弹（squash & stretch）
   * @param {THREE.Object3D} mesh
   * @param {number} [strength]
   */
  squashLand(mesh, strength = 0.22) {
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
  boardImpact(boardGroup, amount = 0.055, duration = 0.34) {
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
  dissolvePiece(mesh, opts = {}) {
    const duration = opts.duration != null ? opts.duration : TIMING.captureDissolve;
    const backup = cloneMaterialsForFade(mesh);
    mesh.userData.__fadeBackup = backup;
    const baseScale = mesh.userData.__baseScale || (mesh.userData.__baseScale = mesh.scale.clone());
    const startY = mesh.position.y;
    const startRotY = mesh.rotation.y;
    const tmp = new THREE.Vector3();

    return this.add({
      duration,
      delay: opts.delay || 0,
      easing: Easing.easeInQuad,
      lock: opts.lock !== false,
      onUpdate: t => {
        mesh.position.y = startY - t * 0.75;
        mesh.rotation.y = startRotY + t * Math.PI * 1.35;
        mesh.rotation.z = t * 0.55;
        tmp.copy(baseScale).multiplyScalar(Math.max(0.02, 1 - t * 0.92));
        mesh.scale.copy(tmp);
        setTreeOpacity(mesh, Math.max(0, 1 - t * 1.05));
      },
      onComplete: () => { if (opts.onComplete) opts.onComplete(mesh, backup); }
    });
  }

  /** 恢复被消散过的棋子（悔棋用） */
  restorePiece(mesh) {
    const backup = mesh.userData.__fadeBackup;
    if (backup) { restoreMaterials(backup); mesh.userData.__fadeBackup = null; }
    const base = mesh.userData.__baseScale;
    if (base) mesh.scale.copy(base); else mesh.scale.set(1, 1, 1);
    mesh.rotation.set(0, mesh.userData.__baseRotY || 0, 0);
  }

  /** 攻击方向目标冲刺一小段（吃子的第一拍） */
  lunge(mesh, towards, ratio = 0.24, duration = TIMING.captureLunge) {
    const from = mesh.position.clone();
    const to = from.clone().lerp(towards, ratio);
    to.y = from.y + 0.12;
    return this.add({
      duration,
      easing: Easing.easeOutQuad,
      lock: true,
      onUpdate: t => mesh.position.lerpVectors(from, to, t),
      onComplete: () => mesh.position.copy(to)
    });
  }

  /** 非法操作时的左右抖动（Oil：明确的拒绝反馈） */
  shakeMesh(mesh, amplitude = 0.13, duration = 0.32) {
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

  /** 悬浮上下浮动（选中态由 effects 负责，这里提供一次性上浮） */
  hover(mesh, height = 0.16, duration = 0.18) {
    const from = mesh.position.clone();
    const to = from.clone(); to.y = (mesh.userData.__homeY || 0) + height;
    return this.add({
      duration, easing: Easing.easeOutCubic,
      onUpdate: t => mesh.position.lerpVectors(from, to, t),
      onComplete: () => mesh.position.copy(to)
    });
  }

  /** 放下（回到 y = home） */
  unhover(mesh, duration = 0.16) {
    const from = mesh.position.clone();
    const to = from.clone(); to.y = mesh.userData.__homeY || 0;
    return this.add({
      duration, easing: Easing.easeOutCubic,
      onUpdate: t => mesh.position.lerpVectors(from, to, t),
      onComplete: () => mesh.position.copy(to)
    });
  }

  // -------------------------------------------------------------------------
  // 推进 / 清理
  // -------------------------------------------------------------------------

  /** 主循环调用 */
  update(dt) {
    if (!this.tweens.length) return;
    const step = dt * this.timeScale;
    // 用副本遍历，允许回调中新增补间
    const list = this.tweens.slice();
    for (let i = 0; i < list.length; i++) {
      const tw = list[i];
      if (tw.dead) continue;
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
    }
    // 清理
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      if (this.tweens[i].dead) this.tweens.splice(i, 1);
    }
  }

  /** 立即结束某个补间（跳到终点） */
  finish(handle) {
    if (!handle || handle.dead) return;
    handle.elapsed = handle.duration;
    handle.delay = 0;
    if (handle.onUpdate) handle.onUpdate(handle.easing(1), 1);
    handle.dead = true;
    if (handle.lock) this._lockCount = Math.max(0, this._lockCount - 1);
    if (handle.onComplete) handle.onComplete();
  }

  /** 取消某个补间（不跳终点） */
  kill(handle) {
    if (!handle || handle.dead) return;
    handle.dead = true;
    if (handle.lock) this._lockCount = Math.max(0, this._lockCount - 1);
  }

  /** 清空全部补间（重开局） */
  killAll(runComplete = false) {
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
export function updateTweens(dt) {
  animator.update(dt);
}

/** 契约风格的独立函数封装 */
export function tweenTo(object3D, targetPos, duration, easing, onComplete) {
  return animator.tweenTo(object3D, targetPos, duration, easing, onComplete);
}

export default animator;
