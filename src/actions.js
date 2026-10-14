// 把拖给夕的文件交给 Claude
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { shell } = require('electron');

const PASTE_SCRIPT = path.join(__dirname, '..', 'scripts', 'paste-to-claude.js');

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// 1) 新开对话：走 Claude 桌面版官方「Send to Claude」同款深链
//    target: 'code' → Claude Code 会话；'cowork' → Cowork 任务
function openNewSession(paths, target = 'code') {
  const params = new URLSearchParams({ source: 'services' });
  for (const p of paths.slice(0, 32)) params.append(isDir(p) ? 'folder' : 'file', p);
  const url = `claude://${target}/new?${params.toString().replace(/\+/g, '%20')}`;
  return shell.openExternal(url).then(() => ({ ok: true }));
}

// 2) 加到当前对话：文件放进剪贴板 → 激活 Claude → ⌘V，然后还原剪贴板
//    需要「辅助功能」权限（系统设置 → 隐私与安全性 → 辅助功能）
function addToCurrentChat(paths) {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', PASTE_SCRIPT, ...paths], { timeout: 15000 }, (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true });
      const msg = String(stderr || err.message);
      const denied = /not allowed|不允许|1002|assistive|辅助/i.test(msg);
      resolve({ ok: false, denied, error: msg.trim().slice(0, 300) });
    });
  });
}

// 3) 终端里开一个 Claude Code CLI 会话，并把文件路径作为首条消息
function openInTerminal(paths) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const first = paths[0];
  const dir = isDir(first) ? first : path.dirname(first);
  const prompt = `请先看看这些文件，然后等我的指示：\n${paths.join('\n')}`;
  const cmd = `cd ${q(dir)} && claude ${q(prompt)}`;
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', [
      '-e', 'on run argv',
      '-e', 'tell application "Terminal"',
      '-e', 'activate',
      '-e', 'do script (item 1 of argv)',
      '-e', 'end tell',
      '-e', 'end run',
      cmd,
    ], { timeout: 10000 }, (err, _o, stderr) => resolve(err ? { ok: false, error: String(stderr || err.message) } : { ok: true }));
  });
}

function openClaudeApp() {
  return shell.openExternal('claude://code/continue?session=last&source=desktop_action');
}

function newCodeSession() {
  return shell.openExternal('claude://code/new?source=desktop_action');
}

function openAccessibilitySettings() {
  return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
}

module.exports = { openNewSession, addToCurrentChat, openInTerminal, openClaudeApp, newCodeSession, openAccessibilitySettings };
