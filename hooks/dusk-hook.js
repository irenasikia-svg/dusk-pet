#!/usr/bin/env node
// Claude Code hook → 把会话状态写到 ~/.claude/dusk-pet/events/<session>.json，桌宠轮询读取。
// 必须快、绝不能失败：任何异常都静默退出 0，不影响 Claude Code。
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.claude', 'dusk-pet', 'events');

const STATUS = {
  SessionStart: 'idle',
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PostToolUse: 'working',
  PermissionRequest: 'waiting',
  Stop: 'done',
  SubagentStop: null, // 子代理结束不代表主会话结束
};

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

    if (event === 'SessionEnd') {
      fs.rmSync(file, { force: true });
      return;
    }

    let status = STATUS[event];
    if (event === 'Notification') {
      // permission_prompt → 等你批准；idle_prompt → 已经闲下来等输入
      const kind = input.notification_type || '';
      const msg = String(input.message || '');
      status = kind === 'idle_prompt' || /waiting for your input/i.test(msg) ? 'done' : 'waiting';
    }
    if (!status) return;

    fs.mkdirSync(DIR, { recursive: true });
    const record = {
      session_id: sid,
      event,
      status,
      cwd: input.cwd || '',
      transcript_path: input.transcript_path || '',
      tool: input.tool_name || '',
      message: input.message ? String(input.message).slice(0, 200) : '',
      ts: Date.now(),
    };
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record));
    fs.renameSync(tmp, file);
  } catch {
    /* never break Claude Code */
  }
});
