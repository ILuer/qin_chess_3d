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
import { TIMING, PT } from '../core/constants.js';

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
// 阶段三分兵种移动风味（lift = 相对基准抛物线高度的倍率）
// ---------------------------------------------------------------------------
const MOVE_FLAVOR_DEFAULT = { liftMul: 1.0 };
const MOVE_FLAVOR = {
  [PT.PAWN]:     { liftMul: 0.92 },   // 兵：持戈冲锋，低伏前压
  [PT.HORSE]:    { liftMul: 1.45 },   // 马：骑兵腾跃
  [PT.ELEPHANT]: { liftMul: 1.35 },   // 象：飞身滑翔
  [PT.ADVISOR]:  { liftMul: 0.96 },   // 士：稳步
  [PT.ROOK]:     { liftMul: 1.05 },   // 车：整体冲锋
  [PT.CANNON]:   { liftMul: 1.0 },    // 炮：平移（吃子走抛石瞬移）
  [PT.KING]:     { liftMul: 1.0 }     // 帅：起身移动（龙椅隐现）
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
        // 兵种专属随动（子组摆臂 / 龙椅隐现等），由 movePiece 注入
        if (opts.onFlourish) opts.onFlourish(t, raw, mesh);
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
   * 每帧待机微动。必须在主循环里对每个棋子调用一次。
   * @param {THREE.Object3D} group 棋子根 Group
   * @param {number} t 当前秒（performance.now()/1000）
   */
  tickIdle(group, t) {
    if (!group || !group.userData) return;
    const ud = group.userData;
    const orient = group.getObjectByName('orient') || group;
    // 移动 / 吃子进行中：仅把「根 orient 节点」的待机微动归零，
    // 让移动补间（作用于棋子根 Group）干净推进。
    // 注意：此处【绝不】触碰子组（subGroups）——炮的士兵推车、
    // 帅的龙椅 scale 隐现、车的战马奔腾等都由动画补间逐帧驱动，
    // 若在此强制重置会与其打架，导致穿模 / 跳变。
    if (ud._busy) {
      orient.position.y = 0;
      orient.rotation.z = 0;
      return;
    }
    const ph = ud.idlePhase || 0;
    // 全员：极轻的呼吸浮动 + 摇摆，让棋子"活着"
    orient.position.y = Math.sin(t * 1.15 + ph) * 0.012;
    orient.rotation.z = Math.sin(t * 0.85 + ph) * 0.014;

    const sg = ud.subGroups;
    if (!sg) return;
    // 炮：两侧士兵推车（前后摆动）+ 抛石机轻微咯吱
    if (sg.soldierL && sg.soldierR) {
      const push = Math.sin(t * 2.1 + ph) * 0.12;
      sg.soldierL.rotation.x = push;
      sg.soldierR.rotation.x = push;
    }
    if (sg.trebuchet) sg.trebuchet.rotation.z = Math.sin(t * 0.7 + ph) * 0.02;
    // 车：战马奔腾微跳 + 御马 / 持戈兵轻微晃动
    if (sg.horses) sg.horses.position.y = Math.abs(Math.sin(t * 3.0 + ph)) * 0.03;
    if (sg.driver) sg.driver.rotation.z = Math.sin(t * 1.1 + ph) * 0.05;
    if (sg.spearman) sg.spearman.rotation.z = Math.sin(t * 1.1 + ph + 1.3) * 0.05;
    // 帅：坐姿人物呼吸
    if (sg.body && ud.pieceType === PT.KING) sg.body.position.y = Math.sin(t * 1.0 + ph) * 0.012;
  }

  /**
   * 分兵种移动：通用抛物线 + 兵种专属风味（子组随动）。
   * @param {THREE.Object3D} piece
   * @param {THREE.Vector3} target 目标世界坐标
   * @param {string} type  PT.* 之一
   * @param {string} side  'r'|'b'
   * @param {Object} opts { duration, waypoints, onLand }
   */
  movePiece(piece, target, type, side, opts = {}) {
    const flavor = MOVE_FLAVOR[type] || MOVE_FLAVOR_DEFAULT;
    const lift = TIMING.liftHeight * (flavor.liftMul != null ? flavor.liftMul : 1);
    return this.arcMove(piece, target, {
      duration: opts.duration,
      lift,
      waypoints: opts.waypoints,
      easing: opts.easing,
      onFlourish: (t, raw, mesh) => this._moveFlourish(mesh, type, t, raw),
      onComplete: () => { if (opts.onLand) opts.onLand(); }
    });
  }

  /** 移动过程中的兵种风味（在 onFlourish 钩子里逐帧调用） */
  _moveFlourish(mesh, type, t, raw) {
    const ud = mesh.userData;
    const orient = mesh.getObjectByName('orient') || mesh;
    const sg = ud.subGroups;
    const k = Math.sin(Math.PI * t);
    switch (type) {
      case PT.PAWN:      // 兵：持戈冲锋前倾
        orient.rotation.x = -0.12 * k;
        break;
      case PT.HORSE:     // 马：跳跃腾空前仰
        orient.rotation.x = -0.30 * k;
        break;
      case PT.ELEPHANT:  // 象：飞身侧倾 + 微前倾
        orient.rotation.z = 0.06 * k;
        orient.rotation.x = -0.10 * k;
        break;
      case PT.ADVISOR:   // 士：稳步，仅极小前倾
        orient.rotation.x = -0.05 * k;
        break;
      case PT.ROOK:      // 车：战马奔腾 + 御马 / 持戈兵前倾
        if (sg) {
          if (sg.horses) sg.horses.position.y = Math.abs(Math.sin(Math.PI * t * 2)) * 0.07;
          if (sg.spearman) sg.spearman.rotation.x = -0.12 * k;
          if (sg.driver) sg.driver.rotation.x = -0.10 * k;
        }
        break;
      case PT.CANNON:    // 炮：两侧士兵推车 + 抛石机随动
        if (sg) {
          if (sg.soldierL && sg.soldierR) {
            const push = Math.sin(Math.PI * t) * 0.30;
            sg.soldierL.rotation.x = push;
            sg.soldierR.rotation.x = push;
          }
          if (sg.trebuchet) sg.trebuchet.rotation.z = 0.06 * k;
        }
        break;
      case PT.KING:      // 帅：龙椅隐现（移动中消失，落定再现）
        if (sg && sg.throne) {
          const s = Math.abs(Math.cos(Math.PI * t));
          sg.throne.scale.setScalar(Math.max(0.001, s));
        }
        break;
      default:
        break;
    }
  }

  /**
   * 吃子时攻击方的「斩杀」姿态（非炮）。短促前刺 + 复位；
   * 拥有可动子组的兵种额外做专属挥击。
   * @returns {Object} 主补间句柄
   */
  captureStrike(piece, type, side, opts = {}) {
    const ud = piece.userData;
    const orient = piece.getObjectByName('orient') || piece;
    const sg = ud.subGroups;
    const dur = TIMING.strikeRecoil != null ? TIMING.strikeRecoil : 0.18;
    // 全员：快速前倾点头（刺击 / 劈砍的体感）
    const nod = type === PT.ADVISOR ? 0.40 : (type === PT.KING ? 0.22 : 0.28);
    const a = this.add({
      duration: dur, easing: Easing.easeOutQuad,
      onUpdate: (t) => { orient.rotation.x = -nod * Math.sin(Math.PI * t); },
      onComplete: () => { orient.rotation.x = 0; }
    });
    // 兵种专属挥击（子组旋转，本地 +Z 为前，物理方向天然正确）
    if (sg) {
      if (sg.spearman) {
        this.add({ duration: dur, easing: Easing.easeOutCubic,
          onUpdate: (t) => { sg.spearman.rotation.x = -0.6 * Math.sin(Math.PI * t); },
          onComplete: () => { sg.spearman.rotation.x = 0; } });
      }
      if (sg.body && type === PT.KING) {
        this.add({ duration: dur, easing: Easing.easeOutCubic,
          onUpdate: (t) => { sg.body.rotation.y = 0.5 * Math.sin(Math.PI * t); },
          onComplete: () => { sg.body.rotation.y = 0; } });
      }
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
  cannonCapture(attacker, victim, fromVec, toVec, side, opts = {}) {
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
      this.add({ duration: throwDur, easing: Easing.easeOutCubic,
        onUpdate: (t) => { sg.trebuchet.rotation.z = -0.9 * Math.sin(Math.PI * Math.min(1, t * 1.4)); },
        onComplete: () => { if (sg.trebuchet) sg.trebuchet.rotation.z = 0; } });
    }
    if (sg && sg.soldierL && sg.soldierR) {
      this.add({ duration: throwDur, easing: Easing.easeOutCubic,
        onUpdate: (t) => { const k = Math.sin(Math.PI * t) * 0.4; sg.soldierL.rotation.x = k; sg.soldierR.rotation.x = k; },
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
      onUpdate: (t) => { arc.getPoint(Math.min(1, t), tmp); proj.position.copy(tmp); proj.rotation.x += 0.32; },
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
        onUpdate: (t) => setTreeOpacity(attacker, 1 - t),
        onComplete: () => {
          attacker.position.copy(toVec);
          this.add({ duration: 0.18, easing: Easing.easeOutQuad,
            onUpdate: (t) => setTreeOpacity(attacker, t),
            onComplete: () => {
              restoreMaterials(fadeOut);
              attacker.userData.__fadeBackup = null;
              // 警戒姿态：抛石机后坐 + 士兵戒备，随复位
              if (sg) {
                this.add({ duration: 0.3, easing: Easing.easeOutCubic,
                  onUpdate: (t) => {
                    const k = Math.sin(Math.PI * t);
                    if (sg.trebuchet) sg.trebuchet.rotation.z = 0.30 * k;
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
