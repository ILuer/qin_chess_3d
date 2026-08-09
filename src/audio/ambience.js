/* ==========================================================================
 * qin-chess-3d · src/audio/ambience.js
 * 秦风 · 战场环境氛围系统
 *
 * 设计引用: design/audio-system-v2.md §4
 *
 * 职责:
 *   - L0 五层常驻环境床（风/旌旗/远鼓/人群/马）
 *   - TensionSystem（战场张力计算与映射）
 *   - 抗听觉疲劳措施
 *   - 独立静音控制
 *
 * 依赖: sfx.js 的 _internals（获取 AudioContext / ambientBus / 总线）
 *        recipes.js 的 AMBIENT_LAYERS / TENSION_MAP
 * ========================================================================== */

import { SFX } from './sfx.js';
import { AMBIENT_LAYERS, TENSION_WEIGHTS, TENSION_MAP } from './recipes.js';

/* --------------------------------------------------------------------------
 * 0. 常量
 * ------------------------------------------------------------------------ */

const FLOOR = 0.0001;
const TENSION_SMOOTH_TAU = 2.5;     // 一阶低通时间常数（秒）
const TENSION_CHECK_TAU = 0.35;     // 将军事件快速响应

/* --------------------------------------------------------------------------
 * 1. 小工具
 * ------------------------------------------------------------------------ */

const clamp = (v, lo, hi) => ((v < lo) ? lo : (v > hi ? hi : v));
const rand = (a, b) => a + Math.random() * (b - a);
const _int = () => SFX._internals || {};

/** 一阶低通平滑 */
function lerpSmooth(current, target, dt, tau) {
  if (tau <= 0) return target;
  const a = Math.exp(-dt / tau);
  return target * (1 - a) + current * a;
}

/** 几何插值: v0 × (v1/v0)^t */
function geomLerp(v0, v1, t) {
  if (v0 <= 0) return v1;
  return v0 * Math.pow(v1 / v0, clamp(t, 0, 1));
}

/** 线性插值 */
function linLerp(v0, v1, t) {
  return v0 + (v1 - v0) * clamp(t, 0, 1);
}

/* --------------------------------------------------------------------------
 * 2. AmbienceSystem 类
 * ------------------------------------------------------------------------ */

export class AmbienceSystem {
  constructor() {
    this._active = false;       // 是否已启动
    this._enabled = true;       // 独立静音
    this._layers = {};          // 五层运行时状态
    this._timers = [];          // 定时器 ID
    this._nodes = [];           // 音频节点引用
    this._tension = 0.12;       // 当前张力（平滑后）
    this._tensionRaw = 0.12;
    this._lastUpdate = 0;
    this._gameState = null;     // 游戏状态引用（用于计算张力）

    // 抗疲劳
    this._breathTimer = 0;
    this._breathPhase = 'normal'; // 'normal' | 'descending' | 'hold' | 'rising'
  }

  /* ---- 启动 ---- */

  start() {
    if (this._active) return;
    const i = _int();
    if (!i.ready) return false;

    // 默认开启
    this._enabled = i.settings.ambient;

    this._buildLayers();
    this._active = true;
    this._lastUpdate = i.ctx.currentTime;

    if (this._enabled) {
      this._fadeIn();
      this._startTimers();
    }

    return true;
  }

  /* ---- 停止 ---- */

  stop() {
    this._active = false;
    this._stopTimers();
    this._fadeOut(() => {
      this._cleanupNodes();
    });
  }

  /* ---- 静音控制 ---- */

  setEnabled(v) {
    this._enabled = !!v;
    if (v && this._active) {
      this._fadeIn();
      this._startTimers();
    } else if (this._active) {
      this._stopTimers();
      this._fadeOut();
    }
    return this._enabled;
  }

  isEnabled() { return this._enabled; }

  /* ---- 张力更新 (由外部每帧调用或走子后调用) ---- */

  /**
   * 更新张力因子并计算当前张力。
   * @param {object} gs 游戏状态 { materialAdv, pieceCount, inCheck, checkSide,
   *                                recentCaptures, enemyAdvancement }
   * @param {number} dt 帧间隔（秒）
   */
  updateTension(gs, dt) {
    const i = _int();
    if (!i.ready || !gs) return;

    // 五因子
    const t_material = gs.materialAdv != null ? 1 - clamp(Math.abs(gs.materialAdv) / 18, 0, 1) : 0.5;
    const t_endgame = gs.pieceCount != null ? 1 - clamp((gs.pieceCount - 8) / 24, 0, 1) : 0;
    const t_check = gs.inCheck ? 1.0 : 0;
    const t_recent = gs.recentCaptures != null ? clamp(gs.recentCaptures / 3, 0, 1) : 0;
    const t_pressure = gs.enemyAdvancement != null ? clamp(gs.enemyAdvancement / 4, 0, 1) : 0;

    const raw = TENSION_WEIGHTS.material * t_material +
                TENSION_WEIGHTS.endgame * t_endgame +
                TENSION_WEIGHTS.check * t_check +
                TENSION_WEIGHTS.recent * t_recent +
                TENSION_WEIGHTS.pressure * t_pressure;

    const target = 0.12 + 0.88 * clamp(raw, 0, 1);

    // 平滑
    const tau = gs.inCheck ? TENSION_CHECK_TAU : TENSION_SMOOTH_TAU;
    this._tension = lerpSmooth(this._tension, target, dt || 0.016, tau);

    // 映射到环境参数
    this._applyTensionMap();

    return this._tension;
  }

  /** 直接设置张力（用于 manually 触发将军等） */
  setTension(level) {
    this._tension = clamp(level, 0, 1);
    this._tensionRaw = this._tension;
    this._applyTensionMap();
  }

  /** 获取当前张力 */
  getTension() { return this._tension; }

  /* ---- 内部：构建五层环境床 ---- */

  _buildLayers() {
    const i = _int();
    if (!i.ready || !i.ambientBus || !i.noiseBuf) return;

    const t = i.ctx.currentTime;
    const ambBus = i.ambientBus;

    // A-WIND: 连续风 (8s loop buffer + LFO)
    this._layers.wind = this._buildWindLayer(ambBus, t);

    // B-BANNER & C-DRUM & E-HORSE: 阵发（由 timer 触发）
    this._layers.banner = null;
    this._layers.drum = null;
    this._layers.horse = null;

    // D-CROWD: 连续人群
    this._layers.crowd = this._buildCrowdLayer(ambBus, t);
  }

  _buildWindLayer(ambBus, t) {
    const i = _int();
    const layer = AMBIENT_LAYERS.wind;

    // 创建专用噪声循环 buffer（8s 专用，不是全局的 2s）
    const len = Math.floor(i.ctx.sampleRate * 8);
    const buf = i.ctx.createBuffer(1, len, i.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let j = 0; j < len; j++) d[j] = Math.random() * 2 - 1;

    const src = i.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.setValueAtTime(layer.rate, t);

    // LFO 推拉 playbackRate ±1.5%
    const lfoRate = i.ctx.createOscillator();
    lfoRate.type = 'sine';
    lfoRate.frequency.setValueAtTime(layer.lfoRate.freq, t);
    const lfoRateG = i.ctx.createGain();
    lfoRateG.gain.setValueAtTime(layer.lfoRate.amp * layer.rate, t);
    lfoRate.connect(lfoRateG);
    lfoRateG.connect(src.playbackRate);
    lfoRate.start(t);

    // 低通 with LFO
    const lp = i.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(layer.filter.freq, t);
    lp.Q.setValueAtTime(layer.filter.q, t);

    const lfoFilt = i.ctx.createOscillator();
    lfoFilt.type = 'sine';
    lfoFilt.frequency.setValueAtTime(layer.filter.lfoFreq, t);
    const lfoFiltG = i.ctx.createGain();
    lfoFiltG.gain.setValueAtTime(layer.filter.lfoAmp, t);
    lfoFilt.connect(lfoFiltG);
    lfoFiltG.connect(lp.frequency);
    lfoFilt.start(t);

    // 幅度 LFO（呼吸感）
    const g = i.ctx.createGain();
    g.gain.setValueAtTime(layer.gain.base, t);
    const lfoAmp = i.ctx.createOscillator();
    lfoAmp.type = 'sine';
    lfoAmp.frequency.setValueAtTime(layer.gain.lfoRate, t);
    const lfoAmpG = i.ctx.createGain();
    lfoAmpG.gain.setValueAtTime(layer.gain.lfoAmp, t);
    lfoAmp.connect(lfoAmpG);
    lfoAmpG.connect(g.gain);
    lfoAmp.start(t);

    // 高通（去极低频不必要能量）
    const hp = i.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(layer.highpass || 55, t);
    hp.Q.setValueAtTime(0.7, t);

    // 湿声发送
    const send = i.ctx.createGain();
    send.gain.setValueAtTime(layer.wet, t);

    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(ambBus);
    g.connect(send);
    send.connect(i.convolver || ambBus);

    src.start(t);

    const nodes = [src, lfoRate, lfoRateG, lfoFilt, lfoFiltG, lfoAmp, lfoAmpG, hp, lp, g, send];
    this._nodes.push(...nodes);

    return { src, lfoRate, lfoFilt, lfoAmp, g, send, nodes };
  }

  _buildCrowdLayer(ambBus, t) {
    const i = _int();
    const layer = AMBIENT_LAYERS.crowd;

    const src = i.ctx.createBufferSource();
    src.buffer = i.noiseBuf;
    src.loop = true;
    src.start(t, rand(0, 1.4));

    // 三个共振峰
    const formants = layer.formants;
    const gains = [];
    const bps = [];

    for (const fm of formants) {
      const bp = i.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(fm, t);
      bp.Q.setValueAtTime(2.5, t);

      const lfoF = i.ctx.createOscillator();
      lfoF.type = 'sine';
      lfoF.frequency.setValueAtTime(rand(0.05, 0.3), t);
      const lfoFG = i.ctx.createGain();
      lfoFG.gain.setValueAtTime(rand(30, 120), t);
      lfoF.connect(lfoFG);
      lfoFG.connect(bp.frequency);
      lfoF.start(t);

      const pg = i.ctx.createGain();
      pg.gain.setValueAtTime(0.33, t);

      bps.push({ bp, lfoF, lfoFG });
      gains.push(pg);
      this._nodes.push(lfoF, lfoFG, bp, pg);
    }

    // 低通
    const lp = i.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(layer.lp.lo, t);
    lp.Q.setValueAtTime(1.0, t);

    const g = i.ctx.createGain();
    g.gain.setValueAtTime(layer.wet * 0.3, t);

    // 连接
    src.connect(lp);
    lp.connect(bps[0].bp);
    for (let j = 0; j < bps.length; j++) {
      if (j < bps.length - 1) {
        gains[j].connect(bps[j + 1].bp);
      } else {
        gains[j].connect(g);
      }
    }
    g.connect(ambBus);

    // 湿声
    const send = i.ctx.createGain();
    send.gain.setValueAtTime(layer.wet, t);
    g.connect(send);
    send.connect(i.convolver || ambBus);

    const nodes = [src, lp, g, send, ...bps.flatMap(b => [b.lfoF, b.lfoFG, b.bp]), ...gains];
    this._nodes.push(...nodes);

    return { src, bps, lp, g, send, nodes };
  }

  /* ---- 阵发声部 ---- */

  _playBanner() {
    const i = _int();
    if (!i.ready || !i.ambientBus) return;
    if (i.degradation === 'lean') return; // lean 模式不播 banner

    const layer = AMBIENT_LAYERS.banner;
    const t = i.ctx.currentTime + 0.002;
    const ambBus = i.ambientBus;

    const n = Math.floor(rand(layer.params.nMin, layer.params.nMax + 0.99));
    const cf = layer.params.cf * rand(0.92, 1.08);
    const peak = rand(layer.params.peakMin, layer.params.peakMax);

    for (let j = 0; j < n; j++) {
      const dt = t + j * rand(0.08, 0.21);
      const dur = rand(0.04, 0.09);
      const noise = i.ctx.createBufferSource();
      noise.buffer = i.noiseBuf;
      noise.loop = true;
      noise.playbackRate.setValueAtTime(rand(1.2, 1.8), dt);
      noise.start(dt, rand(0, 1.4));
      noise.stop(dt + dur + 0.01);

      const bp = i.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(cf, dt);
      bp.Q.setValueAtTime(1.5, dt);

      const g = i.ctx.createGain();
      g.gain.setValueAtTime(FLOOR, dt);
      g.gain.exponentialRampToValueAtTime(peak * rand(0.5, 1.0), dt + 0.002);
      g.gain.exponentialRampToValueAtTime(FLOOR, dt + dur);

      noise.connect(bp);
      bp.connect(g);
      g.connect(ambBus);

      // 湿声
      const send = i.ctx.createGain();
      send.gain.setValueAtTime(layer.wet, dt);
      g.connect(send);
      send.connect(i.convolver || ambBus);

      this._nodes.push(noise, bp, g, send);
    }

    this._scheduleNext('banner');
  }

  _playDrum() {
    const i = _int();
    if (!i.ready || !i.ambientBus) return;

    const layer = AMBIENT_LAYERS.drum;
    const t = i.ctx.currentTime + 0.002;
    const ambBus = i.ambientBus;

    const f0 = rand(layer.params.f0Min, layer.params.f0Max);
    const dur = layer.params.dur;

    // 低频正弦下滑
    const osc = i.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f0 * 0.65, 20), t + dur * 0.55);
    osc.start(t);
    osc.stop(t + dur + 0.05);

    // 远场处理: lowpass + 软起音 + 低频架
    const lp = i.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(layer.params.lowpass, t);
    lp.Q.setValueAtTime(0.7, t);

    const g = i.ctx.createGain();
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.exponentialRampToValueAtTime(layer.peak, t + layer.params.attack);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + dur);

    osc.connect(lp);
    lp.connect(g);

    // 低频架补偿
    const ls = i.ctx.createBiquadFilter();
    ls.type = 'lowshelf';
    ls.frequency.setValueAtTime(layer.params.lowshelf, t);
    ls.gain.setValueAtTime(2, t);
    g.connect(ls);
    ls.connect(ambBus);

    // 湿声
    const send = i.ctx.createGain();
    send.gain.setValueAtTime(layer.wet, t);
    ls.connect(send);
    send.connect(i.convolver || ambBus);

    this._nodes.push(osc, lp, g, ls, send);

    this._scheduleNext('drum');
  }

  _playHorse() {
    const i = _int();
    if (!i.ready || !i.ambientBus) return;

    const layer = AMBIENT_LAYERS.horse;
    const t = i.ctx.currentTime + 0.002;
    const ambBus = i.ambientBus;

    const f = rand(layer.params.fMin, layer.params.fMax);
    const dur = rand(layer.params.durMin, layer.params.durMax);
    const isSnort = Math.random() < layer.snortProb;

    if (isSnort) {
      // 响鼻：正弦 + 24Hz 鼻颤
      const osc = i.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);

      const lfo = i.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(24, t);
      const lfoG = i.ctx.createGain();
      lfoG.gain.setValueAtTime(f * 0.2, t);
      lfo.connect(lfoG);
      lfoG.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);

      osc.start(t);
      osc.stop(t + dur + 0.02);

      const g = i.ctx.createGain();
      g.gain.setValueAtTime(FLOOR, t);
      g.gain.exponentialRampToValueAtTime(layer.params.peak, t + 0.015);
      g.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
      osc.connect(g);
      g.connect(ambBus);

      const send = i.ctx.createGain();
      send.gain.setValueAtTime(layer.wet, t);
      g.connect(send);
      send.connect(i.convolver || ambBus);

      this._nodes.push(osc, lfo, lfoG, g, send);
    } else {
      // 短嘶：短正弦扫频
      const osc = i.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.linearRampToValueAtTime(f * rand(1.3, 1.7), t + dur * 0.4);
      osc.frequency.linearRampToValueAtTime(f * rand(0.6, 0.8), t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.02);

      const g = i.ctx.createGain();
      g.gain.setValueAtTime(FLOOR, t);
      g.gain.exponentialRampToValueAtTime(layer.params.peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
      osc.connect(g);
      g.connect(ambBus);

      const send = i.ctx.createGain();
      send.gain.setValueAtTime(layer.wet, t);
      g.connect(send);
      send.connect(i.convolver || ambBus);

      this._nodes.push(osc, g, send);
    }

    this._scheduleNext('horse');
  }

  _playCrowdShout() {
    const i = _int();
    if (!i.ready || !i.ambientBus) return;

    const layer = AMBIENT_LAYERS.crowd;
    const t = i.ctx.currentTime + 0.002;
    const ambBus = i.ambientBus;

    // 偶发呼喝: 短噪声爆发
    const src = i.ctx.createBufferSource();
    src.buffer = i.noiseBuf;
    src.loop = true;
    src.start(t, rand(0, 1.4));
    src.stop(t + 0.15);

    const bp = i.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(rand(800, 1800), t);
    bp.Q.setValueAtTime(1.0, t);

    const g = i.ctx.createGain();
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.exponentialRampToValueAtTime(layer.peak.hi * 1.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.14);

    src.connect(bp);
    bp.connect(g);
    g.connect(ambBus);

    this._nodes.push(src, bp, g);

    this._scheduleNext('shout');
  }

  /* ---- 定时器管理 ---- */

  _startTimers() {
    if (!this._enabled) return;
    this._scheduleNext('banner');
    this._scheduleNext('drum');
    this._scheduleNext('horse');
    this._scheduleNext('shout');
    this._startBreathCycle();
  }

  _stopTimers() {
    this._timers.forEach(t => clearTimeout(t));
    this._timers = [];
  }

  _scheduleNext(event) {
    if (!this._active || !this._enabled) return;

    let delayMs;
    const layer = AMBIENT_LAYERS[event];
    const tension = this._tension;

    switch (event) {
      case 'banner':
        delayMs = rand(layer.interval.lo, layer.interval.hi) * 1000;
        break;
      case 'drum': {
        // 张力驱动间隔
        const t0 = TENSION_MAP[0.0].drumInterval;
        const t1 = TENSION_MAP[1.0].drumInterval;
        delayMs = geomLerp(t0, t1, tension) * 1000;
        break;
      }
      case 'horse':
        delayMs = rand(layer.interval.lo, layer.interval.hi) * 1000;
        break;
      case 'shout':
        delayMs = rand(layer.shoutInterval.lo, layer.shoutInterval.hi) * 1000;
        break;
      default:
        return;
    }

    const timer = setTimeout(() => {
      if (!this._active || !this._enabled) return;
      if (event === 'banner') this._playBanner();
      else if (event === 'drum') this._playDrum();
      else if (event === 'horse') this._playHorse();
      else if (event === 'shout') this._playCrowdShout();
    }, delayMs);

    this._timers.push(timer);
  }

  /* ---- 淡入淡出 ---- */

  _fadeIn() {
    const i = _int();
    if (!i.ready || !i.ambientBus) return;
    const t = i.ctx.currentTime;
    i.ambientBus.gain.cancelScheduledValues(t);
    i.ambientBus.gain.setValueAtTime(FLOOR, t);
    i.ambientBus.gain.exponentialRampToValueAtTime(0.70, t + 1.5);
  }

  _fadeOut(onComplete) {
    const i = _int();
    if (!i.ready || !i.ambientBus) { if (onComplete) onComplete(); return; }
    const t = i.ctx.currentTime;
    i.ambientBus.gain.cancelScheduledValues(t);
    i.ambientBus.gain.setValueAtTime(Math.max(i.ambientBus.gain.value, FLOOR), t);
    i.ambientBus.gain.exponentialRampToValueAtTime(FLOOR, t + 0.8);
    if (onComplete) setTimeout(onComplete, 900);
  }

  /* ---- 抗听觉疲劳：强制宏观呼吸 ---- */

  _startBreathCycle() {
    if (!this._active || !this._enabled) return;
    this._breathPhase = 'normal';
    this._breathTimer = setTimeout(() => this._breathDescend(), rand(40000, 90000));
  }

  _breathDescend() {
    if (!this._active) return;
    this._breathPhase = 'descending';
    const i = _int();
    if (i.ready && i.ambientBus) {
      const t = i.ctx.currentTime;
      const current = i.ambientBus.gain.value || 0.70;
      i.ambientBus.gain.cancelScheduledValues(t);
      i.ambientBus.gain.setValueAtTime(current, t);
      i.ambientBus.gain.linearRampToValueAtTime(current * 0.63, t + 6); // -4dB
    }
    this._breathTimer = setTimeout(() => this._breathHold(), 6000);
  }

  _breathHold() {
    if (!this._active) return;
    this._breathPhase = 'hold';
    const holdMs = rand(6000, 8000);
    this._breathTimer = setTimeout(() => this._breathRise(), holdMs);
  }

  _breathRise() {
    if (!this._active) return;
    this._breathPhase = 'rising';
    const i = _int();
    if (i.ready && i.ambientBus) {
      const t = i.ctx.currentTime;
      const gain = 0.70 + (0.92 - 0.70) * this._tension;
      i.ambientBus.gain.cancelScheduledValues(t);
      i.ambientBus.gain.setValueAtTime(Math.max(i.ambientBus.gain.value, FLOOR), t);
      i.ambientBus.gain.linearRampToValueAtTime(gain, t + 6);
    }
    // 下一轮
    this._breathTimer = setTimeout(() => this._breathDescend(), rand(40000, 90000));
  }

  /* ---- 应用张力映射 ---- */

  _applyTensionMap() {
    const i = _int();
    if (!i.ready || !i.ambientBus) return;

    const t = this._tension;

    // 插值
    const ambientGain = linLerp(
      TENSION_MAP[0.0].ambientGain, TENSION_MAP[1.0].ambientGain, t);
    const drumInterval = geomLerp(
      TENSION_MAP[0.0].drumInterval, TENSION_MAP[1.0].drumInterval, t);
    const drumPeak = linLerp(
      TENSION_MAP[0.0].drumPeak, TENSION_MAP[1.0].drumPeak, t);
    const crowdPeak = linLerp(
      TENSION_MAP[0.0].crowdPeak, TENSION_MAP[1.0].crowdPeak, t);
    const envWet = linLerp(
      TENSION_MAP[0.0].envWet, TENSION_MAP[1.0].envWet, t);

    // 应用增益（平滑）
    const ct = i.ctx.currentTime;
    i.ambientBus.gain.cancelScheduledValues(ct);
    i.ambientBus.gain.setValueAtTime(i.ambientBus.gain.value || 0.70, ct);
    i.ambientBus.gain.linearRampToValueAtTime(ambientGain, ct + 1.0);

    // 存储更新的鼓间隔/峰值，供下次 _scheduleNext 使用
    this._drumInterval = drumInterval;
    this._drumPeak = drumPeak;
    this._crowdPeak = crowdPeak;

    // 更新人群层增益
    if (this._layers.crowd && this._layers.crowd.g) {
      this._layers.crowd.g.gain.cancelScheduledValues(ct);
      this._layers.crowd.g.gain.setValueAtTime(this._layers.crowd.g.gain.value || 0, ct);
      this._layers.crowd.g.gain.linearRampToValueAtTime(
        envWet * crowdPeak * 0.05, ct + 1.0);
    }
  }

  /* ---- 清理 ---- */

  _cleanupNodes() {
    for (const n of this._nodes) {
      try { n.stop(); } catch (e) { /* ignore */ }
      try { n.disconnect(); } catch (e) { /* ignore */ }
    }
    this._nodes = [];
    this._layers = {};
  }
}

export default AmbienceSystem;
