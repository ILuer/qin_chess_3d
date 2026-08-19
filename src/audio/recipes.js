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
export const PIECE_NAMES = {
  P: 'pawn', N: 'horse', B: 'elephant',
  A: 'advisor', R: 'rook', C: 'cannon', K: 'king'
};

/** 全部兵种列表 */
export const ALL_PIECES = ['P', 'N', 'B', 'A', 'R', 'C', 'K'];

/* --------------------------------------------------------------------------
 * 1. 泛音列预设（bronzeBody 用）
 * ------------------------------------------------------------------------ */

export const PARTIALS = {
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

export const ARMOR_PRESETS = {
  P: { n: 2, f0: 3000, f1: 4000, spread: 0.048, ring: 0.26, peak: 0.17 },
  N: { n: 3, f0: 3200, f1: 4800, spread: 0.055, ring: 0.24, peak: 0.18 },
  B: { n: 4, f0: 2600, f1: 3800, spread: 0.075, ring: 0.34, peak: 0.19 },
  A: { n: 2, f0: 3400, f1: 4200, spread: 0.055, ring: 0.10, peak: 0.085, softAttack: 0.005 },
  R: { n: 5, f0: 2400, f1: 3600, spread: 0.090, ring: 0.30, peak: 0.20 },
  C: { n: 2, f0: 2700, f1: 3500, spread: 0.070, ring: 0.20, peak: 0.12 },
  K: { n: 5, f0: 3400, f1: 5200, spread: 0.070, ring: 0.38, peak: 0.21 }
};

/** 落位装甲音色（更重、更多片、更宽spread） */
export const ARMOR_LAND_PRESETS = {
  P: { n: 4, f0: 3100, f1: 4300, spread: 0.085, ring: 0.30, peak: 0.22 },
  N: { n: 5, f0: 3200, f1: 4900, spread: 0.095, ring: 0.28, peak: 0.21 },
  B: { n: 5, f0: 2600, f1: 3900, spread: 0.105, ring: 0.36, peak: 0.23 },
  A: { n: 3, f0: 3300, f1: 4300, spread: 0.070, ring: 0.12, peak: 0.11, softAttack: 0.005 },
  R: { n: 6, f0: 2400, f1: 3700, spread: 0.130, ring: 0.32, peak: 0.24 },
  C: { n: 3, f0: 2700, f1: 3600, spread: 0.080, ring: 0.22, peak: 0.14 },
  K: { n: 6, f0: 3500, f1: 5200, spread: 0.100, ring: 0.40, peak: 0.24 }
};

/** 收势沉降装甲 */
export const ARMOR_FALL_PRESETS = {
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

export const DRUM_PRESETS = {
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

export const WEAPON_PARAMS = {
  P: { type: '戈', base: 620, grind: 0.34, partials: 'BAR', whoosh: { f0: 620, f1: 2400 } },
  N: { type: '长戟', base: 480, grind: 0.18, partials: 'BAR', whoosh: { f0: 540, f1: 2100 } },
  B: { type: '铜钺', base: 330, grind: 0.10, partials: 'BELL', whoosh: { f0: 1200, f1: 480 } },
  A: { type: '短剑', base: 880, grind: 0.30, partials: 'BAR', whoosh: { f0: 900, f1: 3200 } },
  R: { type: '车戈铁箍', base: 1660, grind: 0.42, partials: 'IRON', whoosh: { f0: 700, f1: 2600 } },
  C: { type: '石弹', base: 0, grind: 0, partials: null, whoosh: null, isStone: true },
  K: { type: '王剑', base: 700, grind: 0.26, partials: 'BAR', whoosh: { f0: 800, f1: 2900 }, extraBell: true }
};

/** 吃子闷击参数（A5 thud） */
export const THUD_PARAMS = {
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

export const VICTIM_WEIGHTS = { P: 'light', N: 'medium', A: 'light', B: 'medium', R: 'heavy', C: 'medium', K: 'heavy' };

export const VICTIM_COLLAPSE = {
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

export const BEAT_RECIPES = {};

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

function buildM1(p) {
  const dr = DRUM_PRESETS.M1[p];
  const ar = ARMOR_PRESETS[p];
  const recipe = { layers: { B: [], T: [], C: [] }, opts: {} };

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
    const lp = lcParams[p];
    recipe.layers.C.push({
      type: 'leatherCreak', cf: lp.cf, q: lp.q, peak: lp.peak, dur: lp.dur, grain: lp.grain
    });
  }

  return recipe;
}

function buildM2(p) {
  const recipe = { layers: { B: [], T: [], C: [] }, opts: {} };

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

function buildM3(p) {
  const brakeParams = {
    P: { f0: 880, f1: 400, q: 2.6, peak: 0.13, dur: 0.10 },
    N: { f0: 1100, f1: 460, q: 2.2, peak: 0.15, dur: 0.11 },
    B: { f0: 1400, f1: 620, q: 1.2, peak: 0.11, dur: 0.08 },
    A: { f0: 1300, f1: 700, q: 2.0, peak: 0.06, dur: 0.09, attack: 0.012 },
    R: { f0: 820, f1: 330, q: 2.8, peak: 0.20, dur: 0.13 },
    C: { f0: 700, f1: 300, q: 3.0, peak: 0.14, dur: 0.10 },
    K: { f0: 760, f1: 340, q: 2.4, peak: 0.12, dur: 0.10 }
  };
  const bp = brakeParams[p];
  const recipe = { layers: { C: [] }, opts: {} };
  recipe.layers.C.push({
    type: 'dustScuff', f0: bp.f0, f1: bp.f1, q: bp.q, peak: bp.peak, dur: bp.dur,
    attack: bp.attack || 0.001
  });
  recipe.opts.wet = p === 'A' ? 0.12 : (p === 'K' ? 0.14 : 0.11);
  return recipe;
}

function buildM4(p) {
  const dr = DRUM_PRESETS.M4[p];
  const ar = ARMOR_LAND_PRESETS[p];
  const recipe = { layers: { B: [], T: [], C: [], S: [] }, opts: {} };
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
    if (tParams[p]) {
      recipe.layers.T.push({
        type: 'transient', freq: tParams[p].f, q: tParams[p].q,
        peak: tParams[p].pk, dur: tParams[p].d
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

  recipe.opts.wet = wetVals[p];
  if (p === 'K') recipe.opts.wet = 0.19; // 帅含钟尾韵，送更多湿

  return recipe;
}

function buildM5(p) {
  const af = ARMOR_FALL_PRESETS[p];
  const recipe = { layers: { T: [], C: [] }, opts: { wet: 0.18 } };

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
}

function buildA0(p) {
  const w = WEAPON_PARAMS[p];
  if (!w || !w.whoosh) return { layers: {}, opts: {} };
  return {
    layers: {
      C: [{
        type: 'whoosh', f0: w.whoosh.f0, f1: w.whoosh.f1,
        q: 1.0, peak: 0.24, dur: 0.37
      }]
    },
    opts: { wet: 0.22 }
  };
}

function buildA1(p) {
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

function buildA2(p) {
  const w = WEAPON_PARAMS[p];
  if (!w || w.isStone) return { layers: {}, opts: {} };
  const th = THUD_PARAMS[p];
  const recipe = { layers: { T: [], C: [], B: [] }, opts: { wet: 0.16 } };

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

function buildA4(p) {
  const w = VICTIM_WEIGHTS[p];
  const vc = VICTIM_COLLAPSE[w];
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

function buildA5(p) {
  const th = THUD_PARAMS[p];
  const recipe = { layers: { B: [], T: [] }, opts: { wet: 0.12 } };

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
function makeMoveSequence(p) {
  const pk = PIECE_NAMES[p];
  const durMap = { P: 0.42, N: 0.48, B: 0.55, A: 0.38, R: 0.54, C: 0.50, K: 0.58 };
  const totalDur = durMap[p] || 0.45;
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
function makeCaptureSequence(p) {
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

export const SEQUENCES = {
  move: {},
  capture: {}
};

for (const p of ALL_PIECES) {
  SEQUENCES.move[PIECE_NAMES[p]] = makeMoveSequence(p);
  SEQUENCES.capture[PIECE_NAMES[p]] = makeCaptureSequence(p);
}

/* 炮吃子特殊序列 */
SEQUENCES.capture['cannon'] = {
  beats: [
    { beat: 'stoneImpact', offset: 0.000, name: 'cannon.capture.stoneImpact' },
    { beat: 'victim', offset: 0.045, name: 'cannon.capture.victim.shake' },
    { beat: 'settle', offset: 0.43, name: 'cannon.capture.settle' }
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
    gain: { base: 0.55, lfoRate: 0.083, lfoAmp: 0.28 },
    peak: 0.024, wet: 0.52,
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
