# 夕 · Claude 桌宠

明日方舟「夕 · 0011制造/VI 染尘烟」的官方基建 Q 版小人，常驻桌面，替你盯着 Claude。

## 启动

双击 `启动夕.command`，或者：

```bash
cd ~/claude/dusk-pet && npm start
```

菜单栏会出现「夕」，后面的符号表示当前状态（✎ 处理中、! 等你确认、✓ 完成、z 睡着）。

**开机自动启动**默认开启：用的是 `~/Library/LaunchAgents/local.dusk-pet.plist`，登录时自动拉起。在右键菜单里取消「开机自动启动」就会删掉这个文件。

默认大小是游戏原尺寸的一半（120×125），右键 →「大小」可以调成小、中、大、特大。气泡是一个独立的 macOS 原生毛玻璃窗口，会透出并模糊身后的桌面，拖动她时气泡会跟着走。

## 形象 ↔ 状态

| 状态 | 动作 | 什么时候 |
|---|---|---|
| 常态 | Relax 待机（偶尔变出小凳子坐下摸鱼） | 默认 |
| 处理中 | Sit 坐下来专心干活，头顶冒墨点 | 任意 Claude Code 会话在跑 |
| 一段时间不操作 | Sleep 睡觉 + Zzz | 键鼠闲置超过 3 分钟（可调），或 Claude 和夕都 20 分钟没人理 |
| 等你确认 | Interact + 红色「!」 | 有会话在等你批准权限（会发系统通知） |
| 完成 | Interact 一次 + 盖「夕」印章 | 会话刚答完 |
| 拖文件经过 | Interact + 闪光 | 拖着文件悬停在她身上 |

## 操作

- **单击**：打开工作台（会话 · 进程 · 用量）
- **双击**：打开 Claude，继续最近会话
- **拖动**：拖着走，她会朝拖动方向走路
- **右键**：设置菜单（大小、睡觉时长、拖放默认行为、预览形象、钩子开关……）
- **把文件拖给她**：弹出选项
  - 新开对话：走 Claude 桌面版官方的 `claude://code/new?file=…` 深链，可在右键菜单切换为 Cowork
  - 加到当前对话：把文件放进剪贴板，切到 Claude 后按 ⌘V，再还原剪贴板。需要在「系统设置 → 隐私与安全性 → 辅助功能」里允许 Electron
  - 终端 CLI：在「终端」里 `claude` 新开一个会话并带上文件路径
  - 快捷键：按住 ⌥ 拖放 = 加到当前对话，按住 ⇧ = 终端 CLI

## 数据来源

- **会话状态**：Claude Code 钩子（`hooks/dusk-hook.js`，写入 `~/.claude/dusk-pet/events/`）加上会话日志的写入时间。安装和卸载都在右键菜单里完成，或者用 `npm run install-hooks` / `npm run uninstall-hooks`。改动 `~/.claude/settings.json` 前会先备份，其他钩子原样保留。
- **用量（百分比）**：5 小时额度和本周额度的「已用 / 剩余」百分比。官方数据来自 Claude 桌面版自己记录的 `~/Library/Application Support/Claude/plan-usage-history.json`。桌面版只在菜单栏图标最近被打开过时才会在后台刷新这份数据，所以它可能过时；过时的部分按本机 Claude 日志里的输出 token 外推，比例根据历史读数自动校准，界面上标「≈」。DeepSeek 等第三方模型不计入 Claude 额度。重置时间来自 `~/.claude/dusk-pet/config.json` 里的 `weeklyResetAt` / `fiveHourResetAt`。`~/.claude/dusk-pet/plan-samples.json` 可以补充额外的官方读数。
- **进程**：`ps` + `lsof` 找出 `claude` 进程及其工作目录，另外汇总 Claude.app 的 CPU 和内存。

## 文件

```
src/main.js          主进程：窗口、菜单、托盘、状态决策
src/monitor.js       钩子事件 + 日志 + 进程 → 状态
src/usage.js         jsonl 增量解析与用量汇总
src/actions.js       拖放文件的三种投递方式
src/renderer/        桌宠（Spine 播放）、毛玻璃气泡与工作台面板
hooks/dusk-hook.js   Claude Code 钩子
scripts/hooks.js     钩子安装和卸载
assets/dusk/         官方 Spine 模型（来自 isHarryh/Ark-Models，版权归鹰角网络，仅限个人使用）
assets/vendor/       Spine 3.8 运行时（EsotericSoftware/spine-runtimes）
```

想换角色或换皮肤：从 [Ark-Models](https://github.com/isHarryh/Ark-Models) 下载其他 `build_char_*` 模型，改名为 `dusk.skel / dusk.atlas / dusk.png`（atlas 第一行要改成 `dusk.png`），替换 `assets/dusk/` 里的文件即可。
