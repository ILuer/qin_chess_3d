/**
 * src/render/accessories.ts
 * ------------------------------------------------------------
 * Task M-05 · 棋子模型资产化 —— **槽位契约 + 变体注册表 + 换装 API**。
 *
 * 定位（用户拍板决策 1）：交付形态 = API + 验证页。**不接玩家 UI**，线上默认
 *   行为与现状完全一致（默认变体 = 原版，开局外观零变化）。
 *
 * 设计纪律（用户红线 + 03-资产化分层规格 §5）：
 *   - 本模块 **不 import three**：纯数据 / 显式数据驱动，可在无渲染环境（node）
 *     直接解析（`node --input-type=module -e "import('./src/render/accessories.ts')"`）。
 *   - 变体几何构建函数由 `pieceVariants.ts` 用 `registerVariant()` 注入，二者解耦。
 *   - DC-1 禁新材质族 / DC-2 禁新贴图 / DC-3 子组内按族合并 / DC-4 同槽位同时最多
 *     1 个变体实例 / DC-5 变体三角数 ≤ 原槽位件 ×1.15 —— 由 SLOT_TABLE.originalTri
 *     与注册时的校验共同约束。
 *
 * 槽位口径（03 §2.1 契约落地）：
 *   本轮覆盖 **11 个槽位 / 14 个子组**（任务书称「10 槽位」，实为 11 —— 见 06 文档
 *   §0 口径更正；P.spear 归 `weapon`、R.wheelL+R 归 `wheel`、C.soldierL+R 归 `crew`…）：
 *     A 档（6，已在 pieceFactory.ACCESSORY_WHITELIST 豁免 forceSingle 走双族）：
 *       P.weapon(spear) P.shield  K.headgear(crown) K.backBanner(banner)
 *       A.weapon(sword) A.shield
 *     B 档（**扩入槽位覆盖**，但按 ADR-β 守 DC-6 走单族，不扩白名单）：
 *       C.wheel(wheelL/wheelR)  C.crew(soldierL/soldierR)  R.crew(spearman)  K.cape(capeHem)
 *       R.wheel(wheelL/wheelR)  ← **M-06 ⑥ 由 A 档降入 B 档**（用户拍板移出白名单，回收 8 dc；
 *                                 俯视下毂盖高光不可见，美术代价≈0；换装能力不受影响，见 pieceFactory 注释）
 */

/* ============================================================
 * 类型
 * ============================================================ */

export type PieceType = 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P';
export type SlotId = 'weapon' | 'shield' | 'headgear' | 'backBanner' | 'cape' | 'wheel' | 'crew';

export interface SlotEnvelope {
  note: string;
  /** 水平最大跨度（world 单位，GRID=1.0 为基准） */
  maxSpan?: number;
  /** 半径上限（轮/盾类） */
  maxRadius?: number;
  /** 长度/高度上限 */
  maxLen?: number;
}

export interface SlotSpec {
  slot: SlotId;
  label: string;
  /** 该槽位覆盖的子组名（1 个 = 单件；2 个 = 成对左右） */
  subgroups: string[];
  kind: 'single' | 'pair';
  /** 关节锚点（= SUBGROUP_JOINTS[type][subgroups[0]]，去基座坐标；成对槽位为左侧/首件） */
  anchor: [number, number, number];
  /** 朝向语义 */
  orientation: string;
  /** 尺寸包络上限 */
  envelope: SlotEnvelope;
  /** 被哪些动画通道驱动（替换件必须继承的变换语义，03 §2.2） */
  animationChannels: string[];
  /** 父子组（嵌套挂载；null = 直接挂 idleGroup） */
  parentSubgroup: string | null;
  /** 原版件三角数（单件 / 单侧；来自 devtools 实测，2026-09-21 基线） */
  originalTri: number;
  /** 原版件 Mesh 数（单件 / 单侧；ADR-α 白名单子组走 matte/metal 双族） */
  originalMeshes: number;
  /** 档位：A = 白名单双族（已上线，维持现状）；B = 单族（ADR-β 新增） */
  dclass: 'A' | 'B';
}

export interface VariantBuildCtx {
  type: string;
  side: string;
  slot: SlotId;
  /** 当前正在构建的子组名（成对槽位：wheelL / wheelR …） */
  subgroup: string;
  /** 成对槽位内的序号（0 = 左/首件，1 = 右/次件） */
  index: number;
  count: number;
  /** 该子组的关节锚点（去基座坐标；= SUBGROUP_JOINTS[type][subgroup]） */
  anchor: [number, number, number];
  /** 该兵种的旗面汉字（banner 变体用） */
  glyph: string;
}

export type VariantBuildFn = (P: any, M: any, K: any, ctx: VariantBuildCtx) => void;

export interface VariantDef {
  type: string;
  slot: SlotId;
  variantId: string;
  label: string;
  build?: VariantBuildFn;
}

/** 原版变体 id（= 走默认几何路径，不覆盖） */
export const VARIANT_ID_DEFAULT = 'v1';

/* ============================================================
 * §1 槽位契约表 SLOT_TABLE（10→11 槽位 / 14 子组）
 * ============================================================ */

/** 原版件 tri / mesh 数（单件或单侧）—— 取自 devtools/piece-viewer.html?mode=audit
 *  在 `_verify-20260921.json` 同帧（commit 5abc72e，ADR-α 白名单已生效）实测。 */
export const SLOT_TABLE: Record<string, Record<string, SlotSpec>> = {
  P: {
    weapon: {
      slot: 'weapon',
      label: '兵器（戈 → 矛/戟/无）',
      subgroups: ['spear'],
      kind: 'single',
      anchor: [0.170, 0.440, -0.020],
      orientation: '竖持，指向 +Y 上 / 刃向 +X 外',
      envelope: { note: '长度 ≤ 1.10（且顶 ≤ PIECE_TOP_Y）；横截面 ≤ 0.12', maxLen: 1.10, maxRadius: 0.06 },
      animationChannels: ['spear.rotation.z（吃子 −0.20）', '随父 armR.rotation.x'],
      parentSubgroup: 'armR',
      originalTri: 72,
      originalMeshes: 2,
      dclass: 'A'
    },
    shield: {
      slot: 'shield',
      label: '防具（圆盾 → 方盾/无）',
      subgroups: ['shield'],
      kind: 'single',
      anchor: [-0.176, 0.400, -0.058],
      orientation: '法线朝 −X 外 / 面朝 −Z 前',
      envelope: { note: '直径 ≤ 0.30（现状 ≈0.19~0.26）', maxRadius: 0.15, maxSpan: 0.30 },
      animationChannels: ['shield.rotation.x（吃子 −0.25）', 'shield.rotation.z'],
      parentSubgroup: null,
      originalTri: 356,
      originalMeshes: 2,
      dclass: 'A'
    }
  },
  A: {
    weapon: {
      slot: 'weapon',
      label: '兵器（剑 → 环首刀）',
      subgroups: ['sword'],
      kind: 'single',
      anchor: [0, 0.328, -0.126],
      orientation: '竖持（握把为旋转中心）',
      envelope: { note: '长度 ≤ 1.10（且顶 ≤ PIECE_TOP_Y）；横截面 ≤ 0.12', maxLen: 1.10, maxRadius: 0.06 },
      animationChannels: ['sword.rotation.z（move −0.08~−0.12 / capture −0.85）'],
      parentSubgroup: null,
      originalTri: 204,
      originalMeshes: 2,
      dclass: 'A'
    },
    shield: {
      slot: 'shield',
      label: '防具（圆盾 → 小圆盾）',
      subgroups: ['shield'],
      kind: 'single',
      anchor: [0, 0.45, -0.20],
      orientation: '法线朝 −Z 前',
      envelope: { note: '直径 ≤ 0.30（现状 ≈0.22）', maxRadius: 0.15, maxSpan: 0.30 },
      animationChannels: ['shield.rotation.x（move −0.10 / capture −0.25）'],
      parentSubgroup: null,
      originalTri: 412,
      originalMeshes: 2,
      dclass: 'A'
    }
  },
  K: {
    headgear: {
      slot: 'headgear',
      label: '头饰（鹖冠 → 变体冠式）',
      subgroups: ['crown'],
      kind: 'single',
      anchor: [0, 0.688, 0],
      orientation: '竖直向上（旋转轴须垂直）',
      envelope: { note: '高 ≤ 0.36；宽 ≤ 0.20', maxLen: 0.36, maxSpan: 0.20 },
      animationChannels: ['DISSOLVE_POSE.K.crown.translateY（冕落；纯位移，非旋转）'],
      parentSubgroup: null,
      originalTri: 300,
      originalMeshes: 2,
      dclass: 'A'
    },
    backBanner: {
      slot: 'backBanner',
      label: '帅旗（帅旗 → 燕尾旌旗）',
      subgroups: ['banner'],
      kind: 'single',
      anchor: [0.228, 0.394, 0.126],
      orientation: '旗杆为转轴（z 旋转 = 旗面摆动）',
      envelope: { note: '宽 ≤ 0.45、高 ≤ 0.70（现状旗体 ≈0.30×0.42）', maxSpan: 0.45, maxLen: 0.70 },
      animationChannels: ['banner.rotation.z（idle +0.034 / move +0.06 / capture −0.30）'],
      parentSubgroup: null,
      originalTri: 200,
      originalMeshes: 3,
      dclass: 'A'
    },
    cape: {
      slot: 'cape',
      label: '披风（长披 → 短披 + 毛领）',
      subgroups: ['capeHem'],
      kind: 'single',
      anchor: [0, 0.420, -0.010],
      orientation: '下垂向 −Y（腰部/肩后 pivot）',
      envelope: { note: '宽度 ≤ 0.55', maxSpan: 0.55 },
      animationChannels: ['capeHem.rotation.z（move +0.10 / capture +0.14）'],
      parentSubgroup: null,
      originalTri: 144,
      originalMeshes: 1,
      dclass: 'B'
    }
  },
  R: {
    wheel: {
      slot: 'wheel',
      label: '车轮（木辐条轮 → 6 辐轮）',
      subgroups: ['wheelL', 'wheelR'],
      kind: 'pair',
      anchor: [-0.26, 0.330, 0],
      orientation: '转轴 = X 轴（轮心为旋转中心）',
      envelope: { note: '半径 ≤ 0.38（现状 0.244）；厚 ≤ 0.08；轮径 ≥ 现状 90%', maxRadius: 0.38 },
      animationChannels: ['wheelL.rotation.x / wheelR.rotation.x（move 0.80 / capture 1.20）'],
      parentSubgroup: null,
      originalTri: 684,
      // M-06 ⑥ 用户拍板移出白名单 → 每侧单族 1 mesh（原双族 2）。三角数不变（684）。
      originalMeshes: 1,
      dclass: 'B'
    },
    crew: {
      slot: 'crew',
      label: '乘员（持戈兵 → 持戟兵）',
      subgroups: ['spearman'],
      kind: 'single',
      anchor: [-0.050, 0.451, 0.080],
      orientation: '朝向 −Z 前（躯干质心为旋转中心）',
      envelope: { note: '包围盒 ≤ 0.35×0.80×0.35', maxSpan: 0.35, maxLen: 0.80 },
      animationChannels: ['spearman.rotation.x（move −0.25 / capture −0.70）'],
      parentSubgroup: null,
      originalTri: 1462,
      originalMeshes: 1,
      dclass: 'B'
    }
  },
  C: {
    wheel: {
      slot: 'wheel',
      label: '推行轮（素木轮 → 包铁轮）',
      subgroups: ['wheelL', 'wheelR'],
      kind: 'pair',
      anchor: [-0.145, 0.160, 0.000],
      orientation: '转轴 = X 轴（轮心为旋转中心）',
      envelope: { note: '半径 ≤ 0.38（现状 ≈0.074）；厚 ≤ 0.08', maxRadius: 0.38 },
      animationChannels: ['（POSE_TABLE 未驱动；推行轮随车速自转，见 PieceChoreography C.wheelL/R）'],
      parentSubgroup: null,
      originalTri: 288,
      originalMeshes: 1,
      dclass: 'B'
    },
    crew: {
      slot: 'crew',
      label: '操作兵（介帻兵 → 尖顶笠工兵）',
      subgroups: ['soldierL', 'soldierR'],
      kind: 'pair',
      anchor: [-0.25, 0.248, 0.09],
      orientation: '朝向 −Z 前（躯干质心为旋转中心）',
      envelope: { note: '单员包围盒 ≤ 0.35×0.80×0.35', maxSpan: 0.35, maxLen: 0.80 },
      animationChannels: ['soldierL.rotation.x / soldierR.rotation.x（idle +0.045 / move −0.30 / capture ±0.35~−0.45）'],
      parentSubgroup: null,
      originalTri: 1660,
      originalMeshes: 1,
      dclass: 'B'
    }
  }
};

/* ============================================================
 * §2 变体注册表
 * ============================================================ */

const _variants = new Map<string, VariantDef>();
const _vkey = (type: string, slot: string, variantId: string): string => `${type}|${slot}|${variantId}`;

/** 注册一个差异化变体（原版 v1 无需注册；构建函数由 pieceVariants.ts 提供） */
export function registerVariant(type: string, slot: SlotId, variantId: string, label: string, build: VariantBuildFn): void {
  if (variantId === VARIANT_ID_DEFAULT) throw new Error(`[accessories] 变体 id 不得使用保留值 ${VARIANT_ID_DEFAULT}（= 原版）`);
  const key = _vkey(type, slot, variantId);
  if (_variants.has(key)) throw new Error(`[accessories] 变体重复注册：${key}`);
  _variants.set(key, { type, slot, variantId, label, build });
}

/** 取变体定义 */
export function getVariant(type: string, slot: string, variantId: string): VariantDef | undefined {
  return _variants.get(_vkey(type, slot, variantId));
}

/* ============================================================
 * §3 查询 API
 * ============================================================ */

/** 列出某兵种全部可换装槽位 */
export function listSlots(type: string): SlotSpec[] {
  const t = SLOT_TABLE[type];
  return t ? Object.keys(t).map((k) => t[k]!).filter(Boolean) : [];
}

/** 该兵种是否有此槽位 */
export function hasSlot(type: string, slot: string): boolean {
  const t = SLOT_TABLE[type];
  return !!(t && t[slot]);
}

/** 取槽位契约 */
export function getSlot(type: string, slot: string): SlotSpec | undefined {
  const t = SLOT_TABLE[type];
  return t ? t[slot] : undefined;
}

/** 列出某槽位可选变体（含原版 v1） */
export function listVariants(type: string, slot: string): Array<{ variantId: string; label: string; isDefault: boolean }> {
  const out: Array<{ variantId: string; label: string; isDefault: boolean }> = [
    { variantId: VARIANT_ID_DEFAULT, label: '原版', isDefault: true }
  ];
  for (const def of _variants.values()) {
    if (def.type === type && def.slot === slot) out.push({ variantId: def.variantId, label: def.label, isDefault: false });
  }
  return out;
}

/** 列出全部已注册变体（全局） */
export function listAllVariants(): VariantDef[] {
  return Array.from(_variants.values());
}

/* ============================================================
 * §4 换装 API（默认装配状态；显式 variantSet 可覆盖）
 * ============================================================ */

const _equipped = new Map<string, Map<string, string>>();

/** 给某兵种某槽位装备变体（variantId=v1 等价于恢复原版） */
export function equip(type: string, slot: string, variantId: string): void {
  if (!hasSlot(type, slot)) throw new Error(`[accessories] ${type} 无槽位 ${slot}`);
  if (variantId === VARIANT_ID_DEFAULT) { unequip(type, slot); return; }
  if (!getVariant(type, slot, variantId)) throw new Error(`[accessories] 未注册变体 ${type}/${slot}/${variantId}`);
  let m = _equipped.get(type);
  if (!m) { m = new Map(); _equipped.set(type, m); }
  m.set(slot, variantId);
}

/** 卸下某兵种某槽位（恢复原版） */
export function unequip(type: string, slot: string): void {
  const m = _equipped.get(type);
  if (m) m.delete(slot);
}

/** 清空全部默认装配状态（回到「开局零变化」） */
export function unequipAll(): void {
  _equipped.clear();
}

/** 取某兵种当前默认装配表（无 = undefined） */
export function variantSetFor(type: string): Record<string, string> | undefined {
  const m = _equipped.get(type);
  if (!m || m.size === 0) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of m) out[k] = v;
  return out;
}

/** 把装配表折叠成稳定的缓存键（槽位排序；undefined/空 → ''） */
export function variantKey(vs?: Record<string, string>): string {
  if (!vs) return '';
  const keys = Object.keys(vs).filter((k) => vs[k] && vs[k] !== VARIANT_ID_DEFAULT).sort();
  if (!keys.length) return '';
  return keys.map((k) => `${k}:${vs[k]}`).join('|');
}

/** 解析器：装配表 → 需要覆盖的 (槽位契约, 变体定义) 列表（纯函数） */
export function resolveVariants(type: string, vs?: Record<string, string>): Array<{ spec: SlotSpec; variant: VariantDef }> {
  const out: Array<{ spec: SlotSpec; variant: VariantDef }> = [];
  if (!vs) return out;
  for (const slot of Object.keys(vs).sort()) {
    const vid = vs[slot];
    if (!vid || vid === VARIANT_ID_DEFAULT) continue;
    const spec = getSlot(type, slot);
    if (!spec) continue;
    const variant = getVariant(type, slot, vid);
    if (variant) out.push({ spec, variant });
  }
  return out;
}
