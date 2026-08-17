/**
 * sw.js —— 秦风·3D 中国象棋 Service Worker（release-ops-lead · L1 PWA）
 *
 * 版本 v2：适配 H4 构建迁移（esbuild 产物 dist/，index.html 入口 = dist/main.js）。
 *
 * 设计原则：
 *   1) 生产结构 = dist/ 构建产物（main.js + worker.js + chunks/*.js 哈希名）
 *      + 静态外壳（index.html / styles / icons / manifest）。
 *   2) 预缓存来源分为两段：
 *        - PRECACHE_CORE：稳定文件名（外壳 + dist/main.js + dist/worker.js）
 *        - dist/assets-manifest.json：由 build.mjs 生成的构建产物清单（chunks 哈希名）
 *          → sw.js 在 install 时读取并预缓存清单内文件（除 three.webgpu-* 懒加载 chunk）。
 *        - 若 assets-manifest.json 缺失（构建未升级），回退只预缓存 CORE，chunk 走运行时缓存。
 *   3) 路由三分（v2 版）：
 *        - index.html（navigate）         network-first，离线回退缓存
 *        - /dist/main.js、/dist/worker.js  stale-while-revalidate（固定文件名，构建会变内容）
 *        - /dist/chunks/*                  cache-first（哈希名 = 内容寻址，可 immutable）
 *        - /src/*、/styles/*               stale-while-revalidate（调试/冒烟用 src 直跑）
 *        - /vendor/*、/icons/*             cache-first（与 _headers immutable 纪律一致）
 *        - /manifest.webmanifest           network-first
 *        - 跨域 / 其它                     直通
 *   4) CACHE_NAME 版本号每次内容变更必须递增；activate 清理旧版本。
 *   5) skipWaiting + clients.claim（SW 首部署红线）。
 *
 * 预缓存维护规则（重要）：
 *   - 任何新增稳定文件 → 加到 PRECACHE_CORE。
 *   - 任何构建产物变更 → build.mjs 负责写 dist/assets-manifest.json；sw.js 自动跟随，不手改。
 *   - three.webgpu-* 是懒加载 chunk（L5 方案一，仅 WebGPU 设备加载）→ 显式不预缓存，
 *     由 /dist/chunks/* cache-first 在首次请求时按需缓存（WebGL 用户永不下载）。
 *   - icons/* 改内容必须改文件名（与 vendor immutable 同一纪律）。
 *   - 部署模式切换（见 docs/build-migration.md §7）不影响本 sw.js 逻辑。
 */
const __SHELL_VERSION__ = 'qin-chess-shell-v2.0.0-20260817';
const CACHE_NAME = __SHELL_VERSION__;

// 稳定文件名的应用外壳（不含构建哈希 chunk）
const PRECACHE_CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/main.css',

  // 图标
  './icons/icon-192.png',
  './icons/icon-512.png',

  // H4 构建产物（固定文件名）
  './dist/main.js',
  './dist/worker.js',

  // 构建产物清单（build.mjs 生成；缺失时 install 会回退 CORE-only）
  './dist/assets-manifest.json'
];

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const PRECACHE_CACHE = CACHE_NAME;
const RUNTIME_CACHE = `${CACHE_NAME}-runtime`;

function isCacheableRequest(req) {
  if (req.method !== 'GET') return false;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return false; // 跨域直通
  return true;
}

/** 预缓存单个 URL（失败不阻塞其它文件） */
async function precacheOne(cache, url) {
  try {
    const resp = await fetch(url, { cache: 'reload' });
    if (resp && resp.ok) {
      await cache.put(url, resp);
      return true;
    }
    console.warn('[SW] 预缓存失败：', url, resp && resp.status);
  } catch (e) {
    console.warn('[SW] 预缓存异常：', url, e && e.message);
  }
  return false;
}

/** 读取构建产物清单；返回文件相对路径数组（失败返回 null） */
async function fetchAssetManifest() {
  try {
    const resp = await fetch('./dist/assets-manifest.json', { cache: 'no-store' });
    if (!resp || !resp.ok) return null;
    const json = await resp.json();
    if (json && Array.isArray(json.files)) return json.files;
    return null;
  } catch (e) {
    console.warn('[SW] assets-manifest.json 读取失败，回退 CORE-only：', e && e.message);
    return null;
  }
}

/** 构建清单中需要预缓存的文件（排除懒加载 webgpu chunk） */
function pickPrecacheFromManifest(files) {
  return files.filter((f) => {
    const base = f.split('/').pop() || '';
    // three.webgpu-*.js 仅 WebGPU 设备加载，不预缓存（避免 WebGL 用户白付 1.7MB 带宽）
    return !base.startsWith('three.webgpu-');
  });
}

// ---------------------------------------------------------------------------
// 安装：预缓存应用外壳 + 构建产物
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE_CACHE);

    // 1) 稳定外壳
    await Promise.all(PRECACHE_CORE.map((url) => precacheOne(cache, url)));

    // 2) 构建产物清单（若存在）——哈希 chunk 由清单驱动，避免手写哈希名
    const manifestFiles = await fetchAssetManifest();
    if (manifestFiles) {
      const toPrecache = pickPrecacheFromManifest(manifestFiles);
      await Promise.all(toPrecache.map((f) => precacheOne(cache, f.startsWith('/') || f.startsWith('./') ? f : './' + f)));
    } else {
      console.warn('[SW] 未发现 assets-manifest.json —— chunks 将在首次请求时按需缓存（离线首访可能缺 chunk）');
    }

    await self.skipWaiting();   // ★ SW 部署红线：跳过等待，立刻激活
  })());
});

// ---------------------------------------------------------------------------
// 激活：清理旧版本缓存 + 接管所有页签
// ---------------------------------------------------------------------------

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== PRECACHE_CACHE && k !== RUNTIME_CACHE && k.startsWith('qin-chess-shell-'))
        .map((k) => caches.delete(k))
    );
    await self.clients.claim(); // ★ SW 部署红线：立刻接管已打开的页签
  })());
});

// ---------------------------------------------------------------------------
// 请求路由（v2：dist 优先）
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!isCacheableRequest(req)) return;

  const url = new URL(req.url);
  const path = url.pathname;

  // 1) manifest.webmanifest：网络优先
  if (path.endsWith('/manifest.webmanifest')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 2) 导航请求（HTML）—— network-first，离线回退缓存
  if (req.mode === 'navigate' || path.endsWith('/index.html') || path === '/' || path.endsWith('/')) {
    event.respondWith(navigationHandler(req));
    return;
  }

  // 3) dist/chunks：哈希名 = 内容寻址 → cache-first（含 webgpu 懒加载 chunk，按需缓存）
  if (path.startsWith('/dist/chunks/')) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  // 4) dist/main.js + dist/worker.js：固定文件名但内容随构建变化 → SWR
  if (path.startsWith('/dist/')) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // 5) vendor / icons：immutable 内容 → cache-first
  if (path.startsWith('/vendor/') || path.startsWith('/icons/')) {
    event.respondWith(cacheFirst(req, PRECACHE_CACHE));
    return;
  }

  // 6) src / styles：调试（src 直跑）与样式 → SWR
  if (path.startsWith('/src/') || path.startsWith('/styles/')) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // 7) 其它同源 GET —— 直通网络
});

// ---------------------------------------------------------------------------
// 缓存策略
// ---------------------------------------------------------------------------

async function networkFirst(req) {
  try {
    const resp = await fetch(req);
    if (resp && resp.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, resp.clone());
    }
    return resp;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response('offline', { status: 503, statusText: 'offline' });
  }
}

async function navigationHandler(req) {
  try {
    const resp = await fetch(req);
    if (resp && resp.ok) {
      const cache = await caches.open(PRECACHE_CACHE);
      cache.put(req, resp.clone());
    }
    return resp;
  } catch (e) {
    const cache = await caches.open(PRECACHE_CACHE);
    const cached = (await cache.match(req)) || (await cache.match('./index.html')) || (await cache.match('./'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>离线</title><body style="background:#0a0b0e;color:#e6dcc3;font-family:sans-serif;padding:40px">' +
      '<h1>当前处于离线状态</h1><p>秦风·3D 中国象棋未缓存当前页。请检查网络后刷新。</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const resp = await fetch(req);
    if (resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    if (cached) return cached;
    return new Response('', { status: 504 });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((resp) => {
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => null);
  return cached || (await fetchPromise) || new Response('', { status: 504 });
}

// ---------------------------------------------------------------------------
// 调试 / 运维消息
// ---------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'CLEAR_RUNTIME') {
    event.waitUntil(caches.delete(RUNTIME_CACHE));
  }
  if (data.type === 'STATUS') {
    event.source && event.source.postMessage({
      type: 'SW_STATUS',
      version: CACHE_NAME,
      precacheCore: PRECACHE_CORE.length,
    });
  }
});
