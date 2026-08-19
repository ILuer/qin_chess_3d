/**
 * hud.js —— DOM 层界面：回合指示 / 将军横幅 / 走子记录 / 吃子陈列 /
 *            toast / 结束面板 / 帮助面板 / 加载进度
 *
 * 所有 DOM 查询都做空值保护：即使某个节点缺失也不会让游戏崩溃。
 * class / id 命名严格遵循契约第 5 节与 index.html。
 */

import {
  RED, BLACK, SIDE_NAMES, PIECE_NAMES, PALETTE, TIMING, PT
} from '../core/constants.ts';

const $ = (sel: string, root: Document = document): any => root.querySelector(sel);
const $$ = (sel: string, root: Document = document): any[] => Array.from(root.querySelectorAll(sel));

/** 规则速查（Windex：一句话说清每个子怎么走） */
export const RULE_CHEATSHEET = [
  ['帥 / 將', '九宫内每次走一步直线，不能出九宫；双方将帅不可在同一纵线上直接照面（白脸将）。'],
  ['仕 / 士', '九宫内每次走一步斜线，不能出九宫。'],
  ['相 / 象', '走"田"字（斜走两格），田字中心有子则被"塞象眼"，且永远不可过河。'],
  ['馬', '走"日"字，若移动方向的相邻格有子则被"蹩马腿"，此方向不可走。'],
  ['俥 / 車', '直线任意步，路径上不能有任何棋子。'],
  ['炮 / 砲', '不吃子时走法同车；吃子时中间必须**恰好隔一个棋子**（炮架）。'],
  ['兵 / 卒', '过河前只能向前一步；过河后可向前或左右横走一步；任何时候都不能后退。']
];

/** 快捷键说明 */
export const SHORTCUTS = [
  ['R', '复位视角'],
  ['F', '翻转红黑视角'],
  ['Space', '俯视 / 斜视切换'],
  ['U 或 Ctrl+Z', '悔棋'],
  ['M', '音效开关'],
  ['N', '重新开局'],
  ['T', '棋盘居中 / 棋子居中（跟随相机开关）'],
  ['?', '打开 / 关闭本帮助'],
  ['Esc', '取消当前选择']
];

/** L2：复盘模式快捷键（design/gameplay/review-export-design.md §5.6，追加到帮助面板） */
export const REVIEW_SHORTCUTS = [
  ['← / →', '复盘：上一 / 下一步'],
  ['Shift+← / Shift+→ 或 Home / End', '复盘：跳到开始 / 结尾'],
  ['Space', '复盘：自动播放 开 / 关'],
  ['Esc', '复盘：退出复盘']
];

export class HUD {
  opts: Record<string, any>;
  loadingScreen: any;
  loadingFill: any;
  loadingText: any;
  loadingError: any;
  hud: any;
  turnIndicator: any;
  turnSwatch: any;
  turnLabel: any;
  turnMeta: any;
  checkBanner: any;
  moveLog: any;
  moveLogList: any;
  moveLogEmpty: any;
  moveLogCollapse: any;
  btnReview: any;
  btnExport: any;
  exportPanel: any;
  btnExportClose: any;
  tabUcci: any;
  tabChinese: any;
  exportUcciPre: any;
  exportChinesePre: any;
  btnCopy: any;
  btnDownload: any;
  reviewBar: any;
  reviewCursor: any;
  rvFirst: any;
  rvPrev: any;
  rvNext: any;
  rvLast: any;
  rvPlay: any;
  rvInterval: any;
  rvExit: any;
  btnReviewGameOver: any;
  _exportTab: string;
  capturedRed: any;
  capturedBlack: any;
  toastContainer: any;
  gameOver: any;
  gameOverTitle: any;
  gameOverDetail: any;
  gameOverStats: any;
  btnAgain: any;
  helpPanel: any;
  helpToggle: any;
  helpContent: any;
  helpClose: any;
  helpBackdrop: any;
  _toasts: Array<{ el: HTMLElement, timer: ReturnType<typeof setTimeout> }>;
  _timerStart: number;
  _timerRunning: boolean;
  _lastTurnSide: string | null;

  constructor(opts: Record<string, any> = {}) {
    this.opts = opts;

    // —— 加载 ——
    this.loadingScreen = $('#loading-screen');
    this.loadingFill = $('#loading-screen .loading-fill');
    this.loadingText = $('#loading-screen .loading-text');
    this.loadingError = $('#loading-screen .loading-error');

    // —— HUD ——
    this.hud = $('#hud');
    this.turnIndicator = $('.turn-indicator');
    this.turnSwatch = $('.turn-indicator .turn-swatch');
    this.turnLabel = $('.turn-indicator .turn-label');
    this.turnMeta = $('.turn-indicator .turn-meta');
    this.checkBanner = $('.check-banner');

    // —— 走子记录 ——
    this.moveLog = $('#move-log');
    this.moveLogList = $('.move-log-list');
    this.moveLogEmpty = $('.move-log-empty');
    this.moveLogCollapse = $('.move-log-collapse');   // UI-FIX-123：可折叠（移动端不遮棋盘）

    // —— L2 复盘 / 导出 ——
    this.btnReview = $('#btn-review');
    this.btnExport = $('#btn-export');
    this.exportPanel = $('#export-panel');
    this.btnExportClose = $('#btn-export-close');
    this.tabUcci = $('#tab-ucci');
    this.tabChinese = $('#tab-chinese');
    this.exportUcciPre = $('#export-ucci');
    this.exportChinesePre = $('#export-chinese');
    this.btnCopy = $('#btn-copy');
    this.btnDownload = $('#btn-download');
    this.reviewBar = $('#review-bar');
    this.reviewCursor = $('#rv-cursor');
    this.rvFirst = $('#rv-first');
    this.rvPrev = $('#rv-prev');
    this.rvNext = $('#rv-next');
    this.rvLast = $('#rv-last');
    this.rvPlay = $('#rv-play');
    this.rvInterval = $('#rv-interval');
    this.rvExit = $('#rv-exit');
    this.btnReviewGameOver = $('#btn-review-gameover');
    this._exportTab = 'ucci';

    // —— 吃子陈列 ——
    this.capturedRed = $('.captured-red');
    this.capturedBlack = $('.captured-black');

    // —— toast ——
    this.toastContainer = $('#toast-container');

    // —— 结束面板 ——
    this.gameOver = $('#game-over');
    this.gameOverTitle = $('.game-over-title');
    this.gameOverDetail = $('.game-over-detail');
    this.gameOverStats = $('.game-over-stats');
    this.btnAgain = $('#btn-again');

    // —— 帮助 ——
    this.helpPanel = $('.help-panel');
    this.helpToggle = $('.help-toggle');
    this.helpContent = $('.help-content');
    this.helpClose = $('.help-close');        // UI-FIX-123：规则浮层关闭按钮
    this.helpBackdrop = $('.help-backdrop');  // UI-FIX-123：点击遮罩关闭

    this._toasts = [];
    this._timerStart = 0;
    this._timerRunning = false;
    this._lastTurnSide = null;

    this._bind();
    this.renderHelp();
    // 移动端默认折叠对局记录，避免遮挡核心棋盘（UI-FIX-123）
    if (typeof matchMedia === 'function' && matchMedia('(max-width: 768px)').matches) {
      this.toggleMoveLog(true);
    }
  }

  _bind(): void {
    if (this.helpToggle) {
      this.helpToggle.addEventListener('click', () => this.toggleHelp());
    }
    if (this.helpClose) {
      this.helpClose.addEventListener('click', () => this.toggleHelp(false));
    }
    if (this.helpBackdrop) {
      this.helpBackdrop.addEventListener('click', () => this.toggleHelp(false));
    }
    if (this.moveLogCollapse) {
      this.moveLogCollapse.addEventListener('click', () => this.toggleMoveLog());
    }
    if (this.btnAgain) {
      this.btnAgain.addEventListener('click', () => {
        this.hideGameOver();
        if (this.opts.onRestart) this.opts.onRestart();
      });
    }
    const closeBtn = $('#game-over .game-over-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideGameOver());

    if (this.moveLogList) {
      this.moveLogList.addEventListener('click', (ev: Event) => {
        const cell = (ev.target as HTMLElement).closest('[data-move-index]') as HTMLElement | null;
        if (!cell) return;
        const idx = Number(cell.dataset.moveIndex);
        if (Number.isNaN(idx) || idx < 0) return;
        if (this.opts.onPreviewMove) this.opts.onPreviewMove(idx);
      });
      // L2：双击着法 → 进入复盘到该步（或复盘内跳转）
      this.moveLogList.addEventListener('dblclick', (ev: Event) => {
        const cell = (ev.target as HTMLElement).closest('[data-move-index]') as HTMLElement | null;
        if (!cell) return;
        const idx = Number(cell.dataset.moveIndex);
        if (Number.isNaN(idx) || idx < 0) return;
        if (this.opts.onMoveLogDblClick) this.opts.onMoveLogDblClick(idx);
      });
    }

    // —— L2：棋谱导出 ——
    if (this.btnExport) {
      this.btnExport.addEventListener('click', () => { if (this.opts.onExport) this.opts.onExport(); });
    }
    if (this.btnExportClose) {
      this.btnExportClose.addEventListener('click', () => this.closeExportPanel());
    }
    if (this.tabUcci) {
      this.tabUcci.addEventListener('click', () => this.setExportTab('ucci'));
    }
    if (this.tabChinese) {
      this.tabChinese.addEventListener('click', () => this.setExportTab('chinese'));
    }
    if (this.btnCopy) {
      this.btnCopy.addEventListener('click', () => {
        if (this._exportPanelOpen()) this.copyText(this.getExportText());
      });
    }
    if (this.btnDownload) {
      this.btnDownload.addEventListener('click', () => {
        if (this._exportPanelOpen()) this.downloadText(this.getExportText(), this._exportFilename());
      });
    }

    // —— L2：复盘控制条 ——
    const reviewBind = (el: any, action: string) => {
      if (!el) return;
      el.addEventListener('click', () => { if (this.opts[action]) this.opts[action](); });
    };
    reviewBind(this.rvFirst, 'onReviewFirst');
    reviewBind(this.rvPrev, 'onReviewPrev');
    reviewBind(this.rvNext, 'onReviewNext');
    reviewBind(this.rvLast, 'onReviewLast');
    reviewBind(this.rvPlay, 'onReviewTogglePlay');
    reviewBind(this.rvExit, 'onReviewExit');
    if (this.rvInterval) {
      this.rvInterval.addEventListener('change', (ev: Event) => {
        if (this.opts.onReviewInterval) this.opts.onReviewInterval(Number((ev.target as HTMLSelectElement).value));
      });
    }
    if (this.btnReviewGameOver) {
      this.btnReviewGameOver.addEventListener('click', () => {
        if (this.opts.onReviewEnter) this.opts.onReviewEnter();
      });
    }
    // L2：move-log 头部「复盘」按钮
    if (this.btnReview) {
      this.btnReview.addEventListener('click', () => { if (this.opts.onReviewEnter) this.opts.onReviewEnter(); });
    }
  }

  // -------------------------------------------------------------------------
  // 加载界面
  // -------------------------------------------------------------------------

  /**
   * @param {number} pct 0..1
   * @param {string} [text]
   */
  setLoadingProgress(pct: number, text?: string): void {
    const p = Math.max(0, Math.min(1, pct));
    if (this.loadingFill) this.loadingFill.style.width = (p * 100).toFixed(1) + '%';
    if (text && this.loadingText) this.loadingText.textContent = text;
  }

  /** 淡出加载界面 */
  hideLoading(delay = 260): Promise<void> {
    if (!this.loadingScreen) return Promise.resolve();
    return new Promise(resolve => {
      setTimeout(() => {
        this.loadingScreen.classList.add('is-hidden');
        setTimeout(() => {
          if (this.loadingScreen) this.loadingScreen.style.display = 'none';
          resolve();
        }, 700);
      }, delay);
    });
  }

  /** 在加载界面显示可读错误（替代白屏） */
  showFatalError(message: string, detail?: string): void {
    if (this.loadingScreen) {
      this.loadingScreen.style.display = '';
      this.loadingScreen.classList.remove('is-hidden');
      this.loadingScreen.classList.add('has-error');
    }
    if (this.loadingText) this.loadingText.textContent = message || '初始化失败';
    if (this.loadingFill) this.loadingFill.style.width = '100%';
    if (this.loadingError) {
      this.loadingError.style.display = 'block';
      this.loadingError.textContent = detail || '';
    } else if (this.loadingScreen) {
      const p = document.createElement('pre');
      p.className = 'loading-error';
      p.textContent = detail || '';
      this.loadingScreen.appendChild(p);
    }
  }

  // -------------------------------------------------------------------------
  // 回合 / 将军
  // -------------------------------------------------------------------------

  /**
   * @param {'r'|'b'} side
   * @param {{aiThinking?:boolean, moveNumber?:number}} [info]
   */
  setTurn(side: string, info: { aiThinking?: boolean, moveNumber?: number } = {}): void {
    if (this.turnIndicator) {
      this.turnIndicator.classList.toggle('is-red', side === RED);
      this.turnIndicator.classList.toggle('is-black', side === BLACK);
      if (this._lastTurnSide !== side) {
        this.turnIndicator.classList.remove('turn-flip');
        // 强制重排以重启动画
        void this.turnIndicator.offsetWidth;
        this.turnIndicator.classList.add('turn-flip');
        this._lastTurnSide = side;
      }
    }
    if (this.turnSwatch) {
      this.turnSwatch.style.background = side === RED ? PALETTE.CSS.chiHongLight : PALETTE.CSS.xuanHei;
      this.turnSwatch.style.boxShadow = side === RED
        ? `0 0 12px ${PALETTE.CSS.chiHongLight}`
        : `0 0 12px ${PALETTE.CSS.qingTong}`;
    }
    if (this.turnLabel) {
      this.turnLabel.textContent = info.aiThinking ? `${SIDE_NAMES[side]}思考中…` : `${SIDE_NAMES[side]}走棋`;
    }
    if (this.turnMeta && info.moveNumber != null) {
      this.turnMeta.textContent = `第 ${info.moveNumber} 回合`;
    }
  }

  /**
   * 将军横幅
   * @param {boolean} on
   * @param {'r'|'b'} [side] 被将军的一方
   */
  setCheck(on: boolean, side?: string): void {
    if (!this.checkBanner) return;
    this.checkBanner.classList.toggle('is-visible', !!on);
    if (on) {
      this.checkBanner.textContent = side ? `将 军 ！${SIDE_NAMES[side]}被将` : '将 军 ！';
      this.checkBanner.setAttribute('aria-hidden', 'false');
    } else {
      this.checkBanner.setAttribute('aria-hidden', 'true');
    }
  }

  // -------------------------------------------------------------------------
  // 走子记录
  // -------------------------------------------------------------------------

  /**
   * @param {Array<{no:number, red:string, black:string, redIndex:number, blackIndex:number}>} rows
   * @param {number} [activeIndex] 高亮的半回合下标
   */
  renderMoveLog(rows: Array<{ no: number, red: string, black: string, redIndex: number, blackIndex: number }>, activeIndex = -1): void {
    if (!this.moveLogList) return;
    if (this.moveLogEmpty) this.moveLogEmpty.style.display = rows.length ? 'none' : '';
    // L2：有历史才可复盘 / 导出
    const hasMoves = rows.length > 0;
    if (this.btnExport) this.btnExport.disabled = !hasMoves;
    if (this.btnReview) this.btnReview.disabled = !hasMoves;
    const html = rows.map(r => {
      const redActive = r.redIndex === activeIndex ? ' is-active' : '';
      const blackActive = r.blackIndex === activeIndex ? ' is-active' : '';
      const black = r.black
        ? `<span class="move-cell move-black${blackActive}" data-move-index="${r.blackIndex}">${escapeHtml(r.black)}</span>`
        : '<span class="move-cell move-black is-empty">—</span>';
      return `<li class="move-row">
        <span class="move-no">${r.no}</span>
        <span class="move-cell move-red${redActive}" data-move-index="${r.redIndex}">${escapeHtml(r.red)}</span>
        ${black}
      </li>`;
    }).join('');
    this.moveLogList.innerHTML = html;
    // 自动滚到底
    const scroller = this.moveLog && this.moveLog.querySelector('.move-log-scroll') || this.moveLogList;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  /** 吃子陈列 */
  renderCaptured(captured: any): void {
    const fill = (el: any, list: any) => {
      if (!el) return;
      if (!list || !list.length) { el.innerHTML = '<span class="captured-none">—</span>'; return; }
      const order = [PT.ROOK, PT.CANNON, PT.HORSE, PT.ELEPHANT, PT.ADVISOR, PT.PAWN, PT.KING];
      const sorted = list.slice().sort((a: any, b: any) => order.indexOf(a.type) - order.indexOf(b.type));
      el.innerHTML = sorted.map((p: any) =>
        `<span class="captured-chip ${p.side === RED ? 'is-red' : 'is-black'}">${PIECE_NAMES[p.side]?.[p.type] ?? ''}</span>`
      ).join('');
    };
    // captured[RED] = 被吃掉的红子
    fill(this.capturedRed, captured && captured[RED]);
    fill(this.capturedBlack, captured && captured[BLACK]);
  }

  // -------------------------------------------------------------------------
  // 计时
  // -------------------------------------------------------------------------

  startTimer(): void { this._timerStart = performance.now(); this._timerRunning = true; }
  stopTimer(): void { this._timerRunning = false; }

  updateTimer(): void {
    if (!this._timerRunning) return;
    const el = $('.hud-timer');
    if (!el) return;
    const s = Math.floor((performance.now() - this._timerStart) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    el.textContent = `${mm}:${ss}`;
  }

  // -------------------------------------------------------------------------
  // Toast
  // -------------------------------------------------------------------------

  /**
   * @param {string} msg
   * @param {'info'|'warn'|'error'|'success'|'check'} [type]
   * @param {number} [life] 秒
   */
  showToast(msg: string, type: string = 'info', life: number = TIMING.toastLife): HTMLElement | null {
    if (!msg) return null;
    const container = this.toastContainer || document.body;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', 'status');
    el.textContent = msg;
    container.appendChild(el);
    // 触发入场动画
    requestAnimationFrame(() => el.classList.add('is-in'));

    const timer = setTimeout(() => {
      el.classList.remove('is-in');
      el.classList.add('is-out');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 420);
    }, life * 1000);

    // 最多同时 4 条
    this._toasts.push({ el, timer });
    while (this._toasts.length > 4) {
      const old = this._toasts.shift()!;
      clearTimeout(old.timer);
      if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
    return el;
  }

  clearToasts(): void {
    for (const t of this._toasts) {
      clearTimeout(t.timer);
      if (t.el.parentNode) t.el.parentNode.removeChild(t.el);
    }
    this._toasts.length = 0;
  }

  // -------------------------------------------------------------------------
  // 结束面板
  // -------------------------------------------------------------------------

  /**
   * @param {{title:string, detail:string, stats?:Array<[string,string]>, tone?:'win'|'lose'|'draw'}} info
   */
  showGameOver(info: any): void {
    if (!this.gameOver) return;
    if (this.gameOverTitle) this.gameOverTitle.textContent = info.title || '对局结束';
    if (this.gameOverDetail) this.gameOverDetail.textContent = info.detail || '';
    if (this.gameOverStats) {
      this.gameOverStats.innerHTML = (info.stats || [])
        .map(([k, v]: [string, string]) => `<div class="stat-row"><span class="stat-k">${escapeHtml(k)}</span><span class="stat-v">${escapeHtml(v)}</span></div>`)
        .join('');
    }
    this.gameOver.classList.remove('tone-win', 'tone-lose', 'tone-draw');
    if (info.tone) this.gameOver.classList.add(`tone-${info.tone}`);
    this.gameOver.classList.add('is-visible');
    this.gameOver.setAttribute('aria-hidden', 'false');
  }

  hideGameOver(): void {
    if (!this.gameOver) return;
    this.gameOver.classList.remove('is-visible');
    this.gameOver.setAttribute('aria-hidden', 'true');
  }

  // -------------------------------------------------------------------------
  // 帮助面板
  // -------------------------------------------------------------------------

  renderHelp(): void {
    if (!this.helpContent) return;
    const rules = RULE_CHEATSHEET.map(([name, desc]) =>
      `<div class="help-rule"><span class="help-piece">${escapeHtml(name)}</span><span class="help-desc">${(desc ?? '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</span></div>`
    ).join('');
    const keys = SHORTCUTS.map(([k, d]) =>
      `<div class="help-key-row"><kbd>${escapeHtml(k)}</kbd><span>${escapeHtml(d)}</span></div>`
    ).join('');
    // L2：复盘模式快捷键（design §5.6）
    const reviewKeys = REVIEW_SHORTCUTS.map(([k, d]) =>
      `<div class="help-key-row"><kbd>${escapeHtml(k)}</kbd><span>${escapeHtml(d)}</span></div>`
    ).join('');
    this.helpContent.innerHTML = `
      <section class="help-section">
        <h3 class="help-title">走子规则速查</h3>
        ${rules}
      </section>
      <section class="help-section">
        <h3 class="help-title">界面提示</h3>
        <div class="help-rule"><span class="help-piece">绿色光圈</span><span class="help-desc">可以落子的空点</span></div>
        <div class="help-rule"><span class="help-piece">红色准星</span><span class="help-desc">可以吃掉的敌方棋子</span></div>
        <div class="help-rule"><span class="help-piece">灰色叉号</span><span class="help-desc">因蹩马腿 / 塞象眼 / 不可过河而走不到的点</span></div>
        <div class="help-rule"><span class="help-piece">蓝金方框</span><span class="help-desc">上一步的起点与终点</span></div>
        <div class="help-rule"><span class="help-piece">红色脉冲环</span><span class="help-desc">正在被将军的将 / 帅</span></div>
      </section>
      <section class="help-section">
        <h3 class="help-title">快捷键</h3>
        ${keys}
      </section>
      <section class="help-section">
        <h3 class="help-title">复盘模式</h3>
        ${reviewKeys}
        <div class="help-rule"><span class="help-piece">入口</span><span class="help-desc">move-log「复盘」按钮，或双击某步着法；结束面板「复盘本局」</span></div>
        <div class="help-rule"><span class="help-piece">说明</span><span class="help-desc">复盘期间输入与 AI 冻结，Esc 退出后原样恢复</span></div>
      </section>
      <section class="help-section">
        <h3 class="help-title">操作方式</h3>
        <div class="help-rule"><span class="help-piece">选子</span><span class="help-desc">单击己方棋子，再单击目标点落子（无需拖拽）</span></div>
        <div class="help-rule"><span class="help-piece">换选</span><span class="help-desc">直接点击己方另一枚棋子即可切换</span></div>
        <div class="help-rule"><span class="help-piece">视角</span><span class="help-desc">按住拖动旋转，滚轮缩放</span></div>
      </section>`;
  }

  toggleHelp(force?: boolean): boolean {
    if (!this.helpPanel) return false;
    const open = force != null ? force : !this.helpPanel.classList.contains('is-open');
    this.helpPanel.classList.toggle('is-open', open);
    this.helpPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (this.helpToggle) this.helpToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    // UI-FIX-123：遮罩随浮层显隐；关闭后清理焦点，保证再打开状态干净
    if (this.helpBackdrop) this.helpBackdrop.classList.toggle('is-open', open);
    if (!open && document.activeElement && this.helpClose &&
        (document.activeElement === this.helpClose || document.activeElement === this.helpToggle)) {
      (document.activeElement as HTMLElement).blur();
    }
    return open;
  }

  /**
   * 对局记录折叠 / 展开（UI-FIX-123：移动端不遮挡棋盘）。
   * @param {boolean} [force]
   * @returns {boolean} 折叠后是否为 collapsed
   */
  toggleMoveLog(force?: boolean): boolean {
    if (!this.moveLog) return false;
    const collapsed = force != null ? !!force : !this.moveLog.classList.contains('is-collapsed');
    this.moveLog.classList.toggle('is-collapsed', collapsed);
    if (this.moveLogCollapse) this.moveLogCollapse.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    return collapsed;
  }

  // -------------------------------------------------------------------------
  // L2 · 棋谱导出面板（design §4：双 Tab + 复制/下载）
  // -------------------------------------------------------------------------

  /** 切换导出面板 Tab（ucci / chinese），并同步内容显隐 */
  setExportTab(tab: string): void {
    this._exportTab = tab === 'chinese' ? 'chinese' : 'ucci';
    const isUcci = this._exportTab === 'ucci';
    if (this.tabUcci) {
      this.tabUcci.classList.toggle('is-active', isUcci);
      this.tabUcci.setAttribute('aria-selected', isUcci ? 'true' : 'false');
    }
    if (this.tabChinese) {
      this.tabChinese.classList.toggle('is-active', !isUcci);
      this.tabChinese.setAttribute('aria-selected', !isUcci ? 'true' : 'false');
    }
    if (this.exportUcciPre) this.exportUcciPre.classList.toggle('is-active', isUcci);
    if (this.exportChinesePre) this.exportChinesePre.classList.toggle('is-active', !isUcci);
  }

  /**
   * 打开导出面板并填充内容（导出始终为完整对局；复盘游标不影响导出内容）。
   * @param {{ucci:string, chinese:string}} data
   */
  openExportPanel({ ucci, chinese }: { ucci: string, chinese: string }): boolean {
    if (!this.exportPanel) return false;
    if (this.exportUcciPre) this.exportUcciPre.textContent = ucci || '';
    if (this.exportChinesePre) this.exportChinesePre.textContent = chinese || '';
    this.exportPanel.classList.add('is-visible');
    this.exportPanel.setAttribute('aria-hidden', 'false');
    this.setExportTab('ucci');
    return true;
  }

  closeExportPanel(): void {
    if (!this.exportPanel) return;
    this.exportPanel.classList.remove('is-visible');
    this.exportPanel.setAttribute('aria-hidden', 'true');
  }

  _exportPanelOpen(): boolean {
    return !!(this.exportPanel && this.exportPanel.classList.contains('is-visible'));
  }

  /** 当前 Tab 的棋谱文本 */
  getExportText(): string {
    const pre = this._exportTab === 'ucci' ? this.exportUcciPre : this.exportChinesePre;
    return pre ? pre.textContent : '';
  }

  /** 下载文件名：秦风棋谱_YYYYMMDD_HHmmss_格式.txt */
  _exportFilename(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `秦风棋谱_${stamp}_${this._exportTab === 'ucci' ? 'UCCI' : '中文'}.txt`;
  }

  /**
   * 复制文本到剪贴板（优先 Clipboard API，失败降级 execCommand）。
   * @returns {Promise<boolean>}
   */
  async copyText(text: string): Promise<boolean> {
    if (!text) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        this.showToast('已复制到剪贴板', 'success', 1.8);
        return true;
      }
    } catch (e) { /* 权限被拒 → 降级 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const done = document.execCommand('copy');
      document.body.removeChild(ta);
      if (done) { this.showToast('已复制到剪贴板', 'success', 1.8); return true; }
    } catch (e2) { /* 继续降级 */ }
    this.showToast('复制失败，请手动选择复制', 'warn', 2.4);
    return false;
  }

  /** 下载棋谱为 UTF-8 .txt（Blob + <a download>） */
  downloadText(text: string, filename: string): boolean {
    if (!text) return false;
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.showToast('已下载棋谱', 'success', 1.8);
      return true;
    } catch (e) {
      this.showToast('下载失败，请手动复制', 'warn', 2.4);
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // L2 · 复盘控制条（design §5：游标/自动播放/退出）
  // -------------------------------------------------------------------------

  /**
   * 同步复盘条状态（显隐 / 游标文本 / 按钮可用态 / 播放态）。
   * @param {{active:boolean, cursor:number, len:number, playing:boolean}} st
   */
  setReviewState({ active, cursor = 0, len = 0, playing = false }: { active: boolean, cursor?: number, len?: number, playing?: boolean }): void {
    if (!this.reviewBar) return;
    this.reviewBar.classList.toggle('is-visible', !!active);
    this.reviewBar.setAttribute('aria-hidden', active ? 'false' : 'true');
    if (this.reviewCursor) this.reviewCursor.textContent = `${cursor}/${len}`;
    const atStart = cursor <= 0;
    const atEnd = cursor >= len;
    if (this.rvFirst) this.rvFirst.disabled = atStart;
    if (this.rvPrev) this.rvPrev.disabled = atStart;
    if (this.rvNext) this.rvNext.disabled = atEnd;
    if (this.rvLast) this.rvLast.disabled = atEnd;
    if (this.rvPlay) {
      const canPlay = len > 0 && !atEnd;
      this.rvPlay.disabled = !canPlay && !playing;
      this.rvPlay.classList.toggle('is-on', playing);
      const label = this.rvPlay.querySelector('.btn-label') || this.rvPlay;
      label.textContent = playing ? '暂停' : '播放';
    }
  }

  // -------------------------------------------------------------------------
  // 状态整体刷新
  // -------------------------------------------------------------------------

  /**
   * 一次性同步全部 HUD 状态
   * @param {import('../core/gameState.ts').GameState} gs
   * @param {Object} [extra]
   */
  syncAll(gs: any, extra: { aiThinking?: boolean, activeIndex?: number } = {}): void {
    this.setTurn(gs.sideToMove, { moveNumber: gs.moveNumber, aiThinking: extra.aiThinking });
    const checked = gs.status === 'check' || gs.status === 'checkmate';
    this.setCheck(checked && !gs.isGameOver(), gs.sideToMove);
    this.renderMoveLog(gs.getMoveLog(), extra.activeIndex != null ? extra.activeIndex : gs.history.length - 1);
    this.renderCaptured(gs.captured);
  }
}

function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

export function createHUD(opts?: Record<string, any>): HUD { return new HUD(opts); }

export default HUD;
