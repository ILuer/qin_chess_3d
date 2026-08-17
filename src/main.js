/**
 * main.js —— 启动流程、主循环、集成（engineering-lead）
 *
 * 职责：把 core / render / ui / ai / 美术(art) / 音频(audio) 各模块拼成完整游戏。
 *  - 分阶段加载（场景 → 棋盘/环境 → 棋子 → 效果 → 输入/控件 → AI），进度条 + 秦风文案
 *  - 主循环：updateTweens → input.update → effects.update → scene.update → scene.render
 *  - 全局错误捕获：出错时在加载界面显示可读信息，绝不白屏
 *  - window.__game 调试句柄
 *
 * 所有 import 路径与符号均按 `docs/CONTRACT.md` 与各模块实际导出对齐（见文末自查）。
 */

import * as THREE from 'three';
import {
  RED, BLACK, PT, FILES, RANKS, BOARD_HALF_W, PALETTE, TIMING, toWorld, INITIAL_FEN
} from './core/constants.js';
import { GameState } from './core/gameState.js';
import { ReviewController } from './core/reviewController.js';   // L2：复盘状态机（纯逻辑）
import { loadSave, writeSave, clearSave, buildSave } from './core/save.js';   // M4 对局存档/恢复
import { createSceneSystem } from './render/scene.js';
import { createEffects } from './render/effects.js';
import { animator, updateTweens } from './render/animator.js';
import { createFollowCamera, computeFollowFitRadius } from './render/followCamera.js';
import { createInputSystem } from './ui/input.js';
import { createHUD } from './ui/hud.js';
import { createControls } from './ui/controls.js';
import { createAIEngine } from './ai/engine.js';
import { createPieceMesh, disposePieceFactory, setPieceLod } from './render/pieceFactory.js';
import { createBoard, createEnvironment } from './render/boardMesh.js';
import { getMaterials, disposeMaterials } from './render/materials.js';
import { SFX } from './audio/sfx.js';
import { CombatDirector } from './render/combat/CombatDirector.js';
import { trackEvent, trackError, flush as flushTelemetry, tickFps, elapsedMs } from './telemetry.js';

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------

let sceneSys = null;      // SceneSystem
let effects = null;       // Effects
let input = null;         // InputSystem
let hud = null;           // HUD
let controls = null;      // Controls
let aiEngine = null;      // AIEngine
let gs = null;            // GameState
let followCam = null;     // FollowCamera（棋子检查跟随；T 键切换）

/** 棋子网格映射：pieceMeshes[file][rank] = THREE.Group | null */
let pieceMeshes = [];

/** 人机对战开关；默认开启，人类执红，AI 执黑 */
let aiEnabled = true;
const humanSide = RED;
const aiSide = BLACK;
let difficulty = 2;

let aiBusy = false;       // AI 思考中
let gameOver = false;
let hoverMesh = null;     // 当前悬停浮起的棋子
let started = false;
let combatDirector = null; // CombatDirector 战场演出总调度

// L4b · 当前应用中的几何 LOD 档位（null=尚未评估；true=低模/远景）
let currentLodFar = null;

// L2 · REVIEW 复盘状态（design/gameplay/review-export-design.md §5）
let reviewCtrl = null;        // ReviewController（纯逻辑状态机，boot 中创建）
let reviewGs = null;          // scratch 局面：从 gs.startFen 重放 history[0..cursor)
let renderGs = null;          // 显示局面：PLAY=gs，REVIEW=reviewGs（rebuildPieces/updateCheckRing 读它）
let reviewActive = false;     // 镜像 reviewCtrl.active（输入/AI 冻结快速判断）
let reviewTimer = null;       // 自动播放定时器句柄
let reviewHidGameOver = false;// 进入复盘时是否隐藏了结束面板（退出时恢复）
let lastGameOverInfo = null;  // 结束面板内容缓存（复盘退出后重新展示，避免重复音效/埋点）

// ---------------------------------------------------------------------------
// 棋子网格管理
// ---------------------------------------------------------------------------

/** 依据当前显示局面（renderGs）重建全部棋子网格（悔棋 / 重开 / 复盘游标变化时使用） */
function rebuildPieces() {
  const src = renderGs || gs;
  if (sceneSys) {
    for (let f = 0; f < FILES; f++) {
      if (!pieceMeshes[f]) continue;
      for (let r = 0; r < RANKS; r++) {
        const m = pieceMeshes[f][r];
        if (!m) continue;
        // H3：引用计数释放（内部 remove + tpl.count--；模板几何收口到 disposePieceFactory）
        if (typeof m.userData.dispose === 'function') m.userData.dispose();
        else sceneSys.piecesGroup.remove(m);
      }
    }
  }
  pieceMeshes = [];
  for (let f = 0; f < FILES; f++) pieceMeshes[f] = new Array(RANKS).fill(null);

  // L4b：重建后棋子默认高模（lod0）；下一帧 applyLodByDistance 按当前距离收敛
  currentLodFar = null;

  src.board.forEach((p, f, r) => {
    const mesh = createPieceMesh(p.type, p.side);
    const w = toWorld(f, r);
    mesh.position.set(w.x, 0, w.z);
    mesh.userData.cell = { file: f, rank: r };
    mesh.userData.__homeY = 0;
    mesh.userData.idlePhase = ((f * 7 + r * 13) % 1000) / 1000 * Math.PI * 2;
    mesh.userData._busy = false;
    if (sceneSys) sceneSys.piecesGroup.add(mesh);
    pieceMeshes[f][r] = mesh;
  });
}

// ---------------------------------------------------------------------------
// L4b · 距离驱动的几何 LOD 切换（联动 L4a farView + H5 lowMesh）
// ---------------------------------------------------------------------------

/**
 * 按 sceneSys 节流评估出的远景状态，把棋子几何切到高模/低模。
 * 保护：动画中（animator.isBusy）/ 选中态（input.getSelection()）跳过；
 * 复盘期间由 setInteractionBusy 冻结 sceneSys 的 farView 评估，本函数自然收敛。
 * H5 联动：降档到 L0 时 lowMesh=true → 强制低模（即使近景）。
 */
function applyLodByDistance() {
  if (!sceneSys || sceneSys.disposed) return;
  const far = sceneSys.farView;
  if (far == null) return;                       // 距离尚未评估（节流首拍前）
  if (animator.isBusy) return;                   // 动画中跳过（开启动画/移动/吃子/震屏）
  const sel = input ? input.getSelection() : null;
  if (sel) return;                               // 选中态跳过（避免特写时抖动）
  const target = (!!sceneSys.lowMesh) || far;    // H5 L0 强制低模
  if (target === currentLodFar) return;
  currentLodFar = target;

  let changed = 0;
  for (let f = 0; f < FILES; f++) {
    const col = pieceMeshes[f];
    if (!col) continue;
    for (let r = 0; r < RANKS; r++) {
      const m = col[r];
      if (m && setPieceLod(m, target ? 1 : 0)) changed++;
    }
  }
  if (changed > 0) trackEvent('lod_switch', { far: target, changed });   // H1 埋点
}

// ---------------------------------------------------------------------------
// 走子流程
// ---------------------------------------------------------------------------

/**
 * 执行一步走子（用户或 AI 均走此入口）。
 * 先改逻辑模型（gs.move），再委托 CombatDirector 驱动视觉演出。
 */
function applyMove(from, to) {
  if (reviewActive) return;   // L2：复盘期间冻结一切落子（防幽灵落子兜底）
  if (gameOver) return;
  if ((combatDirector && combatDirector.isBusy) || aiBusy) return;   // 演出 / AI 思考中不接受新走子

  const res = gs.move(from, to);
  if (!res.ok) {
    hud.showToast(res.error || '这步棋不合法', 'warn');
    return;
  }
  const rec = res.record;

  const movingMesh = pieceMeshes[from.file][from.rank];
  const captureMesh = rec.captured ? pieceMeshes[to.file][to.rank] : null;

  // 更新网格映射（逻辑已先行变更）
  pieceMeshes[from.file][from.rank] = null;
  pieceMeshes[to.file][to.rank] = movingMesh;
  if (movingMesh) {
    movingMesh.userData.cell = { file: to.file, rank: to.rank };
    movingMesh.position.y = 0;
  }

  // 清选择 / 提示 / 悬停
  effects.clearAllHints();
  input.reset();
  if (hoverMesh) { animator.unhover(hoverMesh); hoverMesh = null; }

  // 标记移动中：待机微动让位
  if (movingMesh) movingMesh.userData._busy = true;
  if (captureMesh) captureMesh.userData._busy = true;

  const aiFast = aiEnabled && gs.sideToMove === aiSide;

  // 收尾回调：CombatDirector 演出完成后调用（保留 afterMove 语义）
  const done = () => {
    effects.showLastMoveMarker(from, to);

    if (gs.status === 'check' || gs.status === 'checkmate') {
      const k = gs.board.findKing(gs.sideToMove);
      const km = k ? (pieceMeshes[k.file] && pieceMeshes[k.file][k.rank]) : null;
      effects.setCheckedKing(km);
      hud.setCheck(true, gs.sideToMove);
      SFX.play('check');
      effects.checkPulse(0.55);
      sceneSys.screenShake(0.12, 0.3);
    } else {
      effects.setCheckedKing(null);
      hud.setCheck(false);
    }

    hud.syncAll(gs, { activeIndex: gs.history.length - 1 });
    syncControls();

    if (gs.isGameOver()) { onGameOver(); return; }
    // 轮到 AI 时由 pumpAI 每帧轮询自动接管
  };

  // ★ 委托 CombatDirector（若已就绪；否则走兜底）
  if (combatDirector) {
    if (rec.captured) {
      // 判定冲击级
      const vType = captureMesh ? captureMesh.userData.pieceType : null;
      let impactLevel = 'L3';
      if (gs.status === 'checkmate') impactLevel = 'L5';
      else if (gs.status === 'check' || (vType && (vType === 'K' || vType === 'R' || vType === 'C' || vType === 'N' || vType === 'B' || vType === 'A'))) {
        // 大子（车/炮/马/象/士）及将军 → L4
        impactLevel = (vType === 'P') ? 'L3' : 'L4';
        if (gs.status === 'check') impactLevel = 'L4';
      }
      combatDirector.playCapture(movingMesh, captureMesh, from, to, {
        aiFast,
        impactLevel,
        onComplete: done
      });
    } else {
      combatDirector.playMove(movingMesh, from, to, {
        aiFast,
        onComplete: done
      });
    }
  } else {
    // 兜底：CombatDirector 未就绪时直接走 afterMove
    done();
    if (movingMesh) movingMesh.userData._busy = false;
    if (captureMesh) captureMesh.userData._busy = false;
  }
}

/** 走子完成后的统一收尾：记谱 / 将军提示 / 胜负判定 / 触发 AI */
function afterMove(rec, from, to) {
  effects.showLastMoveMarker(from, to);

  if (gs.status === 'check' || gs.status === 'checkmate') {
    const k = gs.board.findKing(gs.sideToMove);
    const km = k ? (pieceMeshes[k.file] && pieceMeshes[k.file][k.rank]) : null;
    effects.setCheckedKing(km);
    hud.setCheck(true, gs.sideToMove);
    SFX.play('check');
    effects.checkPulse(0.55);
    sceneSys.screenShake(0.12, 0.3);
  } else {
    effects.setCheckedKing(null);
    hud.setCheck(false);
  }

  hud.syncAll(gs, { activeIndex: gs.history.length - 1 });
  syncControls();

  if (gs.isGameOver()) { onGameOver(); return; }
  // 轮到 AI 时由 pumpAI 每帧轮询自动接管，不在此处一次性触发
}

/**
 * AI 回合泵 —— 每帧轮询「是否该轮到 AI 落子」。
 *
 * 【为什么不用事件触发】
 * 原实现是一次性事件触发：走子动画结束时调一次 maybeRequestAI，
 * 再 setTimeout 60ms 兜底调一次，两次都带 `animator.isBusy` 判断。
 * 但吃子时被吃方的消散动画（延迟 0.19s + 时长 0.42s，0.61s 才解锁）
 * 活得比主移动动画（0.38s）更久 —— 60ms 兜底在 0.44s 触发时锁还没放，
 * 两次触发全部落空，且此后再无任何重试，AI 就此永久失联。
 * 这正是「AI 棋子被吃后回合流转中断」的根因：
 * 不吃子时消散动画不存在，所以只有吃子这一条路径会挂。
 *
 * 【为什么轮询是对的】
 * 回合该不该流转是一个**持续为真的状态**，不是一个瞬时事件。
 * 用状态轮询表达状态，触发条件只要成立就必然被命中，
 * 结构上不存在「错过时间窗」这种失败模式——多晚都会自愈。
 */
const AI_THINK_DELAY = 0.16;   // 动画落定后的短暂停顿，避免 AI 抢拍显得机械
let aiCooldown = 0;

// OQ-6：选中棋子时周期性播放专属待机音（未选中不触发），营造"被托在掌心"的气场
const IDLE_SOUND_INTERVAL = 1.1; // 触发周期（秒）
let idleSoundTimer = 0;          // 倒计时

function pumpAI(dt) {
  if (reviewActive) return;   // L2：复盘期间 AI 回合泵停止
  if (!gs || !aiEnabled || gameOver || aiBusy) return;
  if (gs.sideToMove !== aiSide) return;
  if (animator.isBusy) { aiCooldown = AI_THINK_DELAY; return; }  // 动画未落定，重置节奏
  aiCooldown -= dt;
  if (aiCooldown > 0) return;
  aiCooldown = AI_THINK_DELAY;
  requestAI();
}

/** 异步请求 AI 思考；完成后落子 */
async function requestAI() {
  if (aiBusy) return;
  aiBusy = true;
  hud.setTurn(aiSide, { aiThinking: true, moveNumber: gs.moveNumber });
  const fen = gs.board.toFen();
  try {
    const res = await aiEngine.think(fen, aiSide);
    if (reviewActive) return;   // L2：思考返回时若已进入复盘，丢弃（防幽灵落子）
    if (gameOver || gs.sideToMove !== aiSide) return;
    if (!res || !res.from || !res.to) {
      // AI 无着可走。正常情况下 gs 早已判定将死/困毙并结束对局，
      // 能走到这里说明逻辑状态与 AI 认知不同步——重判一次兜底，别让回合死等。
      console.warn('[AI] 未返回着法，重新判定局面：', gs.status);
      if (gs.isGameOver()) onGameOver();
      return;
    }
    // 先解锁 AI：落子后的输入拦截交给 animator 的锁接管。
    // 万一此刻 animator 仍忙导致 applyMove 空转，pumpAI 下一帧会自动重试。
    aiBusy = false;
    applyMove(res.from, res.to);
  } catch (e) {
    console.warn('[AI] 思考异常：', e);
  } finally {
    aiBusy = false;
    syncControls();
  }
}

// ---------------------------------------------------------------------------
// 游戏控制：悔棋 / 重开 / 认输 / 切换 AI / 难度
// ---------------------------------------------------------------------------

function doUndo() {
  exitReviewIfActive();   // L2：E9/E10 —— 破坏性操作优先退出复盘再执行
  if (gameOver || animator.isBusy || aiBusy) return;
  if (!gs.canUndo()) return;

  aiEngine.cancel();
  aiBusy = false;

  // 人机模式退两步（退回玩家上一次决策点），双人模式退一步
  const last = gs.history[gs.history.length - 1];
  const steps = (aiEnabled && last && last.side !== humanSide) ? 2 : 1;

  const undone = gs.undo(steps);
  if (!undone.length) return;

  gameOver = false;
  effects.clearAll();
  input.reset();
  if (hoverMesh) { animator.unhover(hoverMesh); hoverMesh = null; }
  rebuildPieces();
  hud.syncAll(gs, {});
  updateCheckRing();
  SFX.play('undo');
  syncControls();
}

function doReset() {
  exitReviewIfActive();   // L2：E9/E10 —— 破坏性操作优先退出复盘再执行
  if (animator.isBusy) return;          // 动画中忽略；AI 思考中也会先 cancel
  aiEngine.cancel();
  aiBusy = false;
  animator.killAll(false);
  if (combatDirector) combatDirector.abort(); // 清理战场演出残留
  if (sceneSys && sceneSys.clearCombatLight) sceneSys.clearCombatLight(); // 清理战斗灯光脉冲残留（bug-light-blinding 方案 B）
  gs.reset();
  gameOver = false;
  effects.clearAll();
  input.reset();
  if (hoverMesh) { animator.unhover(hoverMesh); hoverMesh = null; }
  sceneSys.resetView(false);
  rebuildPieces();
  hud.hideGameOver();
  hud.syncAll(gs, {});
  updateCheckRing();
  hud.startTimer();
  SFX.play('start');
  syncControls();
  openingAnimation();
  aiCooldown = 0.9;                     // 开局动画期间不打扰；之后由 pumpAI 接管
  trackEvent('game_start', { aiEnabled, difficulty });   // H1 事件
}

function doResign() {
  exitReviewIfActive();   // L2：E9/E10 —— 破坏性操作优先退出复盘再执行
  if (gameOver) return;
  const side = aiEnabled ? humanSide : gs.sideToMove;
  gs.resign(side);
  gameOver = true;
  onGameOver();
  syncControls();
}

function toggleAI() {
  aiEnabled = !aiEnabled;
  hud.showToast(aiEnabled ? '已开启人机对战（你执红）' : '已切换为双人对战', 'info', 2.0);
  saveGame();       // M4：AI 开关变更写入存档
  syncControls();
  trackEvent('ai_mode', { aiEnabled, difficulty });   // H1 事件
  // 若切回人机且此刻正轮到 AI，pumpAI 会在下一帧自动接手
}

function setDifficulty(level) {
  // D10：大师档（4）仅 worker 模式开放——controls 已灰显，此处兜底拦截
  if (Number(level) === 4 && aiEngine && aiEngine.mode === 'sliced') {
    hud.showToast('大师难度仅在 AI 独立线程模式可用（已保持当前难度）', 'warn', 2.4);
    syncControls();
    return;
  }
  difficulty = aiEngine.setDifficulty(level);
  saveGame();       // M4：难度变更写入存档
  syncControls();
  trackEvent('ai_mode', { difficulty, aiEnabled });   // H1 事件
}

function toggleSound() {
  const on = !SFX.isEnabled();
  SFX.setEnabled(on);
  if (on) SFX.play('select');
  syncControls();
  hud.showToast(on ? '音效已开启' : '音效已静音', 'info', 1.6);
}

/** 切换跟随相机模式（T 键；调试辅助：跟随 ↔ 固定对比） */
function toggleFollowCamera() {
  const on = followCam.toggleEnabled();
  // 跟随激活：fixed 视图窄屏适配让位；关闭后恢复
  if (sceneSys) sceneSys.viewAutoFit = !on;
  if (on) {
    // 开启：若已有选中棋子，立即平滑聚焦（携带落点适配距离，保证落点可见）
    const sel = input ? input.getSelection() : null;
    if (sel && sel.mesh) followCam.setTarget(sel.mesh, { fitRadius: followFitRadiusFor(sel) });
    hud.showToast('跟随相机：开（选中棋子自动聚焦）', 'info', 1.8);
  } else {
    hud.showToast('固定相机：开（选中棋子不移动视角）', 'info', 1.8);
  }
  syncControls();   // 与按钮状态同源（UI-FIX-123：开关与 T 键互相同步）
}

/**
 * 计算选中棋子的落点自适应跟随距离（UI-FIX-123）。
 * 保证跟随模式下选中棋子的全部落点标记投影进视口。
 * @param {{mesh:THREE.Object3D, moves:Array}} sel input.getSelection()
 * @returns {number|null}
 */
function followFitRadiusFor(sel) {
  if (!sel || !sel.mesh || !sceneSys) return null;
  return computeFollowFitRadius({
    camera: sceneSys.camera,
    controls: sceneSys.controls,
    moves: sel.moves,
    piece: sel.mesh
  });
}

/** 走子记录单击：PLAY=轻量预览（高亮该步起终点）；REVIEW=游标跳到该步之后 */
function previewMove(idx) {
  if (!gs) return;
  if (reviewActive) { reviewCtrl.seek(idx + 1); return; }
  hud.renderMoveLog(gs.getMoveLog(), idx);
  const rec = gs.history[idx];
  if (rec) effects.showLastMoveMarker(rec.from, rec.to);
}

// ---------------------------------------------------------------------------
// L2 · REVIEW 复盘 / 棋谱导出（design/gameplay/review-export-design.md §4-§5）
// ---------------------------------------------------------------------------

/**
 * REVIEW 渲染钩子：游标/子状态每次变化都会触发。
 * 重建 scratch 局面（fromFen(startFen) + 重放 history[0..cursor)）、
 * 切换显示局面 renderGs、重建棋子网格、同步 HUD。
 */
function renderReview(cursor, len, sub, active) {
  reviewActive = active;
  if (active) {
    reviewGs = GameState.fromFen(gs.startFen || INITIAL_FEN);
    for (let i = 0; i < cursor && i < gs.history.length; i++) {
      const rec = gs.history[i];
      reviewGs.move(rec.from, rec.to, { force: true });
    }
    renderGs = reviewGs;
  } else {
    renderGs = gs;
  }

  rebuildPieces();
  if (effects) {
    effects.clearAllHints();
    if (active && cursor > 0) {
      const rec = gs.history[cursor - 1];
      effects.showLastMoveMarker(rec.from, rec.to);
    }
  }
  if (hud) {
    if (active) {
      hud.renderMoveLog(gs.getMoveLog(), cursor - 1);
      hud.setTurn(reviewGs.sideToMove, { moveNumber: reviewGs.moveNumber });
      hud.renderCaptured(reviewGs.captured);
    } else {
      hud.syncAll(gs, {});   // 退出复盘：完整恢复 live HUD
    }
    hud.setReviewState({ active, cursor, len, playing: sub === 'playing' });
  }
  updateCheckRing();
}

/** E1：进入复盘（move-log「复盘」按钮 / 着法双击 / 结束面板「复盘本局」） */
function enterReview(entryIndex) {
  if (reviewActive) return;
  if (!reviewCtrl || !gs) return;
  if (gs.history.length === 0) {
    hud.showToast('尚无着法可复盘', 'warn', 2.0);
    return;
  }
  if (aiBusy || (animator && animator.isBusy)) {
    hud.showToast('当前动画进行中，请稍候', 'warn', 2.0);
    return;
  }
  // AI 兜底取消（E1 前置已保证非 busy；杜绝退出复盘后 AI 幽灵落子）
  if (aiEngine) aiEngine.cancel();
  aiBusy = false;
  // 冻结输入：清选择与提示
  if (input) input.deselect('review');
  if (effects) effects.clearAllHints();
  if (hoverMesh) { animator.unhover(hoverMesh); hoverMesh = null; }
  if (followCam) followCam.clearTarget();
  // 结束面板：进入复盘先隐藏，退出时恢复（避免模态遮挡棋盘）
  if (gameOver && hud.gameOver && hud.gameOver.classList.contains('is-visible')) {
    reviewHidGameOver = true;
    hud.hideGameOver();
  }
  const ok = reviewCtrl.enter(entryIndex);
  if (!ok) return;
  hud.showToast('复盘模式：←→ 逐步 · Space 自动播放 · Esc 退出', 'info', 2.8);
  syncControls();
  trackEvent('review_enter', { moves: gs.history.length, entry: entryIndex != null ? entryIndex : gs.history.length });
}

/** E9：退出复盘（Esc / 复盘条「退出」 / 破坏性操作前置） */
function exitReview() {
  if (!reviewActive || !reviewCtrl) return;
  reviewCtrl.exit();   // 停定时器、复位状态；onChange → renderReview(active=false) 恢复 live 渲染
  hud.setReviewState({ active: false, cursor: 0, len: gs.history.length, playing: false });
  // 对局已结束时：恢复结束面板（不重复音效 / 埋点）
  if (reviewHidGameOver && gameOver) {
    reviewHidGameOver = false;
    if (lastGameOverInfo) hud.showGameOver(lastGameOverInfo);
  }
  updateCheckRing();
  syncControls();
  SFX.play('select');
}

/** 破坏性操作前置：先退出复盘再执行（E9/E10 语义） */
function exitReviewIfActive() {
  if (reviewActive) exitReview();
}

/** 走子记录双击：PLAY=进入复盘到该步之后；REVIEW=游标跳到该步之后 */
function onMoveLogDblClick(idx) {
  if (reviewActive) { reviewCtrl.seek(idx + 1); return; }
  enterReview(idx + 1);
}

/** 导出棋谱入口（move-log「导出棋谱」按钮） */
function openExportPanelFlow() {
  if (!gs || gs.history.length === 0) {
    hud.showToast('尚无着法可导出', 'warn', 2.0);
    return;
  }
  hud.openExportPanel({ ucci: gs.exportUcci(), chinese: gs.exportChinese() });
  trackEvent('export_open', { moves: gs.history.length });
}

// ---------------------------------------------------------------------------
// 视觉辅助
// ---------------------------------------------------------------------------

/** 根据当前显示局面（renderGs）刷新将军红光 / 横幅（REVIEW 时读 scratch 局面） */
function updateCheckRing() {
  const src = renderGs || gs;
  if (src.status === 'check' || src.status === 'checkmate') {
    const k = src.board.findKing(src.sideToMove);
    const km = k ? (pieceMeshes[k.file] && pieceMeshes[k.file][k.rank]) : null;
    effects.setCheckedKing(km);
    hud.setCheck(true, src.sideToMove);
  } else {
    effects.setCheckedKing(null);
    hud.setCheck(false);
  }
}

/** 开局动画：棋子从高处错落落下归位 */
function openingAnimation() {
  let i = 0;
  for (let f = 0; f < FILES; f++) {
    for (let r = 0; r < RANKS; r++) {
      const m = pieceMeshes[f] && pieceMeshes[f][r];
      if (!m) continue;
      const home = toWorld(f, r);
      m.position.set(home.x, 2.6, home.z);
      animator.arcMove(m, new THREE.Vector3(home.x, 0, home.z), {
        duration: 0.5, lift: 0.18, lock: false,
        delay: (i % 9) * 0.03,
        onComplete: () => animator.squashLand(m, 0.18)
      });
      i++;
    }
  }
  if (input) input.setEnabled(false);
  setTimeout(() => { if (input) input.setEnabled(true); }, 820);
}

/** 结束面板 */
function onGameOver() {
  gameOver = true;
  controls.setUndoEnabled(false);
  const winner = gs.winner;
  const tone = winner === humanSide ? 'win' : (winner ? 'lose' : 'draw');
  SFX.play(winner ? (winner === humanSide ? 'win' : 'lose') : 'start');
  // H1 事件：对局结束（result 以执棋方视角记 win/lose/draw，turns=已过回合数）
  trackEvent('game_over', {
    result: winner ? (winner === RED ? 'red' : 'black') : 'draw',
    tone,
    turns: Math.max(0, gs.moveNumber - 1),
    moves: gs.history.length,
    aiEnabled,
    difficulty
  });
  // L2：缓存面板内容（复盘退出后重新展示时复用，避免重复音效/埋点）
  lastGameOverInfo = {
    title: winner ? (winner === RED ? '红方胜' : '黑方胜') : '和棋',
    detail: gs.getResultText(),
    tone,
    stats: [
      ['回合数', String(Math.max(0, gs.moveNumber - 1))],
      ['着法总数', String(gs.history.length)],
      ['我方吃子', String(gs.captured[aiSide].length)],
      ['对方吃子', String(gs.captured[humanSide].length)]
    ]
  };
  hud.showGameOver(lastGameOverInfo);
}

/** 同步控件启用 / 状态显示 */
function syncControls() {
  if (!controls) return;
  const canUndo = gs.canUndo() && !animator.isBusy && !aiBusy && !gameOver;
  controls.setUndoEnabled(canUndo);
  controls.setAIState(aiEnabled, difficulty);
  controls.setSoundState(SFX.isEnabled());
  if (sceneSys) {
    controls.setFlipState(sceneSys.viewSide);
    controls.setTopViewState(sceneSys.isTopView);
  }
  if (followCam) controls.setFollowCamState(followCam.enabled);
}

// ---------------------------------------------------------------------------
// M4 对局存档/恢复
// ---------------------------------------------------------------------------

/** 落子 / 悔棋 / AI 开关 / 难度变更后写入存档（localStorage 不可用时静默降级） */
function saveGame() {
  if (!gs) return;
  writeSave(buildSave(gs, { aiEnabled, difficulty }));
}

/** 对局结束 / 重开时清除存档 */
function clearGameSave() {
  clearSave();
}

/**
 * 启动读档恢复：fromFen(startFen) + 重放 moves（复用 gs.move(force=true)）+ 回填配置。
 * 重放后 toFen() === 存档 fen（当前局面快照）才视为完整恢复；
 * 不一致（坏档 / 版本漂移 / 历史缺失）降级为仅按 fen 恢复（保棋盘与行棋方，丢走子记录）。
 * @param {object} save normalizeSave 后的存档对象
 * @returns {{restored:boolean, full:boolean}}
 */
function restoreFromSave(save) {
  let full = true;
  // 冗余字段校验：sideToMove 必须与当前局面 FEN 第 2 段一致
  const fenSide = save.fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'r';
  if (save.sideToMove !== fenSide) full = false;

  try {
    gs = GameState.fromFen(save.startFen);   // 从起始局面开始重放（不可用当前局面，否则双重落子）
  } catch (e) {
    return { restored: false, full: false };
  }

  if (full) {
    for (const mv of save.moves) {
      const res = gs.move(mv.from, mv.to, { force: true });
      if (!res.ok) { full = false; break; }   // 历史与起始局面不一致 → 降级
    }
  }

  if (full) {
    try { if (gs.toFen() !== save.fen) full = false; } catch (e) { full = false; }
  }

  if (!full) {
    // 降级：只按当前局面 fen 恢复（丢走子记录，保棋盘与行棋方）
    try { gs = GameState.fromFen(save.fen); } catch (e) { return { restored: false, full: false }; }
  }

  // 回填配置（存档 difficulty=4 且引擎最终非 worker 时，由 onModeChange 兜底降档）
  aiEnabled = !!save.aiEnabled;
  difficulty = save.difficulty;
  return { restored: true, full };
}

// ---------------------------------------------------------------------------
// 输入适配器（input.js 通过此对象回调，实现 Oil 交互）
// ---------------------------------------------------------------------------

const inputGame = {
  isLocked: () => reviewActive || animator.isBusy || aiBusy || gameOver,
  canControl: (side) => !reviewActive && !gameOver && side === gs.sideToMove && (!aiEnabled || side === humanSide),
  pieceAt: (f, r) => gs.pieceAt(f, r),
  legalMoves: (f, r) => gs.getLegalMoves(f, r),
  blockedPoints: (f, r) => gs.getBlockedPoints(f, r),
  whyIllegal: (from, to) => gs.whyIllegal(from, to),
  meshAt: (f, r) => (pieceMeshes[f] ? pieceMeshes[f][r] : null),

  onSelect: (sel) => {
    if (hoverMesh && hoverMesh === sel.mesh) { animator.unhover(hoverMesh); hoverMesh = null; }
    effects.highlightSelected(sel.mesh);          // 选中光环（Windex）
    effects.showMoveHints(sel.moves);             // 合法落点光圈 / 危险环
    effects.showBlockedHints(sel.blocked);        // 蹩马腿 / 塞象眼 灰叉
    // 跟随相机：平滑聚焦选中棋子；携带落点自适应距离，保证全部落点标记在视口内（UI-FIX-123）
    if (followCam) {
      followCam.setTarget(sel.mesh, { fitRadius: followFitRadiusFor(sel) });
      // 跟随期间 fixed 视图窄屏适配让位（避免 resize 时与 fitRadius 打架）
      if (sceneSys) sceneSys.viewAutoFit = false;
    }
    SFX.play('select');
  },
  onDeselect: () => {
    effects.clearAllHints();
    if (hoverMesh) { animator.unhover(hoverMesh); hoverMesh = null; }
    if (followCam) {
      followCam.clearTarget();       // 取消选中：平滑回到棋盘中心视图
      if (sceneSys) sceneSys.viewAutoFit = true;
    }
  },
  onMove: (from, to) => applyMove(from, to),
  onIllegal: (from, to, reason, mesh) => {
    if (mesh) animator.shakeMesh(mesh, 0.12, 0.3); // 明确拒绝反馈（Oil）
    SFX.play('illegal');
    hud.showToast(reason || '这步棋走不了', 'warn');
  },
  onHover: (mesh) => {
    if (hoverMesh && hoverMesh !== mesh) { animator.unhover(hoverMesh); }
    const sel = input && input.getSelection();
    if (mesh && (!sel || sel.mesh !== mesh)) {
      animator.hover(mesh, 0.12, 0.14);
      hoverMesh = mesh;
    } else {
      hoverMesh = null;
    }
  }
};

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

function raf() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}

/**
 * H3：卸载期全量释放（先几何→材质→renderer；tweens 先停避免回调引用已释放对象）。
 * 顺序依赖：disposePieceFactory（模板几何）→ disposeMaterials（材质/贴图）→ sceneSys.dispose（renderer）。
 */
function disposeAll() {
  try { animator && animator.killAll(false); } catch (e) { /* 幂等 */ }
  try { disposePieceFactory(); } catch (e) { /* 幂等 */ }
  try { disposeMaterials(); } catch (e) { /* 幂等 */ }
  try { if (sceneSys) sceneSys.dispose(); } catch (e) { /* 幂等 */ }
}

function onFatal(e) {
  const msg = (e && e.message) || '初始化失败';
  const detail = (e && e.error && e.error.stack) ||
    (e && e.reason && (e.reason.stack || e.reason.message)) || '';
  if (hud) hud.showFatalError(msg, detail);
  else {
    const ls = document.getElementById('loading-screen');
    const t = ls && ls.querySelector('.loading-text');
    if (t) t.textContent = msg;
  }
  console.error('[致命错误]', msg, detail);
  trackError(msg, detail);   // H1：本地埋点错误（不上报外部）
}

function onFatalRejection(e) {
  const reason = e && e.reason;
  onFatal({ message: '未处理的异步错误：' + (reason && reason.message ? reason.message : reason), error: reason });
}

async function boot() {
  const container = document.getElementById('canvas-container');

  trackEvent('session_start', { viewport: `${window.innerWidth}x${window.innerHeight}` });   // H1 事件

  // HUD 先建，便于显示进度与错误
  hud = createHUD({
    onRestart: doReset,
    onPreviewMove: previewMove,
    // L2：复盘 / 棋谱导出回调
    onMoveLogDblClick: onMoveLogDblClick,
    onExport: openExportPanelFlow,
    onReviewEnter: () => enterReview(),
    onReviewFirst: () => { if (reviewCtrl) reviewCtrl.first(); },
    onReviewPrev: () => { if (reviewCtrl) reviewCtrl.prev(); },
    onReviewNext: () => { if (reviewCtrl) reviewCtrl.next(); },
    onReviewLast: () => { if (reviewCtrl) reviewCtrl.last(); },
    onReviewTogglePlay: () => { if (reviewCtrl) reviewCtrl.togglePlay(); },
    onReviewExit: () => exitReview(),
    onReviewInterval: (ms) => { if (reviewCtrl) reviewCtrl.setInterval(ms); }
  });

  // 全局错误兜底（绝不白屏）
  window.addEventListener('error', onFatal);
  window.addEventListener('unhandledrejection', onFatalRejection);
  // 音频：首个用户手势初始化（SFX 未 init 时 play 静默返回）
  const audioInit = () => SFX.init();
  window.addEventListener('pointerdown', audioInit, { once: true });
  window.addEventListener('keydown', audioInit, { once: true });

  // H3：页面卸载释放全部 WebGL 资源（几何→材质→renderer 顺序）。
  // BFCache 兜底：若页面被缓存后恢复（persisted=true），直接刷新重开（WebGL 游戏常见做法）。
  window.addEventListener('pagehide', () => {
    flushTelemetry();
    disposeAll();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) window.location.reload();
  });

  try {
    if (!webglAvailable()) {
      throw new Error('当前浏览器不支持 WebGL，请使用 Chrome / Edge / Firefox / Safari 等现代浏览器。');
    }

    hud.setLoadingProgress(0.05, '正在搭建秦风棋枰…');
    await raf();

    // 1) 场景 / 相机 / 渲染器 / 灯光 / 视角控制
    // L5：异步渲染器工厂 —— WebGPU 可用则 WebGPURenderer，否则 WebGLRenderer 回退
    sceneSys = await createSceneSystem(container, {
      onQualityDrop: (fps) => hud.showToast(`帧率偏低（约 ${fps}fps），已自动降低画质以保障流畅`, 'warn', 3.2)
    });
    // 棋子检查跟随相机（Phase 1.5）：选中棋子平滑聚焦；T 键切换跟随 / 固定
    followCam = createFollowCamera();
    hud.setLoadingProgress(0.2, '点亮宫灯与青铜辉光…');
    await raf();

    // 2) 棋盘 + 环境（美术模块）
    getMaterials();                 // 预热材质，供棋子 / 棋盘复用
    sceneSys.boardGroup.add(createBoard());
    sceneSys.envGroup.add(createEnvironment());
    hud.setLoadingProgress(0.44, '摆放三十二枚棋子…');
    await raf();

    // 3) 初始局面 + 棋子
    gs = new GameState();
    // —— M4：启动读档恢复（无档 / 坏档 / localStorage 禁用时静默跳过）——
    let restoreToast = null;
    const save = loadSave();
    if (save) {
      const r = restoreFromSave(save);
      if (r.restored) {
        restoreToast = r.full
          ? `已恢复上次对局（第 ${gs.moveNumber} 回合）`
          : '存档校验不一致，已按棋盘局面恢复（走子记录已丢失）';
        hud.setLoadingProgress(0.62, r.full ? '恢复上次对局…' : '按棋盘局面恢复…');
      } else {
        clearGameSave();   // 无法恢复的坏档直接清除，避免每次启动反复报错
      }
    }
    // M4：状态变更钩子（落子 / 悔棋 / 重开 / 结束）。
    // 注意：恢复重放发生在监听器挂载之前，重放触发的 'move' 不会重复写盘。
    gs.on('move', saveGame);
    gs.on('undo', saveGame);
    gs.on('gameover', clearGameSave);
    gs.on('reset', clearGameSave);
    // L2 · E10：外部变更（undo/reset/gameover）强制退出复盘，避免 reviewGs 与 live gs 失同步
    gs.on('undo', exitReviewIfActive);
    gs.on('reset', exitReviewIfActive);
    gs.on('gameover', exitReviewIfActive);

    // L2：复盘状态机（纯逻辑；renderReview 为渲染钩子，定时器用 setTimeout 单拍续期）
    reviewCtrl = new ReviewController({
      getHistory: () => gs.history,
      onChange: renderReview,
      interval: 1000,
      timer: {
        set: (fn, ms) => { reviewTimer = setTimeout(fn, ms); },
        clear: () => { if (reviewTimer != null) { clearTimeout(reviewTimer); reviewTimer = null; } }
      }
    });

    renderGs = gs;   // L2：显示局面默认 = live gs
    rebuildPieces();
    hud.setLoadingProgress(0.68, '凝聚将 / 帅之气…');
    await raf();

    // 4) 效果层（Juice / Windex）
    effects = createEffects(sceneSys);
    hud.setLoadingProgress(0.8, '校准落子涟漪与将军红光…');
    await raf();

    // 4.5) 战场演出总调度（CombatDirector）
    combatDirector = new CombatDirector({
      animator, sceneSys, effects,
      sfx: SFX,
      boardGroup: sceneSys.boardGroup,
      piecesGroup: sceneSys.piecesGroup
    });
    hud.setLoadingProgress(0.84, '布阵士卒冲锋、蓄势、斩击之姿…');
    await raf();

    // 5) 输入 + 控件
    input = createInputSystem({
      domElement: sceneSys.renderer.domElement,
      camera: sceneSys.camera,
      piecesGroup: sceneSys.piecesGroup,
      game: inputGame
    });
    controls = createControls({
      restart: doReset,
      undo: doUndo,
      resetView: () => { sceneSys.resetView(); syncControls(); },
      flipView: () => { sceneSys.flipView(); syncControls(); },
      toggleTopView: () => { sceneSys.toggleTopView(); syncControls(); },
      toggleSound,
      toggleAI,
      setDifficulty,
      toggleFollowCamera,
      resign: doResign,
      toggleHelp: (force) => hud.toggleHelp(force),   // UI-FIX-123：force=false 供 Esc / 关闭按钮强制关闭
      cancelSelection: () => input.deselect('esc'),
      // L2：复盘快捷键分流（controls._bindKeys 按 isReviewActive 覆盖 ←→⏮⏭ Space Esc）
      reviewEnter: () => enterReview(),
      reviewExit: () => exitReview(),
      reviewFirst: () => { if (reviewCtrl) reviewCtrl.first(); },
      reviewPrev: () => { if (reviewCtrl) reviewCtrl.prev(); },
      reviewNext: () => { if (reviewCtrl) reviewCtrl.next(); },
      reviewLast: () => { if (reviewCtrl) reviewCtrl.last(); },
      reviewTogglePlay: () => { if (reviewCtrl) reviewCtrl.togglePlay(); },
      isReviewActive: () => reviewActive
    });
    hud.setLoadingProgress(0.92, '唤醒 AI 心智…');
    await raf();

    // 6) AI 引擎（优先 Worker，失败降级主线程时间切片）
    aiEngine = createAIEngine({
      difficulty,
      onModeChange: (mode, reason) => {
        // D10：大师档仅 worker 开放——engine 降级 sliced 时自动回高手档并同步 UI
        if (mode === 'sliced' && difficulty === 4) {
          difficulty = aiEngine.setDifficulty(3);
          hud.showToast('AI 引擎降级为主线程模式，大师难度不可用，已自动切换为高手', 'warn', 3.0);
        } else {
          hud.showToast(`AI 引擎：${mode === 'worker' ? '独立线程' : '主线程时间切片'}${reason ? '（' + reason + '）' : ''}`, 'info', 2.4);
        }
        if (controls) controls.setMasterAvailable(mode !== 'sliced');
        syncControls();
      }
    });
    hud.setLoadingProgress(1.0, '红方先行');
    await raf();
    await raf();

    // 初始 HUD 同步
    hud.syncAll(gs, {});
    updateCheckRing();
    syncControls();
    if (controls) controls.setMasterAvailable(aiEngine.mode !== 'sliced');   // D10：同步大师档可用态（unknown/worker 开放）
    hud.startTimer();
    SFX.play('start');
    openingAnimation();

    // 主循环
    startLoop();

    // 淡出加载界面
    hud.hideLoading(320);
    // M4：读档恢复提示（遮罩淡出后可见）
    if (restoreToast) hud.showToast(restoreToast, 'info', 3.4);

    // 调试句柄
    window.__game = {
      THREE, gs, sceneSys, effects, animator, aiEngine, input, hud, controls, SFX,
      combatDirector, followCam, computeFollowFitRadius,
      applyMove, rebuildPieces, doReset, doUndo, doResign, toggleAI, setDifficulty, previewMove,
      toggleFollowCamera, saveGame, clearGameSave,   // M4：QA 调试存档读写
      reviewCtrl, renderGs, enterReview, exitReview, // L2：QA 复盘调试（reviewGs / 状态机）
      get reviewGs() { return reviewGs; },
      get reviewActive() { return reviewActive; }
    };
    started = true;

    // H1：启动完成探针（TTI）+ 首局事件
    trackEvent('tti', { ms: elapsedMs(), backend: sceneSys.backend });
    trackEvent('game_start', { aiEnabled, difficulty });
  } catch (err) {
    onFatal({ message: (err && err.message) || '初始化失败', error: err });
  }
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------

function startLoop() {
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // ★ timeScale 集成：hitstop 期间 effectiveDt=0，补间/粒子/震屏全部冻结
    const effectiveDt = dt * animator.timeScale;

    updateTweens(effectiveDt);           // animator.update（使用 effectiveDt）
    // 阶段三待机微动：遍历全部棋子施加轻量呼吸 / 摆臂（移动中自动让位）
    const tIdle = now / 1000;
    const sel = input ? input.getSelection() : null;
    const selMesh = sel ? sel.mesh : null;
    for (let f = 0; f < FILES; f++) {
      if (!pieceMeshes[f]) continue;
      for (let r = 0; r < RANKS; r++) {
        const pm = pieceMeshes[f][r];
        if (pm) animator.tickIdle(pm, tIdle, pm === selMesh);
      }
    }
    // OQ-6：仅对当前选中棋子播放专属待机音（被吃/移动中跳过，避免抢拍）
    if (selMesh && !selMesh.userData._busy) {
      idleSoundTimer -= dt;
      if (idleSoundTimer <= 0) {
        SFX.idle(selMesh.userData.pieceType, { faction: selMesh.userData.pieceSide });
        idleSoundTimer = IDLE_SOUND_INTERVAL;
      }
    } else {
      idleSoundTimer = 0;
    }
    pumpAI(dt);                       // 回合泵：rawDt（不冻回合泵）
    tickFps(effectiveDt);             // H1：fps_bucket 探针（与 scene 帧率状态机同口径）
    if (input) input.update();        // 悬停射线（rawDt）
    if (effects) effects.update(effectiveDt);  // 粒子 / 涟漪 / 尘土 / 残影（effectiveDt）
    if (sceneSys) {
      // L4a/L4b：busy/selected/复盘期间冻结距离评估与 LOD 切换（防动画中抖动）
      sceneSys.setInteractionBusy(!!selMesh || animator.isBusy || reviewActive);
      sceneSys.update(effectiveDt);
    }
    // L4b：按节流后的远景状态切换棋子几何档位（内部再查 busy/selected）
    applyLodByDistance();
    // 跟随相机：scene.update 之后（拿到 controls.update 后的真实相机位）、render 之前
    if (followCam && sceneSys) followCam.update(effectiveDt, sceneSys.camera, sceneSys.controls);
    if (sceneSys) sceneSys.render();
    if (hud) hud.updateTimer();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// 启动
boot();

// ---------------------------------------------------------------------------
// L1 PWA · Service Worker 注册（release-ops-lead）
// 仅在支持 SW 的环境注册；注册失败不阻塞游戏。注册时显式传 scope '/'，
// 保证 SW 接管整站根路径（manifest scope 同此）。
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  // window 'load' 之后注册，避免与首屏资源争抢
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then((reg) => {
        // 仅调试可观察；正式可静默
        if (window.console && console.log) console.log('[SW] registered, scope=', reg.scope);
      })
      .catch((err) => {
        // 注册失败不应影响游戏（SW 是渐进增强）
        if (window.console && console.warn) console.warn('[SW] register failed:', err && err.message);
      });
  });
}
