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
import { existsSync, statSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const VENDOR = path.join(ROOT, 'vendor', 'three-r185');
// 允许通过 BUILD_OUT 环境变量覆盖输出目录（如 BUILD_OUT=dist-sprint1），避免被预览进程锁定的 dist/ 无法写入；
// 默认仍写 dist/，行为与历史一致。
const OUTDIR = path.join(ROOT, process.env.BUILD_OUT || 'dist');

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

/**
 * 解析源码入口：优先 .ts，其次 .js（T1.0 渐进式迁移）。
 * esbuild 原生支持 .ts，无需插件；后续波次把 src/** 逐个改为 .ts 后，
 * 入口自动切换到 .ts 版本，无需改动本文件。
 * @param {string} rel 相对仓库根的 .js 入口路径（如 'src/main.js'）
 * @returns {string} 实际存在的入口绝对路径
 */
function resolveEntry(rel) {
  const tsPath = path.join(ROOT, rel.replace(/\.js$/, '.ts'));
  const jsPath = path.join(ROOT, rel);
  return existsSync(tsPath) ? tsPath : jsPath;
}

/**
 * 构建参数（build 与 dev 共用的**结构**部分）。
 *
 * ⚠ 注意：`sourcemap` / `minify` **刻意不放在这里** —— 二者是生产与开发的
 * 分档项，必须显式在各档位（PROD / DEV）声明，避免「改一处同时影响另一端」：
 *
 *   - 生产（buildOnce）：sourcemap **false** + minify **true**
 *   - 开发（--serve）  ：sourcemap **true**  + minify **false**
 *
 * 历史教训：本字段原为 `sourcemap: true` 且无 `minify`，因 common 被两档共用，
 * 导致**生产环境同时暴露完整源码（dist/main.js.map 可下载、含 sourcesContent）
 * 且产物未压缩**（dist/main.js 1,232,565 B / 29,224 行）。详见下方 PROD 注释。
 */
const common = {
  entryPoints: [resolveEntry('src/main.js')],
  bundle: true,
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  outdir: OUTDIR,
  target: ['es2022'],
  legalComments: 'none',
  logLevel: 'info',
  plugins: [threeVendorPlugin]
};

/**
 * 生产档位构建参数。
 *
 * 【为什么 sourcemap 必须为 false】
 * 本项目的 dist/ 由 Cloudflare Pages 在构建时生成并**原样对外托管**，任何落到
 * dist/ 的文件都是公开可下载的。esbuild 的 sourcemap 内嵌 `sourcesContent`
 * （源文件全文），实测线上 `dist/main.js.map` 返回 HTTP 200 / 2,534,407 B，
 * 可 1:1 还原 33 个项目源文件（含 AI 搜索算法、音频合成配方、动作参数总表）。
 * 这类程序化建模/合成配方是本项目的核心技术资产，不得外泄。
 *
 * 【为什么 minify 必须为 true】
 * 未压缩产物为 1,232,565 B / 29,224 行，实测 minify 后可降至 ~1/2 量级，
 * 直接减少首屏传输。`legalComments: 'none'` 已在 common 中设置，规避许可注释膨胀。
 *
 * 【为什么用「删除残留 .map」而非只靠 sourcemap:false】
 * OUTDIR 可能残留上一次构建的 .map（例如本地 BUILD_OUT 切换、或历史产物未清理）。
 * 只置 false 不会删除既有文件，故 buildOnce 末尾统一清理 *.map 做**兜底**。
 */
const PROD = {
  sourcemap: false,
  minify: true
};

/** 开发档位：保留 sourcemap 与可读产物，便于断点调试 */
const DEV = {
  sourcemap: true,
  minify: false
};

/**
 * 从 esbuild 的 `metafile.outputs` 提取**本次构建实际写出**的 JS 文件。
 *
 * 【为什么不能用「遍历 OUTDIR」代替】
 * esbuild **不会清理 outdir**：chunk 名带内容哈希（`chunks/[name]-[hash]`），
 * 每次构建哈希变化就会留下上一批旧 chunk。实测一次改动即残留 2 个旧 chunk
 * （1,734,482 B + 1,089,389 B ≈ 2.8 MB 死代码），且它们会被写进 SW 预缓存清单、
 * 被 CF Pages 一并对外托管。以 metafile 的 outputs 为准，才能反映「真实产物集」。
 *
 * @param {object} metafile esbuild 构建结果中的 metafile
 * @returns {string[]} 仓库相对路径数组（正斜杠），已排序
 */
function outputJsFromMetafile(metafile) {
  if (!metafile || !metafile.outputs) return [];
  return Object.keys(metafile.outputs)
    .filter((p) => p.endsWith('.js'))
    .map((p) => {
      const abs = path.isAbsolute(p) ? p : path.resolve(ROOT, p);
      return path.relative(ROOT, abs).split(path.sep).join('/');
    })
    .sort();
}

/**
 * 剔除 OUTDIR 下**不属于本次构建**的陈旧的 .js / .map（安全兜底）。
 *
 * 同时解决两类残留：
 *   ① 旧 chunk（哈希变化后遗留，见 outputJsFromMetafile 注释）；
 *   ② sourcemap（PROD.sourcemap=false 不会删除既有文件）。
 *
 * 只删除 `.js` / `.map`；`assets-manifest.json` 与任何非 JS 资源不受影响。
 * 传入的 keep 集合必须来自 metafile，否则有误删风险。
 *
 * @param {string[]} freshFiles 本次构建产出的仓库相对路径集合
 * @returns {string[]} 被删除文件的仓库相对路径
 */
function pruneStaleArtifacts(freshFiles) {
  const keep = new Set(freshFiles);
  const removed = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const fp = path.join(dir, n);
      if (statSync(fp).isDirectory()) walk(fp);
      else if (n.endsWith('.js') || n.endsWith('.map')) {
        const rel = path.relative(ROOT, fp).split(path.sep).join('/');
        if (keep.has(rel)) continue;
        try {
          rmSync(fp);
          removed.push(rel);
        } catch (e) {
          console.warn(`[build] 清理陈旧产物 ${rel} 失败：${e && e.message}`);
        }
      }
    }
  };
  if (existsSync(OUTDIR)) walk(OUTDIR);
  return removed.sort();
}

/**
 * 列出 OUTDIR 下所有指定扩展名的文件（仓库相对路径）。
 * @param {string} ext 扩展名，含点（如 '.map'）
 * @returns {string[]}
 */
function listFilesWithExt(ext) {
  const out = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const fp = path.join(dir, n);
      if (statSync(fp).isDirectory()) walk(fp);
      else if (n.endsWith(ext)) out.push(path.relative(ROOT, fp).split(path.sep).join('/'));
    }
  };
  if (existsSync(OUTDIR)) walk(OUTDIR);
  return out.sort();
}

/**
 * 写 dist/assets-manifest.json —— SW 预缓存契约（release-ops-lead · sw.js v2）。
 * 契约：sw.js fetch('./dist/assets-manifest.json')，读 `json.files`（字符串数组）；
 * 路径为根相对（'dist/...'），sw.js 自行补 './' 前缀；three.webgpu-* 由 sw.js 过滤不预缓存。
 * sizes 为附加信息（sw.js 不读，供体积观测/QA 验收双口径）。
 *
 * ⚠ files 必须由调用方传入「本次构建真实产物」（metafile 口径）；禁止再遍历 OUTDIR，
 *   否则会把陈旧 chunk 重新混入预缓存清单（历史缺陷，见 outputJsFromMetafile 注释）。
 *
 * @param {string[]} files 本次构建产出的仓库相对路径集合
 * @returns {Promise<string>} 清单文件路径
 */
async function writeManifest(files) {
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
  // 主 bundle：src/main.js → dist/main.js（three 内联；webgpu 动态 chunk）。
  // metafile 用于精确获知本次写出的文件集（含哈希命名的 chunk）。
  const mainResult = await esbuild.build({ ...common, ...PROD, metafile: true });

  // AI module worker：显式第二 entry → dist/worker.js。
  // 注意：这里必须显式打包，不能依赖 esbuild 对 engine.ts 中
  //   new Worker(new URL('./worker.js', import.meta.url)) 的「自动识别」——
  //   实测 CF Pages 构建环境中 esbuild 的隐式 worker 打包不可靠（线上曾缺失
  //   dist/worker.js，导致 Worker 加载失败降级为主线程）。显式 entry 保证
  //   每次构建都产出 worker.js，与 engine.ts 的 URL './worker.js' 精确对齐，
  //   也契合 sw.js PRECACHE_CORE 硬编码的 './dist/worker.js'。
  const workerResult = await esbuild.build({
    entryPoints: [resolveEntry('src/ai/worker.js')],
    bundle: true,
    format: 'esm',
    outfile: path.join(OUTDIR, 'worker.js'),
    target: ['es2022'],
    ...PROD,
    metafile: true,
    plugins: [threeVendorPlugin]   // worker 不引 three，但保留插件以防御未来引入
  });

  // 本次构建的真实产物集（两个 entry 的并集）
  const freshFiles = [
    ...new Set([
      ...outputJsFromMetafile(mainResult.metafile),
      ...outputJsFromMetafile(workerResult.metafile)
    ])
  ].sort();

  // 【第一道防线 · 配置回退即刻失败】
  // 若生产档位被改回 sourcemap:true，esbuild 会**新生成** .map。此时必须立刻报错，
  // 而不是依赖下方 prune 静默删掉——静默会掩盖配置回退，直到某次构建顺序变化
  // 才把源码泄露出去。这里直接以 metafile 为准判定。
  const emittedMaps = [
    ...Object.keys(mainResult.metafile?.outputs || {}),
    ...Object.keys(workerResult.metafile?.outputs || {})
  ].filter((p) => p.endsWith('.map'));
  if (emittedMaps.length) {
    throw new Error(
      `[build] 生产构建产出了 sourcemap，已阻止构建：${emittedMaps.join(', ')}\n` +
      '        dist/ 是对外托管的公开目录，sourcemap 内嵌 sourcesContent，会泄露完整源码。\n' +
      '        请检查 PROD.sourcemap 必须为 false。'
    );
  }

  // 兜底：剔除陈旧 chunk 与 sourcemap 残留（esbuild 不清理 outdir）
  const stale = pruneStaleArtifacts(freshFiles);
  if (stale.length) {
    console.log(`[build] 已清理陈旧产物 ${stale.length} 个：${stale.join(', ')}`);
  }

  // 强制不变量：dist/ 下不得存在任何 sourcemap。
  // 背景：dist/ 由 CF Pages 原样对外托管，任何 .map 都是公开可下载的完整源码
  // （内嵌 sourcesContent）。此处把「不泄露」从注释升级为**构建期断言**——
  // 若将来有人重新开启 sourcemap（或引入会产出 .map 的插件），构建会立即失败并
  // 阻断部署，而不是静默把源码推到线上。
  const leftoverMaps = listFilesWithExt('.map');
  if (leftoverMaps.length) {
    throw new Error(
      `[build] 检测到 sourcemap 残留，已阻止构建：${leftoverMaps.join(', ')}\n` +
      '        dist/ 是对外托管的公开目录，sourcemap 会泄露完整源码。\n' +
      '        请检查 esbuild 的 sourcemap 配置（生产档位 PROD.sourcemap 必须为 false）。'
    );
  }

  // 构建产物清单（SW 预缓存契约）——严格以本次产物集为准
  const manifestPath = await writeManifest(freshFiles);
  console.log(`[build] 产物已写入 dist/（${freshFiles.length} 个 JS：${freshFiles.join(', ')}）`);
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
  //
  // 注意：dev **不做陈旧产物清理**——worker.js 不在 watch 的产物集里，
  // 若在此剪枝会把 worker.js 一并删掉。清理只发生在完整 build（buildOnce）。
  const manifestPlugin = {
    name: 'write-assets-manifest',
    setup(build) {
      build.onEnd(async (result) => {
        try {
          const files = outputJsFromMetafile(result.metafile);
          const workerRel = path.relative(ROOT, path.join(OUTDIR, 'worker.js')).split(path.sep).join('/');
          if (existsSync(path.join(OUTDIR, 'worker.js')) && !files.includes(workerRel)) {
            files.push(workerRel);
            files.sort();
          }
          await writeManifest(files);
        } catch (e) {
          console.warn('[dev] assets-manifest.json 刷新失败：', e && e.message);
        }
      });
    }
  };
  const ctx = await esbuild.context({
    ...common,
    ...DEV,
    metafile: true,
    plugins: [...common.plugins, manifestPlugin]
  });
  // 启动即构建一次（产出 dist/main.js 供静态服务器消费），watch 随后接管
  await ctx.rebuild();
  await ctx.watch();
  const port = Number(process.env.PORT || 5173);
  createStaticServer().listen(port, () => {
    console.log(`[dev] 本地服务器 http://localhost:${port}（watch 已开启）`);
  });
} else {
  await buildOnce();
}
