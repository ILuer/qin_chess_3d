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
