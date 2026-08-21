/* ==========================================================================
 * qin-chess-3d · src/audio/sfx.js
 * 秦风 · 中国象棋 —— 纯 WebAudio 程序化战场音效引擎 v2
 *
 * 设计文档: design/audio-system-v2.md
 * 数据表:   ./recipes.js
 *
 * 核心设计:
 *   1. 100% WebAudio，零外部音频文件
 *   2. 四层混音架构 T/C/B/S，层间频率隔离 + 时间偏移
 *   3. 程序化石殿混响 IR（1.5s 立体声）
 *   4. hitFreeze 音频冻结（低通 + ducking，不拉伸时间）
 *   5. 数据集驱动：renderBeat() 按 recipes.js 参数统一执行
 * ========================================================================== */

import {
  FACTION_SHIFT, PIECE_NAMES, ALL_PIECES,
  PARTIALS, LEVEL, WET, ARMOR_PRESETS, ARMOR_LAND_PRESETS,
  ARMOR_FALL_PRESETS, DRUM_PRESETS, WEAPON_PARAMS,
  THUD_PARAMS, VICTIM_WEIGHTS, VICTIM_COLLAPSE,
  PENTA, BEAT_RECIPES, SEQUENCES
} from './recipes.ts';
import { getSample, bindSampleContext, preloadSamples, sampleStats, SAMPLE_MANIFEST } from './sampleBank.ts';

/* --------------------------------------------------------------------------
 * 0. 常量与模块级状态
 * ------------------------------------------------------------------------ */

const LS_KEY = 'qin-chess-audio';
const THROTTLE_MS = 30;
const HEADROOM = 0.9;
const IR_SECONDS = 1.5;
const FLOOR = 0.0001;
const MAX_ACTIVE_NODES = 140;

/** 数值消毒：非有限（NaN/Infinity）或缺失 → 回退默认值。
 *  包络/exponentialRamp 对 NaN/0/负值零容忍，必须先把峰值/音高夹成有限正值。 */
function finite(v: any, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
/** 夹成有限正值（exponentialRampToValueAtTime 要求严格 >0） */
function pos(v: any, d: number): number {
  const n = finite(v, d);
  return n > 0 ? n : d;
}

/** 冲击级对应的线性峰值上限 */
const IMPACT_PEAKS = {
  W0: 0.050,   // 无感底噪
  W1: 0.16,    // 微
  W2: 0.28,    // 轻
  W3: 0.42,    // 中
  W4: 0.60,    // 重
  W5: 0.72     // 极重
};

/* --- 音频上下文 --- */
let ctx: any = null;
let ready = false;
let hasPanner = false;
let hasPanner3D = false;
let activeNodeCount = 0;

/* --- 3D 定位状态（C2：松耦合，坐标由调用方传入，不 import render） --- */
let sourceWorldPos: { x: number, y: number, z: number } | null = null;

/* --- 总线节点 --- */
let hitBus: any = null;
let sfxBus: any = null;
let sfxDuck: any = null;
let hitLP: any = null;
let idleBus: any = null;
let idleDuck: any = null;
let ambientBus: any = null;
let ambLimit: any = null;
let ambDuck: any = null;
let masterGain: any = null;
let compressor: any = null;
let dryBus: any = null;
let wetBus: any = null;
let convolver: any = null;

/* --- 共享资源 --- */
let noiseBuf: any = null;
let irBuf: any = null;

/* --- 运行时状态 --- */
let currentTone: any = null;
let currentFaction: any = null;
const lastFired = new Map();  // 节流记录
let activeHandles: any[] = [];
let nodeCount = 0;

/* --- 持久化设置 --- */
const settings = {
  enabled: true,
  volume: 0.8,
  ambient: true
};

/* --- 降级 --- */
let degradation = 'full';    // 'full' | 'lean' | 'off'

/* --------------------------------------------------------------------------
 * 1. 小工具
 * ------------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const t0 = () => ctx.currentTime + 0.002;

function loadSettings(): void {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (typeof o.enabled === 'boolean') settings.enabled = o.enabled;
    if (typeof o.volume === 'number' && isFinite(o.volume)) settings.volume = clamp(o.volume, 0, 1);
    if (typeof o.ambient === 'boolean') settings.ambient = o.ambient;
  } catch (e) { /* 静默降级 */ }
}

function saveSettings(): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) { /* 忽略 */ }
}

/** 记录活跃节点（估算） */
function trackNodes(n: number): void {
  nodeCount += n;
  if (nodeCount < 0) nodeCount = 0;
}

/* --------------------------------------------------------------------------
 * 2. 程序化资源：白噪声 + 混响 IR
 * ------------------------------------------------------------------------ */

function buildNoiseBuffer(): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function buildImpulseResponse(stereo: boolean, duration: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * duration);
  const chs = stereo ? 2 : 1;
  const ir = ctx.createBuffer(chs, len, rate);
  const preDelay = Math.floor(rate * 0.012);

  for (let ch = 0; ch < chs; ch++) {
    const data = ir.getChannelData(ch);
    const decay = ch === 0 ? 5.2 : 4.9;
    let lp = 0;
    const lpCoef = stereo ? (ch === 0 ? 0.38 : 0.41) : 0.39;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const n = Math.random() * 2 - 1;
      lp += (n - lp) * lpCoef;
      let amp = Math.pow(1 - t, decay);
      if (i < preDelay) amp *= i / preDelay;
      data[i] = lp * amp;
    }
  }
  return ir;
}

/* --------------------------------------------------------------------------
 * 3. 总线拓扑搭建
 * ------------------------------------------------------------------------ */

function buildGraph(): void {
  /* --- 主链 --- */
  masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(settings.volume * HEADROOM, ctx.currentTime);

  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-12, ctx.currentTime);
  compressor.knee.setValueAtTime(26, ctx.currentTime);
  compressor.ratio.setValueAtTime(8, ctx.currentTime);
  compressor.attack.setValueAtTime(0.003, ctx.currentTime);
  compressor.release.setValueAtTime(0.16, ctx.currentTime);

  masterGain.connect(compressor);
  compressor.connect(ctx.destination);

  /* --- 命中总线（不受 hitLP/sfxDuck 影响）--- */
  hitBus = ctx.createGain();
  hitBus.gain.setValueAtTime(1.0, ctx.currentTime);
  hitBus.connect(masterGain);

  /* --- 前景音效总线 --- */
  sfxBus = ctx.createGain();
  sfxBus.gain.setValueAtTime(1.0, ctx.currentTime);

  hitLP = ctx.createBiquadFilter();
  hitLP.type = 'lowpass';
  hitLP.frequency.setValueAtTime(20000, ctx.currentTime);
  hitLP.Q.setValueAtTime(0.7, ctx.currentTime);

  sfxDuck = ctx.createGain();
  sfxDuck.gain.setValueAtTime(1.0, ctx.currentTime);

  sfxBus.connect(hitLP);
  hitLP.connect(sfxDuck);
  sfxDuck.connect(masterGain);

  /* --- 混响 --- */
  dryBus = ctx.createGain();
  dryBus.gain.setValueAtTime(1.0, ctx.currentTime);
  dryBus.connect(masterGain);

  convolver = ctx.createConvolver();
  convolver.normalize = true;
  convolver.buffer = buildImpulseResponse(true, IR_SECONDS);

  wetBus = ctx.createGain();
  wetBus.gain.setValueAtTime(0.95, ctx.currentTime);
  convolver.connect(wetBus);
  wetBus.connect(masterGain);

  /* --- 待机总线 --- */
  idleBus = ctx.createGain();
  idleBus.gain.setValueAtTime(0.85, ctx.currentTime);

  idleDuck = ctx.createGain();
  idleDuck.gain.setValueAtTime(1.0, ctx.currentTime);

  idleBus.connect(idleDuck);
  idleDuck.connect(masterGain);

  /* --- 环境总线 --- */
  ambientBus = ctx.createGain();
  ambientBus.gain.setValueAtTime(0.70, ctx.currentTime);

  ambLimit = ctx.createDynamicsCompressor();
  ambLimit.threshold.setValueAtTime(-18, ctx.currentTime);
  ambLimit.ratio.setValueAtTime(12, ctx.currentTime);
  ambLimit.attack.setValueAtTime(0.002, ctx.currentTime);
  ambLimit.release.setValueAtTime(0.09, ctx.currentTime);
  ambLimit.knee.setValueAtTime(4, ctx.currentTime);

  ambDuck = ctx.createGain();
  ambDuck.gain.setValueAtTime(1.0, ctx.currentTime);

  ambientBus.connect(ambLimit);
  ambLimit.connect(ambDuck);
  ambDuck.connect(masterGain);

  /* --- 全局限幅 --- */
  const ambHP = ctx.createBiquadFilter();
  ambHP.type = 'highpass';
  ambHP.frequency.setValueAtTime(55, ctx.currentTime);
  ambHP.Q.setValueAtTime(0.7, ctx.currentTime);

  const ambHS = ctx.createBiquadFilter();
  ambHS.type = 'highshelf';
  ambHS.frequency.setValueAtTime(2200, ctx.currentTime);
  ambHS.gain.setValueAtTime(-9, ctx.currentTime);

  // 将环境总线重新连接以插入全局滤波
  ambientBus.disconnect();
  ambientBus.connect(ambHP);
  ambHP.connect(ambHS);
  ambHS.connect(ambLimit);
  ambLimit.connect(ambDuck);
  ambDuck.connect(masterGain);

  /* --- 共享噪声缓冲 --- */
  noiseBuf = buildNoiseBuffer();
  irBuf = convolver.buffer;
  hasPanner = typeof ctx.createStereoPanner === 'function';
  // C2：PannerNode 3D 能力检测（Safari/WebKit 受限环境 → StereoPanner 回退）
  hasPanner3D = typeof ctx.createPanner === 'function';
}

/* --------------------------------------------------------------------------
 * 4. makeBus —— 创建独立声部总线
 *
 *    为一次发声创建: voiceBus → (panner) → dryBus / send → convolver → wetBus
 *    按阵营插入滤波: 红 highshelf(+8dB@3.4kHz) / 黑 lowpass(2.4kHz, Q0.7)
 *
 *    C2 升级：hasPanner3D 且提供 worldPos 时走 PannerNode（HRTF/inverse/
 *    refDistance=1格/maxDistance=10格/rolloff=1.5）；否则回退 StereoPanner
 *    （标量 pan）—— 全平台可玩，零破坏。
 * ------------------------------------------------------------------------ */

/** 设置 PannerNode 位置（兼容 positionX AudioParam 与旧 setPosition 两代 API） */
function setPannerPosition(p: any, pos: { x: number, y: number, z: number }): void {
  if (!ctx || !pos) return;
  const t = ctx.currentTime;
  try {
    if (p.positionX && typeof p.positionX.setValueAtTime === 'function') {
      p.positionX.setValueAtTime(pos.x, t);
      p.positionY.setValueAtTime(pos.y, t);
      p.positionZ.setValueAtTime(pos.z, t);
    } else if (typeof p.setPosition === 'function') {
      p.setPosition(pos.x, pos.y, pos.z);
    }
  } catch (e) { /* 静默：位置设置失败不影响发声 */ }
}

/** 更新 AudioListener 位置与朝向（由 main.js 每帧传相机 world pos；Safari 回退无操作） */
function setListener(position: { x: number, y: number, z: number },
                     forward?: { x: number, y: number, z: number },
                     up?: { x: number, y: number, z: number }): void {
  if (!ctx || !hasPanner3D) return;
  const l = ctx.listener;
  if (!l) return;
  const t = ctx.currentTime;
  try {
    if (l.positionX && typeof l.positionX.setValueAtTime === 'function') {
      l.positionX.setValueAtTime(position.x, t);
      l.positionY.setValueAtTime(position.y, t);
      l.positionZ.setValueAtTime(position.z, t);
      if (forward && l.forwardX && typeof l.forwardX.setValueAtTime === 'function') {
        l.forwardX.setValueAtTime(forward.x, t);
        l.forwardY.setValueAtTime(forward.y, t);
        l.forwardZ.setValueAtTime(forward.z, t);
      }
      if (up && l.upX && typeof l.upX.setValueAtTime === 'function') {
        l.upX.setValueAtTime(up.x, t);
        l.upY.setValueAtTime(up.y, t);
        l.upZ.setValueAtTime(up.z, t);
      }
    } else if (typeof l.setPosition === 'function') {
      l.setPosition(position.x, position.y, position.z);
      if (forward && up && typeof l.setOrientation === 'function') {
        l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
      }
    }
  } catch (e) { /* 静默 */ }
}

function makeBus(wet: number, pan: number, life: number, faction: string, busTarget?: string, worldPos?: { x: number, y: number, z: number } | null): any {
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(1.0, ctx.currentTime);
  trackNodes(1);

  let input = bus;

  // 阵营音色滤波
  const tone = currentTone;
  if (tone === 'bright') {
    const f = ctx.createBiquadFilter();
    f.type = 'highshelf';
    f.frequency.setValueAtTime(3400, ctx.currentTime);
    f.Q.setValueAtTime(0.7, ctx.currentTime);
    f.gain.setValueAtTime(8, ctx.currentTime);
    f.connect(bus);
    input = f;
    trackNodes(1);
  } else if (tone === 'dark') {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, ctx.currentTime);
    f.Q.setValueAtTime(0.7, ctx.currentTime);
    f.connect(bus);
    input = f;
    trackNodes(1);
  }

  let tail = bus;

  // C2：PannerNode 3D 定位（HRTF / inverse / refDistance=1格 / maxDistance=10格 / rolloff=1.5）
  // 仅当 hasPanner3D 且提供世界坐标时启用；否则回退 StereoPanner（标量 pan）—— 零破坏
  if (hasPanner3D && worldPos) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1;
    p.maxDistance = 10;
    p.rolloffFactor = 1.5;
    setPannerPosition(p, worldPos);
    bus.connect(p);
    tail = p;
    trackNodes(1);
  } else if (hasPanner && pan) {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(clamp(pan, -1, 1), ctx.currentTime);
    bus.connect(p);
    tail = p;
    trackNodes(1);
  }

  // 路由到目标总线
  const targetBus = busTarget === 'hitBus' ? hitBus :
                    busTarget === 'idleBus' ? idleBus :
                    busTarget === 'ambientBus' ? ambientBus : sfxBus;

  tail.connect(targetBus);

  if (wet > 0.001) {
    const send = ctx.createGain();
    send.gain.setValueAtTime(wet, ctx.currentTime);
    tail.connect(send);
    send.connect(convolver);
    trackNodes(1);
  }

  return { input, tail, bus, life };
}

/** 节点释放 */
function scheduleRelease(nodes: any, lifeMs: number): void {
  const ms = Math.max(60, lifeMs + 350);
  const collected = Array.isArray(nodes) ? nodes : Object.values(nodes).filter((n: any) => n && typeof n.disconnect === 'function');
  setTimeout(() => {
    for (const n of collected) {
      try { n.disconnect(); } catch (e) { /* 已断开 */ }
    }
    trackNodes(-collected.length);
  }, ms);
}

/* --------------------------------------------------------------------------
 * 5. 包络原语（全部用 setValueAtTime + ramp）--- */

function envAD(param: any, t: number, peak: number, attack: number, decay: number): void {
  const p = Math.max(Number.isFinite(peak) ? peak : FLOOR * 2, FLOOR * 2);
  const a = Math.max(finite(attack, 0.005), 0.001);
  const d = Math.max(finite(decay, 0.05), 0.001);
  param.setValueAtTime(FLOOR, t);
  param.exponentialRampToValueAtTime(p, t + a);
  param.exponentialRampToValueAtTime(FLOOR, t + a + d);
}

function envASR(param: any, t: number, peak: number, attack: number, hold: number, release: number): void {
  const p = Math.max(Number.isFinite(peak) ? peak : FLOOR * 2, FLOOR * 2);
  const a = Math.max(finite(attack, 0.005), 0.001);
  const h = Math.max(finite(hold, 0.05), 0.001);
  const r = Math.max(finite(release, 0.05), 0.001);
  param.setValueAtTime(FLOOR, t);
  param.exponentialRampToValueAtTime(p, t + a);
  param.setValueAtTime(p, t + a + h);
  param.exponentialRampToValueAtTime(FLOOR, t + a + h + r);
}

function envReverse(param: any, t: number, peak: number, attack: number, decay: number): void {
  const p = Math.max(Number.isFinite(peak) ? peak : FLOOR * 2, FLOOR * 2);
  const a = Math.max(finite(attack, 0.005), 0.001);
  const d = Math.max(finite(decay, 0.05), 0.001);
  param.setValueAtTime(FLOOR, t);
  param.exponentialRampToValueAtTime(p, t + a);
  param.exponentialRampToValueAtTime(FLOOR, t + a + d);
}

/* --------------------------------------------------------------------------
 * 6. 低频辅助函数 --- */

function mkOsc(type: string, freq: number, t: number, dur: number, detune?: number): any {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(pos(freq, 220), t);
  if (detune != null) o.detune.setValueAtTime(finite(detune, 0), t);
  o.start(t);
  o.stop(t + dur + 0.05);
  trackNodes(1);
  return o;
}

function mkNoise(t: number, dur: number, rate?: number): any {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.playbackRate.setValueAtTime(pos(rate, 1), t);
  s.start(t, rand(0, 1.4));
  s.stop(t + dur + 0.02);
  trackNodes(1);
  return s;
}

function mkFilter(type: string, freq: number, q?: number): any {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(pos(freq, 1000), ctx.currentTime);
  if (q != null) f.Q.setValueAtTime(finite(q, 0.7), ctx.currentTime);
  trackNodes(1);
  return f;
}

function mkOscInfinite(type: string, freq: number): any {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime);
  o.start();
  trackNodes(1);
  return o;
}

/* --------------------------------------------------------------------------
 * 7. 音效积木函数 —— 全部纯 WebAudio 程序化合成
 * ------------------------------------------------------------------------ */

/**
 * leatherCreak —— 皮革吱呀（滤波噪声 + 非线性起音）
 * @param {object} dest      { input, tail }
 * @param {number} t         起始时间
 * @param {number} cf        中心频率
 * @param {number} q         Q值
 * @param {number} peak      峰值增益
 * @param {number} dur       持续时间
 * @param {number} grain     颗粒数量
 * @param {number} pit       音高倍率
 */
function leatherCreak(dest: any, t: number, cf: number, q: number, peak: number, dur: number, grain: number, pit: number): void {
  for (let i = 0; i < grain; i++) {
    const dt = t + i * (dur / grain) * rand(0.85, 1.15);
    const dd = dur * 0.3 * rand(0.7, 1.3);
    const n = mkNoise(dt, dd + 0.01, rand(0.95, 1.08));
    const bp = mkFilter('bandpass', cf * pit * rand(0.94, 1.06), q);
    const g = ctx.createGain();
    envAD(g.gain, dt, peak * (0.7 + rand(0, 0.3)), 0.005, dd);
    n.connect(bp); bp.connect(g); g.connect(dest.input);
    trackNodes(3);
    scheduleRelease([n, bp, g], (dd + 0.35) * 1000);
  }
}

/**
 * bladeClash —— 兵器交击（不谐和泛音列 + 摩擦噪声）
 */
function bladeClash(dest: any, t: number, base: number, peak: number, dur: number, grind: number, partialsKey: string, pit: number): void {
  const partials = PARTIALS[partialsKey];
  if (!partials) return;

  for (let i = 0; i < partials.length; i++) {
    const [ratio, w, dw] = partials[i]!;
    const d = dw * 0.8 + grind * 0.6;
    // 每个泛音叠一对微失谐孪生，增加金属"厚度"与 beating
    const dets = [-5, 6];
    for (let j = 0; j < dets.length; j++) {
      const o = mkOsc('sine', base * ratio * pit * rand(0.997, 1.003), t, d + 0.05, dets[j]!);
      const g = ctx.createGain();
      envAD(g.gain, t, peak * w * 0.6, 0.004, d);
      o.connect(g); g.connect(dest.input);
      trackNodes(2);
      scheduleRelease([o, g], (d + 0.35) * 1000);
    }
  }

  // 摩擦刮擦噪声
  if (grind > 0.05) {
    const n = mkNoise(t, dur * 1.2, rand(0.9, 1.1));
    const bp = mkFilter('bandpass', base * 1.8 * pit, 2.4);
    const ng = ctx.createGain();
    envAD(ng.gain, t, peak * grind, 0.006, dur);
    n.connect(bp); bp.connect(ng); ng.connect(dest.input);
    trackNodes(3);
    scheduleRelease([n, bp, ng], (dur + 0.35) * 1000);
  }

  // 金属磨砂"grit"：更亮更高 Q 的带通噪声，让交击有颗粒感
  const gn = mkNoise(t, dur * 1.4, rand(0.9, 1.1));
  const gbp = mkFilter('bandpass', base * 3.2 * pit, 3.6);
  const gng = ctx.createGain();
  envAD(gng.gain, t, peak * (0.12 + grind * 0.5), 0.004, dur);
  gn.connect(gbp); gbp.connect(gng); gng.connect(dest.input);
  trackNodes(3);
  scheduleRelease([gn, gbp, gng], (dur + 0.35) * 1000);
}

/**
 * armorClink —— 甲片碰响声簇
 * @param {number} n       甲片数量
 * @param {number} f0      起始频率
 * @param {number} f1      结束频率
 * @param {number} peak    峰值
 * @param {number} spread  时间散布
 * @param {number} ring    衰减时长
 * @param {number} softAttack 软起音（士专用）
 * @param {boolean} forceHP 强制高通
 */
function armorClink(dest: any, t: number, n: number, f0: number, f1: number, peak: number, spread: number, ring: number, softAttack: number, forceHP: boolean, pit: number): void {
  const attackTime = softAttack || 0.001;

  for (let i = 0; i < n; i++) {
    const dt = t + i * spread * rand(0.5, 1.8);
    const f = f0 + ((f1 - f0) * i / (n - 1)) + rand(-80, 80);
    const dur = ring * rand(0.7, 1.3);
    const o = mkOsc('triangle', f * pit * rand(0.997, 1.003), dt, dur + 0.02, rand(-8, 8));
    const bp = mkFilter('bandpass', f * pit, 6);
    const g = ctx.createGain();
    if (forceHP) {
      const hp = mkFilter('highpass', 2200, 0.7);
      g.connect(hp);
      hp.connect(dest.input);
      trackNodes(1);
      scheduleRelease([hp], (dur + 0.35) * 1000);
    } else {
      g.connect(dest.input);
    }

    const pk = peak * (0.5 + rand(0, 0.5)) / n * 2;
    envAD(g.gain, dt, pk, attackTime + rand(0, 0.002), dur);
    o.connect(bp); bp.connect(g);
    trackNodes(3);
    scheduleRelease([o, bp, g], (dur + 0.35) * 1000);

    // 金属"沙"瞬态：增加甲片碰响的颗粒感
    const cn = mkNoise(dt, 0.03, rand(0.95, 1.05));
    const cbp = mkFilter('bandpass', f * pit * 2.2, 4);
    const cg = ctx.createGain();
    envAD(cg.gain, dt, pk * 0.3, 0.001, 0.025);
    cn.connect(cbp); cbp.connect(cg); cg.connect(dest.input);
    trackNodes(3);
    scheduleRelease([cn, cbp, cg], (0.06 + 0.35) * 1000);
  }
}

/**
 * woodKnock —— 木质敲击（短噪声 + 带通）
 */
function woodKnock(dest: any, t: number, f: number, peak: number, dur: number, pit: number): void {
  const n = mkNoise(t, dur + 0.03, rand(0.92, 1.1));
  const bp = mkFilter('bandpass', f * pit, 1.8);
  const g = ctx.createGain();
  envAD(g.gain, t, peak, 0.001, dur);
  n.connect(bp); bp.connect(g); g.connect(dest.input);
  trackNodes(3);
  scheduleRelease([n, bp, g], (dur + 0.35) * 1000);
}

/**
 * horseSnort —— 马鼻息（正弦 + 24Hz LFO 幅度调制）
 */
function horseSnort(dest: any, t: number, f: number, peak: number, dur: number, pit: number): void {
  const s = mkOsc('sine', f * pit, t, dur + 0.05);
  s.frequency.setValueAtTime(f * pit, t);
  // 鼻颤 LFO
  const lfo = mkOsc('sine', 24, t, dur + 0.05);
  const lfoG = ctx.createGain();
  lfoG.gain.setValueAtTime(0.3, t);
  lfo.connect(lfoG);
  lfoG.connect(s.frequency);

  const g = ctx.createGain();
  envAD(g.gain, t, peak, 0.015, dur);
  s.connect(g); g.connect(dest.input);
  trackNodes(4);
  scheduleRelease([s, lfo, lfoG, g], (dur + 0.4) * 1000);
}

/**
 * dustScuff —— 土/沙擦地（粉红噪声 + 带通扫频）
 */
function dustScuff(dest: any, t: number, f0: number, f1: number, q: number, peak: number, dur: number, attack: number, pit: number): void {
  // 低频"土"体腔：把擦地声从'嘶嘶'变成'闷扫'
  const lo = mkOsc('sine', 90 * pit, t, dur + 0.05);
  lo.frequency.setValueAtTime(90 * pit, t);
  lo.frequency.exponentialRampToValueAtTime(50 * pit, t + dur * 0.8);
  const loG = ctx.createGain();
  envAD(loG.gain, t, peak * 0.3, attack || 0.003, dur);
  lo.connect(loG); loG.connect(dest.input);
  trackNodes(2);
  scheduleRelease([lo, loG], (dur + 0.35) * 1000);

  const n = mkNoise(t, dur + 0.05, rand(0.95, 1.05));
  const bp = mkFilter('bandpass', f0 * pit, q);
  bp.frequency.setValueAtTime(f0 * pit, t);
  // 下扫 = 减速
  if (f1 < f0) {
    bp.frequency.exponentialRampToValueAtTime(f1 * pit, t + dur * 0.7);
  } else {
    bp.frequency.exponentialRampToValueAtTime(f1 * pit, t + dur);
  }
  const g = ctx.createGain();
  envAD(g.gain, t, peak, attack || 0.003, dur);
  n.connect(bp); bp.connect(g); g.connect(dest.input);
  trackNodes(3);
  scheduleRelease([n, bp, g], (dur + 0.35) * 1000);
}

/**
 * clothRustle —— 布帛摩擦（低相关宽带噪声）
 */
function clothRustle(dest: any, t: number, cf: number, q: number, peak: number, dur: number, attack: number, pit: number): void {
  const n = mkNoise(t, dur + 0.05, rand(0.96, 1.04));
  const bp = mkFilter('bandpass', cf * pit, q);
  const g = ctx.createGain();
  envAD(g.gain, t, peak, attack || 0.006, dur);
  n.connect(bp); bp.connect(g); g.connect(dest.input);
  trackNodes(3);
  scheduleRelease([n, bp, g], (dur + 0.35) * 1000);
}

/**
 * bannerFlap —— 旌旗拍打
 */
function bannerFlap(dest: any, t: number, n: number, cf: number, peak: number, pit: number, pan: number): void {
  for (let i = 0; i < n; i++) {
    const dt = t + i * rand(0.08, 0.21); // 4.8-11Hz
    const d = rand(0.04, 0.09);
    const noise = mkNoise(dt, d + 0.01, rand(1.2, 1.8));
    const bp = mkFilter('bandpass', cf * pit * rand(0.9, 1.1), 1.5);
    const g = ctx.createGain();
    envAD(g.gain, dt, peak * rand(0.5, 1.0), 0.002, d);
    noise.connect(bp); bp.connect(g); g.connect(dest.input);
    trackNodes(3);
    scheduleRelease([noise, bp, g], (d + 0.35) * 1000);
  }
}

/**
 * crowdBed —— 人群底噪（噪声三共振峰）
 */
function crowdBed(dest: any, t: number, peak: number, lp: number, dur: number, pit: number): void {
  const d = dur || 1.5;
  const n = mkNoise(t, d, rand(0.8, 1.0));
  const formants = [620, 1180, 2450];
  const g = ctx.createGain();
  envASR(g.gain, t, peak, 0.3, d * 0.4, d * 0.3);

  // 三个共振峰各一个带通
  const peaks = [];
  for (const fm of formants) {
    const bp = mkFilter('bandpass', fm * pit * rand(0.97, 1.03), 2.5);
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.33, t);
    bp.connect(pg);
    pg.connect(g);
    peaks.push(bp, pg);
    trackNodes(2);
  }
  // 总低通
  const lpF = mkFilter('lowpass', lp, 1.0);

  n.connect(lpF);
  lpF.connect(peaks[0]); // 串联任意一个带通作为入口
  g.connect(dest.input);
  trackNodes(3);
  scheduleRelease([n, lpF, g, ...peaks], (d + 0.5) * 1000);
}

/**
 * stoneCrush —— 石弹碎裂（木敲 + 沙扫 + 甲碎）
 */
function stoneCrush(dest: any, t: number, pit: number): void {
  // ① 木石相击
  woodKnock(dest, t, 520, 0.24, 0.06, pit);
  // ② 岩石迸裂
  dustScuff(dest, t + 0.01, 2600, 700, 1.2, 0.30, 0.20, 0.002, pit);
  // ③ 碎石飞散
  armorClink(dest, t + 0.02, 7, 1600, 4200, 0.13, 0.30, 0.14, 0, false, pit);
}

/**
 * warDrum —— 战鼓（低频正弦下滑 + 瞬态）
 */
function warDrum(dest: any, t: number, f0: number, f1: number, peak: number, dur: number, noSnap: boolean, attack: number, pit: number): void {
  if (f0 <= 0) return;
  const atk = attack || 0.004;
  const bodyFreq = Math.max(f0 * pit, 24);

  // ① 膜振主体：2~3 个微失谐振荡（正弦 + 三角），构成"鼓皮"厚度与泛音
  const oscDefs = [
    { type: 'sine', mul: 1.0, det: -4, w: 1.0 },
    { type: 'triangle', mul: 1.5, det: 5, w: 0.5 },
    { type: 'sine', mul: 0.5, det: 9, w: 0.32 }
  ];
  for (let i = 0; i < oscDefs.length; i++) {
    const od = oscDefs[i]!;
    const f = bodyFreq * od.mul;
    const o = mkOsc(od.type, f, t, dur + 0.05, od.det);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(Math.max((f1 * pit) * od.mul, 16), t + dur * 0.6);
    const g = ctx.createGain();
    envAD(g.gain, t, peak * od.w, atk, dur);
    o.connect(g); g.connect(dest.input);
    trackNodes(2);
    scheduleRelease([o, g], (dur + 0.35) * 1000);
  }

  // ② 低频体腔共振：主体再过一道低通，营造"空腔"轰鸣
  const o2 = mkOsc('sine', bodyFreq * 0.5, t, dur + 0.08);
  o2.frequency.setValueAtTime(bodyFreq * 0.5, t);
  o2.frequency.exponentialRampToValueAtTime(Math.max((f1 * pit) * 0.5, 14), t + dur * 0.7);
  const lp = mkFilter('lowpass', Math.max(bodyFreq * 2.4, 240), 0.9);
  const g2 = ctx.createGain();
  envAD(g2.gain, t, peak * 0.5, atk, dur * 1.05);
  o2.connect(lp); lp.connect(g2); g2.connect(dest.input);
  trackNodes(3);
  scheduleRelease([o2, lp, g2], (dur + 0.35) * 1000);

  // ③ 鼓皮瞬态（保留）
  if (!noSnap) {
    transient(dest, t, 320, 0.9, peak * 0.42, 0.05, 0.85, pit);
    transient(dest, t, 1800, 1.4, peak * 0.14, 0.025, 1.2, pit);
  }
}

/**
 * transient —— 极短噪声爆发 + 带通（打击点）
 */
function transient(dest: any, t: number, freq: number, q: number, peak: number, dur: number, rate: number, pit: number): void {
  const n = mkNoise(t, dur + 0.02, rate || rand(0.95, 1.08));
  const bp = mkFilter('bandpass', freq * pit, q);
  const g = ctx.createGain();
  envAD(g.gain, t, peak, 0.001, dur);
  n.connect(bp); bp.connect(g); g.connect(dest.input);
  trackNodes(3);
  scheduleRelease([n, bp, g], (dur + 0.35) * 1000);

  // 低频"体"：让瞬态从'电子咔哒'变成'实体敲击点'
  const o = mkOsc('sine', freq * 0.25 * pit, t, dur * 1.6 + 0.02);
  const og = ctx.createGain();
  envAD(og.gain, t, peak * 0.32, 0.001, dur * 1.2);
  o.connect(og); og.connect(dest.input);
  trackNodes(2);
  scheduleRelease([o, og], (dur * 1.6 + 0.35) * 1000);
}

/**
 * bronzeBody —— 青铜钟体不谐和泛音列合成
 */
function bronzeBody(dest: any, t: number, base: number, peak: number, decayScale: number, partialsKey: string, vibHz: number, pit: number): void {
  const partials = PARTIALS[partialsKey];
  if (!partials) return;

  // 低频体腔"咚"：让钟体更有重量（高频钟自然被低通听感吃掉，不显浑浊）
  const thumpF = Math.max(base * 0.5, 72) * pit;
  const to = mkOsc('sine', thumpF, t, 0.18 * decayScale + 0.05);
  to.frequency.setValueAtTime(thumpF, t);
  to.frequency.exponentialRampToValueAtTime(Math.max(thumpF * 0.6, 46), t + 0.12 * decayScale);
  const tg = ctx.createGain();
  envAD(tg.gain, t, peak * 0.22, 0.002, 0.16 * decayScale);
  to.connect(tg); tg.connect(dest.input);
  trackNodes(2);
  scheduleRelease([to, tg], (0.25 * decayScale + 0.35) * 1000);

  // 金属"沙"噪声（带通，快速衰减）：增加青铜的颗粒感
  const nn = mkNoise(t, 0.06 * decayScale + 0.02, rand(0.95, 1.05));
  const nbp = mkFilter('bandpass', Math.max(base * pit * 2.4, 1200), 3.0);
  const ng = ctx.createGain();
  envAD(ng.gain, t, peak * 0.12, 0.001, 0.05 * decayScale);
  nn.connect(nbp); nbp.connect(ng); ng.connect(dest.input);
  trackNodes(3);
  scheduleRelease([nn, nbp, ng], (0.06 * decayScale + 0.35) * 1000);

  let vibGain = null, vibOsc = null;
  if (vibHz > 0) {
    vibOsc = mkOsc('sine', vibHz, t, 3.2 * decayScale);
    vibGain = ctx.createGain();
    vibGain.gain.setValueAtTime(9, t);
    vibOsc.connect(vibGain);
    trackNodes(2);
  }

  for (let i = 0; i < partials.length; i++) {
    const [ratio, w, dw] = partials[i]!;
    const dur = dw * decayScale;
    const o = mkOsc('sine', base * ratio * pit * rand(0.997, 1.003), t, dur + 0.05, rand(-6, 6));
    const g = ctx.createGain();
    envAD(g.gain, t, peak * w, 0.004, dur);
    o.connect(g); g.connect(dest.input);
    trackNodes(2);
    if (vibGain) vibGain.connect(o.detune);
    scheduleRelease([o, g], (dur + 0.35) * 1000);
  }
  if (vibOsc) scheduleRelease([vibOsc, vibGain], (3.2 * decayScale + 0.35) * 1000);
}

/**
 * chimeNote —— 钟磬式单音（三角 + 不谐和泛音）
 */
function chimeNote(dest: any, t: number, freq: number, peak: number, dur: number, pit: number): void {
  const o = mkOsc('triangle', freq * pit, t, dur + 0.05);
  const g = ctx.createGain();
  envAD(g.gain, t, peak, 0.006, dur);
  o.connect(g); g.connect(dest.input);
  trackNodes(2);
  scheduleRelease([o, g], (dur + 0.35) * 1000);

  const o2 = mkOsc('sine', freq * 2.74 * pit, t, dur * 0.5 + 0.05);
  const g2 = ctx.createGain();
  envAD(g2.gain, t, peak * 0.18, 0.003, dur * 0.45);
  o2.connect(g2); g2.connect(dest.input);
  trackNodes(2);
  scheduleRelease([o2, g2], (dur * 0.5 + 0.35) * 1000);

  const o3 = mkOsc('sine', freq * 0.5 * pit, t, dur + 0.05);
  const g3 = ctx.createGain();
  envAD(g3.gain, t, peak * 0.3, 0.008, dur * 0.8);
  o3.connect(g3); g3.connect(dest.input);
  trackNodes(2);
  scheduleRelease([o3, g3], (dur + 0.35) * 1000);
}

/**
 * whoosh —— 破空/扫风声（带通噪声扫频）
 */
function whoosh(dest: any, t: number, f0: number, f1: number, q: number, peak: number, dur: number, pit: number): void {
  const n = mkNoise(t, dur + 0.05, rand(0.95, 1.05));
  const bp = mkFilter('bandpass', f0 * pit, q);
  bp.frequency.setValueAtTime(f0 * pit, t);
  bp.frequency.exponentialRampToValueAtTime(f1 * pit, t + dur);
  const g = ctx.createGain();
  envAD(g.gain, t, peak, 0.003, dur);
  n.connect(bp); bp.connect(g); g.connect(dest.input);
  trackNodes(3);
  scheduleRelease([n, bp, g], (dur + 0.35) * 1000);
}

/**
 * footStep —— 脚步（低音正弦 + 带通瞬态）
 */
function footStep(dest: any, t: number, lo: number, tone: number, q: number, peak: number, dur: number, pit: number): void {
  warDrum(dest, t, lo * pit, lo * 0.55 * pit, peak * 0.6, dur, false, 0.003, pit);
  transient(dest, t, tone * pit, q, peak * 0.3, dur * 0.35, rand(0.95, 1.1), pit);
}

/* --------------------------------------------------------------------------
 * 8. renderBeat —— 配方渲染引擎
 *
 *    按 BEAT_RECIPES[eventName] 的描述创建实际音频节点。
 *    这是数据驱动设计的核心：全部音效通过此函数统一执行。
 * ------------------------------------------------------------------------ */

function renderBeat(eventName: string, t: number, opts: any = {}): boolean {
  const recipe = BEAT_RECIPES[eventName];
  if (!recipe || !recipe.layers) return false;

  const { faction = null, pan = 0, pit = 1.0, vol = 1.0 } = opts;

  // C2：世界坐标优先取 opts.worldPos，其次取 _internals.updateSourceWorldPos 设置的通道值
  const wPos: { x: number, y: number, z: number } | null = (opts && opts.worldPos) || sourceWorldPos || null;

  // 阵营音色预处理
  const savedTone = currentTone;
  const savedFaction = currentFaction;
  if (faction === 'r') {
    currentTone = 'bright';
    currentFaction = 'r';
  } else if (faction === 'b') {
    currentTone = 'dark';
    currentFaction = 'b';
  }

  const recipeWet = Number((recipe.opts && recipe.opts.wet) || 0);
  const life = Number((recipe.opts && recipe.opts.life) || 1.0);

  // 处理每一层
  for (const [layerName, instructions] of Object.entries(recipe.layers)) {
    if (!Array.isArray(instructions)) continue;

    // 查找层专属滤波指令
    const filterInst = instructions.find(inst => inst.type === 'filter' && inst.applyTo === 'layers');
    const synthInsts = instructions.filter(inst => inst.type !== 'filter');

    const busTarget = (layerName === 'B' && synthInsts.some(si => si.busTarget === 'hitBus'))
      ? 'hitBus' : undefined;

    const dest = makeBus(recipeWet, pan, life, faction, busTarget, wPos);

    // 应用层滤波
    let layerTail = dest.input;
    let layerFilters = [];
    if (filterInst) {
      const lf = ctx.createBiquadFilter();
      lf.type = filterInst.filterType;
      lf.frequency.setValueAtTime(filterInst.freq, ctx.currentTime);
      if (filterInst.q != null) lf.Q.setValueAtTime(filterInst.q, ctx.currentTime);
      layerTail = lf;
      layerFilters.push(lf);
      trackNodes(1);
    }

    // 执行每条合成指令
    for (const inst of synthInsts) {
      executeInst(inst, dest, t, pit, vol);
    }

    if (layerFilters.length > 0) {
      scheduleRelease([dest, ...layerFilters], (life + 0.35) * 1000);
    } else {
      scheduleRelease([dest], (life + 0.35) * 1000);
    }
  }

  currentTone = savedTone;
  currentFaction = savedFaction;
  return true;
}

/** 执行单条合成指令 */
function executeInst(inst: any, dest: any, t: number, pit: number, vol: number): void {
  const dt = (inst.offset || 0);
  const p = pos(pit * (inst.pitScale || 1), 1);
  const pk = Math.max(Number.isFinite(inst.peak * vol) ? inst.peak * vol : 0, FLOOR * 2);

  // C4：程序化积木的「采样让位」闸门。多条程序化指令共同模拟一个物理事件时
  // （如马蹄三连拍 = 3×transient + 3×osc、木轮辚辚 = 4×transient），对应采样
  // 一旦到位就由单个采样整体接管，这些指令自动让位，避免叠加成双重蹄声。
  if (inst.muteIfSample && getSample(inst.muteIfSample)) return;

  try {
    switch (inst.type) {
      case 'osc': {
        const oscType = inst.oscType === 'horn' ? 'sawtooth' : inst.oscType;
        const o = mkOsc(oscType, inst.freq * p, t + dt, inst.dur + 0.05);
        if (inst.sweep) {
          if (inst.sweep.ramp === 'exp') {
            o.frequency.exponentialRampToValueAtTime(
              pos(inst.sweep.end * p, 220), t + dt + inst.sweep.rampTime);
          } else {
            o.frequency.linearRampToValueAtTime(
              pos(inst.sweep.end * p, 220), t + dt + inst.sweep.rampTime);
          }
          // 第二段扫频（上弧）
          if (inst.sweep.sweep2) {
            o.frequency.linearRampToValueAtTime(
              pos(inst.sweep.sweep2.end * p, 220), t + dt + inst.sweep.sweep2.rampTime);
          }
        }
        const g = ctx.createGain();
        if (inst.envReverse) {
          envReverse(g.gain, t + dt, pk, inst.attack, inst.decay);
        } else if (inst.hold != null) {
          envASR(g.gain, t + dt, pk, inst.attack, inst.hold, inst.release);
        } else {
          envAD(g.gain, t + dt, pk, inst.attack, inst.decay);
        }
        // 滤波器
        let tail = g;
        if (inst.filter) {
          const f = mkFilter(inst.filter.type, inst.filter.freq, inst.filter.q);
          g.connect(f);
          tail = f;
          if (inst.filter.sweep) {
            const sw = inst.filter.sweep;
            if (sw.ramp === 'linear') {
              f.frequency.linearRampToValueAtTime(sw.f1 * p, t + dt + sw.rampTime);
            }
          }
        }
        if (inst.oscType === 'horn') {
          // horn模式: 双锯齿微失谐 + 低通吹口扫频 + 低八度正弦 + 气声
          const lp = mkFilter('lowpass', 500, 3.2);
          lp.frequency.setValueAtTime(420, t + dt);
          lp.frequency.linearRampToValueAtTime(inst.freq * 5.5 * p, t + dt + Math.min(0.12, inst.dur * 0.4));
          lp.frequency.linearRampToValueAtTime(inst.freq * 2.2 * p, t + dt + inst.dur);

          const o2 = mkOsc('sawtooth', inst.freq * 1.004 * p * rand(0.997, 1.003), t + dt, inst.dur + 0.2, 8);
          const mix = ctx.createGain();
          mix.gain.setValueAtTime(0.5, t + dt);
          o.connect(mix); o2.connect(mix);
          mix.connect(lp); lp.connect(g); g.connect(dest.input);
          trackNodes(4);
          scheduleRelease([o, o2, mix, lp, g], (inst.dur + 0.5) * 1000);

          // 低八度垫
          const sub = mkOsc('sine', inst.freq * 0.5 * p, t + dt, inst.dur + 0.2);
          const sg = ctx.createGain();
          envASR(sg.gain, t + dt, pk * 0.45, 0.05, inst.dur * 0.4, inst.dur * 0.55);
          sub.connect(sg); sg.connect(dest.input);
          trackNodes(2);
          scheduleRelease([sub, sg], (inst.dur + 0.5) * 1000);

          // 气声
          const air = mkNoise(t + dt, inst.dur + 0.05, 1);
          const abp = mkFilter('bandpass', inst.freq * 3 * p, 1.1);
          const ag = ctx.createGain();
          envASR(ag.gain, t + dt, pk * 0.09, 0.03, inst.dur * 0.4, inst.dur * 0.5);
          air.connect(abp); abp.connect(ag); ag.connect(dest.input);
          trackNodes(3);
          scheduleRelease([air, abp, ag], (inst.dur + 0.5) * 1000);
        } else {
          o.connect(tail);
          tail.connect(dest.input);
          trackNodes(2);
          scheduleRelease([o, g, tail], (inst.dur + 0.35) * 1000);
        }
        return;
      }

      case 'noise': {
        const n = mkNoise(t + dt, inst.dur + 0.05, inst.rate || 1);
        let tail = n;
        const g = ctx.createGain();
        if (inst.filter) {
          const f = mkFilter(inst.filter.type, inst.filter.freq, inst.filter.q);
          n.connect(f);
          tail = f;
          if (inst.filter.sweep) {
            const sw = inst.filter.sweep;
            if (sw.ramp === 'arc') {
              // 弧形扫频: f0 → f1 → f2
              f.frequency.setValueAtTime(pos(sw.f0 * p, 1000), t + dt);
              f.frequency.linearRampToValueAtTime(pos(sw.f1 * p, 1000), t + dt + sw.rampTime * 0.5);
              f.frequency.linearRampToValueAtTime(pos(sw.f2 * p, 1000), t + dt + sw.rampTime);
            } else if (sw.ramp === 'linear') {
              f.frequency.setValueAtTime(pos(sw.f0 * p, 1000), t + dt);
              f.frequency.linearRampToValueAtTime(pos(sw.f1 * p, 1000), t + dt + sw.rampTime);
            } else if (sw.ramp === 'exp') {
              f.frequency.setValueAtTime(pos(sw.f0 || inst.filter.freq * p, 1000), t + dt);
              f.frequency.exponentialRampToValueAtTime(pos(sw.end * p, 1000), t + dt + sw.rampTime);
            }
          }
        }
        if (inst.envReverse) {
          envReverse(g.gain, t + dt, pk, inst.attack, inst.decay);
        } else {
          envAD(g.gain, t + dt, pk, inst.attack, inst.decay);
        }
        tail.connect(g);
        g.connect(dest.input);
        trackNodes(3);
        scheduleRelease([n, tail, g], (inst.dur + 0.35) * 1000);
        return;
      }

      case 'transient':
        transient(dest, t + dt, inst.freq, inst.q, pk, inst.dur, inst.rate, p);
        return;

      case 'warDrum':
        warDrum(dest, t + dt, inst.f0, inst.f1, pk, inst.dur, inst.noSnap, inst.attack, p);
        return;

      case 'armorClink':
        armorClink(dest, t + dt, inst.n, inst.f0, inst.f1, pk,
          inst.spread, inst.ring, inst.softAttack, inst.forceHP, p);
        return;

      case 'bronzeBody':
        bronzeBody(dest, t + dt, inst.freq, pk, inst.decayScale,
          inst.partials, inst.vibHz || 0, p);
        return;

      case 'leatherCreak':
        leatherCreak(dest, t + dt, inst.cf, inst.q, pk, inst.dur, inst.grain, p);
        return;

      case 'bladeClash':
        bladeClash(dest, t + dt, inst.base, pk, inst.dur, inst.grind, inst.partials, p);
        return;

      case 'woodKnock':
        woodKnock(dest, t + dt, inst.f, pk, inst.dur, p);
        return;

      case 'horseSnort': {
        if (inst.probability && Math.random() > inst.probability) return;
        horseSnort(dest, t + dt, inst.f, pk, inst.dur, p);
        return;
      }

      case 'dustScuff':
        dustScuff(dest, t + dt, inst.f0, inst.f1, inst.q, pk, inst.dur, inst.attack, p);
        return;

      case 'clothRustle':
        clothRustle(dest, t + dt, inst.cf, inst.q, pk, inst.dur, inst.attack, p);
        return;

      case 'stoneCrush':
        stoneCrush(dest, t + dt, p);
        return;

      case 'chimeNote': {
        if (inst.probability && Math.random() > inst.probability) return;
        chimeNote(dest, t + dt, inst.freq, pk, inst.dur, p);
        return;
      }

      case 'footStep':
        footStep(dest, t + dt, inst.lo, inst.tone, inst.q, pk, inst.dur, p);
        return;

      case 'whoosh':
        whoosh(dest, t + dt, inst.f0, inst.f1, inst.q, pk, inst.dur, p);
        return;

      case 'sample':
      case 'sampleLoop': {
        // C4：采样指令
        //   { type:'sample', key, rate, gain, attack, decay, loop, offset, seek,
        //     pitchTrack, detune, pan }
        //   · offset  = 调度延迟（与其它指令语义一致，由上方 dt 承接）
        //   · seek    = buffer 内读取起点（原先与 offset 混用，会「延迟 + 跳头」双扣）
        //   · gain    = 线性峰值，与程序化积木一样受 vol（LEVEL 表 + 主音量）缩放
        //   · rate    = 播放速率；默认随阵营音高偏移 p（design §1.0：foley/vocal
        //               同样过阵营滤波与音高偏移），pitchTrack:false 可关闭
        // 采样已加载 → one-shot/loop 源 + 包络；未加载 → Foley 回退程序化积木、
        // Vocal 静默跳过（不降级为合成，避免电子音破功）。
        if (inst.probability != null && Math.random() > Number(inst.probability)) return;
        const key = String(inst.key || '');
        const buf = getSample(key);
        if (buf) {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = !!inst.loop || inst.type === 'sampleLoop';
          const baseRate = inst.rate != null ? Number(inst.rate) : 1.0;
          const rate = inst.pitchTrack === false ? baseRate : baseRate * p;
          if (Math.abs(rate - 1) > 1e-4) src.playbackRate.setValueAtTime(rate, t + dt);
          if (inst.detune != null && src.detune) {
            src.detune.setValueAtTime(Number(inst.detune), t + dt);
          }
          const g = ctx.createGain();
          const gPeak = Math.max(FLOOR, (inst.gain != null ? Number(inst.gain) : 1.0) * vol);
          const gAttack = inst.attack != null ? Number(inst.attack) : 0.002;
          const seek = Number(inst.seek) || 0;
          const remain = Math.max(0.05, (buf.duration - seek) / Math.max(0.05, rate));
          const gDecay = inst.decay != null ? Number(inst.decay) : remain * 0.92;
          if (src.loop) {
            // 常驻声：起音后保持（不主动释放，由调用方 stop / ambience 清理）
            g.gain.setValueAtTime(FLOOR, t + dt);
            g.gain.exponentialRampToValueAtTime(gPeak, t + dt + gAttack);
          } else {
            envAD(g.gain, t + dt, gPeak, gAttack, gDecay);
          }
          let tail: any = g;
          if (inst.pan != null && typeof ctx.createStereoPanner === 'function') {
            const pn = ctx.createStereoPanner();
            pn.pan.setValueAtTime(Math.max(-1, Math.min(1, Number(inst.pan))), t + dt);
            g.connect(pn);
            tail = pn;
            trackNodes(1);
          }
          src.connect(g);
          tail.connect(dest.input);
          src.start(t + dt, seek);
          trackNodes(2);
          if (!src.loop) scheduleRelease([src, g], (gDecay + 0.35) * 1000);
        } else if (inst.fallback) {
          // Foley 回退：采样未加载 → 现有程序化积木（offset 已在 dt 生效，
          // 子指令不再重复偏移，避免二次延迟）
          executeInst({ ...inst.fallback, offset: 0 }, dest, t + dt, pit, vol);
        }
        // Vocal 无 fallback：静默跳过（不降级为合成）
        return;
      }

      case 'tail': {
        // 尾韵：独立调度子指令
        if (inst.children) {
          for (const child of inst.children) {
            executeInst(child, dest, t + dt, p, vol);
          }
        }
        return;
      }

      default:
        return;
    }
  } catch (e) {
    // 单次合成失败不中断整体
    console.warn('[SFX] executeInst failed:', inst.type, (e as Error).message);
  }
}

/* --------------------------------------------------------------------------
 * 9. hitFreeze —— 命中定格音频处理
 *
 *    不拉伸音频，而是：
 *    - sfxDuck 1.00→0.62 (-4.2dB)
 *    - hitLP 20000→1100Hz
 *    - idleDuck/ambDuck 1.00→0.25 (-12dB)
 *    - 恢复时不跳变，用 ramp
 * ------------------------------------------------------------------------ */

function hitFreeze(t: number, holdSec?: number): void {
  if (!ready || !ctx) return;

  const h = holdSec || 0.09;

  // ① 压（sfxDuck + hitLP）
  sfxDuck.gain.cancelScheduledValues(t);
  sfxDuck.gain.setValueAtTime(sfxDuck.gain.value, t);
  sfxDuck.gain.linearRampToValueAtTime(0.62, t + 0.012);

  hitLP.frequency.cancelScheduledValues(t);
  hitLP.frequency.setValueAtTime(20000, t);
  hitLP.frequency.exponentialRampToValueAtTime(1100, t + 0.010);

  // ② idle / ambient duck
  [idleDuck, ambDuck].forEach(d => {
    if (!d) return;
    d.gain.cancelScheduledValues(t);
    d.gain.setValueAtTime(d.gain.value, t);
    d.gain.linearRampToValueAtTime(0.25, t + 0.015);
  });

  // ③ 保持
  const releaseT = t + 0.025 + h;

  // ④ 释放
  sfxDuck.gain.setValueAtTime(0.62, releaseT);
  sfxDuck.gain.linearRampToValueAtTime(1.0, releaseT + 0.09);

  hitLP.frequency.setValueAtTime(1100, releaseT);
  hitLP.frequency.exponentialRampToValueAtTime(20000, releaseT + 0.14);

  [idleDuck, ambDuck].forEach(d => {
    if (!d) return;
    d.gain.setValueAtTime(0.25, releaseT);
    d.gain.linearRampToValueAtTime(1.0, releaseT + 0.26);
  });
}

/* --------------------------------------------------------------------------
 * 10. 播放单个音效事件
 * ------------------------------------------------------------------------ */

function playEvent(name: string, opts: any = {}): boolean {
  if (!ready || !ctx || !settings.enabled) return false;
  if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return false; }

  // 选中音按兵种解析：优先 ${piece}.select，缺失回退通用 select
  let eventName = name;
  if (name === 'select' && opts && opts.piece) {
    const pName = PIECE_NAMES[opts.piece];
    if (pName && BEAT_RECIPES[`${pName}.select`]) eventName = `${pName}.select`;
  }

  // 节流
  const now = performance.now();
  if (lastFired.has(eventName) && now - lastFired.get(eventName) < THROTTLE_MS) return false;
  lastFired.set(eventName, now);

  return renderEventAt(eventName, t0(), opts);
}

/** 在指定 ctx 绝对时间渲染单个事件（C3：ADR-4 时间锚定；无节流 —— 拍点由帧回调驱动） */
function renderEventAt(eventName: string, t: number, opts: any = {}): boolean {
  if (!ready || !ctx || !settings.enabled) return false;

  // 节点保护
  if (nodeCount > MAX_ACTIVE_NODES * 0.85) {
    // 丢弃低优先级
    if (eventName.includes('idle') || eventName.includes('roster')) return false;
  }

  if (degradation === 'off') return false;

  const { faction, pan, pit, vol } = opts;

  // 阵营音高偏移
  let actualPit = pit || 1.0;
  if (faction === 'r') actualPit *= FACTION_SHIFT.r;
  else if (faction === 'b') actualPit *= FACTION_SHIFT.b;

  try {
    return renderBeat(eventName, t, {
      faction, pan: pan || 0,
      pit: actualPit * rand(0.97, 1.03),
      vol: clamp((vol || 1) * rand(0.92, 1.08), 0, 2),
      worldPos: opts.worldPos
    });
  } catch (e) {
    return false;
  }
}

/* --------------------------------------------------------------------------
 * 11. 序列调度
 * ------------------------------------------------------------------------ */

let sequenceId = 0;

class SequenceHandle {
  id: number;
  _cancel: (fadeMs: number) => void;
  _cancelled: boolean;
  constructor(id: number, cancelFn?: (fadeMs: number) => void) {
    this.id = id;
    this._cancel = cancelFn || (() => {});
    this._cancelled = false;
  }
  cancel(fadeMs = 40): void {
    if (this._cancelled) return;
    this._cancelled = true;
    this._cancel(fadeMs);
  }
}

function scheduleSequence(sequence: any, baseT: number, opts: any = {}): SequenceHandle {
  const id = ++sequenceId;
  let cancelled = false;

  const cancel = (fadeMs: number = 0): void => {
    cancelled = true;
  };

  if (!ctx || !sequence || !Array.isArray(sequence.beats)) {
    return new SequenceHandle(id, cancel);
  }

  // C3（ADR-4）：弃 setTimeout —— 调用瞬间即按 ctx 绝对时间渲染全部拍点。
  // 在帧回调（BeatSequencer fire / 命中帧 T）内调用时，AudioNode 以 startAt/impactAt
  // 精确排程，音画帧级对齐，无 setTimeout 漂移。cancel 在渲染完成后主要释放引用
  // （已排程节点由 WebAudio 时钟驱动，与 raf 无关）。
  if (ctx.state === 'suspended') {
    // 边界：currentTime 不前进 → 尝试恢复，并把锚点钳到当前（ADR-4 后果）
    ctx.resume().catch(() => {});
    baseT = Math.max(baseT, ctx.currentTime + 0.002);
  }

  const now = ctx.currentTime;
  for (const beat of sequence.beats) {
    if (!beat || !beat.name || !BEAT_RECIPES[beat.name]) continue;
    if (cancelled) break;
    const t = baseT + (beat.offset || 0);
    if (t < now - 0.002) continue; // 已过去的时间点跳过（与原 setTimeout 语义一致）
    renderEventAt(beat.name, t, {
      ...opts,
      pit: opts.pit || 1.0,
      faction: beat.faction || opts.faction
    });
  }

  return new SequenceHandle(id, cancel);
}

/* --------------------------------------------------------------------------
 * 12. 对外单例 SFX
 * ------------------------------------------------------------------------ */

export const SFX = {
  /* ------ 初始化 ------ */

  init(): boolean {
    if (ready) {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    loadSettings();
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();

      // 降级检测
      const hw = navigator.hardwareConcurrency || 4;
      if (hw <= 4) degradation = 'lean';
      else degradation = 'full';

      buildGraph();
      ready = true;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      // C4：采样加载管线绑定 AudioContext + 立即后台预载全清单。
      // 关键：不 await —— 采样未到位期间 Foley 走程序化 fallback、Vocal 静默，
      // 到位后自动接管（getSample 命中即用），全程不阻塞首次交互与首帧。
      bindSampleContext(ctx);
      preloadSamples()
        .then(() => {
          const s = sampleStats();
          console.info(`[SFX] 战场采样就位 ${s.loaded}/${s.total} · ${(s.bytes / 1048576).toFixed(2)}MB`);
        })
        .catch(() => {});

      // iOS: visibilitychange 兜底
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      }, { passive: true });

      // 静音 buffer 解锁
      const silenceBuf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const silenceSrc = ctx.createBufferSource();
      silenceSrc.buffer = silenceBuf;
      silenceSrc.connect(ctx.destination);
      silenceSrc.start(0);

      return true;
    } catch (e) {
      ctx = null;
      ready = false;
      return false;
    }
  },

  /* ------ 时间查询 ------ */

  clock(): any {
    if (!ready || !ctx) return { ctxTime: 0, perfTime: 0, baseLatency: 0, outputLatency: 0, audible: false };
    const baseLatency = (ctx.baseLatency || 0.005);
    const outputLatency = (ctx.outputLatency || 0.008);
    return {
      ctxTime: ctx.currentTime,
      perfTime: performance.now(),
      baseLatency,
      outputLatency,
      audible: ctx.currentTime + baseLatency + outputLatency
    };
  },

  /* ------ 战斗系统 API ------ */

  combat: {
    /**
     * SFX.combat.plan({ piece, action, faction, victim, impactAt, startAt, panFrom, panTo, tension, density, hitstop })
     * → SequenceHandle
     */
    plan(opts: any = {}) {
      if (!ready || !ctx) return null;
      if (degradation === 'off') return null;

      const {
        piece = 'P', action = 'move', faction = 'r',
        victim = null, impactAt, startAt,
        panFrom = 0, panTo = 0, tension = 0, density = 'full', hitstop = 0
      } = opts;

      const pieceName = PIECE_NAMES[piece];
      if (!pieceName) return null;

      if (action === 'move') {
        const seq = SEQUENCES.move[pieceName];
        if (!seq) return null;
        const baseT = startAt || t0();
        return scheduleSequence(seq, baseT, { faction, pan: panTo });
      }

      if (action === 'capture') {
        const seq = SEQUENCES.capture[pieceName];
        if (!seq) return null;
        const impactT = impactAt || t0();

        // 受害者崩塌拍按"实际被吃方"的音色/重量/阵营播放（而非攻击方）
        const vName = victim && victim.type ? PIECE_NAMES[victim.type] : null;
        const vFaction = (victim && victim.side) || faction;
        const beats = seq.beats.map(b => {
          if (b.beat === 'victim' && vName) {
            return { ...b, name: `${vName}.capture.victim.shake`, faction: vFaction };
          }
          return b;
        });

        const handle = scheduleSequence({ ...seq, beats }, impactT, { faction, pan: panTo });

        // 命中定格
        if (hitstop > 0) {
          hitFreeze(impactT, hitstop);
        }

        return handle;
      }

      return null;
    },

    /**
     * C3（ADR-4）扩展 API：在帧回调内以 ctx 绝对时间渲染任意序列。
     * 签名: schedule(sequence, baseT, opts)
     *   sequence — 与 SEQUENCES.move/capture 同构: { beats: [{ name, offset, faction? }] }
     *   baseT    — ctx 秒（clock().ctxTime 的绝对时间锚点）
     *   opts     — { faction, pan, worldPos, victim? }
     * 返回 SequenceHandle（cancel 主要释放引用；已排程节点由 WebAudio 时钟驱动）。
     */
    schedule(sequence: any, baseT: number, opts: any = {}) {
      if (!ready || !ctx) return null;
      if (degradation === 'off') return null;
      return scheduleSequence(sequence, baseT, opts);
    }
  },

  /* ------ 播放单个音效 ------ */

  play(eventName: string, opts?: any) {
    return playEvent(eventName, opts || {});
  },

  /** C3（ADR-4）：在指定 ctx 绝对时间播放单个事件（供 BeatSequencer 帧回调注册） */
  playAt(eventName: string, t: number, opts?: any) {
    if (!ready || !ctx) return false;
    return renderEventAt(eventName, t, opts || {});
  },

  /* ------ 移动音效（按兵种）------ */

  move(type: string, opts: any) {
    const name = PIECE_NAMES[type];
    if (!name) return this.play('move', opts);

    // 简化版：播放落位拍
    return playEvent(`${name}.move.land`, opts || {});
  },

  /* ------ 吃子音效（按攻击方兵种）------ */

  capture(type: string, opts: any) {
    const name = PIECE_NAMES[type];
    if (!name) return this.play('capture', opts);

    if (type === 'C') {
      return playEvent('cannon.capture.stoneImpact', opts || {});
    }
    return playEvent(`${name}.capture.clash`, opts || {});
  },

  /* ------ 被吃方音效（受害者）------ */

  captured(victimType: string, victimSide: string, opts: any) {
    const o = Object.assign({}, opts || {}, { faction: victimSide, vol: (opts && opts.vol || 1) * 0.72 });
    const name = PIECE_NAMES[victimType];
    if (!name) return false;
    return playEvent(`${name}.capture.victim.shake`, o);
  },

  /* ------ 待机音效（按兵种）------ */

  idle(type: string, opts: any) {
    const name = PIECE_NAMES[type];
    if (!name) return false;
    return playEvent(`${name}.idle`, opts || {});
  },

  /* ------ 静音控制 ------ */

  setEnabled(v: unknown): boolean {
    settings.enabled = !!v;
    // 修复：开启时若 AudioContext 处于 suspended（浏览器自动暂停策略），先 resume
    // 再返回，避免后续 play() 当帧被 playEvent() 的 suspended 早返回吞掉声音。
    if (v && ctx && ctx.state === 'suspended') {
      try { ctx.resume().catch(() => {}); } catch (e) { /* 忽略 */ }
    }
    saveSettings();
    return settings.enabled;
  },

  isEnabled(): boolean {
    return settings.enabled;
  },

  /* ------ 环境氛围控制 ------ */

  setAmbient(v: unknown): boolean {
    settings.ambient = !!v;
    saveSettings();
    return settings.ambient;
  },

  isAmbient(): boolean {
    return settings.ambient;
  },

  setAmbientIntensity(v: number): void {
    if (ambientBus && ctx) {
      const t = ctx.currentTime;
      ambientBus.gain.cancelScheduledValues(t);
      ambientBus.gain.setValueAtTime(ambientBus.gain.value, t);
      ambientBus.gain.linearRampToValueAtTime(clamp(v, 0, 1), t + 0.3);
    }
  },

  setAmbientTension(level: number): void {
    // 由 ambience.js 调用，映射 TENSION → 环境参数
    if (ambientBus && ctx) {
      const t = ctx.currentTime;
      const gain = 0.70 + (0.92 - 0.70) * clamp(level, 0, 1);
      ambientBus.gain.cancelScheduledValues(t);
      ambientBus.gain.setValueAtTime(ambientBus.gain.value, t);
      ambientBus.gain.linearRampToValueAtTime(gain, t + 0.5);
    }
  },

  /* ------ 音量 ------ */

  setVolume(v: unknown): number {
    const n = clamp(typeof v === 'number' && isFinite(v) ? v : 0, 0, 1);
    settings.volume = n;
    saveSettings();
    if (masterGain && ctx) {
      const t = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(masterGain.gain.value, t);
      masterGain.gain.linearRampToValueAtTime(n * HEADROOM, t + 0.05);
    }
    return n;
  },

  getVolume(): number {
    return settings.volume;
  },

  isReady(): boolean {
    return ready;
  },

  /* ------ 降级 ------ */

  getDegradation(): string {
    return degradation;
  },

  setDegradation(level: string): void {
    if (['full', 'lean', 'off'].includes(level)) {
      degradation = level;
    }
  },

  /* ------ 应急停止 ------ */

  stopAll(): void {
    if (!ready || !ctx) return;
    const t = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setValueAtTime(masterGain.gain.value, t);
    masterGain.gain.linearRampToValueAtTime(FLOOR, t + 0.02);
    masterGain.gain.linearRampToValueAtTime(settings.volume * HEADROOM, t + 0.24);
  },

  /* ------ 采样管线诊断/控制（QA 探针用）------ */

  /** 触发一次全清单预载（幂等；已加载的会被缓存命中跳过）。返回完成 Promise。 */
  preloadSamples(keys?: string[]): Promise<void> {
    return preloadSamples(keys);
  },

  /** 采样加载统计：{ total, loaded, failed, bytes } */
  sampleStats(): { total: number; loaded: number; failed: number; bytes: number } {
    return sampleStats();
  },

  /** 采样清单 key 总数（探针校验用） */
  sampleManifestCount(): number {
    return Object.keys(SAMPLE_MANIFEST).length;
  },

  /** 内部使用：获取上下文/节点（供 ambience.js 使用） */
  _internals: {
    get ctx() { return ctx; },
    get ready() { return ready; },
    get ambientBus() { return ambientBus; },
    get ambDuck() { return ambDuck; },
    get masterGain() { return masterGain; },
    get dryBus() { return dryBus; },
    get convolver() { return convolver; },
    get noiseBuf() { return noiseBuf; },
    get WET() { return WET; },
    get LEVEL() { return LEVEL; },
    get degradation() { return degradation; },
    get settings() { return settings; },
    get t0() { return t0(); },
    get FLOOR() { return FLOOR; },
    get FACTION_SHIFT() { return FACTION_SHIFT; },

    /* C2：3D 定位通道（松耦合 —— 坐标由调用方传入，不 import render 内容） */
    get hasPanner3D() { return hasPanner3D; },
    /** 每帧更新 AudioListener 位置/朝向（main.js 传 camera.position / forward / up） */
    setListener(position: { x: number, y: number, z: number },
                forward?: { x: number, y: number, z: number },
                up?: { x: number, y: number, z: number }): void {
      setListener(position, forward, up);
    },
    /** 更新棋子世界坐标通道（吃子/走子前调用；后续 makeBus 自动走 PannerNode） */
    updateSourceWorldPos(pos: { x: number, y: number, z: number }): void {
      if (pos) sourceWorldPos = pos;
    }
  }
};

// 模块加载时读取持久化设置
loadSettings();

export default SFX;
