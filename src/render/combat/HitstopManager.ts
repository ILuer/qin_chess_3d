/**
 * HitstopManager.js — 全局时间缩放控制器
 *
 * 核心原理：
 *   主循环中 effectiveDt = rawDt × globalTimeScale
 *   hitstop 期间 timeScale = 0 → 所有补间/粒子/灯光冻结
 *   恢复时 timeScale 线性 ramp 0→1.0 避免跳变
 *
 * 不暂停 raf，不暂停 scene.render（仍需每帧绘制冻结帧）
 */

import { HITSTOP_RAMP } from './CombatConstants.ts';

export class HitstopManager {
  animator: { timeScale: number };
  active: boolean;
  _freezeTimer: ReturnType<typeof setTimeout> | null;
  _rampTimer: ReturnType<typeof setTimeout> | null;

  /**
   * @param {import('../animator.ts').Animator} animator
   */
  constructor(animator: { timeScale: number }) {
    /** @type {import('../animator.ts').Animator} */
    this.animator = animator;
    /** @type {boolean} 是否正在执行 hitstop + ramp */
    this.active = false;
    /** @type {number|null} 冻结 setTimeout id */
    this._freezeTimer = null;
    /** @type {number|null} ramp setTimeout id */
    this._rampTimer = null;
  }

  /** 当前 timeScale（只读） */
  get timeScale(): number {
    return this.animator.timeScale;
  }

  /** 是否冻结中（含 ramp 恢复期间） */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * 执行一次 hitstop：冻结 hold + 线性 ramp 恢复。
   *
   * @param {number} duration  冻结时长（秒）
   * @param {number} [ramp=HITSTOP_RAMP] 恢复线性 ramp 时长（秒），默认 0.03
   */
  freeze(duration: number, ramp: number = HITSTOP_RAMP): void {
    // 清除上次残留
    this._clearTimers();

    this.active = true;
    this.animator.timeScale = 0;

    const freezeMs = duration * 1000;
    const rampMs = ramp * 1000;

    // ① 冻结 hold
    this._freezeTimer = setTimeout(() => {
      // ② 线性 ramp 恢复
      const rampStart = performance.now();

      const step = () => {
        const elapsed = performance.now() - rampStart;
        const k = Math.min(1, elapsed / rampMs);
        this.animator.timeScale = k;          // 0 → 1.0 线性递增

        if (k < 1) {
          this._rampTimer = setTimeout(step, 8); // ~120Hz 更新
        } else {
          this.animator.timeScale = 1;
          this.active = false;
        }
      };
      step();
    }, freezeMs);
  }

  /**
   * 紧急中止（重开局 / 错误恢复）
   * 立即清除 timer，timeScale 归 1
   */
  abort(): void {
    this._clearTimers();
    this.animator.timeScale = 1;
    this.active = false;
  }

  /** 清理所有 pending timer */
  _clearTimers(): void {
    if (this._freezeTimer != null) {
      clearTimeout(this._freezeTimer);
      this._freezeTimer = null;
    }
    if (this._rampTimer != null) {
      clearTimeout(this._rampTimer);
      this._rampTimer = null;
    }
  }
}
