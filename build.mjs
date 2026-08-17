/**
 * build.mjs —— esbuild 构建脚本（engineering-lead · T1.0 / H4 / L5）
 *
 * 目标：渐进式迁移。当前阶段「零行为改变」：把 src/**（.js，未来 .ts）打包为
 * 浏览器可直接运行的 ES Module 产物，写入 dist/。
 *
 * 关键设计：
 *  1. three 通过 vendor 别名解析到 vendor/three-r185/（A2 目录版本化）。
 *     three.module.js 内部相对 import './three.core.js'，esbuild 跟随并内联进 bundle，
 *     —— three.core.js 不再作为独立文件部署（vendor 瘦身由构建达成）。
 *  2. three/webgpu（L5 方案一：动态 import 双后端）由 esbuild 产出独立 chunk，
 *     仅在运行时 WebGPU 可用时 `await import()` 加载；WebGL 浏览器不下载该 chunk。
 *  3. --serve 启动本地静态服务器 + watch（dev 模式，无额外依赖）。
 *
 * 用法：
 *    npm run build     —— 一次性构建到 dist/
 *    npm run dev       —— watch + 本地服务器 http://localhost:5173
 *    PORT=8080 npm run dev —— 自定义端口
 */
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const VENDOR = path.join(ROOT, 'vendor', 'three-r185');
const OUTDIR = path.join(ROOT, 'dist');

/** 常见 MIME（ES Module 必须 text/javascript，否则浏览器报 Strict MIME） */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
};

/** three 供应商别名插件：把 bare specifier 映射到本地 vendor/three-r185 */
const threeVendorPlugin = {
  name: 'three-vendor',
  setup(build) {
    build.onResolve({ filter: /^three\/addons\// }, (args) => {
      const rel = args.path.slice('three/addons/'.length);
      return { path: path.join(VENDOR, 'addons', rel), namespace: 'file' };
    });
    build.onResolve({ filter: /^three\/webgpu$/ }, () => {
      return { path: path.join(VENDOR, 'three.webgpu.js'), namespace: 'file' };
    });
    build.onResolve({ filter: /^three$/ }, () => {
      return { path: path.join(VENDOR, 'three.module.js'), namespace: 'file' };
    });
  }
};

/** 构建参数（build 与 dev 共用，保证行为一致） */
const common = {
  entryPoints: [path.join(ROOT, 'src', 'main.js')],
  bundle: true,
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  outdir: OUTDIR,
  target: ['es2022'],
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  plugins: [threeVendorPlugin]
};

/**
 * 递归收集 dist/ 下运行时 JS 文件（排除 .map sourcemap）
 * @returns {string[]} 根相对路径数组（如 'dist/main.js'、'dist/chunks/chunk-xxx.js'）
 */
function collectRuntimeJs() {
  const out = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const fp = path.join(dir, n);
      const st = statSync(fp);
      if (st.isDirectory()) walk(fp);
      else if (n.endsWith('.js')) out.push(fp);
    }
  };
  if (existsSync(OUTDIR)) walk(OUTDIR);
  return out.map((fp) => path.relative(ROOT, fp).split(path.sep).join('/')).sort();
}

/**
 * 写 dist/assets-manifest.json —— SW 预缓存契约（release-ops-lead · sw.js v2）。
 * 契约：sw.js fetch('./dist/assets-manifest.json')，读 `json.files`（字符串数组）；
 * 路径为根相对（'dist/...'），sw.js 自行补 './' 前缀；three.webgpu-* 由 sw.js 过滤不预缓存。
 * sizes 为附加信息（sw.js 不读，供体积观测/QA 验收双口径）。
 * @returns {Promise<string>} 清单文件路径
 */
async function writeManifest() {
  const files = collectRuntimeJs();
  const sizes = {};
  for (const rel of files) {
    const buf = await readFile(path.join(ROOT, rel));
    sizes[rel] = { bytes: buf.length, gzipBytes: gzipSync(buf).length };
  }
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    files,
    sizes
  };
  const outPath = path.join(OUTDIR, 'assets-manifest.json');
  writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  return outPath;
}

async function buildOnce() {
  // 主 bundle：src/main.js → dist/main.js（three 内联；webgpu 动态 chunk）
  await esbuild.build(common);

  // AI module worker：单独 entry → dist/worker.js。
  // esbuild 不会自动打包 new Worker(new URL('./worker.js', import.meta.url))，
  // 必须显式把 worker 作为第二 entry。运行时 main bundle 里
  // new URL('./worker.js', import.meta.url) 相对 dist/main.js 解析 → dist/worker.js，天然命中。
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'ai', 'worker.js')],
    bundle: true,
    format: 'esm',
    outfile: path.join(OUTDIR, 'worker.js'),
    target: common.target,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'info',
    plugins: [threeVendorPlugin]   // worker 不引 three，但保留插件以防御未来引入
  });

  // 构建产物清单（SW 预缓存契约）
  const manifestPath = await writeManifest();
  console.log('[build] 产物已写入 dist/（main.js + worker.js + chunks/）');
  console.log(`[build] assets-manifest.json 已生成 -> ${manifestPath}`);
}

/** 极简静态服务器：只服务仓库根目录下的文件，杜绝路径穿越 */
function createStaticServer() {
  return http.createServer(async (req, res) => {
    const t0 = Date.now();
    try {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
      if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
      // 规范化并防止路径穿越
      const filePath = path.normalize(path.join(ROOT, urlPath));
      if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found: ' + urlPath);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const body = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(body);
      if (process.env.DEBUG_SERVER) {
        console.log(`[dev] ${req.method} ${urlPath} -> ${res.statusCode} (${body.length}B, ${Date.now() - t0}ms)`);
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500: ' + (e && e.message));
      if (process.env.DEBUG_SERVER) console.error(`[dev] ${req.method} ${req.url} -> 500 ${e && e.message}`);
    }
  });
}

const isServe = process.argv.includes('--serve');

if (isServe) {
  // watch 模式：主 bundle 每次重建后刷新 assets-manifest.json（worker 为固定文件，
  // 由完整 build 更新；dev 只保证 main/chunks 清单新鲜，与 sw.js 契约一致）
  const manifestPlugin = {
    name: 'write-assets-manifest',
    setup(build) {
      build.onEnd(async () => {
        try { await writeManifest(); }
        catch (e) { console.warn('[dev] assets-manifest.json 刷新失败：', e && e.message); }
      });
    }
  };
  const ctx = await esbuild.context({
    ...common,
    plugins: [...common.plugins, manifestPlugin]
  });
  await ctx.watch();
  await writeManifest();   // 启动即写一次（服务既有 dist）
  const port = Number(process.env.PORT || 5173);
  createStaticServer().listen(port, () => {
    console.log(`[dev] 本地服务器 http://localhost:${port}（watch 已开启）`);
  });
} else {
  await buildOnce();
}
