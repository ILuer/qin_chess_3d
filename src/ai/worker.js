/**
 * worker.js —— AI 搜索的 module worker
 * 由 engine.js 以 new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }) 创建。
 * 只依赖纯逻辑模块（constants / board / rules / search），不触碰 Three.js 与 DOM。
 */

import { boardFromFen } from '../core/board.js';
import { searchBestMove, DIFFICULTY } from './search.js';

self.addEventListener('message', ev => {
  const msg = ev.data || {};
  if (msg.type === 'ping') { self.postMessage({ type: 'pong', id: msg.id }); return; }
  if (msg.type !== 'search') return;

  const id = msg.id;
  try {
    const board = boardFromFen(msg.fen);
    const preset = DIFFICULTY[msg.difficulty] || DIFFICULTY[2];
    const result = searchBestMove(board, msg.side, {
      depth: msg.depth != null ? msg.depth : preset.depth,
      timeLimit: msg.timeLimit != null ? msg.timeLimit : preset.timeLimit,
      randomness: msg.randomness != null ? msg.randomness : preset.randomness
    });
    self.postMessage({ type: 'result', id, result });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: (err && err.message) || String(err) });
  }
});

self.postMessage({ type: 'ready' });
