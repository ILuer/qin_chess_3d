/**
 * src/telemetry.js —— 本地埋点（engineering-lead · H1）
 *
 * 决策（用户拍板 2026-08-17）：**取消外部接收端，保持纯静态 CF Pages 部署**。
 * 本模块只做「本地采集 + 队列 + console 输出」，**不上报任何外部服务**。
 * 错误排查继续由 console.error / onFatal 承担；本模块为未来接入数据平台预留接口。
 *
 * 契约：
 *   trackEvent(name, props?)   —— 记录事件（写本地队列 + console 输出）
 *   trackError(message, stack?)—— 记录错误（stack 截 2000 字符）
 *   flush()                    —— 输出并清空队列（pagehide 时由 main.js 调用）
 *   getSessionId()             —— 本次会话 ID（UUID v4 风格，随机生成）
 *   tickFps(dt)                —— 每帧采样帧率；每秒聚合 1 次，每 5 秒输出 fps_bucket
 *
 * 隐私：不采集任何个人身份信息（PII）——无账号、无设备指纹、无 IP。
 * README 已披露。
 */

const MAX_QUEUE = 20;
const FPS_BUCKET_SECONDS = 5;

/** 会话 ID：一次页面加载唯一 */
function makeSessionId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (e) { /* 降级到随机串 */ }
  return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

const sessionId = makeSessionId();
const queue: Array<{ t: number, sessionId: string, name: string, props: Record<string, unknown> }> = [];
let startedAt = performance.now();

/** 人类可读时间戳（本地时区，仅调试用） */
function ts(): string {
  return new Date().toISOString();
}

/** 入队 + console 输出（本地观察用，不上报） */
function trackEvent(name: string, props: Record<string, unknown> = {}): Record<string, unknown> {
  const evt = {
    t: Date.now(),
    sessionId,
    name,
    props
  };
  queue.push(evt);
  // 本地可观测性：console 输出即「上报」（当前无外部接收端）
  try {
    // eslint-disable-next-line no-console
    console.log('[telemetry]', name, props);
  } catch (e) { /* console 不可用时静默 */ }
  if (queue.length >= MAX_QUEUE) flush();
  return evt;
}

/** 记录错误：message + stack（截 2000 字符），与 onFatal/onFatalRejection 配合 */
function trackError(message: unknown, stack?: unknown): Record<string, unknown> {
  const safeMsg = String(message == null ? '' : message).slice(0, 2000);
  const safeStack = String(stack == null ? '' : stack).slice(0, 2000);
  return trackEvent('error', { message: safeMsg, stack: safeStack });
}

/** 输出并清空本地队列（pagehide / 队列满时调用）。当前仅 console 输出。 */
function flush(): void {
  if (!queue.length) return;
  const n = queue.length;
  try {
    // eslint-disable-next-line no-console
    console.log(`[telemetry] flush(${n})`, queue.map(e => e.name));
  } catch (e) { /* 静默 */ }
  queue.length = 0;
}

function getSessionId(): string { return sessionId; }

// ---------------------------------------------------------------------------
// fps_bucket 探针：每秒采样平均帧率，每 5 秒聚合一次输出
// ---------------------------------------------------------------------------

let fpsAccum = 0;
let fpsCount = 0;
let secondStart = performance.now();
let bucket: number[] = [];
let bucketStart = performance.now();

/**
 * 每帧调用一次（dt 为秒）。内部按 1s 采样、5s 聚合，成本极低。
 * @param {number} dt 上一帧耗时（秒）；dt<=0（hitstop）时跳过
 */
function tickFps(dt: number): void {
  if (!(dt > 0)) return;
  const fps = 1 / dt;
  fpsAccum += fps;
  fpsCount++;

  const now = performance.now();
  if (now - secondStart >= 1000) {
    const avg = fpsAccum / Math.max(1, fpsCount);
    bucket.push(avg);
    fpsAccum = 0;
    fpsCount = 0;
    secondStart = now;
  }

  if (bucket.length >= FPS_BUCKET_SECONDS) {
    const sum = bucket.reduce((a, b) => a + b, 0);
    const avg = sum / bucket.length;
    const sorted = bucket.slice().sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
    trackEvent('fps_bucket', {
      avg: Math.round(avg),
      p95: Math.round(p95),
      n: bucket.length,
      sinceMs: Math.round(now - bucketStart)
    });
    bucket = [];
    bucketStart = now;
  }
}

/** 启动到现在的毫秒数（TTI 探针用） */
function elapsedMs() {
  return Math.round(performance.now() - startedAt);
}

export {
  trackEvent,
  trackError,
  flush,
  getSessionId,
  tickFps,
  elapsedMs
};

export default {
  trackEvent,
  trackError,
  flush,
  getSessionId,
  tickFps,
  elapsedMs
};
