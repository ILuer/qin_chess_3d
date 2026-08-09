/**
 * MoveAction.js — 移动序列 M0→M1→M2→M3→M4→M5
 *
 * 使用 animator.seq() 串联六拍，每拍 onStart 通过 beatSequencer.fire() 触发 SFX/VFX。
 *
 * 架构文档 §3.2 参照实现。
 */

import * as THREE from 'three';
import { PT, PALETTE, TIMING, toWorld } from '../../core/constants.js';
import {
  getBeatDuration, getLiftMul,
  MOVE_LEAN, M0_LEAN_BACK, M0_SQUASH,
  M3_OVERSHOOT, M4_SQUASH, AI_SPEED_MUL, VFX_INTERVAL
} from './CombatConstants.js';

/**
 * 执行普通移动演出
 *
 * @param {Object} cd           CombatDirector 实例
 * @param {THREE.Object3D} piece  移动棋子 Group
 * @param {{file:number,rank:number}} fromCell
 * @param {{file:number,rank:number}} toCell
 * @param {Object} opts
 * @param {boolean} [opts.aiFast=false]
 * @param {Function} [opts.onComplete]
 * @returns {Promise<void>}
 */
export function execute(cd, piece, fromCell, toCell, opts = {}) {
  return new Promise((resolve) => {
    const animator = cd.animator;
    const effects = cd.effects;
    const sequencer = cd.sequencer;

    const type = piece.userData.pieceType;
    const speedMul = opts.aiFast ? AI_SPEED_MUL : 1.0;

    // ── 取参数 ──
    const M0 = getBeatDuration('M0', type) * speedMul;
    const M1 = getBeatDuration('M1', type) * speedMul;
    const M2 = getBeatDuration('M2', type) * speedMul;
    const M3 = getBeatDuration('M3', type) * speedMul;
    const M4 = getBeatDuration('M4', type) * speedMul;
    const M5 = getBeatDuration('M5', type) * speedMul;

    const leanVal = MOVE_LEAN[type] || -0.12;
    const leanBack = M0_LEAN_BACK[type] || 0.08;
    const m0Squash = M0_SQUASH[type] || 0.97;
    const m3Over = M3_OVERSHOOT[type] || 1.04;
    const m4Squash = M4_SQUASH[type] || 0.22;
    const liftMul = getLiftMul(type);
    const liftPeak = TIMING.liftHeight * liftMul;

    // ── 获取 orient/idleGroup ──
    const orient = piece.getObjectByName('orient') || piece;
    const idleGroup = orient.getObjectByName('idleGroup') || orient;
    const baseScale = piece.userData.__baseScale || piece.scale.clone();
    if (!piece.userData.__baseScale) piece.userData.__baseScale = baseScale.clone();
    // ★ K 预缩放锁定：以 idleGroup 自身基准（K=1.25，其余=1）做相对缩放扰动，
    //   绝不写死 1.0 抹掉 K 的整体放大（piece-image-v4 §5 风险 2）。
    const idleBase = idleGroup.scale.clone();

    // ── 位置计算 ──
    const fromW = toWorld(fromCell.file, fromCell.rank);
    const toW = toWorld(toCell.file, toCell.rank);
    const startPos = new THREE.Vector3(fromW.x, 0, fromW.z);
    const endPos = new THREE.Vector3(toW.x, 0, toW.z);

    piece.position.copy(startPos);

    // ── 每拍回调注册 ──
    const unreg = sequencer.registerAll({
      'M1_start': () => {
        try { cd.sfx && cd.sfx.move(type, { pan: _cellPan(toCell), faction: piece.userData.pieceSide }); } catch (e) { /* sfx 未就绪 */ }
      },
      'M4_start': () => {
        effects.spawnImpactParticles(endPos.clone(), PALETTE.liuJin, { count: 42, ripple: true });
        effects.screenShake(0.03, 0.18);
        try { animator.boardImpact(cd.boardGroup, 0.055, 0.34); } catch (e) { /* no board */ }
      }
    });

    // ── 尘土/残影计时器 ──
    let dustTimer = 0;
    let afterTimer = 0;

    // ── 用 seq 串联六拍 ──
    const steps = [];

    // M0 · CHARGE 蓄力
    steps.push({
      duration: M0,
      easing: animator.EASE.easeOutQuad,
      onStart: () => { sequencer.fire('M0_start'); },
      onUpdate: (t) => {
        idleGroup.rotation.x = leanBack * t;
        idleGroup.scale.y = idleBase.y * (1 - (1 - m0Squash) * t);
        idleGroup.scale.x = idleBase.x * (1 + (1 - m0Squash) * t * 0.4);
      }
    });

    // M1 · LAUNCH 起步
    steps.push({
      duration: M1,
      easing: animator.EASE.easeInCubic,
      onStart: () => { sequencer.fire('M1_start'); },
      onUpdate: (t) => {
        idleGroup.rotation.x = leanBack * (1 - t);  // 后仰 → 0
        idleGroup.scale.copy(idleBase);             // 回弹（保留 K 预缩放）
      }
    });

    // M2 · DASH 加速巡航
    steps.push({
      duration: M2,
      lock: true,  // ★ 输入锁在此开始
      easing: animator.EASE.easeInCubic,
      onStart: () => { sequencer.fire('M2_start'); },
      onUpdate: (t) => {
        // 位置 lerp
        piece.position.lerpVectors(startPos, endPos, t);
        // 竖直弧线
        piece.position.y = liftPeak * 4 * t * (1 - t);
        // 前压 ramp
        idleGroup.rotation.x = leanVal * Math.sin(Math.PI * t);

        // 尘土拖尾 每 0.04s
        dustTimer += M2; // 微近似——实际应由帧 dt 累积，这里用总时长近似位置
        if (effects.spawnDustTrail && t > 0.05) {
          effects.spawnDustTrail(piece.position.clone(), piece.userData.pieceSide, type);
        }
        // 残影 每 0.05s（stub——Phase 3c 实现）
        if (effects.spawnAfterimage && t > 0.1 && t < 0.9) {
          effects.spawnAfterimage(piece);
        }
      }
    });

    // M3 · BRAKE 急停
    steps.push({
      duration: M3,
      lock: true,
      easing: animator.EASE.easeOutBack,
      onStart: () => { sequencer.fire('M3_start'); },
      onUpdate: (t) => {
        // 过冲
        const k = 1 - t;
        const osc = Math.sin(Math.PI * k * 2) * k;
        idleGroup.scale.x = idleBase.x * (1 + (m3Over - 1) * osc);
        idleGroup.scale.y = idleBase.y * (1 - (m3Over - 1) * 0.5 * osc);
        idleGroup.scale.z = idleBase.z * (1 + (m3Over - 1) * osc);
        idleGroup.rotation.x = leanVal;
      }
    });

    // M4 · IMPACT 落点顿挫
    steps.push({
      duration: M4,
      lock: true,
      easing: animator.EASE.easeOutQuad,
      onStart: () => { sequencer.fire('M4_start'); },
      onUpdate: (t) => {
        // squashLand 手工：前一半压扁，后一半回弹
        piece.position.copy(endPos);
        piece.position.y = 0;
        if (t < 0.5) {
          const s = t * 2;
          idleGroup.scale.y = idleBase.y * (1 - m4Squash * s);
          idleGroup.scale.x = idleBase.x * (1 + m4Squash * 0.6 * s);
          idleGroup.scale.z = idleBase.z * (1 + m4Squash * 0.6 * s);
        } else {
          const s = (t - 0.5) * 2;
          idleGroup.scale.y = idleBase.y * ((1 - m4Squash) + m4Squash * s);
          idleGroup.scale.x = idleBase.x * ((1 + m4Squash * 0.6) - m4Squash * 0.6 * s);
          idleGroup.scale.z = idleBase.z * ((1 + m4Squash * 0.6) - m4Squash * 0.6 * s);
        }
        idleGroup.rotation.x = leanVal * (1 - t);
      }
    });

    // M5 · RECOVERY 收势
    steps.push({
      duration: M5,
      lock: true,
      easing: animator.EASE.easeInOutQuad,
      onUpdate: (t) => {
        piece.position.copy(endPos);
        piece.position.y = 0;
        idleGroup.rotation.x = leanVal * (1 - t);
        idleGroup.scale.copy(idleBase);
      },
      onComplete: () => {
        // 释放 busy
        piece.userData._busy = false;
        piece.position.copy(endPos);
        piece.position.y = 0;
        idleGroup.rotation.x = 0;
        idleGroup.scale.copy(idleBase);

        // 清理
        unreg();
        sequencer.clear('M0_start');
        sequencer.clear('M1_start');
        sequencer.clear('M2_start');
        sequencer.clear('M3_start');
        sequencer.clear('M4_start');

        if (opts.onComplete) opts.onComplete();
        resolve();
      }
    });

    animator.seq(steps);
  });
}

/** 按 cell 计算 pan（−1..1） */
function _cellPan(cell) {
  const x = cell.file - 4;  // file 0..8 → -4..4
  return Math.max(-0.7, Math.min(0.7, x / 4 * 0.7));
}
