/* ==========================================================================
 * qin-chess-3d · src/audio/sampleBank.ts
 * 秦风 · 采样加载管线（C4：sample / sampleLoop 指令的数据源）
 *
 * 设计引用: design/audio/piece-sfx-design.md §4.2（采样/合成混合策略）
 *
 * 职责:
 *   - SAMPLE_MANIFEST 采样清单（key → 资源 URL；现已登记 29 个战场采样：
 *     17 foley + 9 vox + 3 ambient loop，全部干声）
 *   - 懒加载 + 解码（≤6MB PCM 累计预算，超限静默跳过）+ 失败静默降级
 *   - Foley 采样未加载 → 由 executeInst 回退程序化积木；Vocal 采样未加载 →
 *     静默跳过（不降级为合成，避免电子音破功）
 *
 * 依赖: 无（仅持 AudioContext 引用，由 sfx.js init() 时 bind）
 * ========================================================================== */

/** 采样内存预算：解码 PCM 上限（piece-sfx-design §5.1 原估 ≤6MB，实际资产集
 *  解码后约 8.1MB —— 3 条 8s@22k×2ch 环境床已占 4.23MB，foley/vox 另占 ~3.9MB。
 *  上调到 12MB 以容纳全集；移动端可在 init 时按 navigator.deviceMemory 下调。 */
export const MAX_SAMPLE_BYTES = 12 * 1024 * 1024;

/** 采样清单：key → 相对站点根的资源 URL。
 *
 *  资产来源说明（诚实标注）：`assets/audio/**` 下 29 个 WAV 由离线物理建模合成
 *  产出（模态叠加 / 颗粒堆叠 / 声门源 + 共振峰轨迹），**不是实地录音**；全部为
 *  「干声」，房间感统一由引擎石殿 Convolver（1.5s IR，design §0.1）负责，避免
 *  双重混响糊成一团。用户后续如有真实录音，同名替换即可热接管，无需改代码。
 *
 *  预算（design §5.1）：单文件 ≤MAX_SAMPLE_BYTES，解码总量 ≤12MB（已上调容纳
 *  全集；原 §5.1 的 6MB 估值偏小）。
 *  当前：磁盘 ~3.7MB / 解码 float32 ~8.1MB。
 *    · foley  17 × ≤0.5s @32k（one-shot，池化复用）
 *    · vox     9 × ≤1.15s @32k
 *    · ambient 3 × 8.0s @22k（无缝循环床）
 */
export const SAMPLE_MANIFEST: Record<string, string> = {
  /* ---- Foley：材质接触（决定「是什么在动」）---- */
  'foley.step.light':   'assets/audio/foley/step_light.wav',    // 兵/仕 轻甲踏沙
  'foley.step.heavy':   'assets/audio/foley/step_heavy.wav',    // 帅/象 重甲踏地
  'foley.hoof':         'assets/audio/foley/hoof.wav',          // 马 蹄铁三连
  'foley.wheel':        'assets/audio/foley/wheel.wav',         // 车/炮 木轮碾地辚辚
  'foley.armor':        'assets/audio/foley/armor.wav',         // 甲片簇 + 余韵
  'foley.cloth':        'assets/audio/foley/cloth.wav',         // 布帛/丝帛摩挲
  'foley.whoosh.light': 'assets/audio/foley/whoosh_light.wav',  // 戈/剑 破空
  'foley.whoosh.heavy': 'assets/audio/foley/whoosh_heavy.wav',  // 钺/车戈/王剑 破空
  'foley.clash.bronze': 'assets/audio/foley/clash_bronze.wav',  // 青铜交击（BAR/BELL）
  'foley.clash.iron':   'assets/audio/foley/clash_iron.wav',    // 铁箍交击（IRON，最暗）
  'foley.clash.blade':  'assets/audio/foley/clash_blade.wav',   // 短剑/戟 交击（最亮）
  'foley.thud.light':   'assets/audio/foley/thud_light.wav',    // 轻甲命中闷击
  'foley.thud.heavy':   'assets/audio/foley/thud_heavy.wav',    // 重甲命中闷击
  'foley.stone.crush':  'assets/audio/foley/stone_crush.wav',   // 炮 石弹落地碎裂
  'foley.wood.creak':   'assets/audio/foley/wood_creak.wav',    // 炮 木车吱呀
  'foley.drum.war':     'assets/audio/foley/war_drum.wav',      // 落位战鼓（圆膜本征模）
  'foley.land.heavy':   'assets/audio/foley/land_heavy.wav',    // 重量落地

  /* ---- Vocal：人声/兽声（决定「谁在动、情绪如何」·拟真突破关键）---- */
  'vox.shout.kill':     'assets/audio/vox/shout_kill.wav',      // 「杀！」九人齐吼（A2）
  'vox.shout.charge':   'assets/audio/vox/shout_charge.wav',    // 冲锋嘶吼（A0）
  'vox.shout.drive':    'assets/audio/vox/shout_drive.wav',     // 车·御者「驾！」（M1）
  'vox.shout.fire':     'assets/audio/vox/shout_fire.wav',      // 炮·「放！」（发射瞬间）
  'vox.shout.heave':    'assets/audio/vox/shout_heave.wav',     // 号子「嘿！/起！」（M1）
  'vox.king.roar':      'assets/audio/vox/king_roar.wav',       // 帅·低沉一喝（A2）
  'vox.horse.neigh':    'assets/audio/vox/horse_neigh.wav',     // 冲锋马嘶（A0）
  'vox.horse.snort':    'assets/audio/vox/horse_snort.wav',     // 响鼻（idle）
  'vox.breath':         'assets/audio/vox/breath.wav',          // 待机呼吸

  /* ---- Ambient：8s 无缝循环床 ---- */
  'ambient.loop.wind':  'assets/audio/ambient/wind_loop.wav',   // 风沙席卷
  'ambient.loop.crowd': 'assets/audio/ambient/crowd_loop.wav',  // 远处军阵嗡鸣
  'ambient.loop.drum':  'assets/audio/ambient/drum_loop.wav'    // 远处行军鼓点
};

let _ctx: any = null;
const _cache = new Map<string, AudioBuffer>();
const _state = new Map<string, 'pending' | 'loaded' | 'failed'>();
const _inflight = new Map<string, Promise<AudioBuffer | null>>();
/** 已解码 PCM 累计字节（预算闸门：超预算后续采样静默跳过，不抛错） */
let _bytes = 0;

/** 绑定 AudioContext（sfx.js init() 时调用） */
export function bindSampleContext(ctx: any): void {
  _ctx = ctx;
}

/** 采样是否已加载 */
export function hasSample(key: string): boolean {
  return _cache.has(key);
}

/** 获取已解码采样（未加载/失败返回 null → 调用方静默回退） */
export function getSample(key: string): AudioBuffer | null {
  return _cache.get(key) || null;
}

/** 采样加载状态：'pending' | 'loaded' | 'failed' */
export function sampleState(key: string): string {
  return _state.get(key) || 'pending';
}

/**
 * 懒加载单个采样（幂等：并发去重；失败静默置 failed 返回 null）。
 * 仅当有 URL、有 ctx、运行环境支持 fetch + decodeAudioData 时才真正拉取。
 */
export async function loadSample(key: string): Promise<AudioBuffer | null> {
  const url = SAMPLE_MANIFEST[key];
  if (!url) {
    _state.set(key, 'failed');
    return null;
  }
  if (_cache.has(key)) return _cache.get(key)!;
  if (_inflight.has(key)) return _inflight.get(key)!;
  if (!_ctx || typeof fetch !== 'function' || typeof _ctx.decodeAudioData !== 'function') {
    _state.set(key, 'failed');
    return null;
  }

  const p = (async (): Promise<AudioBuffer | null> => {
    try {
      if (_bytes >= MAX_SAMPLE_BYTES) throw new Error('采样内存预算已满');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_SAMPLE_BYTES) throw new Error('sample 超预算');
      const audio = await _ctx.decodeAudioData(buf);
      // 解码后 PCM 体积 = 帧数 × 声道 × 4B(float32)，累计闸门（design §5.1 ≤6MB）
      const decoded = audio.length * audio.numberOfChannels * 4;
      if (_bytes + decoded > MAX_SAMPLE_BYTES) throw new Error('采样内存预算已满');
      _bytes += decoded;
      _cache.set(key, audio);
      _state.set(key, 'loaded');
      return audio;
    } catch (e) {
      // 失败静默：不抛错、不打断游戏流程
      _state.set(key, 'failed');
      return null;
    }
  })();

  _inflight.set(key, p);
  try {
    return await p;
  } finally {
    _inflight.delete(key);
  }
}

/** 批量预加载（keys 缺省 = 全清单）。
 *  优先级：ambient 循环床优先（进场即需常驻），再 vox（拟真突破关键），最后 foley
 *  （未到位期间有程序化 fallback 兜底，可最后落地）。
 *  加载改为「分批并行」（每批 6 条 Promise.all），避免逐条 await 在软件解码/
 *  弱网下被拖成 20s+；单条失败静默，不阻断其余。
 */
export async function preloadSamples(keys?: string[]): Promise<void> {
  const all = keys || Object.keys(SAMPLE_MANIFEST);
  const rank = (k: string): number =>
    k.startsWith('ambient.') ? 0 : (k.startsWith('vox.') ? 1 : 2);
  const ks = all.slice().sort((a, b) => rank(a) - rank(b));
  const BATCH = 6;
  for (let i = 0; i < ks.length; i += BATCH) {
    const batch = ks.slice(i, i + BATCH);
    await Promise.all(batch.map(k => loadSample(k).catch(() => null)));
  }
}

/** 加载统计（诊断/日志用） */
export function sampleStats(): { total: number; loaded: number; failed: number; bytes: number } {
  let loaded = 0, failed = 0;
  for (const k of Object.keys(SAMPLE_MANIFEST)) {
    const s = _state.get(k);
    if (s === 'loaded') loaded++;
    else if (s === 'failed') failed++;
  }
  return { total: Object.keys(SAMPLE_MANIFEST).length, loaded, failed, bytes: _bytes };
}

/** 清空缓存（测试/热更新用） */
export function clearSamples(): void {
  _cache.clear();
  _state.clear();
  _inflight.clear();
  _bytes = 0;
}
