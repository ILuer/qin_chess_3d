/**
 * board.js —— 纯数据棋盘模型
 * **不依赖 Three.js**，可被 node / Web Worker 直接加载，便于单元测试。
 *
 * 存储：90 格一维数组，index = rank * 9 + file
 * 每格为 null 或 { type, side }（type ∈ PT，side ∈ 'r'|'b'）
 */

import {
  FILES, RANKS, CELLS, RED, BLACK, PT,
  INITIAL_LAYOUT, FEN_TO_TYPE, TYPE_TO_FEN,
  PALACE_FILE_MIN, PALACE_FILE_MAX, PALACE_RED, PALACE_BLACK
} from './constants.ts';

/** 棋盘格内容：null 或棋子 { type, side } */
export interface Piece {
  type: string;
  side: string;
}

type Cell = Piece | null;

export class Board {
  cells: Array<Cell>;

  constructor(cells?: Array<Cell>) {
    this.cells = cells || new Array(CELLS).fill(null);
  }

  /** 棋盘坐标 -> 索引 */
  static index(file: number, rank: number): number { return rank * FILES + file; }

  /** 是否在棋盘内 */
  static inBoard(file: number, rank: number): boolean {
    return file >= 0 && file < FILES && rank >= 0 && rank < RANKS;
  }

  /**
   * 取格子内容
   * @returns {{type:string, side:string}|null} 越界返回 null
   */
  get(file: number, rank: number): Piece | null {
    if (file < 0 || file >= FILES || rank < 0 || rank >= RANKS) return null;
    return this.cells[rank * FILES + file] ?? null;
  }

  /** 设置格子内容（piece 可为 null） */
  set(file: number, rank: number, piece: Piece | null) {
    if (file < 0 || file >= FILES || rank < 0 || rank >= RANKS) return;
    this.cells[rank * FILES + file] = piece || null;
  }

  /** 该格是否为空 */
  isEmpty(file: number, rank: number): boolean { return this.get(file, rank) === null; }

  /** 深拷贝（棋子对象也复制，避免共享引用） */
  clone(): Board {
    const cells: Array<Cell> = new Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      const p = this.cells[i];
      cells[i] = p ? { type: p.type, side: p.side } : null;
    }
    return new Board(cells);
  }

  /** 清空 */
  clear(): void { this.cells.fill(null); }

  /**
   * 遍历所有非空格
   * @param {(piece:{type:string,side:string}, file:number, rank:number, index:number)=>void} fn
   */
  forEach(fn: (piece: Piece, file: number, rank: number, index: number) => void): void {
    for (let i = 0; i < CELLS; i++) {
      const p = this.cells[i];
      if (p) fn(p, i % FILES, (i / FILES) | 0, i);
    }
  }

  /**
   * 遍历某一方的所有棋子
   * @param {string} side
   * @param {(piece:Object, file:number, rank:number, index:number)=>void} fn
   */
  forEachSide(side: string, fn: (piece: Piece, file: number, rank: number, index: number) => void): void {
    for (let i = 0; i < CELLS; i++) {
      const p = this.cells[i];
      if (p && p.side === side) fn(p, i % FILES, (i / FILES) | 0, i);
    }
  }

  /**
   * 查找某方的将/帅。
   * 将帅永不出九宫，因此只需扫描 9 格；找不到时回退全盘扫描（残局编辑容错）。
   * @returns {{file:number, rank:number}|null}
   */
  findKing(side: string): { file: number, rank: number } | null {
    const pal = side === RED ? PALACE_RED : PALACE_BLACK;
    for (let r = pal.rankMin; r <= pal.rankMax; r++) {
      for (let f = PALACE_FILE_MIN; f <= PALACE_FILE_MAX; f++) {
        const p = this.cells[r * FILES + f];
        if (p && p.type === PT.KING && p.side === side) return { file: f, rank: r };
      }
    }
    for (let i = 0; i < CELLS; i++) {
      const p = this.cells[i];
      if (p && p.type === PT.KING && p.side === side) {
        return { file: i % FILES, rank: (i / FILES) | 0 };
      }
    }
    return null;
  }

  /** 统计某方棋子数量 */
  countSide(side: string): number {
    let n = 0;
    for (let i = 0; i < CELLS; i++) {
      const p = this.cells[i];
      if (p && p.side === side) n++;
    }
    return n;
  }

  /** 列出某方全部棋子 [{type, side, file, rank}] */
  listSide(side: string): Array<{ type: string, side: string, file: number, rank: number }> {
    const out: Array<{ type: string, side: string, file: number, rank: number }> = [];
    for (let i = 0; i < CELLS; i++) {
      const p = this.cells[i];
      if (p && p.side === side) out.push({ type: p.type, side: p.side, file: i % FILES, rank: (i / FILES) | 0 });
    }
    return out;
  }

  /** 是否只剩将帅（用于判和） */
  isBareKings(): boolean {
    for (let i = 0; i < CELLS; i++) {
      const p = this.cells[i];
      if (p && p.type !== PT.KING) return false;
    }
    return true;
  }

  /**
   * 同一纵线上同类型同阵营的棋子（按 rank 升序），用于中文记谱的"前/后"判定
   * @returns {Array<{file:number, rank:number}>}
   */
  sameFileSameType(file: number, type: string, side: string): Array<{ file: number, rank: number }> {
    const out: Array<{ file: number, rank: number }> = [];
    for (let r = 0; r < RANKS; r++) {
      const p = this.cells[r * FILES + file];
      if (p && p.type === type && p.side === side) out.push({ file, rank: r });
    }
    return out;
  }

  /** 导出 FEN 棋子部分（rank 0 -> rank 9） */
  toFen(): string {
    const rows: string[] = [];
    for (let r = 0; r < RANKS; r++) {
      let row = '', empty = 0;
      for (let f = 0; f < FILES; f++) {
        const p = this.cells[r * FILES + f];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        // TYPE_TO_FEN 覆盖全部 PT 键，`!` 断言安全（noUncheckedIndexedAccess 下索引可能 undefined）
        const ch = TYPE_TO_FEN[p.type]!;
        row += p.side === RED ? ch.toUpperCase() : ch;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/');
  }

  /** 简易局面哈希（字符串），用于重复局面检测 */
  hash(): string { return this.toFen(); }
}

/**
 * 从 FEN 棋子部分构建棋盘
 * @param {string} fen 可以是完整 FEN，也可以只有棋子部分
 */
export function boardFromFen(fen: string): Board {
  const board = new Board();
  const placement = String(fen).trim().split(/\s+/)[0]!;
  const rows = placement.split('/');
  for (let r = 0; r < rows.length && r < RANKS; r++) {
    let f = 0;
    for (const ch of rows[r] ?? '') {
      if (f >= FILES) break;
      if (ch >= '1' && ch <= '9') { f += Number(ch); continue; }
      const lower = ch.toLowerCase();
      const type = (FEN_TO_TYPE as Record<string, string | undefined>)[lower];
      if (!type) continue;
      board.set(f, r, { type, side: ch === lower ? BLACK : RED });
      f++;
    }
  }
  return board;
}

/**
 * 构建标准初始局面
 * @returns {Board}
 */
export function createInitialBoard(): Board {
  const board = new Board();
  for (const [type, side, file, rank] of INITIAL_LAYOUT) {
    board.set(file, rank, { type, side });
  }
  return board;
}

/**
 * 从 [{type, side, file, rank}] 列表构建棋盘（单测 / 残局用）
 */
export function boardFromList(list: Array<{ type: string, side: string, file: number, rank: number } | [string, string, number, number]>): Board {
  const board = new Board();
  for (const it of list) {
    if (Array.isArray(it)) {
      const [type, side, file, rank] = it;
      board.set(file, rank, { type, side });
    } else {
      board.set(it.file, it.rank, { type: it.type, side: it.side });
    }
  }
  return board;
}

export default Board;
