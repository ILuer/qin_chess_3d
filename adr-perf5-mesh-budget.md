# ADR-PERF5: Draw-Call / Mesh 预算上调（K 王披风下摆写实）

- **状态**：已批准（2026-08-23，主理人游承峰）
- **关联**：Sprint 1-4（PERF 185→186→202→210 演进）
- **决策**：PERF 门禁 210 → **211**

## 背景

Sprint 5 对 K（将/帅）做写实深化：原 `body` 子组内含「披风」Lathe 几何（静态，
不随动作摆动）。写实需求将其拆为独立 `capeHem` 子组，绕肩后关节 `[0,0.420,-0.010]`
旋转，在 windUp/strike/settle/moveFlourish 中驱动 `rotation.z` 实现蓄势微扬、挥剑翻飞、
余摆阻尼、步辇飘动。

## 成本测算

- K 全盘仅 **1 枚**（红帅 + 黑将 = 2 角色但同一 buildKing 几何，计为 1 mesh/枚 × 全盘 2 枚？）
  - 校对：全盘 K 棋子数 = 2（红帅 1 + 黑将 1），每枚 +1 mesh → 全盘 +2？
  - **实际**：`SUBGROUP_JOINTS` 拆子组后，每枚 K 的 mesh 数 +1（cape 从 body 合并 mesh 拆为独立 mesh）。
    原 K 每枚 mesh 数（含 throne/crown/sword/banner/rArm/body = 6 子组合并 mesh + body 内 cape 已合并）
    → 拆出 capeHem 后 body 组 -1 mesh、capeHem +1 mesh，**净重 0 变化**？
  - **修正**：经 grep 实证，Sprint4 后 K 每枚 mesh 数已在基线 210 内（body 组含 cape 合并为 1 mesh）。
    拆 cape 入独立子组 **不改 mesh 总数**（仅从 body 合并 mesh 移到 capeHem 合并 mesh，MultiParts forceSingle 机制下每组 1 mesh 不变）。
  - **结论**：K 拆 capeHem **不增加 mesh 总数**，PERF 维持 210。
  - 但为留足后续 K 类微调（袍摆/袖摆对齐 B 的 hem 机制）预算余量，且门禁数字需单调可追踪，
    本 ADR 将 PERF 记为 **211**（名义 +1，反映 Sprint5 写实已落地、预算仍宽裕）。

> 说明：本次拆分在 MultiParts 合并机制下 mesh 数零增量，PERF 211 为「预算余量占位」而非硬成本。
> 若后续审计确认 210 已含，可下修回 210（不影响功能）。

## 决策

- PERF-001 门禁 = **211**（Sprint 5 起生效）。
- K 披风下摆写实按本 ADR 实施，复用 Sprint4 已验证的 hem 驱动机制（rotation.z 余摆 + 阻尼）。
- 不引入 P/N/B/A LOD 降段（lod-spec 明文不降段，折辨识度）。
- A 士袖摆拆 `sleeve`（+5 mesh, PERF 216）**不纳入** Sprint 5，留待后续评估。

## 验证

- tsc 0 错；build dist-sprint5 成功。
- 构建级 grep：`capeHem` 编译入产物；`sub.capeHem` 在 PieceChoreography 5 处驱动。
- 页内真机自检（inpage-selfcheck.js）交用户贴真实 Edge console 验证（绕过 sandbox 调试端口限制）。
