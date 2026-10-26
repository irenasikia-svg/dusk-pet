# 明日方舟 Claude 桌宠 · 给 AI agent 的项目说明

> 这是项目的 AGENTS.md：AI 编程助手（Claude Code、OpenCode 等）每次进入这个仓库都会先读它，不用再手动提醒。Claude Code 通过根目录的 `CLAUDE.md` 引用本文件。最后更新：2026-10-20。

## 一句话

`~/claude/dusk-pet` 是一个 Electron 做的 macOS 桌宠：用明日方舟官方的基建 Q 版 Spine 模型（目前 33 套形象），实时反映 Claude（Code 会话和普通对话）的状态，点开是一个纯白的工作台，显示用量百分比、会话和进程。往她身上拖文件可以交给 Claude。

## 当前状态

- git 仓库，分支 `main`。提交历史用 `git log --oneline` 查看。主要里程碑：初版（夕的模型、状态联动、毛玻璃气泡、用量面板）→ 多角色和换角色菜单 → 对话识别、用量校准、闲逛模式 → 性能优化（CPU 从约 170% 降到约 12%）→「等你确认」按证据判断 → 准备公开（模型和截图移出仓库）。
- 桌宠由开机启动项运行，当前角色是黍（国家图书馆 · 源远流长）。

## 功能一览

| 功能 | 说明 |
|---|---|
| 形象 | 33 套：夕（默认/染尘烟/青玉砚）、年（乐逍遥/霹雳导演）、新约能天使（默认/寻翼之歌）、黍（默认/春日宴/源远流长）、令（默认/濯缨/方遒卷）、望、维什戴尔（默认/超新星/绝对主角）、蕾缪安（默认/暮星安魂曲）、若叶睦（默认/提线的本我）、丰川祥子（默认/旋律的主人）、克莱门莎、赤刃明霄陈、司霆惊蛰（默认/血翼蔷薇）、缄默德克萨斯、缪尔赛思、遥（默认/常世之幻）、结城理（默认/见证荣光）。右键 →「换角色…」弹出小列表（最多显示 8 行，滚轮滑动，↑↓/回车/Esc）切换；原生子菜单没法固定高度滚动，所以列表是单独的毛玻璃窗口 `src/renderer/picker.*` |
| 状态 | 常态＝待机；处理中＝坐下 + 头顶墨点；等你确认＝互动 + 红色「!」+ 系统通知；完成＝互动 + 盖印章；拖文件经过＝互动 + 闪光 |
| 闲逛 | 键鼠 3 分钟没动（或 Claude 和她都 20 分钟没人理）：在原位左右约 240px 内走走停停，停下时随机发呆、伸懒腰或做特殊动作；你回来她就走回原位 |
| 离开模式 | 键鼠 10 分钟没动或锁屏：暂停动画、闲逛和对话检测 |
| 尺寸 | 所有角色按统一比例显示（夕的取景高 438 单位 = 125px）；窗口随动作范围调整；位置存的是脚下中点 |
| 气泡 | 独立的 macOS 原生毛玻璃窗口（vibrancy: popover），跟着她移动 |
| 工作台 | 纯白；用量（5 小时 / 本周的已用和剩余百分比、重置时间）、会话列表（含「Claude 对话」）、进程 |
| 拖放文件 | 新开对话（官方 `claude://code/new?file=…` 深链）/ 加到当前对话（剪贴板 + ⌘V，需要「辅助功能」权限）/ 终端 CLI；⌥＝当前对话，⇧＝终端 |
| 交互 | 单击/连点＝互动（互动动作 + 游戏台词，连点第 3 下起换反应），拖动搬家，右键菜单（含工作台、打开 Claude） |
| 开机自启 | `~/Library/LaunchAgents/local.dusk-pet.plist`，菜单里可关 |

## 代码结构

```
src/main.js          主进程：窗口、菜单、托盘、状态决策、闲逛调度、刷新节奏、离开模式、调试开关
src/monitor.js       汇总钩子事件 + 会话日志 + 进程 + 对话检测 → 状态；轻量 tick / 重量 refresh 分离
src/chat.js          「对话」标签页回复检测（nettop 看 App 网络进程下行字节）
src/usage.js         增量解析 ~/.claude/projects/**/*.jsonl
src/plan.js          用量百分比：官方数据 + 本机估算（Code 输出 token + 对话回复秒数，自动校准）
src/characters.js    角色列表、服装正式名、印章字、各角色台词（主进程和页面共用）
src/actions.js       拖放文件的三种投递方式
src/renderer/        pet（Spine 播放 + 特效）、bubble（毛玻璃气泡）、panel（工作台）、inspect.html（开发用）
hooks/dusk-hook.js   Claude Code 钩子，写 ~/.claude/dusk-pet/events/<session>.json 和 events/waits/（等你确认的待办）
hooks/wait-key.js    待办的配对键（工具名 + 主要参数）和提示文字
scripts/hooks.js     钩子安装/卸载（会先备份 ~/.claude/settings.json）
scripts/fetch_model.py  下载模型并改名为 model.*
scripts/voices.js    从 ~/.cache/arknights-pet/charword_table.json 抽取点击台词 → assets/voices.js（本地，不进仓库）
assets/models/<key>/ 模型（版权归鹰角，只能本地自用；已加进 .gitignore，公开仓库及其提交历史里都没有）
```

## 本机上相关的文件

- `~/.claude/dusk-pet/config.json`：当前角色、位置（cx/bottom）、各角色取景、重置时间锚点等。桌宠运行时别直接改，它会把改动覆盖回去；要先停掉桌宠。
- `~/.claude/dusk-pet/plan-samples.json`：补充的官方用量读数（例如设置里 Usage 页的截图数字）。
- `~/.claude/dusk-pet/chat-activity.json`：对话回复的起止时间。
- `~/Library/Application Support/Claude/plan-usage-history.json`：桌面版自己记的官方用量。只在桌面版启动时、或 24 小时内点开过菜单栏 Claude 图标时才会更新。
- `~/.claude/skills/arknights-pet-models/`：加角色的个人 skill（search / fetch / capture 三个脚本）。

## 关键做法和踩过的坑

- **对话检测**：普通对话没有本地日志，只能从外部判断。回复时每秒稳定收到 0.6–1 KB、几乎不上行；切页面是大块突发。`nettop` 必须挂在 `sleep 2147483646 | script` 这条真管道上：给 `/dev/null` 会空转（这是 138% CPU 的来源），给 Node 的 pipe 会让 `script` 直接退出。启动时会按进程组清掉孤儿进程。
- **测试脚本加载 `src/chat.js`**：它加载时会清理孤儿 nettop。2026-10-20 之前不看父进程，测试脚本一加载就会把桌宠自己那组杀掉，而且被信号杀掉后不会重启。现在只清 ppid=1 的组，被杀后下次列进程（≤60 秒）会自动拉起。
- **用量**：Ark-Models / 本机日志里都没有官方百分比。官方数字靠桌面版自己的记录；两次记录之间靠估算，界面上标「≈」。
- **性能**：30 帧定时器渲染（2026-10-21 从 20 帧提上来，CPU 约多一半），不用 requestAnimationFrame；SVG 特效不用 CSS 动画（隐藏时也会按 120Hz 重绘）；ps/lsof 后台每 60 秒、面板开着时每 3 秒跑一次。
- **加角色**：用 arknights-pet-models skill。新时装可能 Ark-Models 还没收录，可以去 HellaOrg/HellaAssets 等仓库找，用 `gh:` 写法下载。
- **转身**：不要用 `skeleton.scaleX = -1` 翻骨架。很多模型有不继承镜像的骨骼（`NoRotationOrReflection` / `NoScaleOrReflection`，比如司霆惊蛰的脸、黍「源远流长」的头），翻骨架时这部分会朝错方向。现在是在 `spine-char.js` 的投影矩阵里左右对调，整体镜像（2026-10-26 修）。
- **验证**：一定要在真实 Electron 里截图确认，浏览器预览只能看个大概。
- **调试环境变量**：`DUSK_DEBUG_DIR`、`DUSK_DEBUG_STATE`、`DUSK_DEBUG_AWAY`、`DUSK_DEBUG_PROFILE`、`DUSK_DEBUG_EXEC`、`DUSK_DEBUG_MENU`、`DUSK_DEBUG_PICKER`（启动 4 秒后自动弹出换角色列表）（说明见 README「性能与刷新节奏」）。
- **重启桌宠**：`launchctl bootout gui/$(id -u)/local.dusk-pet`，然后 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.dusk-pet.plist`。

## 已知限制 / 可以继续做的

- Cowork 任务在虚拟机里跑，目前识别不到。
- 「等你确认」：批准本身没有事件。2026-10-20 改成按证据判断（同工具的 PostToolUse、SubagentStart、Bash 新子进程、日志里的结果/中断、进程退出），去掉了旧的「超过 1 分钟且动过键鼠就当已批准」——它会在你没看到提示、正忙别的事时误判成处理中。还剩的盲区：批准后跑得很久、又不是 Bash 或 Agent 的工具（比如很慢的 MCP 调用），要等它跑完才切回处理中。权限请求在桌面版里是否真的触发 `PermissionRequest` 钩子，只从 Claude Code 程序代码里确认过，模拟测试全过，但还没有用真实弹窗实测过。
- 对话识别的阈值只用一次实测标定过；没测过「扩展思考」模式的回复。
- 用量估算在官方数据过时、又有大量网页版或手机端对话时会偏低。
- 台词在 `characters.js`。**新角色不写原创台词**（2026-10-26 用户要求）：有游戏原台词就用原台词——在 CHARACTERS 里填 `charId`，再跑 `node scripts/voices.js` 重新生成 `assets/voices.js`（点击台词：poke 单击、combo 连点；本地文件，已 gitignore，绝不能提交）；没有就算了，不在 LINES 里加条目，状态变化时她就不说话。旧角色已有的台词保留。

## 用户偏好

- 用中文交流；改完要在真实应用里截图验证再汇报。
- **没说提交就不要 commit**；提交信息用中文，末尾加 Co-Authored-By 行。
- 喜欢简洁：工作台纯白、用量只显示百分比和剩余、字号小。
- 下载文件前要征得同意（说了「有的话就下载」就算同意过）。
- 注意：`~/.claude/settings.json` 里 CLI 配置的是 DeepSeek 接口，所以 WebSearch 用不了，调研要用 `gh` 或网页读取。
