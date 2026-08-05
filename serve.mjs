#!/usr/bin/env node
/**
 * 零依赖静态服务器 —— 秦风 3D 中国象棋
 *
 * 为什么需要它：项目使用原生 ES Modules（<script type="module">），
 * 浏览器对 file:// 协议下的模块加载有 CORS 限制，直接双击 index.html 会失败。
 * 必须通过 HTTP 提供服务。
 *
 * 用法：
 *   node serve.mjs            # 默认 http://localhost:5173
 *   node serve.mjs 8080       # 指定端口
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  // 去掉 query string，解码 URI
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // 防目录穿越：解析后必须仍在 ROOT 之内
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('403 Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>404</h1><p>找不到 ${urlPath}</p>`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  秦风 3D 中国象棋 已启动`);
  console.log(`  → http://localhost:${PORT}\n`);
  console.log(`  按 Ctrl+C 停止\n`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 已被占用，请换一个：node serve.mjs ${PORT + 1}\n`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
