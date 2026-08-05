/**
 * rules.test.mjs —— 规则引擎自测（node 直接运行，无依赖）
 * 运行：node tests/rules.test.mjs
 */

import { RED, BLACK, PT } from '../src/core/constants.js';
import { createInitialBoard, boardFromList, Board } from '../src/core/board.js';
import {
  generateLegalMoves, generateAllLegalMoves, generatePseudoMoves,
  isInCheck, isFacingKings, getGameStatus, getBlockers, explainIllegal, isLegalMove
} from '../src/core/rules.js';
import { GameState } from '../src/core/gameState.js';

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  \u2713 ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; failures.push(name); console.log(`  \u2717 ${name}  ${extra}`); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function section(t) { console.log(`\n== ${t} ==`); }

const has = (moves, f, r) => moves.some(m => m.file === f && m.rank === r);

// ---------------------------------------------------------------------------
section('1. 初始局面走法总数');

const init = createInitialBoard();
const redAll = generateAllLegalMoves(init, RED);
const blackAll = generateAllLegalMoves(init, BLACK);
eq('初始局面红方合法走法总数 = 44', redAll.length, 44);
eq('初始局面黑方合法走法总数 = 44', blackAll.length, 44);

// 分子力核对
const countBy = (list, type) => list.filter(m => m.type === type).length;
eq('  其中 兵  = 5', countBy(redAll, PT.PAWN), 5);
eq('  其中 马  = 4', countBy(redAll, PT.HORSE), 4);
eq('  其中 车  = 4', countBy(redAll, PT.ROOK), 4);
eq('  其中 炮  = 24', countBy(redAll, PT.CANNON), 24);
eq('  其中 相  = 4', countBy(redAll, PT.ELEPHANT), 4);
eq('  其中 仕  = 2', countBy(redAll, PT.ADVISOR), 2);
eq('  其中 帅  = 1', countBy(redAll, PT.KING), 1);
eq('初始局面双方均未被将军', isInCheck(init, RED) || isInCheck(init, BLACK), false);
eq('初始局面状态 = playing', getGameStatus(init, RED), 'playing');

// ---------------------------------------------------------------------------
section('2. 蹩马腿');

{
  const b = createInitialBoard();
  const before = generateLegalMoves(b, 1, 9);
  eq('初始红马(1,9) 有 2 步', before.length, 2);
  ok('  含 (0,7)', has(before, 0, 7));
  ok('  含 (2,7)', has(before, 2, 7));
  ok('  不含 (3,8)（被相(2,9)蹩腿）', !has(before, 3, 8));

  b.set(1, 8, { type: PT.PAWN, side: RED });    // 堵住马腿
  const after = generateLegalMoves(b, 1, 9);
  eq('马腿(1,8)被堵后 红马(1,9) 有 0 步', after.length, 0);

  const blk = getBlockers(b, 1, 9);
  ok('getBlockers 报出被蹩腿的点 (0,7)', blk.some(p => p.file === 0 && p.rank === 7 && p.reason === 'leg'));
  ok('getBlockers 报出被蹩腿的点 (2,7)', blk.some(p => p.file === 2 && p.rank === 7 && p.reason === 'leg'));
}

{
  // 空盘单马：中央的马应有 8 步
  const b = boardFromList([
    [PT.HORSE, RED, 4, 5], [PT.KING, RED, 4, 9], [PT.KING, BLACK, 3, 0]
  ]);
  eq('空盘中央马 8 步', generateLegalMoves(b, 4, 5).length, 8);
  b.set(4, 6, { type: PT.PAWN, side: BLACK });  // 蹩掉两个方向
  eq('纵向马腿被堵后 6 步', generateLegalMoves(b, 4, 5).length, 6);
  b.set(3, 5, { type: PT.PAWN, side: BLACK });  // 再蹩横向
  eq('再堵横向马腿后 4 步', generateLegalMoves(b, 4, 5).length, 4);
}

// ---------------------------------------------------------------------------
section('3. 塞象眼 / 象不可过河');

{
  const b = createInitialBoard();
  eq('初始红相(2,9) 有 2 步', generateLegalMoves(b, 2, 9).length, 2);
  b.set(1, 8, { type: PT.PAWN, side: RED });   // 塞象眼
  const mv = generateLegalMoves(b, 2, 9);
  eq('塞象眼后 红相(2,9) 只剩 1 步', mv.length, 1);
  ok('  剩下的是 (4,7)', has(mv, 4, 7));
  const blk = getBlockers(b, 2, 9);
  ok('getBlockers 报出塞象眼点 (0,7)', blk.some(p => p.file === 0 && p.rank === 7 && p.reason === 'eye'));
}

{
  // 红相在 (2,5)：往前会过河，必须被拒绝
  const b = boardFromList([
    [PT.ELEPHANT, RED, 2, 5], [PT.KING, RED, 4, 9], [PT.KING, BLACK, 3, 0]
  ]);
  const mv = generateLegalMoves(b, 2, 5);
  eq('河边红相只有 2 步（不可过河）', mv.length, 2);
  ok('  含 (0,7)', has(mv, 0, 7));
  ok('  含 (4,7)', has(mv, 4, 7));
  ok('  不含 (0,3)', !has(mv, 0, 3));
  ok('  不含 (4,3)', !has(mv, 4, 3));
  const blk = getBlockers(b, 2, 5);
  eq('getBlockers 报出 2 个过河阻挡点', blk.filter(p => p.reason === 'river').length, 2);
}

// ---------------------------------------------------------------------------
section('4. 炮：翻山吃子 / 无炮架不可吃');

{
  const b = createInitialBoard();
  const mv = generateLegalMoves(b, 1, 7);      // 红炮二
  eq('初始红炮(1,7) 共 12 步', mv.length, 12);
  ok('  可翻过黑砲(1,2)吃黑马(1,0)', has(mv, 1, 0) && mv.find(m => m.file === 1 && m.rank === 0).capture === true);
  ok('  不可吃炮架本身(1,2)', !has(mv, 1, 2));
  ok('  可走空点(1,3)', has(mv, 1, 3));
}

{
  // 炮与目标之间无子 -> 不能吃
  const b = boardFromList([
    [PT.CANNON, RED, 0, 5], [PT.ROOK, BLACK, 0, 1],
    [PT.KING, RED, 4, 9], [PT.KING, BLACK, 3, 0]
  ]);
  ok('无炮架时炮不能吃', !has(generateLegalMoves(b, 0, 5), 0, 1));
  b.set(0, 3, { type: PT.PAWN, side: BLACK });   // 放一个炮架
  ok('有 1 个炮架时可以吃', has(generateLegalMoves(b, 0, 5), 0, 1));
  b.set(0, 2, { type: PT.PAWN, side: BLACK });   // 两个炮架
  ok('有 2 个炮架时不能吃', !has(generateLegalMoves(b, 0, 5), 0, 1));
}

// ---------------------------------------------------------------------------
section('5. 兵/卒：不后退、过河横走');

{
  const b = boardFromList([
    [PT.PAWN, RED, 4, 6], [PT.KING, RED, 4, 9], [PT.KING, BLACK, 3, 0]
  ]);
  const mv = generateLegalMoves(b, 4, 6);
  eq('未过河红兵只有 1 步', mv.length, 1);
  ok('  只能向前 (4,5)', has(mv, 4, 5));

  const b2 = boardFromList([
    [PT.PAWN, RED, 4, 4], [PT.KING, RED, 5, 9], [PT.KING, BLACK, 3, 0]
  ]);
  const mv2 = generateLegalMoves(b2, 4, 4);
  eq('过河红兵有 3 步', mv2.length, 3);
  ok('  含前 (4,3)', has(mv2, 4, 3));
  ok('  含左 (3,4)', has(mv2, 3, 4));
  ok('  含右 (5,4)', has(mv2, 5, 4));
  ok('  不含后退 (4,5)', !has(mv2, 4, 5));

  const b3 = boardFromList([
    [PT.PAWN, BLACK, 4, 5], [PT.KING, RED, 5, 9], [PT.KING, BLACK, 3, 0]
  ]);
  eq('过河黑卒有 3 步', generateLegalMoves(b3, 4, 5).length, 3);
  ok('黑卒不可后退 (4,4)', !has(generateLegalMoves(b3, 4, 5), 4, 4));
}

// ---------------------------------------------------------------------------
section('6. 白脸将（对面笑）');

{
  // 红帅(4,9) 黑将(4,0)，中间只有红车(4,5)。车一旦离开纵线 4 即白脸将 -> 非法
  const b = boardFromList([
    [PT.KING, RED, 4, 9], [PT.KING, BLACK, 4, 0], [PT.ROOK, RED, 4, 5]
  ]);
  ok('当前不是白脸将（有车挡着）', !isFacingKings(b));
  const mv = generateLegalMoves(b, 4, 5);
  ok('红车的所有合法走法都留在纵线 4 上', mv.every(m => m.file === 4), JSON.stringify(mv));
  ok('  不能横走到 (3,5)', !has(mv, 3, 5));
  ok('  可以纵向走到 (4,6)', has(mv, 4, 6));
  const why = explainIllegal(b, 4, 5, 3, 5);
  ok('explainIllegal 给出白脸将原因', !!why && why.includes('白脸将'), why || '');

  // 直接构造白脸将局面
  const b2 = boardFromList([[PT.KING, RED, 4, 9], [PT.KING, BLACK, 4, 0]]);
  ok('裸对脸局面 isFacingKings = true', isFacingKings(b2));
  ok('裸对脸时双方都算被将军', isInCheck(b2, RED) && isInCheck(b2, BLACK));

  // 红帅横移到纵线 4 会造成白脸将
  const b3 = boardFromList([[PT.KING, RED, 3, 9], [PT.KING, BLACK, 4, 0]]);
  ok('红帅不能走到 (4,9) 与黑将照面', !isLegalMove(b3, 3, 9, 4, 9));
}

// ---------------------------------------------------------------------------
section('7. 自杀走法过滤');

{
  // 黑车(4,4) 正对红帅(4,9)，中间红马(4,7) 是唯一屏障；马不能乱动
  const b = boardFromList([
    [PT.KING, RED, 4, 9], [PT.KING, BLACK, 3, 0],
    [PT.HORSE, RED, 4, 7], [PT.ROOK, BLACK, 4, 4]
  ]);
  ok('当前红方未被将军', !isInCheck(b, RED));
  const mv = generateLegalMoves(b, 4, 7);
  eq('被牵制的红马 0 步可走', mv.length, 0);
  const why = explainIllegal(b, 4, 7, 3, 5);
  ok('explainIllegal 说明会被将军', !!why && why.includes('将军'), why || '');
}

// ---------------------------------------------------------------------------
section('8. 将死 / 困毙');

{
  // 双车错杀：黑将(4,0)，红车(0,0) 控横线0，红车(0,1) 控横线1
  const b = boardFromList([
    [PT.KING, BLACK, 4, 0],
    [PT.ROOK, RED, 0, 0], [PT.ROOK, RED, 0, 1],
    [PT.KING, RED, 0, 9]
  ]);
  ok('黑方被将军', isInCheck(b, BLACK));
  eq('黑方状态 = checkmate', getGameStatus(b, BLACK), 'checkmate');
  eq('黑方无任何合法走法', generateAllLegalMoves(b, BLACK).length, 0);
}

{
  // 困毙：黑将(4,0) 不被将军，但三个逃格全被控住
  const b = boardFromList([
    [PT.KING, BLACK, 4, 0],
    [PT.ROOK, RED, 3, 5], [PT.ROOK, RED, 5, 5], [PT.ROOK, RED, 0, 1],
    [PT.KING, RED, 3, 9]
  ]);
  ok('黑方未被将军', !isInCheck(b, BLACK));
  eq('黑方状态 = stalemate（困毙判负）', getGameStatus(b, BLACK), 'stalemate');
}

{
  // 将军但可解：黑将(4,0)，红车(4,5) 照将，黑将可躲 (3,0)/(5,0)
  const b = boardFromList([
    [PT.KING, BLACK, 4, 0], [PT.ROOK, RED, 4, 5], [PT.KING, RED, 4, 9]
  ]);
  eq('可解的将军 -> check', getGameStatus(b, BLACK), 'check');
  const mv = generateLegalMoves(b, 4, 0);
  ok('黑将能躲到 (3,0)', has(mv, 3, 0));
  ok('黑将能躲到 (5,0)', has(mv, 5, 0));
  ok('黑将不能沿纵线 4 前进（仍在车的射程）', !has(mv, 4, 1));
}

// ---------------------------------------------------------------------------
section('9. 将/士 九宫约束');

{
  // 黑将放 (3,0)，并用黑卒挡住纵线 3，避免白脸将干扰步数统计
  const b = boardFromList([[PT.KING, RED, 4, 8], [PT.KING, BLACK, 3, 0], [PT.PAWN, BLACK, 3, 4]]);
  const mv = generateLegalMoves(b, 4, 8);
  eq('九宫中心红帅 4 步', mv.length, 4);
  ok('  不能出九宫到 (4,6)', !has(mv, 4, 6));

  // 去掉挡子后，走到纵线 3 会白脸将 -> 只剩 3 步
  const bf = boardFromList([[PT.KING, RED, 4, 8], [PT.KING, BLACK, 3, 0]]);
  eq('纵线 3 空时红帅只剩 3 步（白脸将约束）', generateLegalMoves(bf, 4, 8).length, 3);

  const b2 = boardFromList([[PT.ADVISOR, RED, 4, 8], [PT.KING, RED, 4, 9], [PT.KING, BLACK, 3, 0]]);
  eq('九宫中心红仕 4 步', generateLegalMoves(b2, 4, 8).length, 4);
  const b3 = boardFromList([[PT.ADVISOR, RED, 3, 9], [PT.KING, RED, 4, 9], [PT.KING, BLACK, 3, 0]]);
  eq('角上红仕 1 步', generateLegalMoves(b3, 3, 9).length, 1);
}

// ---------------------------------------------------------------------------
section('10. GameState：走子 / 悔棋 / 记谱');

{
  const gs = new GameState();
  eq('开局轮红方', gs.sideToMove, RED);
  // 红炮二 = file 7（红方从右往左数第二线）
  const r1 = gs.move({ file: 7, rank: 7 }, { file: 4, rank: 7 });   // 炮二平五
  ok('炮二平五 成功', !!r1 && r1.ok, JSON.stringify(r1 && r1.error));
  eq('  记谱 = 炮二平五', gs.history[0].notation, '炮二平五');
  eq('  轮到黑方', gs.sideToMove, BLACK);

  const r2 = gs.move({ file: 7, rank: 0 }, { file: 6, rank: 2 });   // 馬8进7
  ok('馬8进7 成功', !!r2 && r2.ok);
  eq('  记谱 = 馬8进7', gs.history[1].notation, '馬8进7');

  const r3 = gs.move({ file: 1, rank: 9 }, { file: 2, rank: 7 });   // 馬八进七
  ok('馬八进七 成功', !!r3 && r3.ok);
  eq('  记谱 = 馬八进七', gs.history[2].notation, '馬八进七');

  eq('历史长度 3', gs.history.length, 3);
  gs.undo(1);
  eq('悔一步后 历史长度 2', gs.history.length, 2);
  eq('  轮回红方', gs.sideToMove, RED);
  gs.undo(2);
  eq('再悔两步后 历史清空', gs.history.length, 0);
  eq('  回到初始局面 FEN', gs.board.toFen(), createInitialBoard().toFen());
  eq('  轮红方', gs.sideToMove, RED);

  // 兵/卒 与 车 的进退记谱
  const gs2 = new GameState();
  gs2.move({ file: 0, rank: 6 }, { file: 0, rank: 5 });             // 兵九进一
  eq('兵九进一', gs2.history[0].notation, '兵九进一');
  gs2.move({ file: 0, rank: 3 }, { file: 0, rank: 4 });             // 卒1进1
  eq('卒1进1', gs2.history[1].notation, '卒1进1');
  gs2.move({ file: 0, rank: 9 }, { file: 0, rank: 6 });             // 俥九进三
  eq('俥九进三', gs2.history[2].notation, '俥九进三');

  // 前/后 标识
  const gs3 = GameState.fromList([
    [PT.KING, RED, 4, 9], [PT.KING, BLACK, 3, 0],
    [PT.ROOK, RED, 2, 5], [PT.ROOK, RED, 2, 8]
  ], RED);
  gs3.move({ file: 2, rank: 5 }, { file: 2, rank: 4 });
  eq('同线双俥 -> 前俥进一', gs3.history[0].notation, '前俥进一');
}

// ---------------------------------------------------------------------------
section('11. 将死流程（GameState 层）');

{
  const gs = GameState.fromList([
    [PT.KING, BLACK, 4, 0],
    [PT.ROOK, RED, 0, 5], [PT.ROOK, RED, 8, 1],
    [PT.KING, RED, 0, 9]
  ], RED);
  // 红车 (0,5) -> (0,0)，形成双车错杀
  const res = gs.move({ file: 0, rank: 5 }, { file: 0, rank: 0 });
  ok('红车沉底成功', !!res && res.ok, JSON.stringify(res && res.error));
  eq('  黑方被将死', gs.status, 'checkmate');
  eq('  胜方为红', gs.winner, RED);
  ok('  游戏结束', gs.isGameOver());
}

// ---------------------------------------------------------------------------
section('12. 性能抽查');

{
  const b = createInitialBoard();
  const t0 = Date.now();
  let n = 0;
  for (let i = 0; i < 2000; i++) n += generateAllLegalMoves(b, RED).length;
  const dt = Date.now() - t0;
  ok(`2000 次全量合法走法生成耗时 ${dt}ms（< 3000ms）`, dt < 3000, `共 ${n} 步`);
}

// ---------------------------------------------------------------------------
console.log(`\n===============================`);
console.log(`  通过 ${pass}  失败 ${fail}`);
if (fail) { console.log('  失败项：\n   - ' + failures.join('\n   - ')); process.exitCode = 1; }
else console.log('  全部通过 \u2713');
console.log(`===============================\n`);
