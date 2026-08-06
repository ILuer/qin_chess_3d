# scene.js 灯光方案 — 权威来源与文档镜像说明

> 负责人：engineering-lead（程基岩）
> 改动文件：`src/render/scene.js`（**未改动，保持已发布的艺术定稿**）、`src/render/boardMesh.js`（`LIGHT_PRESET` 对齐为镜像）
> 配套：`docs/architecture/ARCHITECTURE.md` §2.2、`docs/architecture/adr/`
> 相关 QA 探针：`_qa/p1-verify.mjs`（逐子字面对比度）

---

## 1. 结论（Direction of Truth）

- **`scene.js` 是灯光的唯一权威来源。** 灯光值由 `scene.js` 硬编码（引用 `src/core/constants.js` 的 `PALETTE`），美术定稿即提交态（HEAD）的 `scene.js`。
- **`LIGHT_PRESET`（`boardMesh.js` 导出）只是 `scene.js` 灯光方案的文档化镜像**，供美术/文档参考；`scene.js` **不直接消费** `LIGHT_PRESET`。要改观感，改 `scene.js` 或 `constants.js` 的 `PALETTE`，然后同步镜像到 `LIGHT_PRESET`。
- 因此：本波**没有修改 `scene.js` 的任何运行时代码**，仅把 `LIGHT_PRESET` 的数值对齐到 `scene.js` 实际值，消除"文档与实现脱节"。

> 这与 art-director 的 CONCERN-1 一致：**scene.js 是权威，LIGHT_PRESET 曾经是未采纳的陈旧建议**，不能反向灌入 scene.js。

---

## 2. 已发布的灯光定稿（scene.js @ HEAD，权威值）

| 项 | 值 |
|---|---|
| 色调映射 toneMapping | `THREE.NeutralToneMapping`（常量 7） |
| 曝光 exposure | `1.14` |
| 场景底色 background | `0x1a2230` |
| 雾 fog | `THREE.FogExp2(0x232b38, 0.009)` |
| 环境光 ambient | `AmbientLight(0xffffff, 0.52)` |
| 半球光 hemisphere | `HemisphereLight(0x8da0b8, 0x241a11, 0.98)` |
| 主光 key | `DirectionalLight(0xfff2dc, 1.95)` @ `[6.5, 13.5, 7.5]`，`castShadow` |
| 主光阴影 | `mapSize 2048`；正交相机 `±9 / ±9`、`near 1`、`far 42`；`bias -0.0006`、`normalBias 0.022`、`radius 1.6` |
| 补光 fill | `DirectionalLight(0x3f6ea8, 0.95)` @ `[-8, 6.5, -8]` |
| 跟随补光 head | `DirectionalLight(0xfff4e2, 0.62)` @ `[0, 10, 14]`（**每帧跟随相机，预设外功能性灯**） |
| 轮廓光 rim | `PointLight(0xffb45c, 22, 30, 2)` @ `[0, 3.2, -8.5]` |
| 地灯 under | `PointLight(0xb0281f, 12, 22, 2)` @ `[0, 2.4, 8.5]` |
| 相机极角 controls | `minPolar 0.15` / `maxPolar 1.35` |
| 相机距离 controls | `minDistance 6.5` / `maxDistance 26` |
| 俯视预设 phi | `VIEW_PRESETS.top.phi = 0.17`（落在 `minPolar 0.15` 之上，无夹紧跳变） |

`head` / `rim` / `under` 三盏灯的**物理类型与强度均保留发布态**：
- `rim` 是 **PointLight @ 强度 22**（带 `distance 30` / `decay 2`），不是 DirectionalLight；r155+ 点光的坎德拉衰减在本场景距离下给出预期的暖色边缘重音。
- `under` 是 PointLight @ 12，红方侧地灯，保留。
- `head` 是 DirectionalLight @ 0.62，相机跟随可读性补光，保留。

---

## 3. `LIGHT_PRESET` 镜像（boardMesh.js，仅文档）

```js
export const LIGHT_PRESET = {
  ambient:     { color: 0xffffff, intensity: 0.52 },
  hemisphere:  { sky: 0x8da0b8, ground: 0x241a11, intensity: 0.98 },
  key:         { color: 0xfff2dc, intensity: 1.95, position: [6.5, 13.5, 7.5], castShadow: true },
  fill:        { color: 0x3f6ea8, intensity: 0.95, position: [-8.0, 6.5, -8.0] },
  rim:         { color: 0xffb45c, intensity: 22, distance: 30, decay: 2, position: [0, 3.2, -8.5] },
  under:       { color: 0xb0281f, intensity: 12, distance: 22, decay: 2, position: [0, 2.4, 8.5] },
  shadow:      { mapSize: 2048, near: 1, far: 42, left: -9, right: 9, top: 9, bottom: -9, bias: -0.0006, normalBias: 0.022, radius: 1.6 },
  fog:         { type: 'exp2', color: 0x232b38, density: 0.009 },
  background:  0x1a2230,
  toneMapping: 'Neutral',
  exposure:    1.14,
  controls:    { minPolarAngle: 0.15, maxPolarAngle: 1.35, minDistance: 6.5, maxDistance: 26 }
};
```

导出注释已改为：`scene.js is the sole authority for lighting. This preset mirrors scene.js's shipped values (see src/render/scene.js) for documentation only; scene.js does NOT consume it.`

---

## 4. ❌ 被 REJECTED 的方案（本波早期误用，记录以免重蹈）

早期我曾把方向**搞反**：把 `LIGHT_PRESET` 当作权威、改写 `scene.js` 去"消费"它。该方案**降级了已发布的观感**，且违背 art-director 的 CONCERN-1（scene.js 才是权威）。具体错误：

| 错误做法 | 后果 | 为何 REJECTED |
|---|---|---|
| `scene.js` 改消费 `LIGHT_PRESET`，色调映射 Neutral→ACESFilmic | 整体偏冷、字面对比度变化 | 偏离美术定稿 |
| 曝光 1.14→1.05 | 整体变暗 | 偏离美术定稿 |
| 环境光 0xffffff/0.52 → 0x2b3444/0.55；半球光改变 | 暗部色相与层次改变 | 偏离美术定稿 |
| 主光 0xfff2dc/1.95 → 0xffe3b8/2.1；位置 13.5→12.0 | 主光角度/强度改变 | 偏离美术定稿 |
| 轮廓光 rim 由 PointLight@22 → DirectionalLight@0.85 | 边缘暖色重音几乎消失（方向光量纲下 0.85 远弱于点光 22） | 改变造型语言 |
| 地灯 under **移除（置 null）** | 红方侧暖色氛围丢失 | 违背"双方形制相同仅材质有别"的美术契约 |
| 相机约束 0.15/1.35/6.5/26 → 0.18/1.16/8.5/20 | 视角范围被收紧 | 偏离美术定稿 |
| 雾 FogExp2(0x232b38, 0.009) → 线性 Fog(0x0b0a0d, 16/38) | 纵深与氛围改变 | 偏离美术定稿 |

**正确做法（本波采用）**：`scene.js` 保持提交态不变；仅把 `LIGHT_PRESET` 对齐成它的镜像，文档与实现一致即可。任何"让 scene.js 消费 LIGHT_PRESET"的重构都属**未来显式范围**，且必须经过逐像素验证（readPixels 四视角对比度 A/B），不可在本轮顺手做。

---

## 5. 验证方法（"七子字面清晰可辨"）

### 5.1 客观探针（QA harness）
- 无头 Edge 经 CDP 启动：`_qa/cdp.mjs`；
- 逐子字面对比度探针：`_qa/p1-verify.mjs` 经 `readPixels` 测量每枚棋子字形的局部对比度；
- 覆盖 4 个视角：`red-default`（红方默认）、`black-side`（翻转黑方）、`top-down`（俯视）、`low-oblique`（低仰角斜视）。

### 5.2 期望（验收标准）
对每个视角、每枚棋子的字面区域：局部对比度均值 ≥ 约 20、死黑像素占比 < ~6%、字面中位 ≥ 约 45；即七种兵种（帥/將、仕/士、相/象、馬、車、炮、兵/卒）字形在四视角下均可辨。

### 5.3 本波自测结论（engineering-lead，针对已发布的 revert 原貌）
- 运行环境：无头 Edge（CDP），加载 `scene.js` 提交态（未改动）。
- 启动：**BOOT OK**，`错误/警告: 0`，`异常: 0` —— 即 `git show HEAD:src/render/scene.js` 的发布态可干净启动，灯光改动（本波未动 scene.js）未引入任何回归。
- 运行时配置与 §2 表逐项一致：toneMapping = 7（Neutral）、exposure 1.14、background 0x1a2230、fog = FogExp2(0x232b38, 0.009)、shadow 全参、controls 0.15/1.35/6.5/26、`underLight` 为 PointLight（非 null）、`rim` 为 PointLight@22、`head` 为 DirectionalLight@0.62、灯数 = 7（amb/hemi/key/fill/rim/under/head）。
- 四视角字面对比度：沿用 `_qa/p1-verify.mjs` 探针，发布态满足可辨阈值（详见自测产物 `selfcheck.json`）。

---

## 6. 待 Wave 2（quality-lead）复核项

1. **人工目检**：七种兵种字形在四个视角下的主观清晰度（自测为客观对比度，需主观确认无歧义）。
2. **若需调整观感**：改 `src/render/scene.js`（或 `constants.PALETTE`），随后把同一组数值同步到 `boardMesh.js` 的 `LIGHT_PRESET` 镜像；**不要**反过来让 `scene.js` 消费 `LIGHT_PRESET`。
3. **未来重构**（如确有收益）：将 `scene.js` 灯光改为引用 `LIGHT_PRESET`，但必须作为**独立、显式范围**的任务，并以 readPixels 四视角逐像素 A/B 验证不降级当前观感。

---

*本说明与 `src/render/scene.js`（HEAD 提交态，未改动）、`src/render/boardMesh.js` 的 `LIGHT_PRESET` 镜像一致。*
