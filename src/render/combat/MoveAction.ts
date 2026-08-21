/**
 * MoveAction.js — 移动序列 M0→M1→M2→M3→M4→M5
 *
 * 使用 animator.seq() 串联六拍，每拍 onStart 通过 beatSequencer.fire() 触发 SFX/VFX。
 *
 * 架构文档 §3.2 参照实现。
 */

import * as THREE from 'three';
import { PT, PALETTE, TIMING, toWorld } from '../../core/constants.ts';
import { headingYaw } from '../animator.ts';
import {
  moveFlourish, resetMovePose,
  moveCharge, snapshotMovePose, settleMovePose
} from './PieceChoreography.ts';
import { cellPan } from './coords.ts';
import {
  getBeatDuration, getLiftMul,
  MOVE_LEAN, M0_LEAN_BACK, M0_SQUASH,
  M3_OVERSHOOT, M4_SQUASH, AI_SPEED_MUL, VFX_INTERVAL
} from './CombatConstants.ts';

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
export function execute(cd: any, piece: any, fromCell: { file: number, rank: number }, toCell: { file: number, rank: number }, opts: { aiFast?: boolean, onComplete?: () => void } = {}): Promise<void> {
  return new Promise<void>((resolve) => {
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

    // ── 朝向：起步阶段（M0 蓄力 + M1 起步）平滑转向移动方向 ──
    // 黑方 orient 的 Y=180° 已烘焙进 orient，红朝 -Z / 黑朝 +Z 由 headingYaw 处理；
    // 这里只写根 Group 的 rotation.y（相对偏航），绝不写 orient.rotation。
    // 落地后保留最终朝向（不回正），故下一着以当前 piece.rotation.y 为起点做增量转向。
    const moveSide = piece.userData.pieceSide;
    const dx = endPos.x - startPos.x;
    const dz = endPos.z - startPos.z;
    const startYaw = piece.rotation.y;
    let moveSpin = headingYaw(moveSide, dx, dz) - startYaw;
    while (moveSpin > Math.PI) moveSpin -= Math.PI * 2;
    while (moveSpin < -Math.PI) moveSpin += Math.PI * 2;
    if (Math.abs(moveSpin) > 0.001) {
      animator.add({
        duration: Math.max(0.001, M0 + M1),
        easing: animator.EASE.easeInOutCubic,
        onUpdate: (t: number) => { piece.rotation.y = startYaw + moveSpin * t; }
      });
    }

    // ── 每拍回调注册 ──
    const unreg = sequencer.registerAll({
      'M1_start': () => {
        // C2（ADR-2）：源定位通道 —— 目标格 world pos 喂给 sfx（PannerNode 3D；Safari 回退标量 pan）
        try {
          if (cd.sfx && cd.sfx._internals && cd.sfx._internals.updateSourceWorldPos) {
            cd.sfx._internals.updateSourceWorldPos({ x: toW.x, y: 0, z: toW.z });
          }
        } catch (e) { /* sfx 未就绪 */ }
        try { cd.sfx && cd.sfx.move(type, { pan: cellPan(toCell), faction: piece.userData.pieceSide }); } catch (e) { /* sfx 未就绪 */ }
      },
      'M4_start': () => {
        effects.spawnImpactParticles(endPos.clone(), PALETTE.liuJin, { count: 42, ripple: true });
        effects.screenShake(0.03, 0.18);
        effects.spawnImpactDust(endPos.clone(), { count: 14, life: 0.7 });
        effects.spawnGroundFlash(endPos.clone(), { color: PALETTE.liuJinLight, life: 0.34 });
        try { animator.boardImpact(cd.boardGroup, 0.055, 0.34); } catch (e) { /* no board */ }
      }
    });

    // ── 尘土/残影计时器 ──
    let dustTimer = 0;
    let afterTimer = 0;

    // ★ P3 跨拍进度换算（设计 §4.2 三段式映射）：
    //   anticipation = M0+M1，recovery = M3+M4+M5。子组姿态必须在**合并时间轴**上
    //   连续推进，否则每拍各自 0→1 会造成姿态反复重置（视觉抖动/静止）。
    const antTot = Math.max(1e-6, M0 + M1);
    const wM0 = M0 / antTot;
    const recTot = Math.max(1e-6, M3 + M4 + M5);
    const wM3 = M3 / recTot;
    const wM4 = M4 / recTot;
    /** M2 落点姿态快照（M3 onStart 采样），供 M3~M5 阻尼收势用 */
    let movePoseSnap: Record<string, number> | null = null;

    // ── 用 seq 串联六拍 ──
    const steps = [];

    // M0 · CHARGE 蓄力
    steps.push({
      duration: M0,
      easing: animator.EASE.easeOutQuad,
      onStart: () => { sequencer.fire('M0_start'); },
      onUpdate: (t: number) => {
        idleGroup.rotation.x = leanBack * t;
        idleGroup.scale.y = idleBase.y * (1 - (1 - m0Squash) * t);
        idleGroup.scale.x = idleBase.x * (1 + (1 - m0Squash) * t * 0.4);
        moveCharge(piece, type, t * wM0);   // ★ P3：起步蓄势子组随动（原缺失）
      }
    });

    // M1 · LAUNCH 起步
    steps.push({
      duration: M1,
      easing: animator.EASE.easeInCubic,
      onStart: () => { sequencer.fire('M1_start'); },
      onUpdate: (t: number) => {
        idleGroup.rotation.x = leanBack * (1 - t);  // 后仰 → 0
        idleGroup.scale.copy(idleBase);             // 回弹（保留 K 预缩放）
        moveCharge(piece, type, wM0 + (1 - wM0) * t);  // ★ P3：蓄势推进到峰值
      }
    });

    // M2 · DASH 加速巡航
    steps.push({
      duration: M2,
      lock: true,  // ★ 输入锁在此开始
      easing: animator.EASE.easeInCubic,
      onStart: () => { sequencer.fire('M2_start'); },
      onUpdate: (t: number) => {
        // 位置 lerp
        piece.position.lerpVectors(startPos, endPos, t);
        // 竖直弧线
        piece.position.y = liftPeak * 4 * t * (1 - t);
        // 前压 ramp
        idleGroup.rotation.x = leanVal * Math.sin(Math.PI * t);
        // 兵种子组随动（贴地冲锋姿态：戈前指 / 马前扑 / 双兵推车等）
        moveFlourish(piece, type, t);

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
      onStart: () => {
        sequencer.fire('M3_start');
        // ★ P3：在落点刹那快照冲锋极限姿态，M3~M5 由此做帧率无关的阻尼收势
        movePoseSnap = snapshotMovePose(piece, type);
      },
      onUpdate: (t: number) => {
        // 过冲
        const k = 1 - t;
        const osc = Math.sin(Math.PI * k * 2) * k;
        idleGroup.scale.x = idleBase.x * (1 + (m3Over - 1) * osc);
        idleGroup.scale.y = idleBase.y * (1 - (m3Over - 1) * 0.5 * osc);
        idleGroup.scale.z = idleBase.z * (1 + (m3Over - 1) * osc);
        idleGroup.rotation.x = leanVal;
        settleMovePose(piece, type, movePoseSnap, t * wM3);   // ★ P3：子组阻尼回摆
      }
    });

    // M4 · IMPACT 落点顿挫
    steps.push({
      duration: M4,
      lock: true,
      easing: animator.EASE.easeOutQuad,
      onStart: () => { sequencer.fire('M4_start'); },
      onUpdate: (t: number) => {
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
        settleMovePose(piece, type, movePoseSnap, wM3 + wM4 * t);   // ★ P3 收势续接
      }
    });

    // M5 · RECOVERY 收势
    steps.push({
      duration: M5,
      lock: true,
      easing: animator.EASE.easeInOutQuad,
      onUpdate: (t: number) => {
        piece.position.copy(endPos);
        piece.position.y = 0;
        idleGroup.rotation.x = leanVal * (1 - t);
        idleGroup.scale.copy(idleBase);
        settleMovePose(piece, type, movePoseSnap, wM3 + wM4 + (1 - wM3 - wM4) * t); // ★ P3 收势归零
      },
      onComplete: () => {
        // 释放 busy
        piece.userData._busy = false;
        piece.position.copy(endPos);
        piece.position.y = 0;
        idleGroup.rotation.x = 0;
        idleGroup.scale.copy(idleBase);
        resetMovePose(piece, type);   // 归零移动随动的兵种子组，无缝衔接待机

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
