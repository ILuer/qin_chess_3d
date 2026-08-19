/**
 * constants.js —— 全项目唯一真相源（坐标系 / 棋子 ID / 配色 / 名称表）
 * 纯数据 + 纯函数，**不依赖 Three.js**，可被 Web Worker 与 node 直接加载。
 * 契约参考：docs/CONTRACT.md 第 1、2、3 节。
 */

// ---------------------------------------------------------------------------
// 1. 棋盘尺寸与坐标系
// ---------------------------------------------------------------------------

/** 纵线数（列）：file 0..8，红方视角从左到右 */
export const FILES = 9;
/** 横线数（行）：rank 0 = 黑方底线，rank 9 = 红方底线 */
export const RANKS = 10;
/** 格距（世界单位） */
export const GRID = 1.0;
/** 格子总数 */
export const CELLS = FILES * RANKS;

/** 棋盘可视半宽 / 半深（不含边框） */
export const BOARD_HALF_W = (FILES - 1) * GRID / 2;   // 4.0
export const BOARD_HALF_D = (RANKS - 1) * GRID / 2;   // 4.5

/** 河界所在的世界 Z（rank 4 与 rank 5 之间） */
export const RIVER_Z = 0;

/** 九宫范围：file 3..5 */
export const PALACE_FILE_MIN = 3;
export const PALACE_FILE_MAX = 5;
/** 黑方九宫 rank 0..2；红方九宫 rank 7..9 */
export const PALACE_BLACK = { rankMin: 0, rankMax: 2 };
export const PALACE_RED = { rankMin: 7, rankMax: 9 };

// ---------------------------------------------------------------------------
// 2. 棋子规格（美术包围盒约束）
// ---------------------------------------------------------------------------

export const PIECE_BASE_RADIUS = 0.40;
export const PIECE_HEIGHT = 0.90;
export const PIECE_MAX_RADIUS = 0.44;

// ---------------------------------------------------------------------------
// 3. 阵营与棋子类型
// ---------------------------------------------------------------------------

export const RED = 'r';
export const BLACK = 'b';

/** 棋子类型 ID（字符串常量，全项目统一） */
export const PT = {
  KING: 'K',
  ADVISOR: 'A',
  ELEPHANT: 'B',
  HORSE: 'N',
  ROOK: 'R',
  CANNON: 'C',
  PAWN: 'P'
};

/** 所有棋子类型的数组形式，便于遍历 */
export const PIECE_TYPES = [PT.KING, PT.ADVISOR, PT.ELEPHANT, PT.HORSE, PT.ROOK, PT.CANNON, PT.PAWN];

/** 取对方阵营 */
export function opposite(side: string): string {
  return side === RED ? BLACK : RED;
}

// ---------------------------------------------------------------------------
// 4. 坐标转换（唯一实现，全员必须调用这里）
// ---------------------------------------------------------------------------

/**
 * 棋盘坐标 -> 世界坐标（XZ 平面，棋子站在 y = 0 之上）
 * @param {number} file 0..8
 * @param {number} rank 0..9
 * @returns {{x:number, z:number}}
 */
export function toWorld(file: number, rank: number): { x: number, z: number } {
  return { x: (file - 4) * GRID, z: (rank - 4.5) * GRID };
}

/**
 * 世界坐标 -> 最近的棋盘坐标；超出棋盘（含半格容差）返回 null
 * @param {number} x
 * @param {number} z
 * @returns {{file:number, rank:number}|null}
 */
export function fromWorld(x: number, z: number): { file: number, rank: number } | null {
  const file = Math.round(x / GRID + 4);
  const rank = Math.round(z / GRID + 4.5);
  if (file < 0 || file >= FILES || rank < 0 || rank >= RANKS) return null;
  return { file, rank };
}

/** 棋盘坐标 -> 一维索引 */
export function toIndex(file: number, rank: number): number {
  return rank * FILES + file;
}

/** 一维索引 -> 棋盘坐标 */
export function fromIndex(index: number): { file: number, rank: number } {
  return { file: index % FILES, rank: Math.floor(index / FILES) };
}

/** 是否在棋盘内 */
export function inBoard(file: number, rank: number): boolean {
  return file >= 0 && file < FILES && rank >= 0 && rank < RANKS;
}

// ---------------------------------------------------------------------------
// 5. 名称表（中文记谱 / UI 显示）
// ---------------------------------------------------------------------------

/** 棋子中文名：红黑各一套 */
export const PIECE_NAMES: Record<string, Record<string, string>> = {
  [RED]: {
    [PT.KING]: '帥', [PT.ADVISOR]: '仕', [PT.ELEPHANT]: '相',
    [PT.HORSE]: '馬', [PT.ROOK]: '俥', [PT.CANNON]: '炮', [PT.PAWN]: '兵'
  },
  [BLACK]: {
    [PT.KING]: '將', [PT.ADVISOR]: '士', [PT.ELEPHANT]: '象',
    [PT.HORSE]: '馬', [PT.ROOK]: '車', [PT.CANNON]: '砲', [PT.PAWN]: '卒'
  }
};

/** 阵营中文名 */
export const SIDE_NAMES: Record<string, string> = { [RED]: '红方', [BLACK]: '黑方' };

/**
 * 红方纵线名：按 file 索引。红方从右往左数 一..九。
 * file 8（红方最右）= 一，file 0（红方最左）= 九。
 */
export const FILE_NAMES_RED = ['九', '八', '七', '六', '五', '四', '三', '二', '一'];

/**
 * 黑方纵线名：按 file 索引。黑方从其右往左数 1..9。
 * 黑方的右 = 红方的左 = file 0 → '1'。
 */
export const FILE_NAMES_BLACK = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** 汉字数字（记谱用步数 / 目标线） */
export const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** 阿拉伯数字（黑方记谱用） */
export const AR_NUM = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** 记谱动作词 */
export const MOVE_VERB = { FORWARD: '进', BACKWARD: '退', LATERAL: '平' };

// ---------------------------------------------------------------------------
// 6. 初始局面
// ---------------------------------------------------------------------------

/** 标准初始局面 FEN（rank 0 -> rank 9，即黑方底线在前） */
export const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

/** FEN 字母 -> 棋子类型 */
export const FEN_TO_TYPE = {
  k: PT.KING, a: PT.ADVISOR, b: PT.ELEPHANT, e: PT.ELEPHANT,
  n: PT.HORSE, h: PT.HORSE, r: PT.ROOK, c: PT.CANNON, p: PT.PAWN
};

/** 棋子类型 -> FEN 小写字母（黑），大写为红 */
export const TYPE_TO_FEN = {
  [PT.KING]: 'k', [PT.ADVISOR]: 'a', [PT.ELEPHANT]: 'b', [PT.HORSE]: 'n',
  [PT.ROOK]: 'r', [PT.CANNON]: 'c', [PT.PAWN]: 'p'
};

/**
 * 初始布局数组（与 FEN 等价的显式写法，便于阅读与单测）
 * 每项：[type, side, file, rank]
 */
export const INITIAL_LAYOUT: Array<[string, string, number, number]> = (() => {
  const back: string[] = [PT.ROOK, PT.HORSE, PT.ELEPHANT, PT.ADVISOR, PT.KING, PT.ADVISOR, PT.ELEPHANT, PT.HORSE, PT.ROOK];
  const out: Array<[string, string, number, number]> = [];
  // 黑方（rank 0 底线，rank 2 砲，rank 3 卒）
  for (let f = 0; f < FILES; f++) out.push([back[f]!, BLACK, f, 0]);
  out.push([PT.CANNON, BLACK, 1, 2], [PT.CANNON, BLACK, 7, 2]);
  for (const f of [0, 2, 4, 6, 8]) out.push([PT.PAWN, BLACK, f, 3]);
  // 红方（rank 9 底线，rank 7 炮，rank 6 兵）
  for (let f = 0; f < FILES; f++) out.push([back[f]!, RED, f, 9]);
  out.push([PT.CANNON, RED, 1, 7], [PT.CANNON, RED, 7, 7]);
  for (const f of [0, 2, 4, 6, 8]) out.push([PT.PAWN, RED, f, 6]);
  return out;
})();

// ---------------------------------------------------------------------------
// 7. 子力价值（AI 评估 & UI 吃子陈列排序）
// ---------------------------------------------------------------------------

export const PIECE_VALUE = {
  [PT.KING]: 100000,
  [PT.ROOK]: 900,
  [PT.CANNON]: 450,
  [PT.HORSE]: 400,
  [PT.ELEPHANT]: 200,
  [PT.ADVISOR]: 200,
  [PT.PAWN]: 100
};
/** 过河兵价值 */
export const PAWN_CROSSED_VALUE = 200;

// ---------------------------------------------------------------------------
// 8. 秦式配色（玄黑 / 赤红 / 青铜 / 鎏金）
//    数值形式供 Three.js 使用；PALETTE.CSS 供 UI 层使用。
//    art-director 如需调整，通过 team-lead 转达后在此处统一落盘。
// ---------------------------------------------------------------------------

export const PALETTE = {
  // —— 基调 ——
  xuanHei: 0x14161a,        // 玄黑（秦尚黑水德）
  xuanHeiLight: 0x272b33,
  chiHong: 0xb0281f,        // 赤红
  chiHongLight: 0xd8483a,
  qingTong: 0x6f7d63,       // 青铜（带绿锈）
  qingTongDark: 0x3f4a3a,
  liuJin: 0xc9a227,         // 鎏金
  liuJinLight: 0xe8cf72,

  // —— 棋盘 ——
  boardBase: 0x3a2a1c,      // 台面主色（深木/夯土）
  boardBaseDark: 0x241a11,
  boardEdge: 0x1a1209,      // 外框
  boardLine: 0xc9a227,      // 界线（鎏金细线）
  boardLineSoft: 0x8a7030,
  riverText: 0xb9a06a,      // 楚河汉界文字
  palaceLine: 0xc07a2c,

  // —— 红方棋子 ——
  redBody: 0x8d2b20,
  redBodyDark: 0x5b1a12,
  redGlyph: 0xf3e3c0,
  redRim: 0xc9a227,
  redAccent: 0xe0574a,

  // —— 黑方棋子 ——
  blackBody: 0x1c1f26,
  blackBodyDark: 0x0d0f13,
  blackGlyph: 0xd8d2c2,
  blackRim: 0x7f8a6e,
  blackAccent: 0x6f7d63,

  // —— 环境 ——
  bg: 0x0a0b0e,
  fog: 0x0a0b0e,
  ground: 0x15161a,
  bannerRed: 0x8e1f18,
  bannerBlack: 0x16181d,
  keyLight: 0xfff2dc,
  fillLight: 0x3f6ea8,      // 偏冷补光
  rimLight: 0xffb45c,       // 暖色轮廓光
  hemiSky: 0x5a6a80,
  hemiGround: 0x241a11,

  // —— 交互反馈 ——
  select: 0xffd35c,         // 选中光环
  hintEmpty: 0x6fd6a8,      // 可走空点
  hintCapture: 0xff4d3d,    // 可吃点（危险环）
  hintBlocked: 0x9aa0a8,    // 蹩马腿 / 塞象眼 灰叉
  lastMoveFrom: 0x7fa8d8,
  lastMoveTo: 0xffc861,
  checkGlow: 0xff2b1d,
  hover: 0xfff0c0,

  /** UI / CSS 用色（字符串） */
  CSS: {
    xuanHei: '#14161a',
    chiHong: '#b0281f',
    chiHongLight: '#d8483a',
    qingTong: '#6f7d63',
    liuJin: '#c9a227',
    liuJinLight: '#e8cf72',
    parchment: '#e6dcc3',
    ink: '#0f1013',
    panelBg: 'rgba(16,17,21,0.86)',
    panelBorder: 'rgba(201,162,39,0.42)',
    red: '#d8483a',
    black: '#c9ccd4',
    check: '#ff2b1d',
    ok: '#6fd6a8'
  }
};

/** 十六进制数值 -> CSS 颜色串 */
export function hexToCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// 9. 动画 / 交互调参（Juice 相关的统一时间常量，单位：秒）
// ---------------------------------------------------------------------------

export const TIMING = {
  moveDuration: 0.38,       // 普通移动
  captureLunge: 0.12,       // 吃子冲刺
  strikeRecoil: 0.18,       // 吃子斩杀姿态（前刺回弹）时长
  captureDissolve: 0.42,    // 被吃方消散
  liftHeight: 0.85,         // 抛物线最高点相对高度
  squashDuration: 0.16,     // 落子回弹
  hintFade: 0.18,
  viewTween: 0.75,          // 视角切换插值时长
  toastLife: 3.0
};

/** 无吃子提示阈值（半回合数）：60 个回合 = 120 半回合 */
export const DRAW_HALFMOVE_HINT = 120;
/** 自动判和阈值（半回合数） */
export const DRAW_HALFMOVE_LIMIT = 240;

// ---------------------------------------------------------------------------
// 10. 战场演出节拍参数（来源：design/action-system.md §2.2 / §3.2 / §5.4）
// ---------------------------------------------------------------------------

/** 移动节拍固定拍长（秒） */
export const MOVE_BEAT = {
  M0: { default: 0.09, R: 0.12, B: 0.10 },
  M1: { default: 0.05 },
  M3: { default: 0.05, R: 0.07, C: 0.06 },
  M4: { default: 0.15, A: 0.13 },
  M5: { default: 0.10, A: 0.08 }
};

/** M2 巡航时长（秒），按兵种 PT 键 */
export const MOVE_CRUISE = {
  P: 0.14, N: 0.08, B: 0.16, A: 0.08,
  R: 0.22, C: 0.18, K: 0.12
};

/** 吃子节拍参数（秒），按兵种 PT 键 */
export const CAPTURE_BEAT = {
  P: { A0_clamp: [0.10, 0.14], A1: 0.13, A2: 0.09, A3: 0.09, A5: 0.24 },
  N: { A0_clamp: [0.08, 0.08], A1: 0.15, A2: 0.09, A3: 0.10, A5: 0.28 },
  B: { A0_clamp: [0.10, 0.16], A1: 0.18, A2: 0.09, A3: 0.11, A5: 0.32 },
  A: { A0_clamp: [0.08, 0.08], A1: 0.13, A2: 0.08, A3: 0.09, A5: 0.26 },
  R: { A0_clamp: [0.10, 0.22], A1: 0.16, A2: 0.09, A3: 0.11, A5: 0.30 },
  C: { A0_clamp: [0.10, 0.18], A1: 0.22, A2: 0.07, A3: 0.09, A5: 0.36 },
  K: { A0_clamp: [0.10, 0.12], A1: 0.17, A2: 0.08, A3: 0.12, A5: 0.30 }
};

/** Hitstop 时长（秒），按冲击级 */
export const HITSTOP = {
  L2: 0,       // 普通走子
  L3: 0.09,    // 吃普通子
  L4: 0.14,    // 吃大子+将军
  L5: 0.22     // 将死
};

/** 张力 timeScale 基调 */
export const TENSION_TIMESCALE = {
  opening:              1.00,
  midgame:              0.96,
  'endgame-balanced':   0.90,
  'endgame-one-sided':  0.95
};
