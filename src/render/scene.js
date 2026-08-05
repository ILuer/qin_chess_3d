/**
 * scene.js —— 场景 / 相机 / 渲染器 / 灯光 / 视角控制 / 帧率自适应
 *
 * 契约：棋盘台面顶部 y = 0；红方在 +Z 侧（画面下方）；相机默认位于红方后上方。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PALETTE, RED, BLACK, TIMING } from '../core/constants.js';

/** 视角预设（球坐标，相对 controls.target） */
export const VIEW_PRESETS = {
  red: { radius: 13.6, phi: 0.64, theta: 0.0 },
  black: { radius: 13.6, phi: 0.64, theta: Math.PI },
  top: { radius: 12.4, phi: 0.17, theta: 0.0 },
  topBlack: { radius: 12.4, phi: 0.17, theta: Math.PI }
};

const MIN_POLAR = 0.15;
const MAX_POLAR = 1.35;

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

export class SceneSystem {
  /**
   * @param {HTMLElement} container
   * @param {{onQualityDrop?:Function}} [opts]
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.disposed = false;

    // —— 渲染器 ——
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false
    });
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(this.basePixelRatio);
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(PALETTE.bg, 1);
    renderer.domElement.classList.add('game-canvas');
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    // —— 场景 ——
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(PALETTE.bg);
    scene.fog = new THREE.FogExp2(PALETTE.fog, 0.021);
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
    controls.maxDistance = 26;
    controls.enablePan = false;             // 禁用平移，避免棋盘跑出视野
    controls.target.set(0, 0.2, 0);
    this.controls = controls;

    this._applyPreset(VIEW_PRESETS.red);
    controls.update();

    // —— 灯光 ——
    this._setupLights();

    // —— 视角插值状态 ——
    this._viewTween = null;

    // —— 屏幕震动 ——
    this._shake = { t: 0, dur: 0, intensity: 0 };
    this._shakeOffset = new THREE.Vector3();

    // —— 帧率自适应 ——
    this._fpsWindow = [];
    this._degraded = false;
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
    const key = new THREE.DirectionalLight(PALETTE.keyLight, 2.35);
    key.position.set(6.5, 13.5, 7.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera;
    cam.left = -9; cam.right = 9; cam.top = 9; cam.bottom = -9;   // 完整包住 8×9 的棋盘
    cam.near = 1; cam.far = 42;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.022;
    key.shadow.radius = 1.6;
    key.target.position.set(0, 0, 0);
    scene.add(key, key.target);
    this.keyLight = key;

    // 半球光：天空冷、地面暖
    const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.62);
    hemi.position.set(0, 12, 0);
    scene.add(hemi);
    this.hemiLight = hemi;

    // 环境光兜底，避免暗部死黑
    const amb = new THREE.AmbientLight(0xffffff, 0.16);
    scene.add(amb);
    this.ambientLight = amb;

    // 冷色补光（黑方一侧）
    const fill = new THREE.DirectionalLight(PALETTE.fillLight, 0.75);
    fill.position.set(-8, 6.5, -8);
    scene.add(fill);
    this.fillLight = fill;

    // 暖色轮廓光，营造秦式青铜氛围
    const rim = new THREE.PointLight(PALETTE.rimLight, 26, 30, 2);
    rim.position.set(0, 3.2, -8.5);
    scene.add(rim);
    this.rimLight = rim;

    // 红方侧微弱地灯
    const under = new THREE.PointLight(PALETTE.chiHong, 14, 22, 2);
    under.position.set(0, 2.4, 8.5);
    scene.add(under);
    this.underLight = under;
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

  /** 立即应用一个球坐标预设 */
  _applyPreset(p) {
    const s = new THREE.Spherical(p.radius, p.phi, p.theta);
    const v = new THREE.Vector3().setFromSpherical(s).add(this.controls.target);
    this.camera.position.copy(v);
    this.camera.lookAt(this.controls.target);
  }

  /**
   * 平滑切换到某个球坐标
   * @param {{radius:number, phi:number, theta:number}} to
   * @param {number} [duration] 秒
   */
  tweenToView(to, duration = TIMING.viewTween) {
    const from = this._currentSpherical();
    this._viewTween = { from, to: { ...to }, t: 0, dur: Math.max(0.001, duration) };
    this.controls.enabled = false;
  }

  /** 复位到当前执棋方的默认视角 */
  resetView(animate = true) {
    this.isTopView = false;
    const p = this.viewSide === BLACK ? VIEW_PRESETS.black : VIEW_PRESETS.red;
    if (animate) this.tweenToView(p); else { this._applyPreset(p); this.controls.update(); }
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

    this._updateShake(dt);
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
    if (this._degraded || dt <= 0) return;
    const w = this._fpsWindow;
    w.push(1 / dt);
    if (w.length < 90) return;
    let sum = 0;
    for (let i = 0; i < w.length; i++) sum += w[i];
    const avg = sum / w.length;
    w.length = 0;
    if (avg < 40) this.degradeQuality(avg);
  }

  /** 降档：像素比降到 1 并关闭阴影 */
  degradeQuality(avgFps = 0) {
    if (this._degraded) return;
    this._degraded = true;
    this.renderer.setPixelRatio(1);
    this.setShadowsEnabled(false);
    this.resize();
    if (typeof this.opts.onQualityDrop === 'function') {
      this.opts.onQualityDrop(Math.round(avgFps));
    }
  }

  setShadowsEnabled(on) {
    this.renderer.shadowMap.enabled = !!on;
    this.keyLight.castShadow = !!on;
    this.scene.traverse(o => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
  }

  get qualityDegraded() { return this._degraded; }

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
 * 工厂函数
 * @param {HTMLElement} container
 * @param {Object} [opts]
 * @returns {SceneSystem}
 */
export function createSceneSystem(container, opts) {
  return new SceneSystem(container, opts);
}

export default SceneSystem;
