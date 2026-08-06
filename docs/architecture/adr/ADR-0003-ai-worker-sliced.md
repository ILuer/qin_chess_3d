# ADR-0003 AI Web Worker + 主线程时间切片降级

- **状态**：已采纳（Accepted）
- **日期**：Phase 4 收尾补建（记录既有决策）
- **相关**：`src/ai/engine.js`、`src/ai/search.js`、`src/ai/worker.js`、`DIFFICULTY[]`

## 背景（Context）

中国象棋 AI 采用**迭代加深 negamax + α-β 剪枝**。在给定搜索深度 / 时间上限下，单步思考可能耗时数百毫秒。若**在主线程同步**执行：

- UI 掉帧、输入卡顿，破坏"丝滑落子"体验；
- 思考期间鼠标/轨道控制无响应，体验不可用。

同时，运行环境并不保证 Web Worker（或其 `type:'module'` 形式）始终可用：以 `file://` 直接打开、或某些浏览器/嵌入式 WebView 不支持 module worker 时会创建失败。需要一种"默认零卡顿、失败可降级、永不卡死"的策略。

## 决策（Decision）

对外只暴露 `AIEngine.think(fen, side, opts)`，内部两模自动切换：

1. **首选 module Web Worker**（`new Worker(url, { type:'module' })`）：
   - 彻底不阻塞主线程；
   - `worker.js` 内独立跑搜索，按 `id` 回传结果；
   - **探活**：1.5s 内未收到 `ready`/`pong` 则降级；
   - **硬超时**：`timeLimit + 3000ms` 后 reject 并降级；
   - 运行期 `error` 事件同样触发降级。
2. **降级为主线程时间切片搜索**（`searchBestMoveSliced`）：
   - 迭代加深 + 时间上限 + **每生成两个根走法 `yield` 一次**，把长搜索切成不阻塞 UI 的小片；
   - 对外接口、回调语义与 Worker 模式完全一致，调用方无感。
3. **主线程 ↔ Worker 协议 = FEN 字符串**：
   - 入参 `fen`、回参 `{from,to,score,depth,nodes,elapsed}`；
   - 仅传可序列化数据，**无对象共享**，规避结构化克隆陷阱。

难度由 `DIFFICULTY[]` 表控制（`depth` / `timeLimit` / `randomness`），`cancel()` 在 Worker 模式下通过 `terminate + 重建` 中断当前搜索。

## 备选方案（Alternatives Considered）

1. **纯主线程同步搜索**：实现简单但卡顿不可接受，直接排除。
2. **主线程异步 setTimeout 分片（无 Worker）**：可达"不卡死"，但始终占用主线程算力，复杂局面仍掉帧；作为本方案的降级兜底而非主路径。
3. **SharedArrayBuffer + 多线程**：需要 COOP/COEP 头，破坏"零配置静态部署"目标，排除。

## 后果（Consequences）

**正面**
- 默认零卡顿（独立线程）；
- 降级路径保证"**永不卡死**"——任何 Worker 失败都能自愈为主线程搜索；
- FEN 协议简单、可测（入/出均为字符串/纯对象）。

**负面 / 代价**
- 降级时仍占主线程（极低端设备的已知权衡，见架构文档 §7）；
- 取消搜索在 Worker 模式需 `terminate + reinit`，有一定开销；
- `search.js` 需同时服务"一次性同步搜索（Worker 内）"与"切片搜索（主线程降级）"，复用边界需谨慎维护。

## 备注（Notes）

- 根因上，本 ADR 与 ADR-0004 共同服务于"回合流转鲁棒性"：ADR-0003 保证 AI 思考不阻塞/不崩溃，ADR-0004 保证 AI 回合不被时序竞态吞掉。
- 后续若引入更强引擎，应优先扩展 `search.js` 的接口契约，保持 `engine.js` 双模外壳不变。
