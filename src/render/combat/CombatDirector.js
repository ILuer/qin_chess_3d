/**
 * CombatDirector.js — 战场演出总调度
 *
 * 职责：
 *   1. 接收 main.js 的 playMove/playCapture 调用
 *   2. 委托 MoveAction / CaptureAction 执行六拍序列
 *   3. 管理 HitstopManager + BeatSequencer
 *   4. 提供 setTension / isBusy / 调试接口
 *
 * 架构文档 §2 参照实现。
 */

import * as THREE from 'three';
import { HitstopManager } from './HitstopManager.js';
import { BeatSequencer } from './BeatSequencer.js';
import { execute as moveExecute } from './MoveAction.js';
import { execute as captureExecute } from './CaptureAction.js';
import { TENSION_TIMESCALE, TENSION_HITSTOP_MUL, getImpactLevel } from './CombatConstants.js';

export class CombatDirector {
  /**
   * @param {Object} deps
   * @param {import('../animator.js').Animator} deps.animator
   * @param {import('../scene.js').SceneSystem}  deps.sceneSys
   * @param {import('../effects.js').Effects}     deps.effects
   * @param {Object}       deps.sfx          — 音效引擎（当前用旧 SFX 兼容，未来切 recipes/sfx）
   * @param {THREE.Group}  deps.boardGroup
   * @param {THREE.Group}  deps.piecesGroup
   */
  constructor({ animator, sceneSys, effects, sfx, boardGroup, piecesGroup }) {
    /** @type {import('../animator.js').Animator} */
    this.animator = animator;
    /** @type {import('../scene.js').SceneSystem} */
    this.sceneSys = sceneSys;
    /** @type {import('../effects.js').Effects} */
    this.effects = effects;
    /** @type {Object} */
    this.sfx = sfx;
    /** @type {THREE.Group} */
    this.boardGroup = boardGroup;
    /** @type {THREE.Group} */
    this.piecesGroup = piecesGroup;

    /** @type {HitstopManager} */
    this.hitstop = new HitstopManager(animator);
    /** @type {BeatSequencer} */
    this.sequencer = new BeatSequencer();

    /** @type {string} 当前 FSM 状态 */
    this._state = 'IDLE';

    /** @type {{level: string, timeScale: number, hitstopMul: number}} */
    this._tension = {
      level: 'opening',
      timeScale: TENSION_TIMESCALE.opening,
      hitstopMul: TENSION_HITSTOP_MUL.opening
    };
  }

  // ═══════════════════════════════════════════════════════
  // 公共 API
  // ═══════════════════════════════════════════════════════

  /**
   * 执行普通移动演出（M0→M1→M2→M3→M4→M5）
   *
   * @param {THREE.Object3D}  piece    — 移动棋子 Group
   * @param {{file:number,rank:number}} fromCell
   * @param {{file:number,rank:number}} toCell
   * @param {Object} opts
   * @param {boolean} [opts.aiFast=false]
   * @param {Function} [opts.onComplete]
   * @returns {Promise<void>}
   */
  async playMove(piece, fromCell, toCell, opts = {}) {
    this._state = 'CHARGE';
    this._ensureBaseScale(piece);

    try {
      await moveExecute(this, piece, fromCell, toCell, opts);
    } catch (e) {
      console.warn('[CombatDirector] playMove 异常：', e);
      piece.userData._busy = false;
    } finally {
      this._state = 'IDLE';
    }
  }

  /**
   * 执行吃子演出（A0→A1→A2→A3→A4→A5）
   *
   * @param {THREE.Object3D} attacker
   * @param {THREE.Object3D} victim
   * @param {{file:number,rank:number}} fromCell
   * @param {{file:number,rank:number}} toCell
   * @param {Object} opts
   * @param {boolean} [opts.aiFast=false]
   * @param {string}  [opts.impactLevel]  — 'L3'|'L4'|'L5'，不传则自动判定
   * @param {Function} [opts.onComplete]
   * @returns {Promise<void>}
   */
  async playCapture(attacker, victim, fromCell, toCell, opts = {}) {
    this._state = 'APPROACH';
    this._ensureBaseScale(attacker);
    if (victim) this._ensureBaseScale(victim);

    // 自动判定冲击级
    if (!opts.impactLevel) {
      const vType = victim ? victim.userData.pieceType : null;
      // rec 由调用方提供 status ——这里从外部传入，当前由 main.js 判定后传入
      // 若无显式传入，用兵种查表
      if (!opts.impactLevel) {
        opts.impactLevel = vType ? this._estimateImpactLevel(vType) : 'L3';
      }
    }

    try {
      await captureExecute(this, attacker, victim, fromCell, toCell, opts);
    } catch (e) {
      console.warn('[CombatDirector] playCapture 异常：', e);
      attacker.userData._busy = false;
      if (victim) victim.userData._busy = false;
    } finally {
      this._state = 'IDLE';
    }
  }

  /**
   * 炮异步命中入口
   * @param {number} impactTime — performance.now() 绝对时间
   */
  triggerImpactAt(impactTime) {
    // 当前炮流程走 cannonCapture 的 onHit 回调，此方法供未来精确对齐
    this.sequencer.fire('T_ZERO', impactTime);
  }

  /**
   * 设置战场张力
   * @param {'opening'|'midgame'|'endgame-balanced'|'endgame-one-sided'} level
   */
  setTension(level) {
    this._tension.level = level;
    this._tension.timeScale = TENSION_TIMESCALE[level] || 1.0;
    this._tension.hitstopMul = TENSION_HITSTOP_MUL[level] || 1.0;

    // 基调写入 animator（不影响 hitstop 当前状态）
    if (!this.hitstop.isActive) {
      this.animator.timeScale = this._tension.timeScale;
    }
  }

  // ═══════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════

  /** 是否有演出进行中 */
  get isBusy() {
    return this._state !== 'IDLE';
  }

  /** FSM 当前状态 */
  get currentAction() {
    return this._state;
  }

  /** 调试快照 */
  get debugSnapshot() {
    return {
      state: this._state,
      tension: { ...this._tension },
      hitstopActive: this.hitstop.isActive,
      timeScale: this.animator.timeScale,
      animatorBusy: this.animator.isBusy,
      tweensCount: this.animator.count,
      registeredBeats: this.sequencer.getRegisteredBeats()
    };
  }

  // ═══════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════

  /** FSM 转移 */
  _fsmTransition(from, to) {
    if (this._state !== from) {
      console.warn(`[CombatDirector] FSM 转移异常：期望 ${from}→${to}，当前 ${this._state}`);
    }
    this._state = to;
  }

  /** 确保棋子有 __baseScale */
  _ensureBaseScale(piece) {
    if (!piece.userData.__baseScale) {
      piece.userData.__baseScale = piece.scale.clone();
    }
  }

  /** 根据受害者兵种估计冲击级 */
  _estimateImpactLevel(victimType) {
    // 车/炮/马/象/士 → L4，兵/卒 → L3
    const key = victimType;
    if (key === 'K') return 'L4';
    if (key === 'P') return 'L3';
    // R/C/N/B/A — 大子
    return 'L4';
  }

  /** 收尾清理（供 MoveAction/CaptureAction onComplete 调用） */
  _cleanupAction() {
    this.sequencer.clear();
    // 恢复 tension 基调 timeScale
    if (!this.hitstop.isActive) {
      this.animator.timeScale = this._tension.timeScale;
    }
  }

  /** 紧急中止（重开局调用） */
  abort() {
    this.hitstop.abort();
    this.sequencer.clear();
    this.animator.killAll(false);
    // 清理战斗灯光脉冲残留（bug-light-blinding 方案 B：脉冲中途重开 → 强制回基线）
    if (this.sceneSys && this.sceneSys.clearCombatLight) this.sceneSys.clearCombatLight();
    this._state = 'IDLE';
  }

  /** 销毁（清理资源） */
  dispose() {
    this.abort();
  }
}

export default CombatDirector;
