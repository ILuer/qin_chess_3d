/* ==========================================================================
 * qin-chess-3d · src/audio/sampleBank.ts
 * 秦风 · 采样加载管线（C4：sample / sampleLoop 指令的数据源）
 *
 * 设计引用: design/audio/piece-sfx-design.md §4.2（采样/合成混合策略）
 *
 * 职责:
 *   - SAMPLE_MANIFEST 采样清单（key → 资源 URL；当前项目零音频文件，清单为空，
 *     管线就位但无文件时全程序化可玩 —— 采样热替换为资产到位后的加分项）
 *   - 懒加载 + 解码（≤6MB PCM 预算）+ 失败静默降级
 *   - Foley 采样未加载 → 由 executeInst 回退程序化积木；Vocal 采样未加载 →
 *     静默跳过（不降级为合成，避免电子音破功）
 *
 * 依赖: 无（仅持 AudioContext 引用，由 sfx.js init() 时 bind）
 * ========================================================================== */

/** 采样内存预算：解码 PCM ≤6MB（piece-sfx-design §5.1） */
export const MAX_SAMPLE_BYTES = 6 * 1024 * 1024;

/** 采样清单：key → 相对仓库根的资源 URL。当前零音频文件，结构就位。
 *  资产到位后在此登记（foley one-shot ≤0.5s 池化复用；vox ≤1.5s；环境 loop ≤8s×3）。
 *  示例：
 *    'foley.step.pawn':  'assets/audio/foley/step_pawn.wav',
 *    'vox.shout.pawn':   'assets/audio/vox/shout_pawn.wav',
 *    'ambient.loop.wind':'assets/audio/ambient/wind_loop.wav'
 */
export const SAMPLE_MANIFEST: Record<string, string> = {};

let _ctx: any = null;
const _cache = new Map<string, AudioBuffer>();
const _state = new Map<string, 'pending' | 'loaded' | 'failed'>();
const _inflight = new Map<string, Promise<AudioBuffer | null>>();

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
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_SAMPLE_BYTES) throw new Error('sample 超预算');
      const audio = await _ctx.decodeAudioData(buf);
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

/** 批量预加载（keys 缺省 = 全清单） */
export async function preloadSamples(keys?: string[]): Promise<void> {
  const ks = keys || Object.keys(SAMPLE_MANIFEST);
  await Promise.all(ks.map(k => loadSample(k).catch(() => null)));
}

/** 清空缓存（测试/热更新用） */
export function clearSamples(): void {
  _cache.clear();
  _state.clear();
  _inflight.clear();
}
