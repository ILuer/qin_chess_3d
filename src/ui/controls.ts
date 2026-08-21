/**
 * controls.js —— 按钮绑定与快捷键
 *
 * 快捷键（同时列在帮助面板里，Windex）：
 *   R 复位视角 · F 翻转视角 · Space 俯视切换 · U / Ctrl+Z 悔棋
 *   M 静音 · N 重新开局 · T 跟随相机开关（棋盘居中 ↔ 棋子居中）· ? 帮助 · Esc 取消选择 / 关闭浮层
 *
 * 破坏性操作（重新开局 / 认输）采用"按钮二次确认"，比 confirm() 更顺滑（Oil）。
 */

const $ = (sel: string, root: Document = document): HTMLElement | null => root.querySelector(sel);

/** 二次确认的等待时长（毫秒） */
const CONFIRM_WINDOW = 3200;

export class Controls {
  actions: Record<string, any>;
  _confirmTimers: Map<HTMLElement, ReturnType<typeof setTimeout>>;
  _disposers: Array<() => void>;
  btnRestart: any;
  btnUndo: any;
  btnFollowCam: any;
  btnFlip: any;
  btnTop: any;
  btnSound: any;
  btnAmbient: any;
  btnAI: any;
  btnResign: any;
  selDifficulty: any;

  /**
   * @param {Object} actions
   * @param {Function} actions.restart
   * @param {Function} actions.undo
   * @param {Function} actions.resetView
   * @param {Function} actions.flipView
   * @param {Function} actions.toggleTopView
 * @param {Function} actions.toggleSound
 * @param {Function} actions.toggleAmbient
 * @param {Function} actions.toggleAI
   * @param {Function} actions.setDifficulty
   * @param {Function} actions.toggleFollowCamera
   * @param {Function} actions.resign
   * @param {Function} actions.toggleHelp
   * @param {Function} actions.cancelSelection
   * @param {Function} [actions.isReviewActive] 复盘模式判定（L2：键位分流）
   * @param {Function} [actions.reviewFirst] 复盘：跳到开头
   * @param {Function} [actions.reviewPrev] 复盘：上一步
   * @param {Function} [actions.reviewNext] 复盘：下一步
   * @param {Function} [actions.reviewLast] 复盘：跳到结尾
   * @param {Function} [actions.reviewTogglePlay] 复盘：自动播放开/关
   * @param {Function} [actions.reviewExit] 复盘：退出
   */
  constructor(actions: Record<string, any> = {}) {
    this.actions = actions;
    this._confirmTimers = new Map();
    this._disposers = [];

    this.btnRestart = $('#btn-restart');
    this.btnUndo = $('#btn-undo');
    this.btnFollowCam = $('#btn-follow-cam');   // UI-FIX-123：棋盘居中 ↔ 棋子居中 开关（替换复位视角按钮）
    this.btnFlip = $('#btn-flip');
    this.btnTop = $('#btn-top');
    this.btnSound = $('#btn-sound');
    this.btnAmbient = $('#btn-ambient');
    this.btnAI = $('#btn-ai');
    this.btnResign = $('#btn-resign');
    this.selDifficulty = $('#select-difficulty');

    this._bindButtons();
    this._bindKeys();
  }

  // -------------------------------------------------------------------------

  _on(el: HTMLElement | null, evt: string, fn: (ev: Event) => void): void {
    if (!el) return;
    el.addEventListener(evt, fn);
    this._disposers.push(() => el.removeEventListener(evt, fn));
  }

  _call(name: string, ...args: unknown[]): unknown {
    const fn = this.actions[name];
    if (typeof fn === 'function') return fn(...args);
    return undefined;
  }

  /**
   * 按钮二次确认：第一次点击进入"确认"态，超时自动还原
   */
  _armConfirm(btn: HTMLElement | null, confirmLabel: string, onConfirm: () => void): void {
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

  _disarm(btn: HTMLElement | null): void {
    if (!btn || btn.dataset.armed !== '1') return;
    const t = this._confirmTimers.get(btn);
    if (t) { clearTimeout(t); this._confirmTimers.delete(btn); }
    btn.dataset.armed = '0';
    if (btn.dataset.originalLabel) btn.textContent = btn.dataset.originalLabel;
    btn.classList.remove('is-armed');
  }

  /** 取消所有待确认状态 */
  disarmAll(): void {
    for (const btn of Array.from(this._confirmTimers.keys())) this._disarm(btn);
  }

  // -------------------------------------------------------------------------

  _bindButtons(): void {
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
    this._on(this.btnAmbient, 'click', () => this._call('toggleAmbient'));
    this._on(this.btnAI, 'click', () => this._call('toggleAI'));

    this._on(this.selDifficulty, 'change', (ev: Event) => {
      this._call('setDifficulty', Number((ev.target as HTMLSelectElement).value));
    });
  }

  _bindKeys(): void {
    const onKey = (ev: KeyboardEvent) => {
      // 输入框内不拦截
      const tgt = ev.target as HTMLElement | null;
      const tag = (tgt && tgt.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (tgt && tgt.isContentEditable)) return;

      // L2：复盘内快捷键分流（design §5.6）——←→⏮⏭ Space Esc 语义覆盖，仅在 reviewActive 生效；
      // 其余键（R/F/M/T/?/U/N 等）继续走正常绑定（破坏性操作由 main 侧先退出复盘再执行）
      const inReview = !!(this.actions.isReviewActive && this.actions.isReviewActive());
      const plain = !(ev.ctrlKey || ev.metaKey || ev.altKey);
      if (inReview && plain) {
        if (ev.key === 'ArrowLeft' && ev.shiftKey) { ev.preventDefault(); this._call('reviewFirst'); return; }
        if (ev.key === 'ArrowRight' && ev.shiftKey) { ev.preventDefault(); this._call('reviewLast'); return; }
        switch (ev.key) {
          case 'ArrowLeft':  ev.preventDefault(); this._call('reviewPrev'); return;
          case 'ArrowRight': ev.preventDefault(); this._call('reviewNext'); return;
          case 'Home': ev.preventDefault(); this._call('reviewFirst'); return;
          case 'End':   ev.preventDefault(); this._call('reviewLast'); return;
          case ' ': case 'Spacebar': ev.preventDefault(); this._call('reviewTogglePlay'); return;
          case 'Escape':
            ev.preventDefault();
            this.disarmAll();
            this._call('reviewExit');
            return;
          default: break;
        }
      }

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

  setUndoEnabled(on: boolean): void {
    if (!this.btnUndo) return;
    this.btnUndo.disabled = !on;
    this.btnUndo.classList.toggle('is-disabled', !on);
  }

  setResignEnabled(on: boolean): void {
    if (!this.btnResign) return;
    this.btnResign.disabled = !on;
    this.btnResign.classList.toggle('is-disabled', !on);
  }

  setSoundState(on: boolean): void {
    if (!this.btnSound) return;
    this.btnSound.classList.toggle('is-off', !on);
    this.btnSound.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = this.btnSound.querySelector('.btn-label') || this.btnSound;
    label.textContent = on ? '音效 开' : '音效 关';
  }

  setAmbientState(on: boolean): void {
    if (!this.btnAmbient) return;
    this.btnAmbient.classList.toggle('is-off', !on);
    this.btnAmbient.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = this.btnAmbient.querySelector('.btn-label') || this.btnAmbient;
    label.textContent = on ? '环境 开' : '环境 关';
  }

  setAIState(on: boolean, difficulty?: number): void {
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

  /**
   * D10：大师档（value=4）仅 AI worker 模式开放。
   * 主线程时间切片模式下禁用该选项（灰显不可选），避免选中后卡死页面。
   * @param {boolean} available worker 模式可用
   */
  setMasterAvailable(available: boolean): void {
    if (!this.selDifficulty) return;
    const opt = this.selDifficulty.querySelector('option[value="4"]');
    if (!opt) return;
    opt.disabled = !available;
    opt.classList.toggle('is-gated', !available);
  }

  setTopViewState(on: boolean): void {
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
  setFollowCamState(on: boolean): void {
    if (!this.btnFollowCam) return;
    this.btnFollowCam.classList.toggle('is-on', !!on);
    this.btnFollowCam.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = this.btnFollowCam.querySelector('.btn-label') || this.btnFollowCam;
    label.textContent = on ? '棋子居中' : '棋盘居中';
  }

  setFlipState(side: string): void {
    if (!this.btnFlip) return;
    const label = this.btnFlip.querySelector('.btn-label') || this.btnFlip;
    label.textContent = side === 'b' ? '红方视角' : '黑方视角';
  }

  /** 全局禁用（动画 / AI 思考中） */
  setBusy(busy: boolean): void {
    const els = [this.btnRestart, this.btnUndo, this.btnResign, this.btnAI, this.selDifficulty];
    for (const el of els) {
      if (!el) continue;
      el.classList.toggle('is-busy', !!busy);
    }
  }

  dispose(): void {
    for (const d of this._disposers) d();
    this._disposers.length = 0;
    this.disarmAll();
  }
}

export function createControls(actions: Record<string, any>): Controls { return new Controls(actions); }

export default Controls;
