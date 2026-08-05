/**
 * cleanup-temp.mjs — 清理项目根目录下由语法/集成校验产生的临时文件。
 *
 * 安全约束：
 *  1. 只在本项目根目录（本文件的上级目录）内操作，绝不递归到项目外。
 *  2. 只删除白名单前缀匹配的条目：以 `_chk` / `_check` / `_err` / `_ran` /
 *     `_scene.mjs` / `_syntax` / `_t.mjs` / `_v.txt` / `.synccheck` 开头。
 *  3. 交付物目录（src / docs / styles / tests / index.html / README.md /
 *     serve.mjs）在硬编码保护名单里，任何情况下都不会被删除。
 *
 * 用法： node tests/cleanup-temp.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** 永不删除 */
const PROTECTED = new Set([
  'src', 'docs', 'styles', 'tests', 'assets',
  'index.html', 'README.md', 'serve.mjs',
  'package.json', 'package-lock.json', 'node_modules',
  '.git', '.gitignore', '.workbuddy',
]);

/** 临时文件判定：必须命中其中之一 */
const TEMP_PATTERNS = [
  /^_chk/,        // _chk, _chk.txt, _chk_tmp, _chk_src_*.mjs, _chk2_*
  /^_check/,      // _check.cjs, _check2.cjs
  /^_err\./,      // _err.txt
  /^_ran\d*\.txt$/,
  /^_scene\.mjs$/,
  /^_syntax$/,
  /^_t\.mjs$/,
  /^_v\.txt$/,
  /^\.synccheck$/,
];

const dryRun = process.argv.includes('--dry');
const entries = fs.readdirSync(ROOT, { withFileTypes: true });

const targets = [];
for (const e of entries) {
  if (PROTECTED.has(e.name)) continue;
  if (!TEMP_PATTERNS.some((re) => re.test(e.name))) continue;
  targets.push(e);
}

if (targets.length === 0) {
  console.log('[cleanup] 无临时文件，目录已干净。');
  process.exit(0);
}

let okFiles = 0;
let okDirs = 0;
const failed = [];

for (const e of targets) {
  const full = path.join(ROOT, e.name);
  // 双保险：解析后的绝对路径必须仍在 ROOT 之内
  if (!full.startsWith(ROOT + path.sep)) {
    failed.push([e.name, 'path escapes project root']);
    continue;
  }
  if (dryRun) {
    console.log(`[dry] would remove ${e.isDirectory() ? 'dir ' : 'file'} ${e.name}`);
    continue;
  }
  try {
    if (e.isDirectory()) {
      fs.rmSync(full, { recursive: true, force: true });
      okDirs++;
    } else {
      fs.rmSync(full, { force: true });
      okFiles++;
    }
  } catch (err) {
    failed.push([e.name, err.message]);
  }
}

if (dryRun) {
  console.log(`[dry] 共 ${targets.length} 个条目待清理。`);
  process.exit(0);
}

console.log(`[cleanup] 已删除 ${okFiles} 个文件、${okDirs} 个目录。`);
if (failed.length) {
  console.log(`[cleanup] 失败 ${failed.length} 项：`);
  for (const [name, msg] of failed) console.log(`  - ${name}: ${msg}`);
  process.exit(1);
}

const rest = fs.readdirSync(ROOT).sort();
console.log(`[cleanup] 剩余顶层条目：${rest.join(', ')}`);
