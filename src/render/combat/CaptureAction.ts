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
  HITSTOP, AI_SPEED_MUL, IMPACT_LEVELS, CAPTURE_TOTAL, CAPTURE_BEAT,
  beatSpeedMul, distScaleFor
} from './CombatConstants.ts';
import { windUp, strike, settle, applyDissolvePose } from './PieceChoreography.ts';
import { cellPan, cellDistance } from './coords.ts';
import { cloneMaterialsForFade, setTreeOpacity, restoreMaterials } from '../animator.ts';

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
    const impactLevel = opts.impactLevel || 'L3';
    const impactParam = (IMPACT_LEVELS as Record<string, { shakeIntensity: number, shakeDuration: number, particleCount: number, hitstop: number }>)[impactLevel] || IMPACT_LEVELS.L3;

    // ── 距离因子 ──
    // cellDist = 格数（1~N），喂给速度框架（决策 5：远距时长随距离增长）。
    // distFactor = 原归一化距离（格子/8），仅给 clampA0 算 A0 巡航时长用，语义不变。
    const cellDist = Math.max(1, cellDistance(fromCell, toCell));
    const distFactor = Math.max(0, Math.abs(toCell.file - fromCell.file) + Math.abs(toCell.rank - fromCell.rank)) / 8;
    // ★ Sprint 1 速度框架（决策 2+5）：
    //   beatSpeedMul(pt) = ANIM_SPEED × SPEED_MUL[pt]（兵种速度，放时长分母）；
    //   distScale = distScaleFor(格距)（远距时长更长，放时长分子，决策 5 物理真实）。
    //   每拍时长 = 原拍长 / speedMul × distScale。与 AI_SPEED_MUL 正交相乘；
    //   与 timeScale(dt 缩放) 正交不冲突；hitstop(A3) 不缩放（见 A3 = impactParam.hitstop）。
    const baseSpeedMul = beatSpeedMul(aType);
    const speedMul = opts.aiFast ? baseSpeedMul * AI_SPEED_MUL : baseSpeedMul;
    const distScale = distScaleFor(cellDist);
    const aTypeKey = aType;
    const A0 = clampA0(aTypeKey, distFactor) / speedMul * distScale;
    const A1 = getCaptureBeat('A1', aTypeKey) / speedMul * distScale;
    const A2 = getCaptureBeat('A2', aTypeKey) / speedMul * distScale;
    const A3 = impactParam.hitstop;  // hitstop 不用 speedMul（冻结 dt 流）
    const A4 = getCaptureBeat('A4', aTypeKey) / speedMul * distScale;
    const A5 = getCaptureBeat('A5', aTypeKey) / speedMul * distScale;

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

    // C2（ADR-2）：松耦合 3D 源定位通道 —— 把受害者格 world pos 喂给 sfx 的 sourceWorldPos，
    // 使本拍的 PannerNode 直接落点（render 侧不 import audio 内容；Safari 回退标量 pan 零破坏）。
    try {
      if (cd.sfx && cd.sfx._internals && cd.sfx._internals.updateSourceWorldPos) {
        cd.sfx._internals.updateSourceWorldPos({ x: toW.x, y: 0, z: toW.z });
      }
    } catch (e) { /* sfx 未就绪，忽略 */ }

    // 音效：plan（若 sfx 就绪）—— C3（ADR-4）：combat.plan 内部已改 ctx 绝对时间渲染（无 setTimeout）
    try {
      if (cd.sfx && cd.sfx.combat && cd.sfx.combat.plan) {
        const clock = cd.sfx.clock ? cd.sfx.clock() : { ctxTime: 0, perfTime: performance.now() };
        const impactCtxTime = clock.ctxTime + (impactPerfTime - clock.perfTime) / 1000;
        cd.sfx.combat.plan({
          piece: aTypeKey, action: 'capture',
          faction: aSide,
          victim: { type: vType, side: victim.userData.pieceSide },
          impactAt: impactCtxTime,
          panFrom: cellPan(fromCell), panTo: cellPan(toCell),
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
      // ★ 尘土迸发 + 地面裂闪（T3 · 战场 VFX）
      effects.spawnImpactDust(pos, { count: Math.max(12, Math.round(impactParam.particleCount * 0.6)) });
      effects.spawnGroundFlash(pos, { color: PALETTE.liuJinLight });
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
 * 炮远程吃子：本体不平移，显式四段 seq（装填 LOAD → 瞄准 AIM → 射击 FIRE → 后坐 RECOIL）。
 *
 * Phase A2 重构（docs/piece-combat-implementation-plan.md A2 + animation-spec §3.6）：
 *   - 四段总长锚定 CAPTURE_TOTAL.C = 1.25s（P5 节奏硬规则：写实只做内部时间重分配，不拖局）
 *   - 装填段锚定 CAPTURE_BEAT.C.A1 = 0.22（R1 指出现状未使用，本次落地）
 *   - 保留「全程输入锁 + onLand(_busy 释放) 回调」收尾契约；命中帧 T 落 FIRE 末
 *   - animator.cannonCapture 保留为兼容回退（标注废弃），本路径不再委托
 */
function executeCannon(cd: any, attacker: any, victim: any, fromCell: { file: number, rank: number }, toCell: { file: number, rank: number }, opts: { aiFast?: boolean, impactLevel?: string, onComplete?: () => void } = {}): Promise<void> {
  return new Promise<void>((resolve) => {
    const animator = cd.animator;
    const effects = cd.effects;
    // ★ Sprint 1 速度框架：炮接入 beatSpeedMul(C=0.9 慢)，与 AI 正交相乘。
    //   炮为隔山打牛、总长锚定 CAPTURE_TOTAL.C（内部时间重分配），不随格距拉长，
    //   故此处不含 distScale（与决策 5「炮慢」一致，距离因子对炮无意义）。
    const _baseSpeedMul = beatSpeedMul(PT.CANNON);
    const speedMul = opts.aiFast ? _baseSpeedMul * AI_SPEED_MUL : _baseSpeedMul;

    const vType = victim.userData.pieceType;
    const aSide = attacker.userData.pieceSide;
    const impactLevel = opts.impactLevel || 'L4';
    const impactParam = (IMPACT_LEVELS as Record<string, { shakeIntensity: number, shakeDuration: number, particleCount: number, hitstop: number }>)[impactLevel] || IMPACT_LEVELS.L4;
    const A3 = impactParam.hitstop;

    const fromW = toWorld(fromCell.file, fromCell.rank);
    const toW = toWorld(toCell.file, toCell.rank);
    const fromVec = new THREE.Vector3(fromW.x, 0, fromW.z);
    const toVec = new THREE.Vector3(toW.x, 0, toW.z);
    const dist = fromVec.distanceTo(toVec);
    const flightTime = Math.max(0.12, Math.min(0.36, dist * 0.06 / speedMul));

    // ── 四段时长（总长锚定 CAPTURE_TOTAL.C；装填引用 CAPTURE_BEAT.C.A1=0.22）──
    const totalTarget = CAPTURE_TOTAL.C;                                 // 1.25s（A2 验收锚点）
    const distFactor = Math.max(0, Math.abs(toCell.file - fromCell.file) + Math.abs(toCell.rank - fromCell.rank)) / 8;
    const A0 = clampA0('C', distFactor) * speedMul;                      // 冲锋接近（装填前置）
    const A1 = CAPTURE_BEAT.C.A1 * speedMul;                             // 装填拍 0.22（CAN-003 锚点）
    const A2 = getCaptureBeat('A2', 'C') * speedMul;                     // 射击（抛臂甩出）0.07
    const A5 = getCaptureBeat('A5', 'C') * speedMul;                     // 后坐复位 0.36
    const loadDur = A0 + A1;                                             // ① 装填 = 冲锋 + 装填拍
    const fireDur = A2 + flightTime;                                     // ③ 射击 = 甩臂 + 弹道飞行
    const recoilDur = A5;                                                // ④ 后坐复位
    const aimDur = Math.max(0.001, totalTarget - loadDur - fireDur - recoilDur); // ② 瞄准 = 余量（总长恒定 = CAPTURE_TOTAL.C）
    // ⑤/⑥ 换位拍（不参与 totalTarget 锚定 —— 命中帧 T 仍在 FIRE 末，验收锚点不变）
    const VANISH_OUT = 0.16 * speedMul;   // 原位淡出
    const VANISH_IN = 0.20 * speedMul;    // 目标位淡入

    // 起始落位（保证淡出发生在原格；防上游未同步 position）
    attacker.position.copy(fromVec);

    const sg = attacker.userData.subGroups || {};
    const orient = attacker.getObjectByName('orient') || attacker;
    const idleGroup = orient.getObjectByName('idleGroup') || orient;

    // ── 朝向：瞄准段平滑转体对准目标（只写根 Group.rotation.y，绝不写 orient）──
    const aimSpin = headingYaw(aSide, toVec.x - fromVec.x, toVec.z - fromVec.z) - attacker.rotation.y;
    let spin = aimSpin;
    while (spin > Math.PI) spin -= Math.PI * 2;
    while (spin < -Math.PI) spin += Math.PI * 2;
    if (Math.abs(spin) > 0.001) {
      const startYaw = attacker.rotation.y;
      animator.add({
        duration: Math.max(0.001, aimDur),
        delay: Math.max(0, loadDur),
        easing: animator.EASE.easeInOutCubic,
        onUpdate: (t: number) => { attacker.rotation.y = startYaw + spin * t; }
      });
    }

    // ── 命中帧集中触发（FIRE 末 = 弹丸着点；SFX/VFX/hitstop/受害者崩解全部对齐）──
    const fireImpact = (v: any): void => {
      const pos = toVec.clone();
      try { cd.sequencer && cd.sequencer.fire('T_ZERO'); } catch (e) { /* sequencer 未就绪 */ }
      // SFX（炮吃子命中音）
      // C3（ADR-4）：命中帧 T 用 ctx 绝对时间触发 stoneImpact（playAt 无节流、帧级对齐）；
      //   C2（ADR-2）：先喂 sourceWorldPos 通道做 PannerNode 3D 定位（受害者格）。
      //   旧 SFX 无 playAt 时回退 capture/captured（标量 pan，行为不变）。
      try {
        const wPos = { x: toW.x, y: 0, z: toW.z };
        if (cd.sfx && cd.sfx._internals && cd.sfx._internals.updateSourceWorldPos) {
          cd.sfx._internals.updateSourceWorldPos(wPos);
        }
        if (cd.sfx && typeof cd.sfx.playAt === 'function') {
          const clk = cd.sfx.clock ? cd.sfx.clock() : null;
          const tHit = clk && clk.ctxTime != null ? clk.ctxTime + 0.002 : 0;
          cd.sfx.playAt('cannon.capture.stoneImpact', tHit, { faction: aSide });
        } else if (cd.sfx && cd.sfx.capture) {
          cd.sfx.capture(PT.CANNON, { pan: cellPan(toCell), faction: aSide });
        }
        if (cd.sfx && cd.sfx.captured) {
          cd.sfx.captured(vType, victim.userData.pieceSide, { pan: cellPan(toCell) });
        }
      } catch (e) { /* sfx 未就绪 */ }
      // 溶解受害者
      try {
        animator.dissolvePiece(v, {
          delay: 0, duration: 0.42,
          onComplete: (m: any) => { try { cd.piecesGroup.remove(m); } catch (e) { /* 已移除 */ } }
        });
      } catch (e) { /* 安全兜底 */ }
      // VFX
      effects.spawnImpactParticles(pos, PALETTE.chiHong, { count: impactParam.particleCount });
      effects.spawnImpactDust(pos, { count: Math.max(12, Math.round(impactParam.particleCount * 0.6)) });
      effects.spawnGroundFlash(pos, { color: PALETTE.liuJinLight });
      effects.screenShake(impactParam.shakeIntensity, impactParam.shakeDuration);
      // hitstop
      if (A3 > 0 && cd.hitstop) cd.hitstop.freeze(A3);
    };

    // ── 弹丸（场景缺失时安全跳过 —— node 测试桩无 parent）──
    const scene = attacker.parent;
    let proj: any = null;
    let arc: any = null;
    const tmp = new THREE.Vector3();

    const steps = [];

    // ① LOAD · 装填（抱石 → 上弦 → 拉弦 → 就位）
    steps.push({
      duration: Math.max(0.001, loadDur),
      lock: true,
      easing: animator.EASE.easeOutCubic,
      onUpdate: (t: number) => {
        // 抛臂拉弦：全程累计，越拉越慢 = 蓄力感（easeOutCubic 已由 step easing 施加）
        if (sg.trebuchet) sg.trebuchet.rotation.z = -0.48 * t;
        if (sg.counterweight) sg.counterweight.rotation.z = 0.42 * t; // 配重反向上扬（蓄力）
        // 双兵协作：前 1/3 抱石 / 中 1/3 上弦 / 后 1/3 就位警戒
        if (sg.soldierL && sg.soldierR) {
          if (t < 1 / 3) {
            sg.soldierL.rotation.x = -0.45 * (t * 3);
            sg.soldierR.rotation.x = 0;
          } else if (t < 2 / 3) {
            sg.soldierR.rotation.x = 0.35 * ((t - 1 / 3) * 3);
            sg.soldierL.rotation.x = -0.45;
          } else {
            sg.soldierL.rotation.x = -0.15;
            sg.soldierR.rotation.x = -0.15;
          }
        }
      }
    });

    // ② AIM · 瞄准（锁定拉弦峰值 + 车架压稳 + 整体转体对准）
    steps.push({
      duration: Math.max(0.001, aimDur),
      lock: true,
      easing: animator.EASE.easeInOutCubic,
      onUpdate: (t: number) => {
        if (sg.trebuchet) sg.trebuchet.rotation.z = -0.48;   // 峰值锁定（瞄准期不动）
        if (sg.counterweight) sg.counterweight.rotation.z = 0.42; // 配重同步锁定
        if (sg.cart) sg.cart.rotation.x = -0.06 * t;         // 双兵压身稳住车架
      }
    });

    // ③ FIRE · 射击（抛臂甩出 → 石弹抛物线飞行；命中帧 T 在末）
    const swingRatio = Math.max(0.001, A2 / fireDur);
    steps.push({
      duration: Math.max(0.001, fireDur),
      lock: true,
      easing: animator.EASE.easeInCubic,
      onStart: () => {
        if (scene) {
          proj = new THREE.Mesh(
            new THREE.SphereGeometry(0.07, 10, 8),
            new THREE.MeshStandardMaterial({ color: 0x6f7d63, emissive: 0x241f15, emissiveIntensity: 0.45, roughness: 0.9, metalness: 0.1 })
          );
          proj.castShadow = true;
          const start = fromVec.clone(); start.y = (attacker.userData.topY || 1.0) * 0.6 + 0.2;
          proj.position.copy(start);
          const mid = new THREE.Vector3((start.x + toVec.x) / 2, Math.max(start.y, toVec.y) + 0.95, (start.z + toVec.z) / 2);
          arc = new THREE.CatmullRomCurve3([start, mid, toVec.clone()]);
          scene.add(proj);
        }
      },
      onUpdate: (t: number) => {
        const swingT = Math.min(1, t / swingRatio);   // 抛臂甩出进度（前 A2 占比）
        if (sg.trebuchet) sg.trebuchet.rotation.z = -0.48 * (1 - swingT) + 0.40 * Math.sin(Math.PI * swingT);
        if (sg.counterweight) sg.counterweight.rotation.z = 0.42 * (1 - swingT) - 0.36 * Math.sin(Math.PI * swingT); // 配重猛砸（反向）
        if (proj && arc) {
          const flightT = Math.max(0, (t - swingRatio) / (1 - swingRatio));
          arc.getPoint(Math.min(1, flightT), tmp);
          proj.position.copy(tmp);
        }
      },
      onComplete: () => {
        if (scene && proj) {
          scene.remove(proj);
          if (proj.geometry && proj.geometry.dispose) proj.geometry.dispose();
          if (proj.material && proj.material.dispose) proj.material.dispose();
        }
        fireImpact(victim);   // ★★★★★ 命中帧 T ★★★★★
      }
    });

    // ④ RECOIL · 后坐（抛臂惯性过冲 +0.18 阻尼回摆；车架后坐；双兵戒备复位）
    steps.push({
      duration: Math.max(0.001, recoilDur),
      lock: true,
      easing: animator.EASE.easeOutQuad,
      onUpdate: (t: number) => {
        const osc = Math.sin(Math.PI * t) * (1 - t);   // 阻尼随动（随动不回弹过冲）
        if (sg.trebuchet) sg.trebuchet.rotation.z = 0.18 * osc;
        if (sg.counterweight) sg.counterweight.rotation.z = -0.16 * osc; // 配重回摆
        if (sg.cart) sg.cart.rotation.x = -0.10 * (1 - t);
        if (sg.soldierL) sg.soldierL.rotation.x = -0.20 * (1 - t);
        if (sg.soldierR) sg.soldierR.rotation.x = -0.20 * (1 - t);
      },
      onComplete: () => {
        // 复位全部子组（幂等）
        if (sg.trebuchet) sg.trebuchet.rotation.z = 0;
        if (sg.counterweight) sg.counterweight.rotation.z = 0;
        if (sg.cart) sg.cart.rotation.x = 0;
        if (sg.soldierL) sg.soldierL.rotation.x = 0;
        if (sg.soldierR) sg.soldierR.rotation.x = 0;
        idleGroup.rotation.x = 0;
        // ★ 不在此释放 _busy —— 炮还要走 ⑤/⑥ 换位（隔山打牛：原位淡出 → 目标位淡入）
      }
    });

    // ⑤ VANISH · 原位淡出（设计稿 §3.6「本体原位淡出」）
    // 炮吃子后必须落到目标格（中国象棋规则），但炮不是走过去的 —— 隔山打牛，
    // 所以用「原位淡出 → 目标位淡入」表达换位，而非平移穿越挡子。
    // ★ 这是上一轮重构丢失的动作（旧 animator.cannonCapture 有，executeCannon 漏了），
    //   导致画面里炮停在原格、与棋局状态脱节。此处复原。
    let fadeBackup: Array<{ mesh: any, orig: any }> | null = null;
    steps.push({
      duration: VANISH_OUT,
      lock: true,
      easing: animator.EASE.easeInQuad,
      onStart: () => {
        fadeBackup = cloneMaterialsForFade(attacker);
        // 消散尘：原位炸开一蓬尘土，掩护「消失」的突兀感
        try { effects.spawnImpactDust(fromVec.clone(), { count: 14 }); } catch (e) { /* effects 桩 */ }
      },
      onUpdate: (t: number) => { setTreeOpacity(attacker, 1 - t); },
      onComplete: () => { attacker.position.copy(toVec); }
    });

    // ⑥ EMERGE · 目标位淡入 + 落定警戒
    steps.push({
      duration: VANISH_IN,
      lock: true,
      easing: animator.EASE.easeOutQuad,
      onStart: () => {
        try { effects.spawnImpactDust(toVec.clone(), { count: 10 }); } catch (e) { /* effects 桩 */ }
      },
      onUpdate: (t: number) => {
        setTreeOpacity(attacker, t);
        // 落定警戒：抛臂随动一次 + 双兵戒备（淡入同步，避免「凭空出现」的僵硬）
        const k = Math.sin(Math.PI * t);
        if (sg.trebuchet) sg.trebuchet.rotation.z = 0.14 * k;
        if (sg.soldierL) sg.soldierL.rotation.x = -0.18 * k;
        if (sg.soldierR) sg.soldierR.rotation.x = -0.18 * k;
      },
      onComplete: () => {
        setTreeOpacity(attacker, 1);
        restoreMaterials(fadeBackup);
        fadeBackup = null;
        if (sg.trebuchet) sg.trebuchet.rotation.z = 0;
        if (sg.soldierL) sg.soldierL.rotation.x = 0;
        if (sg.soldierR) sg.soldierR.rotation.x = 0;
        // 收尾契约：释放 _busy + onComplete 回调（与旧 onLand 时机一致）
        attacker.userData._busy = false;
        if (opts.onComplete) opts.onComplete();
        resolve();
      }
    });

    animator.seq(steps);
  });
}
