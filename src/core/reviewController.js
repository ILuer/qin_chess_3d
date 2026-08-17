/**
 * reviewController.js —— 复盘状态机（纯逻辑，无 DOM / Three 依赖）
 *
 * 依据：design/gameplay/review-export-design.md §5
 *   - 全局双模式：PLAY（live gs）↔ REVIEW（scratch 重放）
 *   - REVIEW 内子状态：idle（游标等待）/ playing（自动播放）
 *   - 事件迁移表 E1~E10
 *
 * 职责边界：
 *  - 只维护状态：active / cursor(半回合下标 0..len) / sub('idle'|'playing') /
 *    interval(自动播放间隔 ms) / 定时器
 *  - 不持有 GameState、不碰棋盘：每次状态变化通过 onChange(cursor, len, sub, active)
 *    通知宿主，由宿主重建 scratch 局面并渲染（main.js renderReview）。
 *  - 定时器可注入 { set(fn, ms), clear() }，便于单测用假定时器锁死 E6~E8 迁移。
 *
 * 不变式（宿主据此断言，见 RV-011）：
 *  - cursor 恒在 [0, len]；len = 走子历史半回合数
 *  - sub='playing' 时存在活跃定时器；到达末尾自动回 'idle'（E8）
 *  - 退出（E9/E10）后 active=false、cursor=0、无活跃定时器
 */

export class ReviewController {
  /**
   * @param {Object} deps
   * @param {() => Array} deps.getHistory 返回走子历史（半回合记录数组）
   * @param {(cursor:number, len:number, sub:'idle'|'playing', active:boolean) => void} [deps.onChange]
   * @param {number} [deps.interval] 自动播放间隔 ms（默认 1000）
   * @param {{set:(fn:Function, ms:number)=>void, clear:()=>void}|null} [deps.timer]
   */
  constructor({ getHistory, onChange, interval = 1000, timer = null }) {
    this._getHistory = getHistory;
    this._onChange = onChange || (() => {});
    this.interval = interval;
    this._timer = timer;
    this.active = false;
    this.cursor = 0;
    this.sub = 'idle';
  }

  /** 历史长度（半回合数） */
  get len() { return this._getHistory().length; }
  get isActive() { return this.active; }

  /**
   * E1：进入复盘。
   * @param {number} [entryIndex] 游标进入位置（半回合下标 0..len），缺省 len（末尾）
   * @returns {boolean} 成功；空历史失败、已在复盘幂等返回 true
   */
  enter(entryIndex) {
    if (this.active) return true;
    if (this.len <= 0) return false;          // 空历史不可进入
    this.active = true;
    this.sub = 'idle';
    this.cursor = clamp(entryIndex == null ? this.len : entryIndex, 0, this.len);
    this._notify();
    return true;
  }

  /** E9：退出复盘（停定时器、复位状态） */
  exit() {
    if (!this.active) return;
    this._stopTimer();
    this.active = false;
    this.sub = 'idle';
    this.cursor = 0;
    this._notify();
  }

  /** E10：外部变更强制退出（undo/reset/gameover 兜底），幂等 */
  forceExit() { this.exit(); }

  /** E2：跳到开头（游标键 → 停自动播放） */
  first() { if (!this.active) return; this._pauseAndSeek(0); }

  /** E3：上一步 */
  prev() { if (!this.active) return; this._pauseAndSeek(this.cursor - 1); }

  /** E4：下一步 */
  next() { if (!this.active) return; this._pauseAndSeek(this.cursor + 1); }

  /** E5：跳到结尾 */
  last() { if (!this.active) return; this._pauseAndSeek(this.len); }

  /** 直接定位（move-log 单击/双击导航），游标键语义：停自动播放、越界钳制 */
  seek(cursor) {
    if (!this.active) return;
    this._pauseAndSeek(clamp(cursor, 0, this.len));
  }

  /** E6：开始自动播放（前置 cursor<len；末尾不可播） */
  play() {
    if (!this.active || this.sub === 'playing') return;
    if (this.cursor >= this.len) return;
    this.sub = 'playing';
    this._startTimer();
    this._notify();
  }

  /** E7：暂停自动播放 */
  pause() {
    if (!this.active || this.sub !== 'playing') return;
    this._stopTimer();
    this.sub = 'idle';
    this._notify();
  }

  /** 播放 / 暂停切换（Space / 复盘条按钮） */
  togglePlay() {
    if (this.sub === 'playing') this.pause();
    else this.play();
  }

  /** 调整自动播放间隔；播放中立即按新间隔续拍 */
  setInterval(ms) {
    this.interval = Math.max(100, Number(ms) || this.interval);
    if (this.sub === 'playing') this._startTimer();
  }

  /** E8：定时器回调 —— 前进 1 半回合；到达末尾自动停 */
  _tick() {
    if (!this.active || this.sub !== 'playing') return;
    if (this.cursor >= this.len) { this.pause(); return; }
    this.cursor++;
    this._notify();
    if (this.cursor >= this.len) { this.pause(); return; }   // E8：末尾自动回 idle
    this._startTimer();                                       // 续下一拍
  }

  // —— 内部 ——

  _pauseAndSeek(target) {
    this._stopTimer();
    this.sub = 'idle';
    this.cursor = clamp(target, 0, this.len);
    this._notify();
  }

  _startTimer() {
    this._stopTimer();
    if (this._timer) this._timer.set(() => this._tick(), this.interval);
  }

  _stopTimer() {
    if (this._timer) this._timer.clear();
  }

  _notify() {
    this._onChange(this.cursor, this.len, this.sub, this.active);
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export default ReviewController;
