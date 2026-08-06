# GDD · 音频系统 (audio)

## 1. 概述
纯 WebAudio 程序化音效（振荡器 / 噪声 / 卷积混响），零音频资源文件；按兵种差异化音色，五声音阶，营造秦风礼仪感。

## 2. 目标
用声音强化「落子有声、攻防有形」的反馈闭环，且完全本地生成、可一键静音。

## 3. 核心循环
首次用户手势 `SFX.init()` → 事件触发 `play(name, {volume,pitch,pan})` → 节流 `THROTTLE_MS=30`。

## 4. 机制
- 入口：`init()` 须在首次手势调用（否则 suspended）；`setEnabled / setVolume / isEnabled`。
- 分兵种：`move(type) / capture(type)` 经 `MOVE_SFX / CAP_SFX` 映射 `PT.*` → 差异化音色。
- 声部 `VOICES`：select / hover / move / capture / check / illegal / undo / start / win / lose + `move.*` / `capture.*` 各兵种。
- 音色基元：bronzeBody（青铜不谐和泛音）、warDrum（战鼓）、hornNote（五声号角）、startAmbient（低频风声 + 远处鼓点）。

## 5. 数值
峰值电平 `LEVEL` 表与混响发送 `WET` 表分声部设定；节流 `THROTTLE_MS=30`；混响为卷积（程序化脉冲响应）。

## 6. 边界与异常
- 未在用户手势内 init → AudioContext suspended，首音丢失（需引导点击解锁）。
- 节流：30ms 内重复同名事件被合并，避免爆音。
- 静音仅置增益为 0，不销毁节点，便于瞬时恢复。

## 7. 跨系统依赖
- 依赖：事件源（`rules` 合法性 / `ui` 交互 / `ai` 落子 / `main` 流程）。
- 被依赖：无（终端消费层）；`ui` / `render` 调用其 play。

## 8. 开放问题
- 无背景音乐（BGM）层，仅氛围层（startAmbient）。
- 移动端 iOS 需额外手势解锁 AudioContext，策略待补。
