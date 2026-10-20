// 汇总三路信号：钩子事件、会话日志、系统进程 → 夕的状态 + 面板数据
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { UsageTracker } = require('./usage');
const { PlanUsage } = require('./plan');
const { ChatWatcher } = require('./chat');

const EVENTS_DIR = path.join(os.homedir(), '.claude', 'dusk-pet', 'events');
const WAITS_DIR = path.join(EVENTS_DIR, 'waits');
const ACTIVE_WRITE_MS = 8000;          // 日志 8 秒内有写入 → 正在处理
const STALE_WORKING_MS = 10 * 60 * 1000; // 钩子说在忙但 10 分钟没动静 → 视为中断
const DONE_FLASH_MS = 8000;            // 完成后开心 8 秒
const WAIT_MAX_MS = 12 * 3600 * 1000;  // 等确认最多记 12 小时
const TURN_BOUNDARY = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure']);

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, timeout: 4000 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function parseEtime(s) {
  // [[dd-]hh:]mm:ss
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim());
  if (!m) return 0;
  return ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + +m[3] * 60 + +m[4]) * 1000;
}

class Monitor {
  constructor() {
    this.usage = new UsageTracker();
    this.plan = new PlanUsage(this.usage);
    this.chat = new ChatWatcher();
    this.procs = [];
    this.app = null;
    this.lastUsageRefresh = 0;
    this.lastHeavy = 0;
    this.heavy = { usage: null, plan: null };
  }

  readHookEvents() {
    const out = new Map();
    let names = [];
    try { names = fs.readdirSync(EVENTS_DIR); } catch { return out; }
    const now = Date.now();
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const p = path.join(EVENTS_DIR, n);
      try {
        const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (now - rec.ts > 2 * 86400 * 1000) { fs.rmSync(p, { force: true }); continue; }
        out.set(rec.session_id, rec);
      } catch { /* 写到一半，下次再读 */ }
    }
    return out;
  }

  // 「等你确认」的待办（钩子在 PermissionRequest / Elicitation 时写下）。
  // 批准本身没有事件，只能找证据判断这条请求结束了没有：
  //   · 钩子：同一个工具的 PostToolUse / 失败，子代理启动，新的一轮（钩子那边直接删文件）
  //   · Bash：claude 进程下出现了请求之后才有的新 shell 子进程 → 你批准了，命令在跑
  //   · 会话日志：这次调用有了结果（批准后跑完，或者被你拒绝），或者出现「中断」
  //   · claude 进程已经退出
  async readWaits(hooks, now) {
    const out = new Map();
    let names = [];
    try { names = fs.readdirSync(WAITS_DIR); } catch { return out; }
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const p = path.join(WAITS_DIR, n);
      let w;
      try { w = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
      const h = hooks.get(w.session_id);
      const marks = this.usage.marksSince(w.session_id, w.ts);
      const done = now - w.ts > WAIT_MAX_MS
        || (w.pid && !alive(w.pid))
        || (h && h.ts > w.ts && TURN_BOUNDARY.has(h.event))
        || marks.some((m) => m.kind === 'interrupt' || (m.kind === 'result' && (!w.key || m.key === w.key)))
        || (w.tool === 'Bash' && w.pid && await this.newBashChild(w));
      if (done) { fs.rmSync(p, { force: true }); continue; }
      const list = out.get(w.session_id) || [];
      list.push(w);
      out.set(w.session_id, list);
    }
    return out;
  }

  async newBashChild(w) {
    const out = await run('/usr/bin/pgrep', ['-P', String(w.pid), '-f', 'shell-snapshots']);
    const base = new Set(w.kids || []);
    return out.split('\n').filter(Boolean).some((x) => !base.has(+x));
  }

  async refreshProcesses() {
    const ps = await run('/bin/ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,etime=,args=']);
    const rows = [];
    for (const line of ps.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!m) continue;
      rows.push({ pid: +m[1], ppid: +m[2], cpu: +m[3], mem: +m[4] * 1024, uptime: parseEtime(m[5]), args: m[6] });
    }

    const appMain = rows.find((r) => /\/Claude\.app\/Contents\/MacOS\/Claude(\s|$)/.test(r.args));
    const appPids = new Set();
    if (appMain) {
      appPids.add(appMain.pid);
      let grew = true;
      while (grew) {
        grew = false;
        for (const r of rows) if (!appPids.has(r.pid) && appPids.has(r.ppid)) { appPids.add(r.pid); grew = true; }
      }
    }

    const sessions = rows.filter((r) => {
      const head = r.args.split(' -')[0];
      return /(^|\/)claude(\s|$)/.test(head) || /@anthropic-ai\/claude-code\/cli\.js/.test(r.args);
    });

    const cwdOut = sessions.length
      ? await run('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', sessions.map((s) => s.pid).join(',')])
      : '';
    const cwds = {};
    let cur = 0;
    for (const l of cwdOut.split('\n')) {
      if (l[0] === 'p') cur = +l.slice(1);
      else if (l[0] === 'n') cwds[cur] = l.slice(1);
    }

    this.procs = sessions.map((s) => {
      const model = /--model[= ](\S+)/.exec(s.args);
      const mode = /--permission-mode[= ](\S+)/.exec(s.args);
      return {
        pid: s.pid,
        kind: appPids.has(s.pid) ? 'desktop' : 'cli',
        cpu: s.cpu,
        mem: s.mem,
        uptime: s.uptime,
        cwd: cwds[s.pid] || '',
        model: model ? model[1] : '',
        mode: mode ? mode[1] : '',
      };
    }).sort((a, b) => a.uptime - b.uptime);

    // 「对话」标签页的检测：App 的网络进程 + 主窗口渲染进程（内存最大的那个）
    const appRows = rows.filter((r) => appPids.has(r.pid));
    const net = appRows.find((r) => /network\.mojom\.NetworkService/.test(r.args));
    this.chat.update({ netPid: net ? net.pid : null });

    if (appMain) {
      const all = rows.filter((r) => appPids.has(r.pid) && !sessions.some((s) => s.pid === r.pid));
      this.app = {
        pid: appMain.pid,
        cpu: all.reduce((a, r) => a + r.cpu, 0),
        mem: all.reduce((a, r) => a + r.mem, 0),
        uptime: appMain.uptime,
        helpers: all.length - 1,
      };
    } else {
      this.app = null;
    }
  }

  // 每次（约 2 秒）都做的只有便宜的事：读钩子事件、增量读会话日志、对话检测结果。
  // 贵的事（ps + lsof 列进程、算用量和额度）只在 heavy=true 时做：后台每分钟一次，面板开着时每 3 秒一次。
  async tick(cfg = {}, { heavy = false } = {}) {
    const now = Date.now();
    if (now - this.lastUsageRefresh > 2500) {
      try { this.usage.refresh(); } catch (e) { console.error('usage refresh', e); }
      this.lastUsageRefresh = now;
    }
    if (heavy || !this.lastHeavy) {
      await this.refreshProcesses();
      this.heavy.usage = this.usage.summary();
      this.heavy.plan = this.plan.summary(cfg, this.chat.replies(now));
      this.lastHeavy = now;
    }

    const hooks = this.readHookEvents();
    const waits = await this.readWaits(hooks, now);
    const logSessions = this.usage.sessions();
    const byId = new Map(logSessions.map((s) => [s.id, s]));
    for (const [id, h] of hooks) {
      if (!byId.has(id) && now - h.ts < 12 * 3600 * 1000) {
        byId.set(id, { id, mtime: h.ts, title: '（新会话）', cwd: h.cwd, model: '', lastType: '', lastStop: '' });
      }
    }
    for (const [id, list] of waits) {
      if (!byId.has(id)) byId.set(id, { id, mtime: list[0].ts, title: '（新会话）', cwd: list[0].cwd, model: '', lastType: '', lastStop: '' });
    }

    const sessions = [];
    for (const s of byId.values()) {
      const h = hooks.get(s.id);
      const writing = now - s.mtime < ACTIVE_WRITE_MS;
      let status = 'idle';
      let since = s.mtime;
      const wait = (waits.get(s.id) || [])[0];
      if (wait) {
        status = 'waiting';
        since = wait.ts;
      } else if (h) {
        status = h.status === 'waiting' ? 'working' : h.status; // 旧版钩子写的「等确认」
        since = h.ts;
        if (status === 'working' && now - Math.max(h.ts, s.mtime) > STALE_WORKING_MS) status = 'idle';
        if (status === 'done' && writing && s.mtime > h.ts + 1500) status = 'working';
        // 你按了停止：日志里会写「中断」，但不会有 Stop 钩子
        if (status !== 'idle' && this.usage.marksSince(s.id, h.ts).some((m) => m.kind === 'interrupt')) status = 'idle';
      } else if (writing) {
        status = s.lastType === 'assistant' && s.lastStop === 'end_turn' ? 'done' : 'working';
      } else if (s.lastType === 'assistant' && s.lastStop === 'end_turn') {
        status = 'done';
      }
      if (status === 'done' && now - Math.max(since, s.mtime) > DONE_FLASH_MS) status = 'idle';
      sessions.push({ ...s, status, since, tool: wait ? wait.tool : h ? h.tool : '', hookMsg: wait ? wait.message : h ? h.message : '' });
    }
    // Claude 桌面版的「对话」（Chat 标签页）：没有本地日志，靠 ChatWatcher 推断
    const chat = this.chat.status(now);
    if (chat.mtime && now - chat.mtime < 12 * 3600 * 1000) {
      let status = chat.status;
      if (status === 'done' && now - chat.since > DONE_FLASH_MS) status = 'idle';
      sessions.push({ id: 'claude-chat', source: 'chat', title: 'Claude 对话', cwd: '', model: '', mtime: chat.mtime, since: chat.since, status, tool: '', hookMsg: '' });
    }
    sessions.sort((a, b) => rank(a.status) - rank(b.status) || b.mtime - a.mtime);

    const lastClaudeActivity = Math.max(this.usage.lastActivity(), ...sessions.map((s) => s.mtime), 0);
    let overall = 'idle';
    if (sessions.some((s) => s.status === 'waiting')) overall = 'waiting';
    else if (sessions.some((s) => s.status === 'working')) overall = 'working';
    else if (sessions.some((s) => s.status === 'done')) overall = 'done';

    return {
      overall,
      lastClaudeActivity,
      sessions: sessions.slice(0, 12),
      procs: this.procs,
      app: this.app,
      usage: this.heavy.usage,
      plan: this.heavy.plan,
      refreshedAt: this.lastHeavy,
      hooksSeen: hooks.size > 0,
      chatActive: chat.status === 'working',
      at: now,
    };
  }
}

Monitor.prototype.stop = function stop() {
  this.chat.stop();
};

// 离开时暂停对话检测（nettop），回来再接上
Monitor.prototype.pause = function pause(paused) {
  this.chat.setHold(paused);
};

function rank(status) {
  return { waiting: 0, working: 1, done: 2, idle: 3 }[status] ?? 4;
}

module.exports = { Monitor };
