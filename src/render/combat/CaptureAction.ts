/**
 * CaptureAction.js — 吃子序列 A0→A1→A2→A3→A4→A5
 *
 * 以命中帧 T（A2 onComplete）为零点，对齐所有 SFX + VFX。
 * 架构文档 §3.3 参照实现。
 */

import * as THREE from 'three';
import { PT, PALETTE, TIMING, toWorld } from '../../core/constants.ts';
import { headingYaw } from '../animator.ts';
import {
  getCaptureBeat, getLiftMul, clampA0,
  MOVE_LEAN, M0_LEAN_BACK, M0_SQUASH,
  M3_OVERSHOOT, M4_SQUASH,
  HITSTOP, AI_SPEED_MUL, IMPACT_LEVELS
} from './CombatConstants.ts';
import { windUp, strike, settle, applyDissolvePose } from './PieceChoreography.ts';

/**
 * 执行吃子演出
 *
 * @param {Object} cd           CombatDirector 实例
 * @param {THREE.Object3D} attacker  攻击方棋子 Group
 * @param {THREE.Object3D} victim    被吃方棋子 Group
 * @param {{file:number,rank:number}} fromCell
 * @param {{file:number,rank:number}} toCell
 * @param {Object} opts
 * @param {boolean} [opts.aiFast=false]
 * @param {string}  [opts.impactLevel='L3']
 * @param {Function} [opts.onComplete]
 * @returns {Promise<void>}
 */
export function execute(cd: any, attacker: any, victim: any, fromCell: { file: number, rank: number }, toCell: { file: number, rank: number }, opts: { aiFast?: boolean, impactLevel?: string, onComplete?: () => void } = {}): Promise<void> {
  // ── 炮远程攻击走特殊分支 ──
  const aType = attacker.userData.pieceType;
  if (aType === PT.CANNON) {
    return executeCannon(cd, attacker, victim, fromCell, toCell, opts);
  }

  return new Promise<void>((resolve) => {
    const animator = cd.animator;
    const effects = cd.effects;
    const sceneSys = cd.sceneSys;
    const sequencer = cd.sequencer;
    const hitstop = cd.hitstop;

    const vType = victim.userData.pieceType;
    const aSide = attacker.userData.pieceSide;
    const speedMul = opts.aiFast ? AI_SPEED_MUL : 1.0;
    const impactLevel = opts.impactLevel || 'L3';
    const impactParam = (IMPACT_LEVELS as Record<string, { shakeIntensity: number, shakeDuration: number, particleCount: number, hitstop: number }>)[impactLevel] || IMPACT_LEVELS.L3;

    // ── 取参数 ──
    // A0 按距离算巡航时长（用 file 差近似距离）
    const distFactor = Math.max(0, Math.abs(toCell.file - fromCell.file) + Math.abs(toCell.rank - fromCell.rank)) / 8;
    const aTypeKey = aType;
    const A0 = clampA0(aTypeKey, distFactor) * speedMul;
    const A1 = getCaptureBeat('A1', aTypeKey) * speedMul;
    const A2 = getCaptureBeat('A2', aTypeKey) * speedMul;
    const A3 = impactParam.hitstop;  // hitstop 不用 speedMul
    const A4 = getCaptureBeat('A4', aTypeKey) * speedMul;
    const A5 = getCaptureBeat('A5', aTypeKey) * speedMul;

    const leanBackA1 = (M0_LEAN_BACK[aType] || 0.08) * 1.3; // 蓄势后仰略大于 M0
    const leanForwardA2 = -(MOVE_LEAN[aType] || -0.12) * 1.2;

    // ── 获取 orient/idleGroup ──
    const aOrient = attacker.getObjectByName('orient') || attacker;
    const aIdle = aOrient.getObjectByName('idleGroup') || aOrient;
    const baseScale = attacker.userData.__baseScale || attacker.scale.clone();
    if (!attacker.userData.__baseScale) attacker.userData.__baseScale = baseScale.clone();
    // ★ K 预缩放锁定：以 idleGroup 自身基准（K=1.25，其余=1）做相对缩放扰动。
    const aIdleBase = aIdle.scale.clone();

    // ── 位置 ──
    const fromW = toWorld(fromCell.file, fromCell.rank);
    const toW = toWorld(toCell.file, toCell.rank);
    const startPos = new THREE.Vector3(fromW.x, 0, fromW.z);
    const endPos = new THREE.Vector3(toW.x, 0, toW.z);

    attacker.position.copy(startPos);

    // ── 朝向：冲锋前（A0 的 M0+M1 蓄力段）平滑转向受害者 ──
    // 只写根 Group 的 rotation.y（相对偏航），绝不写 orient.rotation（黑方 180° 已在 orient 内）。
    // 落地后保留最终朝向（不回正），后续着法以当前 attacker.rotation.y 为起点做增量转向。
    const capDx = endPos.x - startPos.x;
    const capDz = endPos.z - startPos.z;
    const capStartYaw = attacker.rotation.y;
    let capSpin = headingYaw(aSide, capDx, capDz) - capStartYaw;
    while (capSpin > Math.PI) capSpin -= Math.PI * 2;
    while (capSpin < -Math.PI) capSpin += Math.PI * 2;
    if (Math.abs(capSpin) > 0.001) {
      // 转向时长对齐整段 A0 冲锋：旋转与平移在 A0 末同时到位，攻方恰好面向 victim 落定。
      animator.add({
        duration: Math.max(0.001, A0),
        easing: animator.EASE.easeInOutCubic,
        onUpdate: (t: number) => { attacker.rotation.y = capStartYaw + capSpin * t; }
      });
    }

    // ── 计算命中帧 T ──
    const totalBeforeT = A0 + A1 + A2;
    const impactPerfTime = performance.now() + totalBeforeT * 1000;

    // 音效：plan（若 sfx 就绪）
    try {
      if (cd.sfx && cd.sfx.combat && cd.sfx.combat.plan) {
        const clock = cd.sfx.clock ? cd.sfx.clock() : { ctxTime: 0, perfTime: performance.now() };
        const impactCtxTime = clock.ctxTime + (impactPerfTime - clock.perfTime) / 1000;
        cd.sfx.combat.plan({
          piece: aTypeKey, action: 'capture',
          faction: aSide,
          victim: { type: vType, side: victim.userData.pieceSide },
          impactAt: impactCtxTime,
          panFrom: _cellPan(fromCell), panTo: _cellPan(toCell),
          hitstop: A3, density: 'full', tension: cd._tension || 0
        });
      }
    } catch (e) { /* sfx 未就绪，忽略 */ }

    // ── 命中帧集中触发（在 A2 onComplete 中）──
    const fireImpact = () => {
      const pos = endPos.clone();
      sequencer.fire('T_ZERO');

      // ★ 粒子
      effects.spawnImpactParticles(pos, PALETTE.chiHong, { count: impactParam.particleCount, ripple: true });
      // ★ 震屏
      effects.screenShake(impactParam.shakeIntensity, impactParam.shakeDuration);
      // ★ 武器拖痕 stub（Phase 3c 实现）
      if (effects.spawnWeaponTrail) effects.spawnWeaponTrail(attacker, aType);
      // ★ 战斗灯光 stub（Phase 3c 实现）
      if (sceneSys && sceneSys.pulseCombatLight) sceneSys.pulseCombatLight(impactLevel);

      // ★ 攻击方 SFX 通过 plan 排布，A2 onComplete 就是命中时刻

      // ★ Hitstop 冻结
      if (A3 > 0) {
        hitstop.freeze(A3);
      }
    };

    // ── Beat 回调 ──
    const unreg = sequencer.registerAll({
      'A0_start': () => {},
      'A1_start': () => {},
      'A4_start': () => {
        // 受害者消散
        animator.dissolvePiece(victim, {
          duration: A4,
          delay: 0,
          lock: true,
          onComplete: (m: any) => {
            try { cd.piecesGroup.remove(m); } catch (e) {}
          }
        });
      },
      'A5_start': () => {}
    });

    // ── 用 seq 串联 ──
    const steps = [];

    // A0 · APPROACH = M0+M1+M2+M3 简化版
    const liftMul = getLiftMul(aType);
    const liftPeak = TIMING.liftHeight * liftMul;
    const leanVal = MOVE_LEAN[aType] || -0.12;

    // A0 sub-beats（贴地冲锋：朝向已在 A0 前段旋至 victim 方向，这里只做平移 + 微前压）
    // 关键修复：原实现仅在 i===2(巡航) 拍写位置且 totalT 只覆盖 0.5~0.75，
    //   又因 A0-M0f-M1f-M3f 常为负导致巡航拍≈0，攻方停在路径 75% 处，
    //   最终由 A5 的 position.copy(endPos) 瞬移补完 —— 形成可见跳变(违反 A4)。
    // 现改为四拍占比固定(A0*0.30/0.20/0.35/0.15)，总时长===A0 保证命中时刻对齐；
    //   位置/弧高/前压在四拍连续推进 totalT=(i+t)/4，A0 末攻方恰好抵达 victim 格，
    //   后续 A1~A5 不再瞬移（贴地弧高 liftPeak 仍受 liftMul 约束）。
    const a0b0 = A0 * 0.30, a0b1 = A0 * 0.20, a0b2 = A0 * 0.35, a0b3 = A0 * 0.15;
    [
      { dur: a0b0, id: 'A0_M0' },
      { dur: a0b1, id: 'A0_M1' },
      { dur: a0b2, id: 'A0_M2' },
      { dur: a0b3, id: 'A0_M3' }
    ].forEach((sub, i) => {
      const isLast = i === 3;
      steps.push({
        duration: Math.max(0.001, sub.dur),
        lock: true,
        easing: i === 2 ? animator.EASE.easeInCubic : animator.EASE.easeOutQuad,
        onStart: () => { if (i === 0) sequencer.fire('A0_start'); },
        onUpdate: (t: number) => {
          const totalT = (i + t) / 4;
          attacker.position.lerpVectors(startPos, endPos, totalT);
          attacker.position.y = liftPeak * 4 * totalT * (1 - totalT);
          aIdle.rotation.x = leanVal * Math.sin(Math.PI * totalT);
          if (isLast) {
            aIdle.scale.x = aIdleBase.x * (1 + 0.04 * (1 - t) * Math.sin(Math.PI * t));
            aIdle.scale.y = aIdleBase.y * (1 - 0.02 * (1 - t) * Math.sin(Math.PI * t));
          }
        }
      });
    });

    // A1 · WIND UP 蓄势
    steps.push({
      duration: Math.max(0.001, A1),
      lock: true,
      easing: animator.EASE.easeOutQuad,
      onStart: () => { sequencer.fire('A1_start'); },
      onUpdate: (t: number) => {
        aIdle.rotation.x = leanBackA1 * t;
        windUp(attacker, aType, t);
      }
    });

    // A2 · STRIKE 斩击（核心拍）
    steps.push({
      duration: Math.max(0.001, A2),
      lock: true,
      easing: animator.EASE.easeInCubic,  // 越来越快，命中瞬间最大
      onUpdate: (t: number) => {
        // 前压突进：后仰 → 前压
        aIdle.rotation.x = leanBackA1 * (1 - t) + leanForwardA2 * t;
        strike(attacker, aType, endPos, t);
      },
      onComplete: () => {
        // ★★★★★ 命中帧 T ★★★★★
        fireImpact();
      }
    });

    // A3 · HITSTOP 不放入 seq（hitstop.freeze 已在 fireImpact 中执行）
    // 若 hitstop 时间 > 0，需要等待其完成后再进入 A4
    // — 通过 animator.delay 等待 hitstop 完成

    // A4 · COLLAPSE 受害者崩塌（在 hitstop ramp 结束后）
    steps.push({
      duration: Math.max(0.001, A3 + A4),  // 含 hitstop 时长
      lock: true,
      easing: animator.EASE.linear,
      onStart: () => {
        // A4 实际启动在 hitstop 末，由 delay 处理
        animator.delay(A3, () => {
          sequencer.fire('A4_start');
        });
      },
      onUpdate: (t: number) => {
        // A3 前半段（hitstop）冻结——不更新姿态
        if (t < A3 / (A3 + A4)) return;
        // A4 后半段：受害者崩姿由 dissolvePiece 内部驱动
      }
    });

    // A5 · SETTLE 收势
    steps.push({
      duration: Math.max(0.001, A5),
      lock: true,
      easing: animator.EASE.easeInOutQuad,
      onStart: () => { sequencer.fire('A5_start'); },
      onUpdate: (t: number) => {
        attacker.position.copy(endPos);
        attacker.position.y = 0;
        aIdle.rotation.x = leanForwardA2 * (1 - t);
        aIdle.scale.copy(aIdleBase);
        settle(attacker, aType, t);
      },
      onComplete: () => {
        attacker.userData._busy = false;
        attacker.position.copy(endPos);
        attacker.position.y = 0;
        aIdle.rotation.x = 0;
        aIdle.scale.copy(aIdleBase);

        // 清理
        unreg();
        ['A0_start', 'A1_start', 'A4_start', 'A5_start', 'T_ZERO'].forEach(id => sequencer.clear(id));

        if (opts.onComplete) opts.onComplete();
        resolve();
      }
    });

    animator.seq(steps);
  });
}

// ═══════════════════════════════════════════════════════════════
// 炮特殊流程 executeCannon
// ═══════════════════════════════════════════════════════════════

/**
 * 炮远程吃子：本体不平移，弹丸飞行命中
 */
function executeCannon(cd: any, attacker: any, victim: any, fromCell: { file: number, rank: number }, toCell: { file: number, rank: number }, opts: { aiFast?: boolean, impactLevel?: string, onComplete?: () => void } = {}): Promise<void> {
  return new Promise<void>((resolve) => {
    const animator = cd.animator;
    const effects = cd.effects;
    const speedMul = opts.aiFast ? AI_SPEED_MUL : 1.0;

    const vType = victim.userData.pieceType;
    const aSide = attacker.userData.pieceSide;
    const impactLevel = opts.impactLevel || 'L4';
    const impactParam = (IMPACT_LEVELS as Record<string, { shakeIntensity: number, shakeDuration: number, particleCount: number, hitstop: number }>)[impactLevel] || IMPACT_LEVELS.L4;
    const A3 = impactParam.hitstop;

    const fromW = toWorld(fromCell.file, fromCell.rank);
    const toW = toWorld(toCell.file, toCell.rank);
    const fromVec = new THREE.Vector3(fromW.x, 0, fromW.z);
    const toVec = new THREE.Vector3(toW.x, 0, toW.z);

    // 弹丸飞行时间
    const dist = fromVec.distanceTo(toVec);
    const flightTime = Math.max(0.12, Math.min(0.36, dist * 0.06 / speedMul));

    // 使用旧 animator.cannonCapture，但在 onHit 中注入 SFX + hitstop
    animator.cannonCapture(attacker, victim, fromVec, toVec, aSide, {
      onHit: (v: any) => {
        // SFX（炮吃子命中音）
        try {
          if (cd.sfx && cd.sfx.capture) {
            cd.sfx.capture(PT.CANNON, { pan: _cellPan(toCell), faction: aSide });
          }
          if (cd.sfx && cd.sfx.captured) {
            cd.sfx.captured(vType, victim.userData.pieceSide, { pan: _cellPan(toCell) });
          }
        } catch (e) {}

        // 溶解受害者
        animator.dissolvePiece(v, {
          delay: 0,
          duration: 0.42,
          onComplete: (m: any) => { try { cd.piecesGroup.remove(m); } catch (e) {} }
        });

        // VFX
        effects.spawnImpactParticles(toVec.clone(), PALETTE.chiHong, { count: impactParam.particleCount });
        effects.screenShake(impactParam.shakeIntensity, impactParam.shakeDuration);

        // hitstop
        if (A3 > 0 && cd.hitstop) {
          cd.hitstop.freeze(A3);
        }
      },
      onLand: () => {
        attacker.userData._busy = false;
        if (opts.onComplete) opts.onComplete();
        resolve();
      }
    });
  });
}

function _cellPan(cell: { file: number, rank: number }): number {
  const x = cell.file - 4;
  return Math.max(-0.7, Math.min(0.7, x / 4 * 0.7));
}
