/**
 * hud.js —— DOM 层界面：回合指示 / 将军横幅 / 走子记录 / 吃子陈列 /
 *            toast / 结束面板 / 帮助面板 / 加载进度
 *
 * 所有 DOM 查询都做空值保护：即使某个节点缺失也不会让游戏崩溃。
 * class / id 命名严格遵循契约第 5 节与 index.html。
 */

import {
  RED, BLACK, SIDE_NAMES, PIECE_NAMES, PALETTE, TIMING, PT
} from '../core/constants.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
  ['?', '打开 / 关闭本帮助'],
  ['Esc', '取消当前选择']
];

export class HUD {
  constructor(opts = {}) {
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

    this._toasts = [];
    this._timerStart = 0;
    this._timerRunning = false;
    this._lastTurnSide = null;

    this._bind();
    this.renderHelp();
  }

  _bind() {
    if (this.helpToggle) {
      this.helpToggle.addEventListener('click', () => this.toggleHelp());
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
      this.moveLogList.addEventListener('click', ev => {
        const cell = ev.target.closest('[data-move-index]');
        if (!cell) return;
        const idx = Number(cell.dataset.moveIndex);
        if (Number.isNaN(idx) || idx < 0) return;
        if (this.opts.onPreviewMove) this.opts.onPreviewMove(idx);
      });
    }
  }

  // -------------------------------------------------------------------------
  // 加载界面
  // -------------------------------------------------------------------------

  /**
   * @param {number} pct 0..1
   * @param {string} [text]
   */
  setLoadingProgress(pct, text) {
    const p = Math.max(0, Math.min(1, pct));
    if (this.loadingFill) this.loadingFill.style.width = (p * 100).toFixed(1) + '%';
    if (text && this.loadingText) this.loadingText.textContent = text;
  }

  /** 淡出加载界面 */
  hideLoading(delay = 260) {
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
  showFatalError(message, detail) {
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
  setTurn(side, info = {}) {
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
  setCheck(on, side) {
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
  renderMoveLog(rows, activeIndex = -1) {
    if (!this.moveLogList) return;
    if (this.moveLogEmpty) this.moveLogEmpty.style.display = rows.length ? 'none' : '';
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
  renderCaptured(captured) {
    const fill = (el, list) => {
      if (!el) return;
      if (!list || !list.length) { el.innerHTML = '<span class="captured-none">—</span>'; return; }
      const order = [PT.ROOK, PT.CANNON, PT.HORSE, PT.ELEPHANT, PT.ADVISOR, PT.PAWN, PT.KING];
      const sorted = list.slice().sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
      el.innerHTML = sorted.map(p =>
        `<span class="captured-chip ${p.side === RED ? 'is-red' : 'is-black'}">${PIECE_NAMES[p.side][p.type]}</span>`
      ).join('');
    };
    // captured[RED] = 被吃掉的红子
    fill(this.capturedRed, captured && captured[RED]);
    fill(this.capturedBlack, captured && captured[BLACK]);
  }

  // -------------------------------------------------------------------------
  // 计时
  // -------------------------------------------------------------------------

  startTimer() { this._timerStart = performance.now(); this._timerRunning = true; }
  stopTimer() { this._timerRunning = false; }

  updateTimer() {
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
  showToast(msg, type = 'info', life = TIMING.toastLife) {
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
      const old = this._toasts.shift();
      clearTimeout(old.timer);
      if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
    return el;
  }

  clearToasts() {
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
  showGameOver(info) {
    if (!this.gameOver) return;
    if (this.gameOverTitle) this.gameOverTitle.textContent = info.title || '对局结束';
    if (this.gameOverDetail) this.gameOverDetail.textContent = info.detail || '';
    if (this.gameOverStats) {
      this.gameOverStats.innerHTML = (info.stats || [])
        .map(([k, v]) => `<div class="stat-row"><span class="stat-k">${escapeHtml(k)}</span><span class="stat-v">${escapeHtml(v)}</span></div>`)
        .join('');
    }
    this.gameOver.classList.remove('tone-win', 'tone-lose', 'tone-draw');
    if (info.tone) this.gameOver.classList.add(`tone-${info.tone}`);
    this.gameOver.classList.add('is-visible');
    this.gameOver.setAttribute('aria-hidden', 'false');
  }

  hideGameOver() {
    if (!this.gameOver) return;
    this.gameOver.classList.remove('is-visible');
    this.gameOver.setAttribute('aria-hidden', 'true');
  }

  // -------------------------------------------------------------------------
  // 帮助面板
  // -------------------------------------------------------------------------

  renderHelp() {
    if (!this.helpContent) return;
    const rules = RULE_CHEATSHEET.map(([name, desc]) =>
      `<div class="help-rule"><span class="help-piece">${escapeHtml(name)}</span><span class="help-desc">${desc.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</span></div>`
    ).join('');
    const keys = SHORTCUTS.map(([k, d]) =>
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
        <h3 class="help-title">操作方式</h3>
        <div class="help-rule"><span class="help-piece">选子</span><span class="help-desc">单击己方棋子，再单击目标点落子（无需拖拽）</span></div>
        <div class="help-rule"><span class="help-piece">换选</span><span class="help-desc">直接点击己方另一枚棋子即可切换</span></div>
        <div class="help-rule"><span class="help-piece">视角</span><span class="help-desc">按住拖动旋转，滚轮缩放</span></div>
      </section>`;
  }

  toggleHelp(force) {
    if (!this.helpPanel) return false;
    const open = force != null ? force : !this.helpPanel.classList.contains('is-open');
    this.helpPanel.classList.toggle('is-open', open);
    this.helpPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (this.helpToggle) this.helpToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    return open;
  }

  // -------------------------------------------------------------------------
  // 状态整体刷新
  // -------------------------------------------------------------------------

  /**
   * 一次性同步全部 HUD 状态
   * @param {import('../core/gameState.js').GameState} gs
   * @param {Object} [extra]
   */
  syncAll(gs, extra = {}) {
    this.setTurn(gs.sideToMove, { moveNumber: gs.moveNumber, aiThinking: extra.aiThinking });
    const checked = gs.status === 'check' || gs.status === 'checkmate';
    this.setCheck(checked && !gs.isGameOver(), gs.sideToMove);
    this.renderMoveLog(gs.getMoveLog(), extra.activeIndex != null ? extra.activeIndex : gs.history.length - 1);
    this.renderCaptured(gs.captured);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function createHUD(opts) { return new HUD(opts); }

export default HUD;
