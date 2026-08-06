/* ==========================================================================
 * qin-chess-3d · src/audio/sfx.js
 * 秦风 · 中国象棋 —— 纯 WebAudio 程序化音效引擎
 *
 * 设计原则：
 *   1. 零依赖、零外部资源。所有声音在运行时由振荡器 / 噪声缓冲实时合成，
 *      混响脉冲响应（IR）也由代码生成，不加载任何 .mp3/.wav/.ogg。
 *   2. 听觉基调「玄黑赤红 · 青铜甲胄 · 战鼓旌旗」：
 *      - 金属层用**不谐和泛音列**（青铜编钟/铜锣的物理特征），不用纯谐波，
 *        避免电子合成器的廉价感。
 *      - 冲击层用**短噪声爆发 + 带通滤波**模拟木石相击。
 *      - 旋律层用**五声音阶（宫商角徵羽）+ 锯齿波低通**模拟埙/角。
 *      - 全局挂一条 1.5s 的程序化「石殿混响」，是"不廉价"的关键。
 *   3. 信号链：voiceBus →（StereoPanner）→ dryBus ─┐
 *                                    └→ sendGain → Convolver → wetBus ─┤
 *                                                             masterGain → Compressor → destination
 *   4. 所有增益包络一律用 setValueAtTime + exponential/linearRamp，绝不跳变，杜绝爆音。
 *
 * 契约导出（docs/CONTRACT.md §3）：
 *   SFX.init() / SFX.play(name, opts) / SFX.setEnabled(bool) / SFX.setVolume(v) / SFX.isEnabled()
 * 契约之外的附加 API（可选使用，不调用不影响任何行为）：
 *   SFX.setAmbient(bool) / SFX.isAmbient() / SFX.getVolume() / SFX.isReady() / SFX.stopAll()
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * 0. 常量与模块级状态
 * ------------------------------------------------------------------------ */

/** localStorage 持久化键 */
const LS_KEY = 'qin-chess-audio';

/** 同名音效节流窗口（毫秒）：30ms 内重复触发直接丢弃，防连点叠加爆音 */
const THROTTLE_MS = 30;

/** 主输出留出的削峰余量，避免多层叠加撞满 0dBFS */
const HEADROOM = 0.9;

/** 程序化混响 IR 时长（秒） */
const IR_SECONDS = 1.5;

/**
 * 各音效的基准峰值电平（线性增益，进入 voiceBus 之前）。
 * 这张表就是混音电平表的真相源，docs/audio-design.md 与此保持一致。
 */
const LEVEL = {
  select: 0.34,
  hover: 0.11,
  move: 0.50,
  capture: 0.78,
  check: 0.85,
  illegal: 0.30,
  undo: 0.26,
  start: 0.42,
  win: 0.50,
  lose: 0.46,
  // —— 阶段三：分兵种移动音效（脚步 / 马蹄 / 绞盘 / 车轮 / 振翅 / 软步 / 踏步）——
  'move.pawn': 0.42,
  'move.horse': 0.46,
  'move.cannon': 0.44,
  'move.rook': 0.50,
  'move.elephant': 0.48,
  'move.advisor': 0.34,
  'move.king': 0.52,
  // —— 阶段三：分兵种吃子音效（突刺 / 长矛 / 落石 / 碾击 / 掌击 / 挥剑 / 王剑）——
  'capture.pawn': 0.70,
  'capture.horse': 0.74,
  'capture.cannon': 0.80,
  'capture.rook': 0.78,
  'capture.elephant': 0.76,
  'capture.advisor': 0.72,
  'capture.king': 0.82
};

/**
 * 各音效的混响发送量（0..1）。
 * 近场打击（move/select/hover/illegal）几乎全干，保证颗粒感与响应速度；
 * 仪式性事件（check/start/win/lose）大量送湿，撑出宫殿/战场的空间尺度。
 */
const WET = {
  select: 0.16,
  hover: 0.05,
  move: 0.10,
  capture: 0.34,
  check: 0.60,
  illegal: 0.06,
  undo: 0.30,
  start: 0.45,
  win: 0.42,
  lose: 0.55,
  ambient: 0.50,
  // —— 阶段三：分兵种移动（近场，少混响）——
  'move.pawn': 0.10,
  'move.horse': 0.10,
  'move.cannon': 0.14,
  'move.rook': 0.12,
  'move.elephant': 0.16,
  'move.advisor': 0.10,
  'move.king': 0.18,
  // —— 阶段三：分兵种吃子（中混响，撑出战场尺度）——
  'capture.pawn': 0.34,
  'capture.horse': 0.38,
  'capture.cannon': 0.42,
  'capture.rook': 0.40,
  'capture.elephant': 0.36,
  'capture.advisor': 0.34,
  'capture.king': 0.46
};

/** 五声音阶（宫商角徵羽），以 C 为宫的一组参考频率（Hz） */
const PENTA = {
  gong3: 130.81, // 宫 C3
  shang3: 146.83, // 商 D3
  jue3: 164.81, // 角 E3
  zhi3: 196.00, // 徵 G3
  yu3: 220.00, // 羽 A3
  gong4: 261.63, // 宫 C4
  shang4: 293.66, // 商 D4
  jue4: 329.63, // 角 E4
  zhi4: 392.00, // 徵 G4
  yu4: 440.00, // 羽 A4
  gong5: 523.25 // 宫 C5
};

/* --- 运行期节点句柄（全部懒创建） --- */
let ctx = null; // AudioContext
let masterGain = null; // 主音量
let compressor = null; // 限幅/防爆
let dryBus = null; // 干声总线
let wetBus = null; // 湿声（混响返回）总线
let convolver = null; // 程序化混响
let noiseBuf = null; // 缓存的白噪声缓冲（全项目复用一份）
let ready = false; // AudioContext 是否已建立
let hasPanner = false; // 浏览器是否支持 StereoPannerNode

/** 节流记录：{ [name]: 上次播放的 performance.now() } */
const lastFired = Object.create(null);

/** 环境氛围层的节点集合 */
let ambientNodes = null;
let ambientTimer = 0;

/** 用户可持久化的状态 */
const settings = {
  enabled: true,
  volume: 0.8,
  ambient: false
};

/* --------------------------------------------------------------------------
 * 1. 小工具
 * ------------------------------------------------------------------------ */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rand = (a, b) => a + Math.random() * (b - a);

/** exponentialRamp 不允许目标为 0，用这个当"静音地板" */
const FLOOR = 0.0001;

/** 读取持久化设置（任何异常都退回默认值，绝不让存储问题炸掉音频） */
function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (typeof o.enabled === 'boolean') settings.enabled = o.enabled;
    if (typeof o.volume === 'number' && isFinite(o.volume)) settings.volume = clamp(o.volume, 0, 1);
    if (typeof o.ambient === 'boolean') settings.ambient = o.ambient;
  } catch (e) {
    /* 隐私模式 / 存储被禁用：静默降级 */
  }
}

function saveSettings() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  } catch (e) {
    /* 忽略 */
  }
}

/** 当前时间轴基准（留 1 帧余量，避免调度到过去的时间点） */
function t0() {
  return ctx.currentTime + 0.001;
}

/* --------------------------------------------------------------------------
 * 2. 程序化资源：白噪声缓冲 + 混响脉冲响应
 * ------------------------------------------------------------------------ */

/**
 * 生成 2 秒单声道白噪声，作为所有"冲击/气声/风声"的源材料。
 * 只生成一次，所有 BufferSource 共享同一份 buffer（省内存，约 350KB @48kHz）。
 */
function buildNoiseBuffer() {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * 生成 1.5s 立体声脉冲响应：噪声 × 指数衰减包络。
 * 额外做三件事让它像"石砌宫殿"而不是"数字混响罐"：
 *   a) 一阶低通逐样本平滑 → 削掉过亮的高频，得到石材/木构的暗色尾巴；
 *   b) 左右声道用不同随机序列与略微不同的衰减系数 → 天然立体声宽度；
 *   c) 前 12ms 压低（预延迟窗），让直达声与混响分离，打击感更清晰。
 */
function buildImpulseResponse() {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * IR_SECONDS);
  const ir = ctx.createBuffer(2, len, rate);
  const preDelay = Math.floor(rate * 0.012);

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    // 衰减系数：左右微差，制造去相关
    const decay = ch === 0 ? 5.2 : 4.9;
    // 一阶低通状态
    let lp = 0;
    const lpCoef = ch === 0 ? 0.38 : 0.41;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const n = Math.random() * 2 - 1;
      lp += (n - lp) * lpCoef; // 逐样本低通，压暗尾巴
      let amp = Math.pow(1 - t, decay); // 指数式衰减包络
      if (i < preDelay) amp *= i / preDelay; // 预延迟淡入
      data[i] = lp * amp;
    }
  }
  return ir;
}

/* --------------------------------------------------------------------------
 * 3. 总线搭建
 * ------------------------------------------------------------------------ */

function buildGraph() {
  // 主链：masterGain → compressor → destination
  masterGain = ctx.createGain();
  masterGain.gain.value = settings.volume * HEADROOM;

  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -12; // 起限阈值
  compressor.knee.value = 22; // 软拐点，避免压缩"抓"得太明显
  compressor.ratio.value = 8; // 强比例，纯当安全网
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  masterGain.connect(compressor);
  compressor.connect(ctx.destination);

  // 干声总线
  dryBus = ctx.createGain();
  dryBus.gain.value = 1.0;
  dryBus.connect(masterGain);

  // 湿声总线（混响返回）
  convolver = ctx.createConvolver();
  convolver.normalize = true;
  convolver.buffer = buildImpulseResponse();

  wetBus = ctx.createGain();
  wetBus.gain.value = 0.95;
  convolver.connect(wetBus);
  wetBus.connect(masterGain);

  noiseBuf = buildNoiseBuffer();
  hasPanner = typeof ctx.createStereoPanner === 'function';
}

/**
 * 为一次发声创建独立的"声部总线"：
 *   voiceBus →（panner）→ dryBus
 *                       └→ sendGain → convolver
 * 返回可直接连接源节点的输入 GainNode。
 * @param {number} wet  混响发送量 0..1
 * @param {number} pan  声像 -1..1
 * @param {number} life 预计生命周期（秒），到期自动断开释放
 */
function makeBus(wet, pan, life) {
  const bus = ctx.createGain();
  bus.gain.value = 1;

  let tail = bus;
  if (hasPanner && pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    bus.connect(p);
    tail = p;
  }

  tail.connect(dryBus);

  if (wet > 0.001) {
    const send = ctx.createGain();
    send.gain.value = wet;
    tail.connect(send);
    send.connect(convolver);
    scheduleRelease([bus, tail, send], life);
  } else {
    scheduleRelease([bus, tail], life);
  }
  return bus;
}

/** 到期断开节点，防止长会话下节点泄漏 */
function scheduleRelease(nodes, life) {
  const ms = Math.max(80, (life + 0.35) * 1000);
  setTimeout(() => {
    for (let i = 0; i < nodes.length; i++) {
      try {
        nodes[i].disconnect();
      } catch (e) {
        /* 已断开 */
      }
    }
  }, ms);
}

/* --------------------------------------------------------------------------
 * 4. 通用发声原语
 * ------------------------------------------------------------------------ */

/**
 * 冲击型包络（Attack-Decay）：瞬间起音 + 指数衰减。
 * 所有打击类音色的通用包络，绝不跳变。
 */
function envAD(param, t, peak, attack, decay) {
  const p = Math.max(peak, FLOOR * 2);
  param.setValueAtTime(FLOOR, t);
  param.exponentialRampToValueAtTime(p, t + attack);
  param.exponentialRampToValueAtTime(FLOOR, t + attack + decay);
}

/**
 * 吹奏型包络（Attack-Sustain-Release）：用于号角/旋律音，带柔和起落。
 */
function envASR(param, t, peak, attack, hold, release) {
  const p = Math.max(peak, FLOOR * 2);
  param.setValueAtTime(FLOOR, t);
  param.exponentialRampToValueAtTime(p, t + attack);
  param.setValueAtTime(p, t + attack + hold);
  param.exponentialRampToValueAtTime(FLOOR, t + attack + hold + release);
}

/** 创建一个振荡器（自动 start/stop） */
function mkOsc(type, freq, t, dur, detuneCents) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (detuneCents) o.detune.setValueAtTime(detuneCents, t);
  o.start(t);
  o.stop(t + dur);
  return o;
}

/** 创建一个噪声源（从共享缓冲的随机位置读取，避免每次听感完全相同） */
function mkNoise(t, dur, rate) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.playbackRate.value = rate || 1;
  s.start(t, rand(0, 1.4));
  s.stop(t + dur);
  return s;
}

/** 便捷：滤波器 */
function mkFilter(type, freq, q) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (q != null) f.Q.value = q;
  return f;
}

/* --------------------------------------------------------------------------
 * 5. 复用型音色积木
 * ------------------------------------------------------------------------ */

/**
 * 【青铜钟体】不谐和泛音列合成器 —— 编钟 / 铜锣的共用内核。
 * 真实青铜钟的泛音不是整数倍（1,2,3…），而是接近 [1, 1.19, 2.0, 2.76, 3.6, 5.4]
 * 这样的不谐和比值，这正是"金属味"的来源；同时高次泛音衰减更快，
 * 所以起音时明亮、尾巴逐渐变成低沉的嗡鸣。
 *
 * @param {GainNode} bus 目标总线
 * @param {number} t 起始时间
 * @param {number} base 基频
 * @param {number} peak 峰值增益
 * @param {number} decayScale 整体衰减倍率（1 = 钟，3 = 锣）
 * @param {Array}  partials [比值, 增益权重, 衰减权重]
 * @param {number} vibHz 颤音频率（0 = 无）
 */
function bronzeBody(bus, t, base, peak, decayScale, partials, vibHz) {
  let vibGain = null;
  if (vibHz > 0) {
    const lfo = mkOsc('sine', vibHz, t, 3.2 * decayScale);
    vibGain = ctx.createGain();
    vibGain.gain.value = 9; // ±9 音分的轻微飘移，模拟锣面震颤
    lfo.connect(vibGain);
  }

  for (let i = 0; i < partials.length; i++) {
    const [ratio, w, dw] = partials[i];
    const dur = dw * decayScale;
    // 每个泛音单独失谐一点点，避免相位锁死导致的"电子感"
    const o = mkOsc('sine', base * ratio * rand(0.997, 1.003), t, dur + 0.05, rand(-6, 6));
    const g = ctx.createGain();
    envAD(g.gain, t, peak * w, 0.004, dur);
    o.connect(g);
    g.connect(bus);
    if (vibGain) vibGain.connect(o.detune);
  }
}

/**
 * 【木槌/石击 瞬态】极短噪声爆发 + 带通。
 * 打击乐的"点"全靠这 10~60ms 的瞬态，没有它，任何合成打击都软塌塌。
 */
function transient(bus, t, freq, q, peak, dur, rate) {
  const n = mkNoise(t, dur + 0.02, rate || rand(0.95, 1.08));
  const bp = mkFilter('bandpass', freq, q);
  const g = ctx.createGain();
  envAD(g.gain, t, peak, 0.001, dur);
  n.connect(bp);
  bp.connect(g);
  g.connect(bus);
}

/**
 * 【战鼓】低频正弦下滑 + 噪声鼓皮瞬态。
 * 频率下滑（pitch drop）是鼓最重要的心理声学特征：
 * 鼓皮张力在击打瞬间最高，之后迅速松弛。
 */
function warDrum(bus, t, fromHz, toHz, peak, dur) {
  const o = mkOsc('sine', fromHz, t, dur + 0.05);
  o.frequency.exponentialRampToValueAtTime(Math.max(toHz, 20), t + dur * 0.55);
  const g = ctx.createGain();
  envAD(g.gain, t, peak, 0.004, dur);
  o.connect(g);
  g.connect(bus);

  // 鼓皮/鼓槌的木质瞬态
  transient(bus, t, 320, 0.9, peak * 0.42, 0.05, 0.85);
  transient(bus, t, 1800, 1.4, peak * 0.14, 0.025, 1.2);
}

/**
 * 【埙 / 号角】双锯齿 + 低通 + 气声，五声音阶旋律音的通用音色。
 * 锯齿波谐波丰富，用低通"吹口"包络（起音时截止频率上扫）模拟气流建立过程；
 * 叠一个低八度正弦增加分量，让号角有胸腔共鸣。
 */
function hornNote(bus, t, freq, peak, dur) {
  const lp = mkFilter('lowpass', 500, 3.2);
  lp.frequency.setValueAtTime(420, t);
  lp.frequency.linearRampToValueAtTime(freq * 5.5, t + Math.min(0.12, dur * 0.4));
  lp.frequency.linearRampToValueAtTime(freq * 2.2, t + dur);

  const g = ctx.createGain();
  envASR(g.gain, t, peak, Math.min(0.055, dur * 0.22), dur * 0.42, dur * 0.5);
  lp.connect(g);
  g.connect(bus);

  // 两个微失谐锯齿：制造自然的拍频（beating），单振荡器会太"死"
  const a = mkOsc('sawtooth', freq, t, dur + 0.2, -7);
  const b = mkOsc('sawtooth', freq * 1.004, t, dur + 0.2, +8);
  const mix = ctx.createGain();
  mix.gain.value = 0.5;
  a.connect(mix);
  b.connect(mix);
  mix.connect(lp);

  // 低八度正弦垫底：号角的胸腔感
  const sub = mkOsc('sine', freq * 0.5, t, dur + 0.2);
  const sg = ctx.createGain();
  envASR(sg.gain, t, peak * 0.45, 0.05, dur * 0.4, dur * 0.55);
  sub.connect(sg);
  sg.connect(bus);

  // 吹奏气声：让它像"人吹的"而非"机器发的"
  const air = mkNoise(t, dur + 0.05, 1);
  const abp = mkFilter('bandpass', freq * 3, 1.1);
  const ag = ctx.createGain();
  envASR(ag.gain, t, peak * 0.09, 0.03, dur * 0.4, dur * 0.5);
  air.connect(abp);
  abp.connect(ag);
  ag.connect(bus);
}

/**
 * 【钟磬式旋律音】用于胜利琶音：三角波 + 少量不谐和泛音，明亮但不刺。
 */
function chimeNote(bus, t, freq, peak, dur) {
  const o = mkOsc('triangle', freq, t, dur + 0.05);
  const g = ctx.createGain();
  envAD(g.gain, t, peak, 0.006, dur);
  o.connect(g);
  g.connect(bus);

  const o2 = mkOsc('sine', freq * 2.74, t, dur * 0.5 + 0.05);
  const g2 = ctx.createGain();
  envAD(g2.gain, t, peak * 0.18, 0.003, dur * 0.45);
  o2.connect(g2);
  g2.connect(bus);

  const o3 = mkOsc('sine', freq * 0.5, t, dur + 0.05);
  const g3 = ctx.createGain();
  envAD(g3.gain, t, peak * 0.3, 0.008, dur * 0.8);
  o3.connect(g3);
  g3.connect(bus);
}

/* --------------------------------------------------------------------------
 * 6. 十个音效的合成实现
 *    统一签名 (t, o)：t = 起始时间，o = { vol, pit, pan }（已含微随机化）
 * ------------------------------------------------------------------------ */

/**
 * select —— 选中棋子：编钟单击（含"侧鼓音"双音特性）
 * 编钟是合瓦形，正鼓与侧鼓能敲出相差小三度的两个音，
 * 这里用 1.0 与 1.19（≈小三度）两组泛音同时发声还原这一特征。
 */
function sfxSelect(t, o) {
  const bus = makeBus(WET.select, o.pan, 1.1);
  const base = 880 * o.pit;
  const peak = LEVEL.select * o.vol;
  bronzeBody(
    bus,
    t,
    base,
    peak,
    1,
    [
      [1.0, 0.62, 0.85], // 正鼓音（主音）
      [1.19, 0.30, 0.72], // 侧鼓音（编钟特有的第二基音，小三度）
      [2.0, 0.34, 0.46],
      [2.76, 0.22, 0.30],
      [3.61, 0.13, 0.20],
      [5.42, 0.07, 0.11]
    ],
    0
  );
  // 木槌触钟的极短瞬态
  transient(bus, t, 4200, 1.6, peak * 0.30, 0.012, 1.3);
}

/**
 * hover —— 悬停己方棋子：极轻的高频"嗒"
 * 这是全项目触发最频繁的声音，电平必须压到几乎潜意识级别（-19dB），
 * 时长 <30ms，绝不能形成听觉疲劳。
 */
function sfxHover(t, o) {
  const bus = makeBus(WET.hover, o.pan, 0.2);
  const peak = LEVEL.hover * o.vol;
  transient(bus, t, 5200 * o.pit, 2.2, peak, 0.018, 1.25);
  const s = mkOsc('sine', 2600 * o.pit, t, 0.05);
  const g = ctx.createGain();
  envAD(g.gain, t, peak * 0.5, 0.002, 0.03);
  s.connect(g);
  g.connect(bus);
}

/**
 * move —— 落子（未吃子）：木石相击的"啪"
 * 信号链 = 白噪声 → 带通 1200Hz（木质腔体共振区）→ 60ms 极短衰减
 *        + 150Hz 正弦"咚"垫底（棋盘台面的低频响应）
 */
function sfxMove(t, o) {
  const bus = makeBus(WET.move, o.pan, 0.5);
  const peak = LEVEL.move * o.vol;

  // 主体：木石撞击的中频爆发
  const n = mkNoise(t, 0.1, rand(0.92, 1.1));
  const bp = mkFilter('bandpass', 1200 * o.pit, 1.1);
  bp.frequency.exponentialRampToValueAtTime(760 * o.pit, t + 0.06); // 撞击后共振下移
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak, 0.001, 0.06);
  n.connect(bp);
  bp.connect(ng);
  ng.connect(bus);

  // 更脆的高频"啪"层，给出清晰的时间点
  transient(bus, t, 3400 * o.pit, 1.8, peak * 0.34, 0.016, 1.15);

  // 低频"咚"：让落子有重量，坐在混音底部
  const lo = mkOsc('sine', 150 * o.pit, t, 0.16);
  lo.frequency.exponentialRampToValueAtTime(104 * o.pit, t + 0.1);
  const lg = ctx.createGain();
  envAD(lg.gain, t, peak * 0.72, 0.003, 0.11);
  lo.connect(lg);
  lg.connect(bus);
}

/**
 * capture —— 吃子：比 move 明显更重、更暴力
 * 三层叠加：① 80Hz 正弦下滑冲击（身体感）
 *          ② 宽带噪声爆发（碎裂/摩擦）
 *          ③ 高频方波金属短脉冲 + 大量混响尾巴（青铜兵器相击）
 */
function sfxCapture(t, o) {
  const bus = makeBus(WET.capture, o.pan, 1.9);
  const peak = LEVEL.capture * o.vol;

  // ① 低频冲击：80Hz → 42Hz 下滑，给出"被击倒"的身体重量
  const sub = mkOsc('sine', 88 * o.pit, t, 0.34);
  sub.frequency.exponentialRampToValueAtTime(42 * o.pit, t + 0.2);
  const sg = ctx.createGain();
  envAD(sg.gain, t, peak * 0.95, 0.004, 0.26);
  sub.connect(sg);
  sg.connect(bus);

  // ② 宽带噪声爆发：低通从 6kHz 扫到 700Hz，模拟碎裂后的能量坍缩
  const n = mkNoise(t, 0.3, rand(0.9, 1.12));
  const lp = mkFilter('lowpass', 6000, 0.9);
  lp.frequency.exponentialRampToValueAtTime(700, t + 0.18);
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak * 0.62, 0.002, 0.19);
  n.connect(lp);
  lp.connect(ng);
  ng.connect(bus);

  // ③ 金属层：三个不谐和高频方波脉冲，经带通削掉方波的刺耳齿感
  const metal = [2100, 3170, 4430];
  for (let i = 0; i < metal.length; i++) {
    const f = metal[i] * o.pit * rand(0.98, 1.02);
    const m = mkOsc('square', f, t, 0.26);
    const bp = mkFilter('bandpass', f, 6);
    const mg = ctx.createGain();
    envAD(mg.gain, t + i * 0.004, peak * (0.085 - i * 0.018), 0.002, 0.2 - i * 0.04);
    m.connect(bp);
    bp.connect(mg);
    mg.connect(bus);
  }

  // 木石接触的起始瞬态，保证"点"依然锋利
  transient(bus, t, 2600 * o.pit, 1.2, peak * 0.4, 0.022, 1.05);
}

/**
 * check —— 将军：战鼓 + 铜锣，全曲最紧张的一击
 * 鼓（60→40Hz 下滑）先落，30ms 后铜锣（不谐和泛音 + 长衰减 + 颤音）跟上，
 * 这个微小的时间差比同时触发更像真实的军阵鸣金击鼓。
 */
function sfxCheck(t, o) {
  const bus = makeBus(WET.check, o.pan, 3.2);
  const peak = LEVEL.check * o.vol;

  // 战鼓：两连击（重-轻），制造"咚—咚"的心跳压迫感
  warDrum(bus, t, 62 * o.pit, 40 * o.pit, peak * 0.9, 0.32);
  warDrum(bus, t + 0.19, 58 * o.pit, 38 * o.pit, peak * 0.45, 0.28);

  // 铜锣：比编钟更不谐和、衰减更长、带 4.6Hz 颤音（锣面震颤）
  bronzeBody(
    bus,
    t + 0.03,
    248 * o.pit,
    peak * 0.5,
    2.6,
    [
      [1.0, 0.55, 0.95],
      [1.42, 0.40, 0.82], // 强不谐和分音，铜锣"哐"的核心
      [1.88, 0.32, 0.66],
      [2.41, 0.24, 0.5],
      [3.17, 0.16, 0.36],
      [4.63, 0.10, 0.24],
      [6.21, 0.06, 0.15]
    ],
    4.6
  );

  // 锣槌击打的宽带瞬态
  transient(bus, t + 0.03, 1500 * o.pit, 0.8, peak * 0.3, 0.06, 0.95);
}

/**
 * illegal —— 非法走法：低沉的"闷"，明确否定但不刺耳
 * 玩家会频繁听到，因此：① 全部经 520Hz 低通，② 两个快速下行音，
 * ③ 总时长 165ms，④ 峰值仅 -10.5dB，⑤ 几乎不送混响（不留残响污染）。
 */
function sfxIllegal(t, o) {
  const bus = makeBus(WET.illegal, o.pan, 0.4);
  const peak = LEVEL.illegal * o.vol;
  const lp = mkFilter('lowpass', 520, 0.9);
  lp.connect(bus);

  const notes = [
    { at: 0.0, f: 200, d: 0.075 },
    { at: 0.09, f: 150, d: 0.075 }
  ];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const st = t + n.at;
    const osc = mkOsc('square', n.f * o.pit, st, n.d + 0.03);
    osc.frequency.exponentialRampToValueAtTime(n.f * 0.84 * o.pit, st + n.d);
    const g = ctx.createGain();
    envAD(g.gain, st, peak * (i === 0 ? 1 : 0.85), 0.006, n.d);
    osc.connect(g);
    g.connect(lp);
  }

  // 一点点低频"顿挫"，强化否定的体感
  const th = mkOsc('sine', 110 * o.pit, t, 0.2);
  th.frequency.linearRampToValueAtTime(84 * o.pit, t + 0.16);
  const tg = ctx.createGain();
  envAD(tg.gain, t, peak * 0.5, 0.005, 0.15);
  th.connect(tg);
  tg.connect(bus);
}

/**
 * undo —— 悔棋：倒放感的上滑音
 * "倒放感"的本质是**反向包络**：缓慢起音（0.3s swell）+ 骤然收尾，
 * 与自然打击声的"瞬起缓落"正好相反，大脑会解读为"时间倒流"。
 * 叠一个同步上扫的带通噪声，模拟磁带倒转的嘶声。
 */
function sfxUndo(t, o) {
  const bus = makeBus(WET.undo, o.pan, 1.0);
  const peak = LEVEL.undo * o.vol;
  const dur = 0.42;

  // 正弦上扫 220 → 660Hz
  const s = mkOsc('sine', 220 * o.pit, t, dur + 0.06);
  s.frequency.exponentialRampToValueAtTime(660 * o.pit, t + dur * 0.86);
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.78); // 缓慢 swell
  g.gain.exponentialRampToValueAtTime(FLOOR, t + dur + 0.05); // 骤收
  s.connect(g);
  g.connect(bus);

  // 三角波泛音层，让上滑更清晰可辨
  const s2 = mkOsc('triangle', 330 * o.pit, t, dur + 0.06);
  s2.frequency.exponentialRampToValueAtTime(990 * o.pit, t + dur * 0.86);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(FLOOR, t);
  g2.gain.exponentialRampToValueAtTime(peak * 0.3, t + dur * 0.78);
  g2.gain.exponentialRampToValueAtTime(FLOOR, t + dur + 0.05);
  s2.connect(g2);
  g2.connect(bus);

  // 倒带嘶声
  const n = mkNoise(t, dur + 0.06, 1);
  const bp = mkFilter('bandpass', 800, 2.4);
  bp.frequency.exponentialRampToValueAtTime(3600, t + dur * 0.86);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(FLOOR, t);
  ng.gain.exponentialRampToValueAtTime(peak * 0.22, t + dur * 0.78);
  ng.gain.exponentialRampToValueAtTime(FLOOR, t + dur + 0.05);
  n.connect(bp);
  bp.connect(ng);
  ng.connect(bus);
}

/**
 * start —— 开局：秦风号角动机（宫 → 徵 → 羽 → 宫'）
 * 四个音的上行五声动机，最后一个音拉长并加一记战鼓，形成"升帐点兵"的仪式感。
 * 大量送混响（0.45），把空间撑成宫殿而非棋桌。总时长 ≈ 1.2s。
 */
function sfxStart(t, o) {
  const bus = makeBus(WET.start, o.pan, 2.4);
  const peak = LEVEL.start * o.vol;
  const p = o.pit;

  // 开场鼓点，给号角一个落脚点
  warDrum(bus, t, 70 * p, 44 * p, peak * 0.8, 0.3);

  const motif = [
    { at: 0.06, f: PENTA.zhi3, d: 0.26 }, // 徵 G3
    { at: 0.32, f: PENTA.gong4, d: 0.24 }, // 宫 C4
    { at: 0.55, f: PENTA.shang4, d: 0.20 }, // 商 D4
    { at: 0.73, f: PENTA.zhi4, d: 0.46 } // 徵 G4（拉长收尾）
  ];
  for (let i = 0; i < motif.length; i++) {
    const m = motif[i];
    hornNote(bus, t + m.at, m.f * p, peak * (i === 3 ? 1 : 0.82), m.d);
  }

  // 收尾再补一记鼓，落定
  warDrum(bus, t + 0.73, 66 * p, 42 * p, peak * 0.62, 0.34);
}

/**
 * win —— 胜利：上行五声琶音 + 鼓点收尾，明亮，≈1.5s
 */
function sfxWin(t, o) {
  const bus = makeBus(WET.win, o.pan, 2.6);
  const peak = LEVEL.win * o.vol;
  const p = o.pit;

  const seq = [PENTA.gong4, PENTA.shang4, PENTA.jue4, PENTA.zhi4, PENTA.yu4, PENTA.gong5];
  for (let i = 0; i < seq.length; i++) {
    chimeNote(bus, t + i * 0.115, seq[i] * p, peak * (0.7 + i * 0.05), 0.5 + i * 0.09);
  }

  // 顶点再加一记大编钟，坐实"定局"
  bronzeBody(
    bus,
    t + 0.62,
    PENTA.gong5 * p,
    peak * 0.42,
    1.6,
    [
      [1.0, 0.6, 0.9],
      [1.19, 0.26, 0.7],
      [2.0, 0.3, 0.5],
      [2.76, 0.16, 0.32],
      [4.07, 0.08, 0.18]
    ],
    0
  );

  // 鼓点收尾：三连击加速，像凯旋的战鼓
  warDrum(bus, t + 0.86, 74 * p, 46 * p, peak * 0.72, 0.3);
  warDrum(bus, t + 1.04, 70 * p, 44 * p, peak * 0.6, 0.28);
  warDrum(bus, t + 1.18, 80 * p, 48 * p, peak * 0.86, 0.4);
}

/**
 * lose —— 失败：下行小调动机 + 低沉铜锣，≈1.6s
 * 用 A 小调下行（A4→G4→F4→E4）而非五声，制造五声语汇之外的"失序感"；
 * 音色改用低通更狠的号角（暗），最后一记长衰减铜锣把情绪压到底。
 */
function sfxLose(t, o) {
  const bus = makeBus(WET.lose, o.pan, 3.4);
  const peak = LEVEL.lose * o.vol;
  const p = o.pit;

  const seq = [
    { at: 0.0, f: 440.0, d: 0.3 },
    { at: 0.26, f: 392.0, d: 0.3 },
    { at: 0.52, f: 349.23, d: 0.32 },
    { at: 0.8, f: 329.63, d: 0.55 }
  ];
  for (let i = 0; i < seq.length; i++) {
    hornNote(bus, t + seq[i].at, seq[i].f * p * 0.5, peak * (0.85 - i * 0.06), seq[i].d);
  }

  // 低沉铜锣：基频比 check 更低，衰减更长，无颤音（死寂感）
  bronzeBody(
    bus,
    t + 0.78,
    132 * p,
    peak * 0.5,
    3.0,
    [
      [1.0, 0.6, 0.95],
      [1.44, 0.36, 0.8],
      [1.93, 0.26, 0.62],
      [2.55, 0.16, 0.44],
      [3.44, 0.1, 0.28]
    ],
    2.2
  );

  // 一记沉闷的收尾鼓
  warDrum(bus, t + 0.78, 54 * p, 33 * p, peak * 0.7, 0.5);
}

/* --------------------------------------------------------------------------
 * 6b. 阶段三：分兵种音效（差异化，贴合兵种特性）
 *     兵种 → 音色关键词：
 *       兵 脚步+衣甲摩擦 | 马 马蹄清脆 | 炮 绞盘木轴吱呀 | 车 车轮轰隆+马嘶
 *       象 沉重落步+振翅 | 士 软步+丝绸 | 帅 踏步+权威编钟
 *       吃子：兵 突刺、马 长矛、炮 落石、车 碾击、象 掌击、士 挥剑、士剑、帅 王剑
 *     统一复用 §5 积木（bronzeBody / warDrum / transient / hornNote），零新依赖。
 * ------------------------------------------------------------------------ */

/** 兵种类型 → 移动音效名映射（与 main.js 的 PT.* 对齐） */
const MOVE_SFX = {
  P: 'move.pawn', N: 'move.horse', B: 'move.elephant',
  A: 'move.advisor', R: 'move.rook', C: 'move.cannon', K: 'move.king'
};
/** 兵种类型 → 吃子音效名映射 */
const CAP_SFX = {
  P: 'capture.pawn', N: 'capture.horse', B: 'capture.elephant',
  A: 'capture.advisor', R: 'capture.rook', C: 'capture.cannon', K: 'capture.king'
};

/** 兵：持戈冲锋——两步软靴 + 衣甲摩擦 */
function sfxMovePawn(t, o) {
  const bus = makeBus(WET['move.pawn'], o.pan, 0.6);
  const peak = LEVEL['move.pawn'] * o.vol;
  for (let i = 0; i < 2; i++) {
    const at = t + i * 0.13;
    warDrum(bus, at, 110 * o.pit, 70 * o.pit, peak * 0.5, 0.10);
    transient(bus, at, 900 * o.pit, 1.2, peak * 0.4, 0.03, 1.0);
  }
  const n = mkNoise(t, 0.22, 1);
  const bp = mkFilter('bandpass', 1600 * o.pit, 1.4);
  const g = ctx.createGain();
  envAD(g.gain, t, peak * 0.10, 0.01, 0.18);
  n.connect(bp); bp.connect(g); g.connect(bus);
}

/** 马：骑兵——三记清脆马蹄 */
function sfxMoveHorse(t, o) {
  const bus = makeBus(WET['move.horse'], o.pan, 0.6);
  const peak = LEVEL['move.horse'] * o.vol;
  for (let i = 0; i < 3; i++) {
    const at = t + i * 0.10;
    transient(bus, at, 1300 * o.pit, 1.6, peak * 0.5, 0.02, 1.1);
    const s = mkOsc('sine', 90 * o.pit, at, 0.07);
    s.frequency.exponentialRampToValueAtTime(60 * o.pit, at + 0.05);
    const g = ctx.createGain();
    envAD(g.gain, at, peak * 0.4, 0.002, 0.05);
    s.connect(g); g.connect(bus);
  }
}

/** 炮：绞盘木轴——低沉呻吟 + 木头吱呀 */
function sfxMoveCannon(t, o) {
  const bus = makeBus(WET['move.cannon'], o.pan, 0.8);
  const peak = LEVEL['move.cannon'] * o.vol;
  const o1 = mkOsc('sawtooth', 70 * o.pit, t, 0.5);
  o1.frequency.linearRampToValueAtTime(58 * o.pit, t + 0.4);
  const lp = mkFilter('lowpass', 260, 2.4);
  const g = ctx.createGain();
  envAD(g.gain, t, peak * 0.5, 0.02, 0.4);
  o1.connect(lp); lp.connect(g); g.connect(bus);
  const n = mkNoise(t, 0.4, 0.9);
  const bp = mkFilter('bandpass', 520 * o.pit, 6);
  bp.frequency.linearRampToValueAtTime(900 * o.pit, t + 0.36);
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak * 0.18, 0.01, 0.34);
  n.connect(bp); bp.connect(ng); ng.connect(bus);
}

/** 车：整体冲锋——车轮轰隆 + 木轮骨碌 + 马嘶 */
function sfxMoveRook(t, o) {
  const bus = makeBus(WET['move.rook'], o.pan, 0.9);
  const peak = LEVEL['move.rook'] * o.vol;
  const n = mkNoise(t, 0.42, 0.8);
  const lp = mkFilter('lowpass', 220, 1.2);
  lp.frequency.linearRampToValueAtTime(140 * o.pit, t + 0.36);
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak * 0.4, 0.02, 0.36);
  n.connect(lp); lp.connect(ng); ng.connect(bus);
  for (let i = 0; i < 2; i++) transient(bus, t + i * 0.12, 1500 * o.pit, 1.8, peak * 0.4, 0.02, 1.1);
  warDrum(bus, t, 95 * o.pit, 64 * o.pit, peak * 0.4, 0.10);
}

/** 象：飞身——沉重落步 + 振翅呼扇 */
function sfxMoveElephant(t, o) {
  const bus = makeBus(WET['move.elephant'], o.pan, 0.9);
  const peak = LEVEL['move.elephant'] * o.vol;
  warDrum(bus, t, 84 * o.pit, 52 * o.pit, peak * 0.6, 0.22);
  const n = mkNoise(t, 0.34, 1);
  const bp = mkFilter('bandpass', 700 * o.pit, 0.9);
  bp.frequency.linearRampToValueAtTime(1500 * o.pit, t + 0.3);
  bp.frequency.linearRampToValueAtTime(600 * o.pit, t + 0.34);
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak * 0.22, 0.02, 0.3);
  n.connect(bp); bp.connect(ng); ng.connect(bus);
}

/** 士：稳步——软步 + 丝绸轻响 */
function sfxMoveAdvisor(t, o) {
  const bus = makeBus(WET['move.advisor'], o.pan, 0.5);
  const peak = LEVEL['move.advisor'] * o.vol;
  warDrum(bus, t, 120 * o.pit, 86 * o.pit, peak * 0.4, 0.08);
  const n = mkNoise(t, 0.18, 1);
  const bp = mkFilter('bandpass', 2400 * o.pit, 1.2);
  const g = ctx.createGain();
  envAD(g.gain, t, peak * 0.12, 0.01, 0.14);
  n.connect(bp); bp.connect(g); g.connect(bus);
}

/** 帅：起身移驾——踏步 + 权威小编钟 */
function sfxMoveKing(t, o) {
  const bus = makeBus(WET['move.king'], o.pan, 1.0);
  const peak = LEVEL['move.king'] * o.vol;
  warDrum(bus, t, 130 * o.pit, 84 * o.pit, peak * 0.55, 0.14);
  const cb = makeBus(WET['move.king'] * 0.8, o.pan, 1.0);
  bronzeBody(cb, t + 0.02, 660 * o.pit, peak * 0.5, 1,
    [[1.0, 0.6, 0.8], [1.19, 0.3, 0.65]], 0);
  transient(cb, t + 0.02, 4000 * o.pit, 1.6, peak * 0.25, 0.012, 1.3);
}

/** 兵吃子：持戈突刺——破空 + 肉感闷击 + 甲裂 */
function sfxCapturePawn(t, o) {
  const bus = makeBus(WET['capture.pawn'], o.pan, 1.0);
  const peak = LEVEL['capture.pawn'] * o.vol;
  const n = mkNoise(t, 0.16, 1);
  const bp = mkFilter('bandpass', 900 * o.pit, 1.4);
  bp.frequency.exponentialRampToValueAtTime(2600 * o.pit, t + 0.1);
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak * 0.3, 0.005, 0.12);
  n.connect(bp); bp.connect(ng); ng.connect(bus);
  warDrum(bus, t + 0.08, 95 * o.pit, 52 * o.pit, peak * 0.85, 0.18);
  transient(bus, t + 0.08, 2200 * o.pit, 1.4, peak * 0.4, 0.03, 1.1);
}

/** 马吃子：长矛突刺——破空 + 青铜交击 + 闷击 */
function sfxCaptureHorse(t, o) {
  const bus = makeBus(WET['capture.horse'], o.pan, 1.2);
  const peak = LEVEL['capture.horse'] * o.vol;
  const n = mkNoise(t, 0.18, 1);
  const bp = mkFilter('bandpass', 700 * o.pit, 1.3);
  bp.frequency.exponentialRampToValueAtTime(2400 * o.pit, t + 0.12);
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak * 0.34, 0.005, 0.14);
  n.connect(bp); bp.connect(ng); ng.connect(bus);
  warDrum(bus, t + 0.1, 90 * o.pit, 48 * o.pit, peak * 0.9, 0.2);
  const metal = [1800, 2700, 3700];
  for (let i = 0; i < metal.length; i++) {
    const f = metal[i] * o.pit * rand(0.98, 1.02);
    const m = mkOsc('square', f, t + 0.1, 0.2);
    const fb = mkFilter('bandpass', f, 6);
    const mg = ctx.createGain();
    envAD(mg.gain, t + 0.1 + i * 0.004, peak * (0.10 - i * 0.022), 0.002, 0.16 - i * 0.03);
    m.connect(fb); fb.connect(mg); mg.connect(bus);
  }
}

/** 炮吃子：抛石命中——落石轰隆 + 岩石迸裂 */
function sfxCaptureCannon(t, o) {
  const bus = makeBus(WET['capture.cannon'], o.pan, 1.6);
  const peak = LEVEL['capture.cannon'] * o.vol;
  warDrum(bus, t, 88 * o.pit, 40 * o.pit, peak * 0.95, 0.28);
  const n = mkNoise(t, 0.3, rand(0.9, 1.12));
  const lp = mkFilter('lowpass', 5000, 0.9);
  lp.frequency.exponentialRampToValueAtTime(600, t + 0.18);
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak * 0.6, 0.002, 0.2);
  n.connect(lp); lp.connect(ng); ng.connect(bus);
  transient(bus, t + 0.02, 1800 * o.pit, 1.0, peak * 0.4, 0.05, 1.0);
}

/** 车吃子：碾击——轰隆 + 兵刃格挡青铜 */
function sfxCaptureRook(t, o) {
  const bus = makeBus(WET['capture.rook'], o.pan, 1.4);
  const peak = LEVEL['capture.rook'] * o.vol;
  warDrum(bus, t, 96 * o.pit, 44 * o.pit, peak * 0.9, 0.24);
  const n = mkNoise(t, 0.26, 1);
  const lp = mkFilter('lowpass', 3600, 1.0);
  lp.frequency.exponentialRampToValueAtTime(700, t + 0.16);
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak * 0.55, 0.002, 0.18);
  n.connect(lp); lp.connect(ng); ng.connect(bus);
  const metal = [2100, 3100];
  for (let i = 0; i < metal.length; i++) {
    const f = metal[i] * o.pit;
    const m = mkOsc('square', f, t + 0.04, 0.18);
    const fb = mkFilter('bandpass', f, 6);
    const mg = ctx.createGain();
    envAD(mg.gain, t + 0.04, peak * 0.08, 0.002, 0.14);
    m.connect(fb); fb.connect(mg); mg.connect(bus);
  }
}

/** 象吃子：一掌击碎——厚重掌击 + 碎裂 */
function sfxCaptureElephant(t, o) {
  const bus = makeBus(WET['capture.elephant'], o.pan, 1.3);
  const peak = LEVEL['capture.elephant'] * o.vol;
  const s = mkOsc('sine', 70 * o.pit, t, 0.22);
  s.frequency.exponentialRampToValueAtTime(40 * o.pit, t + 0.14);
  const g = ctx.createGain();
  envAD(g.gain, t, peak * 0.95, 0.004, 0.18);
  s.connect(g); g.connect(bus);
  const n = mkNoise(t, 0.18, 1);
  const lp = mkFilter('lowpass', 3000, 1.0);
  lp.frequency.exponentialRampToValueAtTime(500, t + 0.12);
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak * 0.5, 0.002, 0.14);
  n.connect(lp); lp.connect(ng); ng.connect(bus);
}

/** 士吃子：挥剑斩——剑刃破空 + 青铜剑击 */
function sfxCaptureAdvisor(t, o) {
  const bus = makeBus(WET['capture.advisor'], o.pan, 1.1);
  const peak = LEVEL['capture.advisor'] * o.vol;
  const n = mkNoise(t, 0.18, 1);
  const bp = mkFilter('bandpass', 1400 * o.pit, 1.2);
  bp.frequency.exponentialRampToValueAtTime(3400 * o.pit, t + 0.12);
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak * 0.4, 0.004, 0.14);
  n.connect(bp); bp.connect(ng); ng.connect(bus);
  warDrum(bus, t + 0.1, 100 * o.pit, 56 * o.pit, peak * 0.8, 0.18);
  bronzeBody(bus, t + 0.1, 420 * o.pit, peak * 0.4, 1,
    [[1.0, 0.6, 0.8], [1.6, 0.3, 0.6], [2.4, 0.18, 0.4]], 0);
}

/** 帅吃子：王剑斩——剑刃破空 + 权威青铜 */
function sfxCaptureKing(t, o) {
  const bus = makeBus(WET['capture.king'], o.pan, 1.5);
  const peak = LEVEL['capture.king'] * o.vol;
  const n = mkNoise(t, 0.2, 1);
  const bp = mkFilter('bandpass', 1200 * o.pit, 1.1);
  bp.frequency.exponentialRampToValueAtTime(3200 * o.pit, t + 0.14);
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak * 0.42, 0.004, 0.16);
  n.connect(bp); bp.connect(ng); ng.connect(bus);
  warDrum(bus, t + 0.1, 104 * o.pit, 56 * o.pit, peak * 0.85, 0.22);
  bronzeBody(bus, t + 0.1, 500 * o.pit, peak * 0.5, 1.2,
    [[1.0, 0.6, 0.85], [1.42, 0.34, 0.7], [2.0, 0.22, 0.5]], 0);
}

/** 音效分发表 */
const VOICES = {
  select: sfxSelect,
  hover: sfxHover,
  move: sfxMove,
  capture: sfxCapture,
  check: sfxCheck,
  illegal: sfxIllegal,
  undo: sfxUndo,
  start: sfxStart,
  win: sfxWin,
  lose: sfxLose,
  // —— 阶段三：分兵种移动 ——
  'move.pawn': sfxMovePawn,
  'move.horse': sfxMoveHorse,
  'move.cannon': sfxMoveCannon,
  'move.rook': sfxMoveRook,
  'move.elephant': sfxMoveElephant,
  'move.advisor': sfxMoveAdvisor,
  'move.king': sfxMoveKing,
  // —— 阶段三：分兵种吃子 ——
  'capture.pawn': sfxCapturePawn,
  'capture.horse': sfxCaptureHorse,
  'capture.cannon': sfxCaptureCannon,
  'capture.rook': sfxCaptureRook,
  'capture.elephant': sfxCaptureElephant,
  'capture.advisor': sfxCaptureAdvisor,
  'capture.king': sfxCaptureKing
};

/* --------------------------------------------------------------------------
 * 7. 环境氛围层（可选加分项）
 *    极轻的低频风声 + 偶尔的远处鼓点，营造"空旷军帐"的底噪。
 *    通过 SFX.setAmbient(bool) 开关，独立于音效音量之外再压低一档。
 * ------------------------------------------------------------------------ */

function startAmbient() {
  if (!ready || ambientNodes) return;

  const out = ctx.createGain();
  out.gain.setValueAtTime(FLOOR, ctx.currentTime);
  out.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 1.5); // 1.5s 淡入
  out.connect(dryBus);

  const send = ctx.createGain();
  send.gain.value = WET.ambient;
  out.connect(send);
  send.connect(convolver);

  // 风声：慢速噪声 → 低通（截止频率被 LFO 缓慢推拉）→ 幅度也被另一 LFO 呼吸
  const wind = ctx.createBufferSource();
  wind.buffer = noiseBuf;
  wind.loop = true;
  wind.playbackRate.value = 0.32; // 放慢播放 = 更低沉的风
  const wlp = mkFilter('lowpass', 300, 1.6);
  const wg = ctx.createGain();
  wg.gain.value = 0.55;

  const lfoF = mkOscInfinite('sine', 0.055);
  const lfoFg = ctx.createGain();
  lfoFg.gain.value = 130;
  lfoF.connect(lfoFg);
  lfoFg.connect(wlp.frequency);

  const lfoA = mkOscInfinite('sine', 0.083);
  const lfoAg = ctx.createGain();
  lfoAg.gain.value = 0.28;
  lfoA.connect(lfoAg);
  lfoAg.connect(wg.gain);

  wind.connect(wlp);
  wlp.connect(wg);
  wg.connect(out);
  wind.start();

  ambientNodes = { out, send, wind, wlp, wg, lfoF, lfoFg, lfoA, lfoAg };

  // 远处鼓点：每 6~14 秒一记，电平极低且大量送混响 → 听感"很远"
  const tick = () => {
    if (!ambientNodes) return;
    const t = t0();
    warDrum(ambientNodes.out, t, rand(52, 64), rand(34, 40), 0.16, 0.42);
    ambientTimer = setTimeout(tick, rand(6000, 14000));
  };
  ambientTimer = setTimeout(tick, rand(3000, 7000));
}

function stopAmbient() {
  if (!ambientNodes) return;
  const n = ambientNodes;
  ambientNodes = null;
  if (ambientTimer) {
    clearTimeout(ambientTimer);
    ambientTimer = 0;
  }
  const t = ctx.currentTime;
  try {
    n.out.gain.cancelScheduledValues(t);
    n.out.gain.setValueAtTime(Math.max(n.out.gain.value, FLOOR), t);
    n.out.gain.exponentialRampToValueAtTime(FLOOR, t + 0.8); // 0.8s 淡出，不咔哒
  } catch (e) {
    /* ignore */
  }
  setTimeout(() => {
    try {
      n.wind.stop();
    } catch (e) {
      /* ignore */
    }
    [n.lfoF, n.lfoA].forEach((o) => {
      try {
        o.stop();
      } catch (e) {
        /* ignore */
      }
    });
    Object.keys(n).forEach((k) => {
      try {
        n[k].disconnect();
      } catch (e) {
        /* ignore */
      }
    });
  }, 1000);
}

/** 创建一个不自动停止的振荡器（用于 LFO / 长循环层） */
function mkOscInfinite(type, freq) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.start();
  return o;
}

/* --------------------------------------------------------------------------
 * 8. 对外单例
 * ------------------------------------------------------------------------ */

export const SFX = {
  /**
   * 懒初始化。必须在**首次用户手势**（click / keydown / pointerdown）的
   * 同步调用栈中执行一次，否则浏览器自动播放策略会让 AudioContext 停在
   * suspended。重复调用安全：已存在则尝试 resume。
   * @returns {boolean} 是否可用
   */
  init() {
    if (ready) {
      // 某些浏览器切标签页后会自动 suspend，这里顺手恢复
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    loadSettings();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false; // 老浏览器：静默降级为"无声"，不抛错
    try {
      ctx = new AC();
      buildGraph();
      ready = true;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      if (settings.ambient) startAmbient();
      return true;
    } catch (e) {
      ctx = null;
      ready = false;
      return false;
    }
  },

  /**
   * 播放音效。
   * @param {string} name 'select'|'hover'|'move'|'capture'|'check'|'illegal'|'undo'|'start'|'win'|'lose'
   * @param {object} [opts]
   * @param {number} [opts.volume=1] 相对音量倍率（0..2）
   * @param {number} [opts.pitch=1]  音高倍率（0.5=低八度，2=高八度）
   * @param {number} [opts.pan=0]    声像 -1(左)..1(右)，可按棋子所在纵线定位
   * @returns {boolean} 是否真的发声
   */
  play(name, opts) {
    // 未初始化 / 已静音 / 未知音效：一律静默返回，绝不抛错
    if (!ready || !ctx || !settings.enabled) return false;
    const voice = VOICES[name];
    if (!voice) return false;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
      return false;
    }

    // 节流：同名音效 30ms 内只放一次
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (lastFired[name] && now - lastFired[name] < THROTTLE_MS) return false;
    lastFired[name] = now;

    const p = opts || {};
    // 微随机化：频率 ±3%、音量 ±8%，消除机械重复感（Juice 的一部分）
    const o = {
      vol: clamp((typeof p.volume === 'number' ? p.volume : 1) * rand(0.92, 1.08), 0, 2),
      pit: (typeof p.pitch === 'number' && p.pitch > 0 ? p.pitch : 1) * rand(0.97, 1.03),
      pan: clamp(typeof p.pan === 'number' ? p.pan : 0, -1, 1)
    };

    try {
      voice(t0(), o);
      return true;
    } catch (e) {
      // 任何单次合成失败都不允许影响游戏主循环
      return false;
    }
  },

  /**
   * 按兵种播放移动音效（阶段三）。
   * @param {string} type PT.* 之一（'P'|'N'|'B'|'A'|'R'|'C'|'K'）
   * @param {object} [opts] 同 play()
   */
  move(type, opts) {
    return this.play(MOVE_SFX[type] || 'move', opts);
  },

  /**
   * 按兵种播放吃子音效（阶段三）。
   * @param {string} type PT.* 之一
   * @param {object} [opts] 同 play()
   */
  capture(type, opts) {
    return this.play(CAP_SFX[type] || 'capture', opts);
  },

  /** 静音开关（可在 init 之前调用，会被持久化） */
  setEnabled(v) {
    settings.enabled = !!v;
    saveSettings();
    if (!settings.enabled) {
      stopAmbient();
    } else if (ready && settings.ambient) {
      startAmbient();
    }
    return settings.enabled;
  },

  /** @returns {boolean} */
  isEnabled() {
    return settings.enabled;
  },

  /** 主音量 0..1（可在 init 之前调用，会被持久化） */
  setVolume(v) {
    const n = clamp(typeof v === 'number' && isFinite(v) ? v : 0, 0, 1);
    settings.volume = n;
    saveSettings();
    if (masterGain && ctx) {
      const t = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(masterGain.gain.value, t);
      masterGain.gain.linearRampToValueAtTime(n * HEADROOM, t + 0.05); // 平滑，防跳变爆音
    }
    return n;
  },

  /* ---------- 以下为契约之外的附加 API（可选） ---------- */

  /** @returns {number} 当前主音量 0..1 */
  getVolume() {
    return settings.volume;
  },

  /** @returns {boolean} AudioContext 是否已就绪 */
  isReady() {
    return ready;
  },

  /**
   * 环境氛围层开关：极轻的低频风声 + 每 6~14s 一记远处战鼓。
   * 状态同样持久化到 localStorage。
   */
  setAmbient(v) {
    settings.ambient = !!v;
    saveSettings();
    if (settings.ambient && settings.enabled) startAmbient();
    else stopAmbient();
    return settings.ambient;
  },

  /** @returns {boolean} */
  isAmbient() {
    return settings.ambient;
  },

  /** 应急：立即静音所有正在发声的内容（主音量瞬时拉到地板再恢复） */
  stopAll() {
    if (!ready || !ctx) return;
    stopAmbient();
    const t = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setValueAtTime(masterGain.gain.value, t);
    masterGain.gain.linearRampToValueAtTime(FLOOR, t + 0.02);
    masterGain.gain.linearRampToValueAtTime(settings.volume * HEADROOM, t + 0.24);
  }
};

// 模块加载即读取持久化设置，便于 UI 在 init 之前就能正确渲染音量/静音状态
loadSettings();

export default SFX;
