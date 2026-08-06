# 冒烟测试报告 · Smoke Test Report

> 项目：`qin_chess_3D`（Three.js 纯前端零构建 3D 中国象棋）
> 测试类型：真实浏览器冒烟（headless Edge + CDP，软件 WebGL）
> 负责人：工作室主理人（游承峰）亲自执行 —— quality-lead agent 在本轮两次交付失败，主理人接管并完成真实浏览器验证
> 日期：2026-08-06（实测）、2026-08-07（归档）

---

## 1. 结论（Verdict）：**PASS ✅**

游戏在真实（无头）浏览器中**完整启动、初始化、渲染正确**：

| 检查项 | 结果 |
|---|---|
| 文档与全部模块 HTTP 200 | ✅（仅 `favicon.ico` 404，无害） |
| `window.__game` 调试句柄就绪 | ✅ 17 个 API 键全部就位 |
| 棋子网格 `piecesGroup` 子节点数 | ✅ **32**（中国象棋标准 32 子） |
| 兵种分布（R/N/B/A/K/C/P） | ✅ 4/4/4/4/2/4/10 = 32，与初始局面一致 |
| 控制台错误 `consoleErrors` | ✅ 0 |
| 运行时异常 `exceptions` | ✅ 0 |
| 失败请求 `failedRequests` | ✅ 0 |
| WebGL 软渲染（`swiftshader`） | ✅ 可用，`webglAvailable()` 通过 |

---

## 2. 测试环境

- **浏览器**：Microsoft Edge（无头，`--headless=new`），路径 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- **驱动**：`_qa/cdp.mjs`（零依赖 Chrome DevTools Protocol harness，Node 22 原生 WebSocket）
- **WebGL**：`--enable-unsafe-swiftshader --use-angle=swiftshader`（无头软件渲染）
- **静态服务**：harness 内联 `http.createServer`，从 `qin-chess-3d/` 根提供文件
- **入口**：`index.html` → `src/main.js`（`type="module"`，importmap 映射 `three` / `three/addons/` 到本地 `vendor/three/`）

### 探针覆盖
- 加载 `index.html` 后轮询 `window.__game`（最多 20s）
- 采集 `consoleErrors` / `exceptions` / `failedRequests` / `pageErrors` / 全量 HTTP 状态码
- 直接 `evaluate` 读取 `sceneSys.piecesGroup.children` 与逐兵种计数（`userData.pieceType`）
- `requestAnimationFrame` 探针（`rafProbe`）：确认 headless 下 rAF 正常触发

---

## 3. 证据（实测原始数据摘要）

```
rafProbe: "RAF_FIRED"
game.hasGame: true
game.keys: [gs, sceneSys, effects, animator, aiEngine, input, hud, controls,
            SFX, applyMove, rebuildPieces, doReset, doUndo, doResign,
            toggleAI, setDifficulty, previewMove]   // 17 个，齐全
game.piecesGroupChildren: 32
game.byType: { R:4, N:4, B:4, A:4, K:2, C:4, P:10 }   // 合计 32
failedRequests: []
consoleErrors: []
non200: [ favicon.ico 404（无害） ]
```

全部 21 个 JS 资源（`src/main.js` + 各模块 + `vendor/three/*`）均返回 200；无 `ERR_*`、无 `404` 游戏资源。

---

## 4. ⚠️ 重要前提：本次首次运行时是**误报 FAIL**，根因在测试工具本身

本波前两次冒烟运行**错误地报 `ready=false` / `window.__game` 未定义**。经排查，失败**与游戏代码无关**，而是 QA harness 的两处 bug：

1. **静态服务器路径守卫的 Windows 路径分隔符 bug**（关键）
   - 旧代码：`const f = path.join(ROOT, p); if (!f.startsWith(ROOT)) { 403 }`
   - `path.join` 在 Windows 把 `f` 规范成反斜杠（`C:\Users\...\qin-chess-3d`），而 `ROOT` 是斜杠（`C:/Users/...`）→ `startsWith(ROOT)` 恒为 `false` → **每个请求（含文档本身）都返回 403** → 浏览器收不到 `index.html` → 模块从不执行。
   - 修复：改用 `path.resolve` 归一化后比较 `f !== ROOT_NORM && !f.startsWith(ROOT_NORM + path.sep)`。

2. **缺少 headless rAF 反节流开关**
   - 游戏 `boot()` 用 `await raf()`（即 `await new Promise(r => requestAnimationFrame(r))`）做分步加载。无头模式下 `requestAnimationFrame` 默认被后台节流、永不触发 → `boot()` 卡在第一个 `await raf()` → `window.__game` 永不赋值（且 `catch` 的 `console.error` 不会触发，所以表现为"无错误但无句柄"）。
   - 修复：在 `_qa/cdp.mjs` 启动参数加入
     `--disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`。

**修复后重跑 → 立即 PASS（见 §3）。** 故"游戏启动失败"是工具链误报，游戏本身健康。

> 这两条修复已落入 `_qa/cdp.mjs` 与 `_qa/p2verify_run.mjs`，后续 QA 复用即可。请勿据此误判游戏有启动缺陷。

---

## 5. 已知限制（非阻塞）

- **字形可读性（七子字面清晰可辨）未做客观对比度测量**：本波未跑 `_qa/p1-verify.mjs` 的 `readPixels` 四视角对比度探针（该脚本依赖的旧路径已废弃，且其验收阈值需重新核定）。主观清晰度需人工目检，列为 backlog 项。
- **AI 对弈、落子交互、悔棋/重开**等玩法链路未经自动化端到端验证（仅确认引擎对象与 API 挂载成功）。
- **性能/帧率**未量化（headless 软件渲染不代表真机性能）。

---

## 6. 复现命令

```bash
# 需 dangerouslyDisableSandbox：浏览器拉起与端口绑定被沙箱拦截
cd _qa
node p2verify_run.mjs          # 输出 tests/... 同口径的 p2-verify.json（就绪 + 棋子探针）
node diag_failed.mjs           # 更详尽：rAF 探针 + 全量 HTTP 状态码 + 逐兵种计数
```

---

*本冒烟报告基于主理人亲自执行的真实浏览器验证；quality-lead 在本轮两次"completed"均未落盘 `tests/smoke-report.md`、verdict 未送达，故由主理人接管完成。游戏代码未经任何为通过测试而做的改动。*
