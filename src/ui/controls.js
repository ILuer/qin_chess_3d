/**
 * controls.js —— 按钮绑定与快捷键
 *
 * 快捷键（同时列在帮助面板里，Windex）：
 *   R 复位视角 · F 翻转视角 · Space 俯视切换 · U / Ctrl+Z 悔棋
 *   M 静音 · N 重新开局 · T 跟随相机开关（棋盘居中 ↔ 棋子居中）· ? 帮助 · Esc 取消选择 / 关闭浮层
 *
 * 破坏性操作（重新开局 / 认输）采用"按钮二次确认"，比 confirm() 更顺滑（Oil）。
 */

const $ = (sel, root = document) => root.querySelector(sel);

/** 二次确认的等待时长（毫秒） */
const CONFIRM_WINDOW = 3200;

export class Controls {
  /**
   * @param {Object} actions
   * @param {Function} actions.restart
   * @param {Function} actions.undo
   * @param {Function} actions.resetView
   * @param {Function} actions.flipView
   * @param {Function} actions.toggleTopView
   * @param {Function} actions.toggleSound
   * @param {Function} actions.toggleAI
   * @param {Function} actions.setDifficulty
   * @param {Function} actions.toggleFollowCamera
   * @param {Function} actions.resign
   * @param {Function} actions.toggleHelp
   * @param {Function} actions.cancelSelection
   */
  constructor(actions = {}) {
    this.actions = actions;
    this._confirmTimers = new Map();
    this._disposers = [];

    this.btnRestart = $('#btn-restart');
    this.btnUndo = $('#btn-undo');
    this.btnFollowCam = $('#btn-follow-cam');   // UI-FIX-123：棋盘居中 ↔ 棋子居中 开关（替换复位视角按钮）
    this.btnFlip = $('#btn-flip');
    this.btnTop = $('#btn-top');
    this.btnSound = $('#btn-sound');
    this.btnAI = $('#btn-ai');
    this.btnResign = $('#btn-resign');
    this.selDifficulty = $('#select-difficulty');

    this._bindButtons();
    this._bindKeys();
  }

  // -------------------------------------------------------------------------

  _on(el, evt, fn) {
    if (!el) return;
    el.addEventListener(evt, fn);
    this._disposers.push(() => el.removeEventListener(evt, fn));
  }

  _call(name, ...args) {
    const fn = this.actions[name];
    if (typeof fn === 'function') return fn(...args);
    return undefined;
  }

  /**
   * 按钮二次确认：第一次点击进入"确认"态，超时自动还原
   */
  _armConfirm(btn, confirmLabel, onConfirm) {
    if (!btn) return;
    if (btn.dataset.armed === '1') {
      this._disarm(btn);
      onConfirm();
      return;
    }
    btn.dataset.armed = '1';
    btn.dataset.originalLabel = btn.textContent;
    btn.textContent = confirmLabel;
    btn.classList.add('is-armed');
    const timer = setTimeout(() => this._disarm(btn), CONFIRM_WINDOW);
    this._confirmTimers.set(btn, timer);
  }

  _disarm(btn) {
    if (!btn || btn.dataset.armed !== '1') return;
    const t = this._confirmTimers.get(btn);
    if (t) { clearTimeout(t); this._confirmTimers.delete(btn); }
    btn.dataset.armed = '0';
    if (btn.dataset.originalLabel) btn.textContent = btn.dataset.originalLabel;
    btn.classList.remove('is-armed');
  }

  /** 取消所有待确认状态 */
  disarmAll() {
    for (const btn of Array.from(this._confirmTimers.keys())) this._disarm(btn);
  }

  // -------------------------------------------------------------------------

  _bindButtons() {
    this._on(this.btnRestart, 'click', () => {
      this._armConfirm(this.btnRestart, '确认重开？', () => this._call('restart'));
    });

    this._on(this.btnResign, 'click', () => {
      this._armConfirm(this.btnResign, '确认认输？', () => this._call('resign'));
    });

    this._on(this.btnUndo, 'click', () => {
      if (this.btnUndo && this.btnUndo.disabled) return;
      this._call('undo');
    });

    // UI-FIX-123：居中开关（棋盘居中 ↔ 棋子居中）替换复位视角按钮；与 T 键同源（main.js toggleFollowCamera）
    this._on(this.btnFollowCam, 'click', () => this._call('toggleFollowCamera'));
    this._on(this.btnFlip, 'click', () => this._call('flipView'));
    this._on(this.btnTop, 'click', () => this._call('toggleTopView'));
    this._on(this.btnSound, 'click', () => this._call('toggleSound'));
    this._on(this.btnAI, 'click', () => this._call('toggleAI'));

    this._on(this.selDifficulty, 'change', ev => {
      this._call('setDifficulty', Number(ev.target.value));
    });
  }

  _bindKeys() {
    const onKey = ev => {
      // 输入框内不拦截
      const tag = (ev.target && ev.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (ev.target && ev.target.isContentEditable)) return;

      // Ctrl+Z 悔棋
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')) {
        ev.preventDefault();
        this._call('undo');
        return;
      }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

      switch (ev.key) {
        case 'r': case 'R':
          ev.preventDefault(); this._call('resetView'); break;
        case 'f': case 'F':
          ev.preventDefault(); this._call('flipView'); break;
        case ' ': case 'Spacebar':
          ev.preventDefault(); this._call('toggleTopView'); break;
        case 'u': case 'U':
          ev.preventDefault(); this._call('undo'); break;
        case 'm': case 'M':
          ev.preventDefault(); this._call('toggleSound'); break;
        case 'n': case 'N':
          ev.preventDefault();
          this._armConfirm(this.btnRestart, '确认重开？', () => this._call('restart'));
          if (!this.btnRestart) this._call('restart');
          break;
        case 't': case 'T':
          ev.preventDefault(); this._call('toggleFollowCamera'); break;
        case '?': case '/':
          ev.preventDefault(); this._call('toggleHelp'); break;
        case 'Escape':
          ev.preventDefault();
          this.disarmAll();
          // UI-FIX-123：Esc 优先关闭规则浮层；否则取消选择
          if (this.actions.toggleHelp) this._call('toggleHelp', false);
          this._call('cancelSelection');
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    this._disposers.push(() => window.removeEventListener('keydown', onKey));
  }

  // -------------------------------------------------------------------------
  // 状态同步
  // -------------------------------------------------------------------------

  setUndoEnabled(on) {
    if (!this.btnUndo) return;
    this.btnUndo.disabled = !on;
    this.btnUndo.classList.toggle('is-disabled', !on);
  }

  setResignEnabled(on) {
    if (!this.btnResign) return;
    this.btnResign.disabled = !on;
    this.btnResign.classList.toggle('is-disabled', !on);
  }

  setSoundState(on) {
    if (!this.btnSound) return;
    this.btnSound.classList.toggle('is-off', !on);
    this.btnSound.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = this.btnSound.querySelector('.btn-label') || this.btnSound;
    label.textContent = on ? '音效 开' : '音效 关';
  }

  setAIState(on, difficulty) {
    if (this.btnAI) {
      this.btnAI.classList.toggle('is-on', !!on);
      this.btnAI.setAttribute('aria-pressed', on ? 'true' : 'false');
      const label = this.btnAI.querySelector('.btn-label') || this.btnAI;
      label.textContent = on ? '人机 开' : '人机 关';
    }
    if (this.selDifficulty) {
      this.selDifficulty.disabled = !on;
      if (difficulty != null) this.selDifficulty.value = String(difficulty);
      const wrap = this.selDifficulty.closest('.control-field');
      if (wrap) wrap.classList.toggle('is-disabled', !on);
    }
  }

  setTopViewState(on) {
    if (!this.btnTop) return;
    this.btnTop.classList.toggle('is-on', !!on);
    const label = this.btnTop.querySelector('.btn-label') || this.btnTop;
    label.textContent = on ? '斜视视角' : '俯视视角';
  }

  /**
   * 跟随相机开关状态（UI-FIX-123：棋盘居中 ↔ 棋子居中）。
   * 由 main.js syncControls() 统一同步 —— T 键与按钮共用同一状态源。
   * @param {boolean} on 跟随相机开启 → 「棋子居中」；关闭 → 「棋盘居中」
   */
  setFollowCamState(on) {
    if (!this.btnFollowCam) return;
    this.btnFollowCam.classList.toggle('is-on', !!on);
    this.btnFollowCam.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = this.btnFollowCam.querySelector('.btn-label') || this.btnFollowCam;
    label.textContent = on ? '棋子居中' : '棋盘居中';
  }

  setFlipState(side) {
    if (!this.btnFlip) return;
    const label = this.btnFlip.querySelector('.btn-label') || this.btnFlip;
    label.textContent = side === 'b' ? '红方视角' : '黑方视角';
  }

  /** 全局禁用（动画 / AI 思考中） */
  setBusy(busy) {
    const els = [this.btnRestart, this.btnUndo, this.btnResign, this.btnAI, this.selDifficulty];
    for (const el of els) {
      if (!el) continue;
      el.classList.toggle('is-busy', !!busy);
    }
  }

  dispose() {
    for (const d of this._disposers) d();
    this._disposers.length = 0;
    this.disarmAll();
  }
}

export function createControls(actions) { return new Controls(actions); }

export default Controls;
