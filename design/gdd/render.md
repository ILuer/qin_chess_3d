# GDD · 渲染系统 (render)

## 1. 概述
Three.js 0.169 纯前端 3D 渲染，100% 程序化几何与 Canvas2D 贴图，零外部资源；含场景 / 相机 / 灯光 / 棋子 / 特效 / Juice。

## 2. 目标
以秦风美术呈现可读、流畅、有「分量感」的对弈画面；在中低端设备自适应降级保帧率。

## 3. 核心循环
`main.startLoop`：`updateTweens → input.update → effects.update → scene.update → scene.render`。

## 4. 机制
- 场景：背景 `0x1a2230`，指数雾 `0x232b38`（密度 0.009），曝光 1.14。
- 灯光：主平行 1.95 + 半球 0.98 + 环境 0.52 + 冷补 0.95 + 相机跟随 0.62 + 暖轮廓点光 22 + 红方地灯 12。
- 相机：`OrbitControls` 阻尼 0.075，禁平移，极角限制，距离 6.5~26；预设 red / black / top / topBlack。
- 棋子：`pieceFactory` 七子 = 可辨识 3D 人物 / 器物，每枚 28~45 零件合并 4~8 Mesh；`mergeGeometries` 将 draw call ~1200 压至 ~180。

## 5. 数值
`TIMING`：moveDuration 0.38、captureLunge 0.12、strikeRecoil 0.18、captureDissolve 0.42、liftHeight 0.85、squashDuration 0.16、viewTween 0.75（s）。

## 6. 边界与异常
- 帧率自适应：`_trackFps` 平均 < 40 → 像素比降 1 且关阴影。
- `screenShake` 受相机距离 / 强度钳制，避免眩晕。
- `isBusy`（animator）锁输入，防止动画中重复落子。
- 棋子分组契约 `root>orient>{base, 子组}`，子组经 `userData.subGroups` 访问，为阶段三动画预留。

## 7. 跨系统依赖
- 依赖：`constants`（坐标 / 配色）、`materials` / `pieceFactory` / `boardMesh`（资产）。
- 被依赖：`ui`（射线拾取）、`audio`（落子 / 吃子触发）、`main`（主循环）。

## 8. 开放问题
- 阴影在降级时关闭，画面一致性有待评估。
- 棋子零件合并后无法单独高亮子部件（仅整体动画）。
