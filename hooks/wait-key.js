// 「等你确认」待办的配对键（钩子和桌宠共用）。
// PermissionRequest 的输入里没有 tool_use_id，只能用「工具名 + 主要参数」
// 把权限请求、之后的 PostToolUse、会话日志里的 tool_use 三者对上。
const crypto = require('crypto');
const path = require('path');

const MAIN_FIELDS = ['command', 'file_path', 'notebook_path', 'url', 'pattern', 'query', 'path', 'skill', 'description'];

function toolKey(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  const f = MAIN_FIELDS.find((k) => typeof i[k] === 'string' && i[k]);
  return `${name}|${f ? i[f].slice(0, 300) : ''}`;
}

function waitPrefix(sid) {
  return `${sid}~`;
}

function waitName(sid, tool, key) {
  const t = String(tool || '').replace(/[^\w-]/g, '_').slice(0, 60);
  const h = crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
  return `${waitPrefix(sid)}${t}~${h}.json`;
}

// 通知和工作台里显示的一句话
function summarize(tool, input) {
  const i = input && typeof input === 'object' ? input : {};
  const cut = (s, n = 48) => {
    const line = String(s || '').trim().split('\n')[0];
    return line.length > n ? `${line.slice(0, n)}…` : line;
  };
  if (tool === 'Bash' && i.command) return `要运行 ${cut(i.command)}`;
  if ((tool === 'Edit' || tool === 'MultiEdit') && i.file_path) return `要改 ${path.basename(i.file_path)}`;
  if (tool === 'Write' && i.file_path) return `要写 ${path.basename(i.file_path)}`;
  if (tool === 'NotebookEdit' && i.notebook_path) return `要改 ${path.basename(i.notebook_path)}`;
  if (tool === 'WebFetch' && i.url) {
    try { return `要访问 ${new URL(i.url).host}`; } catch { return '要访问网页'; }
  }
  if (tool === 'AskUserQuestion') {
    const q = Array.isArray(i.questions) && i.questions[0] && i.questions[0].question;
    return q ? `有问题问你：${cut(q, 40)}` : '有问题问你';
  }
  if (tool === 'ExitPlanMode') return '计划等你过目';
  if (tool === 'Agent' || tool === 'Task') return i.description ? `要派子代理：${cut(i.description, 30)}` : '要派子代理';
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) return `要用 ${mcp[1]} · ${mcp[2]}`;
  return tool ? `要用 ${tool}` : '';
}

module.exports = { toolKey, waitName, waitPrefix, summarize };
