# 夕 · Claude 桌宠

明日方舟官方基建 Q 版小人，常驻桌面，替你盯着 Claude。默认是「夕 · 0011制造/VI 染尘烟」，右键 →「换角色」可以切换：

| 角色 | 服装 |
|---|---|
| 夕 | 0011制造/VI · 染尘烟 |
| 黍 | 默认服装、0011制造/XI · 春日宴 |
| 蕾缪安 | 默认服装、音律联觉/VIII · 暮星安魂曲 |
| 若叶睦 | 默认服装、Ave Mujica · 提线的本我 |
| 丰川祥子 | Ave Mujica · 旋律的主人 |
| 缄默德克萨斯 | 默认服装 |
| 缪尔赛思 | 默认服装 |
| 遥 | 默认服装、命途迭代/VI · 常世之幻 |
| 结城理 | 女神异闻录３ Reload · 见证荣光 |

每个角色有自己的台词。所有角色按同一个比例显示，体型一致；窗口大小随各自的动作范围调整，带高装饰的角色窗口会高一些。换角色时，脚下的位置不变。

## 启动

双击 `启动夕.command`，或者：

```bash
cd ~/claude/dusk-pet && npm start
```

菜单栏会出现当前角色的字，后面的符号表示当前状态（✎ 处理中、! 等你确认、✓ 完成、~ 闲逛）。

**开机自动启动**默认开启：用的是 `~/Library/LaunchAgents/local.dusk-pet.plist`，登录时自动拉起。在右键菜单里取消「开机自动启动」就会删掉这个文件。

默认大小是游戏原尺寸的一半（120×125），右键 →「大小」可以调成小、中、大、特大。气泡是一个独立的 macOS 原生毛玻璃窗口，会透出并模糊身后的桌面，拖动她时气泡会跟着走。

## 形象 ↔ 状态

| 状态 | 动作 | 什么时候 |
|---|---|---|
| 常态 | Relax 待机（偶尔变出小凳子坐下摸鱼） | 默认 |
| 处理中 | Sit 坐下来专心干活，头顶冒墨点 | 任意 Claude Code 会话在跑 |
| 一段时间不操作 | 闲逛：在原位左右约 240 像素内慢慢走走停停，停下时随机发呆、伸懒腰或做特殊动作；你一动鼠标，她就走回原位 | 键鼠闲置超过 3 分钟（可调），或 Claude 和她都 20 分钟没人理 |
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
- **「对话」标签页**：普通对话在 App 的网页里直接接收回复，本机没有日志，也没有「正在回复」的信号。所以夕用 `nettop` 看 App 网络进程每秒收到的字节，再结合窗口渲染进程的 CPU：回复时是每秒稳定 0.6–1 KB 的下行、几乎不上行，持续好几秒；切页面则是大块突发。阈值来自 2026-10-15 的实测，见 `src/chat.js`。每次回复的起止时间记在 `~/.claude/dusk-pet/chat-activity.json`，用于估算用量。
- **用量（百分比）**：5 小时额度和本周额度的「已用 / 剩余」百分比。官方数据来自 Claude 桌面版自己记录的 `~/Library/Application Support/Claude/plan-usage-history.json`。桌面版启动时会抓一次用量，之后只有在过去 24 小时内点开过菜单栏里的 Claude 图标时，才会每 15 分钟（你在用时每 5 分钟）在后台刷新；数据过时的话，面板会提示你点一下那个图标。两次官方数据之间，按本机 Code 的输出 token 加上对话的回复时长往后推算，比例用官方读数自动校准，界面上标「≈」。DeepSeek 等第三方模型不计入 Claude 额度。重置时间来自 `~/.claude/dusk-pet/config.json` 里的 `weeklyResetAt` / `fiveHourResetAt`。`~/.claude/dusk-pet/plan-samples.json` 可以补充额外的官方读数，例如设置里「Usage」页面的截图数字。
- **进程**：`ps` + `lsof` 找出 `claude` 进程及其工作目录，另外汇总 Claude.app 的 CPU 和内存。

## 性能与刷新节奏

2026-10-16 排查后的设置（单核 CPU 占用，实测）：

| 情况 | CPU |
|---|---|
| 修复前 | 约 170%（`nettop` 空转 138% + 渲染 30% + 轮询 4%） |
| 平时待机 | 约 12% |
| 处理中 | 约 14% |
| 你离开（键鼠 10 分钟没动或锁屏） | 约 0.5% |

- **对话检测**：`nettop` 必须挂在一条 `sleep | script` 真管道上运行。stdin 给 `/dev/null` 会让它空转，给 Node 的 socket 会让 `script` 直接退出。启动时会按进程组清掉上次崩溃留下的孤儿进程。
- **渲染**：不用 `requestAnimationFrame`，改用定时器限帧到 20 帧。关闭了多重采样抗锯齿。状态特效不用 CSS 动画（SVG 上的 CSS 动画即使隐藏也会按 120Hz 重绘），改由同一个帧循环更新。
- **刷新**：每 2 秒只做便宜的状态检查（钩子事件、会话日志增量、对话检测）。列进程、`lsof`、算用量和额度这些重活，后台每 60 秒做一次；面板开着时每 3 秒一次，点开面板时立刻刷新。
- **离开模式**：暂停动画、闲逛和对话检测，状态检查改为每 10 秒一次；你回来就恢复。
- 调试用环境变量：`DUSK_DEBUG_DIR`（截图与记录）、`DUSK_DEBUG_STATE`（强制状态）、`DUSK_DEBUG_AWAY`（强制离开模式）、`DUSK_DEBUG_PROFILE`（桌宠页 CPU 采样）、`DUSK_DEBUG_EXEC`（在桌宠页执行脚本）。

## 文件

```
src/main.js          主进程：窗口、菜单、托盘、状态决策
src/monitor.js       钩子事件 + 日志 + 进程 → 状态
src/usage.js         jsonl 增量解析与用量汇总
src/actions.js       拖放文件的三种投递方式
src/renderer/        桌宠（Spine 播放）、毛玻璃气泡与工作台面板
hooks/dusk-hook.js   Claude Code 钩子
scripts/hooks.js     钩子安装和卸载
assets/models/<角色>/ 官方 Spine 模型 model.skel/atlas/png（来自 isHarryh/Ark-Models，版权归鹰角网络，仅限个人使用）
src/characters.js    角色列表与各自台词
assets/vendor/       Spine 3.8 运行时（EsotericSoftware/spine-runtimes）
```

想再加角色：在 [Ark-Models](https://github.com/isHarryh/Ark-Models) 的 `models_data.json` 里找到对应的 `Operator` 模型编号（服装的正式名字可以对照 ArknightsGameData 的 `skin_table.json`），然后：

```bash
python3 scripts/fetch_model.py <新key> '<模型编号>'
```

脚本会下载模型、改名为 `model.*`。之后在 `src/characters.js` 里加一行，并写好台词。开发时可以打开 `src/renderer/inspect.html?only=<key>`，检查这个模型有哪些动作。
