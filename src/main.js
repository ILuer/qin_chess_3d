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
  RED, BLACK, PT, FILES, RANKS, BOARD_HALF_W, PALETTE, TIMING, toWorld
} from './core/constants.js';
import { GameState } from './core/gameState.js';
import { createSceneSystem } from './render/scene.js';
import { createEffects } from './render/effects.js';
import { animator, updateTweens } from './render/animator.js';
import { createInputSystem } from './ui/input.js';
import { createHUD } from './ui/hud.js';
import { createControls } from './ui/controls.js';
import { createAIEngine } from './ai/engine.js';
import { createPieceMesh } from './render/pieceFactory.js';
import { createBoard, createEnvironment } from './render/boardMesh.js';
import { getMaterials } from './render/materials.js';
import { SFX } from './audio/sfx.js';

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

// ---------------------------------------------------------------------------
// 棋子网格管理
// ---------------------------------------------------------------------------

/** 依据当前逻辑棋盘重建全部棋子网格（悔棋 / 重开时使用） */
function rebuildPieces() {
  if (sceneSys) {
    for (let f = 0; f < FILES; f++) {
      if (!pieceMeshes[f]) continue;
      for (let r = 0; r < RANKS; r++) {
        const m = pieceMeshes[f][r];
        if (m) sceneSys.piecesGroup.remove(m);
      }
    }
  }
  pieceMeshes = [];
  for (let f = 0; f < FILES; f++) pieceMeshes[f] = new Array(RANKS).fill(null);

  gs.board.forEach((p, f, r) => {
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
// 走子流程
// ---------------------------------------------------------------------------

/**
 * 执行一步走子（用户或 AI 均走此入口）。
 * 先改逻辑模型（gs.move），再驱动视觉动画追平。
 */
function applyMove(from, to) {
  if (gameOver) return;
  if (animator.isBusy || aiBusy) return;   // 动画 / AI 思考中不接受新走子

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

  // 兵种与阵营
  const type = movingMesh ? movingMesh.userData.pieceType : null;
  const side = movingMesh ? movingMesh.userData.pieceSide : null;

  // 声像：按落点纵线左右定位（file 8 = 右，file 0 = 左），营造空间感
  const w0 = toWorld(to.file, to.rank);
  const pan = Math.max(-0.7, Math.min(0.7, (w0.x / (BOARD_HALF_W || 4)) * 0.8));

  // 音效（分兵种差异化；SFX.move / SFX.capture 内部按兵种映射到专属音色）
  if (type) SFX[rec.captured ? 'capture' : 'move'](type, { pan });
  else SFX.play(rec.captured ? 'capture' : 'move');

  // 标记移动中：待机微动让位，避免叠加漂移
  if (movingMesh) movingMesh.userData._busy = true;

  // 落点世界坐标
  const w = toWorld(to.file, to.rank);
  const target = new THREE.Vector3(w.x, 0, w.z);

  // 马走日：加一个折点，呈现"跳跃"弧线
  const isHorse = type === PT.HORSE;
  let waypoints = null;
  if (isHorse) {
    const fw = toWorld(from.file, from.rank);
    waypoints = [new THREE.Vector3((fw.x + w.x) / 2, 0, (fw.z + w.z) / 2)];
  }

  // 收尾：落子回弹 + 棋盘受击 + 粒子 + 走子完成（并解除 _busy 让待机微动接管）
  const finishLand = () => {
    animator.squashLand(movingMesh);                 // 落子回弹（Juice）
    if (sceneSys && sceneSys.boardGroup) animator.boardImpact(sceneSys.boardGroup);
    effects.spawnImpactParticles(
      target,
      rec.captured ? PALETTE.chiHong : PALETTE.liuJin,
      { count: rec.captured ? 60 : 42 }
    );
    if (movingMesh) {
      // 斩杀姿态（非炮）跑约 0.18s，待其结束后待机微动才接管，避免抢拍跳变
      if (rec.captured && type && type !== PT.CANNON && captureMesh) {
        animator.captureStrike(movingMesh, type, side);
      }
      animator.delay(rec.captured ? 0.22 : 0, () => { movingMesh.userData._busy = false; });
    }
    afterMove(rec, from, to);
  };

  // 炮吃子：走「抛石命中 + 原位消失 / 目标位出现 + 警戒复位」分支，不走滑动
  if (type === PT.CANNON && captureMesh) {
    const fw = toWorld(from.file, from.rank);
    const fromVec = new THREE.Vector3(fw.x, 0, fw.z);
    animator.cannonCapture(movingMesh, captureMesh, fromVec, target, side, {
      onHit: (v) => {
        animator.dissolvePiece(v, {
          delay: 0,
          onComplete: (m) => { if (sceneSys) sceneSys.piecesGroup.remove(m); }
        });
        effects.spawnImpactParticles(target, PALETTE.chiHong, { count: 60 });
        effects.screenShake(0.06, 0.26);
      },
      onLand: () => { movingMesh.userData._busy = false; afterMove(rec, from, to); }
    });
    return;
  }

  // 普通移动（含非炮吃子）
  animator.movePiece(movingMesh, target, type, side, {
    waypoints,
    onLand: finishLand
  });

  // 非炮吃子：被吃子消散 + 轻微震屏（与攻击方斩杀同步）
  if (captureMesh && type !== PT.CANNON) {
    captureMesh.userData.__homeY = captureMesh.position.y;
    animator.dissolvePiece(captureMesh, {
      delay: 0.04,
      onComplete: (m) => { if (sceneSys) sceneSys.piecesGroup.remove(m); }
    });
    effects.screenShake(0.06, 0.26);
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

function pumpAI(dt) {
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
  if (animator.isBusy) return;          // 动画中忽略；AI 思考中也会先 cancel
  aiEngine.cancel();
  aiBusy = false;
  animator.killAll(false);
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
}

function doResign() {
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
  syncControls();
  // 若切回人机且此刻正轮到 AI，pumpAI 会在下一帧自动接手
}

function setDifficulty(level) {
  difficulty = aiEngine.setDifficulty(level);
  syncControls();
}

function toggleSound() {
  const on = !SFX.isEnabled();
  SFX.setEnabled(on);
  if (on) SFX.play('select');
  syncControls();
  hud.showToast(on ? '音效已开启' : '音效已静音', 'info', 1.6);
}

/** 走子记录点击：高亮该步并标记其起终点（轻量预览） */
function previewMove(idx) {
  if (!gs) return;
  hud.renderMoveLog(gs.getMoveLog(), idx);
  const rec = gs.history[idx];
  if (rec) effects.showLastMoveMarker(rec.from, rec.to);
}

// ---------------------------------------------------------------------------
// 视觉辅助
// ---------------------------------------------------------------------------

/** 根据当前局面刷新将军红光 / 横幅 */
function updateCheckRing() {
  if (gs.status === 'check' || gs.status === 'checkmate') {
    const k = gs.board.findKing(gs.sideToMove);
    const km = k ? (pieceMeshes[k.file] && pieceMeshes[k.file][k.rank]) : null;
    effects.setCheckedKing(km);
    hud.setCheck(true, gs.sideToMove);
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
  hud.showGameOver({
    title: winner ? (winner === RED ? '红方胜' : '黑方胜') : '和棋',
    detail: gs.getResultText(),
    tone,
    stats: [
      ['回合数', String(Math.max(0, gs.moveNumber - 1))],
      ['着法总数', String(gs.history.length)],
      ['我方吃子', String(gs.captured[aiSide].length)],
      ['对方吃子', String(gs.captured[humanSide].length)]
    ]
  });
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
}

// ---------------------------------------------------------------------------
// 输入适配器（input.js 通过此对象回调，实现 Oil 交互）
// ---------------------------------------------------------------------------

const inputGame = {
  isLocked: () => animator.isBusy || aiBusy || gameOver,
  canControl: (side) => !gameOver && side === gs.sideToMove && (!aiEnabled || side === humanSide),
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
    SFX.play('select');
  },
  onDeselect: () => {
    effects.clearAllHints();
    if (hoverMesh) { animator.unhover(hoverMesh); hoverMesh = null; }
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
}

function onFatalRejection(e) {
  const reason = e && e.reason;
  onFatal({ message: '未处理的异步错误：' + (reason && reason.message ? reason.message : reason), error: reason });
}

async function boot() {
  const container = document.getElementById('canvas-container');

  // HUD 先建，便于显示进度与错误
  hud = createHUD({ onRestart: doReset, onPreviewMove: previewMove });

  // 全局错误兜底（绝不白屏）
  window.addEventListener('error', onFatal);
  window.addEventListener('unhandledrejection', onFatalRejection);
  // 音频：首个用户手势初始化（SFX 未 init 时 play 静默返回）
  const audioInit = () => SFX.init();
  window.addEventListener('pointerdown', audioInit, { once: true });
  window.addEventListener('keydown', audioInit, { once: true });

  try {
    if (!webglAvailable()) {
      throw new Error('当前浏览器不支持 WebGL，请使用 Chrome / Edge / Firefox / Safari 等现代浏览器。');
    }

    hud.setLoadingProgress(0.05, '正在搭建秦风棋枰…');
    await raf();

    // 1) 场景 / 相机 / 渲染器 / 灯光 / 视角控制
    sceneSys = createSceneSystem(container, {
      onQualityDrop: (fps) => hud.showToast(`帧率偏低（约 ${fps}fps），已自动降低画质以保障流畅`, 'warn', 3.2)
    });
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
    rebuildPieces();
    hud.setLoadingProgress(0.68, '凝聚将 / 帅之气…');
    await raf();

    // 4) 效果层（Juice / Windex）
    effects = createEffects(sceneSys);
    hud.setLoadingProgress(0.8, '校准落子涟漪与将军红光…');
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
      resign: doResign,
      toggleHelp: () => hud.toggleHelp(),
      cancelSelection: () => input.deselect('esc')
    });
    hud.setLoadingProgress(0.92, '唤醒 AI 心智…');
    await raf();

    // 6) AI 引擎（优先 Worker，失败降级主线程时间切片）
    aiEngine = createAIEngine({
      difficulty,
      onModeChange: (mode, reason) =>
        hud.showToast(`AI 引擎：${mode === 'worker' ? '独立线程' : '主线程时间切片'}${reason ? '（' + reason + '）' : ''}`, 'info', 2.4)
    });
    hud.setLoadingProgress(1.0, '红方先行');
    await raf();
    await raf();

    // 初始 HUD 同步
    hud.syncAll(gs, {});
    updateCheckRing();
    syncControls();
    hud.startTimer();
    SFX.play('start');
    openingAnimation();

    // 主循环
    startLoop();

    // 淡出加载界面
    hud.hideLoading(320);

    // 调试句柄
    window.__game = {
      gs, sceneSys, effects, animator, aiEngine, input, hud, controls, SFX,
      applyMove, rebuildPieces, doReset, doUndo, doResign, toggleAI, setDifficulty, previewMove
    };
    started = true;
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
    updateTweens(dt);                 // animator.update
    // 阶段三待机微动：遍历全部棋子施加轻量呼吸 / 摆臂（移动中自动让位）
    const tIdle = now / 1000;
    for (let f = 0; f < FILES; f++) {
      if (!pieceMeshes[f]) continue;
      for (let r = 0; r < RANKS; r++) {
        const pm = pieceMeshes[f][r];
        if (pm) animator.tickIdle(pm, tIdle);
      }
    }
    pumpAI(dt);                       // 回合泵：轮到 AI 且动画落定时自动请求走子
    if (input) input.update();        // 悬停射线
    if (effects) effects.update(dt);  // 粒子 / 涟漪 / 标记 / 脉冲
    if (sceneSys) { sceneSys.update(dt); sceneSys.render(); }
    if (hud) hud.updateTimer();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// 启动
boot();
