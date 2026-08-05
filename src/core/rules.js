/**
 * rules.js —— 中国象棋规则引擎（本项目的正确性核心）
 * **不依赖 Three.js**，可被 node / Web Worker 直接加载。
 *
 * 覆盖规则：
 *   将/帅 九宫单步直行 · 士 九宫单步斜行 · 象 田字+塞象眼+不过河
 *   马 日字+蹩马腿 · 车 直线无阻 · 炮 隔一子吃 · 兵 过河可横走且不后退
 *   白脸将（对面笑）· 自杀走法过滤 · 将死 / 困毙（困毙判负）
 *
 * 性能约定：所有需要试算的地方一律 "落子 - 判断 - 撤销"，绝不深拷贝棋盘。
 */

import {
  FILES, RANKS, RED, BLACK, PT, opposite,
  PALACE_FILE_MIN, PALACE_FILE_MAX, PALACE_RED, PALACE_BLACK
} from './constants.js';

// ---------------------------------------------------------------------------
// 基础判定
// ---------------------------------------------------------------------------

/** 是否在棋盘内 */
export function inBoard(file, rank) {
  return file >= 0 && file < FILES && rank >= 0 && rank < RANKS;
}

/** 是否在某方九宫内 */
export function inPalace(file, rank, side) {
  if (file < PALACE_FILE_MIN || file > PALACE_FILE_MAX) return false;
  const pal = side === RED ? PALACE_RED : PALACE_BLACK;
  return rank >= pal.rankMin && rank <= pal.rankMax;
}

/** 该 rank 是否仍在本方半场（象不可过河的判据） */
export function isOwnHalf(rank, side) {
  return side === RED ? rank >= 5 : rank <= 4;
}

/** 兵/卒是否已过河 */
export function hasCrossedRiver(rank, side) {
  return side === RED ? rank <= 4 : rank >= 5;
}

/** 该方向前的 rank 增量：红方向 rank 递减方向前进 */
export function forwardDir(side) {
  return side === RED ? -1 : 1;
}

/**
 * 兼容 state 与裸 Board：rules 的入参既可以是 { board, ... } 也可以直接是 Board
 * @returns {import('./board.js').Board}
 */
function getBoard(state) {
  if (!state) throw new Error('rules: state/board 不能为空');
  return state.board ? state.board : state;
}

// ---------------------------------------------------------------------------
// 方向常量
// ---------------------------------------------------------------------------

/** 四正方向 [df, dr] */
const ORTHO = [[0, 1], [0, -1], [1, 0], [-1, 0]];
/** 四斜方向 */
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
/** 马的 8 个位移（对称集合，既可用作"马能去哪"也可用作"哪里的马能来"） */
const HORSE_DELTAS = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2]
];

// ---------------------------------------------------------------------------
// 落子 / 撤销（供内部试算使用，也导出给 AI）
// ---------------------------------------------------------------------------

/**
 * 在棋盘上试走一步
 * @returns {Object|null} 被吃掉的棋子（用于撤销）
 */
export function makeMove(board, ff, fr, tf, tr) {
  const moving = board.get(ff, fr);
  const captured = board.get(tf, tr);
  board.set(tf, tr, moving);
  board.set(ff, fr, null);
  return captured;
}

/** 撤销 makeMove */
export function unmakeMove(board, ff, fr, tf, tr, captured) {
  const moving = board.get(tf, tr);
  board.set(ff, fr, moving);
  board.set(tf, tr, captured || null);
}

// ---------------------------------------------------------------------------
// 伪合法走法生成（不过滤自杀 / 白脸将）
// ---------------------------------------------------------------------------

/** 把一个目标点加入结果（若为己方子则跳过） */
function pushIfOk(board, out, side, f, r) {
  if (!inBoard(f, r)) return false;
  const t = board.get(f, r);
  if (t && t.side === side) return false;
  out.push({ file: f, rank: r, capture: !!t });
  return !t; // 返回"该格是否为空"，供滑行类棋子继续
}

/** 将/帅：九宫内单步直行 */
function genKing(board, f, r, side, out) {
  for (const [df, dr] of ORTHO) {
    const nf = f + df, nr = r + dr;
    if (!inPalace(nf, nr, side)) continue;
    pushIfOk(board, out, side, nf, nr);
  }
}

/** 士/仕：九宫内单步斜行 */
function genAdvisor(board, f, r, side, out) {
  for (const [df, dr] of DIAG) {
    const nf = f + df, nr = r + dr;
    if (!inPalace(nf, nr, side)) continue;
    pushIfOk(board, out, side, nf, nr);
  }
}

/** 象/相：田字，塞象眼不可走，不可过河 */
function genElephant(board, f, r, side, out) {
  for (const [df, dr] of DIAG) {
    const nf = f + df * 2, nr = r + dr * 2;
    if (!inBoard(nf, nr)) continue;
    if (!isOwnHalf(nr, side)) continue;              // 不可过河
    if (board.get(f + df, r + dr)) continue;         // 塞象眼
    pushIfOk(board, out, side, nf, nr);
  }
}

/** 马：日字，蹩马腿 */
function genHorse(board, f, r, side, out) {
  for (const [df, dr] of HORSE_DELTAS) {
    const nf = f + df, nr = r + dr;
    if (!inBoard(nf, nr)) continue;
    // 蹩马腿：横向走 2 格时检查横向相邻格，纵向走 2 格时检查纵向相邻格
    const legF = Math.abs(df) === 2 ? f + df / 2 : f;
    const legR = Math.abs(dr) === 2 ? r + dr / 2 : r;
    if (board.get(legF, legR)) continue;
    pushIfOk(board, out, side, nf, nr);
  }
}

/** 车：直线任意步，路径不可有子 */
function genRook(board, f, r, side, out) {
  for (const [df, dr] of ORTHO) {
    let nf = f + df, nr = r + dr;
    while (inBoard(nf, nr)) {
      const empty = pushIfOk(board, out, side, nf, nr);
      if (!empty) break;      // 撞到任何子（无论敌我）就停
      nf += df; nr += dr;
    }
  }
}

/** 炮：不吃子时同车；吃子时路径上恰好一个炮架 */
function genCannon(board, f, r, side, out) {
  for (const [df, dr] of ORTHO) {
    let nf = f + df, nr = r + dr;
    // 阶段一：空格随便走
    while (inBoard(nf, nr) && !board.get(nf, nr)) {
      out.push({ file: nf, rank: nr, capture: false });
      nf += df; nr += dr;
    }
    if (!inBoard(nf, nr)) continue;
    // (nf, nr) 是炮架，越过它寻找第一个子
    nf += df; nr += dr;
    while (inBoard(nf, nr)) {
      const t = board.get(nf, nr);
      if (t) {
        if (t.side !== side) out.push({ file: nf, rank: nr, capture: true });
        break;
      }
      nf += df; nr += dr;
    }
  }
}

/** 兵/卒：过河前只能向前；过河后可向前或横走；永不后退 */
function genPawn(board, f, r, side, out) {
  const fwd = forwardDir(side);
  pushIfOk(board, out, side, f, r + fwd);
  if (hasCrossedRiver(r, side)) {
    pushIfOk(board, out, side, f - 1, r);
    pushIfOk(board, out, side, f + 1, r);
  }
}

/**
 * 生成伪合法走法（未过滤自杀与白脸将）
 * @param {import('./board.js').Board} board
 * @returns {Array<{file:number, rank:number, capture:boolean}>}
 */
export function generatePseudoMoves(board, file, rank) {
  const p = board.get(file, rank);
  if (!p) return [];
  const out = [];
  switch (p.type) {
    case PT.KING: genKing(board, file, rank, p.side, out); break;
    case PT.ADVISOR: genAdvisor(board, file, rank, p.side, out); break;
    case PT.ELEPHANT: genElephant(board, file, rank, p.side, out); break;
    case PT.HORSE: genHorse(board, file, rank, p.side, out); break;
    case PT.ROOK: genRook(board, file, rank, p.side, out); break;
    case PT.CANNON: genCannon(board, file, rank, p.side, out); break;
    case PT.PAWN: genPawn(board, file, rank, p.side, out); break;
    default: break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 攻击 / 将军判定
// ---------------------------------------------------------------------------

/** (f, r) 上是否站着 side 方的兵/卒 */
function isPawnAt(board, f, r, side) {
  const p = board.get(f, r);
  return !!p && p.side === side && p.type === PT.PAWN;
}

/**
 * 判定 (f, r) 这一格是否被 bySide 方攻击。
 * 注意：包含"白脸将"——若沿同一纵线第一个遇到的子是敌方将/帅，视为攻击。
 * 士与象永远够不到对方九宫，故不参与判定。
 */
export function isAttacked(board, f, r, bySide) {
  // —— 1. 四正方向扫描：车 / 炮 / 将（白脸将） ——
  for (let d = 0; d < 4; d++) {
    const df = ORTHO[d][0], dr = ORTHO[d][1];
    let x = f + df, y = r + dr;
    let first = null, fx = 0, fy = 0;
    while (inBoard(x, y)) {
      const p = board.get(x, y);
      if (p) { first = p; fx = x; fy = y; break; }
      x += df; y += dr;
    }
    if (first && first.side === bySide) {
      if (first.type === PT.ROOK) return true;
      if (first.type === PT.KING) {
        // 同一纵线中间无子 -> 白脸将；或紧贴（理论上不会出现，保险起见也算）
        if (df === 0) return true;
        if (Math.abs(fx - f) + Math.abs(fy - r) === 1) return true;
      }
    }
    if (first) {
      // 越过炮架继续找第一个子，若是敌方炮则被攻击
      let x2 = fx + df, y2 = fy + dr;
      while (inBoard(x2, y2)) {
        const q = board.get(x2, y2);
        if (q) {
          if (q.side === bySide && q.type === PT.CANNON) return true;
          break;
        }
        x2 += df; y2 += dr;
      }
    }
  }

  // —— 2. 马（反推：哪些位置的马能踩到这里） ——
  for (let i = 0; i < HORSE_DELTAS.length; i++) {
    const hf = f + HORSE_DELTAS[i][0];
    const hr = r + HORSE_DELTAS[i][1];
    if (!inBoard(hf, hr)) continue;
    const p = board.get(hf, hr);
    if (!p || p.side !== bySide || p.type !== PT.HORSE) continue;
    const ddf = f - hf, ddr = r - hr;
    const legF = Math.abs(ddf) === 2 ? hf + ddf / 2 : hf;
    const legR = Math.abs(ddr) === 2 ? hr + ddr / 2 : hr;
    if (!board.get(legF, legR)) return true;   // 未蹩马腿
  }

  // —— 3. 兵 / 卒 ——
  if (bySide === RED) {
    // 红兵向 rank 递减方向走：位于 (f, r+1) 的红兵正面攻击 (f, r)
    if (isPawnAt(board, f, r + 1, RED)) return true;
    // 横向攻击：横走的红兵与目标同 rank，其 rank = r，需已过河（r <= 4）
    if (r <= 4 && (isPawnAt(board, f - 1, r, RED) || isPawnAt(board, f + 1, r, RED))) return true;
  } else {
    if (isPawnAt(board, f, r - 1, BLACK)) return true;
    if (r >= 5 && (isPawnAt(board, f - 1, r, BLACK) || isPawnAt(board, f + 1, r, BLACK))) return true;
  }

  return false;
}

/**
 * 双方将帅是否在同一纵线且中间无子（白脸将 / 对面笑）——该局面非法
 */
export function isFacingKings(state) {
  const board = getBoard(state);
  const rk = board.findKing(RED);
  const bk = board.findKing(BLACK);
  if (!rk || !bk) return false;
  if (rk.file !== bk.file) return false;
  const lo = Math.min(rk.rank, bk.rank) + 1;
  const hi = Math.max(rk.rank, bk.rank);
  for (let r = lo; r < hi; r++) {
    if (board.get(rk.file, r)) return false;
  }
  return true;
}

/**
 * 某方是否被将军（含白脸将）
 * @param {Object} state { board } 或 Board
 * @param {string} side
 */
export function isInCheck(state, side) {
  const board = getBoard(state);
  const k = board.findKing(side);
  if (!k) return true;      // 将帅不在 => 视为已被将死
  return isAttacked(board, k.file, k.rank, opposite(side));
}

// ---------------------------------------------------------------------------
// 合法走法
// ---------------------------------------------------------------------------

/**
 * 生成某个棋子**已过滤自杀与白脸将**的合法走法
 * @param {Object} state { board } 或 Board
 * @param {number} file
 * @param {number} rank
 * @returns {Array<{file:number, rank:number, capture:boolean}>}
 */
export function generateLegalMoves(state, file, rank) {
  const board = getBoard(state);
  const piece = board.get(file, rank);
  if (!piece) return [];
  const pseudo = generatePseudoMoves(board, file, rank);
  const legal = [];
  for (let i = 0; i < pseudo.length; i++) {
    const m = pseudo[i];
    const captured = makeMove(board, file, rank, m.file, m.rank);
    // isInCheck 已包含白脸将判定（同纵线首子为敌将 => 被攻击）
    const illegal = isInCheck(board, piece.side);
    unmakeMove(board, file, rank, m.file, m.rank, captured);
    if (!illegal) legal.push(m);
  }
  return legal;
}

/**
 * 生成某一方全部合法走法
 * @returns {Array<{from:{file,rank}, to:{file,rank}, capture:boolean, type:string}>}
 */
export function generateAllLegalMoves(state, side) {
  const board = getBoard(state);
  const out = [];
  board.forEachSide(side, (p, f, r) => {
    const moves = generateLegalMoves(board, f, r);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      out.push({
        from: { file: f, rank: r },
        to: { file: m.file, rank: m.rank },
        capture: m.capture,
        type: p.type
      });
    }
  });
  return out;
}

/** 该方是否还有任何合法走法（短路，比 generateAll 快） */
export function hasAnyLegalMove(state, side) {
  const board = getBoard(state);
  const list = board.listSide(side);
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (generateLegalMoves(board, it.file, it.rank).length > 0) return true;
  }
  return false;
}

/** 判断一步走法是否合法 */
export function isLegalMove(state, ff, fr, tf, tr) {
  const moves = generateLegalMoves(state, ff, fr);
  for (let i = 0; i < moves.length; i++) {
    if (moves[i].file === tf && moves[i].rank === tr) return true;
  }
  return false;
}

/**
 * 走法被拒绝的原因（供 UI toast 说明，Windex 原则）
 * @returns {string|null} null 表示合法
 */
export function explainIllegal(state, ff, fr, tf, tr) {
  const board = getBoard(state);
  const piece = board.get(ff, fr);
  if (!piece) return '这里没有棋子';
  if (!inBoard(tf, tr)) return '目标点在棋盘外';
  const target = board.get(tf, tr);
  if (target && target.side === piece.side) return '不能吃自己的棋子';

  const pseudo = generatePseudoMoves(board, ff, fr);
  const reachable = pseudo.some(m => m.file === tf && m.rank === tr);

  if (!reachable) {
    switch (piece.type) {
      case PT.KING: return '将帅只能在九宫内走一步直线';
      case PT.ADVISOR: return '士只能在九宫内走斜线一步';
      case PT.ELEPHANT: {
        if (!isOwnHalf(tr, piece.side)) return '象不可过河';
        if (Math.abs(tf - ff) === 2 && Math.abs(tr - fr) === 2) return '塞象眼：田字中心有子';
        return '象走田字';
      }
      case PT.HORSE: {
        const df = tf - ff, dr = tr - fr;
        if ((Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1)) {
          return '蹩马腿：马脚位置有子';
        }
        return '马走日字';
      }
      case PT.ROOK: {
        if (tf !== ff && tr !== fr) return '车只能走直线';
        return '车的路径上有棋子挡住';
      }
      case PT.CANNON: {
        if (tf !== ff && tr !== fr) return '炮只能走直线';
        if (target) return '炮吃子需要且只需要一个炮架';
        return '炮的路径上有棋子挡住';
      }
      case PT.PAWN: {
        const fwd = forwardDir(piece.side);
        if ((tr - fr) === -fwd) return '兵卒不可后退';
        if (tr === fr && !hasCrossedRiver(fr, piece.side)) return '兵卒过河后才能横走';
        return '兵卒每次只能走一步';
      }
      default: return '这步棋走不了';
    }
  }

  // 可达但会自杀 / 白脸将
  const captured = makeMove(board, ff, fr, tf, tr);
  const facing = isFacingKings(board);
  const inCheck = isInCheck(board, piece.side);
  unmakeMove(board, ff, fr, tf, tr, captured);
  if (facing) return '白脸将：双方将帅不可在同一纵线上直接照面';
  if (inCheck) return '这步棋会让自己的帅被将军';
  return null;
}

/**
 * 返回因**蹩马腿 / 塞象眼 / 象不可过河**而被阻挡的目标点（Windex：UI 显示灰色叉号）
 * @returns {Array<{file:number, rank:number, reason:'leg'|'eye'|'river'}>}
 */
export function getBlockers(state, file, rank) {
  const board = getBoard(state);
  const p = board.get(file, rank);
  if (!p) return [];
  const out = [];

  if (p.type === PT.HORSE) {
    for (const [df, dr] of HORSE_DELTAS) {
      const nf = file + df, nr = rank + dr;
      if (!inBoard(nf, nr)) continue;
      const t = board.get(nf, nr);
      if (t && t.side === p.side) continue;          // 己方子不算"被阻挡"，本来就不能去
      const legF = Math.abs(df) === 2 ? file + df / 2 : file;
      const legR = Math.abs(dr) === 2 ? rank + dr / 2 : rank;
      if (board.get(legF, legR)) out.push({ file: nf, rank: nr, reason: 'leg' });
    }
  } else if (p.type === PT.ELEPHANT) {
    for (const [df, dr] of DIAG) {
      const nf = file + df * 2, nr = rank + dr * 2;
      if (!inBoard(nf, nr)) continue;
      const t = board.get(nf, nr);
      if (t && t.side === p.side) continue;
      if (!isOwnHalf(nr, p.side)) { out.push({ file: nf, rank: nr, reason: 'river' }); continue; }
      if (board.get(file + df, rank + dr)) out.push({ file: nf, rank: nr, reason: 'eye' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 局面状态
// ---------------------------------------------------------------------------

/**
 * 局面状态
 * @param {Object} state { board } 或 Board
 * @param {string} sideToMove 轮到走棋的一方
 * @returns {'playing'|'check'|'checkmate'|'stalemate'}
 *   注意：中国象棋中"困毙（stalemate）"判负，不是和棋。
 */
export function getGameStatus(state, sideToMove) {
  const board = getBoard(state);
  const check = isInCheck(board, sideToMove);
  const canMove = hasAnyLegalMove(board, sideToMove);
  if (!canMove) return check ? 'checkmate' : 'stalemate';
  return check ? 'check' : 'playing';
}

/** 被将军的一方的将/帅坐标（UI 脉冲用），未被将军返回 null */
export function getCheckedKing(state, side) {
  const board = getBoard(state);
  if (!isInCheck(board, side)) return null;
  return board.findKing(side);
}

/**
 * 找出正在攻击某方将帅的棋子坐标（UI 可画攻击线，可选）
 */
export function getCheckingPieces(state, side) {
  const board = getBoard(state);
  const k = board.findKing(side);
  if (!k) return [];
  const foe = opposite(side);
  const out = [];
  board.forEachSide(foe, (p, f, r) => {
    if (p.type === PT.ADVISOR || p.type === PT.ELEPHANT) return;
    const moves = generatePseudoMoves(board, f, r);
    for (let i = 0; i < moves.length; i++) {
      if (moves[i].file === k.file && moves[i].rank === k.rank) { out.push({ file: f, rank: r, type: p.type }); break; }
    }
  });
  return out;
}
