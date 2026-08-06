# GDD · AI 系统 (ai)

## 1. 概述
AI 提供三档难度的人机对弈对手，采用 Negamax + Alpha-Beta + 迭代加深 + 静态搜索；Worker(module) 优先，主线程时间切片降级，保证任意环境可用。

## 2. 目标
在可控时间内给出符合难度档位的「像人」着法，含随机性避免机械复读；落子节奏自然（不显假）。

## 3. 核心循环
`engine.think(fen, side)` → Worker `searchBestMove`（或主线程 `searchBestMoveSliced`）→ `pumpAI(dt)` 每帧轮询 AI 回合 → `applyMove`。

## 4. 机制
- 评估 `evaluate` = 子力 + 位置价值表(PST) + 机动性；`MATE_SCORE=30000`。
- 走法排序 MVV-LVA；静态搜索（quiescence）抑制水平线效应。
- 双模式：Worker（深度 `maxQPly=6`，同步）；主线程切片（每 2 走法 yield，`maxQPly=4`）。

## 5. 数值
| 档位 | 名称 | depth | timeLimit(ms) | randomness |
|---|---|---|---|---|
| 1 | 入门 | 2 | 400 | 26 |
| 2 | 进阶 | 3 | 900 | 8 |
| 3 | 高手 | 4 | 1800 | 0 |

## 6. 边界与异常
- Worker 探活超时 1.5s → 降级主线程切片搜索（不阻塞 UI）。
- `minDelay=260ms`：AI 落子前最短延迟，避免「秒落」显假。
- `cancel()` 重建 worker 以终止上一思考；`onModeChange` 通知 UI。
- 主线程切片受帧预算约束，超 `timeLimit` 即截断返回当前最优。

## 7. 跨系统依赖
- 依赖：`rules`（合法走法 / 状态）、`constants`、`gameState`（FEN）。
- 被依赖：`main`（`pumpAI` 轮询）、`ui`（难度选择 / 模式指示）、`audio`（思考 / 落子音）。

## 8. 开放问题
- 主线程切片深度(4) 低于 Worker(6)，低性能设备下高档位强度打折。
- 无开局库 / 残局库，残局阶段搜索可能低效或漏杀。
