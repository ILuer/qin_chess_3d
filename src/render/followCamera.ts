/**
 * followCamera.js —— 棋子检查视角跟随相机（Phase 1.5：过目棋子模型）
 *
 * 目标：玩家选中某棋子 → 相机自动平滑移动到该棋子附近、将其置于视野中心，
 * 便于从各角度检查棋子模型细节（服务"过目棋子模型"环节）。
 *
 * 实现思路：跟随只是把 OrbitControls 的 orbit target 平滑移到棋子位置
 * （THREE.MathUtils.damp 逐轴阻尼，帧率无关），相机保持在用户设定的球面偏移
 * —— 旋转 / 缩放 / 俯仰交互全部保留，无需改动 OrbitControls 自身。
 *
 * 设计约束：
 *  - 独立模块、纯逻辑可测：不依赖 DOM / 真实 OrbitControls 实例。
 *    update(dt, camera, controls) 只读写 camera.position / controls.target /
 *    controls.minDistance / controls.maxDistance / controls.enabled，
 *    可注入假对象在 Node 中测试（见 _qa/camera/follow-camera-probe.mjs）。
 *  - 状态机：fixed（默认，现状）↔ follow；fixed 稳态 update() 直接返回，
 *    零开销、绝不干扰现有视角行为。
 *  - 距离 clamp：跟随区间 min/max 由本模块切到 controls（0.8 / 26，
 *    UI-FIX-123 放宽；setTarget 可携带 fitRadius 自适应落点范围）；
 *    进入 / 退出时用「过渡区间」避免半径瞬跳（13.6→fit 或 fit→6.5）。
 *  - 用户滚轮缩放接管：自动半径收敛中一旦检测到用户干预，立即停手并采纳用户半径。
 *  - 视角补间（R 复位 / 翻转 / 俯视，scene.js tweenToView）进行中不干预，
 *    补间结束自动回到 fixed 稳态。
 *  - 多棋子连续切换：setTarget 即时更新，target 阻尼自然平滑，无需特殊处理。
 */

import * as THREE from 'three';
import { toWorld } from '../core/constants.ts';

export const FOLLOW_CONFIG = {
  /** 默认跟随半径（棋子特写距离；仅在未提供 fitRadius 时的兜底值） */
  followDistance: 1.45,
  /** orbit target 跟随阻尼 /s（越大越快；帧率无关 damp） */
  targetDamping: 10.0,
  /** 半径自动收敛阻尼 /s（进入 / 切换 / 退出过渡时；λ=4 → 首帧步进 ≈1 单位，平滑不瞬跳） */
  radiusDamping: 4.0,
  /**
   * 跟随模式最近距离（防相机穿入棋子内部；较原 0.6 略抬，仍可近观模型）
   */
  minDistance: 0.8,
  /**
   * 跟随模式最远距离。UI-FIX-123：不再限死在 4.0 特写，放宽到 26（与棋盘区间一致）——
   *   1) 落点自适应距离在桌面端需 ≈12.7（中心车横跨全盘），移动端竖屏（390×844）
   *      需 ≈26（车满纵线时最坏 NDC≈0.98）才能把整条移动范围收进视口；
   *   2) 与棋盘 maxDistance 一致，进入/退出过渡区间无需额外跳变。
   *  用户仍可手动缩到 0.8 近观模型。
   */
  maxDistance: 26,
  /** 目标 Y 偏移默认值（纯坐标目标用；有 userData.topY 的棋子按半高居中） */
  heightOffset: 0.5,
  /** 判定"用户接管缩放"的半径偏差（世界单位） */
  radiusEpsilon: 0.03,
  /** 退出跟随后的 target 落点（棋盘中心，与 scene.js 初始 controls.target 一致） */
  homeTarget: { x: 0, y: 0.2, z: 0 },
  /** 落点自适应距离的 NDC 安全余量（0..1：留出不被裁切的边距） */
  fitMargin: 0.05
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class FollowCamera {
  config: Record<string, any>;
  enabled: boolean;
  _followObj: any;
  _fixedTarget: { x: number, y: number, z: number } | null;
  _following: boolean;
  _radiusAuto: boolean;
  _radiusTarget: number;
  _lastRadius: number;
  _radiusSeeded: boolean;
  _enterPending: boolean;
  _exitPending: boolean;
  _fitRadius: number | null;
  _boardMin: number;
  _boardMax: number;
  _boardCaptured: boolean;
  _duringTween: boolean;

  /**
   * @param {Partial<typeof FOLLOW_CONFIG>} [cfg]
   */
  constructor(cfg: Record<string, any> = {}) {
    this.config = Object.assign({}, FOLLOW_CONFIG, cfg);
    /** 跟随功能总开关（默认开：选中棋子即跟随；T 键切换调试对比） */
    this.enabled = true;

    /** @type {THREE.Object3D|null} 实时采样目标（棋子 mesh） */
    this._followObj = null;
    /** @type {{x:number,y:number,z:number}|null} 兜底固定目标 */
    this._fixedTarget = null;

    this._following = false;      // 当前有目标且处于跟随
    this._radiusAuto = false;     // 正在自动收敛半径
    this._radiusTarget = 0;
    this._lastRadius = 0;
    this._radiusSeeded = false;
    this._enterPending = false;   // 进入过渡（半径 → 落点适配距离）
    this._exitPending = false;    // 退出过渡（半径 → 棋盘下限）

    /** 本次目标的落点适配半径（UI-FIX-123：由 computeFollowFitRadius 计算；null 时用 followDistance） */
    this._fitRadius = null;

    this._boardMin = 6.5;         // 从 controls 捕获的棋盘距离区间（默认值兜底）
    this._boardMax = 26;
    this._boardCaptured = false;

    this._duringTween = false;    // 视角补间进行中（scene.js tweenToView）
  }

  /** 当前模式：'follow' | 'fixed'（供 HUD / 调试） */
  get mode(): string { return (this.enabled && this._following) ? 'follow' : 'fixed'; }

  /** 是否正处于跟随目标中 */
  get isFollowing(): boolean { return this._following; }
  /** 是否正在自动收敛半径 */
  get isRadiusAuto(): boolean { return this._radiusAuto; }
  get radiusTarget(): number { return this._radiusTarget; }
  get exitPending(): boolean { return this._exitPending; }

  /**
   * 设置跟随目标：推荐传 THREE.Object3D（实时采样世界坐标），
   * 也接受 {x,y,z} 平面坐标（y 缺省 0）。
   * @param {object} objOrVec
   * @param {{fitRadius?:number}} [opts] fitRadius：落点自适应距离
   *   （UI-FIX-123：保证「选中棋子的全部落点标记」投影进视口；缺省用 followDistance）
   * @returns {boolean} 是否接受该目标
   */
  setTarget(objOrVec: any, opts: { fitRadius?: number } = {}): boolean {
    if (objOrVec && (typeof objOrVec.getWorldPosition === 'function' || objOrVec.position)) {
      this._followObj = objOrVec;
      this._fixedTarget = null;
    } else if (objOrVec && typeof objOrVec.x === 'number') {
      this._fixedTarget = {
        x: objOrVec.x,
        y: objOrVec.y != null ? objOrVec.y : 0,
        z: objOrVec.z != null ? objOrVec.z : 0
      };
      this._followObj = null;
    } else {
      return false;
    }
    this._fitRadius = (opts && opts.fitRadius != null) ? opts.fitRadius : null;
    if (this.enabled) this._beginFollow();
    return true;
  }

  /**
   * 清除跟随目标：平滑回到棋盘中心视图（fixed）。
   * 选中空棋盘 / Esc / 右键取消选中时由 main.js 调用。
   */
  clearTarget(): void {
    const had = this._followObj || this._fixedTarget;
    this._followObj = null;
    this._fixedTarget = null;
    if (had || this._radiusAuto) this._beginExit();
  }

  /**
   * 切换跟随功能开关（T 键），返回新状态。
   * 关闭时保留目标引用：再次开启且目标仍在时恢复跟随。
   */
  toggleEnabled(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) {
      if (this._followObj || this._fixedTarget) this._beginFollow();
    } else {
      this._beginExit();
    }
    return this.enabled;
  }

  // -------------------------------------------------------------------------
  // 内部状态
  // -------------------------------------------------------------------------

  _beginFollow(): void {
    this._following = true;
    this._exitPending = false;
    this._enterPending = true;
    this._radiusAuto = true;
    this._radiusTarget = this._fitRadius != null ? this._fitRadius : this.config.followDistance;
    this._radiusSeeded = false;
  }

  _beginExit(): void {
    this._following = false;
    this._enterPending = false;
    this._exitPending = true;
    this._radiusAuto = true;
    this._radiusTarget = this._boardMin;
    this._radiusSeeded = false;
  }

  /** 期望跟随点（世界坐标，含 Y 偏移：有 topY 的棋子按半高居中，否则用配置偏移） */
  _resolveTarget(out: any): any {
    if (this._followObj) {
      if (typeof this._followObj.getWorldPosition === 'function') {
        this._followObj.getWorldPosition(out);
      } else {
        out.copy(this._followObj.position);
      }
    } else if (this._fixedTarget) {
      out.set(this._fixedTarget.x, this._fixedTarget.y, this._fixedTarget.z);
    } else {
      out.set(0, 0, 0);
    }
    const topY = (this._followObj && this._followObj.userData) ? this._followObj.userData.topY : null;
    out.y += (topY != null ? topY * 0.5 : this.config.heightOffset);
    return out;
  }

  _setLimits(controls: any, min: number, max: number): void {
    if (controls.minDistance !== min) controls.minDistance = min;
    if (controls.maxDistance !== max) controls.maxDistance = max;
  }

  // -------------------------------------------------------------------------
  // 主循环
  // -------------------------------------------------------------------------

  /**
   * 每帧调用（主循环里 scene.update 之后、render 之前）。
   * @param {number} dt 秒（effectiveDt；hitstop 时 0 → 相机冻结）
   * @param {THREE.PerspectiveCamera} camera
   * @param {OrbitControls} controls
   */
  update(dt: number, camera: any, controls: any): void {
    if (dt <= 0) return;                                  // hitstop / 0 帧长：冻结
    if (!controls || !camera) return;

    // —— 视角补间进行中（R 复位 / 翻转 / 俯视）：不干预，恢复棋盘距离区间 ——
    if (controls.enabled === false) {
      if (this._boardCaptured) this._setLimits(controls, this._boardMin, this._boardMax);
      this._duringTween = true;
      this._following = false;
      return;
    }
    if (this._duringTween) {
      // 补间结束：回到 fixed 稳态（清除一切过渡状态，不再跟随）
      this._duringTween = false;
      this._following = false;
      this._radiusAuto = false;
      this._enterPending = false;
      this._exitPending = false;
      this._followObj = null;
      this._fixedTarget = null;
      return;
    }

    // —— 首次捕获棋盘距离区间 ——
    if (!this._boardCaptured && typeof controls.minDistance === 'number') {
      this._boardMin = controls.minDistance;
      this._boardMax = controls.maxDistance;
      this._boardCaptured = true;
    }

    // —— fixed 稳态：零开销 ——
    if (!this._following && !this._radiusAuto && !this._enterPending && !this._exitPending) return;

    const cfg = this.config;

    // 1) 捕获当前球面偏移（用户旋转 / 缩放的结果）——必须在改 target 之前
    const off = _v.subVectors(camera.position, controls.target);
    const r = off.length();

    // 2) 用户缩放接管检测：自动收敛期间，实际半径偏离上次命令值 → 用户滚轮介入
    if (this._radiusAuto && this._radiusSeeded && Math.abs(r - this._lastRadius) > cfg.radiusEpsilon) {
      this._radiusAuto = false;
      this._radiusTarget = r;
    }

    // 3) 期望 target：跟随 → 棋子位置；退出 → 棋盘中心
    let tx, ty, tz;
    if (this._following && (this._followObj || this._fixedTarget)) {
      const d = this._resolveTarget(_v2);
      tx = d.x; ty = d.y; tz = d.z;
    } else {
      tx = cfg.homeTarget.x; ty = cfg.homeTarget.y; tz = cfg.homeTarget.z;
    }

    // 4) target 阻尼（帧率无关 damp，逐轴）
    controls.target.x = THREE.MathUtils.damp(controls.target.x, tx, cfg.targetDamping, dt);
    controls.target.y = THREE.MathUtils.damp(controls.target.y, ty, cfg.targetDamping, dt);
    controls.target.z = THREE.MathUtils.damp(controls.target.z, tz, cfg.targetDamping, dt);

    // 5) 相机位置 = 新 target + 原方向 × 半径（自动收敛时半径阻尼）
    let radius = r;
    if (this._radiusAuto) radius = THREE.MathUtils.damp(r, this._radiusTarget, cfg.radiusDamping, dt);
    if (r > 1e-6) {
      off.normalize().multiplyScalar(radius);
      camera.position.copy(controls.target).add(off);
    } else {
      // 相机与目标重合的兜底（避免 NaN 方向）
      camera.position.copy(controls.target);
      camera.position.y += radius;
    }
    this._lastRadius = radius;
    this._radiusSeeded = true;

    // 6) 距离区间维护（过渡区间避免 13.6→4.0 / 2.0→6.5 瞬跳）
    this._maintainLimits(controls, r, radius);

    // 7) 让 OrbitControls 应用 lookAt 与残留阻尼（本帧即生效，不滞后一帧）
    if (typeof controls.update === 'function') controls.update();
  }

  _maintainLimits(controls: any, actualRadius: number, radius: number): void {
    const cfg = this.config;
    if (!this._boardCaptured) return;
    if (this._following) {
      if (this._enterPending) {
        // 进入过渡：半径由大 → followDistance；max 先放宽，避免 13.6→4.0 瞬跳
        if (actualRadius <= cfg.maxDistance + cfg.radiusEpsilon &&
            radius <= cfg.maxDistance + cfg.radiusEpsilon) {
          this._enterPending = false;
          this._setLimits(controls, cfg.minDistance, cfg.maxDistance);
        } else {
          this._setLimits(controls, cfg.minDistance, this._boardMax);
        }
      } else {
        this._setLimits(controls, cfg.minDistance, cfg.maxDistance);
      }
    } else if (this._exitPending) {
      // 退出过渡：半径 → 棋盘下限；min 先放宽，避免 2.0→6.5 瞬跳
      if (actualRadius >= this._boardMin - cfg.radiusEpsilon) {
        this._exitPending = false;
        this._radiusAuto = false;
        this._setLimits(controls, this._boardMin, this._boardMax);
      } else {
        this._setLimits(controls, cfg.minDistance, this._boardMax);
      }
    } else {
      this._setLimits(controls, this._boardMin, this._boardMax);
    }
  }
}

export function createFollowCamera(cfg?: Record<string, any>): FollowCamera { return new FollowCamera(cfg); }

// ---------------------------------------------------------------------------
// 落点自适应距离（UI-FIX-123）
// 目标：跟随模式下，选中棋子的「全部落点标记」投影后必须落在视口内。
// 实现：已知相机 fov/aspect/朝向 与落点世界坐标，二分最小半径使全部点 NDC 投影
//      在 [-1,1]（留 margin 边距）。纯函数，Node 探针可直接验证。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 窄屏 fixed 视图自适应（QIN-UI-FIX-MOBILE-CAM）
// 根因：透视相机水平视野 = 2·atan(tan(fov/2)·aspect)，aspect 越小水平视野越窄，
//       固定 46° 下 390×844（aspect≈0.46）会把棋盘左右缘裁出视口。
// 方案：aspect 低于阈值时，按「全棋盘（含朱漆外框/鎏金角）投影进视口」反算相机距离
//       （与跟随模式同源：复用 computeFitRadius 二分，真实 NDC 投影）。
//       aspect ≥ 阈值（桌面宽屏）直接返回预设距离 —— 1280×720 及以上零回归。
// ---------------------------------------------------------------------------
export const FIXED_VIEW_FIT = {
  /** aspect 低于该值才启用窄屏适配；≥ 该值保持预设距离不变 */
  aspectThreshold: 0.8,
  /** 棋盘（含外框）可视半宽 / 半深：台面 TOP_W=9.70 → 4.85，TOP_D=10.70 → 5.35 */
  halfW: 4.85,
  halfD: 5.35,
  /** NDC 安全余量（0..0.5，两侧各留 4%，保证「含边沿余量」） */
  margin: 0.04,
  /** 窄屏 fitted 最大距离（与 fixed 视图 controls.maxDistance 一致；桌面永远到不了） */
  maxR: 30
};

/**
 * 纯函数：计算 fixed 视图让【全棋盘（含外框）】投影进视口所需的最小相机半径。
 * aspect ≥ 阈值直接返回 baseRadius（桌面不回归）；窄屏按视线方向二分。
 * @param {{fov:number, aspect:number, dir:THREE.Vector3, target:THREE.Vector3, baseRadius:number}} cfg
 * @returns {number} 实际应用半径（≥ baseRadius）
 */
export function computeFixedViewFitRadius({ fov, aspect, dir, target, baseRadius }: { fov: number, aspect: number, dir: any, target: any, baseRadius: number }): number {
  if (aspect >= FIXED_VIEW_FIT.aspectThreshold) return baseRadius;
  const d = (dir && dir.isVector3) ? dir.clone().normalize() : new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
  if (d.lengthSq() < 1e-9) d.set(0, 1, 0);
  const hw = FIXED_VIEW_FIT.halfW, hd = FIXED_VIEW_FIT.halfD;
  return Math.max(baseRadius, computeFitRadius({
    fov, aspect, dir: d, target,
    points: [
      { x: -hw, y: 0, z: -hd },
      { x:  hw, y: 0, z: -hd },
      { x: -hw, y: 0, z:  hd },
      { x:  hw, y: 0, z:  hd },
      { x: 0, y: 0, z: 0 }
    ],
    minR: baseRadius,
    maxR: FIXED_VIEW_FIT.maxR,
    margin: FIXED_VIEW_FIT.margin
  }));
}

/**
 * 二分求「能把全部 points 投影进视口」的最小相机半径。
 * @param {{fov:number, aspect:number, dir:THREE.Vector3, target:THREE.Vector3,
 *          points:Array<{x:number,y?:number,z:number}>, minR?:number, maxR?:number, margin?:number}} cfg
 * @returns {number} 适配半径（已 clamp 到 [minR, maxR]）
 */
export function computeFitRadius({ fov, aspect, dir, target, points, minR = 0.8, maxR = 26, margin = 0.05 }: { fov: number, aspect: number, dir: any, target: any, points: Array<{ x: number, y?: number, z: number }>, minR?: number, maxR?: number, margin?: number }): number {
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 200);
  const tv = (target && target.isVector3) ? target : new THREE.Vector3(target.x, target.y || 0, target.z || 0);
  const d = (dir && dir.isVector3) ? dir.clone().normalize() : new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
  const v = new THREE.Vector3();
  const lim = 1 - Math.max(0, Math.min(0.5, margin));
  const fits = (r: number) => {
    cam.position.copy(tv).addScaledVector(d, r);
    cam.lookAt(tv);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    for (const p of points) {
      v.set(p.x, p.y || 0, p.z);
      const ndc = v.project(cam);
      if (ndc.x < -lim || ndc.x > lim || ndc.y < -lim || ndc.y > lim) return false;
      if (ndc.z > 1 || ndc.z < -1) return false;
    }
    return true;
  };
  if (fits(minR)) return minR;
  if (!fits(maxR)) return maxR;   // 上限仍放不下则退回上限（不追求极致，防相机无限拉远）
  let lo = minR, hi = maxR;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/**
 * 由当前相机 + 选中棋子的合法落点，计算跟随适配半径。
 * 与 FollowCamera._resolveTarget 使用同一套 Y 偏移规则（topY*0.5 / heightOffset），
 * 保证「相机看向的点」与「计算时用的 target」一致。
 * @param {{camera:THREE.PerspectiveCamera, controls:{target:THREE.Vector3},
 *          moves:Array<{file:number,rank:number}>, piece:{position:{x:number,y:number,z:number}, userData?:{topY?:number}},
 *          margin?:number}} cfg
 * @returns {number} 适配半径
 */
export function computeFollowFitRadius({ camera, controls, moves, piece, margin }: { camera: any, controls: any, moves: Array<{ file: number, rank: number }>, piece: any, margin?: number }): number {
  const m = margin != null ? margin : FOLLOW_CONFIG.fitMargin;
  const fov = (camera && camera.fov) || 46;
  const aspect = (camera && camera.aspect) || 1.78;

  // 方向：当前相机相对 controls.target 的偏移（与 follow 收敛方向一致）
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
  dir.normalize();

  const topY = (piece && piece.userData && piece.userData.topY != null) ? piece.userData.topY : null;
  const ty = (topY != null ? topY * 0.5 : FOLLOW_CONFIG.heightOffset);
  const target = new THREE.Vector3(piece.position.x, ty, piece.position.z);

  // 落点 bbox + 标记视觉半径 0.5 扩展（绿色光圈 / 红色危险环最外沿 ~0.45）
  const points = [];
  if (moves && moves.length) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const mv of moves) {
      const w = toWorld(mv.file, mv.rank);
      if (w.x < minX) minX = w.x;
      if (w.x > maxX) maxX = w.x;
      if (w.z < minZ) minZ = w.z;
      if (w.z > maxZ) maxZ = w.z;
    }
    const pad = 0.5;
    points.push(
      { x: minX - pad, y: 0.02, z: minZ - pad },
      { x: maxX + pad, y: 0.02, z: minZ - pad },
      { x: minX - pad, y: 0.02, z: maxZ + pad },
      { x: maxX + pad, y: 0.02, z: maxZ + pad },
      { x: (minX + maxX) / 2, y: 0.02, z: (minZ + maxZ) / 2 }
    );
  }
  // 棋子本身也纳入（保证居中 + 不被裁）
  points.push({ x: piece.position.x, y: ty, z: piece.position.z });

  return computeFitRadius({
    fov, aspect, dir, target, points,
    minR: FOLLOW_CONFIG.minDistance, maxR: FOLLOW_CONFIG.maxDistance, margin: m
  });
}

export default FollowCamera;
