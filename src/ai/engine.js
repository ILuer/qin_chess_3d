/**
 * engine.js —— AI 对手对外接口
 *
 * 策略：
 *   1) 首选 module Web Worker（`new Worker(url, { type:'module' })`），彻底不阻塞主线程
 *   2) Worker 创建失败（例如以 file:// 打开页面、浏览器不支持 module worker）
 *      自动降级为**主线程时间切片搜索**（迭代加深 + 时间上限 + 每两个根走法 yield 一次）
 *
 * 对外只暴露 think()，调用方无需关心底层用的是哪种。
 */

import { boardFromFen } from '../core/board.js';
import { searchBestMoveSliced, DIFFICULTY } from './search.js';

export { DIFFICULTY };

export class AIEngine {
  /**
   * @param {{difficulty?:number, onModeChange?:Function}} [opts]
   */
  constructor(opts = {}) {
    this.difficulty = opts.difficulty || 2;
    this.onModeChange = opts.onModeChange;
    /** @type {'worker'|'sliced'|'unknown'} */
    this.mode = 'unknown';
    this.worker = null;
    this.ready = false;
    this._seq = 0;
    this._pending = new Map();
    this._thinking = false;
    this._cancelled = false;
    this._initWorker();
  }

  get isThinking() { return this._thinking; }

  // -------------------------------------------------------------------------

  _initWorker() {
    if (typeof Worker === 'undefined') { this._useSliced('浏览器不支持 Web Worker'); return; }
    try {
      // 内联 new URL 模式：esbuild 会把 worker 及其依赖打包为独立产物并重写 URL
      // （分离变量写法会让 esbuild 无法识别，打包后 URL 会指向不存在的 dist/worker.js）
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.addEventListener('message', ev => this._onWorkerMessage(ev));
      w.addEventListener('error', err => {
        console.warn('[AI] Worker 运行出错，降级为主线程时间切片：', err && err.message);
        this._teardownWorker();
        this._useSliced('Worker 运行出错');
      });
      this.worker = w;
      this.mode = 'worker';
      // 探活：1.5s 内没收到 ready/pong 就降级
      this._probeTimer = setTimeout(() => {
        if (!this.ready) {
          console.warn('[AI] Worker 无响应，降级为主线程时间切片');
          this._teardownWorker();
          this._useSliced('Worker 无响应');
        }
      }, 1500);
      w.postMessage({ type: 'ping', id: -1 });
    } catch (err) {
      console.warn('[AI] 无法创建 module Worker，降级为主线程时间切片：', err && err.message);
      this._useSliced('无法创建 Worker');
    }
  }

  _onWorkerMessage(ev) {
    const msg = ev.data || {};
    if (msg.type === 'ready' || msg.type === 'pong') {
      if (!this.ready) {
        this.ready = true;
        clearTimeout(this._probeTimer);
        if (this.onModeChange) this.onModeChange('worker');
      }
      return;
    }
    const entry = this._pending.get(msg.id);
    if (!entry) return;
    this._pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.type === 'error') entry.reject(new Error(msg.message || 'AI worker 错误'));
    else entry.resolve(msg.result || null);
  }

  _teardownWorker() {
    clearTimeout(this._probeTimer);
    if (this.worker) {
      try { this.worker.terminate(); } catch (e) { /* noop */ }
      this.worker = null;
    }
    for (const [, entry] of this._pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('AI worker 已终止'));
    }
    this._pending.clear();
  }

  _useSliced(reason) {
    this.mode = 'sliced';
    this.ready = true;
    this._slicedReason = reason;
    // D10：大师档仅 worker 开放——worker 探活失败降级时自动回到高手档
    if (this.difficulty === 4) this.difficulty = 3;
    if (this.onModeChange) this.onModeChange('sliced', reason);
  }

  // -------------------------------------------------------------------------

  setDifficulty(level) {
    level = DIFFICULTY[level] ? level : 2;
    // D10：大师档（4）仅 worker 模式开放；sliced 模式拒绝，保持当前难度
    if (level === 4 && this.mode === 'sliced') return this.difficulty;
    this.difficulty = level;
    return this.difficulty;
  }

  getDifficultyInfo() { return DIFFICULTY[this.difficulty] || DIFFICULTY[2]; }

  /** 取消当前思考（悔棋 / 重开时调用） */
  cancel() {
    this._cancelled = true;
    if (this.mode === 'worker' && this.worker) {
      // 中断当前搜索最稳妥的办法是重建 worker
      for (const [, entry] of this._pending) { clearTimeout(entry.timer); entry.reject(new Error('AI 思考已取消')); }
      this._pending.clear();
      try { this.worker.terminate(); } catch (e) { /* noop */ }
      this.worker = null;
      this.ready = false;
      this._initWorker();
    }
    this._thinking = false;
  }

  /**
   * 让 AI 思考一步
   * @param {string} fen 棋子部分 FEN
   * @param {'r'|'b'} side
   * @param {{depth?:number, timeLimit?:number, minDelay?:number}} [opts]
   * @returns {Promise<{from:Object, to:Object, score:number, depth:number, nodes:number, elapsed:number}|null>}
   */
  async think(fen, side, opts = {}) {
    const preset = this.getDifficultyInfo();
    const depth = opts.depth != null ? opts.depth : preset.depth;
    const timeLimit = opts.timeLimit != null ? opts.timeLimit : preset.timeLimit;
    const randomness = opts.randomness != null ? opts.randomness : preset.randomness;
    const minDelay = opts.minDelay != null ? opts.minDelay : 260;   // 太快落子反而显得假

    this._thinking = true;
    this._cancelled = false;
    const t0 = Date.now();
    let result = null;
    try {
      if (this.mode === 'worker' && this.worker) {
        result = await this._thinkInWorker(fen, side, depth, timeLimit, randomness);
      } else {
        // D10 兜底：任何原因进入 sliced 时，深度封顶 4（大师档深度 6 会卡主线程）
        const board = boardFromFen(fen);
        result = await searchBestMoveSliced(board, side, { depth: Math.min(depth, 4), timeLimit, randomness });
      }
    } catch (err) {
      console.warn('[AI] 搜索失败，降级为主线程时间切片：', err && err.message);
      if (this._cancelled) { this._thinking = false; return null; }
      this._useSliced('搜索异常');
      const board = boardFromFen(fen);
      result = await searchBestMoveSliced(board, side, { depth: Math.min(depth, 3), timeLimit, randomness });
    }

    const spent = Date.now() - t0;
    if (spent < minDelay) await new Promise(r => setTimeout(r, minDelay - spent));
    this._thinking = false;
    if (this._cancelled) return null;
    return result;
  }

  _thinkInWorker(fen, side, depth, timeLimit, randomness) {
    return new Promise((resolve, reject) => {
      const id = ++this._seq;
      // 硬超时：给 worker 的时间上限再加 3s 缓冲
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('AI 思考超时'));
      }, timeLimit + 3000);
      this._pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ type: 'search', id, fen, side, depth, timeLimit, randomness, difficulty: this.difficulty });
    });
  }

  dispose() {
    this._teardownWorker();
    this._thinking = false;
  }
}

export function createAIEngine(opts) { return new AIEngine(opts); }

export default AIEngine;
