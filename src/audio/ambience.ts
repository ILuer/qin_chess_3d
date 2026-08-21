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

import { SFX } from './sfx.ts';
import { AMBIENT_LAYERS, TENSION_WEIGHTS, TENSION_MAP, AMBIENT_BEDS } from './recipes.ts';
import { getSample, loadSample } from './sampleBank.ts';

/* --------------------------------------------------------------------------
 * 0. 常量
 * ------------------------------------------------------------------------ */

const FLOOR = 0.0001;
const TENSION_SMOOTH_TAU = 2.5;     // 一阶低通时间常数（秒）
const TENSION_CHECK_TAU = 0.35;     // 将军事件快速响应

/**
 * D2 战局强度事件脉冲（piece-sfx-design §2.2）
 * 原则：只升「密度」不升「音量」——靠鼓/号角/喊杀的间隔加密与层级叠加制造压迫，
 * 不推大 master；ambLimit 压缩器兜底。
 * 阈值供 PERF-004 断言：残局 pieceCount<12 / 连杀 recentCaptures>=2。
 */
export const EVENT_PULSE = {
  KILL_STREAK_MIN: 2,        // 连杀阈值（recentCaptures >= 2）
  KILL_STREAK_HOLD_S: 3.0,   // 连杀脉冲持续（~3s）
  ENDGAME_PIECE_MAX: 12,     // 残局阈值（pieceCount < 12）
  SHOUT_PEAK_MUL: 1.5,       // 连杀：人群喊杀峰值 ×1.5
  DRUM_INTERVAL_MUL: 0.7,    // 连杀：远鼓间隔 ×0.7
  ENDGAME_HORN_MUL: 0.55,    // 残局：号角间隔 ×0.55（加密）
  ENDGAME_DRUM_MUL: 0.8,     // 残局：远鼓间隔 ×0.8
  DRUM_DOUBLE_GAP_S: 0.16,   // 将军：远鼓双连击间隔
  HEARTBEAT_GAP_S: 1.6       // 将军：元帅心跳节流（避免每帧触发）
};

/* --------------------------------------------------------------------------
 * 1. 小工具
 * ------------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => ((v < lo) ? lo : (v > hi ? hi : v));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const _int = (): any => SFX._internals || {};

/** 一阶低通平滑 */
function lerpSmooth(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  const a = Math.exp(-dt / tau);
  return target * (1 - a) + current * a;
}

/** 几何插值: v0 × (v1/v0)^t */
function geomLerp(v0: number, v1: number, t: number): number {
  if (v0 <= 0) return v1;
  return v0 * Math.pow(v1 / v0, clamp(t, 0, 1));
}

/** 线性插值 */
function linLerp(v0: number, v1: number, t: number): number {
  return v0 + (v1 - v0) * clamp(t, 0, 1);
}

/* --------------------------------------------------------------------------
 * 2. AmbienceSystem 类
 * ------------------------------------------------------------------------ */

export class AmbienceSystem {
  _active: boolean;
  _enabled: boolean;
  _layers: Record<string, any>;
  /** 采样环境床（风沙/远处军阵/行军鼓），解码完成后异步挂载 */
  _beds: Record<string, any>;
  _timers: Array<ReturnType<typeof setTimeout>>;
  _nodes: any[];
  _tension: number;
  _tensionRaw: number;
  _lastUpdate: number;
  _gameState: unknown;
  _breathTimer: number | ReturnType<typeof setTimeout>;
  _breathPhase: string;
  _drumInterval?: number;
  _drumPeak?: number;
  _crowdPeak?: number;
  _pulse: any;
  _killStreakUntil: number;
  _lastHeartbeatAt: number;

  constructor() {
    this._active = false;       // 是否已启动
    this._enabled = true;       // 独立静音
    this._layers = {};          // 五层运行时状态
    this._beds = {};            // 采样环境床运行时状态（异步挂载）
    this._timers = [];          // 定时器 ID
    this._nodes = [];           // 音频节点引用
    this._tension = 0.12;       // 当前张力（平滑后）
    this._tensionRaw = 0.12;
    this._lastUpdate = 0;
    this._gameState = null;     // 游戏状态引用（用于计算张力）
    this._pulse = null;         // D2：事件脉冲（连杀/残局/将军）
    this._killStreakUntil = 0;
    this._lastHeartbeatAt = 0;

    // 抗疲劳
    this._breathTimer = 0;
    this._breathPhase = 'normal'; // 'normal' | 'descending' | 'hold' | 'rising'
  }

  /* ---- 启动 ---- */

  start(): boolean | void {
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

  stop(): void {
    this._active = false;
    this._stopTimers();
    this._fadeOut(() => {
      this._cleanupNodes();
    });
  }

  /* ---- 静音控制 ---- */

  setEnabled(v: unknown): boolean {
    this._enabled = !!v;
    // 修复：开启时若环境系统尚未激活（首启惰性），先 start() 真正拉起氛围床与
    // 定时器，避免「开了开关却不出声」的死分支（start() 内部有 _active 幂等守卫）。
    if (v) {
      if (!this._active) this.start();
      else { this._fadeIn(); this._startTimers(); }
    } else if (this._active) {
      this._stopTimers();
      this._fadeOut();
    }
    return this._enabled;
  }

  isEnabled(): boolean { return this._enabled; }

  /* ---- 张力更新 (由外部每帧调用或走子后调用) ---- */

  /**
   * 更新张力因子并计算当前张力。
   * @param {object} gs 游戏状态 { materialAdv, pieceCount, inCheck, checkSide,
   *                                recentCaptures, enemyAdvancement }
   * @param {number} dt 帧间隔（秒）
   */
  updateTension(gs: any, dt: number): number | void {
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

    // D2：事件级脉冲（连杀/残局/将军 —— 只升密度不升音量）
    this._applyEventPulses(gs);

    return this._tension;
  }

  /**
   * D2 战局强度事件脉冲（piece-sfx-design §2.2）
   * - 连杀：recentCaptures >= 2 → 人群喊杀峰值 ×1.5 / 远鼓间隔 ×0.7，持续 ~3s
   * - 残局：pieceCount < 12 → 号角进入循环（间隔加密）、远鼓更密
   * - 将军：inCheck → 号角强拍 + 远鼓双连击 + 元帅心跳（king.heartbeat 复用）
   * 阈值常量见 EVENT_PULSE（PERF-004 断言）。
   */
  _applyEventPulses(gs: any): void {
    const pulse: any = { shoutMul: 1, drumMul: 1, hornMul: 1, hornStrong: false, doubleDrum: false };
    const now = performance.now();

    // 连杀：2 连及以上
    if (gs.recentCaptures != null && gs.recentCaptures >= 2 /* EVENT_PULSE.KILL_STREAK_MIN */) {
      this._killStreakUntil = now + EVENT_PULSE.KILL_STREAK_HOLD_S * 1000;
    }
    if (this._killStreakUntil && now < this._killStreakUntil) {
      pulse.shoutMul = EVENT_PULSE.SHOUT_PEAK_MUL;        // 人群喊杀峰值 ×1.5
      pulse.drumMul = EVENT_PULSE.DRUM_INTERVAL_MUL;      // 远鼓间隔 ×0.7
    }

    // 残局：子力 <12
    if (gs.pieceCount != null && gs.pieceCount < 12 /* EVENT_PULSE.ENDGAME_PIECE_MAX */) {
      pulse.hornMul = EVENT_PULSE.ENDGAME_HORN_MUL;       // 号角间隔 ×0.55（进入循环）
      pulse.drumMul = Math.min(pulse.drumMul, EVENT_PULSE.ENDGAME_DRUM_MUL); // 远鼓 ×0.8
    }

    // 将军：号角强拍 + 远鼓双连击 + 元帅心跳
    if (gs.inCheck) {
      pulse.hornStrong = true;
      pulse.doubleDrum = true;
      if (now - this._lastHeartbeatAt > EVENT_PULSE.HEARTBEAT_GAP_S * 1000) {
        this._lastHeartbeatAt = now;
        try { SFX.play('king.heartbeat'); } catch (e) { /* 忽略 */ }
      }
    }

    this._pulse = pulse;
  }

  /** 直接设置张力（用于 manually 触发将军等） */
  setTension(level: number): void {
    this._tension = clamp(level, 0, 1);
    this._tensionRaw = this._tension;
    this._applyTensionMap();
  }

  /** 获取当前张力 */
  getTension(): number { return this._tension; }

  /* ---- 内部：构建五层环境床 ---- */

  _buildLayers(): void {
    const i = _int();
    if (!i.ready || !i.ambientBus || !i.noiseBuf) return;

    const t = i.ctx.currentTime;
    const ambBus = i.ambientBus;

    // A-WIND: 连续风 (8s loop buffer + LFO)
    this._layers.wind = this._buildWindLayer(ambBus, t);

    // B-BANNER & C-DRUM & E-HORSE & F-HORN & G-DUST & H-SHOUT: 阵发（由 timer 触发）
    this._layers.banner = null;
    this._layers.drum = null;
    this._layers.horse = null;
    this._layers.horn = null;
    this._layers.dust = null;
    this._layers.shout = null;

    // D-CROWD: 连续人群
    this._layers.crowd = this._buildCrowdLayer(ambBus, t);

    // I-BEDS: 采样环境床（风沙 / 远处军阵 / 行军鼓）—— 解码到位后交叉淡化接管
    this._beds = {};
    for (const name of Object.keys(AMBIENT_BEDS)) {
      this._mountSampleBed(name);
    }
  }

  /* ---- 采样环境床（8s 无缝循环）---- */

  /**
   * 挂载一条采样环境床。采样已解码 → 立即建；未解码 → 后台等 loadSample 完成再建，
   * 期间程序化层照常发声，绝不出现静默空窗。
   */
  _mountSampleBed(name: string): void {
    const cfg = AMBIENT_BEDS[name];
    if (!cfg) return;
    const buf = getSample(cfg.key);
    if (buf) {
      this._beds[name] = this._buildSampleBed(name, cfg, buf, 0.6);
      return;
    }
    loadSample(cfg.key).then(b => {
      // 加载期间可能已经 stop()，或用户关了环境音 —— 都要老实退出
      if (!b || !this._active || this._beds[name]) return;
      this._beds[name] = this._buildSampleBed(name, cfg, b, cfg.crossfade);
    }).catch(() => {});
  }

  /** 建一条循环床并把被它取代的程序化层淡出（等功率交叉淡化） */
  _buildSampleBed(name: string, cfg: any, buf: AudioBuffer, fadeIn: number): any {
    const i = _int();
    if (!i.ready || !i.ambientBus || !i.ctx) return null;
    const t = i.ctx.currentTime + 0.03;
    const ambBus = i.ambientBus;

    const src = i.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.setValueAtTime(cfg.rate || 1, t);

    let tail: any = src;
    if (cfg.highpass) {
      const hp = i.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(cfg.highpass, t);
      hp.Q.setValueAtTime(0.7, t);
      tail.connect(hp); tail = hp; this._nodes.push(hp);
    }
    if (cfg.lowpass) {
      const lp = i.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(cfg.lowpass, t);
      lp.Q.setValueAtTime(0.8, t);
      tail.connect(lp); tail = lp; this._nodes.push(lp);
    }

    // 电平 + 缓慢起伏 LFO（抗听觉疲劳：8s 循环靠 LFO 打散周期性）
    const g = i.ctx.createGain();
    const target = cfg.gain * this._bedTensionMul(cfg);
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.linearRampToValueAtTime(target, t + Math.max(0.05, fadeIn));
    tail.connect(g);

    let lfo: any = null, lfoG: any = null;
    if (cfg.lfo) {
      lfo = i.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(cfg.lfo.freq, t);
      lfoG = i.ctx.createGain();
      lfoG.gain.setValueAtTime(cfg.gain * cfg.lfo.amp, t);
      lfo.connect(lfoG);
      lfoG.connect(g.gain);
      lfo.start(t);
      this._nodes.push(lfo, lfoG);
    }

    g.connect(ambBus);

    // 石殿混响发送（design §0.1：室内战场，房间感统一由 Convolver 给）
    const send = i.ctx.createGain();
    send.gain.setValueAtTime(cfg.wet, t);
    g.connect(send);
    send.connect(i.convolver || ambBus);

    src.start(t, rand(0, Math.max(0.1, buf.duration - 0.1)));
    this._nodes.push(src, g, send);

    // 交叉淡化：被取代的程序化层等时长淡出到静默（不是硬切，避免可闻断点）
    if (cfg.replaces) {
      const old = this._layers[cfg.replaces];
      if (old && old.g && old.g.gain) {
        try {
          old.g.gain.cancelScheduledValues(t);
          old.g.gain.setValueAtTime(old.g.gain.value, t);
          old.g.gain.linearRampToValueAtTime(FLOOR, t + Math.max(0.05, fadeIn));
        } catch (e) { /* 老层已回收，忽略 */ }
      }
      if (old && old.send && old.send.gain) {
        try { old.send.gain.linearRampToValueAtTime(FLOOR, t + Math.max(0.05, fadeIn)); } catch (e) { /* noop */ }
      }
    }

    return { name, cfg, src, g, send, lfo, lfoG, baseGain: cfg.gain };
  }

  /** 张力 → 该床的电平倍率（tensionMul 两端线性插值） */
  _bedTensionMul(cfg: any): number {
    const m = cfg.tensionMul || [1, 1];
    return linLerp(m[0], m[1], clamp(this._tension, 0, 1));
  }

  /** 张力变化时平滑重定标各采样床电平（1.2s 斜坡，不做突变） */
  _applyBedTension(): void {
    const i = _int();
    if (!i.ready || !i.ctx) return;
    const ct = i.ctx.currentTime;
    for (const name of Object.keys(this._beds)) {
      const bed = this._beds[name];
      if (!bed || !bed.g) continue;
      const target = bed.baseGain * this._bedTensionMul(bed.cfg);
      try {
        bed.g.gain.cancelScheduledValues(ct);
        bed.g.gain.setValueAtTime(bed.g.gain.value, ct);
        bed.g.gain.linearRampToValueAtTime(Math.max(FLOOR, target), ct + 1.2);
        if (bed.lfoG) bed.lfoG.gain.linearRampToValueAtTime(target * (bed.cfg.lfo?.amp || 0), ct + 1.2);
      } catch (e) { /* noop */ }
    }
  }

  _buildWindLayer(ambBus: any, t: number): any {
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

  _buildCrowdLayer(ambBus: any, t: number): any {
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
    lp.connect(bps[0]!.bp);
    for (let j = 0; j < bps.length; j++) {
      if (j < bps.length - 1) {
        gains[j]!.connect(bps[j + 1]!.bp);
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

  _playBanner(): void {
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

  _playDrum(tOverride?: number, f0Override?: number, durOverride?: number): void {
    const i = _int();
    if (!i.ready || !i.ambientBus) return;

    const layer = AMBIENT_LAYERS.drum;
    const t = tOverride || (i.ctx.currentTime + 0.002);
    const ambBus = i.ambientBus;

    const f0 = f0Override || rand(layer.params.f0Min, layer.params.f0Max);
    const dur = durOverride || layer.params.dur;

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

    if (tOverride) return; // 双连击第二击：不重排定时器

    // D2 将军：远鼓双连击（第二击紧跟）
    if (this._pulse && this._pulse.doubleDrum) {
      this._playDrum(t + EVENT_PULSE.DRUM_DOUBLE_GAP_S, f0 * 1.1, dur * 0.8);
    }

    this._scheduleNext('drum');
  }

  _playHorse(): void {
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

  /** 远处喊杀（D1 新增层：crowdBed 变体，更宽更远；连杀时峰值 ×1.5） */
  _playShout(): void {
    const i = _int();
    if (!i.ready || !i.ambientBus) return;

    const layer = AMBIENT_LAYERS.shout;
    const t = i.ctx.currentTime + 0.002;
    const ambBus = i.ambientBus;
    const p = layer.params;

    // 偶发呼喝: 短噪声爆发（peak 受连杀脉冲 ×1.5；ambLimit 兜底不爆音）
    const peak = p.peak * ((this._pulse && this._pulse.shoutMul) || 1);

    const src = i.ctx.createBufferSource();
    src.buffer = i.noiseBuf;
    src.loop = true;
    src.start(t, rand(0, 1.4));
    src.stop(t + p.dur);

    const bp = i.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(rand(800, 1800), t);
    bp.Q.setValueAtTime(1.0, t);

    const g = i.ctx.createGain();
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + p.dur * 0.8);

    src.connect(bp);
    bp.connect(g);
    g.connect(ambBus);

    this._nodes.push(src, bp, g);

    this._scheduleNext('shout');
  }

  /** 号角（D1 新增层：双锯齿微失谐 + 低通吹口扫频 + 低八度垫 + 气声；残局/将军加密） */
  _playHorn(): void {
    const i = _int();
    if (!i.ready || !i.ambientBus) return;

    const layer = AMBIENT_LAYERS.horn;
    const t = i.ctx.currentTime + 0.002;
    const ambBus = i.ambientBus;
    const f = rand(layer.params.freqMin, layer.params.freqMax);
    const dur = layer.params.dur;
    // 将军强拍：仅轻微抬峰（×1.25），主要靠 hornMul 加密 —— 只升密度不升音量
    const peakMul = (this._pulse && this._pulse.hornStrong) ? 1.25 : 1;
    const peak = layer.params.peak * peakMul;

    // 双锯齿微失谐 + 低通吹口扫频
    const o1 = i.ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.setValueAtTime(f, t);
    const o2 = i.ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(f * 1.004, t);
    o2.detune.setValueAtTime(8, t);

    const lp = i.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.linearRampToValueAtTime(f * 5.5, t + Math.min(0.12, dur * 0.4));
    lp.frequency.linearRampToValueAtTime(f * 2.2, t + dur);
    lp.Q.setValueAtTime(3.2, t);

    const mix = i.ctx.createGain();
    mix.gain.setValueAtTime(0.5, t);
    o1.connect(mix); o2.connect(mix); mix.connect(lp);

    const g = i.ctx.createGain();
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.05);
    g.gain.setValueAtTime(peak, t + 0.05 + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
    lp.connect(g);
    g.connect(ambBus);

    // 低八度垫
    const sub = i.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(f * 0.5, t);
    const sg = i.ctx.createGain();
    sg.gain.setValueAtTime(FLOOR, t);
    sg.gain.exponentialRampToValueAtTime(peak * 0.45, t + 0.05);
    sg.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
    sub.connect(sg); sg.connect(ambBus);

    // 气声
    const air = i.ctx.createBufferSource();
    air.buffer = i.noiseBuf;
    air.loop = true;
    air.playbackRate.setValueAtTime(1, t);
    air.start(t, rand(0, 1.4));
    air.stop(t + dur + 0.05);
    const abp = i.ctx.createBiquadFilter();
    abp.type = 'bandpass';
    abp.frequency.setValueAtTime(f * 3, t);
    abp.Q.setValueAtTime(1.1, t);
    const ag = i.ctx.createGain();
    ag.gain.setValueAtTime(FLOOR, t);
    ag.gain.exponentialRampToValueAtTime(peak * 0.09, t + 0.03);
    ag.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
    air.connect(abp); abp.connect(ag); ag.connect(ambBus);

    // 湿声
    const send = i.ctx.createGain();
    send.gain.setValueAtTime(layer.wet, t);
    g.connect(send);
    send.connect(i.convolver || ambBus);

    this._nodes.push(o1, o2, lp, mix, g, sub, sg, air, abp, ag, send);
  }

  /** 尘土滚地（D1 新增层：远场低通噪声缓慢扫频） */
  _playDust(): void {
    const i = _int();
    if (!i.ready || !i.ambientBus) return;

    const layer = AMBIENT_LAYERS.dust;
    const t = i.ctx.currentTime + 0.002;
    const ambBus = i.ambientBus;
    const p = layer.params;

    const src = i.ctx.createBufferSource();
    src.buffer = i.noiseBuf;
    src.loop = true;
    src.playbackRate.setValueAtTime(rand(0.92, 1.05), t);
    src.start(t, rand(0, 1.4));
    src.stop(t + p.dur + 0.05);

    const bp = i.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(p.f0, t);
    bp.Q.setValueAtTime(p.q, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(p.f1, 40), t + p.dur);

    const g = i.ctx.createGain();
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.exponentialRampToValueAtTime(p.peak, t + p.attack);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + p.dur);

    src.connect(bp);
    bp.connect(g);
    g.connect(ambBus);

    // 湿声
    const send = i.ctx.createGain();
    send.gain.setValueAtTime(layer.wet, t);
    g.connect(send);
    send.connect(i.convolver || ambBus);

    this._nodes.push(src, bp, g, send);
  }

  /* ---- 定时器管理 ---- */

  _startTimers(): void {
    if (!this._enabled) return;
    this._scheduleNext('banner');
    this._scheduleNext('drum');
    this._scheduleNext('horse');
    this._scheduleNext('horn');
    this._scheduleNext('dust');
    this._scheduleNext('shout');
    this._startBreathCycle();
  }

  _stopTimers(): void {
    this._timers.forEach(t => clearTimeout(t));
    this._timers = [];
  }

  _scheduleNext(event: string): void {
    if (!this._active || !this._enabled) return;

    let delayMs: number;
    const layer = (AMBIENT_LAYERS as Record<string, any>)[event];
    const tension = this._tension;

    switch (event) {
      case 'banner':
        delayMs = rand(layer.interval.lo, layer.interval.hi) * 1000;
        break;
      case 'drum': {
        // 张力驱动间隔 + D2 事件脉冲（连杀/残局加密）
        const t0 = TENSION_MAP[0.0].drumInterval;
        const t1 = TENSION_MAP[1.0].drumInterval;
        let iv = geomLerp(t0, t1, tension);
        if (this._pulse && this._pulse.drumMul != null) iv *= this._pulse.drumMul;
        delayMs = iv * 1000;
        break;
      }
      case 'horse':
        delayMs = rand(layer.interval.lo, layer.interval.hi) * 1000;
        break;
      case 'horn': {
        // 张力驱动 + D2 事件脉冲（残局/将军：号角加密 → 接近循环）
        const base = geomLerp(60.0, 26.0, tension);
        let iv = base;
        if (this._pulse && this._pulse.hornMul != null) iv *= this._pulse.hornMul;
        delayMs = iv * 1000;
        break;
      }
      case 'dust':
        delayMs = rand(layer.interval.lo, layer.interval.hi) * 1000;
        break;
      case 'shout':
        delayMs = rand(layer.interval.lo, layer.interval.hi) * 1000;
        break;
      default:
        return;
    }

    const timer = setTimeout(() => {
      if (!this._active || !this._enabled) return;
      if (event === 'banner') this._playBanner();
      else if (event === 'drum') this._playDrum();
      else if (event === 'horse') this._playHorse();
      else if (event === 'horn') this._playHorn();
      else if (event === 'dust') this._playDust();
      else if (event === 'shout') this._playShout();
    }, delayMs);

    this._timers.push(timer);
  }

  /* ---- 淡入淡出 ---- */

  _fadeIn(): void {
    const i = _int();
    if (!i.ready || !i.ambientBus) return;
    const t = i.ctx.currentTime;
    i.ambientBus.gain.cancelScheduledValues(t);
    i.ambientBus.gain.setValueAtTime(FLOOR, t);
    i.ambientBus.gain.exponentialRampToValueAtTime(0.70, t + 1.5);
  }

  _fadeOut(onComplete?: () => void): void {
    const i = _int();
    if (!i.ready || !i.ambientBus) { if (onComplete) onComplete(); return; }
    const t = i.ctx.currentTime;
    i.ambientBus.gain.cancelScheduledValues(t);
    i.ambientBus.gain.setValueAtTime(Math.max(i.ambientBus.gain.value, FLOOR), t);
    i.ambientBus.gain.exponentialRampToValueAtTime(FLOOR, t + 0.8);
    if (onComplete) setTimeout(onComplete, 900);
  }

  /* ---- 抗听觉疲劳：强制宏观呼吸 ---- */

  _startBreathCycle(): void {
    if (!this._active || !this._enabled) return;
    this._breathPhase = 'normal';
    this._breathTimer = setTimeout(() => this._breathDescend(), rand(40000, 90000));
  }

  _breathDescend(): void {
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

  _breathHold(): void {
    if (!this._active) return;
    this._breathPhase = 'hold';
    const holdMs = rand(6000, 8000);
    this._breathTimer = setTimeout(() => this._breathRise(), holdMs);
  }

  _breathRise(): void {
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

  _applyTensionMap(): void {
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

    // 更新人群层增益。注意：若采样床已接管人群层，这里必须让位 ——
    // 否则会把交叉淡化中的程序化层重新推回来，变成「采样 + 合成」双层嗡鸣。
    if (this._layers.crowd && this._layers.crowd.g && !(this._beds && this._beds.crowd)) {
      this._layers.crowd.g.gain.cancelScheduledValues(ct);
      this._layers.crowd.g.gain.setValueAtTime(this._layers.crowd.g.gain.value || 0, ct);
      this._layers.crowd.g.gain.linearRampToValueAtTime(
        envWet * crowdPeak * 0.05, ct + 1.0);
    }

    // 采样环境床随张力重定标（风沙/军阵/行军鼓）
    this._applyBedTension();
  }

  /* ---- 清理 ---- */

  _cleanupNodes(): void {
    for (const n of this._nodes) {
      try { n.stop(); } catch (e) { /* ignore */ }
      try { n.disconnect(); } catch (e) { /* ignore */ }
    }
    this._nodes = [];
    this._layers = {};
    this._beds = {};
  }
}

export default AmbienceSystem;
