/**
 * gameState.js —— 回合管理 / 历史栈 / 中文纵线记谱 / 胜负与和棋判定
 * **不依赖 Three.js**，可被 node / Web Worker 直接加载。
 */

import {
  RED, BLACK, PT, opposite,
  PIECE_NAMES, SIDE_NAMES, FILE_NAMES_RED, FILE_NAMES_BLACK,
  CN_NUM, AR_NUM, MOVE_VERB,
  DRAW_HALFMOVE_HINT, DRAW_HALFMOVE_LIMIT
} from './constants.js';
import { Board, createInitialBoard, boardFromList, boardFromFen } from './board.js';
import {
  generateLegalMoves, generateAllLegalMoves, getGameStatus,
  isInCheck, getBlockers, explainIllegal, makeMove, unmakeMove
} from './rules.js';

// ---------------------------------------------------------------------------
// 中文纵线记谱
// ---------------------------------------------------------------------------

/** 按阵营取纵线名 */
function fileName(file, side) {
  return side === RED ? FILE_NAMES_RED[file] : FILE_NAMES_BLACK[file];
}

/** 按阵营取数字（红=汉字，黑=阿拉伯） */
function numName(n, side) {
  const i = Math.max(0, Math.min(9, n | 0));
  return side === RED ? CN_NUM[i] : AR_NUM[i];
}

/** 斜行棋子（进/退后面跟目标纵线而不是步数） */
const DIAGONAL_MOVERS = new Set([PT.ADVISOR, PT.ELEPHANT, PT.HORSE]);

/**
 * 生成中文纵线记谱（必须在走子**之前**调用，依赖走子前的棋盘）
 * 例："炮二平五"、"馬8进7"、"前俥进一"
 * @param {Board} board 走子前的棋盘
 * @param {{file:number,rank:number}} from
 * @param {{file:number,rank:number}} to
 * @returns {string}
 */
export function getMoveNotation(board, from, to) {
  const p = board.get(from.file, from.rank);
  if (!p) return '';
  const side = p.side;
  const name = PIECE_NAMES[side][p.type];

  // —— 头部：同纵线同兵种多子时用 前/中/后（或一二三四五），否则用起始纵线 ——
  let head;
  const sameFile = board.sameFileSameType(from.file, p.type, side);
  if (sameFile.length >= 2) {
    // 排序：靠近对方的为"前"。红方 rank 越小越靠前；黑方 rank 越大越靠前。
    const ordered = sameFile.slice().sort((a, b) => side === RED ? a.rank - b.rank : b.rank - a.rank);
    const idx = ordered.findIndex(q => q.rank === from.rank);
    let tag;
    if (ordered.length === 2) tag = idx === 0 ? '前' : '后';
    else if (ordered.length === 3) tag = ['前', '中', '后'][idx];
    else tag = idx === 0 ? '前' : (idx === ordered.length - 1 ? '后' : numName(idx + 1, side));
    head = tag + name;
  } else {
    head = name + fileName(from.file, side);
  }

  // —— 动作与目标 ——
  if (to.rank === from.rank) {
    return head + MOVE_VERB.LATERAL + fileName(to.file, side);
  }
  const forward = side === RED ? (to.rank < from.rank) : (to.rank > from.rank);
  const verb = forward ? MOVE_VERB.FORWARD : MOVE_VERB.BACKWARD;
  const tail = DIAGONAL_MOVERS.has(p.type)
    ? fileName(to.file, side)                       // 斜行子：写目标纵线
    : numName(Math.abs(to.rank - from.rank), side); // 直行子：写步数
  return head + verb + tail;
}

// ---------------------------------------------------------------------------
// GameState
// ---------------------------------------------------------------------------

/** 结束原因 */
export const END_REASON = {
  CHECKMATE: 'checkmate',
  STALEMATE: 'stalemate',
  RESIGN: 'resign',
  DRAW_MATERIAL: 'draw-material',
  DRAW_HALFMOVE: 'draw-halfmove',
  DRAW_AGREE: 'draw-agree'
};

export class GameState {
  /**
   * @param {Board} [board] 缺省为标准初始局面
   * @param {string} [sideToMove] 缺省红先
   */
  constructor(board, sideToMove) {
    this.board = board || createInitialBoard();
    this.sideToMove = sideToMove || RED;
    /** @type {Array<Object>} 历史栈 */
    this.history = [];
    /** 无吃子半回合计数 */
    this.halfMoveClock = 0;
    /** 已提示过 60 回合无吃子 */
    this._drawHinted = false;
    /** @type {'playing'|'check'|'checkmate'|'stalemate'|'draw'|'resigned'} */
    this.status = 'playing';
    this.winner = null;
    this.endReason = null;
    /** 被吃的棋子（用于吃子陈列） */
    this.captured = { [RED]: [], [BLACK]: [] };
    /** @type {Object<string, Function[]>} */
    this._listeners = {};
    this.refreshStatus();
  }

  // —— 构造辅助 ——

  static fromList(list, sideToMove = RED) {
    return new GameState(boardFromList(list), sideToMove);
  }

  static fromFen(fen, sideToMove) {
    const parts = String(fen).trim().split(/\s+/);
    const side = sideToMove || (parts[1] === 'b' ? BLACK : RED);
    return new GameState(boardFromFen(parts[0]), side);
  }

  // —— 极简事件总线 ——

  on(evt, cb) {
    (this._listeners[evt] || (this._listeners[evt] = [])).push(cb);
    return () => this.off(evt, cb);
  }

  off(evt, cb) {
    const arr = this._listeners[evt];
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i >= 0) arr.splice(i, 1);
  }

  emit(evt, payload) {
    const arr = this._listeners[evt];
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      try { arr[i](payload); } catch (e) { console.error(`[gameState] 监听器 ${evt} 抛错`, e); }
    }
  }

  // —— 查询 ——

  /** 某格棋子 */
  pieceAt(file, rank) { return this.board.get(file, rank); }

  /** 合法走法（已过滤自杀与白脸将） */
  getLegalMoves(file, rank) { return generateLegalMoves(this.board, file, rank); }

  /** 被蹩马腿 / 塞象眼 / 过河限制阻挡的点 */
  getBlockedPoints(file, rank) { return getBlockers(this.board, file, rank); }

  /** 走法非法原因（null = 合法） */
  whyIllegal(from, to) { return explainIllegal(this.board, from.file, from.rank, to.file, to.rank); }

  /** 当前方是否被将军 */
  inCheck(side = this.sideToMove) { return isInCheck(this.board, side); }

  isGameOver() {
    return this.status === 'checkmate' || this.status === 'stalemate'
      || this.status === 'draw' || this.status === 'resigned';
  }

  canUndo() { return this.history.length > 0 && !this._locked; }

  /** 上一步走子（UI 画 lastMove 标记） */
  lastMove() { return this.history.length ? this.history[this.history.length - 1] : null; }

  /** 当前回合数（从 1 开始） */
  get moveNumber() { return Math.floor(this.history.length / 2) + 1; }

  // —— 核心：走子 ——

  /**
   * 执行一步走子
   * @param {{file:number,rank:number}} from
   * @param {{file:number,rank:number}} to
   * @param {{force?:boolean}} [opts] force = 跳过合法性校验（AI 内部已校验时用）
   * @returns {{ok:boolean, error?:string, record?:Object}}
   */
  move(from, to, opts = {}) {
    if (this.isGameOver()) return { ok: false, error: '对局已结束' };
    const piece = this.board.get(from.file, from.rank);
    if (!piece) return { ok: false, error: '这里没有棋子' };
    if (piece.side !== this.sideToMove) {
      return { ok: false, error: `现在轮到${SIDE_NAMES[this.sideToMove]}走棋` };
    }
    if (!opts.force) {
      const legal = generateLegalMoves(this.board, from.file, from.rank);
      const hit = legal.some(m => m.file === to.file && m.rank === to.rank);
      if (!hit) {
        return { ok: false, error: explainIllegal(this.board, from.file, from.rank, to.file, to.rank) || '这步棋不合法' };
      }
    }

    // 记谱必须在落子之前算
    const notation = getMoveNotation(this.board, from, to);
    const captured = makeMove(this.board, from.file, from.rank, to.file, to.rank);

    const record = {
      index: this.history.length,
      moveNumber: Math.floor(this.history.length / 2) + 1,
      side: piece.side,
      piece: { type: piece.type, side: piece.side },
      from: { file: from.file, rank: from.rank },
      to: { file: to.file, rank: to.rank },
      captured: captured ? { type: captured.type, side: captured.side } : null,
      notation,
      prevHalfMoveClock: this.halfMoveClock,
      prevStatus: this.status,
      checkAfter: false,
      statusAfter: 'playing'
    };

    if (captured) {
      this.halfMoveClock = 0;
      this._drawHinted = false;
      this.captured[captured.side].push({ type: captured.type, side: captured.side });
    } else {
      this.halfMoveClock++;
    }

    this.history.push(record);
    this.sideToMove = opposite(piece.side);
    this.refreshStatus();
    record.checkAfter = this.status === 'check' || this.status === 'checkmate';
    record.statusAfter = this.status;

    this.emit('move', { record, state: this });
    if (this.isGameOver()) this.emit('gameover', { state: this, status: this.status, winner: this.winner, reason: this.endReason });
    else if (!this._drawHinted && this.halfMoveClock >= DRAW_HALFMOVE_HINT) {
      this._drawHinted = true;
      this.emit('drawhint', { halfMoves: this.halfMoveClock, state: this });
    }
    return { ok: true, record };
  }

  /**
   * 悔棋
   * @param {number} steps 回退的半回合数（人机模式传 2 回到玩家回合）
   * @returns {Array<Object>} 被撤销的记录（按撤销顺序）
   */
  undo(steps = 1) {
    const undone = [];
    for (let i = 0; i < steps; i++) {
      const rec = this.history.pop();
      if (!rec) break;
      unmakeMove(this.board, rec.from.file, rec.from.rank, rec.to.file, rec.to.rank, rec.captured);
      if (rec.captured) {
        const bucket = this.captured[rec.captured.side];
        for (let k = bucket.length - 1; k >= 0; k--) {
          if (bucket[k].type === rec.captured.type) { bucket.splice(k, 1); break; }
        }
      }
      this.halfMoveClock = rec.prevHalfMoveClock;
      this.sideToMove = rec.side;
      undone.push(rec);
    }
    if (undone.length) {
      this.winner = null;
      this.endReason = null;
      this._drawHinted = false;
      this.refreshStatus();
      this.emit('undo', { undone, state: this });
    }
    return undone;
  }

  /** 重开一局 */
  reset(board, sideToMove = RED) {
    this.board = board || createInitialBoard();
    this.sideToMove = sideToMove;
    this.history.length = 0;
    this.halfMoveClock = 0;
    this._drawHinted = false;
    this.winner = null;
    this.endReason = null;
    this.captured = { [RED]: [], [BLACK]: [] };
    this.refreshStatus();
    this.emit('reset', { state: this });
  }

  /** 认输 */
  resign(side) {
    if (this.isGameOver()) return false;
    this.status = 'resigned';
    this.winner = opposite(side);
    this.endReason = END_REASON.RESIGN;
    this.emit('gameover', { state: this, status: this.status, winner: this.winner, reason: this.endReason });
    return true;
  }

  /** 议和 / 判和 */
  drawGame(reason = END_REASON.DRAW_AGREE) {
    if (this.isGameOver()) return false;
    this.status = 'draw';
    this.winner = null;
    this.endReason = reason;
    this.emit('gameover', { state: this, status: this.status, winner: null, reason });
    return true;
  }

  /** 重新计算 status / winner / endReason */
  refreshStatus() {
    // 和棋优先判定
    if (this.board.isBareKings()) {
      this.status = 'draw';
      this.winner = null;
      this.endReason = END_REASON.DRAW_MATERIAL;
      return this.status;
    }
    if (this.halfMoveClock >= DRAW_HALFMOVE_LIMIT) {
      this.status = 'draw';
      this.winner = null;
      this.endReason = END_REASON.DRAW_HALFMOVE;
      return this.status;
    }
    const st = getGameStatus(this.board, this.sideToMove);
    this.status = st;
    if (st === 'checkmate') {
      this.winner = opposite(this.sideToMove);
      this.endReason = END_REASON.CHECKMATE;
    } else if (st === 'stalemate') {
      // 中国象棋：困毙判负
      this.winner = opposite(this.sideToMove);
      this.endReason = END_REASON.STALEMATE;
    } else {
      this.winner = null;
      this.endReason = null;
    }
    return this.status;
  }

  /** 结束语（UI 面板用） */
  getResultText() {
    if (!this.isGameOver()) return '';
    if (this.status === 'draw') {
      const why = this.endReason === END_REASON.DRAW_MATERIAL ? '双方仅剩将帅'
        : this.endReason === END_REASON.DRAW_HALFMOVE ? '长期无吃子'
          : '双方议和';
      return `和棋 · ${why}`;
    }
    const w = SIDE_NAMES[this.winner] || '';
    const why = this.endReason === END_REASON.CHECKMATE ? '将死对方'
      : this.endReason === END_REASON.STALEMATE ? '对方困毙无子可动'
        : this.endReason === END_REASON.RESIGN ? '对方认输'
          : '';
    return `${w}胜 · ${why}`;
  }

  /** 走子记录（UI 列表用），按回合分组 */
  getMoveLog() {
    const rows = [];
    for (let i = 0; i < this.history.length; i += 2) {
      rows.push({
        no: i / 2 + 1,
        red: this.history[i] ? this.history[i].notation : '',
        black: this.history[i + 1] ? this.history[i + 1].notation : '',
        redIndex: i,
        blackIndex: this.history[i + 1] ? i + 1 : -1
      });
    }
    return rows;
  }

  /** 所有合法走法（AI / 状态判定用） */
  allLegalMoves(side = this.sideToMove) { return generateAllLegalMoves(this.board, side); }

  /** 导出 FEN */
  toFen() {
    return `${this.board.toFen()} ${this.sideToMove === RED ? 'w' : 'b'} - - ${this.halfMoveClock} ${this.moveNumber}`;
  }

  /** 轻量快照（传给 Worker） */
  snapshot() {
    return { fen: this.board.toFen(), sideToMove: this.sideToMove, halfMoveClock: this.halfMoveClock };
  }
}

export default GameState;
