/**
 * src/render/pieceJoints.ts
 * ------------------------------------------------------------
 * 棋子结构契约的 **唯一真相源（SSOT）**。
 *
 * ⚠ 本文件是「关节契约」的唯一来源：
 *   - `pieceFactory.ts`（构建期：几何 translate(−joint) + Group.position = joint）
 *   - `accessories.ts`（槽位契约：`SlotSpec.anchor` 由此**派生**）
 *   两者均从本文件取值；**禁止在任何其它文件重复定义关节坐标 / 父链 / 顶高梯度**。
 *   历史缺陷 D2/O4：`SUBGROUP_JOINTS` 与 `SLOT_TABLE.anchor` 曾双表手工同步，
 *   M-06 因漂移返工。抽出本模块后「漂移在构造上不可能」，并由
 *   `scripts/check-piece-contract.mjs`（纯 Node，进 CI）兜底断言。
 *
 * ⚠ **零 import 纪律（不可破）**：
 *   本文件**不得 import 任何模块**（连 `three` 的 type-only import 都不要）。
 *   原因：three 走 `vendor/three-r185` 别名，不在 `node_modules`（仅有 esbuild/typescript），
 *   纯 Node 下 `import ... from 'three'` 会 `Cannot find package 'three'`。
 *   本文件被 CI 契约脚本在**无浏览器 / 无 GPU** 环境 import，必须保持纯数据。
 *   （实测：`node --experimental-strip-types` 下本文件可成功 import；`pieceFactory.ts` 失败。）
 *
 * ⚠ **关节坐标口径（红线 JOINT）**：
 *   本表数值 = **pre-idleScale 的 piece-local 坐标**（相对棋子根，去基座 FOOT 后重算）。
 *   **不得乘 `K_IDLE_SCALE = 1.25`** —— 历史缺陷 D2 已证伪（结论见
 *   `docs/piece-modeling/08-穿模分离修复落地与验证.md` §2）：各 K 命名子组 localPos ≡ joint
 *   （比值 1.0），`g.position.set(jx,jy,jz)` 与几何 `translate(−joint)` 同在 idleGroup 局部系、
 *   同被 `idleGroup.scale(1.25)` 等比缩放 → 二者恒相消，**不存在 25% 关节/几何错配**。
 *
 * ⚠ **历史坐标系统混用（已登记，本轮只搬移不修正）**：
 *   `SUBGROUP_JOINTS` 历来的写法**混用了「作者坐标（含 FOOT）」与「去基座坐标（不含 FOOT）」
 *   两套系**（见下方 M-03/M-06 校准注）。任何坐标系的统一修正属于 S1/S2 范围，
 *   会破坏 S0「零几何改动」验收 —— **S0 只做搬移，逐个数值不得改动**。
 */

/** 三维向量（piece-local 坐标，单位与棋盘 GRID=1.0 同尺度） */
export type Vec3 = readonly [number, number, number];

/**
 * 各命名子组在棋子根局部坐标中的「关节锚点」（去基座后重算，master-plan §1.2）。
 * buildTemplate 多分组路径会把该子组几何整体平移 -joint，再把 Group 放到 joint，
 * 于是子组旋转即绕关节本身（不再是绕棋子根/棋盘中心公转）。
 * 仅列出需要精炼旋转的子组；为空则 Group 留在原点（平移类动画不受影响）。
 *
 * ★ M-03 关节校准（01-几何量化审计 C3「pivotOutside」+ 02 §9 #2/#11/#13/#15/#16/#17）：
 *   本表历来的写法混用了「作者坐标（含 FOOT）」与「去基座坐标（不含 FOOT）」两套系，
 *   导致一批 pivot 落在该子组自身 AABB 之外（P.armR/L 0.075、B.hem 0.086、
 *   N 四腿 0.062~0.079、R.driver 0.352、R.spearman 0.317、C.wheelL/R 0.039、
 *   K.sword 0.101）。静态无害（translate(-J) 与 position(J) 相消），但一旦该子组
 *   被 POSE_TABLE 旋转，几何就绕一个空中的点公转（吃子峰值 rotX −0.70 时
 *   R.spearman 末端位移可达 0.20）。
 *   本轮按「pivot = 该子组真实旋转中心（去基座坐标，= 作者 y − FOOT）」逐项校准，
 *   语义锚点（肩/髋/腰/轮心）不变，只是补回 FOOT 差或修正 z 遗留错误。
 *   ⚠ 不驱动旋转的子组（K.crown 只走 translateY）本轮不校，见 04 文档遗留风险。
 *
 * ★ M-06 关节收尾（07-残余缺陷美术裁定 §2/§6，全量残余）：M-03 后残留 4 处 pivotOutside
 *   （K.banner 0.218 / K.crown 0.215 / A.arms 0.036 / C.cart 0.032），本轮全部清零。
 *   注：**D2 已证伪** —— 实测各 K 命名子组 localPos ≡ joint（比值 1.0，见 `_m06-audit.json`
 *   的 A.types.K.subgroups[*].localPos），`g.position.set(jx,jy,jz)` 与几何 translate(−joint)
 *   同在 idleGroup 局部系、同被 idleGroup.scale(1.25) 等比缩放 → 二者恒相消，**不存在
 *   25% 关节/几何错配**。故本轮只改 pivot 的**数值**（旋转中心选择），不动缩放机制。
 *   所有改动均为「旋转枢轴选择」，静态外观恒不变（translate(−J)+position(J) 相消），
 *   `DISSOLVE_POSE` 的 translateY 语义亦不受影响（位移量与 pivot 无关）。
 */
export const SUBGROUP_JOINTS: Record<string, Record<string, Vec3>> = {
  // ★ Sprint 1 重构：兵/卒 P 拆为 armL/armR、legL/legR，新增独立 shield，戈(spear)挂 armR 子节点。
  //   零新 Mesh（仅重新分组到 Group 容器），draw call 不增。
  // ★ M-03 #15：armR/armL 的 y 由 0.505（作者坐标）校准为 0.505−FOOT=0.419（真肩点）。
  P: {
    body: [0, 0.334, 0],
    armR: [0.096, 0.419, 0],   // 右肩（= 作者 0.505 − FOOT）
    armL: [-0.096, 0.419, 0],  // 左肩
    legR: [0.055, 0.300, 0],   // 右胯（踏步绕胯转）
    legL: [-0.055, 0.300, 0],  // 左胯
    shield: [-0.176, 0.400, -0.058], // 盾心
    spear: [0.170, 0.440, -0.020]    // 戈握把（作为 armR 子节点，随右臂挥动）
  },
  // ★ M-03 #14：sword 子组向躯干内收 0.044（z −0.170 → −0.126），使剑柄落入握持范围。
  // ★ M-06 ④：arms pivot.y 0.378 → 0.474（= 真肩点，双大臂 strut 起点作者 y 0.560 − FOOT；
  //   原 0.378 落在臂盒 [0.414,0.506] 之下 0.036，绕空点公转）。x=0 保持（双臂共用枢轴）。
  A: { body: [0, 0.334, 0], arms: [0, 0.474, 0], sword: [0, 0.328, -0.126], shield: [0, 0.45, -0.20] },
  // ★ M-03 #16：四腿 hip 由 0.300（作者坐标）校准为 0.300−FOOT=0.214（真髋点，= strut 起点）。
  N: { bodyHorse: [0, 0.128, 0], legFL: [+0.076, 0.214, -0.140], legFR: [-0.076, 0.214, -0.140], legBL: [+0.080, 0.214, 0.165], legBR: [-0.080, 0.214, 0.165], rider: [0, 0.328, 0] },
  // ★ Sprint 4 写实：象 B 拆 robe→bodyRobe + hem（下摆独立可飘动子组），
  //   arms 暂不动（零增量，Sprint 4 不拆袖）。hem 绕腰 pivot [0,0.200,0] 残留 1 mesh/枚。
  // ★ M-03 #17：hem pivot 由 0.200（作者坐标）校准为 0.110（下摆顶缘 = 腰，绕此摆动）。
  B: { bodyRobe: [0, 0.368, 0], hem: [0, 0.110, 0], arms: [0, 0.328, -0.10] },
  // ★ M-03 #2/#4/#12：
  //   driver  [0.05, 0.378, 0.40] → [0.050, 0.4465, −0.050]（真髋：作者 0.150×0.85+0.405−FOOT；
  //           z 由遗留错误 0.40 校正到实际站位 −0.030，并按 #12 外扩 0.02 → −0.050）
  //   spearman[−0.05,0.378, 0.46] → [−0.050, 0.451, 0.080]（同理；z 0.060 外扩 → 0.080）
  //   horses  z −0.30 → −0.24（随马群整体后移 0.06 同步跟随，保持相对枢轴不变）
  R: { horses: [0, 0.168, -0.24], body: [0, 0.288, 0.02], driver: [0.050, 0.4465, -0.050], spearman: [-0.050, 0.451, 0.080], wheelL: [-0.26, 0.330, 0], wheelR: [0.26, 0.330, 0] },
  // ★ R-1 修复同步：counterweight 关节由 [0,0.250,-0.150] 改为箱体实际中心 [0,cwY,cwZ]；
  //   wheelL/R 的 y 由 0.060 改为 CANNON_HUB（=FOOT+外半径，与 R 车 joint.y===HUB 同规约）。
  // ★ M-03 #11：wheelL/R 的 z 由 0.110 校正为 0.000（轮几何整体在 z=0，轮心才是自转轴）。
  // ★ M-06 ⑤：cart pivot.y 0.114 → 0.041（= 木底座自身 AABB 中心 [−0.001,0.082]，
  //   语义锚点 = 车体中心；原 0.114 在底座之上 0.032，绕空点公转）。
  //   注：地面接触层纪律 —— 仅改**旋转枢轴**，未引入任何竖向平移通道；
  //   DISSOLVE_POSE.C.cart 的 translateY 语义与 pivot 无关，保持不变。
  C: { trebuchet: [0, 0.308, 0], cart: [0, 0.041, 0], soldierL: [-0.25, 0.248, 0.09], soldierR: [0.25, 0.248, 0.09], counterweight: [0, 0.182, -0.105], wheelL: [-0.145, 0.160, 0.000], wheelR: [0.145, 0.160, 0.000] },
  // ★ M-03 #13：sword pivot → 剑柄握持段（作者 0.171+0.204−FOOT≈0.289，x 取剑身轴 0.162）；
  //   rArm pivot → 真肩点（作者 FOOT+0.480 − FOOT = 0.480）。
  // ★ M-06 ①②③（07 裁定 §2.1/§2.2/§3，全量残余）：
  //   crown  pivot.y 0.964 → 0.688（= 冕体 AABB 中心 piece-local，世界 0.86；原 1.205 在
  //          冕顶之上 0.215）。**仅位移驱动**（DISSOLVE_POSE 冕落 translateY），translateY 语义不变。
  //   banner pivot.x 0 → 0.228 且 z 0 → 0.126（= 旗杆轴线，世界 x 0.285/z 0.158）：
  //          POSE_TABLE 以 rotation.z 驱动到 ±0.30 rad，原 pivot 落在棋子中轴 x=0（离旗面 0.218），
  //          旗底会被抬离地面 ≈0.10 并整体横移；对齐旗杆轴线后绕旗面自身摆动，旗底 ownMinY 恒 ≈0。
  K: { body: [0, 0.378, 0], throne: [0, 0.028, 0], crown: [0, 0.688, 0], sword: [0.162, 0.289, -0.018], banner: [0.228, 0.394, 0.126], rArm: [0.140, 0.480, 0.000], capeHem: [0, 0.420, -0.010] }
};

/**
 * 子组父子关系（Sprint 1 新增）：某些子组需作为另一子组的**子 Object3D**，
 * 继承父组变换（如 P 的戈 spear 挂在右臂 armR 下，挥臂时戈自然跟随）。
 * 键 = 子组名，值 = 父组名。构建时该子组 Group 会被 add 到父组而非 idleGroup。
 * 父组的关节锚定（translate -joint + position joint）已先完成，子组再以自身 joint
 * 叠加，world 位置正确。
 *
 * ⚠ 嵌套子组必须扣减父链 ΣJ（`buildTemplate` 的 `ancestorSum()`，红线 ANC）：
 *   子组 Group.position = J_self − ΣJ_祖先。
 */
export const SUBGROUP_PARENTS: Record<string, Record<string, string>> = {
  P: { spear: 'armR' }
};

/**
 * 各兵种「顶高」声明值（piece-local，= 该型最高件的设计顶高）。
 * 用途：
 *   - `pieceFactory.createPieceMesh` → `group.userData.topY`（拾取包围球高度）；
 *   - 高度梯度契约 L1-4：`P < B < A < N < C < R < K` 严格递增，且与声明一致。
 *
 * （原定义在 `pieceFactory.ts`；S0 护栏阶段**搬移**至本 SSOT，`pieceFactory.ts` 仅重新导出。）
 */
export const PIECE_TOP_Y: Record<string, number> = { P: 0.70, N: 0.86, B: 0.74, A: 0.79, R: 0.99, C: 0.90, K: 1.00 };
