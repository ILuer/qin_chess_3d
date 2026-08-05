# 部署指南 · Cloudflare Pages 连接 GitHub 自动部署

> 本项目是**纯静态、零构建**站点（Three.js 已 vendor 进仓库，无外部依赖），
> 因此部署配置的核心只有一句话：**不要填构建命令，输出目录填仓库根**。

仓库：`https://github.com/ILuer/qin_chess_3d`

---

## 本地预览

**必须走 HTTP，不能双击 `index.html` 用 `file://` 打开**——
AI 用的 module Worker 会被同源策略直接拒绝，棋能下但 AI 不动。

任选一条，在仓库根目录执行：

```bash
npx serve -l 5173          # Node，无需预装
python -m http.server 5173 # Python 3
php -S localhost:5173      # PHP
```

然后访问 `http://localhost:5173`。

> 仓库已精简为纯部署面，原先的 `serve.mjs`（零依赖静态服务器）、
> `tests/`（三道质量门）、团队设计文档均已移出。
> 需要时从历史取回：`git checkout 68700dd -- tests/ serve.mjs docs/`

---

## 前置结论：项目已具备部署兼容性

部署前做过路径核查，三项关键点全部天然兼容，**无需改动任何源码**：

| 检查项 | 实际写法 | 子路径部署是否安全 |
|---|---|---|
| CSS 引用 | `href="styles/main.css"`（相对） | ✅ |
| 入口脚本 | `src="src/main.js"`（相对） | ✅ |
| AI Worker | `new URL('./worker.js', import.meta.url)`（相对模块自身） | ✅ |

若上述任一处写成 `/src/main.js` 这类绝对路径，部署到
`user.github.io/qin_chess_3d/` 这种子路径下就会 404。本项目不存在该问题。

---

## 方案 A：Cloudflare Pages + Git 集成（推荐）

最省事的方案——**关联一次，此后每次 `git push` 自动部署**，不需要写任何 CI 配置文件。

### 步骤

1. **登录** [dash.cloudflare.com](https://dash.cloudflare.com)

2. 左侧进入 **Workers & Pages** → 点 **Create** → 切到 **Pages** 标签
   → 选 **Connect to Git**

3. **授权 GitHub**
   - 点 *Connect GitHub*，跳转 GitHub 授权页
   - 授权范围建议选 **Only select repositories** → 勾选 `qin_chess_3d`
     （比 All repositories 更安全，后续可在 GitHub → Settings → Applications
     → Cloudflare Pages 里随时增减）
   - 授权后回到 Cloudflare，在列表里选中 `ILuer/qin_chess_3d` → **Begin setup**

4. **构建配置** — 这一步是唯一容易填错的地方：

   | 字段 | 填什么 | 说明 |
   |---|---|---|
   | Project name | `qin-chess-3d` | 决定默认域名 `qin-chess-3d.pages.dev` |
   | Production branch | `main` | 生产分支 |
   | Framework preset | **None** | 千万别选框架，会自动塞构建命令 |
   | Build command | **留空** | 本项目零构建 |
   | Build output directory | `/` | 仓库根就是站点根 |
   | Root directory | `/`（默认） | 不用改 |

   环境变量不需要设置。

5. 点 **Save and Deploy**，等约 20–40 秒（纯上传，没有构建耗时）

6. 部署完成后访问 `https://qin-chess-3d.pages.dev`

### 自动部署行为

关联完成后，无需再做任何操作：

- push 到 `main` → 自动**生产部署**，更新正式域名
- push 到其他分支 / 开 PR → 自动**预览部署**，生成独立 URL（形如
  `<hash>.qin-chess-3d.pages.dev`），PR 页面会自动评论预览链接
- 每次部署都有独立快照，Dashboard → Deployments 里可以一键 **Rollback** 回退

### 绑定自定义域名（可选）

项目页 → **Custom domains** → *Set up a domain* → 输入域名。
域名若已托管在 Cloudflare，CNAME 自动写好；否则按提示去域名商加 CNAME 记录。
HTTPS 证书自动签发，无需手动配置。

---

## 方案 B：Wrangler CLI 直传

不想给 Cloudflare 授权 GitHub、或想在本地手动控制发布节奏时用这个。

```bash
# 首次：登录（会打开浏览器授权）
npx wrangler login

# 首次：创建项目
npx wrangler pages project create qin-chess-3d --production-branch=main

# 每次发布
npx wrangler pages deploy . --project-name=qin-chess-3d --branch=main
```

发布预览版把 `--branch` 换成别的名字即可，例如 `--branch=preview`。

> 注：直传会上传当前目录全部文件（`.git`、`node_modules` 自动排除）。
> 本仓库已精简为纯部署面（`index.html` / `styles/` / `src/` / `vendor/` / `_headers`），
> 直传即最小集，无需额外过滤。

---

## 方案 C：GitHub Actions + Wrangler（完全代码化）

适合希望部署流程可审计、可加质量门的场景——比如**规则测试不通过就不许发布**。

### 1. 准备凭据

- **API Token**：Cloudflare Dashboard → 右上头像 → *My Profile* → *API Tokens*
  → *Create Token* → 选模板 **Edit Cloudflare Workers**
  （或自定义：Account → Cloudflare Pages → Edit）
- **Account ID**：Dashboard 任意页面右侧栏，或 URL 中 `dash.cloudflare.com/<account_id>/...`

在 GitHub 仓库 → **Settings → Secrets and variables → Actions** 添加两条：
`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`

### 2. 新建 `.github/workflows/deploy.yml`

```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  deployments: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      # 质量门（可选）：本仓库已精简，tests/ 不在部署面内。
      # 如需恢复「测试不过不许发布」，先取回测试文件：
      #   git checkout 68700dd -- tests/
      # 再取消下面三步的注释。
      #
      # - name: 规则引擎测试（95 条断言）
      #   run: node tests/rules.test.mjs
      #
      # - name: 跨模块符号对账（112 个符号）
      #   run: node tests/integration-check.mjs
      #
      # - name: ESM 语法检查
      #   run: node tests/syntax-check.mjs

      - name: Deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy . --project-name=qin-chess-3d --branch=main
```

这个方案的价值在于三道质量门被前置到发布之前——测试红了直接卡住，坏版本上不了线。

> ⚠️ 方案 A 和方案 C **不要同时启用**，否则一次 push 触发两次部署，互相覆盖。

---

## 备选：GitHub Pages

如果只想用 GitHub 自家的托管，不引入 Cloudflare：

**最简方式（无需 workflow）**
仓库 → **Settings → Pages** → Source 选 **Deploy from a branch**
→ Branch 选 `main`、目录选 `/ (root)` → Save。

约 1 分钟后可访问 `https://iluer.github.io/qin_chess_3d/`，此后 push 即自动更新。

**走 GitHub Pages 需要先补一个 `.nojekyll`**（空文件，放仓库根）：

```bash
touch .nojekyll && git add .nojekyll && git commit -m "chore: 关闭 Jekyll 处理" && git push
```

不加的话 Jekyll 会**静默忽略**所有下划线开头的文件——`_headers` 直接消失，
且不报任何错。本仓库为精简部署面已移除该文件（Cloudflare Pages 不需要它）。

**与 Cloudflare Pages 的差异**

| | Cloudflare Pages | GitHub Pages |
|---|---|---|
| 部署路径 | 根域 `xxx.pages.dev` | 子路径 `/qin_chess_3d/` |
| 预览部署 | 每分支/PR 独立 URL | 无 |
| 自定义响应头 | 支持（`_headers`） | 不支持 |
| 回滚 | Dashboard 一键 | 需 revert 提交 |

本项目路径全相对，两边都能跑。

---

## 部署后验收清单

打开线上地址，按顺序确认：

1. **加载进度条走完并淡出** — 卡住不动先看 Network 里
   `vendor/three/three.module.js` 是否 200（1.27MB，慢网首访需几秒）
2. **棋盘与 32 枚棋子正常渲染** — 白屏则看 DevTools Console
3. **AI 能落子** — 验证 module Worker 正常。若报
   `Failed to construct 'Worker'`，检查 `src/ai/worker.js` 是否返回 `200` 且
   `Content-Type: text/javascript`（Pages / GH Pages 默认都正确）
4. **点击一次页面后有音效** — WebAudio 需要用户手势才能解锁，属正常行为
5. **DevTools → Network 全 200/304**，无 404

---

## 依赖策略：Three.js 已本地化（无外部依赖）

早期 importmap 从 `unpkg.com` 拉 Three.js，CDN 抖动会直接导致线上白屏。
**该风险已消除**——三个文件全部 vendor 进仓库：

```
vendor/three/three.module.js                        1.27 MB   REVISION 169
vendor/three/addons/controls/OrbitControls.js         32 KB
vendor/three/addons/utils/BufferGeometryUtils.js      31 KB   ← 易漏
```

第三个最容易漏：`boardMesh.js` 与 `pieceFactory.js` 用它做几何体合并，
只搬前两个会在建模阶段断链。

importmap 用相对路径，子路径部署同样成立：

```json
{ "imports": {
    "three": "./vendor/three/three.module.js",
    "three/addons/": "./vendor/three/addons/"
} }
```

两个 addon 内部写的是 `from 'three'` 裸标识符，由 importmap 按**文档基址**
解析，无需改写 vendor 源码。

`_headers` 给 `/vendor/*` 配了 `max-age=31536000, immutable`：
版本锁定的库内容永不变更，升级走「改目录名 + 改 importmap」而非原地覆盖，
所以长缓存安全。1.27 MB 首访下载一次，回访零请求。

### 升级 Three.js 的正确姿势

不要原地覆盖 `vendor/three/`（会被 immutable 缓存锁死旧版）。改为：

```bash
mkdir -p vendor/three-0.180/addons/controls vendor/three-0.180/addons/utils
curl -sL -o vendor/three-0.180/three.module.js \
  https://unpkg.com/three@0.180.0/build/three.module.js
# ...两个 addon 同理
```
再把 importmap 指向新目录，确认无误后删旧目录。

生产环境建议选 ①。

---

## 附：`_headers` 说明

仓库根的 `_headers` 只对 **Cloudflare Pages** 生效，做了两件事：

- **安全头**：`nosniff` / `Referrer-Policy` / `X-Frame-Options`
- **缓存策略**：HTML `no-cache`；`src/`、`styles/` 用
  `max-age=0, must-revalidate`

之所以不给 JS/CSS 设长缓存，是因为本项目文件名**没有内容哈希**——
一旦设 `immutable`，用户会长期拿到旧版本且无法自愈。
`must-revalidate` 配合 ETag，每次只发一个条件请求，未变更命中 `304`，
开销极小而正确性有保障。

未设置 CSP 的原因写在 `_headers` 文件注释里（inline importmap 无法下发
nonce，强上 CSP 只能放开 `'unsafe-inline'`，收益有限且易误伤 Worker）。
