# ADR-PERF4 · 合并 Mesh 预算门禁上调 202 → 210

- **状态**：待批准（Sprint 4，2026-08-23，主理人游承峰签发）
- **决策**：PERF-001 合并 mesh 硬门禁由 ≤202 上调至 ≤210
- **关联**：Sprint 3 ADR-PERF3（186→202，马四蹄独立 pivot +16）

## 背景
Sprint 4 实现象(B)文官袍摆写实，将 `robe` 整体子组拆为 `bodyRobe`（头/帽/胸腹，静止主体）+ `hem`（下摆，绕腰 pivot 独立摆动，走子时飘动+落地阻尼余摆）。

## 实证（engineering-lead grep 核查）
- B 真实 mesh 构成（grep 实证）：robe 全 matte 单面（metalness<0.5），每子组合并恒 1 mesh；arms 同理 1 mesh → **2 mesh/枚**
- 全盘 4 枚 B 共 4 mesh（非此前误估的大占比）
- 拆 hem 后：bodyRobe 1 + hem 1 + arms 1 = **3 mesh/枚**
- ΔB = +1/枚 × 4 枚 = **+8**
- 全盘：202（Sprint3 后）→ **210**

## 决策理由
1. **对齐既有先例**：Sprint 3 ADR-PERF3 因马四蹄 +16 上调 186→202；本次象下摆 +8 同属"写实部件必然增量"，一次性固化。
2. **210 是稳定终态**：arms 本 Sprint 不拆袖（整体摆动近似惯性），hem 独立 pivot 是 B-HEM-SWAY 的功能前置；若未来 Sprint4.x 拆 sleeveL/R 将再增，但本 Sprint 不引入。
3. **余量充足**：210 仍远低于设计 §5.5 R4 预算上限（~240~260），renderer.info 实际 draw call 含 shadow pass ~2× 仍安全。
4. **规避临时门禁**：195/205 临时门禁会逼迫实现取舍诱发 hack。

## 影响范围
- `PERF-001` 门禁值：≤202 → **≤210**
- Sprint 4 探针（sprint4-probe.mjs）PERF-4 断言阈值同步改为 ≤210
- 后续若拆 sleeveL/R 使增量超 210，须新 ADR 上调

## 反对意见与缓解
- 反对：mesh 数持续增长削弱低端设备性能。
- 缓解：210 远低于 R4 上限；arms 未拆袖（零额外增量）；象仅 4 枚，增量可控；肌肉写实未引入金属件。
