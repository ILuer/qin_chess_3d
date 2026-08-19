/**
 * worker.js —— AI 搜索的 module worker
 * 由 engine.js 以 new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) 创建。
 * 只依赖纯逻辑模块（constants / board / rules / search），不触碰 Three.js 与 DOM。
 */

import { boardFromFen } from '../core/board.ts';
import { searchBestMove, DIFFICULTY } from './search.ts';

self.addEventListener('message', ev => {
  const msg = (ev.data || {}) as Record<string, unknown>;
  if (msg.type === 'ping') { self.postMessage({ type: 'pong', id: msg.id }); return; }
  if (msg.type !== 'search') return;

  const id = msg.id;
  try {
    const board = boardFromFen(String(msg.fen));
    const preset = DIFFICULTY[Number(msg.difficulty)] || DIFFICULTY[2]!;
    const result = searchBestMove(board, String(msg.side), {
      depth: msg.depth != null ? Number(msg.depth) : preset.depth,
      timeLimit: msg.timeLimit != null ? Number(msg.timeLimit) : preset.timeLimit,
      randomness: msg.randomness != null ? Number(msg.randomness) : preset.randomness
    });
    self.postMessage({ type: 'result', id, result });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: ((err as Error) && (err as Error).message) || String(err) });
  }
});

self.postMessage({ type: 'ready' });
