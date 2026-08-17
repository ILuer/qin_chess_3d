#!/usr/bin/env node
/**
 * verify-pwa.mjs —— L1 PWA 端到端预缓存验证（release-ops-lead）
 *
 * 验证内容（与 sw.js v2 的 install 逻辑一一对应）：
 *  1. dist/assets-manifest.json 存在且格式合法（files 数组）
 *  2. 模拟 sw.js 预缓存清单 = PRECACHE_CORE + manifest.files（排除 three.webgpu-* 懒加载）
 *  3. 起本地静态服务器，逐项 fetch 清单内每个 URL → 全部 200
 *  4. 校验 dist 目录无 *.map 被清单引用（生产不建议部署 sourcemap）
 *  5. 校验 manifest.files 全部真实存在
 *
 * 用法：node scripts/verify-pwa.mjs   （在仓库根执行；需先 npm run build）
 * 退出码：0 = PASS，1 = FAIL
 */
import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 5199;

// 与 sw.js v2 PRECACHE_CORE 保持一致（稳定文件名外壳）
const PRECACHE_CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/main.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './dist/main.js',
  './dist/worker.js',
  './dist/assets-manifest.json',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};

/** 过滤 webgpu 懒加载 chunk（与 sw.js pickPrecacheFromManifest 一致） */
function pickPrecacheFromManifest(files) {
  return files.filter((f) => {
    const base = f.split('/').pop() || '';
    return !base.startsWith('three.webgpu-');
  });
}

function normalize(url) {
  const clean = url.startsWith('./') ? url.slice(2) : url;
  // 根导航（'/' / './'）在 sw.js 中由 navigationHandler 处理，离线回退到 index.html；
  // 文件存在性与 HTTP 校验按 index.html 等价映射。
  if (clean === '/' || clean === '') return '/index.html';
  return clean.startsWith('/') ? clean : '/' + clean;
}

async function main() {
  const results = [];
  const fail = (msg) => { results.push('FAIL  ' + msg); };

  // 1) manifest 存在 + 格式
  const manifestPath = path.join(ROOT, 'dist', 'assets-manifest.json');
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!Array.isArray(manifest.files)) fail('manifest.files 不是数组');
    else results.push('PASS  manifest 存在且 files 为数组（' + manifest.files.length + ' 项）');
  } catch (e) {
    fail('manifest 缺失/解析失败: ' + (e && e.message));
  }

  // 2) 构造预缓存清单
  const coreUrls = PRECACHE_CORE.map(normalize);
  let manifestFiles = manifest ? manifest.files : [];
  const precache = pickPrecacheFromManifest(manifestFiles).map(normalize);
  const webgpuChunks = manifestFiles.filter((f) => (f.split('/').pop() || '').startsWith('three.webgpu-'));
  const allUrls = [...new Set([...coreUrls, ...precache])];

  results.push('PASS  预缓存核心项: ' + coreUrls.length + ' 项');
  results.push('INFO  清单内待预缓存（除 webgpu 懒加载）: ' + precache.length + ' 项');
  results.push('INFO  排除的 webgpu 懒加载 chunk: ' + webgpuChunks.length + ' 项 ' + webgpuChunks.join(', '));

  // 3) 文件存在性（预缓存清单）
  for (const u of allUrls) {
    const filePath = path.join(ROOT, u);
    try {
      const st = await stat(filePath);
      if (!st.isFile()) fail('非文件: ' + u);
    } catch {
      fail('文件不存在: ' + u);
    }
  }

  // 4) dist 内 .map 不应被清单引用
  const distMapFiles = [];
  try {
    const entries = await readdir(path.join(ROOT, 'dist'), { recursive: true });
    for (const e of entries) if (e.endsWith('.map')) distMapFiles.push(e);
  } catch { /* noop */ }
  if (distMapFiles.length && manifest) {
    const referencedMaps = manifest.files.filter((f) => f.endsWith('.map'));
    if (referencedMaps.length) fail('manifest 引用了 sourcemap: ' + referencedMaps.join(', '));
    else results.push('PASS  dist 存在 ' + distMapFiles.length + ' 个 .map 但 manifest 未引用（生产不部署）');
  }

  // 5) 起本地静态服务器，逐项 fetch
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
      const filePath = path.normalize(path.join(ROOT, urlPath));
      if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('404');
    }
  });

  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  let httpOk = 0;
  for (const u of allUrls) {
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}${u}`, { cache: 'no-store' });
      if (resp.status === 200) { httpOk++; }
      else fail('HTTP ' + resp.status + ' ' + u);
    } catch (e) {
      fail('fetch 异常 ' + u + ': ' + (e && e.message));
    }
  }
  results.push(`PASS  HTTP 200 共 ${httpOk}/${allUrls.length} 项`);

  server.close();

  const hasFail = results.some((r) => r.startsWith('FAIL'));
  console.log('===== L1 PWA 预缓存 E2E 验证 =====');
  console.log(results.join('\n'));
  console.log(hasFail ? '>>> 结果: FAIL（见上）' : '>>> 结果: PASS ✅');
  process.exit(hasFail ? 1 : 0);
}

main().catch((e) => { console.error('验证脚本异常:', e); process.exit(2); });
