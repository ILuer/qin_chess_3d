/**
 * save.js —— M4 对局存档/恢复（纯逻辑 + localStorage 适配）
 *
 * 设计约束（优化实施方案 §4.3 M4）：
 *  - 只持久化「已结算状态」（棋盘 FEN + 走子历史 + 配置），不持久化 AI 思考中。
 *  - Schema 带版本号，只增不改，向前兼容；未来升级在此做迁移。
 *  - D9 拍板：MVP 用 last-write-wins，不做 storage 跨标签页同步。
 *  - localStorage 不可用（隐私模式 / 被禁）时 try/catch 静默降级，绝不崩溃。
 *
 * Schema v1：
 * {
 *   v: 1,                       // Schema 版本
 *   fen: string,                // 完整 FEN（gs.toFen()，当前局面，含 side / halfMoveClock / moveNumber）
 *   startFen: string,           // 起始局面 FEN（重放起点；与 fen 共同支撑「重放后 toFen()===fen」校验）
 *   sideToMove: 'r' | 'b',
 *   halfMoveClock: number,
 *   moves: [{from:{file,rank}, to:{file,rank}}],   // 按序走子历史
 *   aiEnabled: boolean,
 *   difficulty: number,         // 1..4（4 = 大师，仅 worker 模式）
 *   savedAt: number             // 写入时间戳（诊断用）
 * }
 *
 * 说明：M4 恢复采用「fromFen(startFen) + 重放 moves → 校验 toFen()===fen」。
 * 因此必须同时保存 startFen（重放起点）与 fen（当前局面快照），两者缺一不可——
 * 若只存当前 fen，重放会把已走的棋再走一遍（双重落子）。startFen 为 v1 新增字段（只增不改）。
 *
 * 本模块不依赖 Three.js；可在 node 直接加载（storage 用注入或空实现）。
 */

export const SAVE_KEY = 'qin-chess-save-v1';
export const SAVE_VERSION = 1;

/** 取 localStorage；不可用时返回 null（调用方再各自兜底） */
function safeStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

/**
 * 从 GameState 构建存档（不写盘）
 * @param {{toFen():string, sideToMove:string, halfMoveClock:number, history:Array}} gs
 * @param {{aiEnabled:boolean, difficulty:number}} cfg
 */
export function buildSave(gs, cfg) {
  return {
    v: SAVE_VERSION,
    fen: gs.toFen(),
    startFen: gs.startFen || `${gs.board.toFen()} ${gs.sideToMove === 'b' ? 'b' : 'w'} - - 0 1`,
    sideToMove: gs.sideToMove,
    halfMoveClock: gs.halfMoveClock,
    moves: gs.history.map(r => ({
      from: { file: r.from.file, rank: r.from.rank },
      to: { file: r.to.file, rank: r.to.rank }
    })),
    aiEnabled: !!cfg.aiEnabled,
    difficulty: cfg.difficulty,
    savedAt: Date.now()
  };
}

/**
 * 校验 + 归一化原始存档；损坏 / 旧版本 / 字段越界返回 null（调用方降级为无存档）。
 * @param {any} raw
 * @returns {object|null}
 */
export function normalizeSave(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (Number(raw.v) !== SAVE_VERSION) return null;   // 旧档 / 未来档：先降级为无存档（迁移在此扩展）
  if (typeof raw.fen !== 'string' || !raw.fen.trim()) return null;
  if (typeof raw.startFen !== 'string' || !raw.startFen.trim()) return null;
  if (raw.sideToMove !== 'r' && raw.sideToMove !== 'b') return null;
  if (!Array.isArray(raw.moves)) return null;

  const moves = [];
  for (const m of raw.moves) {
    if (!m || !m.from || !m.to) return null;
    const f1 = Number(m.from.file), r1 = Number(m.from.rank);
    const f2 = Number(m.to.file), r2 = Number(m.to.rank);
    if (!Number.isInteger(f1) || !Number.isInteger(r1) || !Number.isInteger(f2) || !Number.isInteger(r2)) return null;
    if (f1 < 0 || f1 > 8 || r1 < 0 || r1 > 9 || f2 < 0 || f2 > 8 || r2 < 0 || r2 > 9) return null;
    moves.push({ from: { file: f1, rank: r1 }, to: { file: f2, rank: r2 } });
  }

  const difficulty = Number(raw.difficulty);
  return {
    v: SAVE_VERSION,
    fen: raw.fen,
    startFen: raw.startFen,
    sideToMove: raw.sideToMove,
    halfMoveClock: Number(raw.halfMoveClock) || 0,
    moves,
    aiEnabled: raw.aiEnabled !== false,
    difficulty: Number.isInteger(difficulty) && difficulty >= 1 && difficulty <= 4 ? difficulty : 2,
    savedAt: Number(raw.savedAt) || 0
  };
}

/** 读取存档；无档 / 损坏 / localStorage 不可用一律返回 null */
export function loadSave(storage = safeStorage()) {
  try {
    if (!storage) return null;
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return null;
    return normalizeSave(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

/** 写入存档（localStorage 不可用返回 false，不抛错） */
export function writeSave(save, storage = safeStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch (e) {
    return false;
  }
}

/** 清除存档（对局结束 / 重开时调用；不可用返回 false，不抛错） */
export function clearSave(storage = safeStorage()) {
  try {
    if (!storage) return false;
    storage.removeItem(SAVE_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

export default { SAVE_KEY, SAVE_VERSION, buildSave, normalizeSave, loadSave, writeSave, clearSave };
