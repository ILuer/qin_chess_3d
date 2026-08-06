# Phase 5 制作阶段 · 冲刺 Backlog 草案

> 汇编：工作室主理人（游承峰）
> 输入：Wave 1 产物（概念 + 5 GDD + 架构/4 ADR + 美术圣经）、B 项灯光纠偏、Wave 2 真实浏览器冒烟（PASS）
> 用途：把已登记的设计开放问题、美术 CONCERN、工程债与 QA 基线，切成可排期的冲刺条目
> 评审强度：lean（本仓库单人/小队节奏）

---

## 0. 当前基线（已完成，进入 Phase 5 的前提）

| 项 | 状态 | 产物 |
|---|---|---|
| 概念 / 支柱 / MDA | ✅ | `design/concept.md` |
| 系统 GDD（ai / audio / render / rules / ui） | ✅ | `design/gdd/*.md` |
| 架构文档 + 4 ADR（零构建 ESM / vendor-three / AI Worker 切片 / pumpAI 轮询） | ✅ | `docs/architecture/` |
| 美术圣经（含 CONCERN 登记） | ✅ | `docs/art-bible.md` |
| 灯光权威纠偏（scene.js 保持发布态，LIGHT_PRESET 镜像对齐） | ✅ | `src/render/boardMesh.js` + `docs/architecture/LIGHTING-FIX.md` |
| 真实浏览器冒烟（headless Edge + CDP） | ✅ **PASS** | `tests/smoke-report.md`（32 子渲染正确、0 错误） |

> 质量门：Phase 4→5 门控 = **PASS**（冒烟通过，无阻断性错误）。

---

## 1. 冲刺条目池（按优先级）

### 🔴 P0 — 规则/渲染正确性（不修则对局或画面存在硬伤）

| ID | 条目 | 来源 | 路由 | 验收 |
|---|---|---|---|---|
| BK-1 | **实现长将判负**：当前仅困毙/将死判负，连续将军无限循环未判负 | `rules.md §8` | `design-strategist` → `engineering-lead` | 测试局：红方连续将军 ≥ N 步判红负，不卡死 |
| BK-2 | **实现重复局面 / 三次和棋**：长捉、镜像循环无兜底 | `rules.md §8` | `design-strategist` → `engineering-lead` | 同一局面第 3 次出现判和；性能不退化 |
| BK-3 | **战车前导马队 Z≈−0.80 侵入前方相邻点**（越半格 0.5），密集局面视觉穿插 | `CONCERN-3` | `engineering-lead` + `art-director` | 分类型包围盒或收缩进深；对局中相邻子无穿插 |
| BK-4 | **棋子包围盒常量与实测不符**（K=1.12/R=1.08/C=1.02 超 `PIECE_HEIGHT 0.90`） | `CONCERN-3` | `engineering-lead` | 常量改为分类型或对齐实测，碰撞/拾取判定正确 |

### 🟠 P1 — 体验与完整性（影响可玩性/可达性）

| ID | 条目 | 来源 | 路由 | 验收 |
|---|---|---|---|---|
| BK-5 | **键盘无障碍导航**：仅鼠标/触控拾取，无键盘走子 | `ui.md §8` | `design-strategist` → `engineering-lead` | 方向键/字母选子、回车落子；含焦点环 |
| BK-6 | **移动端小屏 HUD 响应式重排** | `ui.md §8` | `design-strategist` + `art-director` | 窄屏（≤480）HUD 不溢出、可操作 |
| BK-7 | **可访问性缺口补齐**：触控目标 34/30px、`user-scalable=no`、`--text-faint`/`--side-red` 对比度未达 AA、缺 `prefers-reduced-motion` | `CONCERN-5` | `art-director` + `engineering-lead` | 触控目标 ≥44px、允许缩放、关键文案对比度 ≥AA、降级动画 |
| BK-8 | **iOS AudioContext 解锁策略**：首手势解锁补齐 | `audio.md §8` | `engineering-lead` | iPhone Safari 首次交互后音效可用 |
| BK-9 | **残局/开局库缺失**：高档位主线程切片深度(4)<Worker(6)，残局可能漏杀 | `ai.md §8` | `design-strategist` → `engineering-lead` | 残局阶段不出现明显漏杀；高档位强度不掉档 |
| BK-10 | **降级时阴影一致性评估**：低画质关阴影后画面观感评估 | `render.md §8` | `art-director` + `engineering-lead` | 降级档画面仍可读、无明显破绽 |

### 🟡 P2 — 技术债 / 整洁（低风险重构与流程）

| ID | 条目 | 来源 | 路由 | 验收 |
|---|---|---|---|---|
| BK-11 | **双 `PALETTE` 改名解歧**：`materials.js`(字符串) 与 `constants.js`(数值) 同名不同义、色值大量冲突 | `CONCERN-2` | `engineering-lead` | 改为 `SURFACE_PALETTE`/`SCENE_PALETTE`；无引用遗漏 |
| BK-12 | **棋子零件合并后可单独高亮子部件**（当前仅整体动画） | `render.md §8` | `engineering-lead` | 可选子部件高亮 API |
| BK-13 | **QA harness 加固 + 对比度探针复健**：本波修复了 403 路径守卫与 headless rAF 节流（`_qa/cdp.mjs`、`p2verify_run.mjs`）；复健 `p1-verify.mjs` 的 readPixels 四视角字面对比度探针（阈值需重新核定） | `tests/smoke-report.md §5` | `quality-lead` | 字形对比度客观探针可跑、给出可辨结论 |
| BK-14 | **音频层扩展**：补充 BGM 层（当前仅 `startAmbient` 氛围层） | `audio.md §8` | `design-strategist` → `audio-director` | 可开关背景音乐，不抢 SFX |

---

## 2. 建议的首个冲刺（Sprint 1，lean 节奏）

**目标**：消除 P0 硬伤 + 打通移动端可达性最小闭环。

- **必做**：BK-1（长将判负）、BK-2（三次和棋）、BK-3/BK-4（战车包围盒与入侵）
- **冲刺内顺带**：BK-7 的可缩放 + 触控目标下限（最小可达性补丁）
- **出冲刺门控（QA）**：rules 新增判负/和棋单测全绿；渲染对局截图复核无穿插；移动端真机/模拟器冒烟复跑 `tests/smoke-report.md` 流程

> 每条 Story 进入制作前，由对应成员（见"路由"列）按 SOP 出 Task ID + 交付物路径；主理人不代写成员专业产出。

---

## 3. 已知风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `quality-lead` agent 在本轮两次交付失败（未落盘报告 / verdict 未达），真实浏览器验证由主理人接管 | QA 节奏不可靠 | 关键 QA 由主理人亲自用 `_qa` harness 跑；quality-lead 仅负责探针脚本维护（BK-13） |
| headless 测试环境误报（已发生 403 + rAF 两处） | 易误判游戏有缺陷 | 已固化修复入 harness；任何"启动失败"先核查 `tests/smoke-report.md §4` 的两类工具链陷阱 |
| 长将/重复局面规则复杂，易引入性能回归 | 对局卡顿 | BK-1/BK-2 带性能单测，冲刺门控含大分支对局压测 |
| 战车包围盒修复可能牵动拾取/碰撞判定 | 走子异常 | BK-3/BK-4 同步改常量与拾取逻辑，单测覆盖边界格 |

---

## 4. 已解决（仅记录，不入冲刺）

- ✅ **CONCERN-1**：灯光权威纠偏，`LIGHT_PRESET` 镜像对齐 `scene.js`（`docs/architecture/LIGHTING-FIX.md`）
- ✅ **CONCERN-4**：`docs/art-bible.md` 已纳入仓库 `qin-chess-3d/docs/`，代码引用路径成立

---

*本 backlog 由主理人依据 Wave 1 文档与本轮冒烟结论汇编；各条目正式排期时由对应成员拆 Epic/Story 并回传主理人集成。*
