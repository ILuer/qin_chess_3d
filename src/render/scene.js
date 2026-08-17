/**
 * scene.js —— 场景 / 相机 / 渲染器 / 灯光 / 视角控制 / 帧率自适应
 *
 * 契约：棋盘台面顶部 y = 0；红方在 +Z 侧（画面下方）；相机默认位于红方后上方。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PALETTE, RED, BLACK, TIMING } from '../core/constants.js';
import { FIXED_VIEW_FIT, computeFixedViewFitRadius } from './followCamera.js';

// 窄屏 fixed 视图自适应（QIN-UI-FIX-MOBILE-CAM）：
// 方案与常量定义在 followCamera.js（相机 fit 逻辑同源、Node 可测），此处再导出以保持 API。
export { FIXED_VIEW_FIT, computeFixedViewFitRadius };

/** 视角预设（球坐标，相对 controls.target） */
export const VIEW_PRESETS = {
  red: { radius: 13.6, phi: 0.64, theta: 0.0 },
  black: { radius: 13.6, phi: 0.64, theta: Math.PI },
  top: { radius: 12.4, phi: 0.17, theta: 0.0 },
  topBlack: { radius: 12.4, phi: 0.17, theta: Math.PI }
};

const MIN_POLAR = 0.15;
const MAX_POLAR = 1.35;

/**
 * 场景底色 / 雾色：均较 PALETTE.bg（0x0a0b0e，近乎纯黑）提亮一档。
 * 纯黑背景下玄黑棋子的轮廓会直接糊进背景，牺牲一点「玄」换取剪影可辨。
 * 两者取同色系并让雾色略亮于底色，远端才读作空气透视而非一团死黑。
 */
const BG_COLOR = 0x1a2230;
const FOG_COLOR = 0x232b38;

/**
 * 战斗灯光脉冲强度上限（方案 B 防御性 clamp，任何路径都无法把灯打到离谱值）。
 * 基线 fill 0.95 / rim 18 / under 12；L5 boost 1.8 → 峰值 fill 1.71 / rim 32.4 / under 21.6，
 * 上限取「略高于 L5 峰值」的整值，正常演出不触发，仅防未来回归。
 */
const COMBAT_LIGHT_CAP = { fill: 2.0, rim: 30, under: 20 };

/** easeInOutCubic */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 角度插值：走最短弧 */
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---------------------------------------------------------------------------
// H5 · 能力探测与分级帧率状态机
// ---------------------------------------------------------------------------

/** 移动端判定：UA 移动标识，或触屏 + 小屏（<768 短边） */
function detectMobile() {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|webOS/i.test(ua);
    const touch = typeof window !== 'undefined' && (
      'ontouchstart' in window ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints && navigator.maxTouchPoints > 0)
    );
    const small = typeof window !== 'undefined' &&
      Math.min(window.innerWidth || 0, window.innerHeight || 0) < 768;
    return uaMobile || (touch && small);
  } catch (e) { return false; }
}

/** 弱机判定：CPU 核数 < 6（移动端降档口径） */
function detectWeak() {
  try {
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
    return cores > 0 && cores < 6;
  } catch (e) { return false; }
}

/** ?quality=high 手动覆盖：锁定初始档位，不做自动降档 */
function qualityOverride() {
  try {
    const q = new URLSearchParams(window.location.search).get('quality');
    return q === 'high' ? 'high' : null;
  } catch (e) { return null; }
}

/**
 * 质量档位（H5 分级状态机）：
 *   3（初始）→ 2（降 PR 至 1.5）→ 1（关阴影，PR=1）→ 0（关装饰灯 + 强制低模）。
 * null 表示「用 _initial 初始值」；lowMesh 供 L4 LOD 落地后消费（当前仅标记）。
 */
const QUALITY_LEVELS = [
  { pixelRatio: 1,   shadows: false, deco: false, lowMesh: true  },  // 0 最低
  { pixelRatio: 1,   shadows: false, deco: true,  lowMesh: false },  // 1
  { pixelRatio: 1.5, shadows: true,  deco: true,  lowMesh: false },  // 2
  { pixelRatio: null, shadows: null, deco: true,  lowMesh: false }   // 3 初始
];
const FPS_DROP_THRESHOLD = 40;   // 90 帧窗口均值 <40 → 降一档
const FPS_RISE_THRESHOLD = 55;   // ≥55 → 升一档（40~55 迟滞区间防抖）
const QUALITY_COOLDOWN = 4;      // 档位切换后冷却秒数，防来回抖动

// ---------------------------------------------------------------------------
// L5 · 异步渲染器工厂（动态 import 双后端）
// ---------------------------------------------------------------------------

/** WebGPU 是否可用（navigator.gpu + requestAdapter 成功） */
async function webgpuAvailable() {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu ||
        typeof navigator.gpu.requestAdapter !== 'function') return false;
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch (e) { return false; }
}

/**
 * 创建渲染器：WebGPU 可用 → await import('three/webgpu') 用 WebGPURenderer（r185 双后端，
 * 标准材质/阴影/色调映射与本项目使用面完全兼容）；否则 WebGLRenderer（主 bundle 内联）。
 * WebGL 浏览器不下载 webgpu chunk（动态 import 按需加载）。
 */
async function createRenderer() {
  if (await webgpuAvailable()) {
    try {
      const mod = await import('three/webgpu');
      if (mod && mod.WebGPURenderer) {
        const renderer = new mod.WebGPURenderer({ antialias: true, alpha: false, stencil: false });
        if (typeof renderer.init === 'function') await renderer.init();
        return { renderer, backend: 'webgpu' };
      }
    } catch (e) {
      console.warn('[renderer] WebGPU 初始化失败，回退 WebGL：', e && e.message);
    }
  }
  return {
    renderer: new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false
    }),
    backend: 'webgl'
  };
}

export class SceneSystem {
  /**
   * @param {HTMLElement} container
   * @param {{onQualityDrop?:Function, renderer?:Object, backend?:string, isMobile?:boolean, isWeak?:boolean}} [opts]
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.disposed = false;
    this.backend = opts.backend || 'webgl';

    // —— H5 能力探测（支持外部注入，便于测试/真机覆盖）——
    this.isMobile = opts.isMobile != null ? opts.isMobile : detectMobile();
    this.isWeak = opts.isWeak != null ? opts.isWeak : detectWeak();
    this.qualityOverride = qualityOverride();
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    // 初始像素比：弱机 1；移动端上限 1.5；桌面 min(dpr, 2)
    const initialPR = this.isWeak ? 1 : (this.isMobile ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    // 初始阴影：弱机（cores<6）关；移动端 1024²；桌面 2048²
    const initialShadows = !this.isWeak;
    const shadowSize = this.isMobile ? 1024 : 2048;
    this._initial = { pixelRatio: initialPR, shadows: initialShadows, shadowSize };
    this.basePixelRatio = initialPR;   // 保留旧字段名（外部可能读取）

    // —— 渲染器（L5：createSceneSystem 异步工厂注入；直接 new 时回退 WebGL）——
    const renderer = opts.renderer || new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false
    });
    renderer.setPixelRatio(initialPR);
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACESFilmic 会明显压暗中间调并去饱和，棋子字面与甲胄细节正好落在这一段，
    // 换用 Khronos PBR Neutral：中间调保真、高光平滑滚降，
    // 既提得起亮度又不会把鎏金/字面推成一片死白。
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.14;
    renderer.shadowMap.enabled = initialShadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;  // PCFSoftShadowMap deprecated in r185
    renderer.setClearColor(BG_COLOR, 1);
    renderer.domElement.classList.add('game-canvas');
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    // —— 场景 ——
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);
    // 密度 0.021 会让远端（黑方底线）棋子明显发灰变暗，直接伤可读性；
    // 减半到 0.009 只保留纵深暗示，不再吃掉细节。
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.009);
    this.scene = scene;

    // —— 分组（明确的层级，方便拾取与清理）——
    this.envGroup = new THREE.Group(); this.envGroup.name = 'env';
    this.boardGroup = new THREE.Group(); this.boardGroup.name = 'board';
    this.piecesGroup = new THREE.Group(); this.piecesGroup.name = 'pieces';
    this.effectsGroup = new THREE.Group(); this.effectsGroup.name = 'effects';
    scene.add(this.envGroup, this.boardGroup, this.piecesGroup, this.effectsGroup);

    // —— 相机 ——
    const aspect = (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight);
    const camera = new THREE.PerspectiveCamera(46, aspect, 0.1, 200);
    this.camera = camera;

    // —— 轨道控制 ——
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.62;
    controls.zoomSpeed = 0.85;
    controls.minPolarAngle = MIN_POLAR;     // 防止翻到棋盘上方奇怪角度
    controls.maxPolarAngle = MAX_POLAR;     // 防止转到棋盘下面
    controls.minDistance = 6.5;
    controls.maxDistance = FIXED_VIEW_FIT.maxR;   // 30：仅窄屏 fitted 视图需要（桌面默认视野远小于此）
    controls.enablePan = false;             // 禁用平移，避免棋盘跑出视野
    controls.target.set(0, 0.2, 0);
    this.controls = controls;

    // —— 窄屏 fixed 视图自适应开关（main.js 在跟随模式激活时置 false，避免与 fitRadius 打架）——
    this.viewAutoFit = true;

    this._applyFinalPreset(VIEW_PRESETS.red);
    controls.update();

    // —— 灯光 ——
    this._setupLights();

    // —— 视角插值状态 ——
    this._viewTween = null;

    // —— 屏幕震动 ——
    this._shake = { t: 0, dur: 0, intensity: 0 };
    this._shakeOffset = new THREE.Vector3();

    // —— 帧率自适应（H5 分级状态机）——
    this._fpsWindow = [];
    this._qualityLevel = 3;
    this._lastQualityLevel = 3;
    this._qualityCooldown = 0;
    this._qualityLocked = this.qualityOverride === 'high';   // ?quality=high 手动锁定
    this.lowMesh = false;    // L0 置 true；L4 LOD 落地后由渲染层消费
    this.currentView = 'red';
    this.viewSide = RED;
    this.isTopView = false;

    // —— resize ——
    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', this._onResize);
  }

  // -------------------------------------------------------------------------
  // 灯光
  // -------------------------------------------------------------------------

  _setupLights() {
    const scene = this.scene;

    // 主平行光（投影）
    // 强度自 2.35 下调：环境光与新增的相机补光already 抬高了基础亮度，
    // 主光若不退让，鎏金与甲片高光会直接打爆。
    const key = new THREE.DirectionalLight(PALETTE.keyLight, 1.95);
    key.position.set(6.5, 13.5, 7.5);
    key.castShadow = this._initial.shadows;   // H5：弱机初始关阴影
    key.shadow.mapSize.set(this._initial.shadowSize, this._initial.shadowSize);   // 移动 1024² / 桌面 2048²
    const cam = key.shadow.camera;
    cam.left = -9; cam.right = 9; cam.top = 9; cam.bottom = -9;   // 完整包住 8×9 的棋盘
    cam.near = 1; cam.far = 42;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.022;
    key.shadow.radius = 1.6;
    key.target.position.set(0, 0, 0);
    scene.add(key, key.target);
    this.keyLight = key;

    // 半球光：天空冷、地面中性（art-bible-v3-pieceless §7.2：
    // 原暖调地面反射会对红方棋子"红光洗色"，改中性 0x8a7a6a 保剪影）。
    const hemi = new THREE.HemisphereLight(0x8da0b8, 0x8a7a6a, 0.98);
    hemi.position.set(0, 12, 0);
    scene.add(hemi);
    this.hemiLight = hemi;

    // 环境光兜底。原值 0.16 太低，棋子背光面直接掉进死黑、
    // 甲胄与人物轮廓全部糊成一坨；抬到 0.52 保住暗部细节，
    // 同时让雾化地面不再与背景糊成一片死黑。
    const amb = new THREE.AmbientLight(0xffffff, 0.52);
    scene.add(amb);
    this.ambientLight = amb;

    // 冷色补光（黑方一侧）
    const fill = new THREE.DirectionalLight(PALETTE.fillLight, 0.95);
    fill.position.set(-8, 6.5, -8);
    scene.add(fill);
    this.fillLight = fill;

    /**
     * 相机跟随补光 —— 「任意视角下清晰可辨」的关键。
     *
     * 主光方向固定在红方右后上方，一旦用户把镜头转到对侧，
     * 看到的全是背光面，再高的主光强度也救不回来。
     * 这盏灯每帧跟着相机走，保证「你正在看的那一面」永远有光。
     *
     * 两点克制：
     *  - 强度只给 0.62，够提亮但不夺主光的造型感；
     *  - 位置在相机基础上抬高 2.8（去基座后降 0.7，避免与视线完全重合——
     *    正面平打会消掉所有明暗交界，画面会变得像贴纸一样扁）。
     */
    const head = new THREE.DirectionalLight(0xfff4e2, 0.62);
    head.position.set(0, 10, 14);
    scene.add(head, head.target);
    this.headLight = head;
    this._headDir = new THREE.Vector3();

    // 暖色轮廓光，营造秦式青铜氛围（去基座后降高降强，更好包裹矮棋子）
    const rim = new THREE.PointLight(PALETTE.rimLight, 18, 30, 2);
    rim.position.set(0, 2.2, -8.5);
    scene.add(rim);
    this.rimLight = rim;

    // 红方侧微弱地灯（降高，从更平的角度打亮棋子脚部）
    const under = new THREE.PointLight(PALETTE.chiHong, 12, 22, 2);
    under.position.set(0, 1.8, 8.5);
    scene.add(under);
    this.underLight = under;

    // 底部微补光 ×2（art-bible §7.3 可选）：低矮棋子脚部轮廓补光，红暖 / 黑冷
    // H5：移动端不挂这两盏装饰点光（省片元开销），桌面保留
    if (!this.isMobile) {
      const bottomR = new THREE.PointLight(0xffe4d0, 4, 10, 2);
      bottomR.position.set(0, 0.5, 7.0);
      scene.add(bottomR);
      this.bottomLightR = bottomR;
      const bottomB = new THREE.PointLight(0xd0d8e4, 4, 10, 2);
      bottomB.position.set(0, 0.5, -7.0);
      scene.add(bottomB);
      this.bottomLightB = bottomB;
    } else {
      this.bottomLightR = null;
      this.bottomLightB = null;
    }

    this._updateHeadLight();
  }

  /** 把跟随补光挪到相机同侧（每帧调用） */
  _updateHeadLight() {
    const head = this.headLight;
    if (!head) return;
    const t = this.controls.target;
    this._headDir.subVectors(this.camera.position, t);
    if (this._headDir.lengthSq() < 1e-6) return;
    this._headDir.normalize();
    head.position.copy(t).addScaledVector(this._headDir, 15);
    head.position.y += 2.8;   // 去基座后降 0.7，更平角度照亮棋子正面
    head.target.position.copy(t);
    head.target.updateMatrixWorld();
  }

  // -------------------------------------------------------------------------
  // 视角
  // -------------------------------------------------------------------------

  /** 当前球坐标 */
  _currentSpherical() {
    const off = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const s = new THREE.Spherical().setFromVector3(off);
    return { radius: s.radius, phi: s.phi, theta: s.theta };
  }

  /** 立即应用一个球坐标预设（raw：tween 中间帧用，不放大距离） */
  _applyPreset(p) {
    const s = new THREE.Spherical(p.radius, p.phi, p.theta);
    const v = new THREE.Vector3().setFromSpherical(s).add(this.controls.target);
    this.camera.position.copy(v);
    this.camera.lookAt(this.controls.target);
  }

  /**
   * 应用一个「最终」球坐标预设（含窄屏全棋盘入框适配）。
   * @param {{radius:number, phi:number, theta:number}} p
   */
  _applyFinalPreset(p) {
    const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, p.phi, p.theta)).normalize();
    const radius = this._fittedRadius(p.radius, dir);
    this._applyPreset({ ...p, radius });
  }

  /**
   * 计算窄屏 fitted 半径（方向优先显式传入；缺省用当前相机→target 方向）。
   * 桌面宽屏（aspect ≥ 阈值）返回 baseRadius 本身 → 零回归。
   */
  _fittedRadius(baseRadius, dir) {
    if (!dir) {
      dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
      if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
      dir.normalize();
    }
    return computeFixedViewFitRadius({
      fov: this.camera.fov,
      aspect: this.camera.aspect,
      dir,
      target: this.controls.target,
      baseRadius
    });
  }

  /**
   * 当前球坐标中，与某个视角预设最接近时返回其基础半径（未 fitted），否则回退 fallback。
   * 用于 resize 后判断「该恢复到哪个预设距离」（用户自由旋转/缩放的视角则保持其缩放）。
   */
  _baseRadiusForView(phi, theta, fallback) {
    let best = null, bestD = Infinity;
    for (const p of Object.values(VIEW_PRESETS)) {
      const dPhi = Math.abs(phi - p.phi);
      const dTheta = Math.min(Math.abs(theta - p.theta), Math.PI * 2 - Math.abs(theta - p.theta));
      const d = dPhi + dTheta;
      if (d < bestD) { bestD = d; best = p; }
    }
    return (best && bestD < 0.2) ? best.radius : fallback;
  }

  /**
   * 平滑切换到某个球坐标
   * @param {{radius:number, phi:number, theta:number}} to
   * @param {number} [duration] 秒
   */
  tweenToView(to, duration = TIMING.viewTween) {
    const from = this._currentSpherical();
    // 目标半径做窄屏 fitted（方向取目标预设方向）；baseRadius 记住未 fitted 值，
    // 供 resize 中途切换视口时正确回退到桌面预设距离
    const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, to.phi, to.theta)).normalize();
    const radius = this._fittedRadius(to.radius, dir);
    this._viewTween = { from, to: { ...to, radius }, baseRadius: to.radius, t: 0, dur: Math.max(0.001, duration) };
    this.controls.enabled = false;
  }

  /** 复位到当前执棋方的默认视角 */
  resetView(animate = true) {
    this.isTopView = false;
    const p = this.viewSide === BLACK ? VIEW_PRESETS.black : VIEW_PRESETS.red;
    if (animate) this.tweenToView(p); else { this._applyFinalPreset(p); this.controls.update(); }
    this.currentView = this.viewSide === BLACK ? 'black' : 'red';
  }

  /**
   * 翻转到某一方视角（不传参则在红黑之间切换）
   * @param {'r'|'b'} [side]
   */
  flipView(side) {
    this.viewSide = side || (this.viewSide === RED ? BLACK : RED);
    const key = this.isTopView
      ? (this.viewSide === BLACK ? 'topBlack' : 'top')
      : (this.viewSide === BLACK ? 'black' : 'red');
    this.tweenToView(VIEW_PRESETS[key]);
    this.currentView = key;
    return this.viewSide;
  }

  /** 俯视 / 斜视切换 */
  toggleTopView() {
    this.isTopView = !this.isTopView;
    const key = this.isTopView
      ? (this.viewSide === BLACK ? 'topBlack' : 'top')
      : (this.viewSide === BLACK ? 'black' : 'red');
    this.tweenToView(VIEW_PRESETS[key], 0.6);
    this.currentView = key;
    return this.isTopView;
  }

  /** 视角插值是否进行中（用于锁输入） */
  get isViewAnimating() { return !!this._viewTween; }

  // -------------------------------------------------------------------------
  // 屏幕震动
  // -------------------------------------------------------------------------

  /**
   * 相机震动
   * @param {number} intensity 世界单位，吃子 0.06 / 将军 0.12 / 将死 0.22
   * @param {number} duration 秒
   */
  screenShake(intensity = 0.08, duration = 0.28) {
    // 取较强的一次，避免叠加过头
    if (intensity >= this._shake.intensity || this._shake.t >= this._shake.dur) {
      this._shake.intensity = intensity;
      this._shake.dur = duration;
      this._shake.t = 0;
    }
  }

  _updateShake(dt) {
    const s = this._shake;
    if (s.t >= s.dur) { this._shakeOffset.set(0, 0, 0); return; }
    s.t += dt;
    const k = Math.max(0, 1 - s.t / s.dur);
    const amp = s.intensity * k * k;
    this._shakeOffset.set(
      (Math.random() * 2 - 1) * amp,
      (Math.random() * 2 - 1) * amp * 0.7,
      (Math.random() * 2 - 1) * amp
    );
  }

  /**
   * 镜头微推：沿 controls.target 方向短暂推近
   * @param {number} strength  强度 0.6–1.2（M2 微推 / A2 冲击）
   * @param {number} duration  秒
   */
  cameraPush(strength = 0.6, duration = 0.3) {
    const dir = new THREE.Vector3();
    dir.subVectors(this.controls.target, this.camera.position).normalize();
    if (dir.lengthSq() < 1e-6) return;

    this._cameraPush = {
      t: 0,
      dur: duration,
      strength,
      startPos: this.camera.position.clone(),
      pushPos: this.camera.position.clone().add(dir.multiplyScalar(strength))
    };
  }

  _updateCameraPush(dt) {
    const p = this._cameraPush;
    if (!p || p.t >= p.dur) { this._cameraPush = null; return; }
    p.t += dt;
    const k = Math.min(1, p.t / p.dur);
    // easeOutQuad：推过去 → 回稳
    const ease = k < 0.5
      ? 2 * k * k
      : 1 - Math.pow(-2 * k + 2, 2) / 2;
    this.camera.position.lerpVectors(p.pushPos, p.startPos, ease);
  }

  /**
   * 战斗灯光脉冲：短暂增强 rimLight / fillLight
   * @param {string} level  'L2'|'L3'|'L4'|'L5'
   *
   * ⚠ Bug 修复（docs/bug-light-blinding.md，方案 A + B）：
   *   1) 脉冲开始时捕获基线（fillBase/rimBase/underBase），绝不拿「当前已抬高的
   *      intensity」当基线 —— 根治连续吃子的复利放大；
   *   2) 每帧按衰减系数写**绝对值** intensity = base·(1+(boost-1)·decay)，
   *      不叠加、不依赖帧数 —— 帧率无关、hitstop（dt=0）免疫；
   *   3) 结束时显式复位到基线；并加 clamp 上限（方案 B）+ clearCombatLight()
   *      （reset/abort 清理，防未来复发）。
   */
  pulseCombatLight(level = 'L3') {
    const boost = { L2: 1.15, L3: 1.35, L4: 1.55, L5: 1.8 }[level] || 1.35;
    this._combatLight = {
      t: 0, dur: 0.3, boost,
      fillBase: this.fillLight ? this.fillLight.intensity : 0,
      rimBase:  this.rimLight  ? this.rimLight.intensity  : 0,
      underBase:this.underLight? this.underLight.intensity : 0
    };
  }

  _updateCombatLight(dt) {
    const cl = this._combatLight;
    if (!cl) return;
    cl.t += dt;                       // hitstop 时 dt=0 → 不前进；写的是绝对值，不会漂移
    const k = Math.min(1, cl.t / cl.dur);
    const decay = Math.max(0, 1 - k * k);
    const mul = 1 + (cl.boost - 1) * decay;
    if (this.fillLight)  this.fillLight.intensity  = Math.min(cl.fillBase  * mul, COMBAT_LIGHT_CAP.fill);
    if (this.rimLight)   this.rimLight.intensity   = Math.min(cl.rimBase   * mul, COMBAT_LIGHT_CAP.rim);
    if (this.underLight) this.underLight.intensity = Math.min(cl.underBase * mul, COMBAT_LIGHT_CAP.under);
    if (k >= 1) {
      // 显式复位基线（不依赖衰减趋零）
      if (this.fillLight)  this.fillLight.intensity  = cl.fillBase;
      if (this.rimLight)   this.rimLight.intensity   = cl.rimBase;
      if (this.underLight) this.underLight.intensity = cl.underBase;
      this._combatLight = null;
    }
  }

  /**
   * 强制清理灯光脉冲（重开局 / abort 时调用，防「脉冲中途重开 → 灯光停在非基线」）。
   */
  clearCombatLight() {
    const cl = this._combatLight;
    if (!cl) return;
    if (this.fillLight)  this.fillLight.intensity  = cl.fillBase;
    if (this.rimLight)   this.rimLight.intensity   = cl.rimBase;
    if (this.underLight) this.underLight.intensity = cl.underBase;
    this._combatLight = null;
  }

  // -------------------------------------------------------------------------
  // 主循环
  // -------------------------------------------------------------------------

  /** 每帧更新（不含 render） */
  update(dt) {
    // 视角插值
    if (this._viewTween) {
      const tw = this._viewTween;
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      const e = easeInOutCubic(k);
      const radius = tw.from.radius + (tw.to.radius - tw.from.radius) * e;
      const phi = tw.from.phi + (tw.to.phi - tw.from.phi) * e;
      const theta = lerpAngle(tw.from.theta, tw.to.theta, e);
      this._applyPreset({ radius, phi, theta });
      if (k >= 1) {
        this._viewTween = null;
        this.controls.enabled = true;
        this.controls.update();
      }
    } else {
      this.controls.update();
    }

    this._updateHeadLight();   // 补光跟随相机，保证当前视角的受光面始终可读
    this._updateShake(dt);
    this._updateCameraPush(dt);
    this._updateCombatLight(dt);
    this._trackFps(dt);
  }

  /** 渲染一帧（含震动偏移） */
  render() {
    const off = this._shakeOffset;
    const shaking = off.lengthSq() > 1e-9;
    if (shaking) {
      this.camera.position.add(off);
      this.camera.updateMatrixWorld();
    }
    this.renderer.render(this.scene, this.camera);
    if (shaking) this.camera.position.sub(off);
  }

  // -------------------------------------------------------------------------
  // 帧率自适应
  // -------------------------------------------------------------------------

  _trackFps(dt) {
    if (this._qualityLocked || dt <= 0) return;
    // 档位切换冷却期：不采样不判定（防来回抖动）
    if (this._qualityCooldown > 0) { this._qualityCooldown -= dt; return; }
    const w = this._fpsWindow;
    w.push(1 / dt);
    if (w.length < 90) return;
    let sum = 0;
    for (let i = 0; i < w.length; i++) sum += w[i];
    const avg = sum / w.length;
    w.length = 0;
    if (avg < FPS_DROP_THRESHOLD && this._qualityLevel > 0) {
      this._setQualityLevel(this._qualityLevel - 1, avg);
    } else if (avg >= FPS_RISE_THRESHOLD && this._qualityLevel < 3) {
      this._setQualityLevel(this._qualityLevel + 1, avg);
    }
  }

  /**
   * 切换质量档位（H5 分级状态机：3→2 降 PR / 2→1 关阴影 / 1→0 关灯+强制低模）。
   * @param {number} level 0..3
   * @param {number} [avgFps]
   */
  _setQualityLevel(level, avgFps = 0) {
    if (this._qualityLocked) return;
    const clamped = Math.max(0, Math.min(3, level));
    if (clamped === this._qualityLevel) return;
    const dropping = clamped < this._qualityLevel;
    this._qualityLevel = clamped;
    this._qualityCooldown = QUALITY_COOLDOWN;
    this._applyQualityLevel();
    if (dropping && typeof this.opts.onQualityDrop === 'function') {
      this.opts.onQualityDrop(Math.round(avgFps), clamped);
    }
  }

  /** 应用当前档位（像素比 / 阴影 / 装饰灯；lowMesh 供 L4 LOD 消费） */
  _applyQualityLevel() {
    const L = QUALITY_LEVELS[this._qualityLevel];
    let pr = L.pixelRatio == null ? this._initial.pixelRatio : L.pixelRatio;
    pr = Math.min(pr, this._initial.pixelRatio);   // 不高于初始档（弱机初始 1 不会更低）
    this.renderer.setPixelRatio(pr);
    let shadows = L.shadows == null ? this._initial.shadows : L.shadows;
    shadows = shadows && this._initial.shadows;    // 初始关阴影的弱机不会再开
    this.setShadowsEnabled(shadows);
    this._setDecorativeLights(L.deco !== false);
    this.lowMesh = !!L.lowMesh;
    this.resize();
  }

  /** 装饰点灯开关（rim/under/bottomR/bottomB；L0 关灯） */
  _setDecorativeLights(on) {
    for (const k of ['rimLight', 'underLight', 'bottomLightR', 'bottomLightB']) {
      const l = this[k];
      if (l) l.visible = !!on;
    }
  }

  setShadowsEnabled(on) {
    this.renderer.shadowMap.enabled = !!on;
    this.keyLight.castShadow = !!on;
    this.scene.traverse(o => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
  }

  get qualityDegraded() { return this._qualityLevel < 3; }
  get qualityLevel() { return this._qualityLevel; }

  // -------------------------------------------------------------------------
  // 尺寸与销毁
  // -------------------------------------------------------------------------

  resize() {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    // 窄屏 fixed 视图：视口变化后重新保证全棋盘入框（方向不变、按需拉近/拉远）。
    // 跟随模式（main.js 置 viewAutoFit=false）由 FollowCamera 接管，不在此干预。
    if (!this.viewAutoFit) return;
    if (this._viewTween) {
      // 补间进行中：只更新目标半径（方向沿用目标预设方向），当前帧照常插值
      const to = this._viewTween.to;
      const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, to.phi, to.theta)).normalize();
      to.radius = this._fittedRadius(this._viewTween.baseRadius, dir);
    } else {
      const cur = this._currentSpherical();
      const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
      if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
      dir.normalize();
      // 基础距离：当前方向若匹配某个预设则用其预设距离（桌面恢复默认视野），
      // 否则保留用户当前缩放（仅做「放不下就拉远」的兜底）。
      const base = this._baseRadiusForView(cur.phi, cur.theta, cur.radius);
      const fitted = this._fittedRadius(base, dir);
      if (Math.abs(fitted - cur.radius) > 0.01) {
        this.camera.position.copy(this.controls.target).addScaledVector(dir, fitted);
        this.camera.lookAt(this.controls.target);
        this.controls.update();
      }
    }
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('resize', this._onResize);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', this._onResize);
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}

/**
 * 工厂函数（L5：异步渲染器工厂 —— WebGPU 可用则 WebGPURenderer，否则 WebGLRenderer）。
 * @param {HTMLElement} container
 * @param {Object} [opts]
 * @returns {Promise<SceneSystem>}
 */
export async function createSceneSystem(container, opts) {
  const { renderer, backend } = await createRenderer();
  return new SceneSystem(container, Object.assign({}, opts, { renderer, backend }));
}

export default SceneSystem;
