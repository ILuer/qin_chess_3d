# ADR-0002 本地 vendored Three.js（弃用 CDN）

- **状态**：已采纳（Accepted）
- **日期**：Phase 4 收尾补建（记录既有决策）
- **相关**：ADR-0001（零构建 ESM）

## 背景（Context）

游戏渲染依赖 **Three.js r169**。早期方案从公网 CDN 加载 `three.module.js`，实践中踩到：

- **DNS 解析 / 可用性历史问题**：CDN 域名偶发不可达，导致加载界面卡死或报错；
- **版本漂移**：CDN 上的 `latest` 或主版本升级可能引入不兼容，破坏已验证的渲染表现；
- **离线 / 内网 / 子路径部署不可控**：用户把游戏拷到离线环境、或部署在子路径（如 `/qin_chess_3D/`）时，绝对 CDN URL 或依赖 CDN 解析的逻辑会失效。

需要一种"锁定版本、可复现、对任意部署形态鲁棒"的 Three.js 供给方式。

## 决策（Decision）

将 Three.js 与 addons **落地为本地 `vendor/three/`**，经 `importmap` 相对路径映射：

```html
<script type="importmap">
{
  "imports": {
    "three": "./vendor/three/three.module.js",
    "three/addons/": "./vendor/three/addons/"
  }
}
</script>
```

并配套约束：

- AI 的 module Worker 用 `new URL('./worker.js', import.meta.url)` 实例化，**不使用绝对 / CDN URL**，保证子路径部署同样成立（`src/ai/engine.js`）；
- 锁定 r169，升级需**手动替换 vendor 并回归验证**，不自动跟随上游。

## 备选方案（Alternatives Considered）

1. **继续用 CDN ESM**：零仓库体积，但复现性与可用性不可控（即本 ADR 要解决的问题）。
2. **npm 安装 + 打包器引入**：可获得版本管理与 tree-shaking，但违背 ADR-0001 的"零构建"目标。
3. **自行实现精简渲染层**：成本过高，不现实。

## 后果（Consequences）

**正面**
- 离线 / 内网可用，无 DNS 风险；
- 版本锁定、可复现，渲染表现长期稳定；
- 相对路径 importmap + `import.meta.url` Worker，**子路径部署兼容**；
- 与 ADR-0001 共同达成"运行时零外部依赖"。

**负面 / 代价**
- 仓库体积略增（单文件 `three.module.js` + addons）；
- 升级 Three.js 需手动替换 `vendor/` 并做回归（含 `LIGHT_PRESET`/材质/相机相关表现）。

## 备注（Notes）

- `vendor/` 不纳入频繁改动，仅随引擎升级同步；
- 若未来启用打包器（违背 ADR-0001），本 ADR 的"本地 vendor"约束可平滑迁移为依赖锁定方案。
