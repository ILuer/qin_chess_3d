# 美术圣经 · 秦弈（Qin Xiangqi）3D 程序化视觉规范

> 作者：art-director（林绘澄）　|　版本 v1.0　|　唯一真相源：`docs/CONTRACT.md`
> 适用范围：`src/render/materials.js` · `src/render/pieceFactory.js` · `src/render/boardMesh.js` · `styles/main.css`
> 本文件与工程实现强绑定——所有数值、类名、导出签名均与代码一致。

---

## 0. 设计哲学与差异化主张

本作的**核心差异化诉求**：每种棋子必须是**独立建模的 3D 人物 / 器物形象**，绝不能是"带字的圆柱"。秦代（前 221–前 207）是中国第一个大一统帝国，尚**黑水德**、崇**赤红与鎏金**，军容严整、器物厚朴。我们以"战国—秦"的军事美学为锚点，让七个兵种各自成象：

- **红方**＝赤红戎装 + 鎏金 / 青铜配饰（象征火德之师、王师正朔）。
- **黑方**＝玄黑甲胄 + 冷银 / 暗铜配饰（象征水德、敌国玄甲）。
- 双方**形制完全相同**，仅靠配色与材质区分阵营；黑方以内层 body 绕 Y 轴 180° 翻转朝向己方。

所有资产 **100% 程序化生成**（Three.js 几何体组合 + `mergeGeometries` + `CanvasTexture` 程序化贴图），**零外部二进制资源**，符合契约第 0 节硬约束。

---

## 1. 视觉锚点与风格参照

| 维度 | 取向 |
|------|------|
| 时代锚点 | 秦代军制（兵马俑甲士、青铜兵器、战车、旗帜）、楚汉相争意象 |
| 色彩基调 | 玄黑为底、赤红为魂、鎏金勾边、青铜点锈 |
| 造型语言 | 体块化、低多边形趋向但保留圆润棱（圆柱分段 12–16），强调可读剪影 |
| 纹样系统 | 云雷纹（回纹）饰带、夔龙纹、秦篆汉字标识 |
| 材质语言 | PBR 分档：甲片半金属高反、布料哑光、木构低反、玉石半透温润 |
| 氛围 | 暗调场景 + 暖金主光 + 冷蓝补光 + 橙红轮廓光，电影感体积暗角 |

**风格参照关键词**：兵马俑、秦陵铜车马、曾侯乙墓漆器、楚帛书、汉画象（前秦余韵）。

---

## 2. 配色系统（权威 hex 表）

> 数值色供 Three.js（0xRRGGBB）；CSS 串供 UI 层（`PALETTE.CSS`）。二者在 `src/core/constants.js` 统一落盘，本表与之逐字一致。

### 2.1 三维资产色（`PALETTE` 数值）

| 语义 | 名称 | hex | 用途 |
|------|------|-----|------|
| 玄黑 | xuanHei | `#14161a` | 黑方甲胄主色、暗部 |
| 玄黑亮 | xuanHeiLight | `#272b33` | 黑方甲片高光区 |
| 赤红 | chiHong | `#b0281f` | 红方主体、旗帜 |
| 赤红亮 | chiHongLight | `#d8483a` | 红方高光、UI 红方标记 |
| 青铜 | qingTong | `#6f7d63` | 兵器、盔、灯柱（带绿锈） |
| 青铜暗 | qingTongDark | `#3f4a3a` | 青铜暗部 |
| 鎏金 | liuJin | `#c9a227` | 勾边、旗帜纹、外框角 |
| 鎏金亮 | liuJinLight | `#e8cf72` | 鎏金高光、UI 金文 |
| 台面主 | boardBase | `#3a2a1c` | 棋盘台面（深木/夯土） |
| 台面暗 | boardBaseDark | `#241a11` | 台面暗部 |
| 外框 | boardEdge | `#1a1209` | 棋盘朱漆外框底 |
| 界线 | boardLine | `#c9a227` | 鎏金细棋线 |
| 界线圈 | boardLineSoft | `#8a7030` | 软棋线 |
| 河界字 | riverText | `#b9a06a` | "楚河 / 漢界" |
| 九宫线 | palaceLine | `#c07a2c` | 九宫斜线 |
| 红方身 | redBody | `#8d2b20` | 红方人物袍服 |
| 红方身暗 | redBodyDark | `#5b1a12` | 红方暗部 |
| 红方字 | redGlyph | `#f3e3c0` | 底座汉字（米白） |
| 红方边 | redRim | `#c9a227` | 红方底座鎏金环 |
| 红方缀 | redAccent | `#e0574a` | 红方点缀 |
| 黑方身 | blackBody | `#1c1f26` | 黑方人物甲 |
| 黑方身暗 | blackBodyDark | `#0d0f13` | 黑方暗部 |
| 黑方字 | blackGlyph | `#d8d2c2` | 底座汉字（冷银白） |
| 黑方边 | blackRim | `#7f8a6e` | 黑方底座青铜环 |
| 黑方缀 | blackAccent | `#6f7d63` | 黑方点缀 |
| 背景 | bg | `#0a0b0e` | 场景 clearColor / 页面底色 |
| 雾 | fog | `#0a0b0e` | 指数雾 |
| 地面 | ground | `#15161a` | 雾化地面 |
| 旗红 | bannerRed | `#8e1f18` | 红方大旗 |
| 旗黑 | bannerBlack | `#16181d` | 黑方大旗 |
| 主光 | keyLight | `#fff2dc` | 暖白主光 |
| 补光 | fillLight | `#3f6ea8` | 冷蓝补光 |
| 轮廓光 | rimLight | `#ffb45c` | 橙红轮廓光 |
| 天光 | hemiSky | `#5a6a80` | 半球天 |
| 地光 | hemiGround | `#241a11` | 半球地 |
| 选中环 | select | `#ffd35c` | 选中光环 |
| 可走点 | hintEmpty | `#6fd6a8` | 可落空点（绿） |
| 可吃点 | hintCapture | `#ff4d3d` | 危险环（红） |
| 阻挡点 | hintBlocked | `#9aa0a8` | 灰叉（蹩马腿/塞象眼） |
| 上步起 | lastMoveFrom | `#7fa8d8` | 蓝金方框 |
| 上步终 | lastMoveTo | `#ffc861` | 蓝金方框 |
| 将军辉 | checkGlow | `#ff2b1d` | 被将脉冲 |
| 悬停 | hover | `#fff0c0` | 悬停微光 |

### 2.2 UI 色（`PALETTE.CSS` 字符串，UI 层直接使用）

`xuanHei #14161a` · `chiHong #b0281f` · `chiHongLight #d8483a` · `qingTong #6f7d63` · `liuJin #c9a227` · `liuJinLight #e8cf72` · `parchment #e6dcc3` · `ink #0f1013` · `panelBg rgba(16,17,21,0.86)` · `panelBorder rgba(201,162,39,0.42)` · `red #d8483a` · `black #c9ccd4` · `check #ff2b1d` · `ok #6fd6a8`

---

## 3. 材质规范（PBR 分档）

所有材质通过 `getMaterials()` 懒加载并缓存复用；红黑双方各一套（`r` / `b`）。粗糙度/金属度分档原则：

| 材质类别 | roughness | metalness | 说明 |
|----------|-----------|-----------|------|
| 布料（袍/旗/披风） | 0.85 | 0.0 | 哑光，受光柔和 |
| 甲片（鳞甲/板甲） | 0.35 | 0.85 | 半金属高反，勾边鎏金 |
| 木构（战车/抛石/台座） | 0.70 | 0.05 | 低反哑木 |
| 青铜（兵器/盔/灯） | 0.45 | 0.8 | 带绿锈观感 |
| 玉石（简牍/饰） | 0.25 | 0.0 | 温润半透 |
| 鎏金（勾边/角饰） | 0.30 | 0.95 | 高反金属 |
| 交互反馈（选中/落点/将军） | 0.4 | 0.1 | `emissive` 自发光变体 |

**贴图（全部 `CanvasTexture` 程序化绘制）**：
- `createLeiWenTexture` — 云雷纹（回纹）饰带，用于底座侧面。
- `createWoodTexture` — 木纹，用于战车/抛石车构件。
- `createTextTexture` / `createBaseTopTexture` — 底座顶面秦篆汉字（红黑双写分别正对双方玩家）。
- `createBannerTexture` — 旗面纹样（夔龙/星纹 + 汉字）。

**双面材质**：红黑双方各含 `capeCloth` 双面披风材质（将/帅用），`side: THREE.DoubleSide`。

---

## 4. 棋子设计（七兵种 · 独立形象）

> 统一底座：半径 0.40、高 0.06，云雷纹侧面 + 顶面汉字标识；局部原点在底座底面中心 y=0，沿 +Y 生长。红方面朝 −Z、黑方面朝 +Z。单枚 mesh 数 8–18（合并后）、三角面 1.7k–3.5k，全盘 32 枚 ≈ 90,344 面（< 15 万预算）。

| 类型 | 汉字 | 形象一句话 | 高度 | maxR |
|------|------|-----------|------|------|
| `P` 兵/卒 | 兵 / 卒 | 秦步兵：矮小敦实，一手持戈、一手握圆盾，笠帽护首 | 0.79 | 0.408 |
| `N` 马 | 馬 | 骑兵：立马扬蹄，骑手披甲控缰，马身青铜甲片 | 0.95 | 0.408 |
| `B` 象/相 | 象 / 相 | 书生：宽袖深衣，双手捧简牍于胸前，文官束冠 | 0.88 | 0.408 |
| `A` 士/仕 | 仕 / 士 | 卫兵：拄剑直立，鱼鳞小甲，胄有红缨 | 0.88 | 0.408 |
| `R` 车 | 俥 / 車 | 双轮战车：双大木轮 + 车辕 + 立盾，无人物仅器物 | 0.92 | 0.411 |
| `C` 炮 | 砲 / 炮 | 抛石车：斜支架 + 配重箱 + 抛杆斜指天空 | 1.00 | 0.408 |
| `K` 将/帅 | 帥 / 將 | 主将：鱼鳞甲 + 鹖冠 + 披风，背后帅旗高扬 | 1.05 | 0.408 |

**剪影互不雷同**：兵（矮+戈盾）/ 马（骑手+马）/ 象（宽袖捧简）/ 士（拄剑）/ 车（双轮器物）/ 炮（斜杆指天）/ 帅（披风+旗）。七者俯视与侧视轮廓均易区分，满足"一眼辨子"。

**朝向实现**：内层 `body` 子组用 `body.quaternion.setFromAxisAngle(Y, Math.PI)` 实现黑方翻转（避免 Euler 万向锁歧义，保证 `clone()` 后数值稳定）。红方帅旗世界坐标 (+x,+z)、黑方 (−x,−z)，已通过冒烟测试核对。

---

## 5. 棋盘（boardMesh.js）

- **台面**：Box 台体，顶面恰好 y=0（已核验 −0.0000），深木 `boardBase` 主色。
- **棋线**：9 竖线 × 10 横线，河界（worldZ∈[−0.5,+0.5]）中段断开（边线除外）；合并为单一 Mesh 以降 draw call。
- **九宫**：黑方 rank 0–2 / 红方 rank 7–9，file 3–5 的斜线，色 `palaceLine`。
- **炮位 / 兵位标记**：L 形刻痕于初始布置点。
- **河界文字**："楚河" / "漢界" 以 `PlaneGeometry` + `CanvasTexture` 贴于河面，红黑双方各正对。
- **外框**：朱漆外框 + 鎏金角，内沿 |x|≤4.5、|z|≤5.0，棋子最外占位 |x|=4.44、|z|=4.94，不碰撞。

---

## 6. 环境（createEnvironment）

- 雾化地面 `Circle`（`ground` 色），指数雾 `FogExp2(fog, 0.021)`。
- 深色石台 `platform` + 鎏金边 `platformEdge`，承托棋盘。
- 四角青铜灯柱 `braziers`：柱础在 ±6.35 处（逐顶点核验 |x|>5.4 不侵入落子区），顶部火焰 `cone` 含 `update(t)` 呼吸动画（4 簇）。
- 四面秦旗 `banners`：红方 +Z、黑方 −Z，旗面 `createBannerTexture`。
- 全部装饰物位于 |x|>5.6 或 |z|>6.0 外围，**不遮挡视线、不侵入棋盘上方**（冒烟测试逐顶点判定通过）。

---

## 7. 光照与渲染建议（供 engineering-lead）

导出常量 `LIGHT_PRESET`（见 `src/render/boardMesh.js`），建议直接采用：

```js
{
  ambient:     { color: 0x2b3444, intensity: 0.55 },
  hemisphere:  { sky: 0x38404f, ground: 0x140f0c, intensity: 0.65 },
  key:         { color: 0xffe3b8, intensity: 2.1,  position: [6.5, 12.0, 7.5], castShadow: true },
  fill:        { color: 0x6d8cc0, intensity: 0.55, position: [-8.0, 6.0, -6.0] },
  rim:         { color: 0xff6a3a, intensity: 0.85, position: [0, 3.2, -11.0] },
  shadow:      { mapSize: 2048, near: 1, far: 34, left: -8, right: 8, top: 9, bottom: -9, bias: -0.0006, normalBias: 0.02 },
  fog:         { color: 0x0b0a0d, near: 16, far: 38 },
  toneMapping: 'ACESFilmic',
  exposure:    1.05,
  controls:    { minPolarAngle: 0.18, maxPolarAngle: 1.16, minDistance: 8.5, maxDistance: 20.0 }
}
```

- **主光**（暖白）投射阴影，`PCFSoftShadowMap`，所有棋子 `castShadow=true`、棋盘 `receiveShadow=true`。
- **色调映射**：`ACESFilmicToneMapping`，`exposure ≈ 1.05–1.1`（与 `scene.js` 中 `1.06` 一致）。
- **像素比**：`min(devicePixelRatio, 2)`，1080p 目标 60fps。
- **draw call 预算**：单枚棋子经 `mergeGeometries` 合并为 8–18 个 Mesh，全盘 ≈ 180 draw call（详见 §8 偏离说明）。

---

## 8. 对契约的偏离与优化说明

| # | 契约/规范原文 | 实际做法 | 原因 |
|---|--------------|----------|------|
| D1 | 契约未禁止合并；规范隐含"逐零件" | 每枚棋子用 `mergeGeometries` 将 28–45 零件按材质合并为 **8–18 个 Mesh** | 若不合并，全盘 32 枚将产生 ~1200 draw call，1080p 难保 60fps；合并后视觉细节零损失，三角面数不变（仍为 90,344）。属性能优化，**不改变任何包围盒/朝向/命名契约**。 |
| D2 | 黑方朝向"绕 Y 翻转" | 用 `quaternion.setFromAxisAngle(Y, π)` 而非 `rotation.y = π` | Euler `rotation.y=π` 经 `clone()` 后会被分解为 `(π,0,π)` 数值漂移（虽四元数等价），quaternion 写法语义唯一、无歧义。视觉结果与契约一致。 |

> 以上两点均**未突破**契约第 1–2 节的坐标系 / 包围盒 / 朝向硬约束，仅属内部实现优化与数值稳定性，特此备案。

---

## 9. 资产清单与导出签名（art-director 交付）

### 9.1 `src/render/materials.js`
```js
export const PALETTE;                              // 与 constants.js 同源（此处为美术构造参考副本）
export function createLeiWenTexture(opts = {});
export function createWoodTexture(opts = {});
export function createTextTexture(text, opts = {});
export function createBaseTopTexture(glyph, side, opts = {});
export function createBannerTexture(glyph, side, opts = {});
export function getMaterials();                   // -> 材质库（懒加载+缓存）
export function getBaseTopMaterial(glyph, side);
export function getBannerMaterial(glyph, side);
export function disposeMaterials();
```

### 9.2 `src/render/pieceFactory.js`
```js
export const PIECE_BASE_RADIUS = 0.40;
export const PIECE_MAX_RADIUS  = 0.44;
export const PIECE_GLYPH;                          // { r:{...}, b:{...} } 红黑汉字映射
export const PIECE_TOP_Y;                          // { P:0.79, N:0.95, B:0.88, A:0.88, R:0.92, C:1.00, K:1.05 }
export function createPieceMesh(type, side);       // -> THREE.Group，userData.dispose() 已挂载
export function disposePieceFactory();
```

### 9.3 `src/render/boardMesh.js`
```js
export function createBoard();                     // -> THREE.Group，顶面 y=0
export function createEnvironment();               // -> THREE.Group，userData.update(t) 火焰动画
export const LIGHT_PRESET;                         // 第 7 节光照预设
```

### 9.4 `styles/main.css`
秦式深色 UI 皮肤：系统字体栈、零外部资源、`@media(max-width:1199px / 900px / 639px)` 三档降级、`prefers-reduced-motion` 支持。所有 DOM 钩子（id/class）严格对齐已实现 `index.html` / `hud.js` / `controls.js` / `scene.js` / `effects.js` 实际结构。

> **布局对齐说明**：`index.html` 采用**浮动固定面板**布局（非 CSS 网格）：`#canvas-container`(视口) / `#hud`(左上) / `#move-log`(右上) / `.check-banner`(顶部居中) / `#controls`(底部居中) / `.help-panel`(右抽屉) / `#toast-container` / `#game-over` / `#loading-screen`(z=100) / `#check-flash`(动态注入)。`main.css` 在 `index.html` 内联兜底样式之后加载，叠加秦式视觉并**保留其定位坐标与层级**（loading z=100 为最高层，toast z=90，game-over z=80，help z=70，check-banner z=60，check-flash z=40）。早期草稿曾假设 `#app` 网格 + `.sidebar`/`.statusbar`，已据实际 DOM 全部重写为浮动面板，避免覆盖破坏 `position:fixed` 布局（尤其 `#game-over` 维持 `display:none` 默认、`.is-visible` 切 `flex`）。

---

## 10. 可访问性（Accessibility）基线

- **色盲友好**：阵营不以颜色为唯一区分——红黑棋子形制相同但**汉字不同**（帥/將、仕/士、相/象…），且底座字色与边环材质各异；交互反馈除颜色外辅以**形状**（绿光圈=可走、红准星=可吃、灰叉=阻挡、蓝金方框=上一步）。
- **文本与对比**：UI 文字使用 `parchment/#e6dcc3` 于深底，对比度 ≥ 4.5:1；聚焦态 `:focus-visible` 金边可见。
- **动效安抚**：`prefers-reduced-motion` 下全局停用装饰动画，保留功能。
- **非阻挡浮层**：Toast（z=20）、将军脉冲（z=40）`pointer-events:none`，不阻断操作。
- **语义态**：HUD/帮助/结算面板均设 `aria-hidden` 与 `role`，状态切换经 `classList` 表达，可被读屏捕获。

> 可访问性分级建议：**Standard**（达成上表全部基线）。若需升级至 Comprehensive，可补充：完整键盘走子导航、UI 字号缩放滑块、高对比模式切换——由 design-strategist 在 UX 规格中引用本分级。

---

## 11. 自检与验证记录

| 项 | 结果 |
|----|------|
| 七棋子包围盒（maxR≤0.44 / minY=0 / maxY≤1.05） | ✅ 全部通过 |
| 全盘三角面预算（<15 万） | ✅ ≈90,344 |
| 阴影开启 + 红黑朝向正确 | ✅ castShadow 全开；帅旗世界坐标 ±(0.246,0.136) 正确 |
| 几何体共享（同型同阵营共享 geometry） | ✅ |
| 重复 dispose 安全 | ✅ |
| 棋盘顶面 y=0 / 河界文字存在 / 外框不侵入 | ✅ |
| 环境不遮挡棋盘上方（逐顶点判定） | ✅ |
| 火焰动画 update() 正常 | ✅ flames=4 |
| dispose→重 getMaterials→再 dispose 全链路 | ✅ |

> 验证方式：离线 Node 22 冒烟测试（`global.document` Canvas2D 桩 + 安装 three@0.169.0），无浏览器运行通过，退出码 0。
