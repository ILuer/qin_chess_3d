/**
 * BeatSequencer.js — 拍点回调注册与调度
 *
 * 用于 CombatDirector 中每个拍点的 onStart 回调分发 SFX/VFX。
 * - register(beatId, callback) — 注册回调
 * - fire(beatId, ...args) — 触发已注册回调
 * - clear() — 清空所有注册
 *
 * 不依赖 Three.js，纯调度器。
 */

export class BeatSequencer {
  _registry: Map<string, Array<(...args: unknown[]) => void>>;

  constructor() {
    /** @type {Map<string, Array<Function>>} beatId → callbacks[] */
    this._registry = new Map();
  }

  /**
   * 注册一个拍点回调
   * @param {string} beatId  拍点 ID（如 'M0_start', 'A2_onComplete', 'T_ZERO'）
   * @param {Function} callback  回调函数
   * @returns {Function} 返回取消注册的函数
   */
  register(beatId: string, callback: (...args: unknown[]) => void): () => void {
    if (!this._registry.has(beatId)) {
      this._registry.set(beatId, []);
    }
    this._registry.get(beatId)!.push(callback);

    // 返回取消注册的函数
    return () => {
      const list = this._registry.get(beatId);
      if (list) {
        const idx = list.indexOf(callback);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  /**
   * 触发某拍点的全部已注册回调
   * @param {string} beatId  拍点 ID
   * @param  {...any} args  透传给每个 callback
   */
  fire(beatId: string, ...args: unknown[]): void {
    const list = this._registry.get(beatId);
    if (!list || !list.length) return;

    // 用副本遍历，防止回调中修改注册表
    const copy = list.slice();
    for (let i = 0; i < copy.length; i++) {
      try {
        copy[i]!(...args);
      } catch (e) {
        console.warn(`[BeatSequencer] 回调异常 beatId="${beatId}" :`, e);
      }
    }
  }

  /**
   * 清空指定拍点的所有回调，或清空全部
   * @param {string} [beatId]  不传则清空全部
   */
  clear(beatId?: string): void {
    if (beatId) {
      this._registry.delete(beatId);
    } else {
      this._registry.clear();
    }
  }

  /**
   * 获取已注册的拍点列表（调试用）
   * @returns {string[]}
   */
  getRegisteredBeats(): string[] {
    return Array.from(this._registry.keys());
  }

  /**
   * 批量注册（便捷方法）
   * @param {Object<string, Function>} map  { beatId: callback, ... }
   * @returns {Function} 批量取消函数
   */
  registerAll(map: Record<string, (...args: unknown[]) => void>): () => void {
    const unregisters: Array<() => void> = [];
    for (const [beatId, cb] of Object.entries(map)) {
      unregisters.push(this.register(beatId, cb));
    }
    return () => unregisters.forEach(fn => fn());
  }
}
