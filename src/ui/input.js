/**
 * input.js —— 拾取与交互状态机（Oil 原则：消除一切操作摩擦）
 *
 *  - 单击选中 / 单击落子，绝不使用拖拽
 *  - 点击己方另一枚棋子 = 直接切换选中（无需先取消）
 *  - 点击非法目标 = 拒绝音效 + 抖动 + toast 说明原因，但**不清空当前选择**
 *  - 点击棋盘外 = 取消选择
 *  - mousedown/up 位移 > 5px 视为转视角，不触发选子（否则转视角会误落子）
 *  - Pointer Events，桌面 + 触屏通用
 *
 * 本模块只负责"读输入 -> 判断意图"，所有规则查询与副作用通过 game 适配器回调。
 */

import * as THREE from 'three';
import { fromWorld, toWorld } from '../core/constants.js';

/** 判定为"拖拽转视角"的像素阈值 */
const DRAG_THRESHOLD = 5;

/**
 * game 适配器需要实现的接口（由 main.js 提供）
 * @typedef {Object} InputGameAdapter
 * @property {() => boolean} isLocked            动画 / AI 思考中，禁止交互
 * @property {(side:string) => boolean} canControl  该方是否由本地玩家控制
 * @property {(f:number, r:number) => Object|null} pieceAt
 * @property {(f:number, r:number) => Array} legalMoves
 * @property {(f:number, r:number) => Array} blockedPoints
 * @property {(from:Object, to:Object) => string|null} whyIllegal
 * @property {(f:number, r:number) => THREE.Object3D|null} meshAt
 * @property {(sel:Object) => void} onSelect
 * @property {(reason:string) => void} onDeselect
 * @property {(from:Object, to:Object) => void} onMove
 * @property {(from:Object, to:Object, reason:string, mesh:Object) => void} onIllegal
 * @property {(mesh:Object|null, cell:Object|null) => void} onHover
 * @property {(cell:Object, piece:Object|null) => void} [onNoop]
 */

export class InputSystem {
  /**
   * @param {Object} cfg
   * @param {HTMLElement} cfg.domElement
   * @param {THREE.Camera} cfg.camera
   * @param {THREE.Object3D} cfg.piecesGroup
   * @param {InputGameAdapter} cfg.game
   */
  constructor({ domElement, camera, piecesGroup, game }) {
    this.dom = domElement;
    this.camera = camera;
    this.piecesGroup = piecesGroup;
    this.game = game;

    this.raycaster = new THREE.Raycaster();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ndc = new THREE.Vector2();
    this._hoverNdc = new THREE.Vector2();
    this._hit = new THREE.Vector3();

    /** @type {{file:number, rank:number, moves:Array, mesh:Object}|null} */
    this.selected = null;
    this.enabled = true;

    this._down = null;         // { x, y, id, time }
    this._dragging = false;
    this._hoverDirty = false;
    this._hoverMesh = null;
    this._hoverCell = null;
    this._pointerInside = false;

    this.dom.style.touchAction = 'none';

    this._onPointerDown = this.handlePointerDown.bind(this);
    this._onPointerMove = this.handlePointerMove.bind(this);
    this._onPointerUp = this.handlePointerUp.bind(this);
    this._onPointerLeave = this.handlePointerLeave.bind(this);
    this._onContextMenu = this.handleContextMenu.bind(this);

    this.dom.addEventListener('pointerdown', this._onPointerDown);
    this.dom.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    this.dom.addEventListener('pointerleave', this._onPointerLeave);
    this.dom.addEventListener('pointercancel', this._onPointerLeave);
    this.dom.addEventListener('contextmenu', this._onContextMenu);
  }

  // -------------------------------------------------------------------------
  // 拾取
  // -------------------------------------------------------------------------

  /** 客户端坐标 -> NDC */
  _toNdc(ev, out) {
    const rect = this.dom.getBoundingClientRect();
    out.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    out.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    return out;
  }

  /**
   * 命中棋子：对 piecesGroup 递归 raycast，向上找带 userData.pieceType 的根 Group
   * @returns {{mesh:THREE.Object3D, cell:{file:number,rank:number}}|null}
   */
  pickPiece(ndc) {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.piecesGroup.children, true);
    for (let i = 0; i < hits.length; i++) {
      let o = hits[i].object;
      while (o && o !== this.piecesGroup) {
        if (o.userData && o.userData.pieceType) {
          const cell = o.userData.cell
            || fromWorld(o.position.x, o.position.z);
          if (cell) return { mesh: o, cell };
          break;
        }
        o = o.parent;
      }
    }
    return null;
  }

  /**
   * 命中棋盘平面 -> 格子坐标
   * @returns {{file:number, rank:number}|null}
   */
  pickCell(ndc) {
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = this.raycaster.ray.intersectPlane(this.boardPlane, this._hit);
    if (!p) return null;
    return fromWorld(p.x, p.z);
  }

  // -------------------------------------------------------------------------
  // 指针事件
  // -------------------------------------------------------------------------

  handlePointerDown(ev) {
    if (!this.enabled) return;
    if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === 'mouse') return;
    this._down = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, time: performance.now() };
    this._dragging = false;
  }

  handlePointerMove(ev) {
    if (!this.enabled) return;
    this._pointerInside = true;
    if (this._down) {
      const dx = ev.clientX - this._down.x;
      const dy = ev.clientY - this._down.y;
      // 超过阈值 -> 判定为转视角，本次 pointerup 不触发选子
      if (!this._dragging && (dx * dx + dy * dy) > DRAG_THRESHOLD * DRAG_THRESHOLD) {
        this._dragging = true;
        this._setHover(null, null);
      }
      return;
    }
    this._toNdc(ev, this._hoverNdc);
    this._hoverDirty = true;
  }

  handlePointerUp(ev) {
    if (!this.enabled) { this._down = null; return; }
    const down = this._down;
    this._down = null;
    if (!down) return;
    if (ev.pointerId !== undefined && down.id !== undefined && ev.pointerId !== down.id) return;
    const dx = ev.clientX - down.x;
    const dy = ev.clientY - down.y;
    if (this._dragging || (dx * dx + dy * dy) > DRAG_THRESHOLD * DRAG_THRESHOLD) {
      this._dragging = false;
      return;   // 视角操作，不当作点击
    }
    // 只处理落在画布内的抬起
    const rect = this.dom.getBoundingClientRect();
    if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) return;
    this._toNdc(ev, this._ndc);
    this.handleClick(this._ndc);
  }

  handlePointerLeave() {
    this._pointerInside = false;
    this._setHover(null, null);
    this.dom.style.cursor = 'default';
  }

  handleContextMenu(ev) {
    ev.preventDefault();
    if (this.selected) this.deselect('right-click');
  }

  // -------------------------------------------------------------------------
  // 交互状态机（Oil）
  // -------------------------------------------------------------------------

  handleClick(ndc) {
    const game = this.game;
    if (game.isLocked && game.isLocked()) return;

    const hit = this.pickPiece(ndc);
    const cell = hit ? hit.cell : this.pickCell(ndc);

    // —— 点击棋盘外 -> 取消选择 ——
    if (!cell) { this.deselect('outside'); return; }

    const piece = game.pieceAt(cell.file, cell.rank);
    const sel = this.selected;

    if (sel) {
      // 1) 再次点击同一枚 -> 取消
      if (sel.file === cell.file && sel.rank === cell.rank) { this.deselect('toggle'); return; }

      // 2) 点击己方另一枚 -> 直接切换（不需要先取消）
      if (piece && game.canControl(piece.side) && piece.side === sel.side) {
        this.select(cell.file, cell.rank);
        return;
      }

      // 3) 合法落点 -> 走子
      const target = sel.moves.find(m => m.file === cell.file && m.rank === cell.rank);
      if (target) {
        const from = { file: sel.file, rank: sel.rank };
        const to = { file: cell.file, rank: cell.rank };
        this.selected = null;      // 选择状态交给 game 决定何时清视觉
        game.onMove(from, to);
        return;
      }

      // 4) 非法目标 -> 说明原因，但保留选择
      const from = { file: sel.file, rank: sel.rank };
      const to = { file: cell.file, rank: cell.rank };
      const reason = (game.whyIllegal && game.whyIllegal(from, to)) || '这步棋走不了';
      game.onIllegal(from, to, reason, sel.mesh);
      return;
    }

    // —— 尚未选中 ——
    if (!piece) { if (game.onNoop) game.onNoop(cell, null); return; }
    if (!game.canControl(piece.side)) { if (game.onNoop) game.onNoop(cell, piece); return; }
    this.select(cell.file, cell.rank);
  }

  /** 选中某格棋子（会重新计算合法走法与阻挡点） */
  select(file, rank) {
    const game = this.game;
    const piece = game.pieceAt(file, rank);
    if (!piece) return false;
    const moves = game.legalMoves(file, rank) || [];
    const blocked = (game.blockedPoints && game.blockedPoints(file, rank)) || [];
    const mesh = game.meshAt ? game.meshAt(file, rank) : null;
    this.selected = { file, rank, side: piece.side, type: piece.type, moves, blocked, mesh };
    game.onSelect(this.selected);
    return true;
  }

  /** 取消选择 */
  deselect(reason = 'manual') {
    if (!this.selected) return;
    this.selected = null;
    if (this.game.onDeselect) this.game.onDeselect(reason);
  }

  /** 外部（走子完成 / 悔棋 / 重开）强制清空选择状态 */
  reset() {
    this.selected = null;
    this._down = null;
    this._dragging = false;
    this._setHover(null, null);
  }

  /** 当前选中的格子 */
  getSelection() { return this.selected; }

  /** 重新计算当前选中棋子的合法走法（局面变化后调用） */
  refreshSelection() {
    if (!this.selected) return;
    this.select(this.selected.file, this.selected.rank);
  }

  setEnabled(v) {
    this.enabled = !!v;
    if (!v) { this._setHover(null, null); this.dom.style.cursor = 'default'; }
  }

  // -------------------------------------------------------------------------
  // 悬停反馈
  // -------------------------------------------------------------------------

  _setHover(mesh, cell) {
    if (this._hoverMesh === mesh) return;
    this._hoverMesh = mesh;
    this._hoverCell = cell;
    if (this.game.onHover) this.game.onHover(mesh, cell);
  }

  /** 每帧调用：处理悬停射线（避免在 pointermove 里高频 raycast） */
  update() {
    if (!this.enabled || !this._hoverDirty || this._down) return;
    this._hoverDirty = false;
    const game = this.game;
    if (game.isLocked && game.isLocked()) { this._setHover(null, null); this.dom.style.cursor = 'default'; return; }

    const hit = this.pickPiece(this._hoverNdc);
    if (hit) {
      const piece = game.pieceAt(hit.cell.file, hit.cell.rank);
      const controllable = piece && game.canControl(piece.side);
      if (controllable) {
        this._setHover(hit.mesh, hit.cell);
        this.dom.style.cursor = 'pointer';
        return;
      }
      // 敌方棋子：若是当前选中方的合法目标，也给 pointer
      if (this.selected && this.selected.moves.some(m => m.file === hit.cell.file && m.rank === hit.cell.rank)) {
        this._setHover(null, hit.cell);
        this.dom.style.cursor = 'pointer';
        return;
      }
      this._setHover(null, hit.cell);
      this.dom.style.cursor = 'default';
      return;
    }

    const cell = this.pickCell(this._hoverNdc);
    if (cell && this.selected && this.selected.moves.some(m => m.file === cell.file && m.rank === cell.rank)) {
      this._setHover(null, cell);
      this.dom.style.cursor = 'pointer';
      return;
    }
    this._setHover(null, cell);
    this.dom.style.cursor = 'default';
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this._onPointerDown);
    this.dom.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.dom.removeEventListener('pointerleave', this._onPointerLeave);
    this.dom.removeEventListener('pointercancel', this._onPointerLeave);
    this.dom.removeEventListener('contextmenu', this._onContextMenu);
  }
}

/** 工具：格子 -> 世界坐标（供外部复用，避免重复 import） */
export function cellToWorld(file, rank) { return toWorld(file, rank); }

export function createInputSystem(cfg) { return new InputSystem(cfg); }

export default InputSystem;
