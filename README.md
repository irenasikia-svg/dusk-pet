# 夕 · Claude 桌宠

> 非官方粉丝项目，与鹰角网络（Hypergryph）及各联动作品无关。角色形象和模型的版权归鹰角网络及相关版权方，**不包含在本仓库中**，需自行下载、仅限个人使用。

一只住在 macOS 桌面上的明日方舟 Q 版小人，替你盯着 Claude。

## 为什么做这个

用 Claude Code 干活时，我经常切到别的窗口，然后不知道它是还在跑、在等我批准，还是早就做完了。结果要么一直切回去看，要么让它白白等上十几分钟。

这个桌宠把 Claude 的状态变成你余光就能看到的动作：

- 她**坐下干活**，说明 Claude 正在处理；
- 她头顶出现**红色「!」**并弹出系统通知，说明 Claude 在等你批准或回答；
- 她**盖一个印章**，说明这一轮做完了。

点她一下还能看到用量百分比、所有会话和进程，往她身上拖文件就能直接交给 Claude。

**一些设计取舍：**

- **不打扰**：状态靠动作表达，只有「等你确认」才发系统通知。
- **省电**：常驻桌面的程序必须轻。通过排查把 CPU 占用从约 170% 降到约 12%，你离开电脑时降到 0.5% 左右（见「性能与刷新节奏」）。
- **按证据判断**：Claude Code 在你点「批准」时不发任何事件，所以「是否还在等你」不靠计时猜测，而是看后续的工具结果、新进程和日志（见「数据来源」）。

**运行要求**：macOS、Node.js、Python 3（下载模型用），以及 Claude Code 或 Claude 桌面版。

## 角色

默认是「夕 · 0011制造/VI 染尘烟」，右键 →「换角色…」会弹出一个小列表（最多显示 8 行，用滚轮滑动，也可以用 ↑↓、回车、Esc），点一下就换：

| 角色 | 服装 |
|---|---|
| 夕 | 默认服装、0011制造/VI · 染尘烟、0011制造/XII · 青玉砚 |
| 年 | 0011制造/III · 乐逍遥、中国电影资料馆 · 霹雳导演 |
| 黍 | 默认服装、0011制造/XI · 春日宴、国家图书馆 · 源远流长 |
| 令 | 默认服装、0011制造/VIII · 濯缨、0011制造/XII · 方遒卷 |
| 望 | 默认服装 |
| 新约能天使 | 默认服装、命途迭代/VI · 寻翼之歌 |
| 维什戴尔 | 默认服装、忒斯特收藏/XV · 超新星、成就之星/IX · 绝对主角 |
| 蕾缪安 | 默认服装、音律联觉/VIII · 暮星安魂曲 |
| 若叶睦 | 默认服装、Ave Mujica · 提线的本我 |
| 丰川祥子 | 默认服装、Ave Mujica · 旋律的主人 |
| 克莱门莎 | 默认服装 |
| 赤刃明霄陈 | 默认服装 |
| 司霆惊蛰 | 默认服装、成就之星/VIII · 血翼蔷薇 |
| 缄默德克萨斯 | 默认服装 |
| 缪尔赛思 | 默认服装 |
| 遥 | 默认服装、命途迭代/VI · 常世之幻 |
| 结城理 | 默认服装、女神异闻录３ Reload · 见证荣光 |

每个角色有自己的台词。所有角色按同一个比例显示，体型一致；窗口大小随各自的动作范围调整，带高装饰的角色窗口会高一些。换角色时，脚下的位置不变。

## 准备模型

角色模型是鹰角网络的游戏美术资源，版权归鹰角，**不包含在这个仓库里**，请自行下载到本地、仅限个人使用。需要 Python 3，下面这条命令会从 [isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models)（黍「源远流长」来自 [HellaOrg/HellaAssets](https://github.com/HellaOrg/HellaAssets)）下载全部 33 套，共约 37 MB，放进 `assets/models/<key>/`：

```bash
python3 scripts/fetch_model.py \
  dusk '2015_dusk_nian#7'  dusk_default 2015_dusk  dusk_nian12 '2015_dusk_nian#12' \
  nian_nian4 '2014_nian_nian#4'  nian_cfa '2014_nian_cfa#1' \
  angel2 1041_angel2  angel2_iteration '1041_angel2_iteration#6' \
  ling 2023_ling  ling_nian9 '2023_ling_nian#9'  ling_nian12 '2023_ling_nian#12'  wang 2027_wang \
  wisdel 1035_wisdel  wisdel_sale14 '1035_wisdel_sale#14'  wisdel_game9 '1035_wisdel_game#9' \
  shu 2025_shu  shu_nian11 '2025_shu_nian#11' \
  shu_nlc 'gh:HellaOrg/HellaAssets/spine/operator/build/build_char_2025_shu_nlc#1' \
  lemuen 4193_lemuen  lemuen_ambience '4193_lemuen_ambiencesynesthesia#7' \
  mortis 4183_mortis  mortis_avemujica '4183_mortis_avemujica#1' \
  sakiko 4182_oblvns  sakiko_avemujica '4182_oblvns_avemujica#1' \
  clemnt 4231_clemnt  chen3 1050_chen3  leizi2 1043_leizi2  leizi2_game '1043_leizi2_game#8' \
  texas2 1028_texas2  muelsyse 249_mlyss \
  haruka 4202_haruka  haruka_iteration '4202_haruka_iteration#6' \
  makoto 4217_makoto  makoto_p3r '4217_makoto_p3r#1'
```

遇到 `HTTP Error 403: rate limit exceeded`（未登录的 GitHub 接口每小时只能调 60 次），在命令前面加上 `GH_TOKEN=$(gh auth token)` 再跑。`<key>` 要和 `src/characters.js` 里的一致；没下载的角色在「换角色」里选了会是空白。

**游戏台词（可选）**：点她时说的话可以用游戏原台词。台词同样版权归鹰角、不进仓库。先把 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData) 的 `zh_CN/gamedata/excel/charword_table.json`（约 11 MB）下载到 `~/.cache/arknights-pet/`，再运行：

```bash
node scripts/voices.js
```

会生成 `assets/voices.js`：单击用「交谈」系列，连点用「戳一下」「信赖触摸」。没有这个文件时，用 `src/characters.js` 里写的台词。

## 启动

双击 `pet launch.command`，或者：

```bash
npm install   # 第一次运行前安装依赖
npm start
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
| 等你确认 | Interact + 红色「!」 | 有会话在等你批准权限、回答提问或过目计划（会发系统通知，工作台里写明在等什么） |
| 完成 | Interact 一次 + 盖「夕」印章 | 会话刚答完 |
| 拖文件经过 | Interact + 闪光 | 拖着文件悬停在她身上 |

## 操作

- **单击**：像基建里点干员那样互动：做个互动动作、说一句游戏台词
- **连点**：1 秒内连着戳，第 3 下起换成「戳一下」「信赖触摸」的台词；常态下有特殊动作的角色会做特殊动作
- 工作台、打开 Claude 都在**右键菜单**里（点菜单栏图标也能开工作台）
- **拖动**：拖着走，她会朝拖动方向走路
- **右键**：设置菜单（大小、睡觉时长、拖放默认行为、预览形象、钩子开关……）
- **把文件拖给她**：弹出选项
  - 新开对话：走 Claude 桌面版官方的 `claude://code/new?file=…` 深链，可在右键菜单切换为 Cowork
  - 加到当前对话：把文件放进剪贴板，切到 Claude 后按 ⌘V，再还原剪贴板。需要在「系统设置 → 隐私与安全性 → 辅助功能」里允许 Electron
  - 终端 CLI：在「终端」里 `claude` 新开一个会话并带上文件路径
  - 快捷键：按住 ⌥ 拖放 = 加到当前对话，按住 ⇧ = 终端 CLI

## 数据来源

- **会话状态**：Claude Code 钩子（`hooks/dusk-hook.js`，写入 `~/.claude/dusk-pet/events/`）加上会话日志的写入时间。安装和卸载都在右键菜单里完成，或者用 `npm run install-hooks` / `npm run uninstall-hooks`。改动 `~/.claude/settings.json` 前会先备份，其他钩子原样保留。桌宠启动时如果发现装的是旧版钩子（缺新事件），会自动重装。
- **「等你确认」**：Claude Code 弹出权限请求时（`PermissionRequest`，MCP 要你填信息时是 `Elicitation`），钩子在 `events/waits/` 里单独记一条待办，和「最近一次事件」分开存：钩子是异步跑的，`PreToolUse` 和 `PermissionRequest` 几乎同时触发，存在一起会互相覆盖。你点批准这件事本身没有任何事件，所以按证据判断这条待办结束了没有：
  - 同一个工具的 `PostToolUse` / `PostToolUseFailure`、子代理启动（`SubagentStart`，说明 Agent 工具被批准了）、新的一轮或本轮结束 → 钩子直接删掉待办
  - Bash：claude 进程下面冒出了请求之后才有的新 shell 子进程（命令行带 `shell-snapshots`）→ 你批准了、命令正在跑，2 秒内切回「处理中」
  - 会话日志里这次调用有了结果（批准后跑完，或者被你拒绝）；出现「中断」标记 → 空闲
  - claude 进程已经退出
  
  `PermissionRequest` 的输入里没有 tool_use_id，所以请求、结果、日志里的调用靠「工具名 + 主要参数（命令 / 文件 / 网址）」配对，见 `hooks/wait-key.js`。另外，处理中按了停止不会有 `Stop` 钩子，也靠日志里的「中断」标记回到空闲。
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
- **渲染**：不用 `requestAnimationFrame`，改用定时器限帧到 30 帧（实测比 20 帧多用约一半 CPU：同一角色在处理中状态，20 帧约 13–15%，30 帧约 20–26%）。关闭了多重采样抗锯齿。状态特效不用 CSS 动画（SVG 上的 CSS 动画即使隐藏也会按 120Hz 重绘），改由同一个帧循环更新。
- **刷新**：每 2 秒只做便宜的状态检查（钩子事件、会话日志增量、对话检测）。列进程、`lsof`、算用量和额度这些重活，后台每 60 秒做一次；面板开着时每 3 秒一次，点开面板时立刻刷新。
- **离开模式**：暂停动画、闲逛和对话检测，状态检查改为每 10 秒一次；你回来就恢复。
- 调试用环境变量：`DUSK_DEBUG_DIR`（截图与记录）、`DUSK_DEBUG_STATE`（强制状态）、`DUSK_DEBUG_AWAY`（强制离开模式）、`DUSK_DEBUG_PROFILE`（桌宠页 CPU 采样）、`DUSK_DEBUG_EXEC`（在桌宠页执行脚本）、`DUSK_DEBUG_PICKER`（启动 4 秒后自动弹出换角色列表）。

## 文件

```
src/main.js          主进程：窗口、菜单、托盘、状态决策
src/monitor.js       钩子事件 + 日志 + 进程 → 状态
src/usage.js         jsonl 增量解析与用量汇总
src/actions.js       拖放文件的三种投递方式
src/renderer/        桌宠（Spine 播放）、毛玻璃气泡与工作台面板
hooks/dusk-hook.js   Claude Code 钩子
hooks/wait-key.js    「等你确认」待办的配对键和提示文字（钩子和桌宠共用）
scripts/hooks.js     钩子安装和卸载
assets/models/<角色>/ 官方 Spine 模型 model.skel/atlas/png（不在仓库里，见「准备模型」；版权归鹰角网络，仅限个人使用）
src/characters.js    角色列表与各自台词
AGENTS.md            给 AI 编程助手的项目说明（CLAUDE.md 引用它）
assets/vendor/       Spine 3.8 运行时（EsotericSoftware/spine-runtimes，许可证见 LICENSE-spine-runtimes.txt）
```

想再加角色：在 [Ark-Models](https://github.com/isHarryh/Ark-Models) 的 `models_data.json` 里找到对应的 `Operator` 模型编号（服装的正式名字可以对照 ArknightsGameData 的 `skin_table.json`），然后：

```bash
python3 scripts/fetch_model.py <新key> '<模型编号>'
```

脚本会下载模型、改名为 `model.*`。之后在 `src/characters.js` 里加一行，并写好台词。开发时可以打开 `src/renderer/inspect.html?only=<key>`，检查这个模型有哪些动作。
