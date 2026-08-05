/**
 * 集成静态对账 —— 跨模块 import/export 一致性检查
 *
 * 目的：在浏览器里，ESM 的 import 拿不到不存在的具名导出时会直接抛
 * SyntaxError 并整页白屏，且错误信息经常指不到真正的源头。
 * 本脚本在 Node 侧做纯文本静态分析，提前把这类断链全部暴露出来。
 *
 * 检查项：
 *   1. 每个相对 import 的目标文件是否存在（路径拼错 = 静默 404）
 *   2. 每个具名 import 的符号，目标文件是否真的导出了
 *   3. default import 的目标是否有 export default
 *   4. 裸模块（three / three/addons）跳过，由 importmap 负责
 *
 * 用法：node tests/integration-check.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 收集所有源文件 ────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

const files = walk(path.join(ROOT, 'src'));

// ── 解析一个文件导出了哪些具名符号 ──────────────────────────────
function parseExports(src) {
  const named = new Set();
  let hasDefault = false;

  // export function foo / export async function foo / export class Foo
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    named.add(m[1]);
  }
  // export const a = ... / export let / export var（支持一行多个：export const a = 1, b = 2）
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([^=;\n]+)=/gm)) {
    // 只取第一个标识符（解构导出较少见，这里做保守处理）
    const first = m[1].trim().split(/[\s,]+/)[0].replace(/[{}[\]]/g, '');
    if (/^[A-Za-z_$][\w$]*$/.test(first)) named.add(first);
  }
  // export { a, b as c }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      const asMatch = seg.match(/\s+as\s+([A-Za-z_$][\w$]*)$/);
      const name = asMatch ? asMatch[1] : seg;
      if (name === 'default') hasDefault = true;
      else if (/^[A-Za-z_$][\w$]*$/.test(name)) named.add(name);
    }
  }
  if (/^export\s+default\s/m.test(src)) hasDefault = true;

  return { named, hasDefault };
}

// ── 解析一个文件的 import 语句 ─────────────────────────────────
function parseImports(src) {
  const out = [];
  const re = /import\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const clause = m[1].trim();
    const spec = m[2];
    const named = [];
    let def = null;
    let namespace = false;

    if (/^\*\s+as\s+/.test(clause)) {
      namespace = true;
    } else {
      const braceMatch = clause.match(/\{([^}]*)\}/);
      if (braceMatch) {
        for (const part of braceMatch[1].split(',')) {
          const seg = part.trim();
          if (!seg) continue;
          const asMatch = seg.match(/^([A-Za-z_$][\w$]*)\s+as\s+/);
          named.push(asMatch ? asMatch[1] : seg);
        }
      }
      const beforeBrace = clause.split('{')[0].replace(/,\s*$/, '').trim();
      if (beforeBrace && !beforeBrace.startsWith('*')) def = beforeBrace;
    }
    out.push({ spec, named, def, namespace });
  }
  return out;
}

// ── 预扫描：建立 文件 → 导出表 ─────────────────────────────────
const exportsMap = new Map();
for (const f of files) {
  exportsMap.set(f, parseExports(fs.readFileSync(f, 'utf8')));
}

// ── 执行对账 ──────────────────────────────────────────────────
const problems = [];
let importStmts = 0;
let checkedSymbols = 0;

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');

  for (const imp of parseImports(src)) {
    importStmts++;
    // 裸模块由 importmap 处理，跳过
    if (!imp.spec.startsWith('.')) continue;

    const target = path.resolve(path.dirname(f), imp.spec);
    if (!fs.existsSync(target)) {
      problems.push(`[路径不存在] ${rel}\n              import '${imp.spec}' → 解析为 ${path.relative(ROOT, target).replace(/\\/g, '/')}`);
      continue;
    }
    const tExports = exportsMap.get(target) || parseExports(fs.readFileSync(target, 'utf8'));
    const tRel = path.relative(ROOT, target).replace(/\\/g, '/');

    for (const n of imp.named) {
      checkedSymbols++;
      if (!tExports.named.has(n)) {
        problems.push(`[缺少具名导出] ${rel}\n              需要 { ${n} } ← ${tRel}\n              该文件实际导出: ${[...tExports.named].join(', ') || '(无)'}`);
      }
    }
    if (imp.def) {
      checkedSymbols++;
      if (!tExports.hasDefault) {
        problems.push(`[缺少默认导出] ${rel}\n              需要 default (${imp.def}) ← ${tRel}`);
      }
    }
  }
}

// ── HTML 引用的资源路径检查 ────────────────────────────────────
const htmlPath = path.join(ROOT, 'index.html');
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["'](?!https?:|\/\/|#|data:)([^"']+)["']/g)) {
    const p = path.resolve(ROOT, m[1]);
    if (!fs.existsSync(p)) {
      problems.push(`[HTML 引用缺失] index.html → ${m[1]}`);
    }
  }
} else {
  problems.push('[缺失] index.html 尚未创建');
}
if (!fs.existsSync(path.join(ROOT, 'src/main.js'))) {
  problems.push('[缺失] src/main.js 尚未创建');
}
if (!fs.existsSync(path.join(ROOT, 'styles/main.css'))) {
  problems.push('[缺失] styles/main.css 尚未创建');
}

// ── 报告 ──────────────────────────────────────────────────────
console.log('='.repeat(60));
console.log('  集成静态对账');
console.log('='.repeat(60));
console.log(`  扫描源文件      ${files.length} 个`);
console.log(`  import 语句     ${importStmts} 条`);
console.log(`  校验符号        ${checkedSymbols} 个`);
console.log('');

if (problems.length === 0) {
  console.log('  ✓ 全部通过 —— 无断链\n');
  process.exit(0);
} else {
  console.log(`  ✗ 发现 ${problems.length} 个问题：\n`);
  for (const p of problems) console.log('  • ' + p + '\n');
  process.exit(1);
}
