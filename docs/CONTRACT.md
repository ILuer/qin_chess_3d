# 跨成员接口契约 v1.0（唯一真相源）

> 本文件由主理人维护。任何成员不得单方面修改契约；如需变更，SendMessage 回报主理人。

## 0. 项目硬约束

- **零构建步骤**：ES Modules + `<script type="importmap">`，CDN 引入 Three.js。用户起个静态服务即可运行。
- **零外部二进制资源**：不得引用任何 `.glb/.gltf/.fbx/.png/.jpg/.mp3/.wav/.ttf` 外部文件。
  - 3D 模型 → Three.js 几何体程序化组合
  - 贴图 → CanvasTexture 程序化绘制
  - 音效 → WebAudio API 实时合成
  - 字体 → 系统字体栈
- **Three.js 版本**：`0.169.0`，通过 importmap 映射：
  ```
  "three": "https://unpkg.com/three@0.169.0/build/three.module.js"
  "three/addons/": "https://unpkg.com/three@0.169.0/examples/jsm/"
  ```
- **目标**：桌面 Chrome/Edge/Firefox/Safari，1080p 下 60fps。

## 1. 棋盘坐标系（最重要的契约）

```
file: 0..8   列，红方视角从左到右
rank: 0..9   行，rank 0 = 黑方底线(将所在行)，rank 9 = 红方底线(帅所在行)
```

- 格距 `GRID = 1.0`
- 世界坐标转换（唯一实现在 `src/core/constants.js`）：
  ```js
  worldX = (file - 4) * GRID          // -4 .. +4
  worldZ = (rank - 4.5) * GRID        // -4.5 .. +4.5
  ```
- 棋子**站立于 y=0 平面之上**（棋盘台面顶部为 y=0），沿 +Y 生长。
- 相机默认位于红方后方上空，看向原点；红方在 +Z 侧（画面下方）。
- 河界位于 rank 4 与 rank 5 之间（worldZ = 0）。
- 九宫：黑方 file 3..5 × rank 0..2；红方 file 3..5 × rank 7..9。

## 2. 棋子规格（美术必须遵守的包围盒）

| 常量 | 值 | 说明 |
|------|-----|------|
| `PIECE_BASE_RADIUS` | 0.40 | 底座最大半径，不得超出，否则相邻棋子穿模 |
| `PIECE_HEIGHT` | 0.90 | 标准棋子总高（将/帅可到 1.05，车/炮可到 1.00） |
| `PIECE_MAX_RADIUS` | 0.44 | 任意高度处的最大水平半径 |

棋子类型 ID（字符串常量，全项目统一）：
```
'K' 将/帅   'A' 士/仕   'B' 象/相   'N' 马   'R' 车   'C' 炮   'P' 兵/卒
```
阵营 ID：`'r'` = 红方，`'b'` = 黑方。

## 3. 模块接口

### `src/core/constants.js` —— 由 engineering-lead 创建，全员依赖
```js
export const FILES = 9, RANKS = 10, GRID = 1.0;
export const PIECE_BASE_RADIUS = 0.40;
export const PIECE_HEIGHT = 0.90;
export const RED = 'r', BLACK = 'b';
export const PT = { KING:'K', ADVISOR:'A', ELEPHANT:'B', HORSE:'N', ROOK:'R', CANNON:'C', PAWN:'P' };
export function toWorld(file, rank);           // -> {x, z}
export function fromWorld(x, z);               // -> {file, rank} | null
export const PALETTE = { ... };                // 秦式配色，由 art-director 提供数值，engineering-lead 落盘
```

### `src/render/materials.js` —— art-director 负责
```js
export function getMaterials();   // -> 返回材质库对象（懒加载 + 缓存复用）
export function disposeMaterials();
```

### `src/render/pieceFactory.js` —— art-director 负责
```js
import * as THREE from 'three';
/**
 * @param {string} type  PT 之一：'K'|'A'|'B'|'N'|'R'|'C'|'P'
 * @param {string} side  'r' | 'b'
 * @returns {THREE.Group}  局部原点在底座中心、y=0；整体沿 +Y 生长
 *   - group.userData.pieceType / pieceSide 必须设置
 *   - 所有子 mesh 必须 castShadow=true
 *   - group 内不得包含灯光、相机
 *   - 必须挂载 group.userData.dispose() 用于释放几何体
 */
export function createPieceMesh(type, side);
```

### `src/render/boardMesh.js` —— art-director 负责
```js
export function createBoard();     // -> THREE.Group，台面顶部恰好 y=0，含河界文字、九宫斜线、炮/兵位标记
export function createEnvironment(); // -> THREE.Group，秦式环境装饰（旗帜、地台、外框），不得遮挡视线
```

### `src/audio/sfx.js` —— audio-director 负责
```js
export const SFX = {
  init(),            // 首次用户手势后调用，创建 AudioContext
  play(name, opts),  // name: 'select'|'move'|'capture'|'check'|'illegal'|'undo'|'win'|'lose'|'start'|'hover'
  setEnabled(bool),
  setVolume(0..1),
  isEnabled()
};
```

### `src/core/rules.js` —— engineering-lead 负责
```js
export function generateLegalMoves(state, file, rank);  // -> [{file, rank, capture:bool}]
export function isInCheck(state, side);
export function getGameStatus(state, sideToMove);       // 'playing'|'check'|'checkmate'|'stalemate'
```

## 4. 文件所有权（禁止越界写他人文件）

| 成员 | 拥有的文件 |
|------|-----------|
| engineering-lead | `index.html`, `src/main.js`, `src/core/*`, `src/render/scene.js`, `src/render/effects.js`, `src/render/animator.js`, `src/ui/*`, `src/ai/*` |
| art-director | `src/render/materials.js`, `src/render/pieceFactory.js`, `src/render/boardMesh.js`, `styles/main.css`, `docs/art-bible.md` |
| audio-director | `src/audio/sfx.js`, `docs/audio-design.md` |
| design-strategist | `docs/gdd.md`, `docs/ux-spec.md`, `docs/juice-oil-windex.md` |

## 5. 体验三原则（用户点名要求，全员落地）

- **Juice（果汁）**：一次输入 → 大量正向反馈。落子有音效+粒子+棋盘微震+棋子回弹；吃子有攻击位移+碎裂消散+屏幕震动；将军有全屏红脉冲。
- **Oil（润滑油）**：消除操作摩擦。单击选中/单击落子（不要拖拽）；点击己方另一子直接切换选中；非法点击不清空选择；悔棋一键；视角一键复位。
- **Windex（玻璃清洁剂）**：规则一目了然。选中即高亮全部合法落点（空点=光圈，可吃=红色危险环）；被将军的帅持续脉冲；蹩马腿/塞象眼的阻挡点显示灰色叉号；走子记录用中文纵线记谱。
