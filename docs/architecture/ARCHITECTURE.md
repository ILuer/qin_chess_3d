# 秦风 · 3D 中国象棋 — 架构文档

> 阶段：Phase 4 收尾（补建）
> 负责人：engineering-lead（程基岩）
> 配套文档：`docs/architecture/adr/`（ADR-0001~0004）、`docs/architecture/LIGHTING-FIX.md`
> 代码基线：`qin-chess-3d/src/`（Three.js r169，零构建 ESM + importmap）

---

## 1. 系统概览

「秦风 · 3D 中国象棋」是一款**纯前端** 3D 中国象棋游戏：

- 渲染：**Three.js r169**，原生 `WebGLRenderer` + `OrbitControls`。
- 构建：**零构建步骤**，原生 ES Module + `importmap`；三方库以本地 `vendor/three` 形式存在，**无打包器、无 CDN、无运行时外部依赖**（见 ADR-0001 / ADR-0002）。
- 资产：**100% 程序化**，零外部图片 / 模型 / 音频文件；贴图由 Canvas2D 运行时绘制成 `CanvasTexture`，音效由 WebAudio 振荡器实时合成。
- 分层：

  | 层 | 目录 | 职责 | 是否依赖 Three.js |
  |---|---|---|---|
  | 核心逻辑层 | `src/core/` | 棋盘模型 / 规则 / 回合 / 记谱 / 胜负判定 | 否（可被 node / Worker 直接加载） |
  | 渲染层 | `src/render/` | 场景 / 相机 / 灯光 / 材质 / 棋子网格 / 动画 / 特效 | 是 |
  | UI 层 | `src/ui/` | 输入射线 / HUD / 控制栏（DOM） | 否（仅 DOM + 少量 constants） |
  | AI 层 | `src/ai/` | 搜索 + Worker 封装 | 否（走 FEN 协议） |
  | 音频层 | `src/audio/` | 程序化音效 | 否（WebAudio） |
  | **集成层** | `src/main.js` | 启动 / 主循环 / 走子编排 / 全局兜底 | 是（唯一同时认识所有层） |

- **单一真相源（Single Source of Truth）**：`GameState`（纯逻辑，不依赖 Three.js）。视觉层 `pieceMeshes[file][rank]` 只是逻辑棋盘的**派生投影**（见 §5）。

---

## 2. 分层架构与模块依赖

依赖方向（箭头 = "依赖 / import"）：所有跨层依赖**单向向下**，无环。

```
                         ┌──────────────────────────────────────────────┐
                         │              src/main.js  (集成层)             │
                         │  boot 分阶段加载 · 主循环 · applyMove · 全局兜底 │
                         │  inputGame 适配器 · window.__game 调试句柄      │
                         └───────────────────┬────────────────────────────┘
                                             │ 组装并连接全部子系统
        ┌────────────────┬───────────────────┼───────────────────┬────────────────┐
        │   core/        │      render/      │       ui/          │   ai/  audio/  │
        │   逻辑层       │      渲染层       │      DOM 层        │   搜索  WebAudio │
        └───────┬────────┴────────┬──────────┴────────┬──────────┴───────┬────────┘
                │                 │                   │                  │
   constants ◄──┤                 │                   │                  │
                │                 │                   │                  │
      board ◄───┤                 │ materials         │                  │
                │                 │   ▲               │                  │
     rules ◄────┘                 │   │               │                  │
                │                 │   │               │                  │
  gameState ────┘                 │ boardMesh ────────┤  (LIGHT_PRESET  │
                                  │   (LIGHT_PRESET 镜像)   │   镜像文档出口)  │
                                  │   ▲               │                  │
                                  │ pieceFactory      │                  │
                                  │ animator          │   input ─────────┤
                                  │ effects           │   hud            │
                                  │   ▲               │   controls       │
                                  │ scene ────────────┘                  │
                                  │   (灯光硬编码于 scene.js；LIGHT_PRESET 仅镜像) │
                                  │                                     │
                                  │            search ◄─ engine         │
                                  │              (board+FEN 协议)  worker│
                                  │                                     │
                                  └──────────────── sfx (无项目内依赖) ──┘
```

### 2.1 逐模块依赖明细

```text
core/
  constants.js   : —                         （叶子，所有共享常量/枚举的归宿）
  board.js       : constants                 （纯数据 Board：90 格一维数组；不依赖 Three.js）
  rules.js       : constants                 （生成合法走法/状态/解释；Board 以参数传入，不 import）
  gameState.js   : constants, board, rules   （回合/历史栈/中文纵线记谱/胜负与和棋判定）

render/
  materials.js   : three + Canvas2D          （材质库 + PALETTE + 纹理生成；叶子）
  boardMesh.js   : materials                 （createBoard / createEnvironment / LIGHT_PRESET 镜像文档）
  pieceFactory.js: materials                 （createPieceMesh）
  animator.js    : constants                 （updateTweens + animator 单例：补间/微动/特效动画）
  effects.js     : constants                 （createEffects：粒子/涟漪/标记/将军脉冲，吃 sceneSys）
  scene.js       : constants                 （createSceneSystem：场景/相机/灯光/视角/帧率自适应；灯光硬编码引用 constants.PALETTE，不 import boardMesh）

ai/
  search.js      : constants, rules, board   （negamax + 迭代加深 + 主线程切片变体）
  engine.js      : board, search             （AIEngine：Worker 优先，失败降级主线程切片）
  worker.js      : board, search             （module Web Worker 入口）

ui/
  input.js       : constants                 （createInputSystem：射线拾取/悬停/选择/走子）
  hud.js         : constants                 （createHUD：回合/计时/吃子/走子记录/toast/结束面板）
  controls.js    : —                         （DOM 按钮与快捷键绑定，仅操作 DOM）

audio/
  sfx.js         : —                         （SFX 单例：纯 WebAudio 合成，无项目内依赖）

main.js          : ALL（core/render/ui/ai/audio 全部 import）  —— 唯一的集成层
```

### 2.2 关键依赖约束（不可破坏）

- **无循环依赖**。`scene.js` 与 `boardMesh.js` 之间**没有依赖关系**：`scene.js` 仅 import `constants.js`（灯光硬编码引用 `PALETTE`），`boardMesh.js` 仅 import `materials.js` 且**永不反向 import `scene.js`**。
- **灯光权威在 `scene.js`**：`LIGHT_PRESET`（由 `boardMesh.js` 导出）只是 `scene.js` 灯光方案的**文档化镜像**，供美术/文档参考；`scene.js` 不直接消费它。调参改 `scene.js` 或 `constants.js` 的 `PALETTE`（详见 `LIGHTING-FIX.md`）。
- `ui/input.js` 不直接 import `gameState.js`；它通过 `main.js` 注入的 `inputGame` 适配器对象访问逻辑（见 §5）。这保持了 UI 层对核心逻辑层仅有"数据契约"级耦合。

---

## 3. 分阶段启动序列

来自 `main.js` 的 `boot()`（每阶段之间 `await raf()` 让加载条有机会重绘）：

| 阶段 | 进度 | 动作 |
|---|---|---|
| 0 前置 | 0.00 | 建 HUD（最早，便于显示进度/错误）；挂全局错误兜底 `onFatal` / `onFatalRejection`；WebGL 可用性检测；首个用户手势初始化音频 |
| 1 场景 | 0.05→0.20 | `createSceneSystem(container, {onQualityDrop})` —— 场景/相机/渲染器/灯光/轨道控制 |
| 2 棋盘+环境 | 0.20→0.44 | `getMaterials()` 预热；`createBoard()` 入 `boardGroup`；`createEnvironment()` 入 `envGroup` |
| 3 局面+棋子 | 0.44→0.68 | `new GameState()`；`rebuildPieces()`（`pieceMeshes[f][r] = createPieceMesh(...)`） |
| 4 特效 | 0.68→0.80 | `createEffects(sceneSys)` |
| 5 输入+控件 | 0.80→0.92 | `createInputSystem(...)`；`createControls(...)` |
| 6 AI | 0.92→1.00 | `createAIEngine({difficulty, onModeChange})`（优先 Worker，失败降级主线程切片） |
| 收尾 | 1.00 | `hud.syncAll` / `updateCheckRing` / `syncControls` / `hud.startTimer` / `SFX.play('start')` / `openingAnimation()` / `startLoop()` / `hud.hideLoading` / `window.__game = {...}` |

> 设计要点：HUD 先于一切创建，任何阶段的异常都被 `onFatal` 捕获并渲染可读错误，**绝不白屏**。

---

## 4. 主循环

`startLoop()` 每帧 `frame(now)`：

```text
1. dt = min(0.05, (now - last) / 1000)          // 夹住 dt，避免标签页切回时巨步
2. updateTweens(dt)                             // animator 补间泵（动画/特效计时推进）
3. 待机微动：for each pieceMesh → animator.tickIdle(pm, tIdle)
                                            // 移动中(_busy)的棋子自动让位，不叠加漂移
4. pumpAI(dt)                                  // 每帧轮询：轮到 AI 且动画落定 → requestAI
                                            // （见 ADR-0004，杜绝"AI 被吃后失联"）
5. input.update()                              // 悬停射线
6. effects.update(dt)                          // 粒子 / 涟漪 / 标记 / 将军脉冲
7. sceneSys.update(dt) → sceneSys.render()     // 视角插值/补光跟随/震屏/帧率统计与降档；含震屏偏移渲染
8. hud.updateTimer()
9. requestAnimationFrame(frame)
```

顺序约束：`updateTweens` 必须先于一切消费动画状态的模块；`pumpAI` 在 `input.update` 之前，使"AI 回合"与"玩家输入"互斥由 `animator.isBusy` / `aiBusy` 统一仲裁；`sceneSys.render` 永远是帧末。

---

## 5. 数据流：逻辑 ↔ 视觉

```
┌─────────────── 逻辑真相源 ───────────────┐        ┌──────── 视觉投影 ────────┐
│  gs.board : 90 格一维数组 {type,side}|null│        │ pieceMeshes[f][r]        │
│  GameState：move/undo/status/记谱/胜负     │  ◄──►  │ = THREE.Group | null    │
└───────────────────────────────────────────┘        └──────────────────────────┘
                  │  applyMove 先行改逻辑                          ▲
                  ▼                                               │ 动画追平
            gs.move(from,to) → record(captured)          animator.movePiece /
                  │                                        cannonCapture / dissolve
                  │  更新 pieceMeshes 映射（from→null, to→mesh）  │
                  ▼                                               │
            afterMove(rec) → 标记/将军判定/HUD/胜负               │
                  │                                               │
                  └──────────── pumpAI 接管下一回合 ◄──────────────┘
```

`applyMove(from, to)`（核心编排，见 `main.js`）：

1. **逻辑先行**：`gs.move(from, to)` 先变更 `GameState`，返回含 `captured` 的 record；非法直接 `hud.showToast` 返回。
2. **更新投影映射**：把 `pieceMeshes[from]` 置空、`pieceMeshes[to]` 指向移动网格，并刷新 `userData.cell`。
3. **清选择/提示/悬停**，标记 `_busy`（待机微动让位）。
4. **驱动动画追平**：`animator.movePiece`（马加折点呈跳跃弧线）、炮吃走 `cannonCapture`、被吃子 `dissolvePiece` + 轻微震屏；落定回调 `finishLand` 触发落子回弹 / 棋盘受击 / 粒子 / 斩杀姿态。
5. `onLand → afterMove(rec)`：末步标记、将军红光与横幅、`hud.syncAll`、`syncControls`、胜负判定；之后由 `pumpAI` 每帧接管下一回合。

**为什么这样设计**：逻辑权威、动画"尽力追平"。即使某一帧动画丢失/迟到，也永不污染游戏状态；`pumpAI` 每帧重判，回合流转不可能因时序竞态死锁。`rebuildPieces()`（悔棋/重开）从 `gs.board` 整体重建投影，再次印证"逻辑即真相源"。

`inputGame` 适配器（`main.js` 注入 `createInputSystem`）：把 `gs` 暴露为 `pieceAt / legalMoves / blockedPoints / whyIllegal / meshAt / onSelect / onMove / onIllegal / onHover` 等方法与回调，**输入层无需 import `gameState.js`** 即可完成交互。

---

## 6. 关键设计决策

1. **逻辑 / 渲染分离 + 单一真相源**：`GameState` 纯逻辑、不依赖 Three.js、可被 node 与 Web Worker 直接加载、可单测。
2. **`applyMove` 逻辑先行、动画追平**：状态正确性不依赖渲染时序。
3. **分层、无环依赖；灯光权威在 `scene.js`**：`scene.js` 自行硬编码灯光（引用 `constants.PALETTE`），`boardMesh.js` 仅把 `LIGHT_PRESET` 作为镜像文档导出，`scene.js` 不消费它（`boardMesh` 永不反向依赖 `scene`）。
4. **`main.js` 唯一集成层 + `inputGame` 适配器**：各子系统互不直接耦合；输入层对逻辑层仅"数据契约"级耦合。
5. **AI 走 FEN 字符串协议 + Worker / 主线程切片双模**：主线程与 Worker 之间仅传可序列化 FEN，无对象共享（见 ADR-0003）。
6. **`pumpAI` 每帧轮询而非一次性事件触发**：把"回合该不该流转"建模为持续状态而非瞬时事件，结构上消除"错过时间窗"类失败（见 ADR-0004）。
7. **零构建 ESM + importmap + 本地 vendored Three.js**：即开即玩、易部署、无外部依赖（见 ADR-0001 / ADR-0002）。
8. **全局错误兜底，绝不白屏**：`onFatal` / `onFatalRejection` 在加载界面渲染可读错误。
9. **`window.__game` 调试句柄**：仅开发期诊断（暴露 gs/sceneSys/effects/animator/aiEngine/input/hud/controls/SFX 及核心函数）。

---

## 7. 已知技术债务

| 项 | 状态 | 说明 |
|---|---|---|
| 灯光实现与文档镜像脱节 | **已对齐** | `scene.js` 灯光值硬编码（引用 `src/core/constants.js` 的 `PALETTE`）；`boardMesh.js` 的 `LIGHT_PRESET` 作为镜像文档已对齐 `scene.js` 实际值，消除以往文档与实现脱节（见 `LIGHTING-FIX.md`）。 |
| 子路径部署 / Worker URL 的 DNS 历史 | **已缓解** | 早期从 CDN 加载 Three.js，存在 DNS 解析 / 可用性历史问题。现 `worker.js` 用 `new URL('./worker.js', import.meta.url)` 且 importmap 用相对路径，子路径部署（如 `/qin_chess_3D/`）成立（见 ADR-0002）。 |
| `_altindex` 残留 | **待确认（本 checkout 未命中）** | 此前登记过一项名为 `_altindex` 的残留字段 / 代码。当前 `src/` 下 `grep` **无匹配**——可能已在某次清理中移除，或存在于本 checkout 之外的分支。建议后续在完整仓库上再 grep 一次确认；**本文档不臆造其位置**。 |
| AI 主线程切片回退 | **已知权衡** | 降级路径保证"永不卡死"，但在极低端设备仍会占用主线程（见 ADR-0003）。 |
| 程序化几何合并的 dispose | **低优先** | `boardMesh.js` / `createEnvironment()` 通过 `userData.dispose` 释放几何；整局不重建棋盘，故影响有限，作为后续清理项。 |

---

*文档与 `src/` 实际导出一致；模块依赖图依据各文件 `import` 语句核对（2025-07，Phase 4）。*
