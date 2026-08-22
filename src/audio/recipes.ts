/* ==========================================================================
 * qin-chess-3d · src/audio/recipes.js
 * 秦风 · 战场音效配方表（纯数据，零逻辑）
 *
 * 本文件是音效系统的"后端数据"：定义所有音效事件的四层 T/C/B/S 参数、
 * 演出序列编排、电平与混响映射。sfx.js 的 renderBeat() 按本表数据执行。
 *
 * 设计引用: design/audio-system-v2.md
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * 0. 常量
 * ------------------------------------------------------------------------ */

/** 阵营音高偏移（红 ×1.06 / 黑 ×0.94），满足 ≥1.5 半音的可分辨阈值 */
export const FACTION_SHIFT = { r: 1.06, b: 0.94 };

/** 兵种字母 → 名称 */
export const PIECE_NAMES: Record<string, string> = {
  P: 'pawn', N: 'horse', B: 'elephant',
  A: 'advisor', R: 'rook', C: 'cannon', K: 'king'
};

/** 全部兵种列表 */
export const ALL_PIECES: string[] = ['P', 'N', 'B', 'A', 'R', 'C', 'K'];

/* --------------------------------------------------------------------------
 * 1. 泛音列预设（bronzeBody 用）
 * ------------------------------------------------------------------------ */

export const PARTIALS: Record<string, Array<[number, number, number]>> = {
  /** 编钟：壳振动 1:1.19:1.56 + 高次 */
  BELL: [
    [1.0, 0.62, 0.85], [1.19, 0.30, 0.72],
    [2.0, 0.34, 0.46], [2.76, 0.22, 0.30],
    [3.61, 0.13, 0.20], [5.42, 0.07, 0.11]
  ],
  /** 剑：梁弯曲 1:2.756:5.404 */
  BAR: [
    [1.0, 0.60, 0.80],
    [2.756, 0.30, 0.58],
    [5.404, 0.16, 0.35],
    [8.933, 0.07, 0.18],
    [13.1, 0.04, 0.10]
  ],
  /** 甲片：约束板 1:1.42:2.11 */
  PLATE: [
    [1.0, 0.55, 0.70],
    [1.42, 0.32, 0.55],
    [2.11, 0.18, 0.38],
    [3.4, 0.08, 0.20]
  ],
  /** 铁：暗一个八度，衰减快 */
  IRON: [
    [1.0, 0.58, 0.72],
    [1.32, 0.28, 0.48],
    [2.67, 0.14, 0.30],
    [4.89, 0.06, 0.15]
  ],
  /** 铜锣（check 用）：更强的不谐和 */
  GONG: [
    [1.0, 0.55, 0.95], [1.42, 0.40, 0.82],
    [1.88, 0.32, 0.66], [2.41, 0.24, 0.50],
    [3.17, 0.16, 0.36], [4.63, 0.10, 0.24],
    [6.21, 0.06, 0.15]
  ]
};

/* --------------------------------------------------------------------------
 * 2. 电平表（LINEAR PEAK，进入 voice 前）。格式: eventName → peak
 * ------------------------------------------------------------------------ */

export const LEVEL = {
  /* 系统事件 */
  select: 0.34, hover: 0.11, check: 0.85,
  'pawn.select': 0.32, 'horse.select': 0.32,
  'elephant.select': 0.36, 'advisor.select': 0.30,
  'rook.select': 0.36, 'cannon.select': 0.34, 'king.select': 0.34,
  illegal: 0.30, undo: 0.26, start: 0.42,
  win: 0.50, lose: 0.46,
  /* 通用后备 */
  move: 0.50, capture: 0.78,
  /* 环境 */
  'ambient.wind': 0.024,
  'ambient.banner': 0.030,
  'ambient.drum': 0.058,
  'ambient.crowd': 0.026,
  'ambient.horse': 0.012,
  /* 按兵种/事件查找 */
  'pawn.move': 0.50, 'horse.move': 0.46,
  'elephant.move': 0.48, 'advisor.move': 0.34,
  'rook.move': 0.50, 'cannon.move': 0.44, 'king.move': 0.52,
  'pawn.capture': 0.66, 'horse.capture': 0.66,
  'elephant.capture': 0.66, 'advisor.capture': 0.66,
  'rook.capture': 0.66, 'cannon.capture': 0.66, 'king.capture': 0.66,
  /* 被吃方 */
  'victim.shatter': 0.11, 'victim.collapse': 0.24,
  /* 待机 */
  'pawn.idle': 0.028, 'horse.idle': 0.035,
  'elephant.idle': 0.028, 'advisor.idle': 0.026,
  'rook.idle': 0.030, 'cannon.idle': 0.030, 'king.idle': 0.034,
  'roster.idle': 0.016,
  'king.heartbeat': 0.050
};

/* --------------------------------------------------------------------------
 * 3. 混响发送量表。格式: eventName → wet (0..1)
 * ------------------------------------------------------------------------ */

export const WET = {
  select: 0.16, hover: 0.05, move: 0.10,
  'pawn.select': 0.14, 'horse.select': 0.15,
  'elephant.select': 0.20, 'advisor.select': 0.13,
  'rook.select': 0.18, 'cannon.select': 0.17, 'king.select': 0.18,
  capture: 0.34, check: 0.60, illegal: 0.06,
  undo: 0.30, start: 0.45, win: 0.42, lose: 0.55,
  ambient: 0.50,
  'pawn.move': 0.09, 'horse.move': 0.10,
  'elephant.move': 0.14, 'advisor.move': 0.11,
  'rook.move': 0.11, 'cannon.move': 0.12, 'king.move': 0.16,
  'pawn.capture': 0.11, 'horse.capture': 0.15,
  'elephant.capture': 0.16, 'advisor.capture': 0.13,
  'rook.capture': 0.14, 'cannon.capture': 0.14, 'king.capture': 0.18,
  'pawn.idle': 0.22, 'horse.idle': 0.20,
  'elephant.idle': 0.28, 'advisor.idle': 0.26,
  'rook.idle': 0.24, 'cannon.idle': 0.26, 'king.idle': 0.30,
  'roster.idle': 0.34,
  'king.heartbeat': 0.26
};

/* --------------------------------------------------------------------------
 * 4. 兵种装甲音色预设（armorClink 通用参数集）
 * ------------------------------------------------------------------------ */

export const ARMOR_PRESETS: Record<string, any> = {
  P: { n: 2, f0: 3000, f1: 4000, spread: 0.048, ring: 0.26, peak: 0.17 },
  N: { n: 3, f0: 3200, f1: 4800, spread: 0.055, ring: 0.24, peak: 0.18 },
  B: { n: 4, f0: 2600, f1: 3800, spread: 0.075, ring: 0.34, peak: 0.19 },
  A: { n: 2, f0: 3400, f1: 4200, spread: 0.055, ring: 0.10, peak: 0.085, softAttack: 0.005 },
  R: { n: 5, f0: 2400, f1: 3600, spread: 0.090, ring: 0.30, peak: 0.20 },
  C: { n: 2, f0: 2700, f1: 3500, spread: 0.070, ring: 0.20, peak: 0.12 },
  K: { n: 5, f0: 3400, f1: 5200, spread: 0.070, ring: 0.38, peak: 0.21 }
};

/** 落位装甲音色（更重、更多片、更宽spread） */
export const ARMOR_LAND_PRESETS: Record<string, any> = {
  P: { n: 4, f0: 3100, f1: 4300, spread: 0.085, ring: 0.30, peak: 0.22 },
  N: { n: 5, f0: 3200, f1: 4900, spread: 0.095, ring: 0.28, peak: 0.21 },
  B: { n: 5, f0: 2600, f1: 3900, spread: 0.105, ring: 0.36, peak: 0.23 },
  A: { n: 3, f0: 3300, f1: 4300, spread: 0.070, ring: 0.12, peak: 0.11, softAttack: 0.005 },
  R: { n: 6, f0: 2400, f1: 3700, spread: 0.130, ring: 0.32, peak: 0.24 },
  C: { n: 3, f0: 2700, f1: 3600, spread: 0.080, ring: 0.22, peak: 0.14 },
  K: { n: 6, f0: 3500, f1: 5200, spread: 0.100, ring: 0.40, peak: 0.24 }
};

/** 收势沉降装甲 */
export const ARMOR_FALL_PRESETS: Record<string, any> = {
  P: { n: 3, f0: 2800, f1: 3900, spread: 0.110, ring: 0.18, peak: 0.10 },
  N: { n: 3, f0: 3000, f1: 4400, spread: 0.120, ring: 0.16, peak: 0.09 },
  B: { n: 4, f0: 2500, f1: 3600, spread: 0.140, ring: 0.22, peak: 0.10 },
  A: { n: 2, f0: 3300, f1: 4100, spread: 0.080, ring: 0.10, peak: 0.05, softAttack: 0.005 },
  R: { n: 4, f0: 2300, f1: 3300, spread: 0.150, ring: 0.18, peak: 0.11 },
  C: { n: 2, f0: 2600, f1: 3400, spread: 0.090, ring: 0.14, peak: 0.07 },
  K: { n: 4, f0: 3300, f1: 4800, spread: 0.130, ring: 0.24, peak: 0.10 }
};

/* --------------------------------------------------------------------------
 * 5. 兵种移动鼓预设（warDrum 参数）
 * ------------------------------------------------------------------------ */

export const DRUM_PRESETS: Record<string, any> = {
  M1: { // 起步蹬地
    P: { f0: 112, f1: 72, dur: 0.09, peak: 0.21 },
    N: { f0: 92, f1: 60, dur: 0.07, peak: 0.22 },
    B: { f0: 84, f1: 52, dur: 0.10, peak: 0.30 },
    A: { f0: 122, f1: 88, dur: 0.07, peak: 0.15, noSnap: true },
    R: { f0: 96, f1: 62, dur: 0.10, peak: 0.26 },
    C: { f0: 0, f1: 0, dur: 0, peak: 0 }, // 炮无鼓，用 woodKnock
    K: { f0: 134, f1: 88, dur: 0.11, peak: 0.30 }
  },
  M4: { // 落位
    P: { f0: 150, f1: 104, dur: 0.11, peak: 0.30, attack: 0.003 },
    N: { f0: 140, f1: 96, dur: 0.10, peak: 0.26, attack: 0.003 },
    B: { f0: 90, f1: 50, dur: 0.14, peak: 0.34, attack: 0.004 },
    A: { f0: 132, f1: 96, dur: 0.12, peak: 0.20, attack: 0.004 },
    R: { f0: 132, f1: 86, dur: 0.12, peak: 0.30, attack: 0.003 },
    C: { f0: 120, f1: 82, dur: 0.10, peak: 0.22, attack: 0.003 },
    K: { f0: 116, f1: 74, dur: 0.16, peak: 0.30, attack: 0.004 }
  }
};

/* --------------------------------------------------------------------------
 * 6. 兵种吃子兵器参数（bladeClash 的 base/grind/partials）
 * ------------------------------------------------------------------------ */

export const WEAPON_PARAMS: Record<string, any> = {
  P: { type: '戈', base: 620, grind: 0.34, partials: 'BAR', whoosh: { f0: 620, f1: 2400 } },
  N: { type: '长戟', base: 480, grind: 0.18, partials: 'BAR', whoosh: { f0: 540, f1: 2100 } },
  B: { type: '铜钺', base: 330, grind: 0.10, partials: 'BELL', whoosh: { f0: 1200, f1: 480 } },
  A: { type: '短剑', base: 880, grind: 0.30, partials: 'BAR', whoosh: { f0: 900, f1: 3200 } },
  R: { type: '车戈铁箍', base: 1660, grind: 0.42, partials: 'IRON', whoosh: { f0: 700, f1: 2600 } },
  // 炮·石弹：isStone 纯木石（无金属/无火药）。whoosh = 抛石破空（低频呼啸 下行）
  C: { type: '石弹', base: 0, grind: 0, partials: null, whoosh: { f0: 480, f1: 190 }, isStone: true },
  K: { type: '王剑', base: 700, grind: 0.26, partials: 'BAR', whoosh: { f0: 800, f1: 2900 }, extraBell: true }
};

/** 吃子闷击参数（A5 thud） */
export const THUD_PARAMS: Record<string, any> = {
  P: { f0: 98, f1: 46, peak: 0.58, dur: 0.18 },
  N: { f0: 90, f1: 46, peak: 0.62, dur: 0.20 },
  B: { f0: 72, f1: 38, peak: 0.62, dur: 0.22 },
  A: { f0: 100, f1: 54, peak: 0.56, dur: 0.18 },
  R: { f0: 96, f1: 44, peak: 0.62, dur: 0.24 },
  C: { f0: 86, f1: 38, peak: 0.64, dur: 0.28 },
  K: { f0: 104, f1: 52, peak: 0.66, dur: 0.22 }
};

/* --------------------------------------------------------------------------
 * 7. 受害者崩塌参数
 * ------------------------------------------------------------------------ */

export const VICTIM_WEIGHTS: Record<string, string> = { P: 'light', N: 'medium', A: 'light', B: 'medium', R: 'heavy', C: 'medium', K: 'heavy' };

export const VICTIM_COLLAPSE: Record<string, any> = {
  light: { f0: 78, f1: 43, peak: 0.18, dur: 0.16 },
  medium: { f0: 70, f1: 39, peak: 0.22, dur: 0.18 },
  heavy: { f0: 60, f1: 33, peak: 0.24, dur: 0.22 }
};

/* --------------------------------------------------------------------------
 * 8. 五声音阶频率（Hz）
 * ------------------------------------------------------------------------ */

export const PENTA = {
  gong3: 130.81, shang3: 146.83, jue3: 164.81, zhi3: 196.00, yu3: 220.00,
  gong4: 261.63, shang4: 293.66, jue4: 329.63, zhi4: 392.00, yu4: 440.00,
  gong5: 523.25
};

/* --------------------------------------------------------------------------
 * 9. BEAT_RECIPES — 主配方表
 *
 *    结构: { [eventName]: { layers: { T:[], C:[], B:[], S:[] }, opts } }
 *    每个 layer 条目 = { type, ...params, peak, wet, offset? }
 *
 *    type 签名（全部由 sfx.js 的 renderBeat 解析）:
 *      'osc'      → mkOsc(type, freq, t+dur, dur, detune?)
 *      'noise'    → mkNoise(t, dur, rate?)
 *      'transient'→ transient(freq, Q, peak, dur, rate?)
 *      'warDrum'  → warDrum(f0, f1, peak, dur, noSnap?)
 *      'bronzeBody' → bronzeBody(base, peak, decayScale, partials, vibHz?)
 *      'armorClink' → armorClink(n, f0, f1, peak, spread, ring, softAttack?)
 *      'leatherCreak' → leatherCreak(cf, q, peak, dur, grain)
 *      'bladeClash' → bladeClash(base, peak, dur, grind, partials)
 *      'woodKnock' → woodKnock(f, peak, dur)
 *      'horseSnort' → horseSnort(f, peak, dur)
 *      'dustScuff' → dustScuff(f0, f1, q, peak, dur, attack?)
 *      'clothRustle' → clothRustle(cf, q, peak, dur, attack?)
 *      'bannerFlap' → bannerFlap(n, cf, peak)
 *      'crowdBed' → crowdBed(peak, lp, dur?)
 *      'stoneCrush' → stoneCrush()
 *      'chimeNote' → chimeNote(freq, peak, dur)
 *      'footStep' → footStep(lo, tone, q, peak, dur)
 *      'whoosh' → whoosh(f0, f1, q, peak, dur)
 *      'tail'     → 标记为尾韵，独立调度
 * ------------------------------------------------------------------------ */

/** 一条合成指令（各 type 参数由 sfx.js 的 executeInst 解析；字段宽松） */
export interface RecipeLayer {
  type: string;
  [key: string]: unknown;
}

/** 一个音效配方：分层指令 + 选项（layers 宽松，供 sfx.js renderBeat 遍历） */
export interface Recipe {
  layers: Record<string, any>;
  opts: Record<string, unknown>;
}

export const BEAT_RECIPES: Record<string, Recipe> = {};

/* ----- 9.1 系统事件配方 ----- */

BEAT_RECIPES['select'] = {
  layers: {
    C: [
      { type: 'bronzeBody', freq: 880, peak: 0.34, decayScale: 1, partials: 'BELL', vibHz: 0 }
    ],
    T: [
      { type: 'transient', freq: 4200, q: 1.6, peak: 0.10, dur: 0.012, rate: 1.3 }
    ]
  },
  opts: { wet: 0.16, life: 1.1 }
};

/* ----- 9.1b 各兵种选中音（按兵种可辨识，车/炮走金属/木石非编钟） ----- */

BEAT_RECIPES['pawn.select'] = {
  // 兵·戈：亮而短促的青铜剑鸣
  layers: {
    C: [{ type: 'bronzeBody', freq: 620, peak: 0.30, decayScale: 0.9, partials: 'BAR', vibHz: 0 }],
    T: [{ type: 'transient', freq: 3600, q: 1.8, peak: 0.09, dur: 0.012, rate: 1.3 }]
  },
  opts: { wet: 0.14, life: 0.9 }
};

BEAT_RECIPES['horse.select'] = {
  // 马·长戟：稍低的戟鸣 + 皮革吱呀
  layers: {
    C: [
      { type: 'bronzeBody', freq: 480, peak: 0.26, decayScale: 1.0, partials: 'BAR', vibHz: 0 },
      { type: 'leatherCreak', cf: 520, q: 1.8, peak: 0.07, dur: 0.16, grain: 3 }
    ],
    T: [{ type: 'transient', freq: 3000, q: 1.6, peak: 0.08, dur: 0.014, rate: 1.2 }]
  },
  opts: { wet: 0.15, life: 1.0 }
};

BEAT_RECIPES['elephant.select'] = {
  // 象·铜钺：厚重的钟体 + 木底
  layers: {
    C: [{ type: 'bronzeBody', freq: 330, peak: 0.32, decayScale: 1.4, partials: 'BELL', vibHz: 0 }],
    B: [{ type: 'woodKnock', f: 160, peak: 0.14, dur: 0.06 }],
    T: [{ type: 'transient', freq: 2400, q: 1.4, peak: 0.08, dur: 0.016, rate: 1.1 }]
  },
  opts: { wet: 0.20, life: 1.2 }
};

BEAT_RECIPES['advisor.select'] = {
  // 士·短剑：亮而轻的短剑 + 软甲
  layers: {
    C: [{ type: 'bronzeBody', freq: 880, peak: 0.24, decayScale: 0.7, partials: 'BAR', vibHz: 0 }],
    T: [
      { type: 'armorClink', n: 2, f0: 3400, f1: 4200, peak: 0.06, spread: 0.04, ring: 0.10, softAttack: 0.005 },
      { type: 'transient', freq: 4200, q: 2.0, peak: 0.06, dur: 0.010, rate: 1.3 }
    ]
  },
  opts: { wet: 0.13, life: 0.8 }
};

BEAT_RECIPES['rook.select'] = {
  // 车·车戈铁箍：暗铁 + 木轮辚辚 + 甲片（非编钟）
  layers: {
    C: [{ type: 'bronzeBody', freq: 1660, peak: 0.22, decayScale: 0.8, partials: 'IRON', vibHz: 0 }],
    B: [
      { type: 'woodKnock', f: 150, peak: 0.16, dur: 0.06 },
      { type: 'woodKnock', f: 138, peak: 0.10, dur: 0.05, offset: 0.05 }
    ],
    T: [
      { type: 'armorClink', n: 4, f0: 2400, f1: 3600, peak: 0.12, spread: 0.08, ring: 0.20 },
      { type: 'transient', freq: 3200, q: 1.6, peak: 0.10, dur: 0.014, rate: 1.2 }
    ]
  },
  opts: { wet: 0.18, life: 1.0 }
};

BEAT_RECIPES['cannon.select'] = {
  // 炮·石弹：木车吱呀 + 石弹碎裂（纯木石，无编钟）
  layers: {
    C: [
      { type: 'woodKnock', f: 620, peak: 0.16, dur: 0.05 },
      { type: 'dustScuff', f0: 2600, f1: 700, q: 1.2, peak: 0.14, dur: 0.18 }
    ],
    B: [{ type: 'woodKnock', f: 120, peak: 0.20, dur: 0.07 }],
    T: [{ type: 'transient', freq: 2800, q: 2.0, peak: 0.08, dur: 0.014, rate: 1.2 }]
  },
  opts: { wet: 0.17, life: 0.9 }
};

BEAT_RECIPES['king.select'] = {
  // 帅·王剑：剑鸣（上移与兵·戈 620 拉开音程）+ 编钟尾韵（王者）
  layers: {
    C: [
      { type: 'bronzeBody', freq: 740, peak: 0.26, decayScale: 1.1, partials: 'BAR', vibHz: 0 },
      { type: 'bronzeBody', freq: 523.25, peak: 0.17, decayScale: 1.3, partials: 'BELL', vibHz: 0, offset: 0.01 }
    ],
    T: [{ type: 'transient', freq: 4200, q: 1.6, peak: 0.11, dur: 0.012, rate: 1.3 }]
  },
  opts: { wet: 0.18, life: 1.1 }
};

BEAT_RECIPES['hover'] = {
  layers: {
    T: [
      { type: 'transient', freq: 5200, q: 2.2, peak: 0.11, dur: 0.018, rate: 1.25 }
    ],
    C: [
      { type: 'osc', oscType: 'sine', freq: 2600, peak: 0.055, attack: 0.002, decay: 0.03, dur: 0.05 }
    ]
  },
  opts: { wet: 0.05, life: 0.2 }
};

BEAT_RECIPES['illegal'] = {
  layers: {
    C: [
      { type: 'osc', oscType: 'square', freq: 200, peak: 0.30, attack: 0.006, decay: 0.075, dur: 0.105, sweep: { end: 0.84, ramp: 'exp', rampTime: 0.075 } },
      { type: 'osc', oscType: 'square', freq: 150, peak: 0.255, attack: 0.006, decay: 0.075, dur: 0.105, sweep: { end: 0.84, ramp: 'exp', rampTime: 0.075 }, offset: 0.09 }
    ],
    B: [
      { type: 'osc', oscType: 'sine', freq: 110, peak: 0.15, attack: 0.005, decay: 0.15, dur: 0.16, sweep: { end: 84, ramp: 'linear', rampTime: 0.16 } }
    ],
    T: [
      { type: 'filter', filterType: 'lowpass', freq: 520, q: 0.9, applyTo: 'layers' }
    ]
  },
  opts: { wet: 0.06, life: 0.4 }
};

BEAT_RECIPES['undo'] = {
  layers: {
    C: [
      { type: 'osc', oscType: 'sine', freq: 220, peak: 0.26, attack: 0.33, decay: 0.09, dur: 0.42, sweep: { end: 660, ramp: 'exp', rampTime: 0.36 }, envReverse: true },
      { type: 'osc', oscType: 'triangle', freq: 330, peak: 0.078, attack: 0.33, decay: 0.09, dur: 0.42, sweep: { end: 990, ramp: 'exp', rampTime: 0.36 }, envReverse: true }
    ],
    T: [
      { type: 'noise', rate: 1.0, dur: 0.42, peak: 0.057, attack: 0.33, decay: 0.09, envReverse: true, filter: { type: 'bandpass', freq: 800, q: 2.4, sweep: { end: 3600, ramp: 'exp', rampTime: 0.36 } } }
    ]
  },
  opts: { wet: 0.30, life: 1.0 }
};

BEAT_RECIPES['start'] = {
  layers: {
    B: [
      { type: 'warDrum', f0: 70, f1: 44, peak: 0.336, dur: 0.30, offset: 0 },
      { type: 'warDrum', f0: 66, f1: 42, peak: 0.260, dur: 0.34, offset: 0.73 }
    ],
    C: [
      { type: 'osc', oscType: 'horn', freq: 196.00, peak: 0.344, attack: 0.055, hold: 0.109, release: 0.13, dur: 0.26, offset: 0.06 },
      { type: 'osc', oscType: 'horn', freq: 261.63, peak: 0.344, attack: 0.055, hold: 0.101, release: 0.12, dur: 0.24, offset: 0.32 },
      { type: 'osc', oscType: 'horn', freq: 293.66, peak: 0.344, attack: 0.055, hold: 0.084, release: 0.10, dur: 0.20, offset: 0.55 },
      { type: 'osc', oscType: 'horn', freq: 392.00, peak: 0.420, attack: 0.055, hold: 0.193, release: 0.23, dur: 0.46, offset: 0.73 }
    ]
  },
  opts: { wet: 0.45, life: 2.4 }
};

BEAT_RECIPES['win'] = {
  layers: {
    C: [
      { type: 'chimeNote', freq: 261.63, peak: 0.350, dur: 0.50, offset: 0.000 },
      { type: 'chimeNote', freq: 293.66, peak: 0.375, dur: 0.54, offset: 0.115 },
      { type: 'chimeNote', freq: 329.63, peak: 0.400, dur: 0.58, offset: 0.230 },
      { type: 'chimeNote', freq: 392.00, peak: 0.425, dur: 0.62, offset: 0.345 },
      { type: 'chimeNote', freq: 440.00, peak: 0.450, dur: 0.66, offset: 0.460 },
      { type: 'chimeNote', freq: 523.25, peak: 0.475, dur: 0.72, offset: 0.575 },
      { type: 'bronzeBody', freq: 523.25, peak: 0.21, decayScale: 1.6, partials: 'BELL', vibHz: 0, offset: 0.62 }
    ],
    B: [
      { type: 'warDrum', f0: 74, f1: 46, peak: 0.36, dur: 0.30, offset: 0.86 },
      { type: 'warDrum', f0: 70, f1: 44, peak: 0.30, dur: 0.28, offset: 1.04 },
      { type: 'warDrum', f0: 80, f1: 48, peak: 0.43, dur: 0.40, offset: 1.18 }
    ]
  },
  opts: { wet: 0.42, life: 2.6 }
};

BEAT_RECIPES['lose'] = {
  layers: {
    C: [
      { type: 'osc', oscType: 'horn', freq: 220.00, peak: 0.391, attack: 0.066, hold: 0.120, release: 0.15, dur: 0.30, offset: 0.00 },
      { type: 'osc', oscType: 'horn', freq: 196.00, peak: 0.363, attack: 0.066, hold: 0.120, release: 0.15, dur: 0.30, offset: 0.26 },
      { type: 'osc', oscType: 'horn', freq: 174.61, peak: 0.340, attack: 0.070, hold: 0.128, release: 0.16, dur: 0.32, offset: 0.52 },
      { type: 'osc', oscType: 'horn', freq: 164.81, peak: 0.317, attack: 0.121, hold: 0.165, release: 0.275, dur: 0.55, offset: 0.80 },
      { type: 'bronzeBody', freq: 132, peak: 0.23, decayScale: 3.0, partials: 'GONG', vibHz: 2.2, offset: 0.78 }
    ],
    B: [
      { type: 'warDrum', f0: 54, f1: 33, peak: 0.322, dur: 0.50, offset: 0.78 }
    ]
  },
  opts: { wet: 0.55, life: 3.4 }
};

BEAT_RECIPES['check'] = {
  layers: {
    B: [
      { type: 'warDrum', f0: 62, f1: 40, peak: 0.765, dur: 0.32, offset: 0.0 },
      { type: 'warDrum', f0: 58, f1: 38, peak: 0.383, dur: 0.28, offset: 0.19 }
    ],
    C: [
      { type: 'bronzeBody', freq: 248, peak: 0.425, decayScale: 2.6, partials: 'GONG', vibHz: 4.6, offset: 0.03 }
    ],
    T: [
      { type: 'transient', freq: 1500, q: 0.8, peak: 0.255, dur: 0.06, rate: 0.95, offset: 0.03 }
    ]
  },
  opts: { wet: 0.60, life: 3.2 }
};

/* ----- 9.2 各兵种移动配方（M0-M5） ----- */

function makeMoveRecipes() {
  const pieces = ALL_PIECES;

  for (const p of pieces) {
    const pk = `${PIECE_NAMES[p]}.move`;

    /* M1 起步 */
    BEAT_RECIPES[`${pk}.launch`] = buildM1(p);
    /* M2 巡航 */
    BEAT_RECIPES[`${pk}.cruise`] = buildM2(p);
    /* M3 急停 */
    BEAT_RECIPES[`${pk}.brake`] = buildM3(p);
    /* M4 落位（最重拍） */
    BEAT_RECIPES[`${pk}.land`] = buildM4(p);
    /* M5 收势沉降 */
    BEAT_RECIPES[`${pk}.settle`] = buildM5(p);
  }
}

function buildM1(p: string): Recipe {
  const dr = DRUM_PRESETS.M1[p];
  const ar = ARMOR_PRESETS[p];
  const recipe: Recipe = { layers: { B: [], T: [], C: [] }, opts: {} };

  if (p === 'C') {
    // 炮：木块敲击 + 稀少甲响
    recipe.layers.T.push({
      type: 'woodKnock', f: 380, peak: 0.16, dur: 0.05
    });
    recipe.opts.wet = 0.12;
  } else {
    // 通用：战鼓 + 甲响簇
    recipe.layers.B.push({
      type: 'warDrum', f0: dr.f0, f1: dr.f1, peak: dr.peak, dur: dr.dur,
      noSnap: dr.noSnap || false
    });
    recipe.opts.wet = 0.09;

    if (p === 'A') {
      // 士特殊：丝绸摩擦
      recipe.layers.C.push({
        type: 'clothRustle', cf: 2400, q: 1.1, peak: 0.085, dur: 0.17, attack: 0.014
      });
      recipe.layers.T.push({
        type: 'armorClink', n: ar.n, f0: ar.f0, f1: ar.f1, peak: ar.peak,
        spread: ar.spread, ring: ar.ring, softAttack: ar.softAttack || 0
      });
      recipe.opts.wet = 0.11;
    } else if (p === 'N') {
      // 马特殊：皮带摩擦
      recipe.layers.C.push({
        type: 'leatherCreak', cf: 520, q: 1.8, peak: 0.10, dur: 0.16, grain: 4
      });
      recipe.layers.T.push({
        type: 'transient', freq: 1320, q: 1.8, peak: 0.22, dur: 0.018
      });
      recipe.layers.T.push({
        type: 'armorClink', n: ar.n, f0: ar.f0, f1: ar.f1, peak: ar.peak,
        spread: ar.spread, ring: ar.ring
      });
    } else if (p === 'K') {
      // 帅特殊：布帛 + 金玉
      recipe.layers.C.push({
        type: 'clothRustle', cf: 1900, q: 1.2, peak: 0.09, dur: 0.18
      });
      recipe.layers.C.push({
        type: 'chimeNote', freq: 2093, peak: 0.06, dur: 0.34, offset: 0
      });
      recipe.layers.C.push({
        type: 'chimeNote', freq: 1568, peak: 0.04, dur: 0.28, offset: 0.04
      });
      recipe.layers.T.push({
        type: 'armorClink', n: ar.n, f0: ar.f0, f1: ar.f1, peak: ar.peak,
        spread: ar.spread, ring: ar.ring
      });
      recipe.opts.wet = 0.16;
    } else {
      // P/B/R：标准甲响
      recipe.layers.T.push({
        type: 'armorClink', n: ar.n, f0: ar.f0, f1: ar.f1, peak: ar.peak,
        spread: ar.spread, ring: ar.ring
      });
    }
  }

  // 皮革摩擦（P/B/R 加一个通用皮革层）
  if (['P', 'B', 'R'].includes(p) && p !== 'C') {
    const lcParams = { P: { cf: 470, q: 2.1, peak: 0.075, dur: 0.13, grain: 3 },
                        B: { cf: 450, q: 2.0, peak: 0.080, dur: 0.15, grain: 3 },
                        R: { cf: 500, q: 1.9, peak: 0.090, dur: 0.14, grain: 4 } };
    const lp = (lcParams as Record<string, any>)[p];
    recipe.layers.C.push({
      type: 'leatherCreak', cf: lp.cf, q: lp.q, peak: lp.peak, dur: lp.dur, grain: lp.grain
    });
  }

  return recipe;
}

function buildM2(p: string): Recipe {
  const recipe: Recipe = { layers: { B: [], T: [], C: [] }, opts: {} };

  switch (p) {
    case 'P':
      recipe.layers.B.push({ type: 'footStep', lo: 118, tone: 880, q: 1.2, peak: 0.19, dur: 0.08 });
      recipe.layers.T.push({ type: 'armorClink', n: 3, f0: 2950, f1: 4100, peak: 0.15, spread: 0.062, ring: 0.22 });
      recipe.opts.wet = 0.10;
      break;
    case 'N':
      recipe.layers.B.push({ type: 'transient', freq: 1300, q: 1.8, peak: 0.21, dur: 0.018, offset: 0 });
      recipe.layers.B.push({ type: 'osc', oscType: 'sine', freq: 90, peak: 0.13, dur: 0.06, sweep: { end: 60, ramp: 'exp', rampTime: 0.04 }, offset: 0 });
      recipe.layers.B.push({ type: 'transient', freq: 1420, q: 1.8, peak: 0.17, dur: 0.018, offset: 0.095 });
      recipe.layers.B.push({ type: 'osc', oscType: 'sine', freq: 90, peak: 0.11, dur: 0.06, sweep: { end: 60, ramp: 'exp', rampTime: 0.04 }, offset: 0.095 });
      recipe.layers.B.push({ type: 'transient', freq: 1250, q: 1.8, peak: 0.20, dur: 0.018, offset: 0.175 });
      recipe.layers.B.push({ type: 'osc', oscType: 'sine', freq: 90, peak: 0.12, dur: 0.06, sweep: { end: 60, ramp: 'exp', rampTime: 0.04 }, offset: 0.175 });
      recipe.layers.C.push({ type: 'horseSnort', f: 420, peak: 0.05, dur: 0.18, probability: 0.30 });
      recipe.opts.wet = 0.12;
      break;
    case 'B':
      recipe.layers.C.push({ type: 'noise', rate: 1.0, peak: 0.20, attack: 0.025, decay: 0.27, dur: 0.30,
        filter: { type: 'bandpass', q: 0.9, sweep: { f0: 640, f1: 1900, f2: 780, ramp: 'arc', rampTime: 0.27 } } });
      recipe.layers.C.push({ type: 'clothRustle', cf: 2100, q: 1.3, peak: 0.07, dur: 0.24 });
      recipe.layers.T.push({ type: 'armorClink', n: 3, f0: 2700, f1: 3600, peak: 0.075, spread: 0.17, ring: 0.30 });
      recipe.opts.wet = 0.24;
      break;
    case 'A':
      recipe.layers.B.push({ type: 'warDrum', f0: 122, f1: 88, peak: 0.145, dur: 0.07, noSnap: true, pitScale: 0.97 });
      recipe.layers.C.push({ type: 'clothRustle', cf: 2650, q: 1.1, peak: 0.075, dur: 0.17, attack: 0.014 });
      recipe.layers.C.push({ type: 'chimeNote', freq: 2093, peak: 0.055, dur: 0.30, probability: 0.70 });
      recipe.opts.wet = 0.14;
      break;
    case 'R':
      recipe.layers.C.push({ type: 'noise', rate: 0.8, peak: 0.34, attack: 0.020, decay: 0.36, dur: 0.38,
        filter: { type: 'lowpass', sweep: { f0: 210, f1: 140, ramp: 'linear', rampTime: 0.36 }, q: 1.2 } });
      recipe.layers.T.push({ type: 'transient', freq: 1640, q: 1.4, peak: 0.11, dur: 0.016, offset: 0.000 });
      recipe.layers.T.push({ type: 'transient', freq: 1680, q: 1.4, peak: 0.11, dur: 0.016, offset: 0.075 });
      recipe.layers.T.push({ type: 'transient', freq: 1700, q: 1.4, peak: 0.11, dur: 0.016, offset: 0.160 });
      recipe.layers.T.push({ type: 'transient', freq: 1720, q: 1.4, peak: 0.11, dur: 0.016, offset: 0.252 });
      recipe.layers.C.push({ type: 'armorClink', n: 3, f0: 2500, f1: 3400, peak: 0.12, spread: 0.14, ring: 0.22, panAlternate: 0.15 });
      recipe.opts.wet = 0.14;
      break;
    case 'C':
      // 炮巡航：木车吱呀 + 木轮碾地 + 石弹微响（去低频 sawtooth 嗡鸣）
      recipe.layers.C.push({ type: 'leatherCreak', cf: 190, q: 1.8, peak: 0.10, dur: 0.30, grain: 3 });
      recipe.layers.B.push({ type: 'woodKnock', f: 130, peak: 0.13, dur: 0.06 });
      recipe.layers.B.push({ type: 'woodKnock', f: 122, peak: 0.09, dur: 0.05, offset: 0.15 });
      recipe.layers.C.push({ type: 'woodKnock', f: 620, peak: 0.07, dur: 0.04, offset: 0.06 });
      recipe.layers.C.push({ type: 'footStep', lo: 118, tone: 820, peak: 0.11, dur: 0.08, offset: 0.05 });
      recipe.layers.C.push({ type: 'footStep', lo: 118, tone: 820, peak: 0.11, dur: 0.08, offset: 0.17 });
      recipe.opts.wet = 0.18;
      break;
    case 'K':
      recipe.layers.B.push({ type: 'footStep', lo: 130, tone: 700, q: 1.0, peak: 0.28, dur: 0.11 });
      recipe.layers.T.push({ type: 'armorClink', n: 4, f0: 3400, f1: 5000, peak: 0.17, spread: 0.065, ring: 0.32 });
      recipe.opts.wet = 0.16;
      break;
  }

  return recipe;
}

function buildM3(p: string): Recipe {
  const brakeParams = {
    P: { f0: 880, f1: 400, q: 2.6, peak: 0.13, dur: 0.10 },
    N: { f0: 1100, f1: 460, q: 2.2, peak: 0.15, dur: 0.11 },
    B: { f0: 1400, f1: 620, q: 1.2, peak: 0.11, dur: 0.08 },
    A: { f0: 1300, f1: 700, q: 2.0, peak: 0.06, dur: 0.09, attack: 0.012 },
    R: { f0: 820, f1: 330, q: 2.8, peak: 0.20, dur: 0.13 },
    C: { f0: 700, f1: 300, q: 3.0, peak: 0.14, dur: 0.10 },
    K: { f0: 760, f1: 340, q: 2.4, peak: 0.12, dur: 0.10 }
  };
  const bp = (brakeParams as Record<string, any>)[p];
  const recipe: Recipe = { layers: { C: [] }, opts: {} };
  recipe.layers.C.push({
    type: 'dustScuff', f0: bp.f0, f1: bp.f1, q: bp.q, peak: bp.peak, dur: bp.dur,
    attack: bp.attack || 0.001
  });
  recipe.opts.wet = p === 'A' ? 0.12 : (p === 'K' ? 0.14 : 0.11);
  return recipe;
}

function buildM4(p: string): Recipe {
  const dr = DRUM_PRESETS.M4[p];
  const ar = ARMOR_LAND_PRESETS[p];
  const recipe: Recipe = { layers: { B: [], T: [], C: [], S: [] }, opts: {} };
  const wetVals = { P: 0.09, N: 0.10, B: 0.14, A: 0.11, R: 0.11, C: 0.11, K: 0.16 };

  // B 层：落位重击（炮=木石砸地，其余=战鼓）
  if (p === 'C') {
    // 炮·石弹砸地：木撞 + 木/石低频 + 石屑迸裂（不走战鼓皮膜）
    recipe.layers.B.push({ type: 'woodKnock', f: 300, peak: 0.18, dur: 0.05 });
    recipe.layers.B.push({ type: 'woodKnock', f: 118, peak: 0.16, dur: 0.09 });
    recipe.layers.C.push({ type: 'dustScuff', f0: 2400, f1: 520, q: 1.2, peak: 0.30, dur: 0.20 });
  } else {
    recipe.layers.B.push({
      type: 'warDrum', f0: dr.f0, f1: dr.f1, peak: dr.peak, dur: dr.dur,
      attack: dr.attack, noSnap: dr.noSnap || false
    });
  }

  // T 层：接触瞬态（除士外）
  if (p !== 'A') {
    const tParams = { P: { f: 3400, q: 1.8, pk: 0.12, d: 0.016 },
                       N: { f: 1180, q: 1.6, pk: 0.20, d: 0.020 },
                       B: { f: 3100, q: 1.8, pk: 0.16, d: 0.018 },
                       R: { f: 3000, q: 1.6, pk: 0.16, d: 0.018 },
                       C: { f: 3200, q: 2.0, pk: 0.10, d: 0.015 },
                       K: { f: 4000, q: 1.6, pk: 0.18, d: 0.016 } };
    if ((tParams as Record<string, any>)[p]) {
      recipe.layers.T.push({
        type: 'transient', freq: (tParams as Record<string, any>)[p].f, q: (tParams as Record<string, any>)[p].q,
        peak: (tParams as Record<string, any>)[p].pk, dur: (tParams as Record<string, any>)[p].d
      });
    }
  }

  // T/C 层：落位装甲簇
  recipe.layers.T.push({
    type: 'armorClink', n: ar.n, f0: ar.f0, f1: ar.f1, peak: ar.peak,
    spread: ar.spread, ring: ar.ring, softAttack: ar.softAttack || 0
  });

  // K 特殊：编钟尾韵
  if (p === 'K') {
    recipe.layers.S.push({
      type: 'tail', offset: 0.04,
      children: [
        { type: 'bronzeBody', freq: 660, peak: 0.20, decayScale: 1.35, partials: 'BELL', vibHz: 0 },
        { type: 'transient', freq: 4000, q: 1.6, peak: 0.09, dur: 0.012 }
      ]
    });
  }

  // A 特殊：剑鞘触地
  if (p === 'A') {
    recipe.layers.T.push({
      type: 'transient', freq: 3100, q: 2.4, peak: 0.07, dur: 0.022
    });
  }

  recipe.opts.wet = (wetVals as Record<string, number>)[p];
  if (p === 'K') recipe.opts.wet = 0.19; // 帅含钟尾韵，送更多湿

  return recipe;
}

function buildM5(p: string): Recipe {
  const af = ARMOR_FALL_PRESETS[p];
  const recipe: Recipe = { layers: { T: [], C: [] }, opts: { wet: 0.18 } };

  recipe.layers.T.push({
    type: 'armorClink', n: af.n, f0: af.f0, f1: af.f1, peak: af.peak,
    spread: af.spread, ring: af.ring, softAttack: af.softAttack || 0
  });

  if (p === 'B') {
    recipe.layers.C.push({
      type: 'clothRustle', cf: 1900, q: 1.2, peak: 0.03, dur: 0.20
    });
  } else if (p === 'A') {
    recipe.layers.C.push({
      type: 'clothRustle', cf: 2200, q: 1.2, peak: 0.03, dur: 0.18
    });
  } else if (p === 'C') {
    recipe.layers.C.push({
      type: 'noise', rate: 1.0, peak: 0.08, attack: 0.020, decay: 0.15, dur: 0.17,
      filter: { type: 'bandpass', freq: 300, q: 6.0 }
    });
  }

  if (p === 'K') recipe.opts.wet = 0.22;
  if (p === 'B') recipe.opts.wet = 0.22;

  return recipe;
}

// 生成全部移动配方
makeMoveRecipes();

/* ----- 9.3 各兵种吃子配方（A0-A5） ----- */

function makeCaptureRecipes() {
  // 含 'C'：炮虽走 stoneImpact 特殊路径，但被吃/收势仍需要 victim.shake 与 settle 配方
  for (const p of ['P', 'N', 'B', 'A', 'R', 'C', 'K']) {
    const pk = `${PIECE_NAMES[p]}.capture`;

    /* A0 冲锋到达 */
    BEAT_RECIPES[`${pk}.approach`] = buildA0(p);
    /* A1 蓄势 */
    BEAT_RECIPES[`${pk}.windup`] = buildA1(p);
    /* A2 斩击命中（核心拍） */
    BEAT_RECIPES[`${pk}.clash`] = buildA2(p);
    /* A3 定格 — 由 hitFreeze 处理，不产生新音频 */
    /* A4 受害者崩塌 */
    BEAT_RECIPES[`${pk}.victim.shake`] = buildA4(p);
    /* A5 收势占格 */
    BEAT_RECIPES[`${pk}.settle`] = buildA5(p);
  }

  // 炮·石弹碎裂（特殊路径）
  BEAT_RECIPES['cannon.capture.stoneImpact'] = {
    layers: {
      T: [
        { type: 'woodKnock', f: 520, peak: 0.24, dur: 0.06 }
      ],
      C: [
        { type: 'dustScuff', f0: 2600, f1: 700, q: 1.2, peak: 0.30, dur: 0.20 }
      ],
      T2: [
        { type: 'armorClink', n: 7, f0: 1600, f1: 4200, peak: 0.13, spread: 0.30, ring: 0.14 }
      ]
    },
    opts: { wet: 0.14, life: 1.6 }
  };

  // 炮·装填（C1：抬石弹上抛兜 + 绞盘收紧）—— 纯木石，无金属/火药
  BEAT_RECIPES['cannon.capture.load'] = {
    layers: {
      C: [
        { type: 'leatherCreak', cf: 172, q: 1.9, peak: 0.16, dur: 0.22, grain: 4 },
        { type: 'woodKnock', f: 520, peak: 0.13, dur: 0.05, offset: 0.04 }
      ],
      B: [
        { type: 'woodKnock', f: 138, peak: 0.15, dur: 0.07 },
        { type: 'woodKnock', f: 118, peak: 0.10, dur: 0.06, offset: 0.10 }
      ]
    },
    opts: { wet: 0.16, life: 0.9 }
  };

  // 炮·瞄准（C1：抛臂后拉 + 抛石破空 低频呼啸下行）—— 纯木石
  BEAT_RECIPES['cannon.capture.aim'] = {
    layers: {
      C: [
        { type: 'whoosh', f0: 480, f1: 190, q: 1.1, peak: 0.22, dur: 0.30 },
        { type: 'leatherCreak', cf: 190, q: 1.8, peak: 0.11, dur: 0.26, grain: 3 }
      ],
      B: [
        { type: 'osc', oscType: 'sine', freq: 84, peak: 0.14, attack: 0.05, decay: 0.22, dur: 0.28,
          sweep: { end: 52, ramp: 'exp', rampTime: 0.24 } }
      ]
    },
    opts: { wet: 0.18, life: 1.0 }
  };

  // 炮·后坐（C1：抛臂复位 + 木架后坐）—— 纯木石
  BEAT_RECIPES['cannon.capture.recoil'] = {
    layers: {
      C: [
        { type: 'woodKnock', f: 460, peak: 0.12, dur: 0.05 },
        { type: 'dustScuff', f0: 2200, f1: 600, q: 1.3, peak: 0.18, dur: 0.22 }
      ],
      B: [
        { type: 'woodKnock', f: 96, peak: 0.16, dur: 0.10 }
      ]
    },
    opts: { wet: 0.14, life: 0.9 }
  };
}

function buildA0(p: string): Recipe {
  const w = WEAPON_PARAMS[p];
  if (!w || !w.whoosh) return { layers: {}, opts: {} };
  const recipe: Recipe = {
    layers: {
      C: [{
        type: 'whoosh', f0: w.whoosh.f0, f1: w.whoosh.f1,
        q: 1.0, peak: 0.24, dur: 0.37
      }]
    },
    opts: { wet: 0.22 }
  };
  // 车·双马前冲低频（设计 §1.5 进攻：双马前冲低频）
  if (p === 'R') {
    recipe.layers.B = [{
      type: 'osc', oscType: 'sine', freq: 90, peak: 0.16,
      attack: 0.02, decay: 0.20, dur: 0.24,
      sweep: { end: 58, ramp: 'exp', rampTime: 0.18 }
    }];
  }
  // 象·宽袖横扫下扫（设计 §1.3 进攻：宽袖布帛扫风；whoosh 1200→480 已为下扫）
  if (p === 'B') {
    recipe.layers.C.push({
      type: 'clothRustle', cf: 1600, q: 1.2, peak: 0.10, dur: 0.34, attack: 0.03
    });
  }
  return recipe;
}

function buildA1(p: string): Recipe {
  const w = WEAPON_PARAMS[p];
  if (!w || w.isStone) return { layers: {}, opts: {} };
  return {
    layers: {
      C: [{
        type: 'whoosh', f0: w.base * 0.7, f1: w.base * 2.8,
        q: 1.2, peak: 0.18, dur: 0.235
      }],
      T: [{
        type: 'armorClink', n: ARMOR_PRESETS[p].n,
        f0: ARMOR_PRESETS[p].f0, f1: ARMOR_PRESETS[p].f1,
        peak: ARMOR_PRESETS[p].peak * 0.6,
        spread: ARMOR_PRESETS[p].spread * 1.2,
        ring: ARMOR_PRESETS[p].ring * 0.7
      }]
    },
    opts: { wet: 0.18 }
  };
}

function buildA2(p: string): Recipe {
  const w = WEAPON_PARAMS[p];
  if (!w || w.isStone) return { layers: {}, opts: {} };
  const th = THUD_PARAMS[p];
  const recipe: Recipe = { layers: { T: [], C: [], B: [] }, opts: { wet: 0.16 } };

  // A2 clash: 兵器交击 — 金属层
  recipe.layers.C.push({
    type: 'bladeClash', base: w.base, peak: w.base > 600 ? 0.38 : 0.34,
    dur: 0.16, grind: w.grind, partials: w.partials
  });

  if (w.extraBell) {
    recipe.layers.C.push({
      type: 'bronzeBody', freq: w.base * 0.7, peak: 0.15,
      decayScale: 0.8, partials: 'BELL', vibHz: 0, offset: 0.01
    });
  }

  // A5 thud: 闷击 — 身体层
  recipe.layers.B.push({
    type: 'osc', oscType: 'sine', freq: th.f0, peak: th.peak,
    attack: 0.004, decay: th.dur, dur: th.dur + 0.05,
    sweep: { end: th.f1, ramp: 'exp', rampTime: th.dur * 0.55 },
    busTarget: 'hitBus'  // 走 hitBus，不受 hitFreeze 影响
  });

  // 腰折破空
  recipe.layers.T.push({
    type: 'transient', freq: w.base * 4.2, q: 1.4,
    peak: 0.24, dur: 0.022, busTarget: 'hitBus'
  });

  return recipe;
}

function buildA4(p: string): Recipe {
  const w = VICTIM_WEIGHTS[p];
  const vc = VICTIM_COLLAPSE[w || 'light'];
  return {
    layers: {
      C: [
        { type: 'armorClink', n: 6, f0: 2900, f1: 5200, peak: 0.11, spread: 0.16, ring: 0.20, forceHP: 2200 },
        { type: 'dustScuff', f0: 600, f1: 240, q: 1.6, peak: vc.peak * 0.36, dur: 0.22 }
      ],
      B: [
        { type: 'osc', oscType: 'sine', freq: vc.f0, peak: vc.peak,
          attack: 0.006, decay: vc.dur, dur: vc.dur + 0.05,
          sweep: { end: vc.f1, ramp: 'exp', rampTime: vc.dur * 0.55 },
          filter: { type: 'lowpass', freq: 220, q: 0.7 } },
        { type: 'armorClink', n: 4, f0: 2500, f1: 3900, peak: vc.peak * 0.48, spread: 0.22, ring: 0.14 }
      ]
    },
    opts: { wet: 0.18 }
  };
}

function buildA5(p: string): Recipe {
  const th = THUD_PARAMS[p];
  const recipe: Recipe = { layers: { B: [], T: [] }, opts: { wet: 0.12 } };

  recipe.layers.B.push({
    type: 'osc', oscType: 'sine', freq: th.f0, peak: th.peak * 0.55,
    attack: 0.004, decay: th.dur * 0.7, dur: th.dur * 0.7 + 0.05,
    sweep: { end: th.f1, ramp: 'exp', rampTime: th.dur * 0.4 }
  });

  recipe.layers.T.push({
    type: 'armorClink', n: ARMOR_PRESETS[p].n + 1,
    f0: ARMOR_PRESETS[p].f0, f1: ARMOR_PRESETS[p].f1,
    peak: ARMOR_PRESETS[p].peak * 0.7,
    spread: ARMOR_PRESETS[p].spread * 1.3, ring: ARMOR_PRESETS[p].ring * 0.6
  });

  return recipe;
}

// 生成全部吃子配方
makeCaptureRecipes();

/* ----- 9.4 待机音配方（idle） ----- */

BEAT_RECIPES['pawn.idle'] = {
  layers: {
    C: [{ type: 'noise', rate: 1.0, peak: 0.014, attack: 0.02, decay: 0.34, dur: 0.40,
          filter: { type: 'bandpass', freq: 1800, q: 1.4 } }],
    B: [{ type: 'osc', oscType: 'sine', freq: 130, peak: 0.0084, attack: 0.04, decay: 0.35, dur: 0.40,
          sweep: { end: 110, ramp: 'exp', rampTime: 0.35 } }]
  },
  opts: { wet: 0.22, life: 0.7 }
};

BEAT_RECIPES['horse.idle'] = {
  layers: {
    C: [
      { type: 'osc', oscType: 'sine', freq: 150, peak: 0.021, attack: 0.03, decay: 0.30, dur: 0.34,
        sweep: { end: 192, ramp: 'linear', rampTime: 0.12, sweep2: { end: 140, ramp: 'linear', rampTime: 0.18 } } },
      { type: 'noise', rate: 0.9, peak: 0.0123, attack: 0.01, decay: 0.10, dur: 0.12, offset: 0.02,
        filter: { type: 'bandpass', freq: 700, q: 1.2 } }
    ]
  },
  opts: { wet: 0.20, life: 0.8 }
};

BEAT_RECIPES['elephant.idle'] = {
  layers: {
    B: [{ type: 'osc', oscType: 'sine', freq: 60, peak: 0.0202, attack: 0.06, decay: 0.44, dur: 0.50,
          sweep: { end: 72, ramp: 'linear', rampTime: 0.20, sweep2: { end: 54, ramp: 'linear', rampTime: 0.25 } } }]
  },
  opts: { wet: 0.28, life: 1.0 }
};

BEAT_RECIPES['advisor.idle'] = {
  layers: {
    C: [{ type: 'noise', rate: 1.0, peak: 0.0156, attack: 0.03, decay: 0.30, dur: 0.36,
          filter: { type: 'bandpass', freq: 2600, q: 1.0 } }]
  },
  opts: { wet: 0.26, life: 0.7 }
};

BEAT_RECIPES['rook.idle'] = {
  // 车：木轮辚辚 + 皮革吱呀 + 甲片轻响（去低频 sawtooth 嗡鸣）
  layers: {
    C: [
      { type: 'leatherCreak', cf: 210, q: 1.6, peak: 0.010, dur: 0.30, grain: 4 },
      { type: 'armorClink', n: 3, f0: 2400, f1: 3400, peak: 0.045, spread: 0.10, ring: 0.18 }
    ],
    B: [
      { type: 'woodKnock', f: 150, peak: 0.010, dur: 0.05 },
      { type: 'woodKnock', f: 138, peak: 0.007, dur: 0.05, offset: 0.15 }
    ]
  },
  opts: { wet: 0.24, life: 0.8 }
};

BEAT_RECIPES['cannon.idle'] = {
  // 炮：木车吱呀 + 石弹微响（去低频 sawtooth 嗡鸣）
  layers: {
    C: [
      { type: 'leatherCreak', cf: 172, q: 1.9, peak: 0.010, dur: 0.34, grain: 3 },
      { type: 'woodKnock', f: 620, peak: 0.008, dur: 0.04, offset: 0.06 }
    ],
    B: [
      { type: 'woodKnock', f: 120, peak: 0.010, dur: 0.055 }
    ]
  },
  opts: { wet: 0.26, life: 0.8 }
};

BEAT_RECIPES['king.idle'] = {
  layers: {
    C: [{ type: 'bronzeBody', freq: 330, peak: 0.017, decayScale: 1.0, partials: 'BELL', vibHz: 0 }],
    B: [{ type: 'osc', oscType: 'sine', freq: 98, peak: 0.0136, attack: 0.08, decay: 0.45, dur: 0.50 }]
  },
  opts: { wet: 0.30, life: 1.2 }
};

/* 点名（roster）—— 极轻、公共 */
BEAT_RECIPES['roster.idle'] = {
  layers: {
    C: [{ type: 'noise', rate: 1.0, peak: 0.016, attack: 0.015, decay: 0.22, dur: 0.25,
          filter: { type: 'bandpass', freq: 1400, q: 1.1 } }]
  },
  opts: { wet: 0.34, life: 0.6 }
};

/* 元帅心跳（将军时） */
BEAT_RECIPES['king.heartbeat'] = {
  layers: {
    B: [{ type: 'warDrum', f0: 66, f1: 42, peak: 0.050, dur: 0.28, noSnap: true }]
  },
  opts: { wet: 0.26, life: 0.7 }
};

/* --------------------------------------------------------------------------
 * 9.5 采样叠加层（design §1 Foley/Vocal 分层 · §4.2 采样优先 / 程序化回退）
 *
 *  分工严格照设计稿 §1.0 通用分层约定：
 *    · Foley（脚步/马蹄/车轮/甲片/布帛/破空/木石）→ 采样接管，采样未到位时
 *      回退到原程序化积木（swapFoley：原指令降级为 fallback，绝不双响）。
 *    · Vocal（号子/嘶吼/马嘶/呼吸）→ 纯采样叠加（addVox），无采样则静默跳过，
 *      绝不用合成器假冒人声 —— 电子音破功的主因就在这里。
 *    · Body/Transient（warDrum / thud / transient）→ 保持程序化。战鼓与青铜鸣
 *      是设计稿 §0.3 钦定的「声音图腾」，音高按兵种精调过，不能被采样抹平。
 *      A2 交击处采样只作「材质接触垫层」叠加，同时把程序化峰值让出一档。
 *
 *  采样经济：9 条人声覆盖 7 兵种 × 多拍位，靠 rate（音高）+ gain（分量）+
 *  阵营偏移（红 ×1.06 / 黑 ×0.94，由 executeInst 自动施加）拉开辨识度。
 * ------------------------------------------------------------------------ */

/** 在指定拍位的某层里，把首个匹配 type 的程序化指令换成采样指令（原指令转为 fallback） */
function swapFoley(beat: string, layer: string, type: string, key: string, opts: any = {}): void {
  const r = BEAT_RECIPES[beat];
  if (!r || !r.layers || !r.layers[layer]) return;
  const arr = r.layers[layer] as any[];
  const idx = arr.findIndex(x => x && x.type === type && !x._sampled);
  if (idx < 0) return;
  const orig = arr[idx];
  arr[idx] = {
    type: 'sample', key, _sampled: true,
    offset: orig.offset || 0,
    gain: opts.gain != null ? opts.gain : 0.6,
    ...opts,
    fallback: orig
  };
}

/** 把某层里所有匹配 type 的指令标记为「采样到位则让位」（用于多指令合成一个物理事件） */
function yieldToSample(beat: string, layer: string, type: string, key: string): void {
  const r = BEAT_RECIPES[beat];
  if (!r || !r.layers || !r.layers[layer]) return;
  for (const inst of r.layers[layer] as any[]) {
    if (inst && inst.type === type && !inst._sampled) inst.muteIfSample = key;
  }
}

/** 追加纯采样指令（Vocal 层 / 材质垫层）。层不存在则创建 */
function addSample(beat: string, layer: string, key: string, opts: any = {}): void {
  const r = BEAT_RECIPES[beat];
  if (!r) return;
  if (!r.layers) r.layers = {};
  if (!r.layers[layer]) r.layers[layer] = [];
  (r.layers[layer] as any[]).push({ type: 'sample', key, _sampled: true, gain: 0.5, ...opts });
}

/** 缩放某层里匹配 type 的程序化峰值（为叠加的采样垫层让出电平余量） */
function trimPeak(beat: string, layer: string, type: string, mul: number): void {
  const r = BEAT_RECIPES[beat];
  if (!r || !r.layers || !r.layers[layer]) return;
  for (const inst of r.layers[layer] as any[]) {
    if (inst && inst.type === type && inst.peak != null) inst.peak *= mul;
  }
}

function applySampleOverlay(): void {
  /* ===== 每兵种的采样选型（材质 → 采样 key + 音高/分量）===== */
  const STEP: Record<string, { key: string; gain: number; rate: number }> = {
    P: { key: 'foley.step.light', gain: 0.62, rate: 1.00 },
    N: { key: 'foley.hoof',       gain: 0.66, rate: 1.00 },
    B: { key: 'foley.step.heavy', gain: 0.58, rate: 0.90 },  // 象足：更沉
    A: { key: 'foley.step.light', gain: 0.40, rate: 1.10 },  // 仕：全场最静
    R: { key: 'foley.wheel',      gain: 0.70, rate: 0.94 },
    C: { key: 'foley.wheel',      gain: 0.52, rate: 0.86 },  // 砲车：更钝更慢
    K: { key: 'foley.step.heavy', gain: 0.64, rate: 1.00 }
  };
  const CLASH: Record<string, { key: string; gain: number; rate: number }> = {
    P: { key: 'foley.clash.bronze', gain: 0.46, rate: 1.00 },  // 戈 BAR
    N: { key: 'foley.clash.blade',  gain: 0.44, rate: 0.94 },  // 戟
    B: { key: 'foley.clash.bronze', gain: 0.42, rate: 0.80 },  // 钺 BELL：低沉
    A: { key: 'foley.clash.blade',  gain: 0.40, rate: 1.14 },  // 短剑：最亮
    R: { key: 'foley.clash.iron',   gain: 0.48, rate: 0.90 },  // 铁箍：最暗
    K: { key: 'foley.clash.bronze', gain: 0.50, rate: 0.88 }   // 王剑 + 钟
  };
  const WHOOSH: Record<string, { key: string; gain: number; rate: number }> = {
    P: { key: 'foley.whoosh.light', gain: 0.52, rate: 1.00 },
    N: { key: 'foley.whoosh.light', gain: 0.54, rate: 0.94 },
    B: { key: 'foley.whoosh.heavy', gain: 0.50, rate: 0.86 },
    A: { key: 'foley.whoosh.light', gain: 0.44, rate: 1.16 },
    R: { key: 'foley.whoosh.heavy', gain: 0.56, rate: 0.92 },
    C: { key: 'foley.whoosh.heavy', gain: 0.50, rate: 0.74 },  // 抛石：钝木石低啸
    K: { key: 'foley.whoosh.heavy', gain: 0.54, rate: 0.96 }
  };
  /** 甲片分量（design §1.4：仕最静；§1.6：炮无金属 → 不接甲片采样） */
  const ARMOR_GAIN: Record<string, number> = { P: 0.46, N: 0.50, B: 0.38, A: 0.26, R: 0.58, K: 0.56 };
  /** 落位重量（重量级越高越明显） */
  const LAND_GAIN: Record<string, number> = { B: 0.40, R: 0.52, K: 0.50 };

  for (const p of ALL_PIECES) {
    const pk = PIECE_NAMES[p]!;
    const mv = `${pk}.move`;
    const cp = `${pk}.capture`;
    const ag = ARMOR_GAIN[p];

    /* ---------- 移动 M1 起步 ---------- */
    if (ag != null) swapFoley(`${mv}.launch`, 'T', 'armorClink', 'foley.armor', { gain: ag, rate: 1.0 });
    swapFoley(`${mv}.launch`, 'C', 'clothRustle', 'foley.cloth', { gain: p === 'A' ? 0.30 : 0.38, rate: p === 'A' ? 1.12 : 0.96 });

    /* ---------- 移动 M2 巡航（脚步/马蹄/车轮 —— 「是什么在动」的核心）------- */
    const st = STEP[p]!;
    switch (p) {
      case 'P':
        swapFoley(`${mv}.cruise`, 'B', 'footStep', st.key, { gain: st.gain, rate: st.rate });
        swapFoley(`${mv}.cruise`, 'T', 'armorClink', 'foley.armor', { gain: 0.34 });
        break;
      case 'N':
        // 马蹄三连拍：采样单条整体接管，6 条程序化指令集体让位
        swapFoley(`${mv}.cruise`, 'B', 'transient', st.key, { gain: st.gain, rate: st.rate });
        yieldToSample(`${mv}.cruise`, 'B', 'transient', st.key);
        yieldToSample(`${mv}.cruise`, 'B', 'osc', st.key);
        swapFoley(`${mv}.cruise`, 'C', 'horseSnort', 'vox.horse.snort', { gain: 0.34, probability: 0.30 });
        break;
      case 'B':
        swapFoley(`${mv}.cruise`, 'C', 'noise', 'foley.cloth', { gain: 0.52, rate: 0.88 });
        yieldToSample(`${mv}.cruise`, 'C', 'clothRustle', 'foley.cloth');
        addSample(`${mv}.cruise`, 'B', st.key, { gain: st.gain * 0.8, rate: st.rate });
        swapFoley(`${mv}.cruise`, 'T', 'armorClink', 'foley.armor', { gain: 0.30 });
        break;
      case 'A':
        swapFoley(`${mv}.cruise`, 'C', 'clothRustle', 'foley.cloth', { gain: 0.34, rate: 1.14 });
        addSample(`${mv}.cruise`, 'B', st.key, { gain: st.gain, rate: st.rate });
        break;
      case 'R':
        // 木轮碾地：采样接管碾压噪声，4 条辚辚 transient 让位（采样自带辚辚）
        swapFoley(`${mv}.cruise`, 'C', 'noise', st.key, { gain: st.gain, rate: st.rate });
        yieldToSample(`${mv}.cruise`, 'T', 'transient', st.key);
        swapFoley(`${mv}.cruise`, 'C', 'armorClink', 'foley.armor', { gain: 0.44 });
        break;
      case 'C':
        // 炮：木车吱呀 + 木轮（严守 §1.6 红线，无金属采样）
        swapFoley(`${mv}.cruise`, 'C', 'leatherCreak', 'foley.wood.creak', { gain: 0.50, rate: 1.0 });
        swapFoley(`${mv}.cruise`, 'C', 'footStep', st.key, { gain: st.gain, rate: st.rate });
        yieldToSample(`${mv}.cruise`, 'C', 'footStep', st.key);
        break;
      case 'K':
        swapFoley(`${mv}.cruise`, 'B', 'footStep', st.key, { gain: st.gain, rate: st.rate });
        swapFoley(`${mv}.cruise`, 'T', 'armorClink', 'foley.armor', { gain: 0.42 });
        break;
    }

    /* ---------- 移动 M4 落位（最重拍：战鼓保持程序化，甲片+重量走采样）----- */
    if (ag != null) swapFoley(`${mv}.land`, 'T', 'armorClink', 'foley.armor', { gain: ag * 1.15 });
    if (LAND_GAIN[p] != null) addSample(`${mv}.land`, 'B', 'foley.land.heavy', { gain: LAND_GAIN[p]!, rate: p === 'B' ? 0.88 : 1.0 });

    /* ---------- 移动 M5 收势 ---------- */
    if (ag != null) swapFoley(`${mv}.settle`, 'T', 'armorClink', 'foley.armor', { gain: ag * 0.55, rate: 1.06 });
    swapFoley(`${mv}.settle`, 'C', 'clothRustle', 'foley.cloth', { gain: 0.22, rate: 1.0 });

    /* ---------- 进攻 A0 冲锋 / A1 蓄势（破空）---------- */
    const wh = WHOOSH[p]!;
    swapFoley(`${cp}.approach`, 'C', 'whoosh', wh.key, { gain: wh.gain, rate: wh.rate });
    swapFoley(`${cp}.windup`, 'C', 'whoosh', wh.key, { gain: wh.gain * 0.82, rate: wh.rate * 1.06 });
    if (ag != null) swapFoley(`${cp}.windup`, 'T', 'armorClink', 'foley.armor', { gain: ag * 0.6 });
    if (p === 'B') swapFoley(`${cp}.approach`, 'C', 'clothRustle', 'foley.cloth', { gain: 0.46, rate: 0.84 });

    /* ---------- 进攻 A2 交击（图腾保程序化，采样作材质接触垫层）---------- */
    const cl = CLASH[p];
    if (cl) {
      trimPeak(`${cp}.clash`, 'C', 'bladeClash', 0.72);
      addSample(`${cp}.clash`, 'T', cl.key, { gain: cl.gain, rate: cl.rate, busTarget: 'hitBus' });
    }

    /* ---------- 进攻 A4 受害者崩塌（甲片 + 身体闷击）---------- */
    swapFoley(`${cp}.victim.shake`, 'C', 'armorClink', 'foley.armor', { gain: 0.42, rate: 1.04 });
    const vw = VICTIM_WEIGHTS[p] === 'heavy' ? 'foley.thud.heavy'
             : (VICTIM_WEIGHTS[p] === 'medium' ? 'foley.thud.heavy' : 'foley.thud.light');
    addSample(`${cp}.victim.shake`, 'B', vw, {
      gain: VICTIM_WEIGHTS[p] === 'light' ? 0.44 : 0.54,
      rate: VICTIM_WEIGHTS[p] === 'medium' ? 1.10 : 1.0
    });

    /* ---------- 进攻 A5 收势 ---------- */
    if (ag != null) swapFoley(`${cp}.settle`, 'T', 'armorClink', 'foley.armor', { gain: ag * 0.5, rate: 1.04 });
  }

  /* ===== Vocal 层：纯采样，无采样则静默（design §1 各兵种 Vocal 列）===== */

  // 移动 M1：号子 / 策马 / 御者「驾！」/ 砲兵「起！」
  addSample('pawn.move.launch',   'C', 'vox.shout.heave',  { gain: 0.44, rate: 1.00, offset: 0.03, probability: 0.75 });
  addSample('horse.move.launch',  'C', 'vox.shout.drive',  { gain: 0.34, rate: 1.10, offset: 0.02, probability: 0.65 });
  addSample('rook.move.launch',   'C', 'vox.shout.drive',  { gain: 0.50, rate: 0.92, offset: 0.02 });
  addSample('cannon.move.launch', 'C', 'vox.shout.heave',  { gain: 0.42, rate: 0.90, offset: 0.03 });

  // 进攻 A0：冲锋嘶吼 / 冲锋马嘶
  addSample('pawn.capture.approach',  'C', 'vox.shout.charge', { gain: 0.50, rate: 1.00 });
  addSample('horse.capture.approach', 'C', 'vox.horse.neigh',  { gain: 0.52, rate: 1.00 });
  addSample('rook.capture.approach',  'C', 'vox.horse.neigh',  { gain: 0.40, rate: 0.92, offset: 0.05 }); // 双马齐嘶

  // 进攻 A2：命中瞬间的吼喝（走 hitBus，不受 hitFreeze 低通压制）
  addSample('pawn.capture.clash',     'C', 'vox.shout.kill', { gain: 0.56, rate: 1.00, busTarget: 'hitBus' });
  addSample('horse.capture.clash',    'C', 'vox.shout.kill', { gain: 0.48, rate: 1.06, busTarget: 'hitBus' });
  addSample('elephant.capture.clash', 'C', 'vox.shout.kill', { gain: 0.50, rate: 0.86, busTarget: 'hitBus' }); // 沉声「斩！」
  addSample('advisor.capture.clash',  'C', 'vox.shout.kill', { gain: 0.34, rate: 1.14, busTarget: 'hitBus' }); // 冷喝
  addSample('rook.capture.clash',     'C', 'vox.shout.drive',{ gain: 0.44, rate: 0.88, busTarget: 'hitBus' }); // 御者吼
  addSample('king.capture.clash',     'C', 'vox.king.roar',  { gain: 0.60, rate: 1.00, busTarget: 'hitBus' });

  /* ===== 炮：纯木石特殊路径（design §1.6 红线：无金属、无火药）===== */
  swapFoley('cannon.capture.load', 'C', 'leatherCreak', 'foley.wood.creak', { gain: 0.54, rate: 1.04 });
  swapFoley('cannon.capture.aim',  'C', 'leatherCreak', 'foley.wood.creak', { gain: 0.44, rate: 0.92 });
  swapFoley('cannon.capture.aim',  'C', 'whoosh', 'foley.whoosh.heavy', { gain: 0.50, rate: 0.74 });
  // 砲兵齐声「放！」—— 发射瞬间（aim 拍 @T−0.235 + 0.09 ≈ T−0.145）
  addSample('cannon.capture.aim',  'C', 'vox.shout.fire', { gain: 0.54, rate: 1.00, offset: 0.09 });
  // 石弹落地碎裂：采样接管碎裂主体，7 片碎石 transient 让位（采样自带飞散）
  swapFoley('cannon.capture.stoneImpact', 'C', 'dustScuff', 'foley.stone.crush', { gain: 0.72, rate: 1.0, busTarget: 'hitBus' });
  yieldToSample('cannon.capture.stoneImpact', 'T2', 'armorClink', 'foley.stone.crush');
  swapFoley('cannon.capture.recoil', 'C', 'dustScuff', 'foley.wood.creak', { gain: 0.34, rate: 1.18 });

  /* ===== 待机：呼吸 / 响鼻（拟真突破关键，全程低分量、概率触发）===== */
  addSample('pawn.idle',     'C', 'vox.breath',      { gain: 0.20, rate: 1.06, probability: 0.42 });
  addSample('advisor.idle',  'C', 'vox.breath',      { gain: 0.15, rate: 1.14, probability: 0.34 });
  addSample('king.idle',     'C', 'vox.breath',      { gain: 0.22, rate: 0.88, probability: 0.46 });
  addSample('elephant.idle', 'C', 'vox.breath',      { gain: 0.16, rate: 0.84, probability: 0.32 }); // 吟诵气声
  addSample('rook.idle',     'C', 'vox.breath',      { gain: 0.15, rate: 0.94, probability: 0.28 }); // 御者勒缰气声
  addSample('horse.idle',    'C', 'vox.horse.snort', { gain: 0.30, rate: 1.00, probability: 0.34 });
  addSample('cannon.idle',   'C', 'foley.wood.creak',{ gain: 0.26, rate: 0.96, probability: 0.40 });
}

/** 把某拍某层里已挂载的指定 sample 指令的 key 替换为 Sprint1 专属真实录音键。
 *  用于"接管"applySampleOverlay 已用通用键（vox.breath / foley.step.light /
 *  vox.king.roar / vox.shout.kill）挂载的采样，避免 addSample 追加造成双响。 */
function overrideSample(beat: string, layer: string, fromKey: string, toKey: string, opts: any = {}): void {
  const r = BEAT_RECIPES[beat];
  if (!r || !r.layers || !r.layers[layer]) return;
  for (const inst of r.layers[layer] as any[]) {
    if (inst && inst.type === 'sample' && inst.key === fromKey) {
      inst.key = toKey;
      Object.assign(inst, opts);
    }
  }
}

/** Sprint1 真实录音接管（K/P/A 九事件 · Kenney.nl CC0 整包）：
 *  优先采样，缺失（解码失败/未加载）时由 sfx.ts 回退原程序化/通用采样，零回归。
 *  仅覆盖 K/P/A；其余兵种保持 applySampleOverlay 既有路由不变。 */
function applySprint1RealSamples(): void {
  // ---- 将/帅 K ----
  overrideSample('king.idle',          'C', 'vox.breath',      'vox.king.idle',     { gain: 0.34, rate: 0.94, probability: 0.55 });
  swapFoley('king.move.launch',        'C', 'clothRustle',     'foley.king.move',   { gain: 0.40, rate: 1.0 });
  overrideSample('king.capture.clash', 'C', 'vox.king.roar',   'vox.king.capture',  { gain: 0.60, rate: 1.0, busTarget: 'hitBus' });

  // ---- 兵/卒 P ----
  overrideSample('pawn.idle',          'C', 'vox.breath',      'foley.pawn.idle',   { gain: 0.30, rate: 1.0 });
  overrideSample('pawn.move.cruise',   'B', 'foley.step.light', 'foley.pawn.move',   { gain: 0.55, rate: 1.0 });
  trimPeak('pawn.capture.clash',       'C', 'bladeClash',      0.72);
  addSample('pawn.capture.clash',      'T', 'foley.pawn.capture', { gain: 0.46, rate: 1.0, busTarget: 'hitBus' });

  // ---- 士/仕 A ----
  overrideSample('advisor.idle',       'C', 'vox.breath',      'foley.advisor.idle',{ gain: 0.28, rate: 1.0 });
  overrideSample('advisor.move.cruise','B', 'foley.step.light', 'foley.advisor.move',{ gain: 0.40, rate: 1.10 });
  overrideSample('advisor.capture.clash','C','vox.shout.kill',  'vox.advisor.capture',{ gain: 0.40, rate: 1.06, busTarget: 'hitBus' });
}

applySampleOverlay();
applySprint1RealSamples();
applySprint2RealSamples();

/** Sprint2 真实录音接管（R/C 六事件 · Kenney.nl CC0 整包）：
 *  复用 applySampleOverlay 已用通用键（vox.breath / foley.wheel / foley.wood.creak /
 *  foley.stone.crush）挂载的采样点，通过 overrideSample / swapFoley 替换为 Sprint2 专属
 *  真实录音键，避免 addSample 追加造成双响（与 Sprint1 applySprint1RealSamples 同构）。
 *  缺失（解码失败/未加载）时由 sfx.ts 回退原程序化/通用采样，零回归。
 *
 *  落地状态：本环境无法联网取 Kenney 源、无本地 ogg、无离线转码工具，故
 *  foley.rook.* / foley.cannon.* 的 wav 暂未落盘（详见 sampleBank.ts 头部注释与
 *  design/audio/sprint1-real-sfx-integration.md §0）。MANIFEST 键已就位；待 Kenney
 *  源到位即自动接管，无需再改本函数。 */
function applySprint2RealSamples(): void {
  // ---- 车 R ----
  // R idle：轮轴吱呀/木轴摩擦 —— 接管 applySampleOverlay 挂在 rook.idle 的 vox.breath
  overrideSample('rook.idle', 'C', 'vox.breath', 'foley.rook.idle',
    { gain: 0.34, rate: 0.94, probability: 0.42 });
  // R move：双轮滚动+马蹄 —— 替换巡航段 foley.wheel 为专属 foley.rook.move（更重更钝）
  swapFoley('rook.move.cruise', 'C', 'noise', 'foley.rook.move', { gain: 0.72, rate: 0.92 });
  // R capture：车轮急刹+戈击金属 —— 在御者吼(vox.shout.drive, hitBus)之上叠加金属垫层
  trimPeak('rook.capture.clash', 'C', 'bladeClash', 0.72);
  addSample('rook.capture.clash', 'T', 'foley.rook.capture',
    { gain: 0.48, rate: 0.90, busTarget: 'hitBus' });

  // ---- 炮 C ----
  // C idle：木架吱呀+士兵低语 —— 接管 applySampleOverlay 挂在 cannon.idle 的 foley.wood.creak
  overrideSample('cannon.idle', 'C', 'foley.wood.creak', 'foley.cannon.idle',
    { gain: 0.40, rate: 0.96, probability: 0.46 });
  // C move：推行+轮滚 —— 替换巡航段 foley.wheel 为专属 foley.cannon.move（更钝更慢）
  swapFoley('cannon.move.cruise', 'C', 'footStep', 'foley.cannon.move', { gain: 0.54, rate: 0.86 });
  // C capture：抛杆破空+巨石落地轰 —— 接管 stoneImpact 的 foley.stone.crush 为专属 foley.cannon.capture
  overrideSample('cannon.capture.stoneImpact', 'C', 'foley.stone.crush', 'foley.cannon.capture',
    { gain: 0.72, rate: 1.0, busTarget: 'hitBus' });
}

/* --------------------------------------------------------------------------
 * 10. SEQUENCES — 演出序列编排
 *
 *     每条序列定义了一组拍点及其相对时间偏移（以 T=0 为锚点）。
 *     sfx.js 的 playSequence() 按此表依次排入 scheduleBeat()。
 *
 *     结构: { moves: { [piece]: { beats: [{ name, offset, layerMask? }] } },
 *              captures: { [piece]: { beats: [...] } },
 *              idle: [piece name array] }
 * ------------------------------------------------------------------------ */

/** 移动序列：M0→M1→M2→M3→M4→M5，offset 以 startAt 为基准 */
function makeMoveSequence(p: string): { totalDur: number, beats: Array<{ beat: string, offset: number, name: string }> } {
  const pk = PIECE_NAMES[p];
  const durMap = { P: 0.42, N: 0.48, B: 0.55, A: 0.38, R: 0.54, C: 0.50, K: 0.58 };
  const totalDur = (durMap as Record<string, number>)[p] || 0.45;
  const step = totalDur / 5; // 5 拍均匀分布

  return {
    totalDur,
    beats: [
      { beat: 'launch', offset: 0.000, name: `${pk}.move.launch` },
      { beat: 'cruise', offset: step, name: `${pk}.move.cruise` },
      { beat: 'brake', offset: step * 3, name: `${pk}.move.brake` },
      { beat: 'land', offset: step * 4, name: `${pk}.move.land` },
      { beat: 'settle', offset: totalDur - 0.04, name: `${pk}.move.settle` }
    ]
  };
}

/** 吃子序列：以 impactAt（命中帧 T）为锚点反推 */
function makeCaptureSequence(p: string): { beats: Array<{ beat: string, offset: number, name: string }> } {
  const pk = PIECE_NAMES[p];
  return {
    beats: [
      { beat: 'approach', offset: -0.63, name: `${pk}.capture.approach` },
      { beat: 'windup', offset: -0.235, name: `${pk}.capture.windup` },
      { beat: 'clash', offset: 0.000, name: `${pk}.capture.clash` },
      // hitFreeze @ T+0.000..T+hitstop
      { beat: 'victim', offset: 0.045, name: `${pk}.capture.victim.shake` },
      { beat: 'settle', offset: 0.43, name: `${pk}.capture.settle` }
    ]
  };
}

export const SEQUENCES: {
  move: Record<string, { totalDur: number, beats: Array<{ beat: string, offset: number, name: string, faction?: string }> }>;
  capture: Record<string, { beats: Array<{ beat: string, offset: number, name: string, faction?: string }> }>;
  idle?: string[];
} = {
  move: {},
  capture: {}
};

for (const p of ALL_PIECES) {
  SEQUENCES.move[PIECE_NAMES[p]!] = makeMoveSequence(p);
  SEQUENCES.capture[PIECE_NAMES[p]!] = makeCaptureSequence(p);
}

/* 炮吃子特殊序列 —— C1：装填→瞄准→射击→后坐 四段语义（对应 A2 executeCannon 的 LOAD/AIM/FIRE/RECOIL） */
SEQUENCES.capture['cannon'] = {
  beats: [
    { beat: 'load', offset: -0.63, name: 'cannon.capture.load' },
    { beat: 'aim', offset: -0.235, name: 'cannon.capture.aim' },
    { beat: 'fire', offset: 0.000, name: 'cannon.capture.stoneImpact' },
    { beat: 'victim', offset: 0.045, name: 'cannon.capture.victim.shake' },
    { beat: 'recoil', offset: 0.43, name: 'cannon.capture.recoil' }
  ]
};

/* 待机序列 */
SEQUENCES.idle = ['pawn', 'horse', 'elephant', 'advisor', 'rook', 'cannon', 'king'];

/* --------------------------------------------------------------------------
 * 11. ambient 配方（供 ambience.js 使用）
 * ------------------------------------------------------------------------ */

export const AMBIENT_LAYERS = {
  wind: {
    type: 'noiseLoop',
    rate: 0.26,
    lfoRate: { freq: 0.037, amp: 0.015 },  // playbackRate LFO ±1.5%
    filter: { type: 'lowpass', freq: 300, q: 1.6, lfoFreq: 0.055, lfoAmp: 110 },
    gain: { base: 0.12, lfoRate: 0.083, lfoAmp: 0.06 },
    peak: 0.014, wet: 0.50,
    highpass: 55
  },
  banner: {
    type: 'bannerFlap',
    interval: { lo: 2.4, hi: 7.4 },
    params: { nMin: 3, nMax: 6, cf: 950, peakMin: 0.014, peakMax: 0.030, panLo: -0.55, panHi: 0.55 },
    peak: 0.030, wet: 0.46
  },
  drum: {
    type: 'farDrum',
    interval: { lo: 3.2, hi: 14.0 },
    params: { f0Min: 52, f0Max: 64, dur: 0.42, noSnap: true,
              lowpass: 900, wet: 0.62, attack: 0.018, lowshelf: 120 },
    peak: 0.058, wet: 0.62
  },
  crowd: {
    type: 'crowdBed',
    continuous: true,
    peak: { lo: 0.008, hi: 0.026 },
    formants: [620, 1180, 2450],
    lp: { lo: 1500, hi: 2400 },
    shoutInterval: { lo: 9.4, hi: 26.0 },
    wet: 0.66
  },
  horse: {
    type: 'horseSnort',
    interval: { lo: 17.7, hi: 40.0 },
    params: { fMin: 340, fMax: 460, peak: 0.012, durMin: 0.18, durMax: 0.26 },
    snortProb: 0.6,
    peak: 0.012, wet: 0.66
  },
  // ── D1 新增三层（piece-sfx-design §2.1：号角/尘土/远处喊杀）——
  // 只升密度不升音量：张力走高时靠「间隔加密 + 层级叠加」，ambLimit 兜底
  horn: {
    type: 'horn',
    interval: { lo: 26.0, hi: 60.0 },
    params: { freqMin: 164.81, freqMax: 196.00, dur: 0.9, peak: 0.040 },
    peak: 0.040, wet: 0.66
  },
  dust: {
    type: 'dustScuff',
    interval: { lo: 9.0, hi: 24.0 },
    params: { f0: 900, f1: 240, q: 1.3, dur: 1.4, attack: 0.45, peak: 0.018 },
    peak: 0.018, wet: 0.58
  },
  shout: {
    type: 'crowdBed',
    interval: { lo: 6.0, hi: 18.0 },
    params: { peak: 0.026, lp: 1700, dur: 1.1 },
    peak: 0.026, wet: 0.66
  }
};

/* --------------------------------------------------------------------------
 * 11.5 采样环境床（8s 无缝循环 · design §2.1 风沙 / 远处军阵 / 行军鼓）
 *
 *  与上面 AMBIENT_LAYERS 的关系：
 *    · wind / crowd —— 程序化层先建（保证进场即有底噪、无空窗），采样解码完成后
 *      **交叉淡化接管**（程序化 →0，采样 →目标电平），避免叠加变吵。
 *    · march —— 纯采样新增层（行军鼓点常驻床）。采样缺失就没有这层，原有阵发
 *      farDrum 仍然工作，不会留下静默空洞。
 *
 *  电平定标（用户实测反馈：风沙曾过大、其余层几乎听不见）：
 *    风沙压到 0.10 打底；军阵嗡鸣 0.085 —— 是「远处一片人马」而非人群围观；
 *    行军鼓 0.075 —— 只当低频脉搏，不抢走子鼓点。三者叠加后仍在 ambLimit 之下。
 *  张力联动：tensionMul 给出张力 0→1 时该层的电平倍率（只在合理区间小幅推）。
 * ------------------------------------------------------------------------ */

export const AMBIENT_BEDS: Record<string, {
  key: string; gain: number; wet: number; rate: number;
  highpass?: number; lowpass?: number;
  lfo?: { freq: number; amp: number };
  tensionMul: [number, number];
  crossfade: number;
  replaces?: string;
}> = {
  wind: {
    key: 'ambient.loop.wind', gain: 0.10, wet: 0.42, rate: 1.0,
    highpass: 48, lowpass: 3200,
    lfo: { freq: 0.071, amp: 0.035 },          // 阵风呼吸（±35%）
    tensionMul: [0.88, 1.16], crossfade: 2.2, replaces: 'wind'
  },
  crowd: {
    key: 'ambient.loop.crowd', gain: 0.085, wet: 0.60, rate: 1.0,
    highpass: 90, lowpass: 2100,               // 远场：削掉近场高频细节
    lfo: { freq: 0.043, amp: 0.030 },
    tensionMul: [0.80, 1.45], crossfade: 2.6, replaces: 'crowd'
  },
  march: {
    key: 'ambient.loop.drum', gain: 0.075, wet: 0.55, rate: 1.0,
    highpass: 38, lowpass: 900,                // 远处鼓：只剩膜体低频
    lfo: { freq: 0.029, amp: 0.022 },
    tensionMul: [0.62, 1.55], crossfade: 3.0
  }
};

/* --------------------------------------------------------------------------
 * 12. 张力映射表（TENSION → 环境参数）
 * ------------------------------------------------------------------------ */

export const TENSION_WEIGHTS = {
  material: 0.22,  // 势均力敌度
  endgame: 0.26,    // 残局度
  check: 0.28,      // 将军
  recent: 0.16,     // 近期厮杀
  pressure: 0.08    // 压境度
};

export const TENSION_MAP = {
  // TENSION → { ambientGain, drumInterval, drumPeak, crowdPeak, envWet }
  0.0: { ambientGain: 0.70, drumInterval: 14.0, drumPeak: 0.020, crowdPeak: 0.008, envWet: 0.62 },
  0.5: { ambientGain: 0.81, drumInterval: 6.3, drumPeak: 0.039, crowdPeak: 0.017, envWet: 0.55 },
  1.0: { ambientGain: 0.92, drumInterval: 3.2, drumPeak: 0.058, crowdPeak: 0.026, envWet: 0.48 }
};
