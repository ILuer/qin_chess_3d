# 战场音效素材授权记录 (ATTRIBUTION)

本表登记 `assets/audio/**` 下**真实录音级素材**的来源与授权协议。

> 既有 29 条 `assets/audio/**` WAV 为离线物理建模合成（非实地录音），不在此表登记；
> 本表仅覆盖 **Sprint1（K/P/A 九事件）** 新增的真实录音采样。

## 授权协议（全部 CC0）

| 来源包 | 作者 / 发布方 | 协议 | 资产页 |
|--------|--------------|------|--------|
| Kenney.nl — Audio (UI Audio) | Kenney (kenney.nl) | CC0 1.0 (公有领域) | https://kenney.nl/assets/ui-audio |
| Kenney.nl — Sci-Fi Sounds | Kenney (kenney.nl) | CC0 1.0 (公有领域) | https://kenney.nl/assets/sci-fi-sounds |
| Kenney.nl — Impact Sounds | Kenney (kenney.nl) | CC0 1.0 (公有领域) | https://kenney.nl/assets/impact-sounds |
| Kenney.nl — RPG Audio | Kenney (kenney.nl) | CC0 1.0 (公有领域) | https://kenney.nl/assets/rpg-audio |
| Kenney.nl — Voiceover Pack (Fighter) | Kenney (kenney.nl) | CC0 1.0 (公有领域) | https://kenney.nl/assets/voiceover-pack-fighter |

**CC0 声明**：上述素材以 [Creative Commons CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) 发布，
作者放弃全部版权，可自由用于商业/非商业用途，**无需署名**（本表为合规透明记录，非法律要求）。
严禁用于再分发源文件以外的任何非 CC0 专有源（Mixkit 等已被排除）。

## 格式与处理

所有 Kenney 原始文件为 OGG/Vorbis；本 Spriny1 经解码（Python `soundfile` / libsndfile）统一转码为：

- 采样率 **32 kHz** · 单声道（mono）· PCM_16（与既有 29 条合成采样格式完全一致）
- 峰值归一 **-3 dBFS**（仅压不抬，避免放大底噪）
- 时长裁剪到 idle 0.1–0.4s / move 0.4–0.8s / capture 0.6–1.0s
- 干声约定：房间感由引擎石殿 Convolver（1.5s IR）统一负责，无内置混响

## 事件 → 原始文件映射

`pawn.move` / `advisor.move` 的脚步素材原生时长偏短（~0.25s），已做**双段拼接**（5ms 交叉淡入淡出）
拉长到 ~0.5s 以落入 move 时长窗；其落盘文件名带 `.long` 后缀，MANIFEST 键仍用 `foley.pawn.move` /
`foley.advisor.move`（指向 `.long.wav`）。每个事件主文件 + `_v2` / `_v3` 两个变异，共 27 个 WAV。

| 事件 | MANIFEST key | 落盘文件 | 原始 Kenney 文件（包:文件） | 包 CC0 页 |
|------|--------------|----------|----------------------------|-----------|
| king.idle | `vox.king.idle` | `vox/king.idle.wav` (+_v2/_v3) | rpg-audio:cloth1 / clothBelt / creak1 | rpg-audio |
| king.move | `foley.king.move` | `foley/king.move.wav` (+_v2/_v3) | rpg-audio:creak1 / sci-fi-sounds:doorClose_000 / rpg-audio:doorClose_1 | rpg-audio, sci-fi-sounds |
| king.capture | `vox.king.capture` | `vox/king.capture.wav` (+_v2/_v3) | voiceover-pack-fighter:kill_him / combo / ready | voiceover-pack-fighter |
| pawn.idle | `foley.pawn.idle` | `foley/pawn.idle.wav` (+_v2/_v3) | impact-sounds:impactMetal_light_000 / impactGeneric_light_000 / impactGlass_light_000 | impact-sounds |
| pawn.move | `foley.pawn.move` | `foley/pawn.move.long.wav` (+_v2/_v3.long) | impact-sounds:footstep_wood_000 / rpg-audio:footstep05 / impact-sounds:footstep_concrete_000（双段拼接） | impact-sounds, rpg-audio |
| pawn.capture | `foley.pawn.capture` | `foley/pawn.capture.wav` (+_v2/_v3) | sci-fi-sounds:impactMetal_000 / 001 / 002 | sci-fi-sounds |
| advisor.idle | `foley.advisor.idle` | `foley/advisor.idle.wav` (+_v2/_v3) | rpg-audio:metalClick / ui-audio:switch20 / rpg-audio:metalLatch | rpg-audio, ui-audio |
| advisor.move | `foley.advisor.move` | `foley/advisor.move.long.wav` (+_v2/_v3.long) | rpg-audio:footstep00 / footstep03 / footstep06（双段拼接） | rpg-audio |
| advisor.capture | `vox.advisor.capture` | `vox/advisor.capture.wav` (+_v2/_v3) | voiceover-pack-fighter:fight / combo / kill_him | voiceover-pack-fighter |

## 语义对齐说明（设计稿 §1 意图）

- `king.idle` 帅旗猎猎 + 低沉呼吸 → 布料摩挲（rpg cloth）
- `king.move` 步辇木轮辚辚 → 木轴吱呀（rpg creak / sci-fi door）
- `king.capture` 帅旗前指 + 一喝 → 战吼人声（fighter kill_him）
- `pawn.idle` 戈柄轻叩盾面（木+金属）→ 金属轻击（impact metal light）
- `pawn.move` 皮靴踏地 + 甲片 → 木地脚步（impact footstep / rpg footstep）
- `pawn.capture` 戈劈砍破空 + 盾格金属 → 金属重击（sci-fi impactMetal）
- `advisor.idle` 剑鞘轻碰 → 金属轻碰/开关（rpg metalClick / ui switch）
- `advisor.move` 护卫碎步 → 轻快脚步（rpg footstep）
- `advisor.capture` 战吼 + 劈砍 → 战吼人声（fighter fight）

---

生成方式：`scripts/kenney-ogg-to-wav.py`（OGG→WAV 转码 + 归一 + 裁剪）。
接入规格：`design/audio/sprint1-real-sfx-integration.md`。
音频设计师：阮和鸣（audio-director）。

---

## Sprint2 真实录音（R/C 六事件）· 规划 / 待源落地

> **状态：MANIFEST 键与 recipes 路由已就位，wav 暂未落盘。**
> 本环境无法联网取 Kenney 源（`kenney.nl:443` 连接失败，与 Sprint1 文档 §0 环境约束一致）、
> 无本地 Kenney ogg 源文件、且无离线转码工具（soundfile/numpy 未装且 pip 不可达）。
> 故下表"原始 Kenney 文件"列为**待补**，待 Kenney 源到位后由 `kenney-ogg-to-wav.py`
> 走同 Sprint1 流程补全，再回填本表（与 Sprint1 §5 的 `_pending_` 模板立场一致）。
> **绝不预填伪造文件名**——CC0 诚信红线。

### 授权协议（预期全部 CC0，沿用 Sprint1 包）

| 来源包 | 作者 / 发布方 | 协议 | 资产页 |
|--------|--------------|------|--------|
| Kenney.nl — Audio (UI Audio) | Kenney (kenney.nl) | CC0 1.0 (公有领域) | https://kenney.nl/assets/ui-audio |
| Kenney.nl — Sci-Fi Sounds | Kenney (kenney.nl) | CC0 1.0 (公有领域) | https://kenney.nl/assets/sci-fi-sounds |
| Kenney.nl — Impact Sounds | Kenney (kenney.nl) | CC0 1.0 (公有领域) | https://kenney.nl/assets/impact-sounds |
| Kenney.nl — RPG Audio | Kenney (kenney.nl) | CC0 1.0 (公有领域) | https://kenney.nl/assets/rpg-audio |
| Kenney.nl — Voiceover Pack (Fighter) | Kenney (kenney.nl) | CC0 1.0 (公有领域) | https://kenney.nl/assets/voiceover-pack-fighter |

### 事件 → 目标 Kenney 包 / 语义映射（原始文件名 _pending_）

R/C 六事件全部为 **foley 语义**（轮轴/轮滚/急刹/木架/推行/巨石落地轰；
士兵低语走 foley 布料/噪声层，不新增 vox 键），与 Sprint1 的 K/P/A 落盘约定一致
（32k mono PCM16、峰值 -3dBFS、idle 0.1–0.4s / move 0.4–0.8s / capture 0.6–1.0s、干声）。

| 事件 | MANIFEST key | 落盘文件（规划） | 目标 Kenney 包 | 语义对齐 | 原始文件 |
|------|--------------|------------------|----------------|----------|----------|
| rook.idle | `foley.rook.idle` | `foley/rook.idle.wav` (+_v2/_v3) | rpg-audio / ui-audio | 轮轴吱呀 / 木轴摩擦 → 木轴 creak | _pending_ |
| rook.move | `foley.rook.move` | `foley/rook.move.wav` (+_v2/_v3) | rpg-audio / impact-sounds | 双轮滚动 + 马蹄 → 轮滚 footstep / 蹄 | _pending_ |
| rook.capture | `foley.rook.capture` | `foley/rook.capture.wav` (+_v2/_v3) | sci-fi-sounds / impact-sounds | 车轮急刹 + 戈击金属 → 金属重击 | _pending_ |
| cannon.idle | `foley.cannon.idle` | `foley/cannon.idle.wav` (+_v2/_v3) | rpg-audio / voiceover-pack-fighter | 木架吱呀 + 士兵低语 → 木架 creak + 低语噪声 | _pending_ |
| cannon.move | `foley.cannon.move` | `foley/cannon.move.wav` (+_v2/_v3) | impact-sounds / rpg-audio | 推行 + 轮滚 → 木轮 footstep | _pending_ |
| cannon.capture | `foley.cannon.capture` | `foley/cannon.capture.wav` (+_v2/_v3) | impact-sounds / sci-fi-sounds | 抛杆破空 + 巨石落地轰 → 重击 + 石落 | _pending_ |

### 路由接管说明（零双响，复用 Sprint1 applySampleOverlay 挂载点）

- `rook.idle`：overrideSample 接管 applySampleOverlay 挂在 `rook.idle` 的 `vox.breath`
- `rook.move`：swapFoley 替换 `rook.move.cruise` 的 `foley.wheel` → `foley.rook.move`
- `rook.capture`：addSample 在 `rook.capture.clash` 叠加 `foley.rook.capture`，并 trimPeak 程序化 bladeClash 0.72
- `cannon.idle`：overrideSample 接管 `cannon.idle` 的 `foley.wood.creak` → `foley.cannon.idle`
- `cannon.move`：swapFoley 替换 `cannon.move.cruise` 的 `foley.wheel` → `foley.cannon.move`
- `cannon.capture`：overrideSample 接管 `cannon.capture.stoneImpact` 的 `foley.stone.crush` → `foley.cannon.capture`

### 体积评估（待落地）

现有全集磁盘 2.92MB（含 Sprint1 K/P/A 27 wav + 既有 29 合成 + 3 环境床；远低于 12MB 预算）。
6 事件 ×3 变体（18 wav @32k mono ≤1.0s）预估 ≤ ~2.0MB 磁盘，落地后全集仍 < 12MB 预算。
