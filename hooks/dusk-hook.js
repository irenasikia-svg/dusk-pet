#!/usr/bin/env node
// Claude Code hook → 把会话状态写到 ~/.claude/dusk-pet/events/，桌宠轮询读取。
// 必须快、绝不能失败：任何异常都静默退出 0，不影响 Claude Code。
//
// 两类文件：
//   events/<session>.json         最近一次事件（处理中 / 完成 / 空闲）
//   events/waits/<session>~….json 「等你确认」的待办，一条权限请求一个文件。
// 「等你确认」单独存：钩子是异步跑的，PreToolUse 和 PermissionRequest 几乎同时触发，
// 只存最近一次事件的话，后写完的那个会把前一个盖掉。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { toolKey, waitName, waitPrefix, summarize } = require('./wait-key');

const DIR = path.join(os.homedir(), '.claude', 'dusk-pet', 'events');
const WAITS = path.join(DIR, 'waits');

const STATUS = {
  SessionStart: 'idle',
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PostToolUse: 'working',
  PostToolUseFailure: 'working',
  PermissionDenied: 'working', // 自动模式的分类器拒了，Claude 会换个办法继续
  SubagentStart: 'working',
  ElicitationResult: 'working',
  Stop: 'done',
  StopFailure: 'idle', // 这一轮因为 API 出错结束
  SubagentStop: null, // 子代理结束不代表主会话结束
};
// 这些事件说明这一轮已经结束或重新开始了，之前没答复的请求都作废
const TURN_BOUNDARY = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd']);

function write(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

function listWaits(sid) {
  let names = [];
  try { names = fs.readdirSync(WAITS); } catch { return []; }
  const prefix = waitPrefix(sid);
  return names.filter((n) => n.startsWith(prefix) && n.endsWith('.json'));
}

function removeWaits(sid, test = () => true) {
  for (const n of listWaits(sid)) if (test(n)) fs.rmSync(path.join(WAITS, n), { force: true });
}

// 已经在跑的 Bash 子进程（命令行里带 shell-snapshots）。记下来当基线：
// 之后出现基线以外的新子进程，就说明你点了批准、命令开始跑了。
function bashChildren(pid) {
  try {
    const out = execFileSync('/usr/bin/pgrep', ['-P', String(pid), '-f', 'shell-snapshots'], { encoding: 'utf8', timeout: 1000 });
    return out.split('\n').filter(Boolean).map(Number);
  } catch {
    return []; // pgrep 没找到时退出码是 1
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    const event = input.hook_event_name;
    const sid = String(input.session_id || '').replace(/[^\w-]/g, '');
    if (!sid || !event) return;
    const file = path.join(DIR, `${sid}.json`);
    const now = Date.now();
    const pid = process.ppid; // 钩子由 claude 进程直接拉起
    const key = input.tool_name ? toolKey(input.tool_name, input.tool_input) : '';
    fs.mkdirSync(WAITS, { recursive: true });

    if (TURN_BOUNDARY.has(event)) removeWaits(sid);
    if (event === 'SessionEnd') {
      fs.rmSync(file, { force: true });
      return;
    }

    // —— 等你确认：单独记一条 ——
    if (event === 'PermissionRequest' || event === 'Elicitation') {
      const isElicit = event === 'Elicitation';
      const tool = isElicit ? 'Elicitation' : String(input.tool_name || '');
      const wkey = isElicit ? `Elicitation|${input.mcp_server_name || ''}` : key;
      write(path.join(WAITS, waitName(sid, tool, wkey)), {
        session_id: sid,
        event,
        tool,
        key: wkey,
        agent_id: input.agent_id || '',
        pid,
        kids: tool === 'Bash' ? bashChildren(pid) : [],
        message: isElicit ? String(input.message || '').slice(0, 200) : summarize(tool, input.tool_input),
        cwd: input.cwd || '',
        ts: now,
      });
      return;
    }
    if (event === 'Notification') {
      // permission_prompt → 等你批准；idle_prompt → 已经闲下来等输入。
      // 权限请求一般已经由 PermissionRequest 记下了，这里只在没有记录时兜底。
      const kind = input.notification_type || '';
      const msg = String(input.message || '');
      if (kind === 'idle_prompt' || /waiting for your input/i.test(msg)) {
        removeWaits(sid);
        write(file, record(input, sid, event, 'done', pid, '', now));
        return;
      }
      if (!listWaits(sid).length) {
        write(path.join(WAITS, waitName(sid, 'Notification', '')), {
          session_id: sid, event, tool: '', key: '', agent_id: '', pid, kids: [],
          message: msg.slice(0, 200), cwd: input.cwd || '', ts: now,
        });
      }
      return;
    }

    // —— 有结果了：把对应的待办清掉 ——
    if (event === 'PostToolUse' || event === 'PostToolUseFailure' || event === 'PermissionDenied') {
      const target = waitName(sid, input.tool_name || '', key);
      removeWaits(sid, (n) => n === target);
    }
    if (event === 'PreToolUse' || event === 'PostToolUse' || event === 'PostToolUseFailure') {
      removeWaits(sid, (n) => n === waitName(sid, 'Notification', ''));
    }
    if (event === 'SubagentStart') {
      // 子代理只会在 Agent 工具被批准之后启动
      removeWaits(sid, (n) => /~(Agent|Task)~/.test(n));
    }
    if (event === 'ElicitationResult') removeWaits(sid, (n) => n.includes('~Elicitation~'));

    let status = STATUS[event];
    if (event === 'PostToolUseFailure' && input.is_interrupt) status = 'idle'; // 你按了停止
    if (!status) return;
    write(file, record(input, sid, event, status, pid, key, now));
  } catch {
    /* never break Claude Code */
  }
});

function record(input, sid, event, status, pid, key, ts) {
  return {
    session_id: sid,
    event,
    status,
    cwd: input.cwd || '',
    transcript_path: input.transcript_path || '',
    tool: input.tool_name || '',
    key,
    agent_id: input.agent_id || '',
    pid,
    message: input.message ? String(input.message).slice(0, 200) : '',
    ts,
  };
}
