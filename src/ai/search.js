/**
 * search.js —— AI 搜索核心（Minimax + Alpha-Beta + 迭代加深 + 静态搜索）
 * **不依赖 Three.js / DOM**，可在主线程或 Web Worker 中运行。
 *
 * 评估 = 子力价值 + 位置价值表 + 机动性 + 少量结构项
 */

import { RED, BLACK, PT, opposite, PIECE_VALUE, PAWN_CROSSED_VALUE, FILES, RANKS } from '../core/constants.js';
import { Board } from '../core/board.js';
import {
  generateAllLegalMoves, generatePseudoMoves, makeMove, unmakeMove,
  isInCheck, hasCrossedRiver
} from '../core/rules.js';

// ---------------------------------------------------------------------------
// 位置价值表（以红方视角书写：rank 0 = 黑方底线，rank 9 = 红方底线）
// 黑方取镜像：index = (9 - rank) * 9 + file
// ---------------------------------------------------------------------------

/** 把 10 行 × 9 列的二维表压平 */
const T = rows => {
  const a = new Int16Array(FILES * RANKS);
  for (let r = 0; r < RANKS; r++) for (let f = 0; f < FILES; f++) a[r * FILES + f] = rows[r][f];
  return a;
};

const PST_PAWN = T([
  [0, 3, 6, 9, 12, 9, 6, 3, 0],
  [18, 36, 56, 80, 120, 80, 56, 36, 18],
  [14, 26, 42, 60, 80, 60, 42, 26, 14],
  [10, 20, 30, 34, 40, 34, 30, 20, 10],
  [6, 12, 18, 18, 20, 18, 18, 12, 6],
  [2, 0, 8, 0, 8, 0, 8, 0, 2],
  [0, 0, -2, 0, 4, 0, -2, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0]
]);

const PST_HORSE = T([
  [4, 8, 16, 12, 4, 12, 16, 8, 4],
  [4, 10, 28, 16, 8, 16, 28, 10, 4],
  [12, 14, 16, 20, 18, 20, 16, 14, 12],
  [8, 24, 18, 24, 20, 24, 18, 24, 8],
  [6, 16, 14, 18, 16, 18, 14, 16, 6],
  [4, 12, 16, 14, 12, 14, 16, 12, 4],
  [2, 6, 8, 6, 10, 6, 8, 6, 2],
  [4, 2, 8, 8, 4, 8, 8, 2, 4],
  [0, 2, 4, 4, -2, 4, 4, 2, 0],
  [0, -4, 0, 0, 0, 0, 0, -4, 0]
]);

const PST_ROOK = T([
  [14, 14, 12, 18, 16, 18, 12, 14, 14],
  [16, 20, 18, 24, 26, 24, 18, 20, 16],
  [12, 12, 12, 18, 18, 18, 12, 12, 12],
  [12, 18, 16, 22, 22, 22, 16, 18, 12],
  [12, 14, 12, 18, 18, 18, 12, 14, 12],
  [12, 16, 14, 20, 20, 20, 14, 16, 12],
  [6, 10, 8, 14, 14, 14, 8, 10, 6],
  [4, 8, 6, 14, 12, 14, 6, 8, 4],
  [8, 4, 8, 16, 8, 16, 8, 4, 8],
  [-2, 10, 6, 14, 12, 14, 6, 10, -2]
]);

const PST_CANNON = T([
  [6, 4, 0, -10, -12, -10, 0, 4, 6],
  [2, 2, 0, -4, -14, -4, 0, 2, 2],
  [2, 2, 0, -10, -8, -10, 0, 2, 2],
  [0, 0, -2, 4, 10, 4, -2, 0, 0],
  [0, 0, 0, 2, 8, 2, 0, 0, 0],
  [-2, 0, 4, 2, 6, 2, 4, 0, -2],
  [0, 0, 0, 2, 4, 2, 0, 0, 0],
  [4, 0, 8, 6, 10, 6, 8, 0, 4],
  [0, 2, 4, 6, 6, 6, 4, 2, 0],
  [0, 0, 2, 6, 6, 6, 2, 0, 0]
]);

const PST_ADVISOR = T([
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 4, 0, 4, 0, 0, 0],
  [0, 0, 0, 0, 8, 0, 0, 0, 0],
  [0, 0, 0, 4, 0, 4, 0, 0, 0]
]);

const PST_ELEPHANT = T([
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 4, 0, 0, 0, 4, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2, 0, 0, 0, 8, 0, 0, 0, 2],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 4, 0, 0, 0, 4, 0, 0]
]);

const PST_KING = T([
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, -8, -8, -8, 0, 0, 0],
  [0, 0, 0, -4, -4, -4, 0, 0, 0],
  [0, 0, 0, 2, 6, 2, 0, 0, 0]
]);

const PST = {
  [PT.PAWN]: PST_PAWN,
  [PT.HORSE]: PST_HORSE,
  [PT.ROOK]: PST_ROOK,
  [PT.CANNON]: PST_CANNON,
  [PT.ADVISOR]: PST_ADVISOR,
  [PT.ELEPHANT]: PST_ELEPHANT,
  [PT.KING]: PST_KING
};

/** 机动性权重（每个伪合法走法的分值） */
const MOBILITY_W = { [PT.ROOK]: 2.2, [PT.CANNON]: 1.4, [PT.HORSE]: 1.6 };

export const MATE_SCORE = 30000;

// ---------------------------------------------------------------------------
// 评估
// ---------------------------------------------------------------------------

/**
 * 静态局面评估（从 side 的视角，越大越好）
 * @param {Board} board
 * @param {string} side
 */
export function evaluate(board, side) {
  let scoreRed = 0;
  const cells = board.cells;
  for (let i = 0; i < cells.length; i++) {
    const p = cells[i];
    if (!p) continue;
    const file = i % FILES;
    const rank = (i / FILES) | 0;
    const isRed = p.side === RED;
    const pstIndex = isRed ? i : (RANKS - 1 - rank) * FILES + file;

    // 子力
    let v = PIECE_VALUE[p.type] || 0;
    if (p.type === PT.PAWN && hasCrossedRiver(rank, p.side)) v = PAWN_CROSSED_VALUE;
    if (p.type === PT.KING) v = 0;   // 将帅不计子力，胜负由 mate 分处理

    // 位置
    const table = PST[p.type];
    if (table) v += table[pstIndex];

    // 机动性（只算大子，避免过慢）
    const mw = MOBILITY_W[p.type];
    if (mw) v += generatePseudoMoves(board, file, rank).length * mw;

    scoreRed += isRed ? v : -v;
  }
  return side === RED ? scoreRed : -scoreRed;
}

// ---------------------------------------------------------------------------
// 走法排序
// ---------------------------------------------------------------------------

/** MVV-LVA：优先吃大子、用小子吃 */
function scoreMove(board, m) {
  if (!m.capture) return 0;
  const victim = board.get(m.to.file, m.to.rank);
  const attacker = board.get(m.from.file, m.from.rank);
  const vv = victim ? (PIECE_VALUE[victim.type] || 0) : 0;
  const av = attacker ? (PIECE_VALUE[attacker.type] || 0) : 0;
  return 100000 + vv * 10 - av;
}

function orderedMoves(board, side, ttMove) {
  const moves = generateAllLegalMoves(board, side);
  for (let i = 0; i < moves.length; i++) {
    let s = scoreMove(board, moves[i]);
    if (ttMove && sameMove(moves[i], ttMove)) s += 1000000;
    moves[i]._s = s;
  }
  moves.sort((a, b) => b._s - a._s);
  return moves;
}

function sameMove(a, b) {
  return a && b && a.from.file === b.from.file && a.from.rank === b.from.rank
    && a.to.file === b.to.file && a.to.rank === b.to.rank;
}

// ---------------------------------------------------------------------------
// 静态搜索（只搜吃子，缓解水平线效应）
// ---------------------------------------------------------------------------

function quiescence(board, side, alpha, beta, ply, ctx) {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) { ctx.timeout = true; return alpha; }
  if (ply > ctx.maxQPly) return evaluate(board, side);

  const stand = evaluate(board, side);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;

  const all = generateAllLegalMoves(board, side);
  const caps = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].capture) { all[i]._s = scoreMove(board, all[i]); caps.push(all[i]); }
  }
  if (!caps.length) return stand;
  caps.sort((a, b) => b._s - a._s);

  for (let i = 0; i < caps.length; i++) {
    const m = caps[i];
    const victim = board.get(m.to.file, m.to.rank);
    const cap = makeMove(board, m.from.file, m.from.rank, m.to.file, m.to.rank);
    let score;
    if (victim && victim.type === PT.KING) score = MATE_SCORE - ply;
    else score = -quiescence(board, opposite(side), -beta, -alpha, ply + 1, ctx);
    unmakeMove(board, m.from.file, m.from.rank, m.to.file, m.to.rank, cap);
    if (ctx.timeout) return alpha;
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// ---------------------------------------------------------------------------
// Negamax + Alpha-Beta
// ---------------------------------------------------------------------------

function negamax(board, side, depth, alpha, beta, ply, ctx) {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) { ctx.timeout = true; return alpha; }

  if (depth <= 0) return quiescence(board, side, alpha, beta, ply, ctx);

  const moves = orderedMoves(board, side);
  if (!moves.length) {
    // 无子可动：将死或困毙，中国象棋均判负
    return -MATE_SCORE + ply;
  }

  let best = -Infinity;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const victim = board.get(m.to.file, m.to.rank);
    const cap = makeMove(board, m.from.file, m.from.rank, m.to.file, m.to.rank);
    let score;
    if (victim && victim.type === PT.KING) {
      score = MATE_SCORE - ply;
    } else {
      score = -negamax(board, opposite(side), depth - 1, -beta, -alpha, ply + 1, ctx);
    }
    unmakeMove(board, m.from.file, m.from.rank, m.to.file, m.to.rank, cap);
    if (ctx.timeout) return best > -Infinity ? best : alpha;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;      // 剪枝
  }
  return best;
}

// ---------------------------------------------------------------------------
// 根节点搜索（迭代加深）
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SearchResult
 * @property {{file:number,rank:number}} from
 * @property {{file:number,rank:number}} to
 * @property {number} score
 * @property {number} depth
 * @property {number} nodes
 * @property {number} elapsed
 * @property {boolean} timedOut
 */

/**
 * 同步搜索（Worker 里用）
 * @param {Board} board
 * @param {string} side
 * @param {{depth?:number, timeLimit?:number, randomness?:number}} [opts]
 * @returns {SearchResult|null}
 */
export function searchBestMove(board, side, opts = {}) {
  const maxDepth = Math.max(1, opts.depth || 3);
  const timeLimit = opts.timeLimit || 1200;
  const randomness = opts.randomness || 0;
  const start = Date.now();
  const ctx = { nodes: 0, deadline: start + timeLimit, timeout: false, maxQPly: 6 };

  let rootMoves = orderedMoves(board, side);
  if (!rootMoves.length) return null;

  let best = null;
  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -Infinity;
    const beta = Infinity;
    let localBest = null;
    const scored = [];

    for (let i = 0; i < rootMoves.length; i++) {
      const m = rootMoves[i];
      const victim = board.get(m.to.file, m.to.rank);
      const cap = makeMove(board, m.from.file, m.from.rank, m.to.file, m.to.rank);
      let score;
      if (victim && victim.type === PT.KING) score = MATE_SCORE;
      else score = -negamax(board, opposite(side), depth - 1, -beta, -alpha, 1, ctx);
      unmakeMove(board, m.from.file, m.from.rank, m.to.file, m.to.rank, cap);

      if (ctx.timeout) break;
      if (randomness) score += (Math.random() * 2 - 1) * randomness;
      scored.push({ m, score });
      if (!localBest || score > localBest.score) localBest = { m, score };
      if (score > alpha) alpha = score;
    }

    if (localBest && (!ctx.timeout || !best)) {
      best = { from: localBest.m.from, to: localBest.m.to, score: localBest.score, depth };
      // 下一轮把本轮最优排到最前，提升剪枝效率
      if (scored.length === rootMoves.length) {
        scored.sort((a, b) => b.score - a.score);
        rootMoves = scored.map(s => s.m);
      }
    }
    if (ctx.timeout) break;
    if (best && Math.abs(best.score) > MATE_SCORE - 100) break;   // 找到杀棋
  }

  if (!best) {
    const m = rootMoves[0];
    best = { from: m.from, to: m.to, score: 0, depth: 0 };
  }
  best.nodes = ctx.nodes;
  best.elapsed = Date.now() - start;
  best.timedOut = ctx.timeout;
  return best;
}

/**
 * 时间切片搜索（主线程降级方案）：每搜完一个根走法就 yield 一次，避免卡死页面
 * @param {Board} board
 * @param {string} side
 * @param {Object} [opts]
 * @returns {Promise<SearchResult|null>}
 */
export async function searchBestMoveSliced(board, side, opts = {}) {
  const maxDepth = Math.max(1, opts.depth || 3);
  const timeLimit = opts.timeLimit || 900;
  const randomness = opts.randomness || 0;
  const yieldFn = opts.yieldFn || (() => new Promise(r => setTimeout(r, 0)));
  const start = Date.now();
  const ctx = { nodes: 0, deadline: start + timeLimit, timeout: false, maxQPly: 4 };

  let rootMoves = orderedMoves(board, side);
  if (!rootMoves.length) return null;

  let best = null;
  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -Infinity;
    const beta = Infinity;
    let localBest = null;
    const scored = [];

    for (let i = 0; i < rootMoves.length; i++) {
      const m = rootMoves[i];
      const victim = board.get(m.to.file, m.to.rank);
      const cap = makeMove(board, m.from.file, m.from.rank, m.to.file, m.to.rank);
      let score;
      if (victim && victim.type === PT.KING) score = MATE_SCORE;
      else score = -negamax(board, opposite(side), depth - 1, -beta, -alpha, 1, ctx);
      unmakeMove(board, m.from.file, m.from.rank, m.to.file, m.to.rank, cap);

      if (ctx.timeout) break;
      if (randomness) score += (Math.random() * 2 - 1) * randomness;
      scored.push({ m, score });
      if (!localBest || score > localBest.score) localBest = { m, score };
      if (score > alpha) alpha = score;

      // 让出主线程，保证页面不卡
      if ((i & 1) === 1) await yieldFn();
      if (Date.now() > ctx.deadline) { ctx.timeout = true; break; }
    }

    if (localBest && (!ctx.timeout || !best)) {
      best = { from: localBest.m.from, to: localBest.m.to, score: localBest.score, depth };
      if (scored.length === rootMoves.length) {
        scored.sort((a, b) => b.score - a.score);
        rootMoves = scored.map(s => s.m);
      }
    }
    if (ctx.timeout) break;
    if (best && Math.abs(best.score) > MATE_SCORE - 100) break;
    await yieldFn();
  }

  if (!best) {
    const m = rootMoves[0];
    best = { from: m.from, to: m.to, score: 0, depth: 0 };
  }
  best.nodes = ctx.nodes;
  best.elapsed = Date.now() - start;
  best.timedOut = ctx.timeout;
  return best;
}

/** 难度档位 */
export const DIFFICULTY = {
  1: { name: '入门', depth: 2, timeLimit: 400, randomness: 26 },
  2: { name: '进阶', depth: 3, timeLimit: 900, randomness: 8 },
  3: { name: '高手', depth: 4, timeLimit: 1800, randomness: 0 },
  // M5：大师档。迭代加深 + 3s deadline 自动搜到尽可能深（engine 硬超时 = timeLimit + 3000 = 6s 兜底）。
  // D10 拍板：大师档仅 worker 模式开放（主线程时间切片会卡页面），UI/engine 层已做门禁。
  4: { name: '大师', depth: 6, timeLimit: 3000, randomness: 0 }
};

export { isInCheck };
