/**
 * coords.js — 棋盘坐标 / 声像 pan 纯工具（Phase A1）
 *
 * 零 three 依赖，仅依赖 src/core/constants.ts（可被 node 直接加载）。
 * 目标：消除 MoveAction / CaptureAction 内重复的 _cellPan 私有定义（单一定义），
 * 并为 Phase C（PannerNode 3D 定位）提供 cellWorldPos 统一入口。
 *
 * 语义来源：
 *   - cellPan：旧 MoveAction._cellPan / CaptureAction._cellPan（A1 验收「与旧值一致」）
 *   - cellWorldPos：与 src/core/constants.ts 的 toWorld 完全一致（唯一实现）
 */

import { toWorld } from '../../core/constants.ts';

/**
 * 按 cell 计算声像 pan（−0.7..0.7，与旧 _cellPan 语义逐点一致）。
 * file 0..8 → −4..4 → 线性映射到 [−0.7, 0.7]，越界钳制。
 * @param {{file:number, rank:number}} cell
 * @returns {number}
 */
export function cellPan(cell: { file: number, rank: number }): number {
  const x = cell.file - 4;
  return Math.max(-0.7, Math.min(0.7, (x / 4) * 0.7));
}

/**
 * 棋盘坐标 -> 世界坐标（XZ 平面，棋子站 y=0）。
 * 与 src/core/constants.ts 的 toWorld 一致 —— 供音频 PannerNode source 定位等使用。
 * @param {number} file 0..8
 * @param {number} rank 0..9
 * @returns {{x:number, z:number}}
 */
export function cellWorldPos(file: number, rank: number): { x: number, z: number } {
  return toWorld(file, rank);
}
