# ADR-0004 每帧轮询泵 `pumpAI`（替代一次性事件触发）

- **状态**：已采纳（Accepted）
- **日期**：Phase 4 收尾补建（记录既有决策）
- **相关**：`src/main.js` 第 227–243 行注释、`pumpAI(dt)`、`applyMove` 逻辑先行设计

## 背景（Context）—— 根因

原实现是**一次性事件触发**：走子动画结束时调一次 `maybeRequestAI`，再用 `setTimeout(…, 60ms)` 兜底调一次；两次都带 `animator.isBusy` 判断。

**吃子路径的时序竞态**：被吃方的消散动画（延迟 `0.19s` + 时长 `0.42s`，约 `0.61s` 才解锁）活得比主移动动画（`0.38s`）更久。于是：

- `setTimeout` 兜底在 ≈`0.44s` 触发时，`animator.isBusy` 仍为 `true`（消散未完）→ 被 `isBusy` 拦掉；
- 一次性触发再无重试 → **此后永久不再请求 AI；
- 表现即「**AI 棋子被吃后回合流转中断、AI 永久失联**」；
- 不吃子时消散动画不存在，所以**只有吃子这一条路径会挂**。

这正是把"回合该不该流转"误当成"瞬时事件"来处理所带来的结构性失败——事件一旦错过时间窗，就再无机会。

## 决策（Decision）

改用 **`pumpAI(dt)` 每帧轮询**「是否轮到 AI 且动画已落定」：

```js
function pumpAI(dt) {
  if (!gs || !aiEnabled || gameOver || aiBusy) return;
  if (gs.sideToMove !== aiSide) return;
  if (animator.isBusy) { aiCooldown = AI_THINK_DELAY; return; }  // 动画未落定，重置节奏
  aiCooldown -= dt;
  if (aiCooldown > 0) return;
  aiCooldown = AI_THINK_DELAY;                                    // 避免抢拍显得机械
  requestAI();
}
```

- 把"回合该不该流转"建模为**持续为真的状态**，而非瞬时事件；
- 触发条件一旦成立必被命中，**结构上不存在「错过时间窗」**——无论消散动画多晚解锁，下一帧即可自愈；
- 配合 `AI_THINK_DELAY = 0.16s`（落定后短暂停顿）与 `animator.isBusy` 判定。

## 备选方案（Alternatives Considered）

1. **原方案：一次性事件 + setTimeout 兜底**：即导致失联的根因，排除。
2. **延长兜底超时到 > 消散时长（如 700ms）**：能缓解"吃子"这条路径，但仍是脆弱的"猜时长"——一旦动画时序微调又失守，且双人/特殊走法仍可能错窗。属打补丁而非根治。
3. **动画结束回调里显式触发 AI**：依赖每个动画分支都正确回调；分支多（移动/炮吃/斩杀/消散）易遗漏，且与 `applyMove` 逻辑先行设计耦合。轮询更解耦、更鲁棒。

## 后果（Consequences）

**正面**
- AI **永不因时序竞态失联**——多晚都自愈；
- 吃子 / 非吃子路径统一处理，无需为特殊分支单独接线；
- 悔棋 / 重开 / 切换 AI 后，由 `pumpAI` 下一帧自然接手，无残留状态。

**负面 / 代价**
- 每帧多一次轻量布尔判定（可忽略）；
- 正确性**依赖 `animator.isBusy` 在动画真正结束时翻 `false`**——需 `animator` 侧保证所有动画分支（含消散/斩杀）在收尾时正确解锁，否则轮询会空转或早触发。

## 备注（Notes）

- 根因分析原文见 `src/main.js` `pumpAI` 上方注释（第 227–243 行），本 ADR 为其正式记录；
- 与 `applyMove`「逻辑先行、动画追平」、ADR-0003「AI 思考不阻塞」共同构成**回合流转的鲁棒底座**：逻辑权威 + 动画追平 + 状态轮询 = 任何单点失败都能自愈。
