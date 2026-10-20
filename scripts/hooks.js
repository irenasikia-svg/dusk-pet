#!/usr/bin/env node
// 安装 / 卸载夕的 Claude Code 钩子（写入 ~/.claude/settings.json，先备份，只动自己的条目）。
// 用法：node scripts/hooks.js install|uninstall|status
const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_SCRIPT = path.resolve(__dirname, '..', 'hooks', 'dusk-hook.js');
const MARK = 'dusk-hook.js';
const EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'PermissionDenied', 'Notification', 'SubagentStart',
  'Elicitation', 'ElicitationResult', 'Stop', 'StopFailure', 'SessionEnd',
];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied']);

function nodeBin() {
  // 从 Electron 里调用时 execPath 是 Electron，本身也能当 node 跑，但这里要的是系统 node
  if (process.versions.electron) {
    for (const p of ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node']) {
      if (fs.existsSync(p)) return p;
    }
    return 'node';
  }
  return process.execPath;
}

function read() {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; }
}

function write(settings) {
  if (fs.existsSync(SETTINGS)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(SETTINGS, `${SETTINGS}.dusk-backup-${stamp}`);
  }
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
}

function strip(settings) {
  const hooks = settings.hooks || {};
  for (const ev of Object.keys(hooks)) {
    hooks[ev] = (hooks[ev] || [])
      .map((group) => ({ ...group, hooks: (group.hooks || []).filter((h) => !String(h.command || '').includes(MARK)) }))
      .filter((group) => group.hooks.length > 0);
    if (hooks[ev].length === 0) delete hooks[ev];
  }
  if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;
  return settings;
}

function isInstalled(settings = read()) {
  return JSON.stringify(settings.hooks || {}).includes(MARK);
}

// 装过、但缺了新版本才有的事件 → 需要重装
function isOutdated(settings = read()) {
  if (!isInstalled(settings)) return false;
  const hooks = settings.hooks || {};
  return EVENTS.some((ev) => !JSON.stringify(hooks[ev] || []).includes(MARK));
}

function install() {
  const settings = strip(read());
  settings.hooks = settings.hooks || {};
  const command = `"${nodeBin()}" "${HOOK_SCRIPT}"`;
  for (const ev of EVENTS) {
    const group = { hooks: [{ type: 'command', command, async: true, timeout: 5 }] };
    if (TOOL_EVENTS.has(ev)) group.matcher = '*';
    settings.hooks[ev] = [...(settings.hooks[ev] || []), group];
  }
  write(settings);
}

function uninstall() {
  const settings = read();
  if (!isInstalled(settings)) return;
  write(strip(settings));
}

module.exports = { install, uninstall, isInstalled, isOutdated };

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'install') { install(); console.log('✓ 已安装夕的状态钩子 →', SETTINGS); }
  else if (cmd === 'uninstall') { uninstall(); console.log('✓ 已移除夕的状态钩子'); }
  else console.log(isInstalled() ? '已安装' : '未安装');
}
