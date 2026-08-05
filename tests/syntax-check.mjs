/**
 * 全量 ESM 语法检查
 *
 * 为什么不用 `node --check`：Windows 版 node 无法解析 Git Bash 的 /tmp 虚拟路径，
 * 且 --check 对 .js 后缀按 CJS 解析，会把 import/export 判为语法错误。
 * 这里改用 child_process 逐个调用 node --check，并把源文件复制为 .mjs 后缀
 * 强制 ESM 解析，路径全部走 Windows 原生绝对路径。
 *
 * 用法：node tests/syntax-check.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qin-syntax-'));

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name.startsWith('_')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) acc.push(p);
  }
  return acc;
}

const targets = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'tests'))];

let ok = 0;
const failures = [];

for (const f of targets) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const tmpFile = path.join(TMP, rel.replace(/[\\/]/g, '_').replace(/\.js$/, '.mjs'));
  fs.copyFileSync(f, tmpFile);
  try {
    execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe' });
    ok++;
  } catch (err) {
    const msg = (err.stderr?.toString() || err.message).split('\n').slice(0, 6).join('\n');
    failures.push({ rel, msg });
  }
}

// 清理临时目录
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }

console.log('='.repeat(60));
console.log('  ESM 语法检查');
console.log('='.repeat(60));
console.log(`  检查文件  ${targets.length} 个`);
console.log('');

if (failures.length === 0) {
  console.log(`  ✓ 全部通过（${ok}/${targets.length}）\n`);
  process.exit(0);
} else {
  console.log(`  ✗ ${failures.length} 个文件有语法错误：\n`);
  for (const f of failures) {
    console.log(`  • ${f.rel}`);
    console.log(f.msg.split('\n').map((l) => '      ' + l).join('\n'));
    console.log('');
  }
  process.exit(1);
}
