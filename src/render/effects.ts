/**
 * effects.js —— Juice / Windex 效果层（全部程序化，零外部贴图）
 *
 *  - highlightSelected  选中光环（旋转 Torus + 底座脉冲）
 *  - showMoveHints      合法落点：空点=呼吸光盘，可吃点=红色危险环 + 十字准星
 *  - showBlockedHints   蹩马腿 / 塞象眼 / 不可过河 -> 灰色叉号
 *  - showLastMoveMarker 上一步起点 / 终点标记
 *  - setCheckedKing     被将军的将帅持续红色脉冲
 *  - spawnImpactParticles 落子 / 吃子粒子迸发
 *  - screenShake        相机震动（委托 SceneSystem）
 *  - checkPulse         全屏红色脉冲（CSS overlay，最可靠）
 */

import * as THREE from 'three';
import { PALETTE, toWorld } from '../core/constants.ts';

const HINT_Y = 0.016;          // 提示贴地高度，避免与棋盘 z-fighting
const MARKER_Y = 0.010;

/** 共享几何体（模块级缓存，dispose 时统一释放） */
const GEO: Record<string, any> = {};
function geo(key: string, factory: () => any): any {
  if (!GEO[key]) GEO[key] = factory();
  return GEO[key];
}

/** 平铺到 XZ 平面 */
function flat(mesh: any, y: number = HINT_Y): any {
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.renderOrder = 3;
  return mesh;
}

// ---------------------------------------------------------------------------
// 粒子迸发
// ---------------------------------------------------------------------------

class ParticleBurst {
  count: number;
  life: number;
  t: number;
  gravity: number;
  vel: Float32Array;
  geometry: any;
  material: any;
  points: any;
  /**
   * @param {THREE.Vector3} origin
   * @param {number} color
   * @param {Object} opts
   */
  constructor(origin: any, color: number, opts: Record<string, any> = {}) {
    const count = opts.count || 44;
    this.count = count;
    this.life = opts.life || 1.0;
    this.t = 0;
    this.gravity = opts.gravity != null ? opts.gravity : -6.4;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);

    const base = new THREE.Color(color);
    const gold = new THREE.Color(PALETTE.liuJinLight);
    const spread = opts.spread || 0.9;
    const power = opts.power || 2.5;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.16;
      positions[i3] = origin.x + Math.cos(a) * r;
      positions[i3 + 1] = origin.y + 0.05 + Math.random() * 0.1;
      positions[i3 + 2] = origin.z + Math.sin(a) * r;

      const up = 0.55 + Math.random() * 0.9;
      const out = (0.5 + Math.random()) * spread;
      this.vel[i3] = Math.cos(a) * out * power * 0.42;
      this.vel[i3 + 1] = up * power * 0.72;
      this.vel[i3 + 2] = Math.sin(a) * out * power * 0.42;

      const c = base.clone().lerp(gold, Math.random() * 0.65);
      colors[i3] = c.r; colors[i3 + 1] = c.g; colors[i3 + 2] = c.b;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry = g;

    this.material = new THREE.PointsMaterial({
      size: opts.size || 0.085,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });

    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  /** @returns {boolean} 是否已结束 */
  update(dt: number): boolean {
    this.t += dt;
    const k = this.t / this.life;
    if (k >= 1) return true;
    const pos = this.geometry.attributes.position.array;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      this.vel[i3 + 1]! += this.gravity * dt;
      pos[i3] += this.vel[i3]! * dt;
      pos[i3 + 1] += this.vel[i3 + 1]! * dt;
      pos[i3 + 2] += this.vel[i3 + 2]! * dt;
      if (pos[i3 + 1]! < 0.02) {           // 触地反弹一点点
        pos[i3 + 1] = 0.02;
        this.vel[i3 + 1]! *= -0.28;
        this.vel[i3]! *= 0.7;
        this.vel[i3 + 2]! *= 0.7;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.material.opacity = Math.max(0, 1 - k * k);
    this.material.size = (0.085) * (1 - k * 0.45);
    return false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export class Effects {
  sceneSys: any;
  root: any;
  selectionGroup: any;
  hintGroup: any;
  blockedGroup: any;
  markerGroup: any;
  checkGroup: any;
  particleGroup: any;
  rippleGroup: any;
  dustGroup: any;
  afterimageGroup: any;
  weaponTrailGroup: any;
  bursts: ParticleBurst[];
  ripples: Array<{ mesh: any, mat: any, t: number, life: number }>;
  _time: number;
  _selectedMesh: any;
  _checkedMesh: any;
  _flashEl: any;
  _flashT: number;
  _flashDur: number;
  _flashStrength: number;
  _materials: any[];
  matSelectRing: any;
  matSelectDisc: any;
  matHintEmpty: any;
  matHintEmptyRing: any;
  matHintCapture: any;
  matBlocked: any;
  matLastFrom: any;
  matLastTo: any;
  matCheck: any;
  matRipple: any;
  _selTorus: any;
  _selTorus2: any;
  _selDisc: any;
  _selTicks: any;
  _selectionNode: any;
  _lastMarkerB: any;
  _checkNode: any;

  /**
   * @param {import('./scene.ts').SceneSystem} sceneSys
   */
  constructor(sceneSys: any) {
    this.sceneSys = sceneSys;
    this.root = sceneSys.effectsGroup;

    this.selectionGroup = new THREE.Group(); this.selectionGroup.name = 'fx-selection';
    this.hintGroup = new THREE.Group(); this.hintGroup.name = 'fx-hints';
    this.blockedGroup = new THREE.Group(); this.blockedGroup.name = 'fx-blocked';
    this.markerGroup = new THREE.Group(); this.markerGroup.name = 'fx-lastmove';
    this.checkGroup = new THREE.Group(); this.checkGroup.name = 'fx-check';
    this.particleGroup = new THREE.Group(); this.particleGroup.name = 'fx-particles';
    this.rippleGroup = new THREE.Group(); this.rippleGroup.name = 'fx-ripples';
    this.dustGroup = new THREE.Group(); this.dustGroup.name = 'fx-dust';
    this.afterimageGroup = new THREE.Group(); this.afterimageGroup.name = 'fx-afterimage';
    this.weaponTrailGroup = new THREE.Group(); this.weaponTrailGroup.name = 'fx-weapontrail';
    this.root.add(
      this.markerGroup, this.hintGroup, this.blockedGroup,
      this.selectionGroup, this.checkGroup, this.particleGroup, this.rippleGroup,
      this.dustGroup, this.afterimageGroup, this.weaponTrailGroup
    );

    /** @type {ParticleBurst[]} */
    this.bursts = [];
    /** @type {Array<{mesh:THREE.Mesh, t:number, life:number, from:number, to:number}>} */
    this.ripples = [];

    this._time = 0;
    this._selectedMesh = null;
    this._checkedMesh = null;
    this._flashEl = null;
    this._flashT = 0;
    this._flashDur = 0;
    this._flashStrength = 0;

    this._materials = [];
    this._buildMaterials();
  }

  _reg(m: any): any { this._materials.push(m); return m; }

  _buildMaterials(): void {
    const add = THREE.AdditiveBlending;
    this.matSelectRing = this._reg(new THREE.MeshBasicMaterial({
      color: PALETTE.select, transparent: true, opacity: 0.92, blending: add, depthWrite: false, depthTest: false
    }));
    this.matSelectDisc = this._reg(new THREE.MeshBasicMaterial({
      color: PALETTE.select, transparent: true, opacity: 0.3, blending: add, depthWrite: false, side: THREE.DoubleSide
    }));
    this.matHintEmpty = this._reg(new THREE.MeshBasicMaterial({
      color: PALETTE.hintEmpty, transparent: true, opacity: 0.55, blending: add, depthWrite: false, side: THREE.DoubleSide
    }));
    this.matHintEmptyRing = this._reg(new THREE.MeshBasicMaterial({
      color: PALETTE.hintEmpty, transparent: true, opacity: 0.85, blending: add, depthWrite: false, side: THREE.DoubleSide
    }));
    this.matHintCapture = this._reg(new THREE.MeshBasicMaterial({
      color: PALETTE.hintCapture, transparent: true, opacity: 0.95, blending: add, depthWrite: false, depthTest: false, side: THREE.DoubleSide
    }));
    this.matBlocked = this._reg(new THREE.MeshBasicMaterial({
      color: PALETTE.hintBlocked, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide
    }));
    this.matLastFrom = this._reg(new THREE.MeshBasicMaterial({
      color: PALETTE.lastMoveFrom, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide
    }));
    this.matLastTo = this._reg(new THREE.MeshBasicMaterial({
      color: PALETTE.lastMoveTo, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide
    }));
    this.matCheck = this._reg(new THREE.MeshBasicMaterial({
      color: PALETTE.checkGlow, transparent: true, opacity: 0.8, blending: add, depthWrite: false, side: THREE.DoubleSide
    }));
    this.matRipple = this._reg(new THREE.MeshBasicMaterial({
      color: PALETTE.liuJinLight, transparent: true, opacity: 0.9, blending: add, depthWrite: false, side: THREE.DoubleSide
    }));
  }

  // -------------------------------------------------------------------------
  // 选中高亮
  // -------------------------------------------------------------------------

  /**
   * 选中棋子的旋转光环 + 底座脉冲
   * @param {THREE.Object3D} mesh 棋子 Group（可为 null 表示清除）
   */
  highlightSelected(mesh: any): void {
    this.clearSelection();
    if (!mesh) return;
    this._selectedMesh = mesh;

    const g = new THREE.Group();

    // 旋转光环（Torus，斜立一点，绕 Y 旋转）
    const torus = new THREE.Mesh(
      geo('selTorus', () => new THREE.TorusGeometry(0.48, 0.028, 10, 44)),
      this.matSelectRing
    );
    torus.rotation.x = -Math.PI / 2;
    torus.position.y = 0.05;
    torus.renderOrder = 8;
    g.add(torus);
    this._selTorus = torus;

    // 第二个更小、反向旋转的环
    const torus2 = new THREE.Mesh(
      geo('selTorus2', () => new THREE.TorusGeometry(0.36, 0.016, 8, 36)),
      this.matSelectRing
    );
    torus2.rotation.x = -Math.PI / 2;
    torus2.position.y = 0.03;
    torus2.renderOrder = 8;
    g.add(torus2);
    this._selTorus2 = torus2;

    // 底座脉冲光盘
    const disc = new THREE.Mesh(
      geo('selDisc', () => new THREE.CircleGeometry(0.44, 40)),
      this.matSelectDisc
    );
    flat(disc, HINT_Y + 0.002);
    g.add(disc);
    this._selDisc = disc;

    // 四角小箭头，指示"这是当前选中"
    const tickGeo = geo('selTick', () => new THREE.PlaneGeometry(0.075, 0.19));
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(tickGeo, this.matSelectRing);
      flat(tick, HINT_Y + 0.004);
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      tick.position.x = Math.cos(a) * 0.58;
      tick.position.z = Math.sin(a) * 0.58;
      tick.rotation.z = -a + Math.PI / 2;
      g.add(tick);
    }
    this._selTicks = g.children.slice(3);

    const p = mesh.position;
    g.position.set(p.x, 0, p.z);
    this.selectionGroup.add(g);
    this._selectionNode = g;
  }

  clearSelection(): void {
    this._selectedMesh = null;
    this._selectionNode = null;
    this._selTorus = this._selTorus2 = this._selDisc = null;
    this._selTicks = null;
    disposeChildren(this.selectionGroup, false);
  }

  // -------------------------------------------------------------------------
  // 合法落点提示
  // -------------------------------------------------------------------------

  /**
   * @param {Array<{file:number, rank:number, capture:boolean}>} moves
   */
  showMoveHints(moves: Array<{ file: number, rank: number, capture: boolean }>): void {
    this.clearHints();
    if (!moves || !moves.length) return;
    for (const m of moves) {
      const { x, z } = toWorld(m.file, m.rank);
      const node = m.capture ? this._makeCaptureHint() : this._makeEmptyHint();
      node.position.set(x, 0, z);
      node.userData.phase = Math.random() * Math.PI * 2;
      node.userData.capture = !!m.capture;
      node.userData.cell = { file: m.file, rank: m.rank };
      this.hintGroup.add(node);
    }
  }

  _makeEmptyHint(): any {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(
      geo('hintDisc', () => new THREE.CircleGeometry(0.17, 28)),
      this.matHintEmpty
    );
    flat(disc, HINT_Y);
    g.add(disc);
    const ring = new THREE.Mesh(
      geo('hintRing', () => new THREE.RingGeometry(0.2, 0.235, 30)),
      this.matHintEmptyRing
    );
    flat(ring, HINT_Y + 0.001);
    g.add(ring);
    return g;
  }

  _makeCaptureHint(): any {
    const g = new THREE.Group();
    // 红色危险圆环（较粗）
    const ring = new THREE.Mesh(
      geo('capRing', () => new THREE.RingGeometry(0.36, 0.45, 36)),
      this.matHintCapture
    );
    flat(ring, HINT_Y + 0.003);
    g.add(ring);
    // 内部十字准星
    const barGeo = geo('capBar', () => new THREE.PlaneGeometry(0.62, 0.036));
    const h = new THREE.Mesh(barGeo, this.matHintCapture);
    flat(h, HINT_Y + 0.004);
    g.add(h);
    const v = new THREE.Mesh(barGeo, this.matHintCapture);
    flat(v, HINT_Y + 0.004);
    v.rotation.z = Math.PI / 2;
    g.add(v);
    // 四个角标
    const cornerGeo = geo('capCorner', () => new THREE.PlaneGeometry(0.055, 0.15));
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(cornerGeo, this.matHintCapture);
      flat(c, HINT_Y + 0.005);
      const a = (i / 4) * Math.PI * 2;
      c.position.x = Math.cos(a) * 0.53;
      c.position.z = Math.sin(a) * 0.53;
      c.rotation.z = -a;
      g.add(c);
    }
    return g;
  }

  clearHints(): void { disposeChildren(this.hintGroup, false); }

  // -------------------------------------------------------------------------
  // 被阻挡点（Windex：灰色叉号）
  // -------------------------------------------------------------------------

  /**
   * @param {Array<{file:number, rank:number, reason?:string}>} points
   */
  showBlockedHints(points: Array<{ file: number, rank: number, reason?: string }>): void {
    this.clearBlockedHints();
    if (!points || !points.length) return;
    const barGeo = geo('blkBar', () => new THREE.PlaneGeometry(0.42, 0.05));
    for (const p of points) {
      const { x, z } = toWorld(p.file, p.rank);
      const g = new THREE.Group();
      const a = new THREE.Mesh(barGeo, this.matBlocked);
      flat(a, HINT_Y); a.rotation.z = Math.PI / 4; g.add(a);
      const b = new THREE.Mesh(barGeo, this.matBlocked);
      flat(b, HINT_Y); b.rotation.z = -Math.PI / 4; g.add(b);
      g.position.set(x, 0, z);
      g.userData.reason = p.reason || 'blocked';
      this.blockedGroup.add(g);
    }
  }

  clearBlockedHints(): void { disposeChildren(this.blockedGroup, false); }

  /** 一次性清掉选中 + 落点 + 阻挡 */
  clearAllHints(): void {
    this.clearSelection();
    this.clearHints();
    this.clearBlockedHints();
  }

  // -------------------------------------------------------------------------
  // 上一步标记（Windex）
  // -------------------------------------------------------------------------

  /**
   * @param {{file:number,rank:number}} from
   * @param {{file:number,rank:number}} to
   */
  showLastMoveMarker(from: { file: number, rank: number }, to: { file: number, rank: number }): void {
    this.clearLastMoveMarker();
    if (!from || !to) return;
    const mk = (pos: any, mat: any, inner: number, outer: number) => {
      const { x, z } = toWorld(pos.file, pos.rank);
      const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 4, 1), mat);
      flat(m, MARKER_Y);
      m.rotation.z = Math.PI / 4;    // 4 段环 -> 方框
      m.position.set(x, MARKER_Y, z);
      return m;
    };
    const a = mk(from, this.matLastFrom, 0.40, 0.47);
    const b = mk(to, this.matLastTo, 0.44, 0.52);
    a.userData.temp = true; b.userData.temp = true;
    this.markerGroup.add(a, b);
    this._lastMarkerB = b;
  }

  clearLastMoveMarker(): void {
    this._lastMarkerB = null;
    disposeChildren(this.markerGroup, true);
  }

  // -------------------------------------------------------------------------
  // 被将军的将帅脉冲
  // -------------------------------------------------------------------------

  /**
   * @param {THREE.Object3D|null} mesh 被将军一方的将/帅 Group
   */
  setCheckedKing(mesh: any): void {
    disposeChildren(this.checkGroup, true);
    this._checkedMesh = mesh || null;
    if (!mesh) return;
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.62, 40), this.matCheck);
    flat(ring, HINT_Y + 0.006);
    g.add(ring);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.72, 40), this.matCheck);
    flat(ring2, HINT_Y + 0.006);
    g.add(ring2);
    g.position.set(mesh.position.x, 0, mesh.position.z);
    this.checkGroup.add(g);
    this._checkNode = g;
  }

  // -------------------------------------------------------------------------
  // 粒子 / 涟漪 / 震动 / 全屏脉冲
  // -------------------------------------------------------------------------

  /**
   * 落子 / 吃子粒子迸发
   * @param {THREE.Vector3|{x:number,y:number,z:number}} position
   * @param {number} [color]
   * @param {Object} [opts]
   */
  spawnImpactParticles(position: any, color: number = PALETTE.liuJin, opts: Record<string, any> = {}): any {
    const origin = position.isVector3 ? position : new THREE.Vector3(position.x, position.y || 0, position.z);
    const burst = new ParticleBurst(origin, color, opts);
    this.particleGroup.add(burst.points);
    this.bursts.push(burst);
    if (opts.ripple !== false) this.spawnRipple(origin, opts.rippleColor || color);
    return burst;
  }

  /** 扩散涟漪圆环 */
  spawnRipple(position: any, color: number = PALETTE.liuJinLight, life = 0.6): any {
    const mat = this.matRipple.clone();
    mat.color = new THREE.Color(color);
    const mesh = new THREE.Mesh(geo('ripple', () => new THREE.RingGeometry(0.3, 0.36, 36)), mat);
    flat(mesh, HINT_Y + 0.008);
    mesh.position.set(position.x, HINT_Y + 0.008, position.z);
    this.rippleGroup.add(mesh);
    this.ripples.push({ mesh, mat, t: 0, life });
    return mesh;
  }

  /** 相机震动（委托 SceneSystem） */
  screenShake(intensity = 0.08, duration = 0.28): void {
    this.sceneSys.screenShake(intensity, duration);
  }

  /**
   * 全屏红色脉冲（CSS overlay，最可靠）
   * @param {number} strength 0..1
   * @param {number} duration 秒
   */
  checkPulse(strength = 0.55, duration = 0.85): void {
    const el = this._ensureFlashEl();
    if (!el) return;
    this._flashT = 0;
    this._flashDur = duration;
    this._flashStrength = strength;
  }

  _ensureFlashEl(): any {
    if (this._flashEl && this._flashEl.isConnected) return this._flashEl;
    if (typeof document === 'undefined') return null;
    let el = document.getElementById('check-flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'check-flash';
      el.className = 'check-flash';
      document.body.appendChild(el);
    }
    // 若 CSS 未提供定位（例如样式表加载失败），兜底注入内联样式
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (!cs || cs.position !== 'fixed') {
      Object.assign(el.style, {
        position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '40',
        background: 'radial-gradient(ellipse at center, rgba(255,40,25,0) 38%, rgba(255,40,25,0.85) 100%)'
      });
    }
    el.style.opacity = '0';
    this._flashEl = el;
    return el;
  }

  // -------------------------------------------------------------------------
  // 每帧更新
  // -------------------------------------------------------------------------

  update(dt: number): void {
    this._time += dt;
    const t = this._time;

    // 选中光环旋转 + 脉冲
    if (this._selTorus) {
      this._selTorus.rotation.z = t * 1.15;
      if (this._selTorus2) this._selTorus2.rotation.z = -t * 1.75;
      const p = 0.5 + 0.5 * Math.sin(t * 3.1);
      if (this._selDisc) {
        const s = 0.86 + p * 0.28;
        this._selDisc.scale.set(s, s, 1);
        this._selDisc.material.opacity = 0.16 + p * 0.24;
      }
      if (this._selTicks) {
        for (let i = 0; i < this._selTicks.length; i++) {
          const tick = this._selTicks[i];
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4 + t * 0.6;
          const r = 0.56 + p * 0.05;
          tick.position.x = Math.cos(a) * r;
          tick.position.z = Math.sin(a) * r;
          tick.rotation.z = -a + Math.PI / 2;
        }
      }
      // 选中棋子跟随（棋子可能在悬停上浮）
      if (this._selectedMesh && this._selectionNode) {
        this._selectionNode.position.x = this._selectedMesh.position.x;
        this._selectionNode.position.z = this._selectedMesh.position.z;
      }
    }

    // 落点呼吸
    const hints = this.hintGroup.children;
    for (let i = 0; i < hints.length; i++) {
      const n = hints[i];
      const ph = n.userData.phase || 0;
      if (n.userData.capture) {
        const s = 1 + 0.09 * Math.sin(t * 5.2 + ph);
        n.scale.set(s, 1, s);
        n.rotation.y = t * 0.55;
      } else {
        const s = 0.84 + 0.2 * (0.5 + 0.5 * Math.sin(t * 3.4 + ph));
        n.scale.set(s, 1, s);
      }
    }

    // 阻挡叉号轻微闪烁
    const blocked = this.blockedGroup.children;
    for (let i = 0; i < blocked.length; i++) {
      const s = 0.92 + 0.08 * Math.sin(t * 2.4 + i);
      blocked[i].scale.set(s, 1, s);
    }

    // 上一步终点标记轻微脉冲
    if (this._lastMarkerB) {
      const s = 1 + 0.05 * Math.sin(t * 2.2);
      this._lastMarkerB.scale.set(s, s, 1);
    }

    // 将军脉冲环
    if (this._checkNode) {
      const p = 0.5 + 0.5 * Math.sin(t * 6.0);
      const s = 0.9 + p * 0.35;
      this._checkNode.scale.set(s, 1, s);
      this.matCheck.opacity = 0.35 + p * 0.5;
      if (this._checkedMesh) {
        this._checkNode.position.x = this._checkedMesh.position.x;
        this._checkNode.position.z = this._checkedMesh.position.z;
      }
    }

    // 粒子
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      if (b.update(dt)) {
        this.particleGroup.remove(b.points);
        b.dispose();
        this.bursts.splice(i, 1);
      }
    }

    // 涟漪
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]!;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        this.rippleGroup.remove(r.mesh);
        r.mat.dispose();
        this.ripples.splice(i, 1);
        continue;
      }
      const s = 0.6 + k * 2.6;
      r.mesh.scale.set(s, s, 1);
      r.mat.opacity = 0.85 * (1 - k) * (1 - k);
    }

    // 全屏脉冲
    if (this._flashEl && this._flashDur > 0) {
      this._flashT += dt;
      const k = this._flashT / this._flashDur;
      if (k >= 1) {
        this._flashEl.style.opacity = '0';
        this._flashDur = 0;
      } else {
        // 两次快速脉冲后衰减
        const pulse = Math.abs(Math.sin(k * Math.PI * 2)) * (1 - k);
        this._flashEl.style.opacity = String(this._flashStrength * pulse);
      }
    }

    // 尘土拖尾衰减
    for (let i = this.dustGroup.children.length - 1; i >= 0; i--) {
      const c = this.dustGroup.children[i];
      const ud = c.userData;
      ud.t += dt;
      const k = ud.t / ud.life;
      if (k >= 1) {
        this.dustGroup.remove(c);
        if (c.material) c.material.dispose();
        if (c.geometry) c.geometry.dispose();
      } else {
        c.position.x += ud.velX * dt;
        c.position.y += ud.velY * dt;
        c.position.z += ud.velZ * dt;
        ud.velY -= 1.2 * dt;
        c.material.opacity = Math.max(0, (1 - k) * 0.5);
        c.scale.setScalar(1 + k * 1.5);
      }
    }

    // 残影淡出
    for (let i = this.afterimageGroup.children.length - 1; i >= 0; i--) {
      const c = this.afterimageGroup.children[i];
      const ud = c.userData;
      ud.t += dt;
      const k = ud.t / ud.life;
      if (k >= 1) {
        this.afterimageGroup.remove(c);
        if (c.material) c.material.dispose();
        if (c.geometry) c.geometry.dispose();
      } else {
        c.material.opacity = 0.22 * (1 - k);
        c.position.y += 0.3 * dt;
      }
    }

    // 武器拖痕淡出
    for (let i = this.weaponTrailGroup.children.length - 1; i >= 0; i--) {
      const c = this.weaponTrailGroup.children[i];
      const ud = c.userData;
      ud.t += dt;
      const k = ud.t / ud.life;
      if (k >= 1) {
        this.weaponTrailGroup.remove(c);
        if (c.material) c.material.dispose();
        if (c.geometry) c.geometry.dispose();
      } else {
        c.material.opacity = Math.max(0, (1 - k) * 0.7);
        c.scale.y += 0.5 * dt;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 尘土拖尾 / 残影 / 武器拖痕（战斗演出层 VFX）
  // -------------------------------------------------------------------------

  /**
   * 尘土拖尾 puff：M2 巡航期间每 0.04s 生成
   * @param {THREE.Vector3|{x:number,y:number,z:number}} position
   * @param {string} side  'r'|'b'
   * @param {string} pieceType  PT 值
   */
  spawnDustTrail(position: any, side: string, pieceType: string): void {
    const count = 3 + Math.floor(Math.random() * 3); // 3-5
    const colors = [
      new THREE.Color(0x8b7d6b), // 干土色
      new THREE.Color(0xa0907a),
      new THREE.Color(0x756b5a)
    ];
    for (let i = 0; i < count; i++) {
      const size = 0.025 + Math.random() * 0.04;
      const geo = new THREE.SphereGeometry(size, 4, 4);
      const mat = new THREE.MeshBasicMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        transparent: true,
        opacity: 0.5 + Math.random() * 0.3,
        depthWrite: false,
        blending: THREE.NormalBlending
      });
      const puff = new THREE.Mesh(geo, mat);
      puff.position.set(
        position.x + (Math.random() - 0.5) * 0.25,
        position.y + 0.02 + Math.random() * 0.06,
        position.z + (Math.random() - 0.5) * 0.25
      );
      puff.userData = {
        life: 0.22 + Math.random() * 0.08,
        t: 0,
        velX: (Math.random() - 0.5) * 0.4,
        velY: 0.1 + Math.random() * 0.3,
        velZ: (Math.random() - 0.5) * 0.4
      };
      puff.renderOrder = 2;
      this.dustGroup.add(puff);
    }
  }

  /**
   * 残影 billboard：M2 巡航期间每 0.05s 在棋子当前位置生成
   * @param {THREE.Object3D} mesh  棋子根 Group
   */
  spawnAfterimage(mesh: any): void {
    if (!mesh) return;
    // 限制同时 6 个残影
    if (this.afterimageGroup.children.length >= 6) {
      const oldest = this.afterimageGroup.children[0];
      this.afterimageGroup.remove(oldest);
      oldest.traverse((o: any) => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); });
    }

    const geo = new THREE.PlaneGeometry(0.9, 0.9);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    });
    const billboard = new THREE.Mesh(geo, mat);
    billboard.position.copy(mesh.position);
    billboard.position.y += 0.1;
    billboard.renderOrder = 8;
    // 面朝相机（简化：锁死水平朝向）
    billboard.userData = { life: 0.35, t: 0 };
    this.afterimageGroup.add(billboard);
  }

  /**
   * 武器拖痕：A2 命中帧生成短线/弧线拖痕
   * @param {THREE.Object3D} mesh  棋子根 Group
   * @param {string} type  PT 值
   */
  spawnWeaponTrail(mesh: any, type: string): void {
    if (!mesh) return;
    const count = 3;
    const color = 0xff3322; // 赤红拖痕
    for (let i = 0; i < count; i++) {
      const geo = new THREE.PlaneGeometry(0.12, 0.35 - i * 0.08);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7 - i * 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      });
      const trail = new THREE.Mesh(geo, mat);
      trail.position.copy(mesh.position);
      trail.position.y += 0.3 + i * 0.15;
      trail.position.x += (Math.random() - 0.5) * 0.4;
      trail.position.z += (Math.random() - 0.5) * 0.4;
      trail.rotation.z = (Math.random() - 0.5) * 1.2;
      trail.rotation.y = (Math.random() - 0.5) * 1.2;
      trail.renderOrder = 9;
      trail.userData = { life: 0.28 + Math.random() * 0.06, t: 0 };
      this.weaponTrailGroup.add(trail);
    }
  }

  // -------------------------------------------------------------------------
  // 清理
  // -------------------------------------------------------------------------

  /** 重开局：清掉所有瞬态效果 */
  clearAll(): void {
    this.clearAllHints();
    this.clearLastMoveMarker();
    this.setCheckedKing(null);
    for (const b of this.bursts) { this.particleGroup.remove(b.points); b.dispose(); }
    this.bursts.length = 0;
    for (const r of this.ripples) { this.rippleGroup.remove(r.mesh); r.mat.dispose(); }
    this.ripples.length = 0;
    if (this._flashEl) { this._flashEl.style.opacity = '0'; this._flashDur = 0; }
    // 清理尘土/残影/武器拖痕
    disposeChildren(this.dustGroup, true);
    disposeChildren(this.afterimageGroup, true);
    disposeChildren(this.weaponTrailGroup, true);
  }

  dispose(): void {
    this.clearAll();
    for (const m of this._materials) m.dispose();
    this._materials.length = 0;
    for (const k of Object.keys(GEO)) { GEO[k].dispose(); delete GEO[k]; }
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

/**
 * 移除并释放某个 Group 的所有子节点
 * @param {THREE.Object3D} group
 * @param {boolean} disposeGeometry 是否释放几何体（共享几何体不要释放）
 */
function disposeChildren(group: any, disposeGeometry: boolean): void {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const c = group.children[i];
    group.remove(c);
    c.traverse((o: any) => {
      if (!o.isMesh) return;
      if (disposeGeometry && o.geometry && !isSharedGeometry(o.geometry)) o.geometry.dispose();
    });
  }
}

function isSharedGeometry(g: any): boolean {
  for (const k of Object.keys(GEO)) if (GEO[k] === g) return true;
  return false;
}

export function createEffects(sceneSys: any): Effects { return new Effects(sceneSys); }

export default Effects;
